import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POSES, frameCount, frameRows } from '../src/spark/frames.ts';
import { SPARK_ROWS, LEGS, PALETTE, sparkSvg } from '../src/spark/sprite.ts';

const COUNTS: Record<string, number> = { idle: 2, walk: 2, run: 2, sit: 1, sleep: 2, think: 3, talk: 2, happy: 2, wave: 3 };
const count = (rows: string[], c: string) => rows.join('').split(c).length - 1;

test('every pose has its frame count', () => {
  assert.deepEqual([...POSES].sort(), Object.keys(COUNTS).sort());
  for (const p of POSES) assert.equal(frameCount(p), COUNTS[p], p);
});

test('every frame is 13 rows of 14', () => {
  for (const p of POSES) for (let i = 0; i < frameCount(p); i++) {
    const r = frameRows(p, i);
    assert.equal(r.length, 13, `${p} ${i}`);
    for (const row of r) assert.equal(row.length, 14, `${p} ${i}: ${row}`);
  }
});

test('only palette characters are used', () => {
  for (const p of POSES) for (let i = 0; i < frameCount(p); i++)
    for (const ch of frameRows(p, i).join('')) assert.ok(ch === '.' || ch in PALETTE, `${p} ${i}: ${ch}`);
});

test('idle equals Step 3 frames', () => {
  for (const i of [0, 1]) assert.deepEqual(frameRows('idle', i), [...SPARK_ROWS, LEGS[i as 0 | 1]]);
});

test('sleep closes the eyes', () => {
  for (const i of [0, 1]) {
    const r = frameRows('sleep', i);
    assert.equal(count(r, 'k'), 0);
    assert.equal(count(r, 'w'), 1);
  }
  const z = (i: number) => frameRows('sleep', i).findIndex(row => row[13] === 'w');
  assert.equal(z(1), z(0) - 1);
});

test('think frames add one dot each', () => {
  for (let i = 0; i < 3; i++) assert.equal(count(frameRows('think', i), 'w'), i + 1);
  assert.equal(frameRows('think', 0)[5].includes('k'), true);
});

test('frames of a pose are not all identical', () => {
  for (const p of POSES) {
    if (frameCount(p) < 2) continue;
    const set = new Set(Array.from({ length: frameCount(p) }, (_, i) => frameRows(p, i).join('|')));
    assert.equal(set.size, frameCount(p), p);
  }
});

test('frame index wraps', () => {
  for (const p of POSES) {
    assert.deepEqual(frameRows(p, frameCount(p)), frameRows(p, 0));
    assert.deepEqual(frameRows(p, -1), frameRows(p, frameCount(p) - 1));
  }
});

test('sparkSvg draws given rows with the w colour', () => {
  assert.match(sparkSvg(frameRows('sleep', 0)), /fill="#fff3e6"/);
});
