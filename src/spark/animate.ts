// Which frame of a pose to draw after `msInPose` milliseconds. Pure.
import { frameCount } from './frames.ts';
import type { Pose } from './frames.ts';

export const FRAME_MS: Record<Pose, number> = {
  idle: 450, walk: 180, run: 90, sit: Infinity, sleep: 900, think: 250, talk: 160, happy: 150, wave: 200,
};

export function frameAt(pose: Pose, msInPose: number, reduced = false): number {
  const n = frameCount(pose);
  if (reduced || n <= 1 || !(msInPose > 0)) return 0;
  return Math.floor(msInPose / FRAME_MS[pose]) % n;
}
