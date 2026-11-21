import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isExcluded, mapLine, formatMap, snippetAround } from '../src/agent/vaultmap.ts';
import type { MapNote, MapFile } from '../src/agent/types.ts';

const note = (p: Partial<MapNote> & { path: string }): MapNote => ({ title: p.path.replace(/^.*\/|\.md$/g, ''), folder: p.path.includes('/') ? p.path.slice(0, p.path.lastIndexOf('/')) : '', type: '', status: '', due: '', links: [], deg: 0, excerpt: '', tags: [], mtime: 0, ...p });

test('isExcluded hides plugin, cache and backend folders but not notes', () => {
  assert.equal(isExcluded('.obsidian/app.json'), true);
  assert.equal(isExcluded('College/.hidden/x.md'), true);
  assert.equal(isExcluded('graphify-out/graph.json'), true);
  assert.equal(isExcluded('System/app.py'), true);
  assert.equal(isExcluded('db_background.jpg'), true);
  assert.equal(isExcluded('My Project/node_modules/a.js'), true);
  assert.equal(isExcluded('Tasks/CEA Chess Nov 27.md'), false);
  assert.equal(isExcluded("No, it’s not strong. It’s a student.txt"), false);
});

test('mapLine trims excerpt to 80', () => {
  const l = mapLine(note({ path: 'Tasks/A.md', type: 'task', status: 'todo', due: '2026-11-27', links: ['x', 'y'], excerpt: 'z'.repeat(200) }));
  assert.equal(l, `Tasks/A.md | task | todo | 2026-11-27 | links:2 | ${'z'.repeat(80)}`);
});

test('mapLine leaves status empty for non-task notes', () => {
  assert.equal(mapLine(note({ path: 'AI Related.md', status: 'todo', excerpt: 'hi' })), 'AI Related.md |  |  |  | links:0 | hi');
});

test('formatMap filters by folder and lists other files', () => {
  const notes = [note({ path: 'College/Physics.md' }), note({ path: 'Dashboard.md' })];
  const files: MapFile[] = [{ path: 'CAOB project.txt', ext: 'txt', size: 2048, mtime: 0 }, { path: '.obsidian/x.json', ext: 'json', size: 1, mtime: 0 }];
  const all = formatMap(notes, files);
  assert.match(all, /^# notes \(2\)\nCollege\/Physics\.md /);
  assert.match(all, /# other files \(1\)\nCAOB project\.txt \| txt \| 2 KB/);
  assert.doesNotMatch(all, /\.obsidian/);
  const college = formatMap(notes, files, 'College');
  assert.match(college, /# notes \(1\)\nCollege\/Physics\.md/);
  assert.match(college, /# other files \(0\)/);
  assert.equal(formatMap(notes, files, 'Coll').includes('Physics'), false);
});

test('snippetAround centres on first case-insensitive match', () => {
  const text = 'a'.repeat(300) + ' the Chess tryouts ' + 'b'.repeat(300);
  const s = snippetAround(text, 'chess');
  assert.ok(s.includes('Chess'));
  assert.ok(s.length <= 120 + 2);
  assert.equal(snippetAround('short text', 'missing'), 'short text');
});
