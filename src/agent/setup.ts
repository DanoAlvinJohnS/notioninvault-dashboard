// Files Claude Code reads from the vault root. Written once if missing (the user may edit them); .mcp.json is merged on every start.

export function mergeMcpJson(existing: string | null, port: number, token: string): string {
  let data: any = {};
  try { data = existing ? JSON.parse(existing) : {}; } catch { data = {}; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
  if (!data.mcpServers || typeof data.mcpServers !== 'object') data.mcpServers = {};
  data.mcpServers.vault = { type: 'http', url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: `Bearer ${token}` } };
  return JSON.stringify(data, null, 2) + '\n';
}

export const CLAUDE_MD = `# This vault

A student's personal Obsidian vault: college work, projects, tasks, and Canvas LMS assignments.
You work here as one of the user's agents (see \`.claude/agents/\`).

## Read cheaply
- Start with \`vault_map\` (one line per note) or \`search\`. Only call \`read_note\` for notes you need,
  and pass \`section\` when one heading is enough.
- Use \`related_notes\` to find notes that belong together but are not linked yet.
- Use \`list_tasks\` and \`canvas_items\` for schedules instead of reading task notes one by one.

## Never change files directly
- Every change goes through a \`propose_*\` tool and waits for the user's approval on the Review page.
- After proposing, tell the user briefly what you queued and why. Do not claim it is done.
- Always pass your agent name as \`agent\` and one clear sentence as \`reason\`.
- At the start of a session, call \`proposal_feedback\` and adjust to what the user rejected or edited.

## Task notes
Tasks live in \`Tasks/\`, one note each, with this frontmatter:

\`\`\`yaml
type: task
status: todo        # todo | doing | done
created: 2026-11-21
order: 3
due: 2026-11-27     # optional, YYYY-MM-DD
project: "[[DSC Secretary]]"
related:
  - "[[DSC Secretary]]"
canvas_id: 12345    # only for tasks made from a Canvas assignment
\`\`\`

The body starts with \`# Title\`, then details, then a \`Related: [[...]]\` line.
Use \`propose_task\` and \`propose_task_update\`; they write this format for you.

## Conventions
- Keep the user's own words and tone when improving a note; fix structure, not voice.
- Prefer moving loose files at the vault root into a fitting folder over creating new folders.
- Deleting means Obsidian's trash (recoverable), and still needs approval.
`;

export const SETTINGS_JSON = JSON.stringify({
  enabledMcpjsonServers: ['vault'],
  permissions: {
    allow: ['mcp__vault'],
    deny: ['Write', 'Edit', 'NotebookEdit', 'Bash', 'Read(./.obsidian/**)', 'Read(./.smart-env/**)', 'Read(./graphify-out/**)', 'Read(./System/**)', 'Read(**/node_modules/**)'],
  },
}, null, 2) + '\n';

export const SECRETARY_MD = `---
name: secretary
description: The user's Secretary. Sorts and files documents, schedules tasks from notes and Canvas assignments, improves messy notes, and links related notes. Use when the user talks to "Secretary" or asks to organise, schedule or tidy the vault.
tools: mcp__vault__*
model: sonnet
---

You are Secretary, a calm and organised personal assistant for this Obsidian vault.

Your jobs:
1. **Sort and file.** Find loose or misplaced files (start with \`vault_map\`) and propose moves or renames into fitting folders.
   Turn loose \`.txt\` files into proper notes with \`propose_create_note\` (with \`from\`).
2. **Schedule.** Turn deadlines in notes and upcoming \`canvas_items\` into tasks with \`propose_task\`
   (set \`canvas_id\` for Canvas items, link the project note).
3. **Improve notes.** When asked, rewrite a messy note into a clearer one with \`propose_edit\`: headings, lists, fixed typos.
   Keep the user's voice and every fact; never invent content.
4. **Connect.** Use \`related_notes\` to suggest links the user had not made, with \`propose_link\`.

How you work:
- Call \`proposal_feedback\` with agent "secretary" first and respect what the user rejected.
- Batch related proposals (for example one per file in a folder clean-up), each with one clear reason.
- End with a short summary: what you queued, and anything you need the user to decide.
`;

export const AGENT_TEMPLATE_MD = `<!--
Template for a new agent. Copy this file into .claude/agents/<name>.md to activate it,
then fill in the frontmatter and the instructions below.

- name: lowercase, no spaces (it appears in the agent menu)
- description: what the agent does and when to use it (Claude reads this)
- tools: mcp__vault__* gives the vault tools (reading plus propose_*). Agents cannot write files directly.
- model: haiku for cheap jobs (sorting, clean-up, tagging); sonnet for writing and finding connections.
-->
---
name: my-agent
description: One sentence on what this agent does and when to use it.
tools: mcp__vault__*
model: haiku
---

You are <Name>, ...

Your jobs:
1. ...

How you work:
- Call \`proposal_feedback\` with your agent name first.
- Read cheaply: \`vault_map\` or \`search\` before \`read_note\`.
- Every change is a \`propose_*\` call; tell the user what you queued.
`;

const FILES: [string, string][] = [
  ['CLAUDE.md', CLAUDE_MD],
  ['.claude/settings.json', SETTINGS_JSON],
  ['.claude/agents/secretary.md', SECRETARY_MD],
  ['.claude/agent-template.md', AGENT_TEMPLATE_MD],
];

/** The setup files that do not exist yet. Existing files are never overwritten: the user may have edited them. */
export function setupPlan(exists: (p: string) => boolean): { path: string; text: string }[] {
  return FILES.filter(([p]) => !exists(p)).map(([path, text]) => ({ path, text }));
}
