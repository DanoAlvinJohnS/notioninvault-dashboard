import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sparkHost } from '../src/spark/host.ts';

const handle = () => { const h = { destroyed: 0, destroy() { h.destroyed++; } }; return h; };

test('mount twice mounts once', () => {
  const host = sparkHost(); let made = 0;
  host.mount(() => { made++; return handle(); });
  host.mount(() => { made++; return handle(); });
  assert.equal(made, 1);
});

test('unmount destroys and allows a new mount', () => {
  const host = sparkHost(), a = handle(), b = handle();
  host.mount(() => a);
  host.unmount();
  assert.equal(a.destroyed, 1);
  host.mount(() => b);
  assert.equal(b.destroyed, 0);
  host.unmount(); host.unmount();
  assert.equal(b.destroyed, 1);
});

test('mounted reflects state', () => {
  const host = sparkHost();
  assert.equal(host.mounted(), false);
  host.mount(handle);
  assert.equal(host.mounted(), true);
  host.unmount();
  assert.equal(host.mounted(), false);
});
