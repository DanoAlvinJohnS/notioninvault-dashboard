// "Agents" sidebar: a plain chat with any agent in .claude/agents/, on Claude Code or Gemini CLI.
// All conversation logic lives in ChatController; Spark's speech bubble (step 3) reuses it with a different look.
import { ItemView, WorkspaceLeaf } from 'obsidian';
import type DashboardPlugin from './main';
import { ChatController } from './agent/engine/chat.ts';
import type { AgentDef } from './agent/engine/types.ts';
import { ENGINE_LABEL } from './agent/engine/types.ts';
import { renderChat } from './agent/chatdom.ts';
import { lazyChat } from './agent/lazychat.ts';

export const AGENTS_VIEW = 'vault-agents';

export class AgentChatView extends ItemView {
  plugin: DashboardPlugin;
  chat: ChatController | null = null;
  agents: AgentDef[] = [];
  private list!: HTMLElement;
  private select!: HTMLSelectElement;
  private input!: HTMLTextAreaElement;
  private cost!: HTMLElement;
  private frame = 0;
  private refresh = false;
  private off: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: DashboardPlugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return AGENTS_VIEW; }
  getDisplayText() { return 'Agents'; }
  getIcon() { return 'bot'; }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass('va-root');
    const head = root.createDiv({ cls: 'va-head' });
    this.select = head.createEl('select', { cls: 'dropdown va-agent', attr: { 'aria-label': 'Agent' } });
    const fresh = head.createEl('button', { text: 'New chat', cls: 'va-new' });
    this.cost = head.createSpan({ cls: 'va-cost' });
    this.list = root.createDiv({ cls: 'va-list', attr: { 'aria-live': 'polite' } });
    const form = root.createDiv({ cls: 'va-form' });
    this.input = form.createEl('textarea', { cls: 'va-input', attr: { rows: '3', placeholder: 'Message the agent… (Enter to send, Shift+Enter for a new line)' } });

    fresh.onclick = () => this.chat?.newChat();
    this.select.onchange = () => this.pick(this.select.value);
    this.input.onkeydown = e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); const t = this.input.value; this.input.value = ''; this.chat?.send(t); }
    };
    this.select.onfocus = () => { void this.loadAgents(); };   // picks up agent files added since

    if (!this.plugin.agents) { this.say('AI agents are off. Turn on "Enable AI agents" in Settings > NotionInVault Dashboard (desktop only).'); return; }
    this.chat = new ChatController(() => { throw new Error('engine not ready'); });
    this.off = this.plugin.agents.onPending(() => { this.refresh = true; this.schedule(); });   // cards follow the queue
    await this.loadAgents();
  }

  async onClose() { this.off?.(); this.off = null; this.chat?.stop(); this.chat = null; cancelAnimationFrame(this.frame); }

  private say(text: string) { this.list.empty(); this.list.createDiv({ cls: 'va-msg va-note', text }); }

  private async loadAgents() {
    const a = this.plugin.agents;
    if (!a) return;
    const keep = this.select.value;
    this.agents = await a.catalog();
    this.select.empty();
    if (!this.agents.length) { this.say('No agents yet. Add a file to .claude/agents/ (see .claude/agent-template.md).'); this.input.disabled = true; return; }
    for (const ag of this.agents) {
      const o = this.select.createEl('option', { text: `${ag.name} · ${ENGINE_LABEL[ag.engine]}`, value: ag.name });
      o.title = ag.warning ?? ag.description;
    }
    const choice = this.agents.find(x => x.name === keep) ?? this.agents.find(x => x.name === 'secretary') ?? this.agents[0];
    this.select.value = choice.name;
    if (!this.chat?.agent || this.chat.agent.name !== choice.name || this.chat.agent.engine !== choice.engine) this.pick(choice.name);
  }

  private pick(name: string) {
    const agent = this.agents.find(x => x.name === name), api = this.plugin.agents;
    if (!agent || !api) return;
    this.chat?.stop();
    const chat = this.chat = lazyChat(api);
    chat.onChange = () => this.schedule();
    chat.start(agent);
    this.input.disabled = false;
    if (agent.warning) this.say(agent.warning);
  }

  private schedule() { cancelAnimationFrame(this.frame); this.frame = requestAnimationFrame(() => this.render()); }

  private render() {
    const c = this.chat;
    if (!c) return;
    renderChat(this.list, c, { queue: this.plugin.agents?.queue, openReview: () => { void this.plugin.openReview(); }, scrollEl: this.list }, this.refresh);
    this.refresh = false;
    this.cost.setText(c.costUsd ? `$${c.costUsd.toFixed(2)}` : '');
  }
}
