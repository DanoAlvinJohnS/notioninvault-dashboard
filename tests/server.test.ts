import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from '../src/agent/server.ts';
import { handleRpc } from '../src/agent/rpc.ts';
import type { Tool } from '../src/agent/tools.ts';

const TOKEN = 'a'.repeat(64);
const tools: Tool[] = [
  { name: 'echo', description: 'Echo back', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, run: async a => `echo: ${a.text}` },
  { name: 'boom', description: 'Always fails', inputSchema: { type: 'object', properties: {} }, run: async () => { throw new Error('kaboom'); } },
];
let nextPort = 39100 + Math.floor(Math.random() * 500);
const post = (port: number, body: string, token: string | null = TOKEN) =>
  fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body });

test('handleRpc: notifications get no reply, unknown methods get -32601', async () => {
  assert.equal(await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, tools), null);
  const r = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'nope' }, tools);
  assert.equal(r.error.code, -32601);
});

test('initialize then tools/list over http', async () => {
  const s = await startServer({ tools: () => tools, token: TOKEN, port: nextPort++ });
  try {
    const init = await (await post(s.port, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }))).json();
    assert.equal(init.result.serverInfo.name, 'vault');
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.deepEqual(init.result.capabilities, { tools: {} });
    const list = await (await post(s.port, JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))).json();
    assert.deepEqual(list.result.tools.map((t: any) => t.name), ['echo', 'boom']);
    const call = await (await post(s.port, JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { text: 'hi' } } }))).json();
    assert.deepEqual(call.result, { content: [{ type: 'text', text: 'echo: hi' }] });
  } finally { await s.close(); }
});

test('tool error is isError not http error', async () => {
  const s = await startServer({ tools: () => tools, token: TOKEN, port: nextPort++ });
  try {
    const res = await post(s.port, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'boom', arguments: {} } }));
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).result, { content: [{ type: 'text', text: 'kaboom' }], isError: true });
  } finally { await s.close(); }
});

test('rejects missing or wrong token', async () => {
  const s = await startServer({ tools: () => tools, token: TOKEN, port: nextPort++ });
  try {
    assert.equal((await post(s.port, '{}', null)).status, 401);
    assert.equal((await post(s.port, '{}', 'b'.repeat(64))).status, 401);
    assert.equal((await post(s.port, '{}', 'short')).status, 401);
  } finally { await s.close(); }
});

test('bad json returns parse error and notifications get 202', async () => {
  const s = await startServer({ tools: () => tools, token: TOKEN, port: nextPort++ });
  try {
    const res = await post(s.port, '{not json');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).error.code, -32700);
    const n = await post(s.port, JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    assert.equal(n.status, 202);
    const g = await fetch(`http://127.0.0.1:${s.port}/mcp`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(g.status, 405);
  } finally { await s.close(); }
});

test('listens on next port when taken', async () => {
  const p = nextPort; nextPort += 3;
  const blocker = http.createServer(() => {});
  await new Promise<void>(r => blocker.listen(p, '127.0.0.1', () => r()));
  const s = await startServer({ tools: () => tools, token: TOKEN, port: p });
  try { assert.equal(s.port, p + 1); }
  finally { await s.close(); await new Promise(r => blocker.close(r)); }
});
