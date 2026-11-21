// One conversation with one agent, independent of how it is drawn (sidebar now, Spark's speech bubble later).
import type { AgentDef, ChatEvent } from './types.ts';
import type { Engine } from './engines.ts';

export interface ChatMsg { role: 'user' | 'assistant' | 'note' | 'error' | 'proposal'; text: string; id?: string }

/** Claude names tools mcp__vault__x, Gemini mcp_vault_x. */
const short = (tool: string) => tool.replace(/^mcp__?vault__?/, '');

export class ChatController {
  agent: AgentDef | null = null;
  messages: ChatMsg[] = [];
  busy = false;
  costUsd = 0;
  onChange?: () => void;

  private makeEngine: (agent: AgentDef) => Engine;
  private engine: Engine | null = null;
  private queue: string[] = [];
  private current: ChatMsg | null = null;   // the assistant message text is streaming into
  private lastTool = '';
  private toolNames = new Map<string, string>();   // call id -> short tool name, so parallel calls match their own results

  constructor(makeEngine: (agent: AgentDef) => Engine) { this.makeEngine = makeEngine; }

  /** A new conversation with this agent. */
  start(agent: AgentDef) { this.agent = agent; this.reset(); }
  newChat() { this.reset(); }
  stop() { this.engine?.stop(); this.engine = null; this.busy = false; this.queue = []; }

  send(text: string) {
    const t = text.trim();
    if (!t || !this.agent) return;
    this.messages.push({ role: 'user', text: t });
    if (this.busy) this.queue.push(t); else this.dispatch(t);
    this.changed();
  }

  private reset() {
    this.stop();
    this.messages = []; this.costUsd = 0; this.current = null;
    this.changed();
  }

  private dispatch(text: string) {
    if (!this.engine) {
      const e = this.engine = this.makeEngine(this.agent!);
      e.onEvent = ev => { if (this.engine === e) this.handle(ev); };
    }
    this.busy = true; this.current = null;
    this.engine.send(text);
  }

  private say(role: ChatMsg['role'], text: string, id?: string) { this.current = null; this.messages.push(id ? { role, text, id } : { role, text }); }

  private handle(e: ChatEvent) {
    switch (e.type) {
      case 'delta':
        if (!this.current) this.messages.push(this.current = { role: 'assistant', text: '' });
        this.current.text += e.text;
        break;
      case 'message':
        if (!this.current) this.messages.push(this.current = { role: 'assistant', text: '' });
        this.current.text = e.text;
        break;
      case 'tool':
        if (e.status === 'call') { this.lastTool = short(e.name); if (e.id) this.toolNames.set(e.id, this.lastTool); this.say('note', `Using ${this.lastTool}…`); }
        else if (e.status === 'ok' && (e.id && this.toolNames.has(e.id) ? this.toolNames.get(e.id)! : this.lastTool).startsWith('propose_')) {
          this.say('note', 'Queued for your approval on the Review page.');
          const m = /^Queued proposal (\S+) \((\w+)\)/.exec(e.text ?? '');
          if (m) this.say('proposal', m[2], m[1]);
        }
        break;
      case 'denied': this.say('note', `Not allowed: ${e.tool}`); break;
      case 'error': this.say('error', e.message); this.endTurn(); break;
      case 'done': this.costUsd += e.costUsd ?? 0; this.endTurn(); break;
      case 'start': break;
    }
    this.changed();
  }

  private endTurn() {
    this.busy = false; this.current = null;
    const next = this.queue.shift();
    if (next !== undefined) this.dispatch(next);
  }

  private changed() { this.onChange?.(); }
}
