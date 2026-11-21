import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAgentFile, listAgents } from '../src/agent/engine/agents.ts';
import { SECRETARY_MD } from '../src/agent/setup.ts';

test('parses secretary', () => {
  const a = parseAgentFile('.claude/agents/secretary.md', SECRETARY_MD, 'claude');
  assert.equal(a.name, 'secretary');
  assert.equal(a.engine, 'claude');
  assert.equal(a.model, 'sonnet');
  assert.match(a.description, /Secretary/);
  assert.match(a.body, /^You are Secretary/);
  assert.equal(a.warning, undefined);
});

test('engine gemini and gemini_model', () => {
  const a = parseAgentFile('x/sorter.md', '---\nname: sorter\ndescription: Sorts\nengine: gemini\ngemini_model: gemini-2.5-flash-lite\n---\nSort things.', 'claude');
  assert.equal(a.engine, 'gemini');
  assert.equal(a.geminiModel, 'gemini-2.5-flash-lite');
  assert.equal(a.body, 'Sort things.');
});

test('missing name uses file name and default engine', () => {
  const a = parseAgentFile('.claude/agents/Study Buddy.md', '---\ndescription: Helps\n---\nHi', 'gemini');
  assert.equal(a.name, 'Study Buddy');
  assert.equal(a.engine, 'gemini');
});

test('unknown engine falls back with warning', () => {
  const a = parseAgentFile('a.md', '---\nname: a\nengine: gpt\n---\nx', 'claude');
  assert.equal(a.engine, 'claude');
  assert.equal(a.warning, 'Unknown engine "gpt", using claude');
});

test('CRLF frontmatter', () => {
  const a = parseAgentFile('a.md', '---\r\nname: crlf\r\nengine: gemini\r\ndescription: d\r\n---\r\nBody\r\n', 'claude');
  assert.equal(a.name, 'crlf');
  assert.equal(a.engine, 'gemini');
  assert.equal(a.body.trim(), 'Body');
});

test('listAgents sorts and skips files without frontmatter', () => {
  const list = listAgents([
    { path: 'z.md', text: '---\nname: zed\n---\nz' },
    { path: 'notes.md', text: 'just text' },
    { path: 'a.md', text: '---\nname: alpha\n---\na' },
  ], 'claude');
  assert.deepEqual(list.map(a => a.name), ['alpha', 'zed']);
});
