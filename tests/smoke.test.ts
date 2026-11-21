import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFolders } from '../src/folders.ts';

test('pure modules load under node --test', () => {
  assert.ok(Array.isArray(buildFolders([], [])));
});
