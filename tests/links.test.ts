import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addRelatedLink } from '../src/agent/links.ts';

test('extends an existing Related: line', () => {
  assert.equal(addRelatedLink('# T\n\nRelated: [[A]]\n\nmore', 'B'), '# T\n\nRelated: [[A]], [[B]]\n\nmore');
});

test('appends a Related: line when there is none', () => {
  assert.equal(addRelatedLink('# T\n\nbody\n\n\n', 'B'), '# T\n\nbody\n\nRelated: [[B]]\n');
});

test('leaves text unchanged when the link is already there', () => {
  const t = '# T\n\nRelated: [[A]], [[B]]\n';
  assert.equal(addRelatedLink(t, 'B'), t);
  assert.equal(addRelatedLink(addRelatedLink('x', 'B'), 'B'), addRelatedLink('x', 'B'));
});
