import fs from 'node:fs';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createFrontendResourceFixture, readFrontendOutput } from '../_support/frontend-resources.ts';
import { WATCH_REBUILD_BUDGET_MS, type TestPackBuildWatcher } from '../_support/watch-builds.ts';
import { readPackBuild } from '@apackdev/host/packs';
import { bundlePackFE } from '../../src/build/fe-bundler.ts';
import { createFrontendWatcher } from '../../src/build/frontend-watch.ts';
import { cpuBudget } from '@apackdev/testing/vitest';
import { _settles } from '@apackdev/sdk/testing/waiting';

const fixture = createFrontendResourceFixture();
const { consumer } = fixture;

it.each(['url', 'import', 'nested'] as const)('watches external %s worker dependencies', async kind => {
  const { pack } = consumer();
  const helper = path.join(fixture.root, 'worker-value.ts');
  fs.writeFileSync(helper, 'export const marker = "WORKER_BEFORE";');
  const workerSource = 'import { marker } from "./worker-value.ts"; self.postMessage(marker);';
  fs.writeFileSync(path.join(fixture.root, 'worker.ts'), kind === 'nested'
    ? 'new Worker(new URL("./nested-worker.ts", import.meta.url), { type: "module" });' : workerSource);
  const pages = path.join(fixture.root, 'worker-pages');
  if (kind === 'nested') {
    fs.mkdirSync(pages);
    fs.writeFileSync(path.join(fixture.root, 'nested-worker.ts'), `${workerSource} self.postMessage(import.meta.glob("./worker-pages/**/*.js", { eager: true }));`);
  }
  const entryPoint = path.join(pack, 'src/canvas.vue');
  const script = kind !== 'import'
    ? 'const worker = new Worker(new URL("../../worker.ts", import.meta.url), { type: "module" });'
    : 'import Worker from "../../worker.ts?worker"; const worker = new Worker();';
  fs.writeFileSync(entryPoint, `<script setup>${script}</script><template><div>{{ worker }}</div></template>`);
  const changed = vi.fn();
  const failures: Error[] = [];
  const watcher = createFrontendWatcher(pack, undefined, changed, error => { failures.push(error); });
  let lastFiles: readonly string[] = [];
  const compile = async () => {
    const outputDir = path.join(pack, 'dist/runtime');
    fs.rmSync(outputDir, { recursive: true, force: true });
    const result = await bundlePackFE({ packDir: pack, entryPoint, outputDir,
      onInputs: async inputs => { lastFiles = inputs.files; await watcher.observe(inputs); } });
    expect(result.success, result.error).toBe(true);
  };
  try {
    await compile();
    expect(readFrontendOutput(pack, '.js')).toContain('WORKER_BEFORE');
    const before = watcher.snapshot();
    fs.writeFileSync(helper, 'export const marker = "WORKER_AFTER";');
    await _settles(() => expect(changed).toHaveBeenCalled());
    expect(before.current()).toBe(false);
    await compile();
    expect(lastFiles).toContain(fs.realpathSync(helper));
    expect(readFrontendOutput(pack, '.js')).toContain('WORKER_AFTER');
    expect(readFrontendOutput(pack, '.js')).not.toContain('WORKER_BEFORE');
    if (kind === 'nested') {
      changed.mockClear();
      fs.writeFileSync(path.join(pages, 'new.js'), 'export const page = "NESTED_WORKER_PAGE";');
      await _settles(() => expect(changed).toHaveBeenCalled());
      await compile();
      expect(readFrontendOutput(pack, '.js')).toContain('NESTED_WORKER_PAGE');
    }
  } finally { await watcher.close(); expect(failures).toEqual([]); }
});

it('retains the accepted build after a worker error and publishes its repair', { meta: cpuBudget(120_000 + 2 * WATCH_REBUILD_BUDGET_MS + 20_000) }, async () => {
  const { pack } = consumer();
  const helper = path.join(fixture.root, 'worker-value.ts');
  fs.writeFileSync(helper, 'export const marker = "WORKER_BEFORE";');
  fs.writeFileSync(path.join(fixture.root, 'worker.ts'), 'import { marker } from "./worker-value.ts"; self.postMessage(marker);');
  fs.writeFileSync(path.join(pack, 'src/canvas.vue'), '<script setup>const worker = new Worker(new URL("../../worker.ts", import.meta.url), { type: "module" });</script><template><div>{{ worker }}</div></template>');
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  let watcher: TestPackBuildWatcher | undefined;
  let publications = 0;
  try {
    watcher = await fixture.startWatcher(pack, { place: { env: 'test', userDataDir: path.join(fixture.root, 'profile') },
      onBuilt: async () => { publications++; } });
    const accepted = readPackBuild(path.join(pack, 'dist')).revision;
    await watcher.rebuildAfter(() => { fs.writeFileSync(helper, 'export const marker = ;'); });
    await _settles(() => expect(errors).toHaveBeenCalledWith(expect.stringContaining('Build/reload failed')));
    expect(publications).toBe(0);
    expect(readPackBuild(path.join(pack, 'dist')).revision).toBe(accepted);
    await watcher.rebuildAfter(() => { fs.writeFileSync(helper, 'export const marker = "WORKER_REPAIRED";'); });
    await _settles(() => expect(publications).toBeGreaterThan(0));
    expect(readPackBuild(path.join(pack, 'dist')).revision).not.toBe(accepted);
    expect(readFrontendOutput(pack, '.js')).toContain('WORKER_REPAIRED');
    expect(readFrontendOutput(pack, '.js')).not.toContain('WORKER_BEFORE');
  } finally { await watcher?.close(); }
});

