import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { packFixture } from '@apackdev/sdk/testing/pack-fixture';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { readPackBuild } from '@apackdev/host/packs';
import { startTestPackBuildWatcher, WATCH_REBUILD_BUDGET_MS, type TestPackBuildWatcher } from '../_support/watch-builds.ts';
import { tsconfig } from '../_support/pack-builds.ts';
import { cpuBudget } from '@apackdev/testing/vitest';
import { settles } from '@apackdev/sdk/testing/waiting';

it('rebuilds external contracts and recovers a retargeted missing input without an authored edit', { meta: cpuBudget(120_000 + 3 * WATCH_REBUILD_BUDGET_MS + 20_000) }, async ({ signal }) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-watch-external-types-'));
  const root = path.join(temporary, 'pack');
  const parent = path.join(temporary, 'base.json');
  const contract = (name: string) => `export type Contract = { incoming: { type: 'FETCH' }; outgoing: { type: '${name}' } };`;
  const configure = (file: string) => fs.writeFileSync(parent, JSON.stringify({ compilerOptions: {
    baseUrl: '.', paths: { outside: [file] },
  } }));
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  let watcher: TestPackBuildWatcher | undefined;
  let publications = 0;
  try {
    configure('contract.d.ts');
    fs.writeFileSync(path.join(temporary, 'contract.d.ts'), contract('FIRST'));
    packFixture({ at: root, nodeModules: path.join(REPO_ROOT, 'node_modules'), manifest: {
      id: 'external-contract', name: 'External contract', features: { view: {
        description: 'External type contract.', system: { entry: 'src/system.ts', contract: 'src/contract.ts#Contract' },
        surface: { label: 'View', state: 'src/surface.ts' },
      } },
    }, files: {
      'src/contract.ts': "export type { Contract } from 'outside';",
      'src/surface.ts': "import { createMachine } from 'xstate'; export default createMachine({ id: 'view' });",
      'src/system.ts': `import { setup } from 'xstate'; import { defineSystem } from '@apackdev/sdk/framework';
import type { Contract } from './contract.ts'; const spec = defineSystem<Contract>();
export default { spec, machine: setup({ types: spec.types }).createMachine({ id: 'view' }) };`,
    } });
    const configPath = path.join(root, 'tsconfig.json');
    const config = JSON.parse(tsconfig);
    delete config.compilerOptions.paths;
    fs.writeFileSync(configPath, JSON.stringify({ ...config, extends: '../base.json' }));
    const authored = fs.readFileSync(configPath);
    const entry = () => fs.readFileSync(path.join(root, 'src/__generated__/pack-entry.ts'), 'utf8');
    watcher = await startTestPackBuildWatcher(root, {
      signal,
      place: { env: 'test', userDataDir: path.join(temporary, 'profile') },
      onBuilt: async () => { publications++; },
    });
    expect(entry()).toContain('FIRST');
    await watcher.rebuildAfter(() => {
      fs.writeFileSync(path.join(temporary, 'replacement.d.ts'), contract('OTHER'));
      fs.renameSync(path.join(temporary, 'replacement.d.ts'), path.join(temporary, 'contract.d.ts'));
    });
    await settles(() => expect(publications > 0 || errors.mock.calls.length > 0).toBe(true));
    expect(errors.mock.calls).toEqual([]);
    expect(entry()).toContain('OTHER');
    const facade = () => fs.readFileSync(path.join(root, 'dist/types/pack-types.d.ts'), 'utf8');
    expect(facade()).toContain('OTHER');
    expect(facade()).not.toMatch(/from ['"]outside['"]/);
    const accepted = readPackBuild(path.join(root, 'dist')).revision;
    const count = publications;
    await watcher.rebuildAfter(() => { configure('future/contract.d.ts'); });
    await settles(() => expect(errors).toHaveBeenCalledWith(expect.stringContaining('Build/reload failed')));
    expect(publications).toBe(count);
    expect(readPackBuild(path.join(root, 'dist')).revision).toBe(accepted);
    expect(entry()).toContain('OTHER');
    await watcher.rebuildAfter(() => {
      fs.mkdirSync(path.join(temporary, 'future'));
      fs.writeFileSync(path.join(temporary, 'future/contract.d.ts'), contract('THIRD'));
    });
    await settles(() => expect(publications).toBeGreaterThan(count));
    expect(entry()).toContain('THIRD');
    expect(facade()).toContain('THIRD');
    expect(fs.readFileSync(configPath)).toEqual(authored);
  } finally {
    await watcher?.close();
    errors.mockRestore();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
// Four compiler attempts share this scenario; individual rebuild waits remain bounded above.
});
