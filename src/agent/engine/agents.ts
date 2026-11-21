// Agent files (.claude/agents/*.md): frontmatter name, description, engine, model, gemini_model; the body is the agent's instructions.
import type { AgentDef, EngineName } from './types.ts';

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const ENGINES: EngineName[] = ['claude', 'gemini'];

function field(fm: string, key: string): string | undefined {
  const m = fm.match(new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*\\r?$`, 'm'));
  const v = m?.[1].replace(/^["']|["']$/g, '').trim();
  return v || undefined;
}

export function parseAgentFile(path: string, text: string, defaultEngine: EngineName): AgentDef {
  const m = text.match(FM), fm = m?.[1] ?? '';
  const base = path.replace(/\\/g, '/').split('/').pop()!.replace(/\.md$/i, '');
  const asked = field(fm, 'engine')?.toLowerCase();
  const known = asked && (ENGINES as string[]).includes(asked);
  const a: AgentDef = {
    name: field(fm, 'name') ?? base,
    description: field(fm, 'description') ?? '',
    engine: known ? (asked as EngineName) : defaultEngine,
    body: (m ? text.slice(m[0].length) : text).replace(/\r\n/g, '\n').trim(),
    path,
  };
  const model = field(fm, 'model'), gm = field(fm, 'gemini_model');
  if (model) a.model = model;
  if (gm) a.geminiModel = gm;
  if (asked && !known) a.warning = `Unknown engine "${asked}", using ${defaultEngine}`;
  return a;
}

export function listAgents(files: { path: string; text: string }[], defaultEngine: EngineName): AgentDef[] {
  return files.filter(f => FM.test(f.text)).map(f => parseAgentFile(f.path, f.text, defaultEngine)).sort((a, b) => a.name.localeCompare(b.name));
}
