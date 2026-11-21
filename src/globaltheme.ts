// Applies the theme to all of Obsidian (opt-in). The CSS lives in global.css and is switched on by the classes set here.
import type { VaultService } from './service.ts';
import { applyExtraCss, GLOBAL_VARS, globalVars, resolveTheme } from './ui/theme.js';

export class GlobalTheme {
  svc: VaultService;
  constructor(svc: VaultService) { this.svc = svc; }

  /** Re-reads the saved theme: at startup and when the wallpaper file changes. */
  async refresh() { this.apply(resolveTheme((await this.svc.getLayout()).layout?.appearance)); }

  apply(theme: any) {
    if (!theme.global) { this.off(); return; }
    const body = document.body, bg = this.svc.getBackground().background;
    for (const [k, v] of Object.entries(globalVars(theme, !!bg))) body.style.setProperty(k, String(v));
    body.classList.add('vd-global');
    body.classList.toggle('vd-wall', !!bg);
    body.classList.toggle('vd-headfont', !!theme.fontHead);
    let layer = document.querySelector('.vd-gbg') as HTMLElement | null;
    if (!bg) layer?.remove();
    else {
      if (!layer) { layer = document.createElement('div'); layer.className = 'vd-gbg'; body.prepend(layer); }
      layer.style.backgroundImage = `url("${bg.url.replace(/"/g, '%22')}")`;
    }
    applyExtraCss(theme, '');
  }

  /** Puts Obsidian back exactly as it was. */
  off(removeCss = false) {
    const body = document.body;
    body.classList.remove('vd-global', 'vd-wall', 'vd-headfont');
    GLOBAL_VARS.forEach(k => body.style.removeProperty(k));
    document.querySelector('.vd-gbg')?.remove();
    if (removeCss || !document.querySelector('.vd-root')) document.getElementById('vd-extra-css')?.remove();   // the open dashboard manages its own scoped CSS
  }
}
