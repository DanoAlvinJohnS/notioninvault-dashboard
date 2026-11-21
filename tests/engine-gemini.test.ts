// Gemini CLI in --acp mode: one process per chat, JSON-RPC over stdio (shapes recorded from Gemini CLI 0.70).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiEngine } from '../src/agent/engine/engines.ts';
import { acpEvents } from '../src/agent/engine/events.ts';
import { MSG } from '../src/agent/engine/events.ts';
import type { AgentDef, ChatEvent } from '../src/agent/engine/types.ts';
import { fakeSpawner } from './fakechild.ts';

const agent: AgentDef = { name: 'sorter', description: '', engine: 'gemini', body: 'Be tidy.', path: 'a.md' };
const J = (o: unknown) => JSON.stringify(o) + '\n';
const flush = () => new Promise(r => setTimeout(r, 0));
const upd = (update: any) => J({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's1', update } });

function setup() {
  const sp = fakeSpawner(), events: ChatEvent[] = [];
  const e = new GeminiEngine({ spawn: sp.spawn, node: 'node', script: 'C:/g/gemini.js', cwd: 'C:/v', agent, model: 'gemini-3.5-flash', newId: () => 'x' });
  e.onEvent = ev => events.push(ev);
  const child = () => sp.calls[0].child;
  const sent = () => child().written.map(w => JSON.parse(w));
  /** Answers the last request with this method. */
  const answer = (method: string, result: unknown) => { const r = sent().filter(m => m.method === method).at(-1); child().out(J({ jsonrpc: '2.0', id: r.id, result })); };
  /** Runs initialize + session/new, letting the engine's async steps run in between. */
  const ready = async () => { answer('initialize', { protocolVersion: 1 }); await flush(); answer('session/new', { sessionId: 's1' }); await flush(); };
  return { e, sp, events, child, sent, answer, ready };
}

test('one process: initialize, session/new, then one prompt per message', async () => {
  const { e, sp, sent, answer, ready, events } = setup();
  e.send('first');
  assert.equal(sp.calls.length, 1);
  assert.deepEqual(sp.calls[0].args, ['C:/g/gemini.js', '--acp', '-m', 'gemini-3.5-flash', '--allowed-mcp-server-names', 'vault', '-e', 'none', '--approval-mode', 'default']);
  assert.equal(sp.calls[0].env?.GEMINI_CLI_NO_RELAUNCH, 'true');
  assert.deepEqual(sent().map(m => m.method), ['initialize']);
  await ready();
  assert.deepEqual(sent().map(m => m.method), ['initialize', 'session/new', 'session/prompt']);
  assert.deepEqual(sent()[1].params, { cwd: 'C:/v', mcpServers: [] });
  assert.deepEqual(events[0], { type: 'start', sessionId: 's1', engine: 'gemini', model: 'gemini-3.5-flash', toolsOk: true });
  answer('session/prompt', { stopReason: 'end_turn' });
  await flush();
  e.send('second');
  await flush();
  assert.equal(sp.calls.length, 1, 'no new process for the second message');
  const prompts = sent().filter(m => m.method === 'session/prompt');
  assert.equal(prompts.length, 2);
  assert.deepEqual(prompts[1].params, { sessionId: 's1', prompt: [{ type: 'text', text: 'second' }] });
});

test('the first prompt carries the agent instructions', async () => {
  const { e, sent, ready } = setup();
  e.send('Sort College');
  await ready();
  assert.equal(sent().find(m => m.method === 'session/prompt').params.prompt[0].text, '<agent instructions>\nBe tidy.\n</agent instructions>\n\nSort College');
});

test('chunks stream and the prompt result ends the turn', async () => {
  const { e, child, ready, answer, events } = setup();
  e.send('hi'); await ready();
  child().out(upd({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } }) + upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hel' } }) + upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'lo' } }));
  answer('session/prompt', { stopReason: 'end_turn' });
  await flush();
  assert.deepEqual(events.map(x => x.type), ['start', 'delta', 'delta', 'done']);
});

test('acpEvents: tool call and result keep the id and the result text', () => {
  const call = acpEvents({ method: 'session/update', params: { update: { sessionUpdate: 'tool_call', toolCallId: 'mcp_vault_propose_task__call_1', status: 'in_progress', content: [] } } });
  assert.deepEqual(call, [{ type: 'tool', name: 'mcp_vault_propose_task', status: 'call', id: 'mcp_vault_propose_task__call_1' }]);
  const done = acpEvents({ method: 'session/update', params: { update: { sessionUpdate: 'tool_call_update', toolCallId: 'mcp_vault_propose_task__call_1', status: 'completed',
    content: [{ type: 'content', content: { type: 'text', text: 'Queued proposal fake123 (task). The user must approve it.' } }] } } });
  assert.deepEqual(done, [{ type: 'tool', name: '', status: 'ok', id: 'mcp_vault_propose_task__call_1', text: 'Queued proposal fake123 (task). The user must approve it.' }]);
  assert.deepEqual(acpEvents({ method: 'session/update', params: { update: { sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'failed', content: [] } } }), [{ type: 'tool', name: '', status: 'error', id: 't' }]);
  assert.deepEqual(acpEvents({ method: 'session/update', params: { update: { sessionUpdate: 'usage_update', used: 1 } } }), []);
});

test('permission requests are refused and noted', async () => {
  const { e, child, sent, ready, events } = setup();
  e.send('hi'); await ready();
  child().out(J({ jsonrpc: '2.0', id: 77, method: 'session/request_permission', params: { sessionId: 's1', toolCall: { title: 'run_shell_command' }, options: [] } }));
  const reply = sent().find(m => m.id === 77 && !m.method);
  assert.deepEqual(reply.result, { outcome: { outcome: 'cancelled' } });
  assert.deepEqual(events.at(-1), { type: 'denied', tool: 'run_shell_command' });
});

test('an rpc error becomes the plain sentence and ends the turn', async () => {
  const { e, child, sent, ready, events } = setup();
  e.send('hi'); await ready();
  const p = sent().find(m => m.method === 'session/prompt');
  child().out(J({ jsonrpc: '2.0', id: p.id, error: { code: -32603, message: 'API key not valid. Please pass a valid API key.' } }));
  await flush();
  assert.deepEqual(events.at(-1), { type: 'error', message: MSG.geminiKey });
});

test('a failed startup reports once and the next message starts a new process', async () => {
  const { e, sp, child, events, sent } = setup();
  e.send('hi');
  child().err('Error when talking to Gemini API … "code": 401, "message": "API key not valid.\n');
  child().exit(1);
  assert.deepEqual(events, [{ type: 'error', message: MSG.geminiKey }]);
  e.send('again');
  assert.equal(sp.calls.length, 2);
  assert.ok(sent().length >= 1);
});

test('a retry warning on stderr does not end the turn', async () => {
  const { e, child, ready, answer, events } = setup();
  e.send('hi'); await ready();
  child().err('Attempt 1 failed with status 429. Retrying with backoff...\n');
  assert.deepEqual(events.map(x => x.type), ['start']);
  answer('session/prompt', { stopReason: 'end_turn' });
  await flush();
  assert.deepEqual(events.map(x => x.type), ['start', 'done']);
});

test('stop kills the process and ignores late output', async () => {
  const { e, child, ready, events } = setup();
  e.send('hi'); await ready();
  e.stop();
  assert.equal(child().killed, true);
  const before = events.length;
  child().out(upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'late' } }));
  child().exit(null);
  assert.equal(events.length, before);
});
