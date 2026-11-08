import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startTestPackBuildWatcher, WATCH_REBUILD_BUDGET_MS, type TestPackBuildWatcher } from '../_support/watch-builds.ts';
import { runtimePack, vueRuntimePack } from '../_support/frontend-pack.ts';
import { shareCompilerInstallation } from '../_support/shared-compiler.ts';
import { cpuBudget } from '@apackdev/testing/vitest';
import { _settles } from '@apackdev/sdk/testing/waiting';

const sharedCompiler = shareCompilerInstallation();

// The live-watcher half of package-inputs.integration.spec.ts: an undeclared runtime import rebuilt on its own edit
let root: string | undefined;
let signal: AbortSignal;
let starting: ReturnType<typeof startTestPackBuildWatcher> | undefined;
beforeEach(context => { signal = context.signal; });
afterEach(async () => {
  const pending = starting;
  starting = undefined;
  try { await pending?.then(watcher => watcher.close(), () => {}); }
  finally { vi.restoreAllMocks(); }
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function runtimeConsumer() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-imported-runtime-'));
  return runtimePack(root);
}

function vueRuntimeConsumer() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-imported-runtime-'));
  return vueRuntimePack(root, 'inline');
}

it.each([
  { name: 'TypeScript state', create: runtimeConsumer },
  { name: 'Vue canvas', create: vueRuntimeConsumer },
])('automatically rebuilds an undeclared runtime imported by $name without a type or authored edit', { meta: cpuBudget(120_000 + WATCH_REBUILD_BUDGET_MS + 20_000) }, async ({ create }) => {
  const { pack, helper, frontend } = create();
  let watcher: TestPackBuildWatcher | undefined;
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  let publications = 0;
  try {
    starting = startTestPackBuildWatcher(pack, {
      captureCompiler: sharedCompiler.capture,
      signal,
      place: { env: 'test', userDataDir: path.join(root!, 'profile') },
      onBuilt: async () => { publications++; },
    });
    watcher = await starting;
    expect(fs.readFileSync(frontend, 'utf8')).toContain('BEFORE');
    await watcher.rebuildAfter(() => { fs.writeFileSync(helper, "export const marker = 'AFTERX';"); });
    await _settles(() => expect(publications > 0 || errors.mock.calls.length > 0).toBe(true));
    expect(errors.mock.calls).toEqual([]);
    expect(fs.readFileSync(frontend, 'utf8')).toContain('AFTERX');
    expect(fs.readFileSync(frontend, 'utf8')).not.toContain('BEFORE');
  } finally { await watcher?.close(); }
});
