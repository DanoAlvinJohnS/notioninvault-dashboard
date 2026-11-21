// Command lines for each engine, and the config files that point them at the vault tools.
import type { AgentDef } from './types.ts';
import { mergeMcpJson } from '../setup.ts';

export function claudeArgs(agent: AgentDef, mcpConfigPath: string): string[] {
  const a = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--agent', agent.name, '--mcp-config', mcpConfigPath, '--strict-mcp-config',
    '--allowedTools', 'mcp__vault', '--disallowedTools', 'Write', 'Edit', 'NotebookEdit', 'Bash', '--permission-mode', 'dontAsk', '--tools', ''];   // --tools "": no built-in tools at all (MCP tools stay)
  if (agent.model) a.push('--model', agent.model);
  return a;
}

export function geminiArgs(o: { model: string; text: string; sessionId: string; resume: boolean }): string[] {
  // only the vault MCP server, no extensions, never auto-approve (the user's own Gemini settings might say yolo)
  return ['-o', 'stream-json', '-m', o.model, '--allowed-mcp-server-names', 'vault', '-e', 'none', '--approval-mode', 'default',
    o.resume ? '--resume' : '--session-id', o.sessionId, '-p', o.text];
}

/** Gemini CLI as a long-running --acp process: only the vault MCP server, no extensions, never auto-approve. */
export function geminiAcpArgs(model: string): string[] {
  return ['--acp', '-m', model, '--allowed-mcp-server-names', 'vault', '-e', 'none', '--approval-mode', 'default'];
}

/** Gemini has no agent files, so the agent's instructions travel ahead of the first message. */
export function firstGeminiMessage(agent: AgentDef, text: string): string {
  return `<agent instructions>\n${agent.body.trim()}\n</agent instructions>\n\n${text}`;
}

/** Written to .claude/vault-mcp.json and passed with --mcp-config, so Claude needs no folder-trust step. */
export const vaultMcpConfig = (port: number, token: string) => mergeMcpJson(null, port, token);

const addAll = (list: unknown, add: string[]) => {
  const base = Array.isArray(list) ? list.map(String) : typeof list === 'string' ? [list] : [];
  return [...base, ...add.filter(x => !base.includes(x))];
};

/** Gemini CLI's built-in tools (names from @google/gemini-cli 0.70). All are switched off, so a Gemini agent, like a Claude one,
    only has the vault tools: built-in reads would otherwise reach files the vault tools hide (e.g. plugin data with tokens). */
export const GEMINI_BLOCKED = [
  'write_file', 'replace', 'run_shell_command', 'read_file', 'read_many_files', 'list_directory', 'glob', 'grep_search',
  'web_fetch', 'google_web_search', 'activate_skill', 'invoke_agent', 'write_todos', 'save_memory', 'ask_user', 'get_internal_docs',
  'take_snapshot', 'update_topic', 'enter_plan_mode', 'exit_plan_mode', 'list_background_processes', 'read_background_output',
  'tracker_add_dependency', 'tracker_create_task', 'tracker_get_task', 'tracker_list_tasks', 'tracker_update_task', 'tracker_visualize',
];

/** Merges the vault server, the write/shell tool exclusions and CLAUDE.md as context into <vault>/.gemini/settings.json. */
export function mergeGeminiSettings(existing: string | null, port: number, token: string): string {
  let s: any = {};
  try { s = existing ? JSON.parse(existing) : {}; } catch { s = {}; }
  if (!s || typeof s !== 'object' || Array.isArray(s)) s = {};
  const obj = (k: string) => (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]) ? s[k] : (s[k] = {}));
  obj('mcpServers').vault = { httpUrl: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: `Bearer ${token}` }, trust: true };
  obj('tools').exclude = addAll(s.tools.exclude, GEMINI_BLOCKED);
  obj('context').fileName = addAll(s.context.fileName, ['CLAUDE.md', 'GEMINI.md']);
  return JSON.stringify(s, null, 2) + '\n';
}
