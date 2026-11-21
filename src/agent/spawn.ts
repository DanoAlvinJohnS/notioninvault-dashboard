// The real process spawner (desktop only). Imported with a dynamic import of THIS file, like server.ts:
// esbuild then bundles it lazily and turns node:child_process into a plain require(), which Obsidian's window allows.
// (A dynamic import of 'node:child_process' itself stays a real ES import and fails inside Obsidian.)
import { spawn } from 'node:child_process';
import type { Spawner } from './engine/types.ts';

export const realSpawner: Spawner = (cmd, args, opts) => {
  const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...(opts.env ?? {}) }, shell: false, windowsHide: true });
  const kill = () => {   // the whole process tree: engines may start helpers of their own
    if (child.pid && process.platform === 'win32') spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], { shell: false, windowsHide: true }).on('error', () => child.kill());
    else child.kill();
  };
  return Object.assign(child, { kill }) as any;
};
