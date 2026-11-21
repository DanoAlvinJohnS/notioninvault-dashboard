// Same call shapes as the Python dashboard, but answered by VaultService (src/service.ts).
let svc = null;
export const setService = s => { svc = s; };
/** Agent proposals (desktop only: the queue is created when the vault agents start). */
const queue = () => { if (!svc.queue) throw new Error('AI agents are off. Turn on "Enable AI agents" in the plugin settings.'); return svc.queue; };

export async function api(url, body) {
  const [path, qs] = url.split('?');
  switch (path) {
    case '/api/version': return svc.version();
    case '/api/index': return svc.index();
    case '/api/note': return svc.note(new URLSearchParams(qs).get('path'));
    case '/api/tasks': return svc.createTask(body);
    case '/api/tasks/reorder': await svc.reorder(body.columns); return { ok: true };
    case '/api/layout': return body ? svc.saveLayout(body.layout) : svc.getLayout();
    case '/api/tasks/update': await svc.update(body); return { ok: true };
    case '/api/proposals': return queue().list();
    case '/api/proposals/approve': return queue().approve(body.id);
    case '/api/proposals/approve-all': return queue().approveAll();
    case '/api/proposals/reject': await queue().reject(body.id, body.note); return { ok: true };
    case '/api/proposals/edit': return queue().editArgs(body.id, body.patch);
    default: throw new Error('Unknown endpoint ' + url);
  }
}

/* Wallpaper: direct vault access instead of HTTP. */
export const getBackground = async () => (await svc.getBackground()).background;
export const setBackground = async file => svc.setBackground(file.name, await file.arrayBuffer());
export const removeBackground = () => svc.removeBackground();
export const previewTheme = t => svc.previewTheme(t);
export const getCanvas = () => svc.getCanvas();
export const refreshCanvas = () => svc.refreshCanvas();
export const droppedFile = hint => svc.dropped(hint);
/** Claude page: pick a note, a folder or the whole vault; resolves { name, data, count, skipped } or null when dismissed. */
export const pickForClaude = () => svc.pickForClaude();
