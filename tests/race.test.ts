import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProposalQueue } from '../src/agent/proposals.ts';
import { sharedData } from '../src/agent/datastore.ts';
import { isExcluded } from '../src/agent/vaultmap.ts';
import type { Proposal } from '../src/agent/types.ts';
import { fakePort } from './fakeport.ts';

const tick = () => new Promise(r => setTimeout(r, 1));

/** Storage that yields between read and write, like data.json on disk. */
function slowQueue(files: Record<string, string> = {}) {
  const port = fakePort(files);
  let saved: Proposal[] = [];
  const q = new ProposalQueue(port, async () => { await tick(); return structuredClone(saved); }, async p => { await tick(); saved = structuredClone(p); });
  return { port, q, saved: () => saved };
}

test('concurrent adds are all kept', async () => {
  const { q, saved } = slowQueue();
  await Promise.all(['A', 'B', 'C', 'D'].map(t => q.add('task', 's', 'r', { title: t })));
  assert.deepEqual(saved().map(p => p.args.title).sort(), ['A', 'B', 'C', 'D']);
});

test('double approve applies once', async () => {
  const { port, q } = slowQueue();
  const p = await q.add('task', 's', 'r', { title: 'Once' });
  await Promise.all([q.approve(p.id), q.approve(p.id), q.approveAll()]);
  assert.equal(port.calls.filter(c => c.fn === 'createTask').length, 1);
});

test('an add racing an approve does not bring the approved item back', async () => {
  const { q, saved } = slowQueue();
  const p = await q.add('task', 's', 'r', { title: 'X' });
  await Promise.all([q.approve(p.id), q.add('task', 's', 'r', { title: 'Y' })]);
  assert.equal(saved().find(x => x.id === p.id)!.status, 'approved');
});

test('editArgs re-checks an edited path', async () => {
  const { q } = slowQueue({ 'a.md': 'A' });
  const m = await q.add('move', 's', 'r', { path: 'a.md', new_path: 'x/a.md' });
  for (const bad of ['../a.md', '.obsidian/a.md', 'System/a.md', 'C:/a.md']) await assert.rejects(q.editArgs(m.id, { new_path: bad }), /Invalid path/, bad);
});

test('exclusions ignore letter case', () => {
  assert.equal(isExcluded('system/new.md'), true);
  assert.equal(isExcluded('Graphify-Out/x.json'), true);
  assert.equal(isExcluded('a/Node_Modules/x.js'), true);
  assert.equal(isExcluded('DB_Background.png'), true);
});

test('dashboard saves keep agent data and agent saves keep the layout', async () => {
  let disk: any = { layout: { v: 1 }, canvas: { token: 't' } };
  const load = async () => { await tick(); return structuredClone(disk); };
  const save = async (d: any) => { await tick(); disk = structuredClone(d); };
  const data = sharedData(load, save);
  const stale = await data.store.load();                      // the dashboard read the file earlier…
  await data.agent(a => { a.proposals = [1]; });               // …then an agent saved a proposal…
  stale.layout = { v: 2 };
  await data.store.save(stale);                                // …then the dashboard saves its old copy
  assert.deepEqual(disk.agent.proposals, [1]);
  assert.deepEqual(disk.layout, { v: 2 });
  await Promise.all([data.agent(a => { a.token = 'x'; }), data.store.save({ ...(await data.store.load()), layout: { v: 3 } })]);
  assert.equal(disk.agent.token, 'x');
  assert.equal(disk.canvas.token, 't');
});

test('reading agent data never rewrites the file', async () => {
  let disk: any = { agent: { proposals: [1, 2] } }, saves = 0;
  const data = sharedData(async () => structuredClone(disk), async d => { saves++; disk = structuredClone(d); });
  assert.deepEqual(await data.readAgent(a => a.proposals), [1, 2]);
  assert.equal(saves, 0);
  await data.agent(a => { a.proposals = [3]; });
  assert.deepEqual(await data.readAgent(a => a.proposals), [3], 'reads wait for writes in the same lock');
});
