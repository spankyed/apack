import { eventContractsFixture } from './build-fixture.ts';
import { createMachine } from 'xstate';
import { createNativeFrontendTestRegistry } from '@apackdev/host/fe/testing';
import { writeInstalledPackFixture } from './build-fixture.ts';
import { sealBuild } from './build-fixture.ts';
import { _declarationRevision } from '@apackdev/sdk/build';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { SurfaceDefinition } from '@apackdev/sdk/fe';

import { resetTestData } from '@apackdev/sdk/testing';
import { registry } from './test-host.ts';
import { appliedContent, appState } from '../../../src/app-state/index.ts';

import { PACK_SNAPSHOT_FORMAT } from '@apackdev/sdk/build';
import { _appDirOf } from '@apackdev/sdk/env';
import { PACK_LAYOUT } from '../../../src/packs/layout.ts';
import { createNativePackTestRegistry } from '@apackdev/host/testing';
import { _createPackServices, type SettingsService } from '@apackdev/sdk/services';
import { acceptInstalledPack } from '../../../src/packs/runtime/lifecycle.ts';
import { loadSingleExternalPack } from '../../../src/packs/runtime/loader.ts';
import { readPackBuild } from '../../../src/packs/layout.ts';

let tmpDir: string;
let origEnv: { env?: string; userDataDir?: string };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-lifecycle-'));
  origEnv = { env: process.env.APACK_ENV, userDataDir: process.env.APACK_USER_DATA_DIR };
  process.env.APACK_ENV = 'test';
  process.env.APACK_USER_DATA_DIR = tmpDir;
});

afterEach(() => {
  restoreEnv('APACK_ENV', origEnv.env);
  restoreEnv('APACK_USER_DATA_DIR', origEnv.userDataDir);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

const packsDir = () => path.join(_appDirOf(tmpDir), 'packs');

/** Writes what `apack pack build` leaves in a pack's dist/: a runtime registering `featuresSource`, and a snapshot */
function writeBuild(packDir: string, id: string, featuresSource = '{}', extraFiles: Record<string, string> = {}) {
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(packDir, 'dist', rel)), { recursive: true });
    fs.writeFileSync(path.join(packDir, 'dist', rel), content);
  };
  write('runtime/index.cjs', (`module.exports = { registration: { id: ${JSON.stringify(id)}, features: ${featuresSource} } };`) + `
if (module.exports.registration) module.exports.registration.declarationRevision = '${_declarationRevision(JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf-8')))}';`);
  write(PACK_LAYOUT.snapshot, JSON.stringify({ declarationRevision: _declarationRevision(JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf-8'))), format: PACK_SNAPSHOT_FORMAT, manifest: JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf-8')), eventContracts: eventContractsFixture(JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf-8'))), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {} }));
  for (const [rel, content] of Object.entries(extraFiles)) write(rel, content);
  sealBuild(packDir);
}

function writeManifest(dir: string, manifest: Record<string, unknown>) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'apack.json'), JSON.stringify(manifest));
}

describe('installed runtime acceptance', () => {
  it.each([false, true])('awaits index admission before starting an accepted pack (build failure: %s)', async fails => {
    const { installPackFromLocal } = await import('../../../src/packs/installer.ts');
    const { activatePack } = await import('../../../src/packs/runtime/lifecycle.ts');
    let finish!: () => void, refuse!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { finish = resolve; refuse = reject; });
    const isolated = createNativePackTestRegistry({ indexesReady: () => ready });
    const id = 'index-admission-pack', source = path.join(tmpDir, 'admission-source'), marker = path.join(tmpDir, 'initialized');
    writeManifest(source, { id, name: id, version: '1.0.0', lifecycle: { onInit: 'init.ts#onInit' } });
    writeBuild(source, id, '{}, lifecycle: { onInit() { require("node:fs").writeFileSync(' + JSON.stringify(marker) + ', "initialized"); } }');
    const installed = await installPackFromLocal(source, packsDir());
    const bus = { send: vi.fn() };
    const readiness = vi.spyOn(isolated, 'indexesReady');
    const started = activatePack(isolated, id, bus as never);
    expect(readiness).toHaveBeenCalledWith(id);
    expect(isolated.getPackRegistration(id)).not.toBeNull();
    expect(fs.existsSync(marker)).toBe(false);
    expect(bus.send).not.toHaveBeenCalled();
    if (fails) refuse(new Error('index build failed')); else finish();
    expect(await started).toBe(!fails);
    expect(fs.existsSync(marker)).toBe(!fails);
    expect(fs.existsSync(installed.dir)).toBe(true);
    if (fails) {
      expect(isolated.getPackRegistration(id)).toBeNull();
      expect(isolated.loadProblem(id)).toContain('index build failed');
    } else isolated.unregisterPack(id);
  });

  it.each([false, true])('restarts or stops both old and new system ids after acceptance (init failure: %s)', async fails => {
    const { installPackFromLocal } = await import('../../../src/packs/installer.ts');
    const id = 'systems-pack';
    const source = path.join(tmpDir, 'source');
    const feature = (name: string) => ({ [name]: { description: `Exercise ${name} system.`, system: { entry: 'system.ts' } } });
    const runtime = (name: string) => `{ ${name}: { system: { machine: { id: '${name}' }, receives: [] } } }`;
    writeManifest(source, { id, name: id, version: '1.0.0', features: feature('old') });
    writeBuild(source, id, runtime('old'));
    const installed = await installPackFromLocal(source, packsDir());
    const loaded = loadSingleExternalPack(registry, installed.dir);
    if ('problem' in loaded) throw new Error(loaded.problem);
    const isolated = createNativePackTestRegistry();
    isolated.registerPack(loaded.registration, loaded.origin);
    const previousRevision = isolated.getPackRuntime(id)?.registrationId;
    const shutdown = vi.fn();
    isolated.registerShutdownHook(shutdown, id);
    const bus = { send: vi.fn() };
    let start!: () => Promise<boolean>;
    try {
      writeManifest(source, { id, name: id, version: '2.0.0', features: feature('replacement'),
        ...(fails && { lifecycle: { onInit: 'init.ts#onInit' } }),
      });
      writeBuild(source, id, runtime('replacement') + (fails ? ', lifecycle: { onInit() { throw new Error("init failed"); } }' : ''));
      await installPackFromLocal(source, packsDir(), { accept: candidate => {
        start = acceptInstalledPack(isolated, candidate.id, bus as never);
        expect(shutdown).not.toHaveBeenCalled();
        expect(bus.send).not.toHaveBeenCalled();
      } });
      expect(isolated.getPackRuntime(id)?.registrationId).not.toBe(previousRevision);
      expect(await start()).toBe(!fails);
      expect(shutdown).toHaveBeenCalledOnce();
      expect(bus.send.mock.calls.map(([event]) => event.type)).toEqual([
        fails ? 'TEARDOWN_PACK' : 'RELOAD_PACK', 'PACK_CHANGED',
      ]);
      expect(bus.send.mock.calls[0][0].systemIds).toEqual([`${id}/old`, `${id}/replacement`]);
      expect(readPackBuild(installed.dir).integrity.version).toBe('2.0.0');
      if (fails) expect(isolated.getPackRegistration(id)).toBeNull();
      else expect(isolated.getRegisteredPackSystemIds(id)).toEqual([`${id}/replacement`]);
    } finally {
      if (isolated.getPackRegistration(id)) isolated.unregisterPack(id);
    }
  });

  it('restores files and preserves generated settings authority after late binding refusal', async () => {
    const { installPackFromLocal } = await import('../../../src/packs/installer.ts');
    const id = 'binding-pack';
    const source = path.join(tmpDir, 'source');
    writeManifest(source, { id, name: id, version: '1.0.0' });
    writeBuild(source, id);
    const installed = await installPackFromLocal(source, packsDir());
    const previousBuild = readPackBuild(installed.dir);
    const loaded = loadSingleExternalPack(registry, installed.dir);
    if ('problem' in loaded) throw new Error(loaded.problem);
    const listeners = new Set<() => void>();
    const settings: SettingsService = {
      get: <T,>() => ({ retained: true }) as T,
      set() {}, reset() {},
      onChange(listener) {
        const notify = () => listener('written');
        listeners.add(notify);
        return () => { listeners.delete(notify); };
      },
    };
    const isolated = createNativePackTestRegistry({ settingsForPack: () => settings });
    const generated = _createPackServices();
    const handle = generated.settingsHandle({ kind: 'app' });
    const registration = { ...loaded.registration, bindServices: generated.bindServices };
    isolated.registerPack(registration, loaded.origin);
    const previousRuntime = isolated.getPackRuntime(id);
    const changed = vi.fn();
    handle.onChange(changed);
    const bus = { send: vi.fn() };
    try {
      writeManifest(source, { id, name: id, version: '2.0.0' });
      writeBuild(source, id, '{}, bindServices() { throw new Error("late binding refused"); }');
      await expect(installPackFromLocal(source, packsDir(), { accept: candidate => {
        acceptInstalledPack(isolated, candidate.id, bus as never);
      } })).rejects.toThrow('late binding refused');
      expect(readPackBuild(installed.dir)).toEqual(previousBuild);
      const restored = loadSingleExternalPack(registry, installed.dir);
      expect(restored).not.toHaveProperty('problem');
      if ('problem' in restored) throw new Error(restored.problem);
      expect(restored.origin.version).toBe('1.0.0');
      expect(isolated.getPackRegistration(id)).toBe(registration);
      expect(isolated.getPackRuntime(id)).toEqual(previousRuntime);
      expect(handle.get()).toEqual({ retained: true });
      for (const listener of listeners) listener();
      expect(changed).toHaveBeenCalledOnce();
      expect(listeners.size).toBe(1);
      expect(bus.send).not.toHaveBeenCalled();
      expect(isolated.loadProblem(id)).toBeUndefined();
    } finally {
      if (isolated.getPackRegistration(id)) isolated.unregisterPack(id);
    }
    expect(listeners.size).toBe(0);
    expect(() => handle.get()).toThrow();
  });
});

describe('pack full lifecycle: install → discover', () => {
  it('update flow: reinstalling overwrites the previous version', async () => {
    const { installPackFromLocal } = await import('../../../src/packs/installer.ts');

    const sourceDir = path.join(tmpDir, 'update-pack');

    // v1
    writeManifest(sourceDir, { id: 'update-pack', name: 'Update Pack', version: '1.0.0' });
    writeBuild(sourceDir, 'update-pack', '{}', { 'runtime/content/v1.content.json': '[]' });

    await installPackFromLocal(sourceDir, packsDir());

    const installedDir = path.join(packsDir(), 'update-pack');
    expect(fs.existsSync(path.join(installedDir, 'runtime', 'content', 'v1.content.json'))).toBe(true);

    // v2: new file, old one removed
    writeManifest(sourceDir, { id: 'update-pack', name: 'Update Pack', version: '2.0.0' });
    fs.rmSync(path.join(sourceDir, 'dist'), { recursive: true });
    writeBuild(sourceDir, 'update-pack', '{}', { 'runtime/content/v2.content.json': '[]' });

    await installPackFromLocal(sourceDir, packsDir());

    // v1 file should be gone (fresh copy)
    expect(fs.existsSync(path.join(installedDir, 'runtime', 'content', 'v1.content.json'))).toBe(false);
    expect(fs.existsSync(path.join(installedDir, 'runtime', 'content', 'v2.content.json'))).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(path.join(installedDir, 'apack.json'), 'utf-8'));
    expect(manifest.version).toBe('2.0.0');
  });

  it('multiple packs coexist and all get discovered', async () => {
    const { installPackFromLocal } = await import('../../../src/packs/installer.ts');

    for (const id of ['pack-alpha', 'pack-beta', 'pack-gamma']) {
      const dir = path.join(tmpDir, id);
      writeManifest(dir, { id, name: id.replace('-', ' '), version: '1.0.0' });
      writeBuild(dir, id);
      await installPackFromLocal(dir, packsDir());
    }

    const { loadExternalPacks } = await import('../../../src/packs/runtime/loader.ts');
    const packs = loadExternalPacks(registry);
    const ids = packs.map(p => p.origin.id).sort();
    expect(ids).toEqual(['pack-alpha', 'pack-beta', 'pack-gamma']);
  });
});

// A pack installed, enabled, disabled or uninstalled while the app runs changes what the running systems
// read (the chat's slash commands, say), so they have to be told
describe('activating and tearing down a pack at runtime', () => {
  const PACK_ID = 'activate-pack';
  const bus = { send: vi.fn() };

  /** Installs a pack with one system that declares a slash command in its manifest, a 1.0.0 migration and content */
  async function install() {
    const { installPackFromLocal } = await import('../../../src/packs/installer.ts');
    const sourceDir = path.join(tmpDir, PACK_ID);
    writeManifest(sourceDir, {
      id: PACK_ID,
      name: 'Activate Pack',
      version: '1.0.0',
      features: { main: { description: 'Feature declaration fixture.', designation: 'notebook',
        system: { entry: 'src/features/main/be/system.ts' } } },
      content: { sources: { memos: { applier: 'memos.ts' } } },
      migrations: { pack: { '1.0.0': { description: 'memos', up: 'migration.ts#up' } } },
    });
    // The runtime carries what generate-entries writes from the manifest: the command provider for the
    // feature playing the role, and the appliers
    writeBuild(
      sourceDir,
      PACK_ID,
      `{ main: { designation: 'notebook', `
        + `system: { machine: { id: 'activate-pack-system' }, receives: [] } } }, `
        + "appliers: [{ key: 'memos', apply: () => { globalThis.activatePackRuns.push('apply'); return { created: 1, updated: 0, skipped: 0 }; } }], "
        + "migrations: { pack: [{ target: '1.0.0', description: 'memos', up: () => { globalThis.activatePackRuns.push('migration'); } }] }",
      {
        'runtime/content/memos.content.json': '[]',
        'runtime/content/content.json': JSON.stringify({ version: 1, packId: PACK_ID, entries: [] }),
        // A designation is a declared frontend binding, so the build must carry an FE entry
        'runtime/fe.js': 'export default { id: "activate-pack", surfaces: {} };',
      },
    );
    await installPackFromLocal(sourceDir, packsDir());
  }

  /** What the pack's migration and applier did, in order */
  const runs: string[] = [];
  beforeEach(() => {
    resetTestData();
    runs.length = 0;
    Object.assign(globalThis, { activatePackRuns: runs });
  });

  afterEach(async () => {
    if (registry.getPackRegistration(PACK_ID)) registry.unregisterPack(PACK_ID);
    bus.send.mockReset();
    bus.send.mockImplementation((event) => { if (typeof event.afterStop === 'function') event.afterStop(); });
  });

  it('removes a failed initialization binding while retaining installed declarations', async () => {
    const { installPackFromLocal } = await import('../../../src/packs/installer.ts');
    const { activatePack } = await import('../../../src/packs/runtime/lifecycle.ts');
    const source = path.join(tmpDir, PACK_ID);
    writeManifest(source, { id: PACK_ID, name: 'Failing Init', version: '1.0.0', lifecycle: { onInit: 'hooks.ts#onInit', onShutdown: 'hooks.ts#onShutdown' } });
    writeBuild(source, PACK_ID, "{}, lifecycle: { onInit() { throw new Error('init refused'); }, onShutdown() { globalThis.activatePackRuns.push('shutdown'); } }");
    await installPackFromLocal(source, packsDir());
    expect(await activatePack(registry, PACK_ID, bus as never)).toBe(false);
    expect(registry.getPackRegistration(PACK_ID)).toBeNull();
    expect(registry.loadProblem(PACK_ID)).toContain('init refused');
    expect(registry.settingsCatalog().dependencies).toHaveProperty(PACK_ID);
    expect(runs).toEqual(['shutdown']);
    expect(bus.send).toHaveBeenCalledWith({ type: 'PACK_CHANGED', packId: PACK_ID });
    expect(bus.send.mock.calls.map(([event]) => event.type)).not.toContain('ACTIVATE_PACK');
  });

  it('tells the running systems before starting its own', async () => {
    await install();
    const { activatePack } = await import('../../../src/packs/runtime/lifecycle.ts');

    expect(await activatePack(registry, PACK_ID, bus as never)).toBe(true);

    expect(bus.send.mock.calls.map(([event]) => event.type)).toEqual(['PACK_CHANGED', 'ACTIVATE_PACK']);
    expect(bus.send).toHaveBeenCalledWith({ type: 'PACK_CHANGED', packId: PACK_ID });
  });

  it('runs its migrations, then its content, as a boot does, and neither again when it activates unchanged', async () => {
    await install();
    const { activatePack, teardownPack } = await import('../../../src/packs/runtime/lifecycle.ts');

    expect(await activatePack(registry, PACK_ID, bus as never)).toBe(true);
    expect(runs).toEqual(['migration', 'apply']);
    expect(appState.get()).toMatchObject({ packVersions: { [PACK_ID]: '1.0.0' } });
    expect(appliedContent.get(PACK_ID).revision).toEqual(expect.any(String));

    // Disabled, then enabled again
    teardownPack(registry, PACK_ID, bus as never);
    expect(await activatePack(registry, PACK_ID, bus as never)).toBe(true);
    expect(runs).toEqual(['migration', 'apply']);
  });

  it('drops its appliers when torn down, and tells the systems still running after stopping its own', async () => {
    await install();
    const { activatePack, teardownPack } = await import('../../../src/packs/runtime/lifecycle.ts');
    const { importCompiledContent } = await import('@apackdev/sdk/utils');
    await activatePack(registry, PACK_ID, bus as never);
    const compiledDir = path.join(tmpDir, 'compiled-content');
    fs.mkdirSync(compiledDir);
    fs.writeFileSync(path.join(compiledDir, 'content.json'), JSON.stringify({ version: 1, packId: PACK_ID, entries: [] }));
    expect(Object.keys(importCompiledContent({ compiledDir }))).toEqual(['memos']);
    bus.send.mockReset();
    bus.send.mockImplementation((event) => { if (typeof event.afterStop === 'function') event.afterStop(); });

    teardownPack(registry, PACK_ID, bus as never);

    expect(importCompiledContent({ compiledDir })).toEqual({});
    expect(bus.send.mock.calls.map(([event]) => event.type)).toEqual(['TEARDOWN_PACK', 'PACK_CHANGED']);
    expect(bus.send).toHaveBeenCalledWith({ type: 'PACK_CHANGED', packId: PACK_ID });
  });

  // Subscriber failures cannot interrupt publication or pack teardown.
  it('finishes teardown when a catalog subscriber throws', async () => {
    const { teardownPack } = await import('../../../src/packs/runtime/lifecycle.ts');
    const { onPackCatalogChanged } = await import('@apackdev/sdk/framework');
    const { testRootEvents } = await import('@apackdev/sdk/testing');

    registry.registerPack({
      id: 'stuck-pack',
      features: { stuck: { surface: { receives: [] }, settings: { defaults: { a: 1 }, schema: { type: 'object' } } } },
    });
    const stopListening = onPackCatalogChanged(() => { throw new Error('a settings listener threw'); });

    // The cause is on the event, not in its text: the logger puts an error in `stack`/`meta`
    const logged: string[] = [];
    const stopLogging = testRootEvents.onLog((event) => void logged.push(`${event.message} ${event.stack ?? ''} ${JSON.stringify(event.meta ?? {})}`));
    bus.send.mockReset();
    bus.send.mockImplementation((event) => { if (typeof event.afterStop === 'function') event.afterStop(); });
    try {
      teardownPack(registry, 'stuck-pack', bus as never);
    } finally {
      stopLogging();
      stopListening();
    }

    expect(registry.getPackRegistration('stuck-pack')).toBeNull();
    expect(bus.send.mock.calls.map(([event]) => event.type)).toContain('PACK_CHANGED');
    expect(logged.join('\n')).toContain('Contribution catalog listener failed');
    expect(logged.join('\n')).toContain('a settings listener threw');
    expect(logged.join('\n')).not.toContain('was not previously registered');
  });
});

describe('registry source and update tracking', () => {
  /** The pack on disk, which is what makes it installed and where its version comes from */
  function installed(id: string, version = '1.0.0') {
    const dir = path.join(packsDir(), id);
    writeInstalledPackFixture(dir, { id, name: id, version });
  }

  it('records where an install came from', async () => {
    const { packRecord, recordInstalled } = await import('../../../src/packs/installed.ts');

    recordInstalled('github-pack', 'owner/repo');

    expect(packRecord('github-pack')).toMatchObject({ installedFrom: 'owner/repo', enabled: true });
    expect(packRecord('github-pack').availableVersion).toBeUndefined();
  });

  it('records what an update check found, and forgets it once that update is installed', async () => {
    const { packRecord, recordInstalled, recordUpdateCheck, recordUpdateInstalled } = await import('../../../src/packs/installed.ts');
    recordInstalled('versioned-pack', 'owner/versioned');

    recordUpdateCheck('versioned-pack', { availableVersion: '2.0.0', availableTag: 'v2.0.0', updateCheckError: undefined });
    expect(packRecord('versioned-pack').availableVersion).toBe('2.0.0');

    recordUpdateInstalled('versioned-pack');
    expect(packRecord('versioned-pack').availableVersion).toBeUndefined();
    expect(packRecord('versioned-pack').installedFrom, 'the slug an update reinstalls from').toBe('owner/versioned');
  });

  it('getAvailableUpdates returns packs with newer versions', async () => {
    const { recordInstalled, recordUpdateCheck } = await import('../../../src/packs/installed.ts');
    const { getAvailableUpdates } = await import('../../../src/packs/updater.ts');
    installed('has-update');
    installed('no-update');

    recordInstalled('has-update', 'owner/has-update');
    recordInstalled('no-update', 'owner/no-update');
    recordUpdateCheck('has-update', { availableVersion: '2.0.0', availableTag: 'v2.0.0', updateCheckError: undefined });
    recordUpdateCheck('no-update', { availableVersion: '1.0.0', availableTag: 'v1.0.0', updateCheckError: undefined });

    const updates = getAvailableUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0].packId).toBe('has-update');
    expect(updates[0].currentVersion).toBe('1.0.0');
    expect(updates[0].availableVersion).toBe('2.0.0');
  });
});

describe('FE pack deregistration', () => {
  it('unregisterPackFE removes extensions and returns removed surfaces', async () => {
    const { registerFixture, unregisterPackFE } = createNativeFrontendTestRegistry();

    const testSurface = { label: 'Test', state: createMachine({}) } satisfies SurfaceDefinition;
    registerFixture({ id: 'test-pack', features: { testSurface: { surface: testSurface } } });

    const removed = unregisterPackFE('test-pack');
    expect(removed).toHaveLength(1);
    expect(removed[0].id).toBe('test-pack/testSurface');

    // Calling again should return empty
    const removedAgain = unregisterPackFE('test-pack');
    expect(removedAgain).toHaveLength(0);
  });

  // A shipped pack's registration carries its id like any other, so it comes out the same way
  it('takes a shipped pack\'s frontend back out like any other pack\'s', async () => {
    const { registerFixture, unregisterPackFE, getRegisteredSurfaces } = createNativeFrontendTestRegistry();
    registerFixture({ id: 'default-setup', features: { main: { surface: { label: 'Built-in', state: createMachine({}) } } } });
    const shipped = getRegisteredSurfaces()[0];
    expect(shipped).toMatchObject({ label: 'Built-in', id: 'default-setup/main' });

    expect(unregisterPackFE('default-setup')).toEqual([shipped]);
    expect(getRegisteredSurfaces()).toEqual([]);
  });

  // Two packs with the same feature each have their own surface; unregistering one leaves the other's
  it('unregisterPackFE handles pack with no extensions gracefully', async () => {
    const { unregisterPackFE } = createNativeFrontendTestRegistry();

    const removed = unregisterPackFE('nonexistent-pack');
    expect(removed).toHaveLength(0);
  });
});

describe('pack-registration teardown', () => {
  it('unregisterPack throws for unknown pack', async () => {
    expect(() => registry.unregisterPack('nonexistent')).toThrow('Pack "nonexistent" is not registered');
  });
});
