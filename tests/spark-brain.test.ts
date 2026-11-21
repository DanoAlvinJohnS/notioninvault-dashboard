import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrain } from '../src/spark/brain.ts';
import type { SparkMode, World, SparkEvent } from '../src/spark/brain.ts';

const W = (o: Partial<World> = {}): World => ({ width: 1000, height: 800, cursorX: 500, reduced: false, bubbleOpen: false, ...o });
function make(o: { x?: number; mode?: SparkMode; width?: number; rnd?: number } = {}) {
  const b = createBrain({ x: o.x ?? 500, mode: o.mode ?? 'roam', width: o.width ?? 1000, random: () => o.rnd ?? 0.5 });
  // advance `ms` of time in 100 ms ticks
  const run = (ms: number, w: World = W()) => { let s = b.state(); for (let t = 0; t < ms; t += 100) s = b.tick(100, w); return s; };
  const ev = (...es: SparkEvent[]) => es.forEach(e => b.on(e));
  return { b, run, ev };
}

test('start waves then idles', () => {
  const { b, run, ev } = make(); ev({ type: 'start' });
  assert.equal(run(100).pose, 'wave');
  assert.equal(run(2000).pose, 'idle');
});

test('roams to a random target at walk speed', () => {
  const { b, run } = make({ x: 500, rnd: 0 });   // wander after 4 s, target = 8
  run(3800); assert.equal(b.state().x, 500);
  const s1 = run(1000); assert.equal(s1.pose, 'walk'); assert.equal(s1.facing, -1);
  const moved = 500 - s1.x; assert.ok(moved > 0 && moved <= 30 * 1.1, String(moved));
  const s2 = run(17_000); // 492 px at 30 px/s, done before the 25 s sit
  assert.equal(s2.x, 8);
});

test('sits after 25 s and sleeps after 90 s idle', () => {
  const { run } = make({ rnd: 0 }); // targets are 8: it walks, arrives, then stands
  assert.equal(run(26_000).pose, 'sit');
  assert.equal(run(40_000).pose, 'sit');
  assert.equal(run(30_000).pose, 'sleep');
});

test('typing interrupts a news run, then it continues', () => {
  const { b, run, ev } = make({ x: 500 });
  ev({ type: 'pending', count: 1 });
  const a = run(500, W({ cursorX: 900 })); assert.equal(a.pose, 'run'); assert.ok(a.x > 500);
  ev({ type: 'typing' });
  const x0 = b.state().x;
  const f = run(1000, W({ cursorX: 900 })); assert.equal(f.pose, 'idle'); assert.equal(f.x, x0);
  const r = run(2000, W({ cursorX: 900 })); assert.equal(r.pose, 'run'); assert.ok(r.x > x0);
});

test('pending up runs to the corner nearest the cursor and shows the hint', () => {
  const { run, ev } = make({ x: 500 });
  ev({ type: 'pending', count: 2 });
  let s = run(100, W({ cursorX: 100 }));
  assert.equal(s.pose, 'run'); assert.equal(s.hint, 0); assert.equal(s.facing, -1);
  s = run(4000, W({ cursorX: 100 }));
  assert.equal(s.x, 8); assert.equal(s.hint, 2); assert.equal(s.pose, 'talk');
  s = run(3500, W({ cursorX: 100 })); assert.equal(s.pose, 'idle'); assert.equal(s.hint, 2);
  const r = make({ x: 500 }); r.ev({ type: 'pending', count: 1 });
  assert.equal(r.run(5000, W({ cursorX: 800 })).x, 1000 - 64);
});

test('pending drop to 0 cancels the run and the hint', () => {
  const { b, run, ev } = make({ x: 500 });
  ev({ type: 'pending', count: 1 });
  run(500, W({ cursorX: 900 })); const x0 = b.state().x;
  ev({ type: 'pending', count: 0 });
  const s = run(1000, W({ cursorX: 900 })); assert.equal(s.x, x0); assert.equal(s.hint, 0); assert.notEqual(s.pose, 'run');
  const t = make({ x: 900 }); t.ev({ type: 'pending', count: 1 }); t.run(1000, W({ cursorX: 900 }));
  assert.equal(t.b.state().hint, 1); t.ev({ type: 'pending', count: 0 }); assert.equal(t.run(100).hint, 0);
});

test('several quick pending rises make one run with the latest count', () => {
  const { run, ev } = make({ x: 500 });
  ev({ type: 'pending', count: 1 }, { type: 'pending', count: 2 }, { type: 'pending', count: 3 });
  const s = run(5000, W({ cursorX: 900 }));
  assert.equal(s.hint, 3); assert.equal(s.x, 1000 - 64);
});

test('busy thinks and returns', () => {
  const { run, ev } = make({ rnd: 0 });
  ev({ type: 'busy', on: true }); assert.equal(run(500).pose, 'think');
  ev({ type: 'busy', on: false }); assert.equal(run(100).pose, 'idle');
});

test('approved is happy for 1.5 s', () => {
  const { run, ev } = make(); ev({ type: 'approved' });
  assert.equal(run(1000).pose, 'happy'); assert.notEqual(run(700).pose, 'happy');
});

test('sleep mode wakes for news and sleeps after newsSeen', () => {
  const { b, run, ev } = make({ mode: 'sleep' });
  assert.equal(run(1000).pose, 'sleep');
  ev({ type: 'pending', count: 1 });
  let s = run(100); assert.equal(s.pose, 'talk'); assert.equal(s.hint, 1); assert.equal(s.x, 500);
  s = run(4000); assert.equal(s.pose, 'idle');
  ev({ type: 'newsSeen' }); s = run(100); assert.equal(s.pose, 'sleep'); assert.equal(s.hint, 0);
  ev({ type: 'reply' }); assert.equal(run(100).pose, 'talk');
  assert.equal(b.state().mode, 'sleep');
});

test('sit mode never walks', () => {
  const { run } = make({ mode: 'sit', rnd: 0 });
  const s = run(20_000); assert.equal(s.x, 500); assert.notEqual(s.pose, 'walk');
});

test('drag overrides movement', () => {
  const { b, run, ev } = make({ x: 500, rnd: 0 });
  ev({ type: 'busy', on: true }, { type: 'pending', count: 1 });
  run(300, W({ cursorX: 900 }));
  ev({ type: 'dragStart' });
  const x0 = b.state().x; const s = run(2000, W({ cursorX: 900 }));
  assert.equal(s.x, x0); assert.equal(s.pose, 'idle');
  ev({ type: 'dragEnd', x: 300, y: 0 });
  const e = run(100); assert.equal(e.x, 300); assert.equal(e.mode, 'sit'); assert.equal(e.pose, 'think');
});

test('reduced motion never changes x', () => {
  const { run, ev } = make({ x: 500, rnd: 0 });
  const w = W({ reduced: true, cursorX: 900 });
  assert.equal(run(20_000, w).x, 500);
  ev({ type: 'pending', count: 2 });
  const s = run(200, w); assert.equal(s.x, 500); assert.equal(s.hint, 2); assert.equal(s.pose, 'talk');
});

test('clamps into a smaller window', () => {
  const { run } = make({ x: 900 });
  assert.equal(run(100, W({ width: 400 })).x, 336);
  const t = make({ x: 2 }); assert.equal(t.run(100).x, 8);
  const sm = make({ x: 300, width: 1000 }); assert.equal(sm.run(100, W({ width: 40 })).x, 8);
});

test('large dt is capped', () => {
  const { b, ev } = make({ x: 500 });
  ev({ type: 'pending', count: 1 });
  const s = b.tick(3_600_000, W({ cursorX: 900 }));
  assert.ok(s.x - 500 <= 160 * 0.25 + 0.001, String(s.x));
  assert.equal(s.pose, 'run');
});

test('never walks or runs while the bubble is open', () => {
  const { b, run, ev } = make({ x: 500, rnd: 0 });
  const open = W({ bubbleOpen: true, cursorX: 900 });
  const s = run(10_000, open); assert.equal(s.x, 500); assert.notEqual(s.pose, 'walk');
  const c = make({ x: 500 }); c.ev({ type: 'pending', count: 1 });
  c.run(300, W({ cursorX: 900 })); const x0 = c.b.state().x;
  assert.equal(c.run(1000, open).x, x0);
  assert.equal(c.run(1000, W({ cursorX: 900 })).pose, 'run');
  void b; void ev;
});

test('a reply keeps the pending count (run and hint)', () => {
  const a = make({ x: 500 });
  a.ev({ type: 'pending', count: 1 }, { type: 'reply' });
  assert.equal(a.run(5000, W({ cursorX: 900 })).hint, 1);
  a.ev({ type: 'reply' });
  assert.equal(a.run(5000, W({ cursorX: 900 })).hint, 1);
});

test('roaming wakes again after a nap', () => {
  const { run } = make({ rnd: 0 });
  assert.equal(run(100_000).pose, 'sleep');
  const later = run(60_000);
  assert.notEqual(later.pose, 'sleep');
});

test('drag end sets x and y and sits', () => {
  const { b, run, ev } = make({ x: 500 });
  ev({ type: 'dragStart' }, { type: 'dragEnd', x: 200, y: 300 });
  const s = run(100);
  assert.equal(s.x, 200); assert.equal(s.y, 300); assert.equal(s.mode, 'sit');
  assert.equal(run(30_000).y, 300);
  void b;
});

test('roam returns to the ground', () => {
  const { run, ev } = make({ x: 500 });
  ev({ type: 'dragStart' }, { type: 'dragEnd', x: 200, y: 300 });
  assert.equal(run(100).y, 300);
  ev({ type: 'mode', mode: 'roam' });
  assert.equal(run(100).y, 0);
});

test('free position clamps into the window', () => {
  const { run, ev } = make({ x: 500 });
  ev({ type: 'dragStart' }, { type: 'dragEnd', x: 5000, y: 5000 });
  let s = run(100);
  assert.equal(s.x, 1000 - 64); assert.equal(s.y, 800 - 60);
  ev({ type: 'dragEnd', x: -50, y: -20 });
  s = run(100); assert.equal(s.x, 8); assert.equal(s.y, 0);
  ev({ type: 'dragEnd', x: 900, y: 700 });
  s = run(100, W({ width: 400, height: 300 }));   // window shrinks
  assert.equal(s.x, 336); assert.equal(s.y, 240);
});
