import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeArgs, geminiArgs, firstGeminiMessage, mergeGeminiSettings, vaultMcpConfig, GEMINI_BLOCKED } from '../src/agent/engine/args.ts';
import type { AgentDef } from '../src/agent/engine/types.ts';

const agent = (p: Partial<AgentDef> = {}): AgentDef => ({ name: 'secretary', description: '', engine: 'claude', body: 'You are Secretary.', path: '.claude/agents/secretary.md', ...p });

test('claudeArgs exact list', () => {
  assert.deepEqual(claudeArgs(agent(), 'C:/v/.claude/vault-mcp.json'), [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--agent', 'secretary', '--mcp-config', 'C:/v/.claude/vault-mcp.json', '--strict-mcp-config',
    '--allowedTools', 'mcp__vault', '--disallowedTools', 'Write', 'Edit', 'NotebookEdit', 'Bash', '--permission-mode', 'dontAsk', '--tools', '',
  ]);
});

test('claudeArgs adds model', () => {
  const a = claudeArgs(agent({ model: 'haiku' }), 'f');
  assert.deepEqual(a.slice(-2), ['--model', 'haiku']);
});

test('geminiArgs first turn uses --session-id, later --resume', () => {
  const lock = ['--allowed-mcp-server-names', 'vault', '-e', 'none', '--approval-mode', 'default'];
  assert.deepEqual(geminiArgs({ model: 'gemini-2.5-flash', text: 'hi', sessionId: 'u1', resume: false }), ['-o', 'stream-json', '-m', 'gemini-2.5-flash', ...lock, '--session-id', 'u1', '-p', 'hi']);
  assert.deepEqual(geminiArgs({ model: 'm', text: 'again', sessionId: 'u1', resume: true }), ['-o', 'stream-json', '-m', 'm', ...lock, '--resume', 'u1', '-p', 'again']);
});

test('firstGeminiMessage wraps instructions', () => {
  assert.equal(firstGeminiMessage(agent({ body: '  Be tidy.\n' }), 'Sort College'), '<agent instructions>\nBe tidy.\n</agent instructions>\n\nSort College');
});

test('vaultMcpConfig points Claude at the local server', () => {
  assert.equal(JSON.parse(vaultMcpConfig(27125, 'tok')).mcpServers.vault.url, 'http://127.0.0.1:27125/mcp');
});

test('mergeGeminiSettings keeps other keys and merges lists without duplicates', () => {
  const old = JSON.stringify({ security: { auth: { selectedType: 'gemini-api-key' } }, tools: { exclude: ['write_file', 'web_fetch'] }, context: { fileName: 'GEMINI.md' }, mcpServers: { other: { command: 'x' } } });
  const s = JSON.parse(mergeGeminiSettings(old, 27124, 'tok'));
  assert.deepEqual(s.security, { auth: { selectedType: 'gemini-api-key' } });
  assert.deepEqual(s.mcpServers.other, { command: 'x' });
  assert.deepEqual(s.mcpServers.vault, { httpUrl: 'http://127.0.0.1:27124/mcp', headers: { Authorization: 'Bearer tok' }, trust: true });
  assert.deepEqual(s.tools.exclude, ['write_file', 'web_fetch', ...GEMINI_BLOCKED.filter(t => t !== 'write_file' && t !== 'web_fetch')]);
  assert.deepEqual(s.context.fileName, ['GEMINI.md', 'CLAUDE.md']);
});

test('mergeGeminiSettings replaces invalid json', () => {
  const s = JSON.parse(mergeGeminiSettings('{oops', 1, 't'));
  assert.equal(s.mcpServers.vault.httpUrl, 'http://127.0.0.1:1/mcp');
  assert.deepEqual(s.context.fileName, ['CLAUDE.md', 'GEMINI.md']);
});

test('Gemini gets no built-in file, shell, web or task tools: only the vault tools', () => {
  for (const t of ['read_file', 'read_many_files', 'list_directory', 'glob', 'grep_search', 'write_file', 'replace', 'run_shell_command',
    'web_fetch', 'google_web_search', 'activate_skill', 'invoke_agent', 'write_todos', 'tracker_create_task', 'read_background_output', 'ask_user', 'update_topic'])
    assert.ok(GEMINI_BLOCKED.includes(t), t);
});
