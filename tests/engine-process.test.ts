import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeEngine, GeminiEngine } from '../src/agent/engine/engines.ts';
import { MSG } from '../src/agent/engine/events.ts';
import type { AgentDef, ChatEvent } from '../src/agent/engine/types.ts';
import { fakeSpawner } from './fakechild.ts';

const agent: AgentDef = { name: 'secretary', description: '', engine: 'claude', body: 'Be tidy.', path: 'a.md' };
const J = (o: unknown) => JSON.stringify(o) + '\n';
const INIT_OK = J({ type: 'system', subtype: 'init', session_id: 's', model: 'm', mcp_servers: [{ name: 'vault', status: 'connected' }] });

function claude(preflight?: () => string | null) {
  const sp = fakeSpawner(), events: ChatEvent[] = [];
  const e = new ClaudeEngine({ spawn: sp.spawn, exe: 'claude.exe', cwd: 'C:/v', agent, mcpConfigPath: 'C:/v/.claude/vault-mcp.json', preflight });
  e.onEvent = ev => events.push(ev);
  return { e, sp, events };
}
function gemini() {
  const sp = fakeSpawner(), events: ChatEvent[] = [];
  let n = 0;
  const e = new GeminiEngine({ spawn: sp.spawn, node: 'node', script: 'C:/g/gemini.js', cwd: 'C:/v', agent: { ...agent, engine: 'gemini' }, model: 'gemini-2.5-flash', newId: () => `id${++n}` });
  e.onEvent = ev => events.push(ev);
  return { e, sp, events };
}

test('claude writes one json line per message on one process', () => {
  const { e, sp } = claude();
  e.send('hello'); e.send('again');
  assert.equal(sp.calls.length, 1);
  assert.equal(sp.calls[0].cmd, 'claude.exe');
  assert.equal(sp.calls[0].cwd, 'C:/v');
  assert.deepEqual(sp.calls[0].child.written.map(w => JSON.parse(w).message.content[0].text), ['hello', 'again']);
  assert.ok(sp.calls[0].child.written.every(w => w.endsWith('\n')));
});

test('lines split across chunks are joined', () => {
  const { e, sp, events } = claude();
  e.send('hi');
  const line = J({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } } });
  sp.calls[0].child.out(INIT_OK + line.slice(0, 20));
  sp.calls[0].child.out(line.slice(20));
  assert.deepEqual(events.map(x => x.type), ['start', 'delta']);
  assert.deepEqual(events[1], { type: 'delta', text: 'Hello' });
});

test('vault server failed becomes an error', () => {
  const { e, sp, events } = claude();
  e.send('hi');
  sp.calls[0].child.out(J({ type: 'system', subtype: 'init', session_id: 's', model: 'm', mcp_servers: [{ name: 'vault', status: 'failed' }] }));
  assert.deepEqual(events.at(-1), { type: 'error', message: MSG.vault });
});

test('preflight error spawns nothing', () => {
  const { e, sp, events } = claude(() => MSG.vault);
  e.send('hi');
  assert.equal(sp.calls.length, 0);
  assert.deepEqual(events, [{ type: 'error', message: MSG.vault }]);
});

test('spawn failure becomes an error event', () => {
  const { e, sp, events } = claude();
  e.send('hi');
  sp.calls[0].child.fail(Object.assign(new Error('spawn claude.exe ENOENT'), { code: 'ENOENT' }));
  assert.deepEqual(events, [{ type: 'error', message: MSG.missing('claude') }]);
  e.send('retry');
  assert.equal(sp.calls.length, 2, 'a new process is started after a failure');
});

test('exit mid-turn ends the turn with an error', () => {
  const { e, sp, events } = claude();
  e.send('hi');
  sp.calls[0].child.out(INIT_OK);
  sp.calls[0].child.exit(3);
  assert.deepEqual(events.at(-1), { type: 'error', message: 'Claude Code stopped unexpectedly (exit 3).' });
});

test('stderr with a known failure is reported once', () => {
  const { e, sp, events } = claude();
  e.send('hi');
  sp.calls[0].child.err('Not logged in · Please run /login\n');
  sp.calls[0].child.exit(1);
  assert.deepEqual(events, [{ type: 'error', message: MSG.claudeLogin }]);
});

test('stop kills the process and ignores late output', () => {
  const { e, sp, events } = claude();
  e.send('hi');
  e.stop();
  assert.equal(sp.calls[0].child.killed, true);
  sp.calls[0].child.out(INIT_OK);
  sp.calls[0].child.exit(null);
  assert.deepEqual(events, []);
});

test('an error result is not followed by done (one end per turn)', () => {
  const { e, sp, events } = claude();
  e.send('hi');
  sp.calls[0].child.out(INIT_OK + J({ type: 'result', is_error: true, result: 'boom' }));
  assert.deepEqual(events.map(x => x.type), ['start', 'error']);
  e.send('again');
  sp.calls[0].child.out(J({ type: 'result', is_error: false, total_cost_usd: 0 }));
  assert.deepEqual(events.map(x => x.type), ['start', 'error', 'done'], 'the next turn still ends normally');
});
