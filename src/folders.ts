// Port of backend/folders.py. Pure logic, no Obsidian imports, so it can be tested anywhere.
export interface Note {
  path: string; title: string; folder: string; mtime: number; type: string; status: string;
  due: string; order: number; excerpt: string; links: string[]; deg: number;
}
export type Edge = [string, string];

const ancestors = (folder: string): string[] => {
  if (!folder) return [''];
  const p = folder.split('/');
  return p.map((_, i) => p.slice(0, i + 1).join('/'));
};

const WIKI = /\[\[([^\]|#]+)[^\]]*\]\]/g;
export function excerptOf(text: string, n = 160): string {
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (s && !/^(#|---|\||Related:)/.test(s)) return s.replace(WIKI, '$1').slice(0, n);
  }
  return '';
}

interface F { id: string; name: string; parent: string | null; count: number; deg: number; subs: Set<string>; notes: Note[]; open: number; mtime: number }

export function buildFolders(notes: Note[], edges: Edge[]) {
  const by = new Map(notes.map(n => [n.path, n]));
  const F = new Map<string, F>(), anc = new Map<string, Set<string>>();
  const get = (id: string): F => {
    let f = F.get(id);
    if (!f) {
      const cut = id.lastIndexOf('/');
      f = { id, name: id ? id.slice(cut + 1) : '(root)', parent: id.includes('/') ? id.slice(0, cut) : null, count: 0, deg: 0, subs: new Set(), notes: [], open: 0, mtime: 0 };
      F.set(id, f);
    }
    return f;
  };
  for (const n of notes) {
    const a = ancestors(n.folder);
    anc.set(n.path, new Set(a));
    for (const id of a) {
      const f = get(id);
      f.count++; f.deg += n.deg; f.notes.push(n); f.mtime = Math.max(f.mtime, n.mtime);
      if (n.type === 'task' && n.status !== 'done') f.open++;
      if (f.parent !== null) F.get(f.parent)!.subs.add(id);
    }
  }
  const to = new Map<string, Map<string, number>>(), from = new Map<string, Map<string, number>>();
  const bump = (m: Map<string, Map<string, number>>, fid: string, p: string) => {
    let c = m.get(fid); if (!c) m.set(fid, c = new Map());
    c.set(p, (c.get(p) ?? 0) + 1);
  };
  for (const [a, b] of edges) {
    const sa = anc.get(a)!, sb = anc.get(b)!;
    for (const fid of sa) if (!sb.has(fid)) bump(to, fid, b);
    for (const fid of sb) if (!sa.has(fid)) bump(from, fid, a);
  }
  const refs = (m?: Map<string, number>) =>
    [...(m ?? [])].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([p, c]) => ({ path: p, title: by.get(p)!.title, n: c }));

  const out = [];
  for (const f of F.values()) {
    const byTitle = (a: Note, b: Note) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);   // ties: alphabetical, like the Python version
    const hub = [...f.notes].sort((a, b) => b.deg - a.deg || byTitle(a, b))[0];
    const recent = [...f.notes].sort((a, b) => b.mtime - a.mtime || byTitle(a, b)).slice(0, 3);
    const c = f.count, s = f.subs.size;
    const bits = [`${c} note${c !== 1 ? 's' : ''}` + (s ? ` across ${s} subfolder${s !== 1 ? 's' : ''}` : '')];
    if (hub.deg) bits.push(`Most connected: ${hub.title} (${hub.deg} links)`);
    if (f.open) bits.push(`${f.open} open task${f.open !== 1 ? 's' : ''}`);
    bits.push('Last edited ' + new Date(f.mtime * 1000).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }));
    out.push({
      id: f.id, name: f.name, parent: f.parent,
      located: f.parent ? f.parent.split('/').join(' / ') : 'Vault root',
      count: c, deg: f.deg, open: f.open, subs: [...f.subs].sort(),
      hub: { path: hub.path, title: hub.title, deg: hub.deg },
      recent: recent.map(r => ({ title: r.title, path: r.path })),
      links_to: refs(to.get(f.id)), linked_from: refs(from.get(f.id)),
      summary: bits.join('. ') + '.',
    });
  }
  return out.sort((a, b) => b.deg - a.deg);
}
