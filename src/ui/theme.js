import { themeRoot } from './util.js';

/* The whole theme is one flat object. '' means "automatic" (use the built-in or Obsidian value). */
export const DEFAULT_THEME = {
  // wallpaper and glass
  dim: 35, bgBlur: 0, glass: 10, blur: 22, sat: 140, bord: 16, rad: 14, tint: '#fff6ec', bc: '#fff5eb',
  // colours
  text: '', muted: '', head: '', accent: '', accent2: '', good: '', bad: '', canvas: '',
  // surfaces: page background, cards, sidebar ('' = automatic). Used by the solid styles and by glass when there is no wallpaper.
  bg: '', panel: '', rail: '',
  // look: the style changes shapes and structure; anim is how much things move
  style: 'glass', anim: 'subtle', nav: '',   // nav: '' = the style's own, 'subtle' or 'pill' for the active sidebar item
  // fonts and letters
  fontHead: '', fontBody: '', size: 15, hw: '', ls: 0,
  // colour effect: off | shift (main colour breathes lighter/darker) | gradient | flow (moving gradient)
  fx: 'off', fxTo: '', fxAmt: 30, fxSpeed: 10, fxAngle: 115,
  // motion: how far the wallpaper follows the scroll (0 = fixed), and inertia for scrolling the page
  bgMove: 40, inertia: 'off', inertiaAmt: 50,
  // motion: 'always' keeps every effect running even when the OS asks for reduced motion; 'system' follows the OS
  motion: 'always',
  // Obsidian-wide (plugin only) and power-user CSS
  global: false, scope: 'chrome', css: '',
};
const NUMBERS = ['dim', 'bgBlur', 'glass', 'blur', 'sat', 'bord', 'rad', 'size', 'ls', 'fxAmt', 'fxSpeed', 'fxAngle', 'bgMove', 'inertiaAmt'];
const LIMITS = { fxAmt: [10, 50], fxSpeed: [2, 60], fxAngle: [0, 360], bgMove: [0, 100], inertiaAmt: [10, 100] };
const COLORS = ['tint', 'bc', 'text', 'muted', 'head', 'accent', 'accent2', 'good', 'bad', 'canvas', 'bg', 'panel', 'rail', 'fxTo'];
export const STYLES = [['glass', 'Glass'], ['soft', 'Soft light'], ['mono', 'Mono'], ['tech', 'Techy']];
export const NAVS = [['', 'Auto'], ['subtle', 'Subtle'], ['pill', 'Accent pill']];
export const ANIMS = [['off', 'Off'], ['subtle', 'Subtle'], ['lively', 'Lively']];
export const FXS = [['off', 'Disabled'], ['shift', 'Change color'], ['gradient', 'Gradient'], ['flow', 'Moving gradient']];
export const INERTIAS = [['off', 'Off'], ['smooth', 'Smooth'], ['lively', 'Lively']];
export const MOTIONS = [['always', 'Always animate'], ['system', 'Follow system setting']];
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
export const COLOR_KEYS = COLORS;

export function resolveTheme(saved) {
  const t = { ...DEFAULT_THEME };
  for (const k of Object.keys(t)) {
    const v = saved?.[k];
    if (v === undefined || v === null) continue;
    if (NUMBERS.includes(k)) { if (Number.isFinite(Number(v))) { const [lo, hi] = LIMITS[k] || [-Infinity, Infinity]; t[k] = Math.min(hi, Math.max(lo, Number(v))); } }
    else if (COLORS.includes(k)) { if (v === '' || HEX.test(v)) t[k] = v; }
    else if (k === 'global') t[k] = !!v;
    else if (k === 'style') t[k] = STYLES.some(([s]) => s === v) ? v : 'glass';
    else if (k === 'anim') t[k] = ANIMS.some(([s]) => s === v) ? v : 'subtle';
    else if (k === 'fx') t[k] = FXS.some(([s]) => s === v) ? v : 'off';
    else if (k === 'motion') t[k] = v === 'system' ? 'system' : 'always';
    else if (k === 'inertia') t[k] = INERTIAS.some(([s]) => s === v) ? v : 'off';
    else if (k === 'nav') t[k] = NAVS.some(([s]) => s === v) ? v : '';
    else if (k === 'scope') t[k] = v === 'all' ? 'all' : 'chrome';
    else if (k === 'css') t[k] = String(v).slice(0, 20000);
    else if (k === 'hw') t[k] = ['400', '500', '600', '700', '800'].includes(String(v)) ? String(v) : '';
    else t[k] = String(v).slice(0, 120);
  }
  return t;
}

const hexRgb = h => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const rgbStr = h => hexRgb(h).join(',');
const lum = h => { const [r, g, b] = hexRgb(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
const onColor = h => (lum(h) > .45 ? '#16140a' : '#ffffff');
const stack = f => (!f ? '' : f.includes(',') || /^(system-ui|serif|sans-serif|monospace)$/i.test(f.trim()) ? f : `"${f.replace(/"/g, '')}", system-ui, sans-serif`);

export const THEME_VARS = ['--glass-a', '--glass-blur', '--glass-dim', '--glass-sat', '--bg-blur', '--bord-a', '--bord', '--tint', '--rad', '--fs', '--ls', '--hw', '--text', '--muted', '--hc',
  '--y-b', '--o-b', '--g-b', '--r-b', '--c-b', '--on-y', '--on-o', '--on-g', '--on-c', '--body', '--head',
  '--fx-amt', '--fx-k', '--fx-dur', '--fx-tint', '--fx-ang', '--fx-2',
  '--bg-c', '--panel-c', '--panel2-c', '--line-c', '--rail', '--on-rail'];

/** CSS custom properties for the dashboard. Unset values are omitted so the stylesheet defaults apply. */
export function themeVars(t) {
  const v = {
    '--glass-a': t.glass / 100, '--glass-blur': t.blur + 'px', '--glass-dim': t.dim / 100, '--glass-sat': t.sat + '%', '--bg-blur': t.bgBlur + 'px',
    '--bord-a': t.bord / 100, '--bord': rgbStr(t.bc), '--tint': rgbStr(t.tint), '--rad': t.rad + 'px', '--fs': t.size / 15,
  };
  if (t.ls) v['--ls'] = t.ls / 100 + 'em';
  if (t.hw) v['--hw'] = t.hw;
  if (t.text) { v['--text'] = t.text; if (!t.muted) v['--muted'] = `color-mix(in srgb, ${t.text} 62%, transparent)`; }
  if (t.muted) v['--muted'] = t.muted;
  if (t.head) v['--hc'] = t.head;
  // accents set the BASE colour; the stylesheet derives the live colour (--y, --o ...) from it, which is what the colour effects animate
  for (const [k, c, on] of [['accent', '--y-b', '--on-y'], ['accent2', '--o-b', '--on-o'], ['good', '--g-b', '--on-g'], ['bad', '--r-b', null], ['canvas', '--c-b', '--on-c']])
    if (t[k]) { v[c] = t[k]; if (on) v[on] = onColor(t[k]); }
  // colour effect: how far to move towards the second colour (or white), cycle length, angle
  v['--fx-amt'] = t.fxAmt; v['--fx-k'] = t.fxTo ? Math.min(100, t.fxAmt * 2) : t.fxAmt;
  v['--fx-dur'] = t.fxSpeed; v['--fx-tint'] = t.fxTo || '#ffffff'; v['--fx-ang'] = t.fxAngle + 'deg';
  if (t.fxTo) v['--fx-2'] = t.fxTo;   // the second colour of the page-wide gradient (otherwise the stylesheet uses Accent 2)
  // surfaces go through *-c variables: the stylesheet uses them unless a wallpaper's glass is showing
  const ink = t.text || 'var(--text)';
  if (t.bg) v['--bg-c'] = t.bg;
  if (t.panel) { v['--panel-c'] = t.panel; v['--panel2-c'] = `color-mix(in srgb, ${ink} 7%, ${t.panel})`; }
  if (t.bg || t.panel) v['--line-c'] = `color-mix(in srgb, ${ink} 14%, transparent)`;
  if (t.rail) { v['--rail'] = t.rail; v['--on-rail'] = onColor(t.rail); }
  if (t.fontBody) v['--body'] = stack(t.fontBody);
  if (t.fontHead) v['--head'] = stack(t.fontHead);
  return v;
}

/** Variables for the Obsidian-wide mode. They are read by the `body.vd-global` rules in the plugin's stylesheet. */
export function globalVars(t, hasBg) {
  const a = t.glass / 100, tint = rgbStr(t.tint), side = hasBg ? `rgba(${tint},${a})` : 'var(--background-secondary)';
  const text = t.text || (hasBg ? '#f6efe6' : 'var(--text-normal)');
  const muted = t.muted || (t.text ? `color-mix(in srgb, ${t.text} 62%, transparent)` : hasBg ? 'rgba(246,239,230,.62)' : 'var(--text-muted)');
  const body = t.fontBody ? stack(t.fontBody) : 'var(--font-interface)';
  return {
    '--vd-pane': hasBg ? (t.scope === 'all' ? side : 'rgba(18,12,8,.80)') : 'var(--background-primary)',
    '--vd-editor': hasBg ? (t.scope === 'all' ? side : 'rgba(18,12,8,.80)') : 'var(--background-primary)',
    '--vd-side': side,
    '--vd-side-alt': hasBg ? `rgba(${tint},${a + .06})` : 'var(--background-secondary-alt)',
    '--vd-line': hasBg ? `rgba(${rgbStr(t.bc)},${t.bord / 100})` : 'var(--background-modifier-border)',
    '--vd-text': text, '--vd-muted': muted, '--vd-faint': `color-mix(in srgb, ${t.text || (hasBg ? '#f6efe6' : 'currentColor')} 38%, transparent)`,
    '--vd-accent': t.accent || 'var(--interactive-accent)', '--vd-on-accent': t.accent ? onColor(t.accent) : 'var(--text-on-accent)',
    '--vd-body': body, '--vd-text-font': t.fontBody ? stack(t.fontBody) : 'var(--font-text)', '--vd-head': t.fontHead ? stack(t.fontHead) : 'inherit',
    '--vd-ls': t.ls ? t.ls / 100 + 'em' : 'normal',
    '--glass-blur': t.blur + 'px', '--glass-sat': t.sat + '%', '--glass-dim': t.dim / 100, '--bg-blur': t.bgBlur + 'px', '--vd-rad': t.rad + 'px',
  };
}
export const GLOBAL_VARS = Object.keys(globalVars(DEFAULT_THEME, true));

/** Scopes power-user CSS to the dashboard unless the theme is applied to all of Obsidian. */
export function applyExtraCss(t, scope) {
  let el = document.getElementById('vd-extra-css');
  if (!t.css.trim()) { el?.remove(); return; }
  if (!el) { el = document.createElement('style'); el.id = 'vd-extra-css'; document.head.appendChild(el); }
  el.textContent = scope ? `${scope}{\n${t.css}\n}` : t.css;
}

const listeners = new Set();
/** Lets other modules (scroll effects) react whenever the theme is applied. Returns an unsubscribe function. */
export const onThemeApplied = f => { listeners.add(f); return () => listeners.delete(f); };

export function applyTheme(t, root = themeRoot()) {
  root.dataset.style = t.style; root.dataset.anim = t.anim; root.dataset.nav = t.nav; root.dataset.fx = t.fx; root.dataset.motion = t.motion;
  const vars = themeVars(t);
  for (const k of THEME_VARS) { if (k in vars) root.style.setProperty(k, String(vars[k])); else root.style.removeProperty(k); }
  applyExtraCss(t, t.global ? '' : root === document.body ? 'body' : '.vd-root');
  listeners.forEach(f => f(t));
}
export function clearTheme(root = themeRoot()) {
  THEME_VARS.forEach(k => root.style.removeProperty(k));
  delete root.dataset.style; delete root.dataset.anim; delete root.dataset.nav; delete root.dataset.fx; delete root.dataset.motion;
  document.getElementById('vd-extra-css')?.remove();
}

/* Starting points. Each is applied on top of the defaults. */
export const PRESETS = {
  'Warm glass': {},
  'Midnight': { tint: '#9fb4ff', bc: '#cfd8ff', text: '#eaf0ff', accent: '#7aa2ff', accent2: '#b58cff', dim: 45 },
  'Rose': { tint: '#ffd6e0', bc: '#ffe3ea', text: '#fff1f4', accent: '#ff8fab', accent2: '#ffc2d1', good: '#9be7b0' },
  'Forest': { tint: '#d9ffe3', bc: '#e4ffe9', text: '#eefaf0', accent: '#7fdc8a', accent2: '#c6e377', dim: 40 },
  'Light glass': { tint: '#ffffff', bc: '#000000', bord: 12, glass: 55, dim: 0, text: '#2b2118', accent: '#c9871a', accent2: '#2f7ad1', good: '#2e9e55', bad: '#d64545' },
  'Mono': { tint: '#ffffff', bc: '#ffffff', text: '#f2f2f2', accent: '#ffffff', accent2: '#cfcfcf', good: '#cfcfcf', bad: '#9a9a9a' },
  // full looks: style + surfaces + colours + shape
  'Forest glass': { style: 'glass', nav: 'pill', tint: '#d9ffe3', bc: '#e4ffe9', bg: '#08130d', panel: '#10241a', text: '#e8f5ec', accent: '#7ee8a2', accent2: '#4fd18b', good: '#7ee8a2', canvas: '#6fb7ff', glass: 12, blur: 24, dim: 45, rad: 18, bord: 14 },
  'Lime light': { style: 'soft', bc: '#000000', bg: '#e9ece0', panel: '#ffffff', rail: '#15170f', text: '#1b1e14', accent: '#d8f25a', accent2: '#9bb52a', good: '#2e9e55', bad: '#d64545', canvas: '#3b82f6', rad: 20, bord: 10, hw: '600' },
  'Terminal': { style: 'tech', bc: '#2cf5a0', bg: '#05080a', panel: '#0a1114', rail: '#05080a', text: '#c8f5e0', accent: '#2cf5a0', accent2: '#38bdf8', good: '#2cf5a0', bad: '#ff5c7a', canvas: '#38bdf8', rad: 3, bord: 22, hw: '600' },
  'Cyber': { style: 'tech', bc: '#b784ff', bg: '#0a0612', panel: '#120b1f', rail: '#0a0612', text: '#e6dcff', accent: '#ff3df2', accent2: '#22e5ff', good: '#3dffb0', bad: '#ff4d6d', canvas: '#22e5ff', rad: 3, bord: 24, hw: '600' },
  'Mono ink': { style: 'mono', bc: '#ffffff', bg: '#0b0b0c', panel: '#131315', text: '#ededee', accent: '#f4f4f5', accent2: '#a1a1aa', good: '#d4d4d8', bad: '#ff8a8a', canvas: '#93c5fd', rad: 12, bord: 14, hw: '500' },
};
