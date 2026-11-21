// The compact vault map agents read first: one short line per note, so a whole vault costs a few thousand tokens.
import type { MapNote, MapFile } from './types.ts';

const SKIP_TOP = new Set(['graphify-out', 'system']);
export const EXCERPT = 80;

/** Paths no agent tool may see: dot-folders (.obsidian, .smart-env, .claude…), build output, the old backend, the wallpaper.
    Case-insensitive, because Windows treats "system/x.md" and "System/x.md" as the same place. */
export function isExcluded(path: string): boolean {
  const parts = path.replace(/\\/g, '/').toLowerCase().split('/');
  if (parts.some(p => p.startsWith('.') || p === 'node_modules')) return true;
  if (SKIP_TOP.has(parts[0])) return true;
  return /^db_background\./.test(parts[parts.length - 1]);
}

/** A safe vault-relative path, or an "Invalid path" error: no absolute paths, no "..", nothing excluded. */
export function validatePath(p: string): string {
  const s = String(p ?? '').trim().replace(/\\/g, '/');
  const bad = !s || s.startsWith('/') || /^[a-zA-Z]:/.test(s) || s.split('/').some(x => x === '..' || x === '.' || x === '') || isExcluded(s);
  if (bad) throw new Error(`Invalid path: ${p}`);
  return s;
}

export function mapLine(n: MapNote): string {
  const task = !!n.type;
  return [n.path, n.type, task ? n.status : '', n.due, `links:${n.links.length}`, n.excerpt.slice(0, EXCERPT)].join(' | ');
}

const under = (path: string, folder?: string) => !folder || path.startsWith(folder.replace(/\/+$/, '') + '/');

export function formatMap(notes: MapNote[], files: MapFile[], folder?: string): string {
  const ns = notes.filter(n => !isExcluded(n.path) && under(n.path, folder)).sort((a, b) => a.path.localeCompare(b.path));
  const fs = files.filter(f => !isExcluded(f.path) && under(f.path, folder)).sort((a, b) => a.path.localeCompare(b.path));
  return [`# notes (${ns.length})`, ...ns.map(mapLine), `# other files (${fs.length})`,
    ...fs.map(f => `${f.path} | ${f.ext} | ${Math.max(1, Math.round(f.size / 1024))} KB`)].join('\n');
}

/** About `width` characters of `text` around the first match of `query` (case-insensitive), with … where it was cut. */
export function snippetAround(text: string, query: string, width = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= width) return flat;
  const at = flat.toLowerCase().indexOf(query.toLowerCase());
  const start = Math.max(0, Math.min(at < 0 ? 0 : at - Math.floor((width - query.length) / 2), flat.length - width));
  return (start > 0 ? '…' : '') + flat.slice(start, start + width) + (start + width < flat.length ? '…' : '');
}
