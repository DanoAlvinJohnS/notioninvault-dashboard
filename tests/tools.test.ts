import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTools, validatePath } from '../src/agent/tools.ts';
import { ProposalQueue } from '../src/agent/proposals.ts';
import type { Proposal } from '../src/agent/types.ts';
import { fakePort } from './fakeport.ts';

function setup(files: Record<string, string>) {
  const port = fakePort(files);
  let saved: Proposal[] = [];
  const queue = new ProposalQueue(port, async () => saved, async p => { saved = p; });
  const tools = makeTools(port, queue);
  const run = (name: string, args: any) => tools.find(t => t.name === name)!.run(args);
  return { port, queue, tools, run };
}

test('validatePath accepts real vault paths and refuses unsafe ones', () => {
  assert.equal(validatePath('College/No, it’s not strong. It’s a student.txt'), 'College/No, it’s not strong. It’s a student.txt');
  assert.equal(validatePath("Can't imagine.md"), "Can't imagine.md");
  assert.equal(validatePath('College\\Physics.md'), 'College/Physics.md');
  for (const bad of ['../x.md', 'a/../../x.md', 'C:/x.md', '/x.md', '\\\\server\\x.md', '.obsidian/app.json', '', '   '])
    assert.throws(() => validatePath(bad), /Invalid path/, bad);
});

test('read_note strips frontmatter and truncates at 12000', async () => {
  const { run } = setup({ 'Big.md': '---\ntype: note\n---\n' + 'x'.repeat(20000) });
  const out = await run('read_note', { path: 'Big.md' });
  assert.equal(out.startsWith('xxx'), true);
  assert.equal(out.endsWith('\n…[truncated]'), true);
  assert.equal(out.length, 12000 + '\n…[truncated]'.length);
});

test('read_note section returns one heading block', async () => {
  const { run } = setup({ 'N.md': '# N\n\n## Plan\nstep 1\n### Detail\nd\n## Other\no' });
  assert.equal(await run('read_note', { path: 'N.md', section: 'Plan' }), '## Plan\nstep 1\n### Detail\nd');
  await assert.rejects(run('read_note', { path: 'N.md', section: 'Nope' }), /No heading "Nope"/);
});

test('read_note refuses excluded paths', async () => {
  const { run } = setup({ '.obsidian/app.json': '{}' });
  await assert.rejects(run('read_note', { path: '.obsidian/app.json' }), /Invalid path/);
});

test('search returns at most limit lines with snippets', async () => {
  const files: Record<string, string> = {};
  for (let i = 0; i < 15; i++) files[`n${i}.md`] = `# Note ${i}\n\nwe talked about chess tryouts here`;
  files['other.md'] = 'nothing';
  const { run } = setup(files);
  const out = await run('search', { query: 'Chess', limit: 3 });
  const lines = out.split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^n\d+\.md \| .*chess tryouts/);
});

test('vault_map lists notes and other files', async () => {
  const { run } = setup({ 'Tasks/A.md': '---\ntype: task\nstatus: todo\n---\n# A', 'x.txt': 'raw' });
  const out = await run('vault_map', {});
  assert.match(out, /# notes \(1\)\nTasks\/A\.md \| task \| todo/);
  assert.match(out, /# other files \(1\)\nx\.txt \| txt/);
});

test('list_tasks filters by status and due', async () => {
  const { run } = setup({ 'Tasks/A.md': '---\ntype: task\nstatus: todo\ndue: 2026-11-27\n---', 'Tasks/B.md': '---\ntype: task\nstatus: done\ndue: 2026-11-20\n---', 'Tasks/C.md': '---\ntype: task\nstatus: todo\ndue: 2026-12-30\n---' });
  assert.equal(await run('list_tasks', { status: 'todo', due_before: '2026-12-01' }), 'Tasks/A.md | todo | 2026-11-27');
});

test('propose_edit queues and does not write', async () => {
  const { port, queue, run } = setup({ 'M.md': '# M\n\nold' });
  const out = await run('propose_edit', { agent: 'secretary', reason: 'tidy', path: 'M.md', new_body: '# M\n\nnew' });
  assert.match(out, /^Queued proposal \S+ \(edit\)\. The user must approve it on the Review page; nothing has changed yet\.$/);
  assert.equal(port.store.get('M.md'), '# M\n\nold');
  assert.equal((await queue.list('pending')).length, 1);
});

test('propose_rename keeps the folder', async () => {
  const { queue, run } = setup({ 'College/a.md': 'A' });
  await run('propose_rename', { agent: 's', reason: 'r', path: 'College/a.md', new_name: 'Physics.md' });
  assert.equal((await queue.list('pending'))[0].args.new_path, 'College/Physics.md');
  await assert.rejects(run('propose_rename', { agent: 's', reason: 'r', path: 'College/a.md', new_name: 'x/y.md' }), /new_name/);
});

test('propose tools refuse unsafe paths and need agent and reason', async () => {
  const { run } = setup({ 'a.md': 'A' });
  await assert.rejects(run('propose_move', { agent: 's', reason: 'r', path: 'a.md', new_path: '../a.md' }), /Invalid path/);
  await assert.rejects(run('propose_delete', { path: 'a.md' }), /"agent" is required/);
});

test('proposal_feedback reports decisions', async () => {
  const { queue, run } = setup({});
  const p = await queue.add('task', 'secretary', 'r', { title: 'T' });
  await queue.reject(p.id, 'not needed');
  assert.match(await run('proposal_feedback', { agent: 'secretary' }), new RegExp(`${p.id} \\| task \\| rejected \\| not needed`));
});

test('every tool has a name, description and object inputSchema', () => {
  const { tools } = setup({});
  const names = tools.map(t => t.name).sort();
  assert.deepEqual(names, ['canvas_items', 'list_tasks', 'proposal_feedback', 'propose_create_note', 'propose_delete', 'propose_edit', 'propose_link', 'propose_move', 'propose_rename', 'propose_task', 'propose_task_update', 'read_note', 'related_notes', 'search', 'vault_map']);
  for (const t of tools) { assert.ok(t.description.length > 10); assert.equal((t.inputSchema as any).type, 'object'); }
});

test('search and read_note use the fast reader when the port has one', async () => {
  const { port, run } = setup({ 'N.md': 'from disk' });
  const fast: string[] = [];
  (port as any).readFast = async (p: string) => { fast.push(p); return 'cached chess'; };
  assert.equal(await run('read_note', { path: 'N.md' }), 'cached chess');
  assert.match(await run('search', { query: 'chess' }), /^N\.md \| cached chess/);
  assert.deepEqual(fast, ['N.md', 'N.md']);
});
