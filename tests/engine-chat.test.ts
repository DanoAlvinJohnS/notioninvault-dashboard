import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatController } from '../src/agent/engine/chat.ts';
import type { Engine } from '../src/agent/engine/engines.ts';
import type { AgentDef, ChatEvent } from '../src/agent/engine/types.ts';

const agent: AgentDef = { name: 'secretary', description: '', engine: 'claude', body: '', path: 'a.md' };

function fakeEngine() {
  const e = { name: 'claude' as const, sent: [] as string[], stopped: false, onEvent: (_: ChatEvent) => {}, send(t: string) { e.sent.push(t); }, stop() { e.stopped = true; } };
  return e;
}
function setup() {
  const engines: ReturnType<typeof fakeEngine>[] = [];
  const c = new ChatController(() => { const e = fakeEngine(); engines.push(e); return e as Engine; });
  c.start(agent);
  const fire = (...evs: ChatEvent[]) => evs.forEach(ev => engines.at(-1)!.onEvent(ev));
  return { c, engines, fire };
}

test('deltas build one assistant message', () => {
  const { c, fire } = setup();
  c.send('hi');
  fire({ type: 'delta', text: 'Hel' }, { type: 'delta', text: 'lo' }, { type: 'done', costUsd: 0.01 });
  assert.deepEqual(c.messages, [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'Hello' }]);
  assert.equal(c.busy, false);
});

test('a full message replaces the streamed one', () => {
  const { c, fire } = setup();
  c.send('hi');
  fire({ type: 'delta', text: 'Hel' }, { type: 'message', text: 'Hello there' }, { type: 'done' });
  assert.deepEqual(c.messages.at(-1), { role: 'assistant', text: 'Hello there' });
});

test('send while busy queues the message', () => {
  const { c, engines, fire } = setup();
  c.send('one'); c.send('two');
  assert.deepEqual(engines[0].sent, ['one']);
  assert.deepEqual(c.messages.map(m => m.text), ['one', 'two']);
  fire({ type: 'done' });
  assert.deepEqual(engines[0].sent, ['one', 'two']);
  assert.equal(c.busy, true);
});

test('new chat stops the old engine', () => {
  const { c, engines } = setup();
  c.send('x');
  c.newChat();
  assert.equal(engines[0].stopped, true);
  assert.deepEqual(c.messages, []);
  assert.equal(c.busy, false);
  c.send('y');
  assert.equal(engines.length, 2);
  assert.deepEqual(engines[1].sent, ['y']);
});

test('tool notes strip the prefix; text after a tool starts a new message', () => {
  const { c, fire } = setup();
  c.send('tasks?');
  fire({ type: 'delta', text: 'Checking.' }, { type: 'tool', name: 'mcp__vault__list_tasks', status: 'call' }, { type: 'tool', name: '', status: 'ok' }, { type: 'delta', text: 'You have 3.' }, { type: 'done' });
  assert.deepEqual(c.messages.slice(1), [{ role: 'assistant', text: 'Checking.' }, { role: 'note', text: 'Using list_tasks…' }, { role: 'assistant', text: 'You have 3.' }]);
});

test('propose call adds review note', () => {
  const { c, fire } = setup();
  c.send('make a task');
  fire({ type: 'tool', name: 'mcp__vault__propose_task', status: 'call' }, { type: 'tool', name: '', status: 'ok' }, { type: 'done' });
  assert.deepEqual(c.messages.filter(m => m.role === 'note').map(m => m.text), ['Using propose_task…', 'Queued for your approval on the Review page.']);
});

test('denied tools are noted', () => {
  const { c, fire } = setup();
  c.send('x');
  fire({ type: 'denied', tool: 'Write' }, { type: 'done' });
  assert.deepEqual(c.messages.at(-1), { role: 'note', text: 'Not allowed: Write' });
});

test('error ends the turn and unblocks the queue', () => {
  const { c, engines, fire } = setup();
  c.send('a'); c.send('b');
  fire({ type: 'error', message: 'boom' });
  assert.deepEqual(c.messages.find(m => m.role === 'error'), { role: 'error', text: 'boom' });
  assert.deepEqual(engines[0].sent, ['a', 'b']);
});

test('cost adds up across turns and onChange fires', () => {
  const { c, fire } = setup();
  let changes = 0;
  c.onChange = () => { changes++; };
  c.send('a'); fire({ type: 'done', costUsd: 0.01 });
  c.send('b'); fire({ type: 'done', costUsd: 0.02 });
  assert.equal(Math.round(c.costUsd * 100), 3);
  assert.ok(changes >= 4);
});

test('send without an agent is ignored', () => {
  const c = new ChatController(() => { throw new Error('no'); });
  c.send('x');
  assert.deepEqual(c.messages, []);
});


test('gemini tool names get the same notes', () => {
  const { c, fire } = setup();
  c.send('make a task');
  fire({ type: 'tool', name: 'mcp_vault_propose_task', status: 'call' }, { type: 'tool', name: '', status: 'ok' }, { type: 'done' });
  assert.deepEqual(c.messages.filter(m => m.role === 'note').map(m => m.text), ['Using propose_task…', 'Queued for your approval on the Review page.']);
});

test('propose result adds a proposal message with id and kind', () => {
  const { c, fire } = setup();
  c.send('make a task');
  fire({ type: 'tool', name: 'mcp__vault__propose_task', status: 'call' },
    { type: 'tool', name: '', status: 'ok', text: 'Queued proposal p-12 (task). The user must approve it on the Review page; nothing has changed yet.' });
  assert.deepEqual(c.messages.slice(-2), [{ role: 'note', text: 'Queued for your approval on the Review page.' }, { role: 'proposal', id: 'p-12', text: 'task' }]);
});

test('non-propose result with "Queued proposal" text adds nothing', () => {
  const { c, fire } = setup();
  c.send('search');
  fire({ type: 'tool', name: 'mcp__vault__search', status: 'call' },
    { type: 'tool', name: '', status: 'ok', text: 'Queued proposal p-1 (task) found in a note' });
  assert.equal(c.messages.some(m => m.role === 'proposal'), false);
});

test('parallel tool calls: a result is matched to its own call by id', () => {
  const { c, fire } = setup();
  c.send('x');
  fire({ type: 'tool', name: 'mcp__vault__propose_task', status: 'call', id: 'a' }, { type: 'tool', name: 'mcp__vault__read_note', status: 'call', id: 'b' },
    { type: 'tool', name: '', status: 'ok', id: 'a', text: 'Queued proposal p-7 (task). x' },
    { type: 'tool', name: '', status: 'ok', id: 'b', text: 'Queued proposal p-9 (task) is just note text' });
  assert.deepEqual(c.messages.filter(m => m.role === 'proposal'), [{ role: 'proposal', id: 'p-7', text: 'task' }]);
});
