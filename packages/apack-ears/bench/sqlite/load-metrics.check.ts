// Run before admission cohorts: node --experimental-strip-types --test <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { loadedNativeBindings, startHeartbeat } from './load-metrics.ts';

const block = (ms: number) => { const end = performance.now() + ms; while (performance.now() < end) {} };

test('captures a final foreground stall even without yielding afterward', () => {
  const heartbeat = startHeartbeat(2);
  block(35);
  heartbeat.stop();
  assert(heartbeat.delaysMs.some(ms => ms >= 25), JSON.stringify(heartbeat.delaysMs));
  const count = heartbeat.delaysMs.length;
  heartbeat.stop();
  assert.equal(heartbeat.delaysMs.length, count);
});

test('samples independently during a workload and stops cleanly', async () => {
  const heartbeat = startHeartbeat(2);
  try {
    await delay(10);
    assert(heartbeat.delaysMs.length > 0);
    block(35);
    await delay(5);
    assert(heartbeat.delaysMs.some(ms => ms >= 25), JSON.stringify(heartbeat.delaysMs));
  } finally { heartbeat.stop(); }
  const count = heartbeat.delaysMs.length;
  await delay(10);
  assert.equal(heartbeat.delaysMs.length, count);
});

test('does not own process lifetime', () => {
  const module = new URL('./load-metrics.ts', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e',
    `const {startHeartbeat}=await import(${JSON.stringify(module)});startHeartbeat();`], { encoding: 'utf8', timeout: 3000 });
  assert.equal(child.status, 0, child.stderr);
});

test('captures a generically named prebuild and an explicitly loaded extension', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ears-metric-binding-'));
  try {
    const addon = join(dir, 'linux-arm64.node'), extension = join(dir, 'vec0.so');
    writeFileSync(addon, 'abc'); writeFileSync(extension, 'abc');
    t.mock.method(process.report, 'getReport', () => ({ sharedObjects: [addon, extension, '/system/libc.so'] }));
    const bindings = loadedNativeBindings([extension]);
    assert.deepEqual(bindings.map(binding => binding.path), [addon, extension]);
    for (const binding of bindings) assert.equal(binding.sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
