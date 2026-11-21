import { ItemView, WorkspaceLeaf } from 'obsidian';
import type DashboardPlugin from './main';
import { mountApp } from './ui/app.js';

export const VIEW = 'vault-dashboard';

export class DashboardView extends ItemView {
  plugin: DashboardPlugin;
  stop?: () => void;

  constructor(leaf: WorkspaceLeaf, plugin: DashboardPlugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return VIEW; }
  getDisplayText() { return 'Dashboard'; }
  getIcon() { return 'layout-dashboard'; }

  async onOpen() { this.stop = mountApp(this.contentEl, this.plugin.service); }
  async onClose() { this.stop?.(); }
}
