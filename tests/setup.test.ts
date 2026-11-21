import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeMcpJson, setupPlan, CLAUDE_MD, SETTINGS_JSON, SECRETARY_MD, AGENT_TEMPLATE_MD } from '../src/agent/setup.ts';

test('mergeMcpJson keeps other servers and sets vault', () => {
  const out = JSON.parse(mergeMcpJson(JSON.stringify({ mcpServers: { other: { command: 'x' } } }), 27125, 'tok'));
  assert.deepEqual(out.mcpServers.other, { command: 'x' });
  assert.deepEqual(out.mcpServers.vault, { type: 'http', url: 'http://127.0.0.1:27125/mcp', headers: { Authorization: 'Bearer tok' } });
});

test('mergeMcpJson replaces invalid or missing json', () => {
  for (const bad of ['{oops', null, '[]']) assert.equal(JSON.parse(mergeMcpJson(bad, 27124, 't')).mcpServers.vault.url, 'http://127.0.0.1:27124/mcp');
});

test('setupPlan skips existing files', () => {
  const all = setupPlan(() => false).map(f => f.path);
  assert.deepEqual(all, ['CLAUDE.md', '.claude/settings.json', '.claude/agents/secretary.md', '.claude/agent-template.md']);
  assert.deepEqual(setupPlan(p => p === 'CLAUDE.md' || p === '.claude/agents/secretary.md').map(f => f.path), ['.claude/settings.json', '.claude/agent-template.md']);
});

test('CLAUDE_MD is short and states the rules', () => {
  assert.ok(CLAUDE_MD.split('\n').length < 60);
  for (const s of ['vault_map', 'propose_', 'proposal_feedback', 'type: task', 'agent']) assert.ok(CLAUDE_MD.includes(s), s);
});

test('SETTINGS_JSON parses, enables vault and denies direct writes', () => {
  const s = JSON.parse(SETTINGS_JSON);
  assert.deepEqual(s.enabledMcpjsonServers, ['vault']);
  assert.ok(s.permissions.allow.includes('mcp__vault'));
  for (const d of ['Write', 'Edit', 'NotebookEdit', 'Bash', 'Read(./.obsidian/**)', 'Read(./.smart-env/**)', 'Read(./graphify-out/**)', 'Read(./System/**)', 'Read(**/node_modules/**)']) assert.ok(s.permissions.deny.includes(d), d);
});

test('SECRETARY_MD frontmatter has name, description, tools, model', () => {
  const fm = SECRETARY_MD.match(/^---\n([\s\S]*?)\n---\n/)![1];
  assert.match(fm, /^name: secretary$/m);
  assert.match(fm, /^description: .*Secretary/m);
  assert.match(fm, /^tools: mcp__vault__\*$/m);
  assert.match(fm, /^model: sonnet$/m);
});

test('AGENT_TEMPLATE_MD explains how to activate', () => {
  assert.match(AGENT_TEMPLATE_MD, /\.claude\/agents\//);
  assert.match(AGENT_TEMPLATE_MD, /haiku/);
});
