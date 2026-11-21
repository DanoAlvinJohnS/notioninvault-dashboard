import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relatedNotes } from '../src/agent/related.ts';
import type { MapNote } from '../src/agent/types.ts';

const note = (path: string, p: Partial<MapNote> = {}): MapNote => ({ path, title: path.replace(/\.md$/, ''), folder: '', type: '', status: '', due: '', links: [], deg: 0, excerpt: '', tags: [], mtime: 0, ...p });

const notes = [
  note('A.md', { links: ['C.md'], excerpt: 'planning the robotics tournament' }),
  note('B.md', { links: ['C.md'] }),
  note('C.md'),
  note('D.md', { excerpt: 'grocery list' }),
];
const edges: [string, string][] = [['A.md', 'C.md'], ['B.md', 'C.md']];

test('notes sharing a link target rank first and say why', () => {
  const r = relatedNotes('A.md', notes, edges);
  assert.equal(r[0].path, 'B.md');
  assert.match(r[0].why, /shares 1 link/);
});

test('notes already linked to or from are not suggested', () => {
  assert.equal(relatedNotes('A.md', notes, edges).some(r => r.path === 'C.md'), false);
  assert.equal(relatedNotes('C.md', notes, edges).some(r => r.path === 'A.md'), false);
});

test('unrelated notes are left out and the note itself never appears', () => {
  const r = relatedNotes('A.md', notes, edges);
  assert.equal(r.some(x => x.path === 'D.md' || x.path === 'A.md'), false);
});

test('shared tags and rare words connect notes without links', () => {
  const ns = [note('X.md', { tags: ['#college'], excerpt: 'robotics tournament' }), note('Y.md', { tags: ['#college'] }), note('Z.md', { excerpt: 'Robotics club meeting' })];
  const r = relatedNotes('X.md', ns, []);
  assert.deepEqual(r.map(x => x.path).sort(), ['Y.md', 'Z.md']);
  assert.match(r.find(x => x.path === 'Y.md')!.why, /shared tag #college/);
  assert.match(r.find(x => x.path === 'Z.md')!.why, /both mention "robotics"/);
});

test('limit caps the result', () => {
  const ns = [note('H.md', { tags: ['#t'] }), ...Array.from({ length: 20 }, (_, i) => note(`n${i}.md`, { tags: ['#t'] }))];
  assert.equal(relatedNotes('H.md', ns, [], 5).length, 5);
});
