// In-memory VaultPort for tests: files live in a Map; calls are recorded.
import type { VaultPort, MapNote } from '../src/agent/types.ts';

export function fakePort(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const calls: { fn: string; args: any }[] = [];
  const fm = (t: string) => t.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  const port: VaultPort & { store: Map<string, string>; calls: typeof calls } = {
    store, calls,
    async notes() {
      return [...store.keys()].filter(p => p.endsWith('.md')).map((p): MapNote => {
        const f = fm(store.get(p)!), get = (k: string) => f.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1] ?? '';
        return { path: p, title: p.replace(/^.*\/|\.md$/g, ''), folder: p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '', type: get('type'), status: get('status'), due: get('due'), links: [], deg: 0, excerpt: '', tags: [], mtime: 0 };
      });
    },
    async files() { return [...store.keys()].filter(p => !p.endsWith('.md')).map(p => ({ path: p, ext: p.split('.').pop()!, size: store.get(p)!.length, mtime: 0 })); },
    async edges() { return []; },
    async read(p) { if (!store.has(p)) throw new Error('No such file: ' + p); return store.get(p)!; },
    exists(p) { return store.has(p); },
    async canvas() { return []; },
    async createTask(t) { calls.push({ fn: 'createTask', args: t }); const p = `Tasks/${t.title}.md`; store.set(p, `---\ntype: task\nstatus: ${t.status ?? 'todo'}\n${t.due ? `due: ${t.due}\n` : ''}${t.canvas_id ? `canvas_id: ${t.canvas_id}\n` : ''}---\n\n# ${t.title}\n`); return { path: p }; },
    async updateTask(u) { calls.push({ fn: 'updateTask', args: u }); },
    async writeBody(p, body) { calls.push({ fn: 'writeBody', args: { p, body } }); const t = store.get(p)!, head = t.match(/^---\n[\s\S]*?\n---\n?/)?.[0] ?? ''; store.set(p, head + body); },
    async write(p, text) { calls.push({ fn: 'write', args: { p } }); store.set(p, text); },
    async create(p, text) { calls.push({ fn: 'create', args: { p } }); if (store.has(p)) throw new Error('exists'); store.set(p, text); },
    async rename(p, np) { calls.push({ fn: 'rename', args: { p, np } }); store.set(np, store.get(p)!); store.delete(p); },
    async trash(p) { calls.push({ fn: 'trash', args: { p } }); store.delete(p); },
  };
  return port;
}
