import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldStartAgents } from '../src/agent/enabled.ts';

test('new install (no data, empty data): agents are off', () => {
  assert.equal(shouldStartAgents(null), false);
  assert.equal(shouldStartAgents(undefined), false);
  assert.equal(shouldStartAgents({}), false);
  assert.equal(shouldStartAgents({ layout: {} }), false);
});

test('existing agent setup keeps working', () => {
  assert.equal(shouldStartAgents({ agent: { token: 'x' } }), true);
  assert.equal(shouldStartAgents({ agent: {} }), true);
});

test('an explicit choice always wins', () => {
  assert.equal(shouldStartAgents({ agent: { token: 'x' }, agentsEnabled: false }), false);
  assert.equal(shouldStartAgents({ agentsEnabled: true }), true);
});

test('a non-boolean flag is ignored', () => {
  assert.equal(shouldStartAgents({ agentsEnabled: 'yes' }), false);
  assert.equal(shouldStartAgents({ agent: {}, agentsEnabled: 1 }), true);
});
