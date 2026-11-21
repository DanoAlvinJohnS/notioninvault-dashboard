// "Things you didn't think were connected": notes that are not linked yet but share link targets, neighbours, tags or rare words.
import type { MapNote } from './types.ts';

export interface Related { path: string; score: number; why: string }

const WORD = /\p{L}{5,}/gu;
const words = (n: MapNote) => new Set((n.title + ' ' + n.excerpt).toLowerCase().match(WORD) ?? []);
const tagsOf = (n: MapNote) => new Set(n.tags.map(t => '#' + t.replace(/^#/, '').toLowerCase()));
const RARE = 3;   // a word counts when at most this many notes use it

export function relatedNotes(path: string, notes: MapNote[], edges: [string, string][], limit = 10): Related[] {
  const me = notes.find(n => n.path === path);
  if (!me) return [];
  const out = new Map<string, Set<string>>(), nb = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string, v: string) => { let s = m.get(k); if (!s) m.set(k, s = new Set()); s.add(v); };
  for (const n of notes) for (const l of n.links) add(out, n.path, l);
  for (const [a, b] of edges) { add(out, a, b); add(nb, a, b); add(nb, b, a); }
  const linked = new Set([path, ...(nb.get(path) ?? [])]);

  const vocab = new Map<string, Set<string>>();
  for (const n of notes) for (const w of words(n)) add(vocab, w, n.path);
  const myWords = [...words(me)].filter(w => (vocab.get(w)?.size ?? 0) <= RARE);
  const myOut = out.get(path) ?? new Set(), myNb = nb.get(path) ?? new Set(), myTags = tagsOf(me);
  const title = (p: string) => notes.find(n => n.path === p)?.title ?? p;

  const res: Related[] = [];
  for (const n of notes) {
    if (linked.has(n.path)) continue;
    const shared = [...(out.get(n.path) ?? [])].filter(t => myOut.has(t));
    const hops = [...(nb.get(n.path) ?? [])].filter(m => myNb.has(m) && !shared.includes(m));
    const tags = [...tagsOf(n)].filter(t => myTags.has(t));
    const common = myWords.filter(w => vocab.get(w)!.has(n.path));
    const parts: [number, string][] = [
      [3 * shared.length, `shares ${shared.length} link${shared.length > 1 ? 's' : ''}`],
      [2 * hops.length, `${hops.length} hop${hops.length > 1 ? 's' : ''} via ${hops.map(title)[0]}`],
      [2 * tags.length, `shared tag ${tags[0]}`],
      [common.length, `both mention "${common[0]}"`],
    ];
    const score = parts.reduce((s, [v]) => s + v, 0);
    if (!score) continue;
    res.push({ path: n.path, score, why: parts.filter(([v]) => v).sort((a, b) => b[0] - a[0])[0][1] });
  }
  return res.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
}
