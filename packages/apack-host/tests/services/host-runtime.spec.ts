import { createNativePackTestRegistry } from '@apackdev/host/testing';
// createHostRuntime assembles the app the SDK binds: the given bus and version, the engine, the registered packs,
// and the host's services over the store. A reset leaves the app as a fresh boot does.
import { secretRedaction } from '../../src/secrets/redaction.ts';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { EARS, EarsDatabase } from '@apackdev/ears';
import { _bindEars } from '@apackdev/sdk/ears';
import { _createTestEngine, _openTestRunHistory, _openTestDatabase, testRootEvents } from '@apackdev/sdk/testing';
import { createHostRuntime } from '../../src/services/index.ts';
import { inference } from '../../src/services/inference.ts';
import { secrets } from '../../src/services/secrets.ts';
import { filesystem } from '../../src/services/filesystem.ts';
import { secretsStore } from '../../src/secrets/index.ts';
import { startPacks } from '../../src/packs/runtime/start.ts';
import { HOST_ENTITY_TYPES } from '../../src/app-state/index.ts';

// What a reset does, in order; the host's migrations runners and external packs' applying record themselves here
const order = vi.hoisted((): string[] => []);
const appMigrations = vi.hoisted(() => ({ succeed: true }));
vi.mock('../../src/migrations/index.ts', () => ({
  runAppMigrations: () => { order.push('migrations'); return appMigrations.succeed; },
  runPackMigrations: ((packs) => { order.push(`pack migrations (${Array.from(packs, p => p.packId)})`); }) satisfies typeof import('../../src/migrations/index.ts').runPackMigrations,
}));
vi.mock('../../src/packs/runtime/apply.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/packs/runtime/apply.ts')>(),
  // Sorted: which packs are in the one call is this file's claim, where their order among themselves is
  // `packContentOrder`'s and is held by the registry's own spec
  applyPacks: ((packs) => { order.push(`pack content (${Array.from(packs, p => p.manifest.id).sort()})`); return []; }) satisfies typeof import('../../src/packs/runtime/apply.ts').applyPacks,
}));

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'host-runtime-'));
process.env.APACK_ENV = 'test';
process.env.APACK_USER_DATA_DIR = dataDir;
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

// The host's own rows (settings, onboarding) and a pack's `Memo`
const entityTypes = new Set([...HOST_ENTITY_TYPES, 'Memo']);
const newEngine = () => _createTestEngine({ entityTypes: [...entityTypes] });

/** A test run history whose database reset is watched */
function blockedHistory() {
  const runHistory = _openTestRunHistory();
  const reset = vi.spyOn(runHistory.database, 'reset');
  // A reset is under way until the promise it returned settles, which the cases await at `finish`
  return { runHistory, reset, finish: () => {} };
}

/** An external pack the app loaded: where it came from, as the loader records it */
const externalOrigin = (id: string, name: string) => ({ declarationRevision: 'fixture-revision',
  id, name, version: '1.0.0', dir: '/nowhere',
  manifest: { id, name, version: '1.0.0' },
});

describe('createHostRuntime', () => {
  it('refuses overlapping resets and imports before either can touch the store', async () => {
    const { runHistory, reset, finish } = blockedHistory();
    const store = { reset: vi.fn() } as unknown as EarsDatabase;
    const engine = newEngine();
    // The app's database is emptied through the engine reading it, so the engine's watches hear of it
    const clear = vi.spyOn(engine.admin, 'clear').mockImplementation(() => {});
    const runtime = createHostRuntime({ runHistory, database: store, engine, transport: { rootEvents: testRootEvents },
      appVersion: '1.2.3', packs: createNativePackTestRegistry() });
    // Each started while the first is under way, which it is until its promise settles
    const first = runtime.services.appData.reset();
    const second = runtime.services.appData.reset();
    const importing = runtime.services.appData.importBackup('/not-a-backup');
    try {
      await expect(second).rejects.toThrow('already being replaced');
      await expect(importing).rejects.toThrow('already being replaced');
    } finally { finish(); await first; }
    expect(reset).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
    order.length = 0;
  });

  it('excludes pack operations while app data is replaced, and refuses to replace it under one', async () => {
    const { runHistory, finish } = blockedHistory();
    const store = { reset: vi.fn() } as unknown as EarsDatabase;
    const engine = newEngine();
    const clear = vi.spyOn(engine.admin, 'clear').mockImplementation(() => {});
    const packs = createNativePackTestRegistry();
    const runtime = createHostRuntime({ runHistory, database: store, engine, transport: { rootEvents: testRootEvents },
      appVersion: '1.2.3', packs });
    const resetting = runtime.services.appData.reset();
    try {
      const free = packs.claimPackOperation('any-pack');
      if (free) packs.releasePackOperation('any-pack');
      expect(free).toBe(false);
    } finally { finish(); await resetting; }
    expect(packs.claimPackOperation('any-pack')).toBe(true);
    try {
      await expect(runtime.services.appData.reset()).rejects.toThrow('A pack is being installed or changed');
      expect(clear).toHaveBeenCalledOnce();
    } finally { packs.releasePackOperation('any-pack'); }
    order.length = 0;
  });

  it('keeps settings and onboarding on the owning engine when another engine is installed', () => {
    const firstEngine = newEngine();
    const secondEngine = newEngine();
    const runtime = (engine: ReturnType<typeof newEngine>) => createHostRuntime({ runHistory: _openTestRunHistory(),
      database: {} as EarsDatabase, engine, transport: { rootEvents: testRootEvents },
      appVersion: '1.2.3', packs: createNativePackTestRegistry(),
    });
    const first = runtime(firstEngine);
    const second = runtime(secondEngine);
    const previous = _bindEars(secondEngine);
    try {
      first.services.settings.set({ kind: 'app' }, ['personal', 'name'], 'First');
      second.services.settings.set({ kind: 'app' }, ['personal', 'name'], 'Second');
      expect(first.services.settings.getAll().app.personal.name).toBe('First');
      expect(second.services.settings.getAll().app.personal.name).toBe('Second');
      first.services.onboarding.complete();
      expect(first.services.onboarding.isComplete()).toBe(true);
      expect(second.services.onboarding.isComplete()).toBe(false);
    } finally { _bindEars(previous); }
  });

  it('holds the bus, version, engine, registered packs and host services', () => {
    // The services reach the store only when called
    const engine = newEngine();
    const packs = createNativePackTestRegistry();
    const runtime = createHostRuntime({ runHistory: _openTestRunHistory(), database: {} as EarsDatabase, engine, transport: { rootEvents: testRootEvents }, appVersion: '1.2.3', packs });
    // What log redaction masks: the host's own check over the values its secrets store has handled
    expect(runtime.redaction).toBe(secretRedaction);
    expect(runtime.transport.rootEvents).toBe(testRootEvents);
    expect(runtime.appVersion).toBe('1.2.3');
    expect(runtime.ears).toBe(engine);
    expect(runtime.packs).toBe(packs);
    expect(Object.keys(runtime.services).sort()).toEqual(['appData', 'filesystem', 'inference', 'onboarding', 'runHistory', 'secrets', 'settings']);
    expect(runtime.services.inference).toBe(inference);
    expect(runtime.services.secrets).toBe(secrets);
    expect(runtime.services.filesystem).toBe(filesystem);
    expect(Object.keys(runtime.services.onboarding).sort()).toEqual(['complete', 'isComplete']);
    expect(Object.keys(runtime.services.appData).sort()).toEqual(['exportBackup', 'importBackup', 'readBackupSummary', 'reset']);

    const service = { ping: () => 'pong' };
    packs.registerPack({ id: 'runtime-pack', features: { memos: { system: { machine: {} as never, receives: [] } } }, services: { memoService: service } });
    try {
      expect(runtime.packs.getRegisteredServices().memoService).toBe(service);
      expect(runtime.packs.systemIds()).toContain('runtime-pack/memos');
    } finally {
      packs.unregisterPack('runtime-pack');
    }
  });

  it("stops the packs, empties the stores and keys, then starts the packs as a boot does", async () => {
    // The engine reads the database, so emptying the database is what empties the engine
    const { database, engine } = _openTestDatabase({ entityTypes: [...entityTypes] });
    const clear = engine.admin.clear;
    vi.spyOn(engine.admin, 'clear').mockImplementation(() => { order.push('store reset'); clear(); });
    const id = engine.create('Memo', { id: 'Memo-1' as EARS.EntityId }).set('title', 'kept?').id();
    const packs = createNativePackTestRegistry();
    const runtime = createHostRuntime({ runHistory: _openTestRunHistory(), database, engine, transport: { rootEvents: testRootEvents }, appVersion: '1.2.3', packs });
    secretsStore.add('openai', 'Work', 'sk-proj-resetspec1234567890');
    // An external pack the app loaded, holding something open between its onInit and onShutdown
    const boot = { onInit: () => order.push(`onInit (${secretsStore.list().length} keys)`), onShutdown: () => order.push('onShutdown') };
    const origin = externalOrigin('reset-pack', 'Reset');
    packs.registerPack({ id: 'reset-pack', lifecycle: boot }, { ...origin, manifest: { ...origin.manifest, lifecycle: { onInit: 'hooks.ts#onInit', onShutdown: 'hooks.ts#onShutdown' } } });
    // A pack the app ships, with a content policy — written by the same call as the installed one
    packs.registerPack({ id: 'written-pack' },
      { declarationRevision: 'fixture-revision', id: 'written-pack', name: 'Written', version: '1.0.0', dir: '/packs/written-pack' } as never);
    packs.registerShutdownHook(boot.onShutdown, 'reset-pack');
    try {
      await runtime.services.appData.reset();
    } finally {
      packs.unregisterPack('reset-pack');
      packs.unregisterPack('written-pack');
    }
    // One content call for every pack, after the migrations — where it was the shipped pack's boot apply and
    // then the installed packs', which is why only the second half retried or saw a dependency content
    expect(order).toEqual([
      'onShutdown', 'store reset', 'onInit (0 keys)',
      'migrations', 'pack migrations (reset-pack)', 'pack content (reset-pack,written-pack)',
    ]);
    expect(engine.getRow(id)?.title).toBeUndefined();
  });
});

describe('startPacks', () => {
  it("runs no pack migration or apply when the app's migrations failed", () => {
    order.length = 0;
    appMigrations.succeed = false;
    const packs = createNativePackTestRegistry();
    packs.registerPack({ id: 'late-written-pack' });
    packs.registerPack({ id: 'late-pack' }, externalOrigin('late-pack', 'Late'));
    try {
      startPacks(packs);
    } finally {
      appMigrations.succeed = true;
      packs.unregisterPack('late-written-pack');
      packs.unregisterPack('late-pack');
    }
    expect(order).toEqual(['migrations']);
  });
});
