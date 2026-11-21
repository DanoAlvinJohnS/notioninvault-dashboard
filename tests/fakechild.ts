// A fake child process for engine tests: records stdin and spawn calls; the test pushes output and exits.
import type { ChildLike, Spawner } from '../src/agent/engine/types.ts';

export interface FakeChild extends ChildLike {
  written: string[]; ended: boolean; killed: boolean;
  out(s: string): void; err(s: string): void; exit(code: number | null): void; fail(e: Error): void;
}

export function fakeChild(): FakeChild {
  const h: Record<string, ((x: any) => void)[]> = {};
  const add = (k: string) => (e: string, f: (x: any) => void) => { (h[`${k}:${e}`] ??= []).push(f); };
  const fire = (k: string, x: any) => (h[k] ?? []).forEach(f => f(x));
  const c: FakeChild = {
    written: [], ended: false, killed: false,
    stdin: { write: s => { c.written.push(s); }, end: () => { c.ended = true; } },
    stdout: { on: add('out') as any },
    stderr: { on: add('err') as any },
    on: add('proc') as any,
    kill: () => { c.killed = true; },
    out: s => fire('out:data', Buffer.from(s)),
    err: s => fire('err:data', Buffer.from(s)),
    exit: code => fire('proc:exit', code),
    fail: e => fire('proc:error', e),
  };
  return c;
}

export function fakeSpawner() {
  const calls: { cmd: string; args: string[]; cwd: string; env?: Record<string, string>; child: FakeChild }[] = [];
  const spawn: Spawner = (cmd, args, opts) => { const child = fakeChild(); calls.push({ cmd, args, cwd: opts.cwd, env: opts.env, child }); return child; };
  return { spawn, calls };
}
