import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineDiff } from '../src/agent/diff.ts';

test('lineDiff marks a changed line as remove then add', () => {
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nx\nc'), [
    { op: ' ', line: 'a' }, { op: '-', line: 'b' }, { op: '+', line: 'x' }, { op: ' ', line: 'c' },
  ]);
});

test('lineDiff handles added and removed tails and CRLF', () => {
  assert.deepEqual(lineDiff('a\r\nb', 'a\nb\nc'), [{ op: ' ', line: 'a' }, { op: ' ', line: 'b' }, { op: '+', line: 'c' }]);
  assert.deepEqual(lineDiff('a\nb', 'a'), [{ op: ' ', line: 'a' }, { op: '-', line: 'b' }]);
});
