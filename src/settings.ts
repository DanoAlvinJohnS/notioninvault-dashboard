import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type DashboardPlugin from './main';
import { ENGINE_DEFAULTS } from './agent/wire.ts';

export class DashboardSettings extends PluginSettingTab {
  plugin: DashboardPlugin;
  constructor(app: App, plugin: DashboardPlugin) { super(app, plugin); this.plugin = plugin; }

  // Builds the page right away (so it can never block), then fills the Canvas fields once the saved values are read.
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName('Theme editor')
      .setDesc('Wallpaper, glass, colors, fonts, color effects and motion are edited on the dashboard\'s Settings page: changes preview live and are kept when you press Apply changes. It also has the "Apply this theme to all of Obsidian" switch.')
      .addButton(b => b.setButtonText('Open theme editor').setCta().onClick(() => this.plugin.openThemeEditor()));

    new Setting(containerEl).setName('Canvas').setHeading();
    containerEl.createEl('p', { cls: 'setting-item-description', text: 'Read-only: shows your Canvas assignments and due dates in the dashboard. Create a token in Canvas under Account > Settings > "+ New Access Token". The token is saved in this plugin\'s data.json inside your vault, so keep that folder out of shared or synced places you do not trust.' });

    let url = '', token = '';
    let urlInput: HTMLInputElement | undefined, tokenInput: HTMLInputElement | undefined;
    new Setting(containerEl).setName('Canvas address').setDesc('For example https://myschool.instructure.com')
      .addText(t => { urlInput = t.inputEl; t.setPlaceholder('https://myschool.instructure.com').onChange(v => { url = v; }); });
    new Setting(containerEl).setName('Canvas API token (C_API_HERE)').setDesc('Paste your access token here.')
      .addText(t => { tokenInput = t.inputEl; t.inputEl.type = 'password'; t.setPlaceholder('C_API_HERE').onChange(v => { token = v; }); });

    // Load what was saved, once. Only fill a field the user has not started typing in.
    this.plugin.service.canvasRaw().then(c => {
      if (!url && urlInput && !urlInput.value) { url = c.url; urlInput.value = c.url; }
      if (!token && tokenInput && !tokenInput.value) { token = c.token; tokenInput.value = c.token; }
    }).catch(e => console.error('[vault-dashboard]', e));

    new Setting(containerEl).setName('Save and test connection')
      .addButton(b => b.setButtonText('Save and test').setCta().onClick(async () => {
        b.setDisabled(true).setButtonText('Testing…');
        try {
          await this.plugin.service.setCanvasConfig(url.trim(), token.trim());
          const r = await this.plugin.service.refreshCanvas();
          new Notice(!r.configured ? 'Fill in both the address and the token.' : r.error ? r.error : `Connected: ${r.items.length} assignments in ${r.courses.length} courses.`);
        } catch (e) { new Notice('Could not save: ' + (e as Error).message); }
        finally { b.setDisabled(false).setButtonText('Save and test'); }
      }));

    this.agentSettings(containerEl);

    new Setting(containerEl).setName('Turn off the Obsidian-wide theme')
      .setDesc('If anything looks wrong, this restores your normal Obsidian look immediately.')
      .addButton(b => b.setButtonText('Turn off').onClick(() => this.plugin.setGlobal(false)));
  }

  /** Vault agents: which engine runs agents that don't name one, and where the programs are. Keys are never stored here. */
  private agentSettings(el: HTMLElement) {
    new Setting(el).setName('AI agents').setHeading();
    const a = this.plugin.agents;
    new Setting(el).setName('Enable AI agents')
      .setDesc('Off by default. Turning this on starts a local tool server on 127.0.0.1, writes CLAUDE.md, .mcp.json, .claude/ and .gemini/ in your vault root, and lets you run Claude Code or Gemini CLI agents (and Spark). Turning it off stops all of that; the files already written stay. See the README for details.')
      .addToggle(t => t.setValue(!!a).onChange(async v => {
        t.setDisabled(true);
        try {
          await this.plugin.data.setTop('agentsEnabled', v);
          if (v) await this.plugin.enableAgents(); else await this.plugin.disableAgents();
        } catch (e) { new Notice('Could not change the AI agents setting: ' + (e as Error).message); }
        this.display();
      }));
    if (!a) return;
    el.createEl('p', { cls: 'setting-item-description', text: 'Agents use Claude Code (your Claude login) or Gemini CLI (the API key set up in Gemini CLI, e.g. GEMINI_API_KEY). This plugin never stores either. An agent file can choose with "engine: claude" or "engine: gemini".' });
    a.settings().then(s => {
      const d = ENGINE_DEFAULTS();
      new Setting(el).setName('Show Spark').setDesc('A small pixel helper in the bottom-right corner that opens a chat with your agents.')
        .addToggle(t => t.setValue(s.showSpark).onChange(async v => { await a.saveSettings({ showSpark: v }); await this.plugin.syncSpark(); }));
      new Setting(el).setName('Random comments').setDesc('Spark now and then says a line from "RANDOM WORDS.csv" in your vault. Only text inside double quotes counts: "content 1", "content 2". Commas inside the quotes are part of the line.')
        .addToggle(t => t.setValue(s.randomQuotes).onChange(async v => { await a.saveSettings({ randomQuotes: v }); this.plugin.quoteCfg.enabled = v; }));
      new Setting(el).setName('How often').setDesc('Spark never interrupts: no comments while you type, while the chat is open, or while it is asleep.')
        .addDropdown(dd => dd.addOption('often', 'Often (1–3 min)').addOption('normal', 'Normal (3–7 min)').addOption('rare', 'Rarely (10–20 min)')
          .setValue(s.quoteEvery).onChange(async v => { await a.saveSettings({ quoteEvery: v as 'often' | 'normal' | 'rare' }); this.plugin.quoteCfg.every = v as 'often' | 'normal' | 'rare'; }));
      new Setting(el).setName('Default engine').setDesc('Used by agents whose file does not name an engine.')
        .addDropdown(dd => dd.addOption('claude', 'Claude Code').addOption('gemini', 'Gemini CLI').setValue(s.defaultEngine).onChange(v => a.saveSettings({ defaultEngine: v as 'claude' | 'gemini' })));
      new Setting(el).setName('Gemini model').setDesc('For Gemini agents without "gemini_model" in their file.')
        .addText(t => t.setPlaceholder(d.geminiModel).setValue(s.geminiModel).onChange(v => a.saveSettings({ geminiModel: v.trim() || d.geminiModel })));
      new Setting(el).setName('Claude Code path')
        .addText(t => t.setPlaceholder(d.claudePath).setValue(s.claudePath === d.claudePath ? '' : s.claudePath).onChange(v => a.saveSettings({ claudePath: v.trim() || d.claudePath })));
      new Setting(el).setName('Gemini CLI script').setDesc('The gemini.js file of the installed @google/gemini-cli package.')
        .addText(t => t.setPlaceholder(d.geminiScript).setValue(s.geminiScript === d.geminiScript ? '' : s.geminiScript).onChange(v => a.saveSettings({ geminiScript: v.trim() || d.geminiScript })));
    }).catch(e => console.error('[vault-dashboard]', e));
  }
}
