import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, it, vi } from 'vitest';
import { startTestPackBuildWatcher, WATCH_REBUILD_BUDGET_MS, type TestPackBuildWatcher } from '../_support/watch-builds.ts';
import { runtimePack } from '../_support/frontend-pack.ts';
import { shareCompilerInstallation } from '../_support/shared-compiler.ts';
import { cpuBudget } from '@apackdev/testing/vitest';
import { settles } from '@apackdev/sdk/testing/waiting';

const sharedCompiler = shareCompilerInstallation();

// Long enough for the debounce and the second pass's read of its inputs. A slow machine can only make a repeat build
// land after this wait and pass, never fail a run that built once.
const SECOND_BUILD_WAIT_MS = 20_000;

let root: string;
let signal: AbortSignal;
beforeEach(context => { signal = context.signal; root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-package-edit-')); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

it('publishes one build when a refresh rewrites what the pack builds against', { meta: cpuBudget(120_000 + WATCH_REBUILD_BUDGET_MS + 20_000 + SECOND_BUILD_WAIT_MS) }, async ({ expect }) => {
  const { pack, helper, frontend } = runtimePack(root);
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  // Stands in for a package build: it turns an edited source into what the pack reads
  const refreshPackages = () => {
    const text = fs.readFileSync(helper, 'utf8');
    if (!text.includes('// built')) fs.writeFileSync(helper, `${text}\n// built\n`);
  };
  let publications = 0;
  let watcher: TestPackBuildWatcher | undefined;
  try {
    watcher = await startTestPackBuildWatcher(pack, {
      captureCompiler: sharedCompiler.capture, refreshPackages, packagesState: () => fs.readFileSync(helper, 'utf8'), signal,
      place: { env: 'test', userDataDir: path.join(root, 'profile') },
      onBuilt: async () => { publications++; },
    });
    await watcher.rebuildAfter(() => { fs.writeFileSync(helper, "export const marker = 'AFTERX';"); });
    await settles(() => expect(publications > 0 || errors.mock.calls.length > 0).toBe(true));
    expect(errors.mock.calls).toEqual([]);
    expect(fs.readFileSync(frontend, 'utf8')).toContain('AFTERX');
    await new Promise(resolve => setTimeout(resolve, SECOND_BUILD_WAIT_MS));
    expect(publications).toBe(1);
  } finally { await watcher?.close(); }
});
