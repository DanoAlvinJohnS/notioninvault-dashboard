import { S } from './state.js';
import { today } from './util.js';

/* "Dues" = your personal tasks + Canvas assignments, in one shape. The page filter and each widget choose which to show. */
export const SCOPES = [['all', 'Overall'], ['personal', 'Personal'], ['canvas', 'Canvas']];

/** A widget's own `scope` option wins; "page" (the default) follows the filter at the top of the page. */
export const scopeOf = w => (w?.opts?.scope && w.opts.scope !== 'page' ? w.opts.scope : S.filter);

export function dues(scope = 'all') {
  const personal = scope === 'canvas' ? [] : S.data.tasks.map(t => ({ id: t.path, path: t.path, source: 'personal', title: t.title, due: t.due, status: t.status, links: t.links }));
  const canvas = scope === 'personal' ? [] : S.canvas.items;
  return [...personal, ...canvas];
}
export const withDue = list => list.filter(d => d.due);
export const isOpen = d => d.status !== 'done';
export const isOverdue = (d, td = today()) => isOpen(d) && !!d.due && d.due < td;

/** Top-level folder a personal task belongs to (through its first linked note), used by the Progress widget's "by project" grouping. */
export function projectOf(d) {
  const n = d.links?.length ? S.by[d.links[0]] : null;
  return n ? (n.folder.split('/')[0] || n.title) : 'Unassigned';
}
