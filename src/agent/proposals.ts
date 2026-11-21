// The review queue: agents can only *propose* changes; nothing touches the vault until the user approves.
// A proposal remembers a hash of the file it targets; if the file changed since, approving marks it stale instead of overwriting.
import type { Proposal, ProposalKind, ProposalStatus, VaultPort } from './types.ts';
import { addRelatedLink } from './links.ts';
import { validatePath } from './vaultmap.ts';

const KEEP_DECIDED = 200;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ['todo', 'doing', 'done'];
const EDITABLE: Partial<Record<ProposalKind, string[]>> = {
  task: ['title', 'due', 'status', 'links'], task_update: ['status', 'due', 'add_link'], move: ['new_path'], rename: ['new_path'],
};

/** FNV-1a, 32 bit, as 8 hex characters. Only used to notice that a file changed. */
export function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const need = (args: Record<string, any>, ...keys: string[]) => { for (const k of keys) if (!str(args[k])) throw new Error(`"${k}" is required`); };
const isTask = (text: string) => /^---\n[\s\S]*?^type:\s*task\s*$[\s\S]*?\n---/m.test(text);
const canvasIdOf = (text: string) => text.match(/^---\n[\s\S]*?^canvas_id:\s*"?([^"\s]+)"?\s*$/m)?.[1];

function checkTaskFields(a: Record<string, any>) {
  if (a.due !== undefined && a.due !== '' && !DATE.test(String(a.due))) throw new Error('"due" must be YYYY-MM-DD');
  if (a.status !== undefined && !STATUSES.includes(a.status)) throw new Error('"status" must be todo, doing or done');
  if (a.links !== undefined && !Array.isArray(a.links)) throw new Error('"links" must be a list of note names');
}

/** The file whose content the proposal was based on (checked again at approval). */
function baseFile(kind: ProposalKind, a: Record<string, any>): string | undefined {
  if (kind === 'link') return a.from;
  if (kind === 'create_note') return a.from || undefined;
  if (kind === 'task' || kind === 'task_update') return undefined;
  return a.path;
}
/** The path that must not exist yet. */
const targetOf = (kind: ProposalKind, a: Record<string, any>) => (kind === 'move' || kind === 'rename' ? a.new_path : kind === 'create_note' ? a.path : undefined);

export class ProposalQueue {
  port: VaultPort; load: () => Promise<Proposal[]>; save: (p: Proposal[]) => Promise<void>; now: () => number;
  onChange?: (pending: number) => void;
  private seq = 0;
  private chain: Promise<unknown> = Promise.resolve();
  /** Every change runs as one read-change-save step, one at a time: two clicks or two agent calls cannot interleave. */
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const r = this.chain.then(fn);
    this.chain = r.catch(() => {});
    return r;
  }

  constructor(port: VaultPort, load: () => Promise<Proposal[]>, save: (p: Proposal[]) => Promise<void>, now: () => number = Date.now) {
    this.port = port; this.load = load; this.save = save; this.now = now;
  }

  private async all() { return [...((await this.load()) ?? [])]; }
  private async commit(list: Proposal[]) {
    const decided = list.filter(p => p.status !== 'pending').sort((a, b) => (b.decided ?? 0) - (a.decided ?? 0)).slice(0, KEEP_DECIDED);
    const keep = new Set([...list.filter(p => p.status === 'pending'), ...decided]);
    const out = list.filter(p => keep.has(p));
    await this.save(out);
    this.onChange?.(out.filter(p => p.status === 'pending').length);
  }
  private async find(id: string) {
    const list = await this.all(), p = list.find(x => x.id === id);
    if (!p) throw new Error('No such proposal: ' + id);
    return { list, p };
  }

  async list(status?: ProposalStatus) { return (await this.all()).filter(p => !status || p.status === status); }

  add(kind: ProposalKind, agent: string, reason: string, args: Record<string, any>): Promise<Proposal> { return this.locked(() => this.addNow(kind, agent, reason, args)); }
  private async addNow(kind: ProposalKind, agent: string, reason: string, args: Record<string, any>): Promise<Proposal> {
    const a = { ...args }, list = await this.all();
    switch (kind) {
      case 'task': {
        need(a, 'title'); checkTaskFields(a);
        if (a.canvas_id !== undefined && a.canvas_id !== '') {
          a.canvas_id = String(a.canvas_id);
          const taken = list.some(p => p.status === 'pending' && p.kind === 'task' && p.args.canvas_id === a.canvas_id)
            || (await Promise.all((await this.port.notes()).filter(n => n.type === 'task').map(n => this.port.read(n.path)))).some(t => canvasIdOf(t) === a.canvas_id);
          if (taken) throw new Error('Canvas item already has a task');
        }
        break;
      }
      case 'task_update': need(a, 'path'); checkTaskFields(a); if (!isTask(await this.port.read(a.path))) throw new Error('Not a task note: ' + a.path); break;
      case 'edit': need(a, 'path'); if (typeof a.new_body !== 'string') throw new Error('"new_body" is required'); break;
      case 'link': need(a, 'from', 'to'); break;
      case 'move': case 'rename': need(a, 'path', 'new_path'); break;
      case 'delete': need(a, 'path'); break;
      case 'create_note': need(a, 'path'); if (typeof a.body !== 'string') throw new Error('"body" is required'); break;
      default: throw new Error('Unknown proposal kind: ' + kind);
    }
    const bf = baseFile(kind, a), now = this.now();
    const p: Proposal = { id: `${now.toString(36)}${(this.seq++).toString(36)}`, kind, agent: str(agent) || 'agent', reason: str(reason), created: now, status: 'pending', args: a };
    if (bf) p.base = hash(await this.port.read(bf));
    list.push(p);
    await this.commit(list);
    return p;
  }

  editArgs(id: string, patch: Record<string, any>): Promise<Proposal> { return this.locked(() => this.editNow(id, patch)); }
  private async editNow(id: string, patch: Record<string, any>): Promise<Proposal> {
    const { list, p } = await this.find(id);
    if (p.status !== 'pending') throw new Error('Only pending proposals can be edited');
    const ok = EDITABLE[p.kind] ?? [];
    for (const k of Object.keys(patch)) if (!ok.includes(k)) throw new Error(`"${k}" cannot be edited on a ${p.kind} proposal`);
    const next = { ...p.args, ...patch };
    if (p.kind === 'task' || p.kind === 'task_update') checkTaskFields(next);
    if (p.kind === 'task') need(next, 'title');
    if (p.kind === 'move' || p.kind === 'rename') { need(next, 'new_path'); next.new_path = validatePath(next.new_path); }
    p.args = next;
    await this.commit(list);
    return p;
  }

  reject(id: string, note?: string): Promise<void> { return this.locked(() => this.rejectNow(id, note)); }
  private async rejectNow(id: string, note?: string) {
    const { list, p } = await this.find(id);
    if (p.status !== 'pending') return;
    p.status = 'rejected'; p.decided = this.now();
    if (str(note)) p.note = str(note);
    await this.commit(list);
  }

  approve(id: string): Promise<Proposal> { return this.locked(() => this.approveNow(id)); }
  private async approveNow(id: string): Promise<Proposal> {
    const { list, p } = await this.find(id);
    if (p.status !== 'pending') return p;
    try { p.status = await this.apply(p); }
    catch (e: any) { p.status = 'failed'; p.error = e?.message ?? String(e); }
    p.decided = this.now();
    await this.commit(list);
    return p;
  }

  approveAll(): Promise<Proposal[]> {
    return this.locked(async () => {
      const pending = (await this.all()).filter(p => p.status === 'pending').sort((a, b) => a.created - b.created);
      const out: Proposal[] = [];
      for (const p of pending) out.push(await this.approveNow(p.id));
      return out;
    });
  }

  async feedback(agent: string, since = 0) {
    return (await this.all()).filter(p => p.agent === agent && p.status !== 'pending' && (p.decided ?? 0) >= since)
      .map(p => ({ id: p.id, kind: p.kind, status: p.status, note: p.note, error: p.error }));
  }

  /** Applies the change, or returns 'stale' without touching anything when the base file changed. */
  private async apply(p: Proposal): Promise<'approved' | 'stale'> {
    const a = p.args, port = this.port, bf = baseFile(p.kind, a);
    if (bf && p.base !== undefined && hash(await port.read(bf)) !== p.base) { p.error = `${bf} changed since this was proposed`; return 'stale'; }
    const target = targetOf(p.kind, a);
    if (target && port.exists(target)) throw new Error('Target already exists: ' + target);
    switch (p.kind) {
      case 'task': await port.createTask({ title: a.title, due: a.due || undefined, status: a.status, links: a.links, details: a.details, canvas_id: a.canvas_id }); break;
      case 'task_update': await port.updateTask({ path: a.path, status: a.status, due: a.due, add_link: a.add_link }); break;
      case 'edit': await port.writeBody(a.path, a.new_body); break;
      case 'link': {
        const text = await port.read(a.from);
        if (isTask(text)) await port.updateTask({ path: a.from, add_link: a.to });
        else await port.write(a.from, addRelatedLink(text, a.to));
        break;
      }
      case 'move': case 'rename': await port.rename(a.path, a.new_path); break;
      case 'delete': await port.trash(a.path); break;
      case 'create_note': await port.create(a.path, a.body); if (a.from) await port.trash(a.from); break;
    }
    return 'approved';
  }
}
