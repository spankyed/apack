// A live build watcher over real tooling files: subscriptions the OS delivers, so it runs in the native half.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { startPackBuildWatcher } from '../../src/build/watch.ts';
import * as reload from '../../src/app/app-api.ts';
import { compilerWatchFixture } from '../_support/compiler-watch-fixture.ts';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
});

it('rebuilds an idle session on actual tooling filesystem events', async () => {
  const { pack, entry, executable, override } = compilerWatchFixture(roots);
  fs.writeFileSync(path.join(pack, 'apack.json'), JSON.stringify({ id: 'watch-tooling', name: 'Watch tooling', version: '1.0.0' }));
  vi.spyOn(reload, 'reloadPack').mockResolvedValue({ status: 'not-running', detail: 'fixture has no app' });
  let builds = 0;
  const watcher = await startPackBuildWatcher(pack, { builder: {
    build: async () => { builds++; }, subscribeFrontendInputs: () => () => {}, isFrontendCurrent: async () => true,
  } });
  try {
    expect(builds).toBe(1);
    for (const [index, file] of [entry, executable, override].entries()) {
      fs.writeFileSync(file, `changed tooling ${index}`);
      await vi.waitFor(() => expect(builds).toBe(index + 2), { timeout: 2_000 });
    }
  } finally { await watcher.close(); }
});
