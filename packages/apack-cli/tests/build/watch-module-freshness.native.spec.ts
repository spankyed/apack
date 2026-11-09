import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { FIXTURE_DATA, FIXTURE_ENTITY, packFixture } from '@apackdev/sdk/testing/pack-fixture';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { readPackBuild } from '@apackdev/host/packs';
import { startTestPackBuildWatcher, WATCH_REBUILD_BUDGET_MS, type TestPackBuildWatcher } from '../_support/watch-builds.ts';
import { shareCompilerInstallation } from '../_support/shared-compiler.ts';
import { cpuBudget } from '@apackdev/testing/vitest';
import { settles } from '@apackdev/sdk/testing/waiting';

const sharedCompiler = shareCompilerInstallation();

it('refreshes flow modules loaded through ordinary imports on the next watched build', { meta: cpuBudget(120_000 + WATCH_REBUILD_BUDGET_MS + 20_000) }, async ({ signal }) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-watch-flows-'));
  const root = path.join(temporary, 'pack');
  const flow = path.join(root, 'src/content/flows/main.ts');
  const output = () => fs.readFileSync(path.join(root, 'dist/runtime/content/flows.content.json'), 'utf8');
  const declaration = (name: string) => `export default { ${name}: [{ event: 'flow.entry', exits: [[{ type: 'note' }]] }] };`;
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  let watcher: TestPackBuildWatcher | undefined;
  let publications = 0;
  try {
    packFixture({ at: root, nodeModules: path.join(REPO_ROOT, 'node_modules'), manifest: {
      id: 'watched-flow', name: 'Watched flow', features: {},
      extensions: { steps: {
        listener: { kind: 'trigger', node: { label: 'Listener' }, trigger: { trackField: "event", compile: 'src/listener.ts#compile', decompile: 'src/listener.ts#decompile' } },
        note: { node: { label: 'Note' }, build: { compile: 'src/note.ts#compile', validate: 'src/note.ts#validate', getLabel: 'src/note.ts#getLabel' } },
      } },
      content: { sources: { flows: 'src/content/flows' } },
    }, files: {
      'src/listener.ts': "export const node = { label: 'Listener' };\nexport const compile = () => ({});\nexport const decompile = () => ({});\n",
      'src/note.ts': "export const node = { label: 'Note' };\nexport const compile = () => ({ entity: {}, relations: [] });\nexport const validate = () => [];\nexport const getLabel = () => 'Note';\n",
      'src/content/flows/main.ts': declaration('First'),
    } });
    watcher = await startTestPackBuildWatcher(root, {
      captureCompiler: sharedCompiler.capture,
      signal,
      place: { env: 'test', userDataDir: path.join(temporary, 'profile') },
      onBuilt: async () => { publications++; },
    });
    expect(output()).toContain('First');
    await watcher.rebuildAfter(() => { fs.writeFileSync(flow, declaration('Other')); });
    await settles(() => expect(publications > 0 || errors.mock.calls.length > 0).toBe(true));
    expect(errors.mock.calls).toEqual([]);
    expect(output()).toContain('Other');
    expect(output()).not.toContain('First');
  } finally {
    await watcher?.close();
    errors.mockRestore();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

it('recompiles changed transitive content modules and retains the accepted build on failure', { meta: cpuBudget(120_000 + 2 * WATCH_REBUILD_BUDGET_MS + 20_000) }, async ({ signal }) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-watch-modules-'));
  const root = path.join(temporary, 'pack');
  const helper = path.join(root, 'src/value.ts');
  const output = path.join(root, 'dist/runtime/content/tags.content.json');
  const value = () => JSON.parse(fs.readFileSync(output, 'utf8')).records[0].label;
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  let watcher: TestPackBuildWatcher | undefined;
  let publications = 0;
  try {
    packFixture({ at: root, nodeModules: path.join(REPO_ROOT, 'node_modules'), manifest: {
      id: 'watched-content', name: 'Watched content', features: {},
      data: FIXTURE_DATA, content: { formats: { tags: { compiler: 'src/compiler.ts', entity: FIXTURE_ENTITY } },
        sources: { tags: { path: 'src/data.ts', format: 'tags' } } },
    }, files: {
      'src/compiler.ts': "import { label } from './value.ts'; export default function compile() { return [{ entity: " + JSON.stringify(FIXTURE_ENTITY) + ", label }]; }",
      'src/value.ts': "export const label = 'first';",
      'src/data.ts': 'export default [];',
    } });
    watcher = await startTestPackBuildWatcher(root, {
      captureCompiler: sharedCompiler.capture,
      signal,
      place: { env: 'test', userDataDir: path.join(temporary, 'profile') },
      onBuilt: async () => { publications++; },
    });
    expect(value()).toBe('first');
    await watcher.rebuildAfter(() => { fs.writeFileSync(helper, "export const label = 'other';"); });
    await settles(() => expect(publications > 0 || errors.mock.calls.length > 0).toBe(true));
    expect(errors.mock.calls).toEqual([]);
    expect(value()).toBe('other');
    const accepted = readPackBuild(path.join(root, 'dist')).revision;
    const count = publications;
    await watcher.rebuildAfter(() => { fs.writeFileSync(helper, 'export const label = ;'); });
    await settles(() => expect(errors).toHaveBeenCalledWith(expect.stringContaining('Build/reload failed')));
    expect(publications).toBe(count);
    expect(readPackBuild(path.join(root, 'dist')).revision).toBe(accepted);
    expect(value()).toBe('other');
  } finally {
    await watcher?.close();
    errors.mockRestore();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
