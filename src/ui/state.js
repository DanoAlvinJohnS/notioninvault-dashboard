// Shared state + hooks (main.js fills the hooks, so modules never import each other in circles).
export const S = {
  data: null, by: {}, folders: {}, view: 'overview',
  filter: 'all',   // which dues to show: 'all' | 'personal' | 'canvas' (saved with the layout)
  canvas: { loaded: false, configured: false, items: [], courses: [], fetchedAt: 0, error: '', refreshing: false },
};
/** @type {Record<string, any>} */
export const hooks = {};
export function setData(d) {
  S.data = d;
  S.by = Object.fromEntries(d.notes.map(n => [n.path, n]));
  S.folders = Object.fromEntries(d.folders.map(f => [f.id, f]));
}
