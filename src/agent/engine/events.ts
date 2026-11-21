// Reads each engine's `--output-format stream-json` lines into one ChatEvent stream, and turns known failures into one plain sentence.
import type { ChatEvent, EngineName } from './types.ts';
import { ENGINE_LABEL } from './types.ts';

const PROGRAM: Record<EngineName, string> = { claude: 'Claude Code', gemini: 'Gemini CLI' };
export const MSG = {
  missing: (e: EngineName) => `${PROGRAM[e]} isn't installed or wasn't found. Set its path in Settings > NotionInVault Dashboard.`,
  claudeLogin: `Claude Code isn't signed in. Run "claude" in a terminal once and log in.`,
  geminiKey: 'Gemini rejected the API key. Check GEMINI_API_KEY (or the key in Gemini CLI\'s settings).',
  rate: (e: EngineName) => `The ${ENGINE_LABEL[e]} rate limit was reached. Wait a bit or switch this agent to the other engine.`,
  vault: "The vault tools aren't reachable. Keep Obsidian open and reload the plugin.",
};

export function classifyError(engine: EngineName, text: string): string | null {
  if (/ENOENT/.test(text)) return MSG.missing(engine);
  if (engine === 'gemini' && /API key not valid|API_KEY_INVALID|"code":\s*401|\b401\b/.test(text)) return MSG.geminiKey;
  if (/\b429\b|RESOURCE_EXHAUSTED|rate limit/i.test(text)) return MSG.rate(engine);
  if (engine === 'claude' && /not logged in|Invalid API key|\/login/i.test(text)) return MSG.claudeLogin;
  return null;
}

const MAX_RESULT = 2000;
/** Tool result text, cut short; the key is left out when there is none. */
const withText = (ev: ChatEvent, t: unknown, id?: unknown): ChatEvent => {
  const o: any = { ...ev };
  if (typeof id === 'string' && id) o.id = id;
  if (typeof t === 'string' && t) o.text = t.slice(0, MAX_RESULT);
  return o;
};
const partsText = (c: any): string => typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x: any) => x?.type === 'text' && typeof x.text === 'string').map((x: any) => x.text).join('') : '';

const parse = (line: string): any => { try { const j = JSON.parse(line); return j && typeof j === 'object' ? j : null; } catch { return null; } };

export function claudeEvents(line: string): ChatEvent[] {
  const m = parse(line);
  if (!m) return [];
  switch (m.type) {
    case 'system':
      if (m.subtype !== 'init') return [];
      return [{ type: 'start', sessionId: String(m.session_id ?? ''), engine: 'claude', model: String(m.model ?? ''),
        toolsOk: (m.mcp_servers ?? []).some((s: any) => s?.name === 'vault' && s?.status === 'connected') }];
    case 'stream_event': {
      const e = m.event;
      return e?.type === 'content_block_delta' && e.delta?.type === 'text_delta' ? [{ type: 'delta', text: String(e.delta.text ?? '') }] : [];
    }
    case 'assistant':
      return (m.message?.content ?? []).filter((c: any) => c?.type === 'tool_use').map((c: any) => withText({ type: 'tool', name: String(c.name ?? ''), status: 'call' }, undefined, c.id));
    case 'user':
      return (m.message?.content ?? []).filter((c: any) => c?.type === 'tool_result').map((c: any) => withText({ type: 'tool', name: '', status: c.is_error ? 'error' : 'ok' }, partsText(c.content), c.tool_use_id));
    case 'result': {
      const out: ChatEvent[] = (m.permission_denials ?? []).map((d: any) => ({ type: 'denied', tool: String(d?.tool_name ?? '') }) as ChatEvent);
      if (m.is_error) out.push({ type: 'error', message: classifyError('claude', String(m.result ?? '')) ?? String(m.result || 'Claude Code reported an error.') });
      out.push({ type: 'done', costUsd: typeof m.total_cost_usd === 'number' ? m.total_cost_usd : undefined });
      return out;
    }
    default: return [];
  }
}

export function geminiEvents(line: string): ChatEvent[] {
  const m = parse(line);
  if (!m) { const c = classifyError('gemini', line); return c ? [{ type: 'error', message: c }] : []; }
  switch (m.type) {
    case 'init': return [{ type: 'start', sessionId: String(m.session_id ?? ''), engine: 'gemini', model: String(m.model ?? ''), toolsOk: true }];
    case 'message':
      if (m.role !== 'assistant') return [];
      return [m.delta ? { type: 'delta', text: String(m.content ?? '') } : { type: 'message', text: String(m.content ?? '') }];
    case 'tool_use': return [withText({ type: 'tool', name: String(m.tool_name ?? ''), status: 'call' }, undefined, m.tool_id)];
    case 'tool_result': return [withText({ type: 'tool', name: '', status: m.status === 'error' ? 'error' : 'ok' }, m.output, m.tool_id)];
    case 'error': {
      const text = String(m.message ?? m.error?.message ?? 'Gemini CLI reported an error.');
      return [{ type: 'error', message: classifyError('gemini', text) ?? text }];
    }
    case 'result': {
      if (m.status !== 'error') return [{ type: 'done' }];
      const text = String(m.error?.message ?? 'Gemini CLI reported an error.');
      return [{ type: 'error', message: classifyError('gemini', text) ?? text }, { type: 'done' }];
    }
    default: return [];
  }
}

/** Text inside ACP content: { type: 'text', text } or { type: 'content', content: {...} }, possibly in a list. */
const acpText = (c: any): string => Array.isArray(c) ? c.map(acpText).filter(Boolean).join('\n')
  : c?.type === 'text' ? String(c.text ?? '') : c?.content ? acpText(c.content) : '';

/** Gemini CLI --acp: session/update notifications → ChatEvents (requests and responses are handled by the engine). */
export function acpEvents(m: any): ChatEvent[] {
  if (m?.method !== 'session/update') return [];
  const u = m.params?.update;
  switch (u?.sessionUpdate) {
    case 'agent_message_chunk': { const t = acpText(u.content); return t ? [{ type: 'delta', text: t }] : []; }
    case 'tool_call': return [withText({ type: 'tool', name: String(u.toolCallId ?? '').replace(/__call_.*$/, ''), status: 'call' }, undefined, u.toolCallId)];
    case 'tool_call_update':
      if (u.status === 'completed') return [withText({ type: 'tool', name: '', status: 'ok' }, acpText(u.content) || undefined, u.toolCallId)];
      if (u.status === 'failed') return [withText({ type: 'tool', name: '', status: 'error' }, acpText(u.content) || undefined, u.toolCallId)];
      return [];
    default: return [];   // thoughts, usage, available commands
  }
}
