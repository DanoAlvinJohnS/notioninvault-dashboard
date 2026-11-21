import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameAt } from '../src/spark/animate.ts';

test('walk alternates every 180 ms', () => {
  assert.equal(frameAt('walk', 0), 0);
  assert.equal(frameAt('walk', 179), 0);
  assert.equal(frameAt('walk', 180), 1);
  assert.equal(frameAt('walk', 360), 0);
});

test('think steps through 3 frames', () => {
  assert.deepEqual([0, 250, 500].map(t => frameAt('think', t)), [0, 1, 2]);
});

test('sit is a single frame', () => {
  assert.equal(frameAt('sit', 0), 0);
  assert.equal(frameAt('sit', 99_999), 0);
});

test('wraps after the last frame', () => {
  assert.equal(frameAt('wave', 600), 0);
  assert.equal(frameAt('sleep', 1800), 0);
  assert.equal(frameAt('run', 90), 1);
  assert.equal(frameAt('idle', 450), 1);
});

test('negative or fractional time is safe', () => {
  assert.equal(frameAt('talk', -5), 0);
  assert.equal(frameAt('talk', 160.9), 1);
});

test('reduced motion pins frame 0', () => {
  assert.equal(frameAt('walk', 180, true), 0);
  assert.equal(frameAt('think', 500, true), 0);
});
