import { api, previewTheme } from './api.js';
import { DEFAULT_THEME, resolveTheme } from './theme.js';
import { S } from './state.js';

export const GRID = { cols: 12, row: 64, gap: 14 };   // geometry shared by the CSS grid and the resize handle
const uid = () => Math.random().toString(36).slice(2, 8);

export const DEFAULT = () => [
  { type: 'stats', w: 12, h: 2 },
  { type: 'calendar', w: 8, h: 9 },
  { type: 'due', w: 4, h: 4, opts: { limit: '6' } },
  { type: 'chart', w: 4, h: 5, opts: { source: 'connected', type: 'hbar' } },
  { type: 'progress', w: 6, h: 7, opts: { scope: 'page', group: 'source', type: 'bars' } },
  { type: 'graph', w: 6, h: 7 },
  { type: 'board', w: 12, h: 8 },
  { type: 'folders', w: 12, h: 5 },
].map(w => ({ id: uid(), opts: {}, ...w }));

let widgets = null, timer = null;
/* The theme has two copies. `theme` is what is on screen (a live preview while you edit Settings); `applied` is what has been
   saved. Changes only reach disk when "Apply changes" is pressed, and "Revert" (or leaving Settings) goes back to `applied`. */
let theme = { ...DEFAULT_THEME }, applied = { ...DEFAULT_THEME };
export const getTheme = () => theme;
export const isDirty = () => JSON.stringify(theme) !== JSON.stringify(applied);
/** Live preview only: nothing is saved yet. */
export function setTheme(patch) { theme = resolveTheme({ ...theme, ...patch }); previewTheme(theme); return theme; }
/** "Apply changes": the preview becomes the saved theme, written to disk right now. */
export async function commitTheme() {
  const before = applied; applied = { ...theme };
  try { await flushSave(); } catch (e) { applied = before; throw e; }   // not saved: it stays an unapplied change
  return theme;
}
/** "Revert": back to the last applied theme. */
export function revertTheme() { theme = { ...applied }; previewTheme(theme); return theme; }
export function adoptTheme(t) { theme = resolveTheme(t); applied = { ...theme }; }   // the plugin changed the theme from outside the dashboard
export function resetTheme() { theme = { ...DEFAULT_THEME, global: theme.global, motion: theme.motion }; previewTheme(theme); return theme; }   // a preview too: Apply keeps it
export const getWidgets = () => widgets;

const clamp = (n, a, b) => Math.min(b, Math.max(a, Math.round(Number(n) || a)));

/** Reads the saved layout; unknown widget types are dropped and sizes are clamped to each widget's limits. */
export async function loadLayout(registry) {
  let saved = null;
  try { saved = (await api('/api/layout')).layout; } catch (e) { console.error('[vault-dashboard] layout not loaded', e); }
  theme = resolveTheme(saved?.appearance); applied = { ...theme };
  S.filter = ['all', 'personal', 'canvas'].includes(saved?.filter) ? saved.filter : 'all';
  widgets = Array.isArray(saved?.widgets)
    ? saved.widgets.filter(w => registry[w.type]).map(w => {
        const m = registry[w.type].min;
        return { id: String(w.id || uid()), type: w.type, w: clamp(w.w, m.w, GRID.cols), h: clamp(w.h, m.h, 40), opts: { ...(w.opts || {}) } };
      })
    : DEFAULT();
}

const write = () => api('/api/layout', { layout: { version: 1, widgets, appearance: applied, filter: S.filter } });   // always the applied theme, never a half-finished preview
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => write().catch(e => console.error('[vault-dashboard] layout not saved', e)), 400);
}
export async function flushSave() { clearTimeout(timer); await write(); }
export function setFilter(f) { S.filter = f; save(); }
export function addWidget(type, def) {
  const w = { id: uid(), type, w: def.w, h: def.h, opts: { ...(def.opts || {}) } };
  widgets.push(w); save(); return w;
}
export function removeWidget(id) { widgets = widgets.filter(w => w.id !== id); save(); }
export function updateWidget(id, patch) { const w = widgets.find(x => x.id === id); if (w) { Object.assign(w, patch); save(); } return w; }
export function reorder(ids) { const by = new Map(widgets.map(w => [w.id, w])); widgets = ids.map(i => by.get(i)).filter(Boolean); save(); }
export function resetLayout() { widgets = DEFAULT(); save(); }
