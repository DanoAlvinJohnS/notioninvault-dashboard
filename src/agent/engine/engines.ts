// The engine programs as child processes. Claude Code: one long-running process per chat, one JSON line per message.
// Gemini CLI: one process per message, the conversation continues with --resume. The spawner is injected (tests use a fake).
import type { AgentDef, ChatEvent, ChildLike, EngineName, Spawner } from './types.ts';
import { claudeEvents, acpEvents, classifyError, MSG } from './events.ts';
import { claudeArgs, geminiAcpArgs, firstGeminiMessage } from './args.ts';

export interface Engine { readonly name: EngineName; send(text: string): void; stop(): void; onEvent: (e: ChatEvent) => void }

const PROGRAM: Record<EngineName, string> = { claude: 'Claude Code', gemini: 'Gemini CLI' };

/** Splits a byte stream into lines, however the chunks fall. */
function lines(onLine: (l: string) => void) {
  let buf = '';
  return (d: any) => {
    buf += typeof d === 'string' ? d : d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); if (l.trim()) onLine(l); }
  };
}

/** Shared turn bookkeeping: at most one error per turn, nothing at all after stop(). */
abstract class Base implements Engine {
  abstract readonly name: EngineName;
  onEvent: (e: ChatEvent) => void = () => {};
  protected stopped = false;
  protected busy = false;
  protected errored = false;
  protected preflight?: () => string | null;

  protected emit(e: ChatEvent) {
    if (this.stopped) return;
    if (e.type === 'error') { if (this.errored) return; this.errored = true; }
    if (e.type === 'done' || e.type === 'error') this.busy = false;   // an error also ends the turn
    this.onEvent(e);
    if (e.type === 'done') this.errored = false;
  }
  protected beginTurn(): boolean {
    const why = this.preflight?.();
    this.errored = false;
    if (why) { this.emit({ type: 'error', message: why }); return false; }
    this.busy = true;
    return true;
  }
  /** A process ended: if a turn was still running and nothing explained it, say what we know. */
  protected ended(code: number | null, stderr: string) {
    if (this.stopped || !this.busy) return;
    this.busy = false;
    if (!this.errored) this.emit({ type: 'error', message: classifyError(this.name, stderr) ?? `${PROGRAM[this.name]} stopped unexpectedly (exit ${code}).` });
  }
  protected watch(child: ChildLike, parse: (l: string) => ChatEvent[], onEvent: (e: ChatEvent) => void, onGone: () => void) {
    let stderr = '';
    child.stdout.on('data', lines(l => {
      if (this.stopped) return;
      const evs = parse(l), failed = evs.some(e => e.type === 'error');
      for (const e of evs) if (!(failed && e.type === 'done')) onEvent(e);   // a failed turn ends with its error, never error + done
    }));
    // stderr only explains an exit: engines also log warnings there ("Attempt 1 failed with status 429. Retrying…") and keep going
    child.stderr.on('data', lines(l => { stderr += l + '\n'; }));
    child.on('error', err => { onGone(); this.emit({ type: 'error', message: classifyError(this.name, `${err.message} ${(err as any).code ?? ''}`) ?? err.message }); });
    child.on('exit', code => { onGone(); this.ended(code, stderr); });
  }
  abstract send(text: string): void;
  abstract stop(): void;
}

export class ClaudeEngine extends Base {
  readonly name = 'claude' as const;
  private o: { spawn: Spawner; exe: string; cwd: string; agent: AgentDef; mcpConfigPath: string };
  private child: ChildLike | null = null;
  private checkedTools = false;

  constructor(o: { spawn: Spawner; exe: string; cwd: string; agent: AgentDef; mcpConfigPath: string; preflight?: () => string | null }) {
    super(); this.o = o; this.preflight = o.preflight;
  }

  send(text: string) {
    if (this.stopped || !this.beginTurn()) return;
    if (!this.child) {
      const child = this.child = this.o.spawn(this.o.exe, claudeArgs(this.o.agent, this.o.mcpConfigPath), { cwd: this.o.cwd });
      this.checkedTools = false;
      this.watch(child, claudeEvents, e => {
        if (e.type === 'start') {
          this.emit(e);
          if (!this.checkedTools) { this.checkedTools = true; if (!e.toolsOk) this.emit({ type: 'error', message: MSG.vault }); }
          return;
        }
        if (e.type === 'done') this.busy = false;
        this.emit(e);
      }, () => { if (this.child === child) this.child = null; });
    }
    this.child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n');
  }

  stop() { this.stopped = true; this.child?.kill(); this.child = null; }
}

export class GeminiEngine extends Base {
  readonly name = 'gemini' as const;
  private o: { spawn: Spawner; node: string; script: string; cwd: string; agent: AgentDef; model: string; newId: () => string };
  private child: ChildLike | null = null;

  constructor(o: { spawn: Spawner; node: string; script: string; cwd: string; agent: AgentDef; model: string; newId: () => string; preflight?: () => string | null }) {
    super(); this.o = o; this.preflight = o.preflight;
  }

  // Gemini CLI in --acp mode: one process per chat (no ~3 s start-up per message), JSON-RPC over stdin/stdout.
  private nextId = 0;
  private pending = new Map<number, (m: any) => void>();
  private ready: Promise<string> | null = null;   // resolves to the session id
  private first = true;

  private rpc(child: ChildLike, method: string, params: unknown): Promise<any> {
    const id = ++this.nextId;
    return new Promise(res => { this.pending.set(id, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  }
  private fail(err: any) {
    const text = String(err?.message ?? err ?? 'Gemini CLI reported an error.');
    this.emit({ type: 'error', message: classifyError('gemini', text) ?? text });
  }
  private onLine(child: ChildLike, line: string): ChatEvent[] {
    let m: any;
    try { m = JSON.parse(line); } catch { return []; }
    if (m?.id !== undefined && !m.method) { const r = this.pending.get(m.id); if (r) { this.pending.delete(m.id); r(m); } return []; }
    if (m?.method === 'session/request_permission') {   // anything that needs a yes is refused: agents only get the vault tools
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { outcome: { outcome: 'cancelled' } } }) + '\n');
      return [{ type: 'denied', tool: String(m.params?.toolCall?.title ?? 'a tool') }];
    }
    return acpEvents(m);
  }
  private startProcess(): ChildLike {
    const model = this.o.agent.geminiModel ?? this.o.model;
    // GEMINI_CLI_NO_RELAUNCH: otherwise gemini.js starts a second node process that kill() would not reach
    const child = this.child = this.o.spawn(this.o.node, [this.o.script, ...geminiAcpArgs(model)], { cwd: this.o.cwd, env: { GEMINI_CLI_NO_RELAUNCH: 'true' } });
    this.first = true;
    this.pending = new Map();
    this.watch(child, l => this.onLine(child, l), e => this.emit(e),
      () => { if (this.child === child) { this.child = null; this.ready = null; this.pending.clear(); } });
    this.ready = (async () => {
      const init = await this.rpc(child, 'initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } });
      if (init.error) throw init.error;
      const s = await this.rpc(child, 'session/new', { cwd: this.o.cwd, mcpServers: [] });
      if (s.error) throw s.error;
      return String(s.result?.sessionId ?? '');
    })();
    this.ready.catch(() => {});   // reported by the send() that waits for it
    return child;
  }

  send(text: string) {
    if (this.stopped || !this.beginTurn()) return;
    const child = this.child ?? this.startProcess();
    const first = this.first, model = this.o.agent.geminiModel ?? this.o.model;
    this.first = false;
    const prompt = first ? firstGeminiMessage(this.o.agent, text) : text;
    const live = () => !this.stopped && this.child === child;
    this.ready!.then(async sessionId => {
      if (!live()) return;
      if (first) this.emit({ type: 'start', sessionId, engine: 'gemini', model, toolsOk: true });
      const r = await this.rpc(child, 'session/prompt', { sessionId, prompt: [{ type: 'text', text: prompt }] });
      if (!live()) return;
      if (r.error) this.fail(r.error); else this.emit({ type: 'done' });
    }, err => { if (live()) this.fail(err); });
  }

  stop() { this.stopped = true; this.child?.kill(); this.child = null; }
}
