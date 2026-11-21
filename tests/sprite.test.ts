import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPARK_ROWS, LEGS, PALETTE, sparkSvgFrame, sparkSvg, outlined } from '../src/spark/sprite.ts';

const rows = (f: 0 | 1) => [...SPARK_ROWS, LEGS[f]];
const count = (f: 0 | 1) => rows(f).join('').replace(/\./g, '').length;

test('every row is 14 wide and there are 13 with legs', () => {
  assert.equal(SPARK_ROWS.length, 12);
  for (const r of rows(0).concat(rows(1))) assert.equal(r.length, 14);
  assert.equal(rows(0).length, 13);
});

test('svg size follows scale', () => {
  assert.match(sparkSvgFrame(0), /viewBox="0 0 14 13" width="56" height="52" shape-rendering="crispEdges"/);
  assert.match(sparkSvgFrame(0, 2), /width="28" height="26"/);
});

test('frames differ only in the legs row', () => {
  assert.notEqual(sparkSvgFrame(0), sparkSvgFrame(1));
  assert.deepEqual(rows(0).slice(0, 12), rows(1).slice(0, 12));
  assert.notEqual(LEGS[0], LEGS[1]);
});

test('rect count equals non-transparent pixels', () => {
  for (const f of [0, 1] as const) assert.equal((sparkSvgFrame(f).match(/<rect /g) ?? []).length, count(f));
});

test('only palette colours are used', () => {
  const used = new Set([...sparkSvgFrame(0).matchAll(/fill="(#[0-9a-f]{6})"/g)].map(m => m[1]));
  for (const c of used) assert.ok(Object.values(PALETTE).includes(c), c);
  assert.deepEqual(PALETTE, { o: '#d97757', d: '#a9553a', k: '#2a1d17', w: '#fff3e6' });
});

test('outlined adds a one-pixel ring', () => {
  const o = outlined(['.o.', '...']);
  assert.deepEqual(o, ['.lll.', '.lol.', '.lll.', '.....']);
});

test('outlined keeps the body unchanged', () => {
  const rows = [...SPARK_ROWS, LEGS[0]];
  const o = outlined(rows);
  assert.equal(o.length, rows.length + 2);
  assert.equal(o[0].length, rows[0].length + 2);
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] !== '.') assert.equal(o[y + 1][x + 1], r[x]); });
  // transparent cells far from the body stay transparent
  assert.equal(o[0][0], '.');
  assert.ok(o.join('').includes('l'));
});

test('sparkSvg with null outline draws no outline rects', () => {
  const rows = outlined(['o']);
  assert.equal((sparkSvg(rows, 4, null).match(/<rect /g) ?? []).length, 1);
  const withL = sparkSvg(rows, 4, '#ffffff');
  assert.equal((withL.match(/<rect /g) ?? []).length, 9);
  assert.match(withL, /fill="#ffffff"/);
});
