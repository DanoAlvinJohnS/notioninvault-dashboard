// Spark's behaviour as a pure state machine: what it does and where it stands, from time and events. No DOM.
import type { Pose } from './frames.ts';

export type SparkMode = 'roam' | 'sit' | 'sleep';
export interface World { width: number; height: number; cursorX: number; reduced: boolean; bubbleOpen: boolean }
export type SparkEvent =
  | { type: 'typing' } | { type: 'pending'; count: number } | { type: 'busy'; on: boolean }
  | { type: 'approved' } | { type: 'reply' } | { type: 'start' } | { type: 'newsSeen' }
  | { type: 'dragStart' } | { type: 'dragEnd'; x: number; y: number } | { type: 'mode'; mode: SparkMode };
export interface SparkState { pose: Pose; x: number; y: number; facing: 1 | -1; mode: SparkMode; hint: number }

export const MIN_X = 8, EDGE = 64, TOP_EDGE = 60;   // y = pixels above the ground
const WALK = 30, RUN = 160;
const MAX_DT = 250, TYPING_MS = 2500, HAPPY_MS = 1500, WAVE_MS = 1800, TALK_MS = 3000;
const SIT_MS = 25_000, SLEEP_MS = 90_000, NAP_MS = 60_000, WANDER_MIN = 4000, WANDER_SPAN = 5000;

interface Run { kind: 'pending' | 'reply'; count: number; target: number | null }

export function createBrain(o: { x: number; y?: number; mode: SparkMode; width: number; height?: number; random?: () => number; now?: () => number }) {
  const rnd = o.random ?? Math.random;
  let width = o.width, height = o.height ?? 10_000, x = o.x, y = Math.max(0, o.y ?? 0), facing: 1 | -1 = -1, mode = o.mode, hint = 0, pose: Pose = 'idle';
  let cursorX = o.x, bubbleOpen = false;
  let typingLeft = 0, waveLeft = 0, happyLeft = 0, talkLeft = 0, idleMs = 0;
  let wanderLeft = WANDER_MIN + rnd() * WANDER_SPAN;
  let walkTarget: number | null = null, run: Run | null = null;
  let busy = false, dragging = false, awake = false, lastCount = 0;

  const maxX = () => Math.max(MIN_X, width - EDGE);
  const clamp = (v: number) => Math.min(maxX(), Math.max(MIN_X, v));
  const clampY = (v: number) => Math.min(Math.max(0, height - TOP_EDGE), Math.max(0, v));
  const face = (to: number) => { if (to !== x) facing = to > x ? 1 : -1; };
  const stopMoving = () => { walkTarget = null; run = null; };

  // News: run to a corner when roaming; otherwise (parked, asleep) speak in place.
  function news(kind: 'pending' | 'reply', count: number) {
    idleMs = 0; awake = true; walkTarget = null;
    if (mode === 'roam') run = { kind, count, target: null };
    else { run = null; hint = count; talkLeft = TALK_MS; }
  }

  function on(e: SparkEvent) {
    switch (e.type) {
      case 'start': waveLeft = WAVE_MS; idleMs = 0; break;
      case 'typing': typingLeft = TYPING_MS; walkTarget = null; break;
      case 'pending': {
        const up = e.count > lastCount; lastCount = e.count;
        if (e.count === 0) { hint = 0; talkLeft = 0; if (run?.kind === 'pending') run = null; else if (run) run.count = 0; if (!run) awake = false; }
        else if (up && !bubbleOpen) news('pending', e.count);
        else if (run?.kind === 'pending') run.count = e.count;
        else if (hint > 0) hint = e.count;
        break;
      }
      case 'reply': if (!bubbleOpen) news('reply', Math.max(run?.count ?? 0, hint, lastCount)); break;
      case 'busy': busy = e.on; idleMs = 0; if (e.on) walkTarget = null; break;
      case 'approved': happyLeft = HAPPY_MS; idleMs = 0; break;
      case 'newsSeen': hint = 0; talkLeft = 0; run = null; awake = false; break;
      case 'dragStart': dragging = true; stopMoving(); break;
      case 'dragEnd': dragging = false; x = clamp(e.x); y = clampY(e.y); mode = 'sit'; awake = false; idleMs = 0; break;
      case 'mode': {
        mode = e.mode; if (mode === 'roam') y = 0; awake = false; idleMs = 0; walkTarget = null;
        if (run && mode !== 'roam') { hint = run.count; talkLeft = TALK_MS; run = null; }
        break;
      }
    }
  }

  function tick(dtRaw: number, w: World): SparkState {
    const dt = Math.min(Math.max(dtRaw, 0), MAX_DT);
    width = w.width; height = w.height; cursorX = w.cursorX; bubbleOpen = w.bubbleOpen;
    x = clamp(x); y = clampY(y);
    if (walkTarget !== null) walkTarget = clamp(walkTarget);
    typingLeft = Math.max(0, typingLeft - dt);
    const frozen = typingLeft > 0, still = frozen || w.bubbleOpen;   // never move under typing or an open chat bubble
    idleMs += dt;
    if (idleMs >= SLEEP_MS + NAP_MS) idleMs = 0;   // a nap ends: wander again
    const step = (target: number, speed: number) => {
      face(target);
      const d = target - x, m = speed * dt / 1000;
      if (Math.abs(d) <= m) { x = target; return true; }
      x += Math.sign(d) * m; return false;
    };

    if (dragging) { pose = 'idle'; return state(); }
    if (waveLeft > 0) { waveLeft = Math.max(0, waveLeft - dt); pose = 'wave'; return state(); }
    if (happyLeft > 0) { happyLeft = Math.max(0, happyLeft - dt); pose = 'happy'; return state(); }

    if (run) {
      if (still) { pose = 'idle'; return state(); }
      let arrived = w.reduced;
      if (!arrived) {
        if (run.target === null) run.target = clamp(cursorX < width / 2 ? MIN_X : maxX());
        pose = 'run';
        arrived = step(run.target, RUN);
      }
      if (!arrived) return state();
      hint = run.count; talkLeft = TALK_MS; run = null;
    }

    if (talkLeft > 0) { talkLeft = Math.max(0, talkLeft - dt); pose = frozen ? 'idle' : 'talk'; return state(); }
    if (busy) { pose = 'think'; return state(); }
    if (mode === 'sleep') { pose = awake ? 'idle' : 'sleep'; return state(); }

    if (idleMs >= SLEEP_MS) { pose = 'sleep'; walkTarget = null; return state(); }
    if (idleMs >= SIT_MS) { pose = 'sit'; walkTarget = null; return state(); }

    if (mode === 'roam' && !w.reduced && !still) {
      if (walkTarget === null) {
        wanderLeft -= dt;
        if (wanderLeft <= 0) {
          wanderLeft = WANDER_MIN + rnd() * WANDER_SPAN;
          const t = clamp(MIN_X + rnd() * (maxX() - MIN_X));
          if (Math.abs(t - x) >= 4) walkTarget = t;
        }
      }
      if (walkTarget !== null) {
        pose = 'walk';
        if (step(walkTarget, WALK)) { walkTarget = null; pose = 'idle'; }
        return state();
      }
    }
    pose = 'idle';
    return state();
  }

  function state(): SparkState { return { pose, x, y, facing, mode, hint }; }
  return { on, tick, state };
}
