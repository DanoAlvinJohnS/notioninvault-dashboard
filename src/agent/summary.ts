// One-line text for a proposal card in the chat. Pure.
import type { Proposal } from './types.ts';

const file = (p: unknown) => String(p ?? '').split('/').pop()!.replace(/\.md$/i, '');

export function summarize(p: Proposal): { title: string; detail: string; final: boolean; state: string } {
  const a = p.args;
  let title: string;
  switch (p.kind) {
    case 'task': title = `New task: ${a.title ?? ''}${a.due ? ` · due ${a.due}` : ''}`; break;
    case 'task_update': title = `Update task: ${file(a.path)}`; break;
    case 'edit': title = `Rewrite note: ${file(a.path)}`; break;
    case 'link': title = `Link: ${file(a.from)} → ${a.to ?? ''}`; break;
    case 'move': title = `Move: ${a.path} → ${a.new_path}`; break;
    case 'rename': title = `Rename: ${file(a.path)} → ${file(a.new_path)}`; break;
    case 'delete': title = `Trash: ${a.path}`; break;
    case 'create_note': title = `New note: ${a.path}`; break;
    default: title = String(p.kind);
  }
  const state = p.status === 'pending' ? 'Waiting'
    : p.status === 'approved' ? 'Approved'
    : p.status === 'rejected' ? 'Rejected'
    : p.status === 'stale' ? `Stale: ${p.error ?? ''}`
    : `Failed: ${p.error ?? ''}`;
  return { title, detail: p.reason, final: p.status !== 'pending', state };
}
