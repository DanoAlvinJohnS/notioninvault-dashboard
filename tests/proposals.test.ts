import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProposalQueue, hash } from '../src/agent/proposals.ts';
import type { Proposal } from '../src/agent/types.ts';
import { fakePort } from './fakeport.ts';

function setup(files: Record<string, string> = {}) {
  const port = fakePort(files);
  let saved: Proposal[] = [], t = 1000;
  const q = new ProposalQueue(port, async () => saved, async p => { saved = structuredClone(p); }, () => t++);
  return { port, q, saved: () => saved };
}

test('hash is 8 hex chars and changes with content', () => {
  assert.match(hash('a'), /^[0-9a-f]{8}$/);
  assert.notEqual(hash('a'), hash('b'));
});

test('add then approve task creates task', async () => {
  const { port, q } = setup();
  const p = await q.add('task', 'secretary', 'Chess on the 27th', { title: 'Buy chess clocks', due: '2026-11-26' });
  assert.equal(p.status, 'pending');
  assert.equal(port.calls.length, 0, 'nothing written before approval');
  const done = await q.approve(p.id);
  assert.equal(done.status, 'approved');
  assert.equal(port.calls[0].fn, 'createTask');
  assert.equal(port.calls[0].args.due, '2026-11-26');
});

test('approve marks edit stale when file changed', async () => {
  const { port, q } = setup({ 'Notes/M.md': '# M\n\nold' });
  const p = await q.add('edit', 'secretary', 'tidy', { path: 'Notes/M.md', new_body: '# M\n\nnew' });
  port.store.set('Notes/M.md', '# M\n\nold, edited by hand');
  const r = await q.approve(p.id);
  assert.equal(r.status, 'stale');
  assert.equal(port.store.get('Notes/M.md'), '# M\n\nold, edited by hand');
});

test('approve applies edit when file unchanged', async () => {
  const { port, q } = setup({ 'M.md': '---\ntype: note\n---\n# M\n\nold' });
  const p = await q.add('edit', 'secretary', 'tidy', { path: 'M.md', new_body: '# M\n\nnew' });
  assert.equal((await q.approve(p.id)).status, 'approved');
  assert.equal(port.store.get('M.md'), '---\ntype: note\n---\n# M\n\nnew');
});

test('approve fails when target exists', async () => {
  const { port, q } = setup({ 'a.md': 'A', 'b.md': 'B' });
  const p = await q.add('move', 'secretary', 'file it', { path: 'a.md', new_path: 'b.md' });
  const r = await q.approve(p.id);
  assert.equal(r.status, 'failed');
  assert.match(r.error!, /Target already exists: b\.md/);
  assert.equal(port.store.get('a.md'), 'A');
  assert.equal(port.store.get('b.md'), 'B');
});

test('create_note fails when the note exists and trashes the source on success', async () => {
  const { port, q } = setup({ 'x.txt': 'raw', 'Taken.md': 'T' });
  const bad = await q.add('create_note', 's', 'r', { path: 'Taken.md', body: 'b' });
  assert.equal((await q.approve(bad.id)).status, 'failed');
  const ok = await q.add('create_note', 's', 'r', { path: 'Notes/X.md', body: '# X', from: 'x.txt' });
  assert.equal((await q.approve(ok.id)).status, 'approved');
  assert.equal(port.store.get('Notes/X.md'), '# X');
  assert.equal(port.store.has('x.txt'), false);
});

test('canvas dedupe against existing task notes and pending proposals', async () => {
  const { q } = setup({ 'Tasks/Lab.md': '---\ntype: task\ncanvas_id: 42\n---\n# Lab' });
  await assert.rejects(q.add('task', 's', 'r', { title: 'Lab again', canvas_id: '42' }), /Canvas item already has a task/);
  await q.add('task', 's', 'r', { title: 'Quiz', canvas_id: '7' });
  await assert.rejects(q.add('task', 's', 'r', { title: 'Quiz 2', canvas_id: '7' }), /Canvas item already has a task/);
});

test('add refuses unknown kinds and missing required args', async () => {
  const { q } = setup({ 'a.md': 'A' });
  await assert.rejects(q.add('task', 's', 'r', { title: '' }), /title/);
  await assert.rejects(q.add('edit', 's', 'r', { path: 'missing.md', new_body: 'x' }), /No such file/);
});

test('editArgs only on allowed kinds and fields', async () => {
  const { q } = setup({ 'a.md': 'A' });
  const t = await q.add('task', 's', 'r', { title: 'T', due: '2026-11-26' });
  assert.equal((await q.editArgs(t.id, { due: '2026-11-30' })).args.due, '2026-11-30');
  await assert.rejects(q.editArgs(t.id, { canvas_id: '9' }), /cannot be edited/);
  const e = await q.add('edit', 's', 'r', { path: 'a.md', new_body: 'B' });
  await assert.rejects(q.editArgs(e.id, { new_body: 'C' }), /cannot be edited/);
  const m = await q.add('move', 's', 'r', { path: 'a.md', new_path: 'x/a.md' });
  assert.equal((await q.editArgs(m.id, { new_path: 'y/a.md' })).args.new_path, 'y/a.md');
});

test('reject with note shows in feedback for that agent only', async () => {
  const { q } = setup();
  const p = await q.add('task', 'secretary', 'r', { title: 'T' });
  await q.reject(p.id, 'wrong date');
  const fb = await q.feedback('secretary');
  assert.deepEqual(fb.map(f => [f.id, f.status, f.note]), [[p.id, 'rejected', 'wrong date']]);
  assert.deepEqual(await q.feedback('other'), []);
});

test('approveAll runs oldest first and reports each', async () => {
  const { port, q } = setup();
  await q.add('task', 's', 'r', { title: 'First' });
  await q.add('task', 's', 'r', { title: 'Second' });
  const r = await q.approveAll();
  assert.deepEqual(r.map(p => p.status), ['approved', 'approved']);
  assert.deepEqual(port.calls.map(c => c.args.title), ['First', 'Second']);
  assert.equal((await q.list('pending')).length, 0);
});

test('link on task uses updateTask, on note uses addRelatedLink', async () => {
  const { port, q } = setup({ 'Tasks/T.md': '---\ntype: task\n---\n# T', 'N.md': '# N\n\nbody' });
  await q.approve((await q.add('link', 's', 'r', { from: 'Tasks/T.md', to: 'N' })).id);
  assert.deepEqual(port.calls[0], { fn: 'updateTask', args: { path: 'Tasks/T.md', add_link: 'N' } });
  await q.approve((await q.add('link', 's', 'r', { from: 'N.md', to: 'T' })).id);
  assert.equal(port.store.get('N.md'), '# N\n\nbody\n\nRelated: [[T]]\n');
});

test('delete trashes and rename keeps the folder', async () => {
  const { port, q } = setup({ 'College/a.md': 'A', 'b.md': 'B' });
  await q.approve((await q.add('rename', 's', 'r', { path: 'College/a.md', new_path: 'College/Physics.md' })).id);
  assert.equal(port.store.get('College/Physics.md'), 'A');
  await q.approve((await q.add('delete', 's', 'r', { path: 'b.md' })).id);
  assert.equal(port.store.has('b.md'), false);
  assert.equal(port.calls.at(-1)!.fn, 'trash');
});

test('onChange reports the pending count and decided proposals are capped at 200', async () => {
  const { q, saved } = setup();
  const counts: number[] = [];
  q.onChange = n => counts.push(n);
  await q.add('task', 's', 'r', { title: 'A' });
  assert.deepEqual(counts, [1]);
  for (let i = 0; i < 205; i++) await q.reject((await q.add('task', 's', 'r', { title: 'T' + i })).id);
  assert.equal(saved().filter(p => p.status !== 'pending').length, 200);
  assert.equal(saved().filter(p => p.status === 'pending').length, 1);
});
