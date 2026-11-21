// The tools Claude Code sees through the `vault` MCP server. Read tools return short text; propose_* tools only queue.
import type { VaultPort, ProposalKind } from './types.ts';
import type { ProposalQueue } from './proposals.ts';
import { formatMap, snippetAround, isExcluded, validatePath } from './vaultmap.ts';
import { relatedNotes } from './related.ts';

export interface Tool { name: string; description: string; inputSchema: object; run(args: any): Promise<string> }

export const READ_MAX = 12000;
const TRUNC = '\n…[truncated]';
const FM = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

export { validatePath };

const need = (a: any, ...keys: string[]) => { for (const k of keys) if (typeof a?.[k] !== 'string' || !a[k].trim()) throw new Error(`"${k}" is required`); };
const body = (text: string) => text.replace(FM, '');
const cap = (s: string) => (s.length > READ_MAX ? s.slice(0, READ_MAX) + TRUNC : s);

function section(text: string, name: string): string {
  const lines = text.split(/\r?\n/), want = name.trim().replace(/^#+\s*/, '').toLowerCase();
  const start = lines.findIndex(l => /^#{1,6}\s/.test(l) && l.replace(/^#+\s*/, '').trim().toLowerCase() === want);
  if (start < 0) throw new Error(`No heading "${name}" in this note`);
  const level = lines[start].match(/^#+/)![0].length;
  let end = start + 1;
  while (end < lines.length && !(/^#{1,6}\s/.test(lines[end]) && lines[end].match(/^#+/)![0].length <= level)) end++;
  return lines.slice(start, end).join('\n').trimEnd();
}

const obj = (props: Record<string, object>, required: string[] = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const S = (description: string) => ({ type: 'string', description });
const WHO = { agent: S('Your agent name, e.g. "secretary"'), reason: S('One short sentence the user will read on the Review page') };
const QUEUED = (id: string, kind: string) => `Queued proposal ${id} (${kind}). The user must approve it on the Review page; nothing has changed yet.`;

export function makeTools(port: VaultPort, queue: ProposalQueue): Tool[] {
  const fast = (p: string) => (port.readFast ? port.readFast(p) : port.read(p));
  const propose = (name: string, kind: ProposalKind, description: string, props: Record<string, object>, required: string[], prep: (a: any) => Record<string, any>): Tool => ({
    name, description: description + ' Nothing changes until the user approves it.',
    inputSchema: obj({ ...WHO, ...props }, ['agent', 'reason', ...required]),
    async run(a) { need(a, 'agent', 'reason'); const p = await queue.add(kind, a.agent, a.reason, prep(a)); return QUEUED(p.id, kind); },
  });

  return [
    { name: 'vault_map', description: 'START HERE. One line per note (path | type | status | due | links | excerpt) plus other files. Cheap; use it before reading notes.',
      inputSchema: obj({ folder: S('Only this folder, e.g. "College"') }),
      async run(a) { return formatMap(await port.notes(), await port.files(), a?.folder ? validatePath(a.folder) : undefined); } },
    { name: 'search', description: 'Find notes whose title or text contains a phrase. Returns path | snippet lines, not whole notes.',
      inputSchema: obj({ query: S('Text to look for (case-insensitive)'), limit: { type: 'number', description: 'Max results, default 10, max 50' } }, ['query']),
      async run(a) {
        need(a, 'query');
        const q = a.query.toLowerCase(), limit = Math.min(Math.max(1, Number(a.limit) || 10), 50), out: string[] = [];
        for (const n of (await port.notes()).filter(n => !isExcluded(n.path)).sort((x, y) => x.path.localeCompare(y.path))) {
          const b = body(await fast(n.path));
          if (n.title.toLowerCase().includes(q) || b.toLowerCase().includes(q)) out.push(`${n.path} | ${snippetAround(b, a.query)}`);
          if (out.length >= limit) break;
        }
        return out.join('\n') || 'No matches.';
      } },
    { name: 'read_note', description: 'Read one note (without frontmatter). Pass `section` to read only one heading. Long notes are truncated; call vault_map or search first.',
      inputSchema: obj({ path: S('Vault path, e.g. "Tasks/CEA Chess Nov 27.md"'), section: S('Heading text to read only that part') }, ['path']),
      async run(a) { const t = body(await fast(validatePath(a?.path))); return cap(a.section ? section(t, a.section) : t); } },
    { name: 'related_notes', description: 'Notes that are not linked to this one yet but probably belong together, with why.',
      inputSchema: obj({ path: S('Vault path of the note'), limit: { type: 'number', description: 'Max results, default 10' } }, ['path']),
      async run(a) {
        const r = relatedNotes(validatePath(a?.path), (await port.notes()).filter(n => !isExcluded(n.path)), await port.edges(), Number(a.limit) || 10);
        return r.map(x => `${x.path} | ${x.score} | ${x.why}`).join('\n') || 'Nothing related found.';
      } },
    { name: 'list_tasks', description: 'Task notes as path | status | due, sorted by due date.',
      inputSchema: obj({ status: { type: 'string', enum: ['todo', 'doing', 'done'] }, due_before: S('Only tasks due before this date (YYYY-MM-DD)') }),
      async run(a) {
        const ts = (await port.notes()).filter(n => n.type === 'task' && !isExcluded(n.path))
          .filter(n => !a?.status || n.status === a.status).filter(n => !a?.due_before || (n.due && n.due < a.due_before))
          .sort((x, y) => (x.due || '9999').localeCompare(y.due || '9999') || x.path.localeCompare(y.path));
        return ts.map(n => `${n.path} | ${n.status} | ${n.due}`).join('\n') || 'No tasks.';
      } },
    { name: 'canvas_items', description: 'Upcoming Canvas LMS assignments: id | due | course | title | status. Use the id as canvas_id when proposing a task.',
      inputSchema: obj({ days_ahead: { type: 'number', description: 'Default 14' } }),
      async run(a) { return (await port.canvas(Number(a?.days_ahead) || 14)).map(c => `${c.id} | ${c.due} | ${c.course} | ${c.title} | ${c.status}`).join('\n') || 'No Canvas items.'; } },
    { name: 'proposal_feedback', description: 'What the user decided about your proposals (approved, rejected with a note, stale, failed). Check at the start of a session.',
      inputSchema: obj({ agent: WHO.agent }, ['agent']),
      async run(a) { need(a, 'agent'); return (await queue.feedback(a.agent)).map(f => `${f.id} | ${f.kind} | ${f.status} | ${f.note ?? f.error ?? ''}`).join('\n') || 'No decisions yet.'; } },

    propose('propose_task', 'task', 'Propose a new task note.', {
      title: S('Task title'), due: S('YYYY-MM-DD'), status: { type: 'string', enum: ['todo', 'doing', 'done'] },
      links: { type: 'array', items: { type: 'string' }, description: 'Note names to link, first one is the project' }, details: S('Body text'), canvas_id: S('Canvas item id, if made from Canvas'),
    }, ['title'], a => ({ title: a.title, due: a.due, status: a.status, links: a.links, details: a.details, canvas_id: a.canvas_id })),
    propose('propose_task_update', 'task_update', 'Propose changing a task\'s status or due date, or linking it to a note.', {
      path: S('Task note path'), status: { type: 'string', enum: ['todo', 'doing', 'done'] }, due: S('YYYY-MM-DD'), add_link: S('Note name to link'),
    }, ['path'], a => ({ path: validatePath(a.path), status: a.status, due: a.due, add_link: a.add_link })),
    propose('propose_edit', 'edit', 'Propose a rewritten body for a note (frontmatter is kept). Keep the user\'s voice.', {
      path: S('Note path'), new_body: S('The full new body, without frontmatter'),
    }, ['path', 'new_body'], a => ({ path: validatePath(a.path), new_body: a.new_body })),
    propose('propose_link', 'link', 'Propose linking one note to another (adds [[to]] to its Related line).', {
      from: S('Path of the note that gets the link'), to: S('Name of the note to link to'),
    }, ['from', 'to'], a => ({ from: validatePath(a.from), to: String(a.to).replace(/^\[\[|\]\]$/g, '').trim() })),
    propose('propose_move', 'move', 'Propose moving a file to another folder (links are updated).', {
      path: S('Current path'), new_path: S('New path including file name'),
    }, ['path', 'new_path'], a => ({ path: validatePath(a.path), new_path: validatePath(a.new_path) })),
    propose('propose_rename', 'rename', 'Propose renaming a file in the same folder (links are updated).', {
      path: S('Current path'), new_name: S('New file name with extension, no folders'),
    }, ['path', 'new_name'], a => {
      const path = validatePath(a.path), name = String(a.new_name ?? '').trim();
      if (!name || /[\\/]/.test(name)) throw new Error('"new_name" must be a file name without folders');
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
      return { path, new_path: validatePath(dir + name) };
    }),
    propose('propose_delete', 'delete', 'Propose moving a file to Obsidian\'s trash (recoverable).', {
      path: S('Path of the file'),
    }, ['path'], a => ({ path: validatePath(a.path) })),
    propose('propose_create_note', 'create_note', 'Propose a new Markdown note, e.g. turning a loose .txt into a proper note. With `from`, that file goes to the trash once approved.', {
      path: S('New note path ending in .md'), body: S('Full note text'), from: S('Optional source file to trash afterwards'),
    }, ['path', 'body'], a => {
      const path = validatePath(a.path);
      if (!path.toLowerCase().endsWith('.md')) throw new Error('"path" must end in .md');
      return { path, body: a.body, from: a.from ? validatePath(a.from) : undefined };
    }),
  ];
}
