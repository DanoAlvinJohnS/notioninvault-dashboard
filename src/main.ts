import { Notice, Platform, Plugin, requestUrl } from 'obsidian';
import { startAgents } from './agent/wire.ts';
import type { Agents } from './agent/wire.ts';
import { sharedData } from './agent/datastore.ts';
import { shouldStartAgents } from './agent/enabled.ts';
import { DashboardView, VIEW } from './view';
import { AgentChatView, AGENTS_VIEW } from './agentview.ts';
import { createSpark, sparkHost } from './spark/spark.ts';
import { createPicker, parseQuotes, QUOTES_FILE, STARTER_CSV } from './spark/quotes.ts';
import type { QuoteEvery } from './spark/quotes.ts';
import { VaultService } from './service.ts';
import { GlobalTheme } from './globaltheme.ts';
import { DashboardSettings } from './settings.ts';
import { hooks } from './ui/state.js';

export default class DashboardPlugin extends Plugin {
  service!: VaultService;
  global!: GlobalTheme;
  agents?: Agents;
  spark = sparkHost();
  /** Random comments: the shuffled quotes from RANDOM WORDS.csv and the current settings (read synchronously by Spark). */
  quotes = createPicker();
  quoteCfg: { enabled: boolean; every: QuoteEvery } = { enabled: true, every: 'normal' };
  private unloaded = false;   // set in onunload so work still awaiting startup never mounts Spark afterwards
  data!: ReturnType<typeof sharedData>;

  async onload() {
    // (declared below)
    this.data = sharedData(() => this.loadData(), d => this.saveData(d));   // one lock for dashboard and agent writes to data.json
    this.service = new VaultService(this.app, 'Tasks', this.data.store);
    this.service.http = async (url, headers) => {
      const r = await requestUrl({ url, headers, throw: false });
      let json: any = []; try { json = r.json; } catch { /* not JSON: leave empty */ }
      return { status: r.status, json, headers: r.headers };
    };
    hooks.openCanvasSettings = () => this.openCanvasSettings();
    this.global = new GlobalTheme(this.service);
    this.service.onTheme = t => this.global.apply(t);
    this.addSettingTab(new DashboardSettings(this.app, this));
    this.app.workspace.onLayoutReady(() => this.global.refresh());
    this.registerView(VIEW, leaf => new DashboardView(leaf, this));
    this.addRibbonIcon('layout-dashboard', 'Open dashboard', () => this.openDashboard());
    this.addCommand({ id: 'open-dashboard', name: 'Open dashboard', callback: () => this.openDashboard() });
    this.addCommand({ id: 'open-theme-editor', name: 'Open theme editor', callback: () => this.openThemeEditor() });
    this.addCommand({ id: 'toggle-global-theme', name: 'Toggle Obsidian-wide theme', callback: async () => this.setGlobal(!(await this.service.getLayout()).layout?.appearance?.global) });

    // Any change in the vault bumps a counter; the dashboard notices it and refreshes.
    const bump = () => this.service.bump();
    let t: number | undefined;
    const wallpaper = (f: { name?: string }) => { if (f?.name?.startsWith('db_background')) { window.clearTimeout(t); t = window.setTimeout(() => this.global.refresh(), 400); } };
    this.registerEvent(this.app.metadataCache.on('changed', bump));
    this.registerEvent(this.app.metadataCache.on('resolved', bump));
    for (const ev of ['create', 'modify', 'delete', 'rename'] as const) this.registerEvent(this.app.vault.on(ev as any, (f: any) => { bump(); wallpaper(f); }));

    // Vault agents (Claude Code): local tool server + review queue. Desktop only; the dashboard works without it.
    this.addCommand({ id: 'open-review', name: 'Open review queue', callback: () => this.openReview() });
    this.registerView(AGENTS_VIEW, leaf => new AgentChatView(leaf, this));
    this.addRibbonIcon('bot', 'Open agent chat', () => this.openAgents());
    this.addCommand({ id: 'open-agents', name: 'Open agent chat', callback: () => this.openAgents() });
    // Opt-in: nothing starts (no server, no vault files, no Spark) until "Enable AI agents" is on.
    if (Platform.isDesktopApp) this.app.workspace.onLayoutReady(async () => {
      if (shouldStartAgents(await this.data.readAll())) await this.enableAgents();
    });
    // RANDOM WORDS.csv: re-read whenever it changes (another AI may be filling it)
    let qt = 0;
    const quotesChanged = (f: any) => { if (f?.path === QUOTES_FILE) { window.clearTimeout(qt); qt = window.setTimeout(() => { void this.loadQuotes(false); }, 300); } };
    for (const ev of ['create', 'modify', 'rename'] as const) this.registerEvent(this.app.vault.on(ev as any, quotesChanged));
    this.addCommand({ id: 'random-quote', name: 'Random Comments/Quote', callback: () => {
      if (this.spark.current()?.say?.()) return;
      const q = this.quotes.next();
      new Notice(q ?? `No comments yet. Add "quoted lines" to ${QUOTES_FILE} in your vault.`);
    } });
    this.addCommand({ id: 'toggle-spark', name: 'Toggle Spark', callback: async () => {
      const a = this.agents;
      if (!a) { new Notice('Spark needs the AI agents. Turn on "Enable AI agents" in the plugin settings.'); return; }
      await a.saveSettings({ showSpark: !(await a.settings()).showSpark });
      await this.syncSpark();
    } });
  }

  private starting?: Promise<void>;
  /** Starts the local tool server, writes the agent files, mounts Spark. Safe to call twice. */
  enableAgents(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.agents || this.unloaded) return Promise.resolve();
    const run = (async () => {
      try {
        const agents = await startAgents(this, this.service, this.data);
        if (this.unloaded) { void agents.stop(); return; }
        this.agents = agents;
        await this.loadQuotes();
        await this.syncSpark();
      } catch (e) { console.error('[vault-dashboard] agents', e); }
    })();
    this.starting = run;
    void run.then(() => { if (this.starting === run) this.starting = undefined; });
    return run;
  }

  /** Stops the server, Spark and every engine process; the dashboard keeps working. Files already written stay in the vault. */
  async disableAgents() {
    await this.starting;
    const a = this.agents;
    this.agents = undefined;
    this.service.queue = undefined;
    this.spark.unmount();
    this.stopChats();
    await a?.stop();
  }

  private stopChats() {
    for (const leaf of this.app.workspace.getLeavesOfType(AGENTS_VIEW)) (leaf.view as AgentChatView).chat?.stop();
  }

  /** Reads RANDOM WORDS.csv (creating it with a few examples the first time, only when random comments are on) into the shuffled picker. */
  async loadQuotes(create = true) {
    const adapter = this.app.vault.adapter;
    try {
      if (!this.agents) return;
      if (!(await adapter.exists(QUOTES_FILE))) { if (!create || !(await this.agents.settings()).randomQuotes) return; await adapter.write(QUOTES_FILE, STARTER_CSV); }
      this.quotes.set(parseQuotes(await adapter.read(QUOTES_FILE)));
    } catch (e) { console.error('[vault-dashboard] random comments', e); }
  }

  /** Mounts or removes Spark to match the Show Spark setting. Exactly one Spark exists at a time. */
  async syncSpark() {
    const a = this.agents;
    if (!a || !Platform.isDesktopApp || this.unloaded) return;
    const st = await a.settings();
    if (this.unloaded) return;
    this.quoteCfg = { enabled: st.randomQuotes, every: st.quoteEvery };
    if (st.showSpark) this.spark.mount(() => createSpark(document, {
      agents: a, openReview: () => { void this.openReview(); },
      initial: st.spark,
      saveSpark: spark => { void a.saveSettings({ spark }); },
      hide: () => { void a.saveSettings({ showSpark: false }).then(() => this.syncSpark()); },
      quotes: { next: () => this.quotes.next(), enabled: () => this.quoteCfg.enabled, every: () => this.quoteCfg.every },
    }));
    else this.spark.unmount();
  }

  /** The Agents chat lives in the right sidebar; reuse it if it is already open. */
  async openAgents() {
    const { workspace } = this.app, existing = workspace.getLeavesOfType(AGENTS_VIEW)[0];
    const leaf = existing ?? workspace.getRightLeaf(false);
    if (!leaf) return;
    if (!existing) await leaf.setViewState({ type: AGENTS_VIEW, active: true });
    workspace.revealLeaf(leaf);
  }

  async openReview() {
    await this.openDashboard();
    window.setTimeout(() => hooks.openReview?.(), 250);
  }

  openCanvasSettings() {
    const s = (this.app as any).setting;
    if (!s?.open) { new Notice('Open Settings > NotionInVault Dashboard to connect Canvas.'); return; }
    s.open();
    window.setTimeout(() => { try { s.openTabById?.(this.manifest.id); } catch (e) { console.error('[vault-dashboard]', e); } }, 0);
  }

  async openThemeEditor() {
    await this.openDashboard();
    window.setTimeout(() => hooks.openTheme?.(), 250);
  }
  /** Panic switch and toggle for the Obsidian-wide theme. */
  async setGlobal(on: boolean) {
    const theme = await this.service.patchTheme({ global: on });
    hooks.adoptTheme?.(theme);
  }

  onunload() {
    this.unloaded = true;
    this.global?.off(true);
    this.spark.unmount();   // stops its chat engine and removes the overlay
    this.stopChats();   // no engine process outlives the plugin
    void this.agents?.stop();
  }

  async openDashboard() {
    const { workspace } = this.app, existing = workspace.getLeavesOfType(VIEW)[0];
    if (existing) { workspace.revealLeaf(existing); return; }
    const leaf = workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW, active: true });
    workspace.revealLeaf(leaf);
  }
}
