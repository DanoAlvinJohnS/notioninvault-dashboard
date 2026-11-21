import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../src/agent/summary.ts';
import type { Proposal, ProposalKind } from '../src/agent/types.ts';

const P = (kind: ProposalKind, args: Record<string, any>, extra: Partial<Proposal> = {}): Proposal =>
  ({ id: 'p1', kind, agent: 'secretary', reason: 'because', created: 0, status: 'pending', args, ...extra });

test('title for each kind', () => {
  assert.equal(summarize(P('task', { title: 'buy index cards', due: '2026-11-29' })).title, 'New task: buy index cards · due 2026-11-29');
  assert.equal(summarize(P('task', { title: 'buy index cards' })).title, 'New task: buy index cards');
  assert.equal(summarize(P('task_update', { path: 'Tasks/Print.md' })).title, 'Update task: Print');
  assert.equal(summarize(P('edit', { path: 'Notes/Chess.md' })).title, 'Rewrite note: Chess');
  assert.equal(summarize(P('link', { from: 'Notes/A.md', to: 'B' })).title, 'Link: A → B');
  assert.equal(summarize(P('move', { path: 'a.md', new_path: 'Notes/a.md' })).title, 'Move: a.md → Notes/a.md');
  assert.equal(summarize(P('rename', { path: 'Notes/Old.md', new_path: 'Notes/New.md' })).title, 'Rename: Old → New');
  assert.equal(summarize(P('delete', { path: 'x.md' })).title, 'Trash: x.md');
  assert.equal(summarize(P('create_note', { path: 'Notes/n.md' })).title, 'New note: Notes/n.md');
});

test('detail is the agent reason', () => {
  assert.equal(summarize(P('delete', { path: 'x.md' })).detail, 'because');
});

test('card state follows the queue', () => {
  const s = (status: Proposal['status'], error?: string) => { const r = summarize(P('delete', { path: 'x.md' }, { status, error })); return [r.final, r.state]; };
  assert.deepEqual(s('pending'), [false, 'Waiting']);
  assert.deepEqual(s('approved'), [true, 'Approved']);
  assert.deepEqual(s('rejected'), [true, 'Rejected']);
  assert.deepEqual(s('stale', 'file changed'), [true, 'Stale: file changed']);
  assert.deepEqual(s('failed', 'boom'), [true, 'Failed: boom']);
});
