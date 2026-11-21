import { S, hooks } from './state.js';
import { getCanvas, refreshCanvas } from './api.js';

let timer, quick;
const key = c => `${c.configured}|${c.fetchedAt}|${c.error}|${c.items.length}|${c.refreshing}`;

/** Loads Canvas data (quick when cached; the server refreshes in the background when stale). */
export async function loadCanvas(force = false) {
  try {
    const c = await (force ? refreshCanvas() : getCanvas());
    const changed = !S.canvas.loaded || key(c) !== key(S.canvas);
    S.canvas = { ...c, loaded: true };
    if (changed) hooks.canvasChanged?.();
    if (c.refreshing) { clearTimeout(quick); quick = setTimeout(() => loadCanvas(), 3000); }   // pick up the result of a background refresh soon
  } catch (e) {
    S.canvas = { ...S.canvas, loaded: true, error: String(e.message || e) };
    hooks.canvasChanged?.();
  }
}
export function startCanvas() {
  loadCanvas();
  clearInterval(timer);
  timer = setInterval(() => { if (!document.hidden) loadCanvas(); }, 30000);
}
export function stopCanvas() { clearInterval(timer); clearTimeout(quick); }
