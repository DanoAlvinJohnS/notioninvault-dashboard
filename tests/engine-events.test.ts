import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeEvents, geminiEvents, classifyError, MSG } from '../src/agent/engine/events.ts';

const J = (o: unknown) => JSON.stringify(o);

test('claude init reports whether the vault tools connected', () => {
  const ok = claudeEvents(J({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude-sonnet-5-5', mcp_servers: [{ name: 'vault', status: 'connected' }] }));
  assert.deepEqual(ok, [{ type: 'start', sessionId: 's1', engine: 'claude', model: 'claude-sonnet-5-5', toolsOk: true }]);
  const bad = claudeEvents(J({ type: 'system', subtype: 'init', session_id: 's1', model: 'm', mcp_servers: [{ name: 'vault', status: 'failed' }] }));
  assert.equal((bad[0] as any).toolsOk, false);
});

test('claude text deltas, tool calls and results', () => {
  assert.deepEqual(claudeEvents(J({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } } })), [{ type: 'delta', text: 'Hel' }]);
  assert.deepEqual(claudeEvents(J({ type: 'assistant', message: { content: [{ type: 'text', text: 'x' }, { type: 'tool_use', name: 'mcp__vault__list_tasks' }] } })), [{ type: 'tool', name: 'mcp__vault__list_tasks', status: 'call' }]);
  assert.deepEqual(claudeEvents(J({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true }] } })), [{ type: 'tool', name: '', status: 'error' }]);
});

test('claude result with a denial and cost', () => {
  assert.deepEqual(claudeEvents(J({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.0174, permission_denials: [{ tool_name: 'Write' }] })),
    [{ type: 'denied', tool: 'Write' }, { type: 'done', costUsd: 0.0174 }]);
});

test('claude error result uses the classified sentence', () => {
  assert.deepEqual(claudeEvents(J({ type: 'result', is_error: true, result: 'Invalid API key · Please run /login' })), [{ type: 'error', message: MSG.claudeLogin }, { type: 'done', costUsd: undefined }]);
});

test('non-json and unknown lines are ignored', () => {
  assert.deepEqual(claudeEvents('Warning: something'), []);
  assert.deepEqual(claudeEvents(J({ type: 'rate_limit_event' })), []);
  assert.deepEqual(geminiEvents('Ripgrep is not available. Falling back to GrepTool.'), []);
});

test('gemini events', () => {
  assert.deepEqual(geminiEvents(J({ type: 'init', session_id: 's1', model: 'gemini-2.5-flash' })), [{ type: 'start', sessionId: 's1', engine: 'gemini', model: 'gemini-2.5-flash', toolsOk: true }]);
  assert.deepEqual(geminiEvents(J({ type: 'message', role: 'assistant', content: 'Hi', delta: true })), [{ type: 'delta', text: 'Hi' }]);
  assert.deepEqual(geminiEvents(J({ type: 'message', role: 'assistant', content: 'Whole' })), [{ type: 'message', text: 'Whole' }]);
  assert.deepEqual(geminiEvents(J({ type: 'message', role: 'user', content: 'me' })), []);
  assert.deepEqual(geminiEvents(J({ type: 'tool_use', tool_name: 'list_tasks' })), [{ type: 'tool', name: 'list_tasks', status: 'call' }]);
  assert.deepEqual(geminiEvents(J({ type: 'tool_result', status: 'error' })), [{ type: 'tool', name: '', status: 'error' }]);
  assert.deepEqual(geminiEvents(J({ type: 'result', status: 'success' })), [{ type: 'done' }]);
  assert.deepEqual(geminiEvents(J({ type: 'result', status: 'error', error: { message: 'boom' } })), [{ type: 'error', message: 'boom' }, { type: 'done' }]);
});

test('the real gemini 401 line becomes the key sentence', () => {
  const line = 'Error when talking to Gemini API Full report available at: C:\\x.json _ApiError: {"error":{"message":"{\\n  \\"error\\": {\\n    \\"code\\": 401,\\n    \\"message\\": \\"API key not valid. Please pass a valid API key.';
  assert.deepEqual(geminiEvents(line), [{ type: 'error', message: MSG.geminiKey }]);
});

test('classifyError', () => {
  assert.equal(classifyError('gemini', 'API key not valid'), MSG.geminiKey);
  assert.equal(classifyError('gemini', 'status 429 RESOURCE_EXHAUSTED'), 'The Gemini rate limit was reached. Wait a bit or switch this agent to the other engine.');
  assert.equal(classifyError('claude', 'Rate limit reached'), 'The Claude rate limit was reached. Wait a bit or switch this agent to the other engine.');
  assert.equal(classifyError('claude', 'Not logged in · Please run /login'), MSG.claudeLogin);
  assert.equal(classifyError('claude', 'spawn claude.exe ENOENT'), MSG.missing('claude'));
  assert.equal(classifyError('gemini', 'spawn node ENOENT'), MSG.missing('gemini'));
  assert.equal(classifyError('claude', 'all good'), null);
  assert.equal(MSG.missing('gemini'), "Gemini CLI isn't installed or wasn't found. Set its path in Settings > NotionInVault Dashboard.");
});

test('claude tool_result text from string and from parts', () => {
  const s = claudeEvents(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'hello' }] } }));
  assert.deepEqual(s, [{ type: 'tool', name: '', status: 'ok', text: 'hello' }]);
  const p = claudeEvents(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] }] } }));
  assert.deepEqual(p, [{ type: 'tool', name: '', status: 'ok', text: 'ab' }]);
});

test('gemini tool_result output', () => {
  assert.deepEqual(geminiEvents(JSON.stringify({ type: 'tool_result', status: 'success', output: 'done it' })), [{ type: 'tool', name: '', status: 'ok', text: 'done it' }]);
});

test('result text is cut to 2000', () => {
  const ev = claudeEvents(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x'.repeat(5000) }] } }))[0] as any;
  assert.equal(ev.text.length, 2000);
});

test('tool ids are carried on calls and results', () => {
  assert.deepEqual(claudeEvents(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__vault__x' }] } })), [{ type: 'tool', name: 'mcp__vault__x', status: 'call', id: 't1' }]);
  assert.deepEqual(claudeEvents(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'r' }] } })), [{ type: 'tool', name: '', status: 'ok', id: 't1', text: 'r' }]);
  assert.deepEqual(geminiEvents(JSON.stringify({ type: 'tool_use', tool_name: 'x', tool_id: 'g1' })), [{ type: 'tool', name: 'x', status: 'call', id: 'g1' }]);
  assert.deepEqual(geminiEvents(JSON.stringify({ type: 'tool_result', tool_id: 'g1', status: 'success', output: 'o' })), [{ type: 'tool', name: '', status: 'ok', id: 'g1', text: 'o' }]);
});
