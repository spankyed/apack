// A pack depending on default-setup runs default-setup's systems in its unit tests: the harness loads
// the dependency's cached runtime (runtime/index.cjs, with its compiled content) on the pack's SDK.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ALLOW_UNBUILT } from '@apackdev/host/build/packages-built';
import { generatePackFiles, PACK_SNAPSHOT_FORMAT, type PackManifest } from '@apackdev/sdk/build';
import { PACK_LAYOUT, cacheDependency, readCachedDependency, sealPackBuild } from '@apackdev/host/packs';
import { runCommand } from '../_support/run-command.ts';
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

const DEFAULT_SETUP_DIST = path.join(REPO_ROOT, 'packages', 'default-setup', 'dist');
const built = fs.existsSync(path.join(DEFAULT_SETUP_DIST, 'runtime', 'index.cjs')) && fs.existsSync(path.join(DEFAULT_SETUP_DIST, PACK_LAYOUT.snapshot));
if (!built && process.env[ALLOW_UNBUILT] !== '1') throw new Error('default-setup must be built (apack pack build) for the dependency runtime spec');

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function write(root: string, file: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
}

/** A pack depending on default-setup, with default-setup cached as `apack pack build` caches a dependency */
async function dependentPack(spec: string): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-dependent-runtime-'));
  dirs.push(root);
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  write(root, 'package.json', JSON.stringify({ name: 'dependent-pack', type: 'module',
    imports: { '#generated/*': './src/__generated__/*' } }));
  const manifest: PackManifest = {
    id: 'dependent-pack', name: 'Dependent', version: '1.0.0', dependencies: { 'default-setup': '*' },
    features: {
      memos: { description: 'Exercise dependency runtime delivery.',
        system: { entry: 'tests/memos-system.ts', contract: 'tests/memos-system.ts#Contract' },
        surface: { label: 'Fixture', state: 'tests/memos-surface.ts' } },
      widgets: { description: 'Exercise feature settings.', settings: { defaults: { size: 3 }, schema: { type: 'object' } } },
    },
  };
  write(root, 'apack.json', JSON.stringify(manifest));
  cacheDependency(root, 'default-setup', DEFAULT_SETUP_DIST, '*', {
    kind: 'host', directory: DEFAULT_SETUP_DIST, selection: 'test checkout',
  });
  // As `apack pack init` scaffolds it: one call, so this fixture stays what a real pack has
  write(root, 'vitest.config.ts', `
import { definePackTestConfig } from '@apackdev/testing/vitest';
export default definePackTestConfig({ dataDirPrefix: 'dependent-runtime-' });`);
  write(root, 'tests/setup.ts', `
import { setupPackTests } from '@apackdev/testing/harness';
import { contentRuntime } from '../src/__generated__/content-runtime';
import { registration } from '../src/__generated__/pack-entry';
await setupPackTests({ contentRuntime, registration });`);
  write(root, 'tests/memos-surface.ts', `
import { setup } from 'xstate';
export default setup({}).createMachine({});`);
  write(root, 'tests/memos-system.ts', `
import { setup } from 'xstate';
import { untypedBroadcastToSurface } from '@apackdev/sdk/events';
import { reportError } from '@apackdev/sdk/logger';
import { defineSystem } from '@apackdev/sdk/framework';
export type Contract = {
  incoming: { type: 'SAVE' } | { type: 'NOTIFY' };
  outgoing: { type: 'MEMOS_STARTED' } | { type: 'MEMOS_NOTIFIED' };
};
const spec = defineSystem<Contract>();
const machine = setup({ types: spec.types }).createMachine({
  entry: () => untypedBroadcastToSurface('dependent-pack/memos', { type: 'MEMOS_STARTED' }),
  on: {
    NOTIFY: { actions: () => untypedBroadcastToSurface('dependent-pack/memos', { type: 'MEMOS_NOTIFIED' }) },
    SAVE: { actions: () => reportError({ error: new Error('lost memo'), source: 'memos' }) },
  },
});
export default { spec, machine };`);
  const dependency = readCachedDependency(root, 'default-setup')!;
  const files = await generatePackFiles(manifest, { packRoot: root,
    depSnapshots: new Map([['default-setup', dependency.snapshot]]) });
  for (const [file, content] of Object.entries(files)) write(root, file, content);
  write(root, 'tests/app.spec.ts', spec);
  return root;
}

function vitest(root: string) {
  return runCommand(process.execPath, [path.join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs'), 'run'], root,
    { env: { CI: '', NO_COLOR: '1' }, timeout: 120_000 });
}

describe.skipIf(!built)("a dependent pack's unit tests on the harness runtime tier", () => {
  it.each([undefined, PACK_SNAPSHOT_FORMAT + 1])('refuses dependency execution before importing a mismatched runtime: %s', async format => {
    const root = await dependentPack("import { it } from 'vitest'; it('must not reach tests', () => {});");
    const source = path.join(root, 'dependency-producer');
    fs.cpSync(readCachedDependency(root, 'default-setup')!.directory, source, { recursive: true });
    const file = path.join(source, PACK_LAYOUT.snapshot);
    const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
    snapshot.format = format;
    fs.writeFileSync(file, JSON.stringify(snapshot));
    const marker = path.join(root, 'runtime-executed');
    fs.writeFileSync(path.join(source, PACK_LAYOUT.runtimeEntry),
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed'); throw new Error('Poisoned runtime');`);
    sealPackBuild(source, snapshot.manifest);
    cacheDependency(root, 'default-setup', source, '*', { kind: 'file', directory: source, selection: 'fixture' });
    const result = await vitest(root);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain('its snapshot is format');
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("runs default-setup's systems and the app's settings beside them", async () => {
    const root = await dependentPack(`
import { expect, it } from 'vitest';
import { repository } from '@apackdev/sdk/services';
import { services } from '#generated/services.ts';
import { startApp } from '@apackdev/testing/harness';
it("connects to default-setup's notes and the app's settings", async () => {
  const app = await startApp({ systems: ['default-setup/notes', 'host/settings'] });
  await app.connect();
  // A dependency's view, run by the test file's views over its registered runtime
  expect(await app.watchView('default-setup/notes', 'tree').next()).toMatchObject({ ok: true, value: [] });
  const loaded = await app.nextEmit('host/settings', 'SETTINGS_LOADED');
  expect(loaded.snapshot).toMatchObject({ values: { app: expect.any(Object), features: expect.any(Object) } });
  expect(app.emitted('host/application').map((e) => e.type)).toContain('APPLICATION_HOTKEYS');
  // One SDK and one engine: this pack's feature settings (registered by the harness) reach the app's
  // settings, and the repositories default-setup's runtime registered are the test's, through
  // @apackdev/ears and services.repository alike
  expect(loaded.snapshot).toMatchObject({ values: { features: { 'dependent-pack/widgets': { size: 3 } } } });
  const noteQueries = Reflect.get(repository, 'noteQueries');
  expect(noteQueries).toBeDefined();
  expect(services.repository.noteQueries.all()).toEqual(noteQueries.all());
});`);
    const result = await vitest(root);
    expect(result.output, 'the dependent pack test run').toMatch(/Tests\s+1 passed/);
  });

  it("drops a system's sends to its surface until a client connects", async () => {
    const root = await dependentPack(`
import { expect, it } from 'vitest';
import { startApp } from '@apackdev/testing/harness';
it('delivers only what the system sends once connected', async () => {
  const app = await startApp({ systems: ['memos'] });
  expect(app.emitted('memos')).toEqual([]);
  await app.connect();
  await app.send('memos', { type: 'NOTIFY' });
  expect(app.emitted('memos').map((e) => e.type)).toEqual(['MEMOS_NOTIFIED']);
});`);
    const result = await vitest(root);
    expect(result.output, 'the dependent pack test run').toMatch(/Tests\s+1 passed/);
  });

  it("fails a test when a system reports an error the test didn't take", async () => {
    const root = await dependentPack(`
import { expect, it } from 'vitest';
import { startApp, takeSystemErrors } from '@apackdev/testing/harness';
async function save() {
  const app = await startApp({ systems: ['memos'] });
  await app.connect();
  await app.send('memos', { type: 'SAVE' });
}
it('reports without taking', save);
it('reports and takes', async () => {
  await save();
  expect(takeSystemErrors()).toEqual([expect.objectContaining({ type: 'SYSTEM_ERROR', source: 'memos', message: 'lost memo' })]);
});`);
    const { output } = await vitest(root);
    expect(output).toMatch(/Tests\s+1 failed \| 1 passed/);
    expect(output).toContain("Systems reported errors the test didn't take (takeSystemErrors()):");
    expect(output).toContain('memos: lost memo');
  });
});
