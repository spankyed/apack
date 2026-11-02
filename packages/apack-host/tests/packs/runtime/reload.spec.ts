import { sealPack } from './build-fixture.ts';
import { _declarationRevision } from '@apackdev/sdk/build';
// Reloading a pack loads and registers its rebuilt runtime before the running one shuts down: a rebuild that
// fails to load, or whose registration is refused, leaves the running pack as it was.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { registry } from './test-host.ts';
import { createNativePackTestRegistry } from '@apackdev/host/testing';
import { _createPackServices, type SettingsService } from '@apackdev/sdk/services';
import { PACK_SNAPSHOT_FORMAT } from '@apackdev/sdk/build';
import { _appDirOf } from '@apackdev/sdk/env';
import { PACK_LAYOUT, getLoadedPackEntries } from '../../../src/packs/layout.ts';

const { registerPack, unregisterPack, getPackRegistration, registerShutdownHook, removeShutdownHooksForKey } = registry;
const { reloadPackById } = await import('../../../src/packs/runtime/reload.ts');
const { loadAppPacks } = await import('../../../src/packs/runtime/loader.ts');
const { applyPacks } = await import('../../../src/packs/runtime/apply.ts');
const { resolveAppEnvironment } = await import('@apackdev/sdk/env');
// The test host's logger reports through its root event bus, so a test can read what the code under test logged
const { testRootEvents: rootEvents, resetTestData, testPacks } = await import('@apackdev/sdk/testing');
const { appliedContent, appState } = await import('../../../src/app-state/index.ts');
const { readInstalledPacks } = await import('../../../src/packs/installed.ts');

const PACK_ID = 'reload-pack';
const eventContracts = { widget: { system: { incoming: ['PING'], outgoing: [] } } };

let tmpDir: string;
let origEnv: { env?: string; userDataDir?: string };
const running = { id: PACK_ID, features: { widget: { system: { machine: { id: 'widget', config: {} } as never, receives: ['PING'] } } } };
const bus = { send: vi.fn() };
const shutdown = vi.fn();

/** Writes the rebuilt pack: a pack layout whose runtime entry is `runtimeSource` */
function writeRebuild(runtimeSource: string, manifestExtra: Record<string, unknown> = {}) {
  const packDir = path.join(_appDirOf(tmpDir), 'packs', PACK_ID);
  fs.mkdirSync(path.join(packDir, 'runtime', 'content'), { recursive: true });
  fs.mkdirSync(path.join(packDir, 'types'), { recursive: true });
  fs.writeFileSync(path.join(packDir, 'apack.json'), JSON.stringify({ id: PACK_ID, name: PACK_ID, version: '1.0.1', features: { widget: { description: 'Feature declaration fixture.', system: { entry: 'system.ts' } } }, ...manifestExtra }));
  fs.writeFileSync(path.join(packDir, PACK_LAYOUT.snapshot), JSON.stringify({ declarationRevision: _declarationRevision(JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf-8'))), format: PACK_SNAPSHOT_FORMAT, manifest: JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf-8')), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, eventContracts, facades: {} }));
  fs.writeFileSync(path.join(packDir, 'runtime', 'index.cjs'), (runtimeSource) + `
if (module.exports.registration) module.exports.registration.declarationRevision = '${_declarationRevision(JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf-8')))}';`);
  sealPack(packDir);
}

const runtime = (services = '') => `
  module.exports = {
    registration: {
      id: '${PACK_ID}',
      features: { widget: { system: { machine: { id: 'widget', config: {} }, receives: ['PING'] } } },
      ${services}
    },
  };
`;

function expectRunningPackIntact() {
  expect(getPackRegistration(PACK_ID)?.features).toBe(running.features);
  expect(shutdown).not.toHaveBeenCalled();
  expect(bus.send).not.toHaveBeenCalled();
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-reload-'));
  origEnv = { env: process.env.APACK_ENV, userDataDir: process.env.APACK_USER_DATA_DIR };
  process.env.APACK_ENV = 'test';
  process.env.APACK_USER_DATA_DIR = tmpDir;
  bus.send.mockReset();
  shutdown.mockReset();
  // The incumbent is an installed pack, not a host-native contribution with the same ID.
  registry.refreshCatalog(resolveAppEnvironment().packsDir);
  registerPack(running, {
    id: PACK_ID, name: PACK_ID, version: '1.0.0',
    eventContracts,
    dir: path.join(resolveAppEnvironment().packsDir, PACK_ID), declarationRevision: 'fixture-revision',
  });
  registerShutdownHook(shutdown, PACK_ID);
});

afterEach(() => {
  for (const id of [PACK_ID, 'service-owner']) {
    try { unregisterPack(id); } catch { /* not registered */ }
  }
  removeShutdownHooksForKey(PACK_ID);
  testPacks.appliers.delete('built-in-pack');
  for (const [key, value] of [['APACK_ENV', origEnv.env], ['APACK_USER_DATA_DIR', origEnv.userDataDir]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('reloading a pack the app ships', () => {
  const SHIPPED_ID = 'shipped-pack';
  const written: string[] = [];

  /**
   * A pack the app ships, installed as every pack is: its built runtime records the compiled dir it was
   * pointed at, reads it in its onInit, and it declares an apply over one compiled content file
   */
  function writeShipped(manifest: Record<string, unknown> = {}): string {
    const packDir = path.join(_appDirOf(tmpDir), 'packs', SHIPPED_ID);
    fs.mkdirSync(path.join(packDir, 'runtime'), { recursive: true });
    fs.mkdirSync(path.join(packDir, 'types'), { recursive: true });
    fs.writeFileSync(path.join(packDir, 'apack.json'), JSON.stringify({ id: SHIPPED_ID, name: SHIPPED_ID, version: '1.0.0', lifecycle: { onInit: 'hooks.ts#onInit' }, features: { widget: { description: 'Feature declaration fixture.', system: { entry: 'system.ts' } } }, ...manifest }));
    fs.writeFileSync(path.join(packDir, PACK_LAYOUT.snapshot), JSON.stringify({ declarationRevision: _declarationRevision(JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf-8'))), format: PACK_SNAPSHOT_FORMAT, manifest: JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf-8')), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, eventContracts, facades: {} }));
    writeContent('[{ "label": "first" }]');
    // The index naming the pack, and the runtime built beside it
    fs.writeFileSync(path.join(packDir, PACK_LAYOUT.contentDir, 'content.json'), JSON.stringify({ version: 1, packId: SHIPPED_ID, entries: [] }));
    fs.writeFileSync(path.join(packDir, 'runtime', 'index.cjs'), (`
      let compiledDir = '';
      module.exports = {
        setCompiledDir(dir) { compiledDir = dir; },
        // Like a pack's generated appliers: the value is only there once the loader has set it
        getCompiledDir() {
          if (!compiledDir) throw new Error('compiledDir not initialized — pack loader must call setCompiledDir()');
          return compiledDir;
        },
        registration: {
          id: '${SHIPPED_ID}',
          features: { widget: { system: { machine: { id: 'widget', config: {} }, receives: ['PING'] } } },
          lifecycle: {
            onInit() { module.exports.compiledDirAtInit = module.exports.getCompiledDir(); },
          },
        },
      };
    `) + `
if (module.exports.registration) module.exports.registration.declarationRevision = '${_declarationRevision(JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf-8')))}';`);
    sealPack(packDir);
    return packDir;
  }

  /** A pack's compiled content, where an installed pack holds them */
  function writeContent(content: string): void {
    const contentDir = path.join(_appDirOf(tmpDir), 'packs', SHIPPED_ID, PACK_LAYOUT.contentDir);
    fs.mkdirSync(contentDir, { recursive: true });
    fs.writeFileSync(path.join(contentDir, 'actions.content.json'), content);
    sealPack(path.dirname(path.dirname(contentDir)));
  }

  /** The pack as `applyPacks` takes it: a pack the app ships, with the policy its registration declares */
  const contentTarget = (packId: string = SHIPPED_ID) =>
    ({ manifest: { id: packId }, dir: path.join(_appDirOf(tmpDir), 'packs', SHIPPED_ID) });

  /** Records an applier reports for the next content instead of importing them (an invalid flow, say) */
  let recordsThatFail: string[] = [];
  /** Makes the applier itself throw, as a rebuild removing its files mid-reload would */
  let applyFailure: Error | undefined;
  /** What the code under test logged at error level */
  const loggedErrors: string[] = [];
  let stopLogging: (() => void) | undefined;

  beforeEach(() => {
    written.length = 0;
    loggedErrors.length = 0;
    recordsThatFail = [];
    applyFailure = undefined;
    // The reason lives in meta: the app's logger redacts an Error into { name, message, stack }, the test host's passes it on
    stopLogging = rootEvents.onLog((event) => {
      if (event.level !== 'error') return;
      const meta: unknown = event.meta;
      loggedErrors.push(`${event.message} ${meta instanceof Error ? meta.message : JSON.stringify(meta ?? {})}`);
    });
    // AppState, where the boot apply records what it last applyed, starts empty
    resetTestData();
    // The appliers the built-in pack's registration carries
    testPacks.appliers.set(SHIPPED_ID, [{
      key: 'actions',
      // An applier reports the records it couldn't write in its counts; it doesn't throw
      apply: ({ compiledDir }) => {
        if (applyFailure) throw applyFailure;
        written.push(compiledDir);
        return { created: 1, updated: 0, skipped: recordsThatFail.length, ...(recordsThatFail.length > 0 && { errors: recordsThatFail }) };
      },
    }]);
  });

  it('points the rebuilt runtime at its compiled content, so onInit can read them', async () => {
    writeShipped();
    loadAppPacks(registry);

    await reloadPackById(registry, SHIPPED_ID, bus as never);

    const packDir = path.join(_appDirOf(tmpDir), 'packs', SHIPPED_ID);
    const reloaded = require(path.join(packDir, 'runtime', 'index.cjs'));
    expect(reloaded.compiledDirAtInit).toBe(path.join(packDir, PACK_LAYOUT.contentDir));
    expect(bus.send).toHaveBeenCalledWith({ type: 'RELOAD_PACK', packId: SHIPPED_ID, systemIds: [`${SHIPPED_ID}/widget`] });
  });

  it('changes the accepted runtime identity when identical installed bytes reload', async () => {
    writeShipped();
    loadAppPacks(registry);
    const previous = registry.getPackRuntime(SHIPPED_ID)!;
    expect(previous.registrationId).toMatch(/^[a-f0-9-]{36}$/);
    await reloadPackById(registry, SHIPPED_ID, bus as never);
    const current = registry.getPackRuntime(SHIPPED_ID)!;
    expect(current.registrationId).not.toBe(previous.registrationId);
    expect(current.origin.buildRevision).toBe(previous.origin.buildRevision);
    expect(getLoadedPackEntries(registry).find(pack => pack.id === SHIPPED_ID)?.registrationId).toBe(current.registrationId);
    unregisterPack(SHIPPED_ID);
    expect(registry.getPackRuntime(SHIPPED_ID)).toBeNull();
  });

  // Only the reloaded pack's own systems restart; other packs' systems read what it registers and content
  it('tells the running systems the pack changed, after restarting its own', async () => {
    writeShipped();
    loadAppPacks(registry);

    await reloadPackById(registry, SHIPPED_ID, bus as never);

    expect(bus.send.mock.calls.map(([event]) => event.type)).toEqual(['RELOAD_PACK', 'PACK_CHANGED']);
    expect(bus.send).toHaveBeenCalledWith({ type: 'PACK_CHANGED', packId: SHIPPED_ID });
  });

  it('content the compiled data a rebuild changed, and leaves unchanged data alone', async () => {
    writeShipped();
    loadAppPacks(registry);
    // Boot's own applying, which the reload picks up from
    applyPacks([contentTarget()]);
    expect(written).toEqual([path.join(_appDirOf(tmpDir), 'packs', SHIPPED_ID, PACK_LAYOUT.contentDir)]);

    // A reload after a code-only rebuild leaves the data alone
    written.length = 0;
    await reloadPackById(registry, SHIPPED_ID, bus as never);
    expect(written).toEqual([]);

    // A reload carrying recompiled content imports them
    writeContent('[{ "label": "second" }]');
    await reloadPackById(registry, SHIPPED_ID, bus as never);
    expect(written).toEqual([path.join(_appDirOf(tmpDir), 'packs', SHIPPED_ID, PACK_LAYOUT.contentDir)]);
  });

  it("records what it written per pack, so a second shipped pack's boot apply doesn't re-run this one", async () => {
    writeShipped();
    loadAppPacks(registry);
    applyPacks([contentTarget()]);
    expect(written).toEqual([path.join(_appDirOf(tmpDir), 'packs', SHIPPED_ID, PACK_LAYOUT.contentDir)]);

    // Another pack the app ships applies its own content, recorded in its own entity
    written.length = 0;
    applyPacks([contentTarget('other-pack')]);
    expect([SHIPPED_ID, 'other-pack'].map((id) => appliedContent.get(id).revision).every(Boolean)).toBe(true);

    // ...and this pack's own content is still recorded, so it isn't written again
    written.length = 0;
    applyPacks([contentTarget()]);
    expect(written).toEqual([]);
  });

  it('reports the records an applier could not content, and still records the hash so they are retried on the next change', async () => {
    writeShipped();
    loadAppPacks(registry);
    recordsThatFail = ['Flow "Broken": step 2 names no action'];
    applyPacks([contentTarget()]);

    // The failure is reported, not swallowed behind "Boot apply completed"
    expect(loggedErrors.join('\n')).toContain('Flow "Broken": step 2 names no action');
    // The revision is recorded anyway: the same failing data isn't re-applied every boot
    expect(appliedContent.get(SHIPPED_ID).revision).toBeTruthy();

    // ...and the next content of unchanged data doesn't retry it
    written.length = 0;
    applyPacks([contentTarget()]);
    expect(written).toEqual([]);

    // ...while recompiled content do
    writeContent('[{ "label": "second" }]');
    recordsThatFail = [];
    loggedErrors.length = 0;
    applyPacks([contentTarget()]);
    expect(written).toEqual([path.join(_appDirOf(tmpDir), 'packs', SHIPPED_ID, PACK_LAYOUT.contentDir)]);
    expect(loggedErrors).toEqual([]);
  });

  it('restarts actors after a committed replacement even when its initialization throws', async () => {
    const dir = writeShipped();
    loadAppPacks(registry);
    const entry = path.join(dir, PACK_LAYOUT.runtimeEntry);
    fs.writeFileSync(entry, fs.readFileSync(entry, 'utf-8').replace(
      'module.exports.compiledDirAtInit = module.exports.getCompiledDir();',
      "throw new Error('initialization failed');",
    ));
    sealPack(dir);
    bus.send.mockClear();
    await reloadPackById(registry, SHIPPED_ID, bus as never);
    expect(bus.send).toHaveBeenCalledWith({ type: 'RELOAD_PACK', packId: SHIPPED_ID, systemIds: [`${SHIPPED_ID}/widget`] });
    expect(bus.send).toHaveBeenCalledWith({ type: 'PACK_CHANGED', packId: SHIPPED_ID });
    expect(loggedErrors.join('\n')).toContain('initialization failed');
  });

  it('still restarts the systems when the apply after registering throws, and says why', async () => {
    writeShipped();
    loadAppPacks(registry);
    bus.send.mockClear();

    // A rebuild running again mid-reload takes the compiled content out from under the applier
    applyFailure = new Error("ENOENT: no such file or directory, open 'actions.content.json'");
    await reloadPackById(registry, SHIPPED_ID, bus as never);

    // The swap already happened, so the systems have to be restarted whatever the apply did
    expect(bus.send).toHaveBeenCalledWith({ type: 'RELOAD_PACK', packId: SHIPPED_ID, systemIds: [`${SHIPPED_ID}/widget`] });
    expect(loggedErrors.join('\n')).toContain('ENOENT');
  });

  // A rebuild can change the pack's version, and the list the Packs view shows reads the origin
  it("re-reads the pack's manifest, so a version a rebuild changed is the one listed", async () => {
    writeShipped();
    loadAppPacks(registry);
    expect(registry.packOrigin(SHIPPED_ID)?.version).toBe('1.0.0');

    writeShipped({ version: '2.0.0' });
    await reloadPackById(registry, SHIPPED_ID, bus as never);

    expect(registry.packOrigin(SHIPPED_ID)?.version).toBe('2.0.0');
  });

  afterEach(() => {
    stopLogging?.();
    stopLogging = undefined;
    try { unregisterPack(SHIPPED_ID); } catch { /* not registered */ }
  });
});

describe('reloading a pack', () => {
  it('retains incumbent generated handles and origin after a late candidate binding failure', async () => {
    const listeners = new Set<() => void>();
    const source: SettingsService = {
      get: <T,>() => ({ retained: true }) as T,
      set() {}, reset() {},
      onChange(listener) { const notify = () => listener('written'); listeners.add(notify); return () => { listeners.delete(notify); }; },
    };
    const isolated = createNativePackTestRegistry({ settingsForPack: () => source });
    const generated = _createPackServices();
    const handle = generated.settingsHandle({ kind: 'app' });
    const manifest = { id: PACK_ID, name: PACK_ID, version: '1.0.0', features: {
      widget: { description: 'Reload authority fixture.', system: { entry: 'system.ts', events: { incoming: ['PING'] } } },
    } };
    const declarationRevision = _declarationRevision(manifest);
    const old = { ...running, declarationRevision, bindServices: generated.bindServices };
    const origin = { eventContracts, manifest, id: PACK_ID, name: PACK_ID, version: '1.0.0', declarationRevision,
      dir: path.join(resolveAppEnvironment().packsDir, PACK_ID) };
    isolated.registerPack(old, origin);
    const acceptedOrigin = isolated.packOrigin(PACK_ID);
    const acceptedRuntime = isolated.getPackRuntime(PACK_ID);
    const heard = vi.fn();
    handle.onChange(heard);
    try {
      writeRebuild(runtime("bindServices() { throw new Error('late binding refused'); },"));
      await expect(reloadPackById(isolated, PACK_ID, bus as never)).rejects.toThrow(`Failed to register pack ${PACK_ID}`);
      expect(isolated.getPackRegistration(PACK_ID)).toBe(old);
      expect(isolated.packOrigin(PACK_ID)).toBe(acceptedOrigin);
      expect(isolated.getPackRuntime(PACK_ID)).toEqual(acceptedRuntime);
      expect(handle.get()).toEqual({ retained: true });
      for (const notify of listeners) notify();
      expect(heard).toHaveBeenCalledOnce();
      expect(bus.send).not.toHaveBeenCalled();
    } finally { isolated.unregisterPack(PACK_ID); }
    expect(listeners.size).toBe(0);
    expect(() => handle.get()).toThrow('revoked');
  });

  it('leaves the running pack intact when the rebuilt runtime throws while loading', async () => {
    writeRebuild(`throw new Error('broken build');`);
    await expect(reloadPackById(registry, PACK_ID, bus as never)).rejects.toThrow(`Failed to load pack ${PACK_ID}`);
    expectRunningPackIntact();
  });

  it('leaves the running pack intact when the rebuilt runtime exports no registration', async () => {
    writeRebuild(`module.exports = {};`);
    await expect(reloadPackById(registry, PACK_ID, bus as never)).rejects.toThrow(`Failed to load pack ${PACK_ID}`);
    expectRunningPackIntact();
  });

  // Its origin too: without it the registry forgets where the pack came from, and a built-in's next reload can't find it
  it('restores the running registration, and where it came from, when the rebuilt one is refused', async () => {
    const origin = { eventContracts, declarationRevision: 'fixture-revision', id: PACK_ID, name: PACK_ID, version: '1.0.0', dir: path.join(_appDirOf(tmpDir), 'packs', PACK_ID) };
    unregisterPack(PACK_ID);
    registerPack(running, origin);
    const previous = registry.getPackRuntime(PACK_ID);
    registerPack({ id: 'service-owner', services: { taken: {} } });
    writeRebuild(runtime(`services: { taken: {} },`), { extensions: { services: { taken: 'taken.ts#taken' } } });
    await expect(reloadPackById(registry, PACK_ID, bus as never)).rejects.toThrow(`Failed to register pack ${PACK_ID}`);
    expectRunningPackIntact();
    expect(registry.packOrigin(PACK_ID)).toEqual(origin);
    expect(registry.getPackRuntime(PACK_ID)).toEqual(previous);
  });

  it('refuses malformed compiled content before replacing the running pack', async () => {
    writeRebuild(runtime());
    fs.writeFileSync(
      path.join(_appDirOf(tmpDir), 'packs', PACK_ID, 'runtime', 'content', 'content.json'),
      JSON.stringify({ version: 1, entries: [] }),
    );
    sealPack(path.join(_appDirOf(tmpDir), 'packs', PACK_ID));

    await expect(reloadPackById(registry, PACK_ID, bus as never)).rejects.toThrow('packId');
    expectRunningPackIntact();
  });

  // A first apply has no installed-packs row yet; execution failures must still create its error record.
  it("records a first-time pack's apply failure", async () => {
    resetTestData();
    writeRebuild(runtime(`appliers: [{ key: 'custom', apply() { throw new Error('content apply failed'); } }],`),
      { content: { sources: { custom: { applier: 'src/custom.ts' } } } });
    fs.writeFileSync(path.join(_appDirOf(tmpDir), 'packs', PACK_ID, 'runtime', 'content', 'content.json'),
      JSON.stringify({ version: 1, packId: PACK_ID, entries: [] }));
    sealPack(path.join(_appDirOf(tmpDir), 'packs', PACK_ID));
    await reloadPackById(registry, PACK_ID, bus as never);

    expect(readInstalledPacks()).toMatchObject([
      expect.objectContaining({ id: PACK_ID, lastError: expect.stringContaining('content apply failed') }),
    ]);
  });

  // A pack that content cleanly and has decided nothing keeps no row: the packs directory is what makes it
  // installed, so there is nothing for the record to say about it.
  it('leaves no row behind for a pack whose content had nothing to report', async () => {
    resetTestData();
    writeRebuild(runtime());

    await reloadPackById(registry, PACK_ID, bus as never);

    expect(fs.existsSync(resolveAppEnvironment().installedPacksFile), 'no record was written at all').toBe(false);
  });

  it('shuts the running pack down and restarts its systems once the rebuild is registered', async () => {
    writeRebuild(runtime());
    await reloadPackById(registry, PACK_ID, bus as never);

    expect(getPackRegistration(PACK_ID)?.features).not.toBe(running.features);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(bus.send).toHaveBeenCalledWith({ type: 'RELOAD_PACK', packId: PACK_ID, systemIds: [`${PACK_ID}/widget`] });
  });

  it("runs the rebuilt pack's new migrations against the version it recorded", async () => {
    resetTestData();
    appState.update({ packVersions: { [PACK_ID]: '1.0.0' } });
    const ran: string[] = [];
    Object.assign(globalThis, { reloadPackRuns: ran });
    writeRebuild(runtime(`migrations: { pack: ['1.0.0', '1.0.1'].map((target) => ({ target, description: target, up: () => globalThis.reloadPackRuns.push(target) })) },`), { migrations: { pack: { '1.0.0': { description: '1.0.0', up: 'migration.ts#first' }, '1.0.1': { description: '1.0.1', up: 'migration.ts#next' } } } });

    await reloadPackById(registry, PACK_ID, bus as never);

    expect(ran).toEqual(['1.0.1']);
    expect(appState.get().packVersions).toEqual({ [PACK_ID]: '1.0.1' });
  });

  // Other packs' systems read what the pack registers and content (the chat's slash commands, say). A system
  // reading it between unregistering the running pack and registering the rebuild would find nothing
  it('tells the running systems the pack changed once the rebuild is registered and its systems restarted', async () => {
    writeRebuild(runtime());
    const registrationWhenSent: unknown[] = [];
    bus.send.mockImplementation((event: { type: string }) => {
      if (event.type === 'PACK_CHANGED') registrationWhenSent.push(getPackRegistration(PACK_ID)?.features);
    });
    await reloadPackById(registry, PACK_ID, bus as never);

    expect(bus.send.mock.calls.map(([event]) => event.type)).toEqual(['RELOAD_PACK', 'PACK_CHANGED']);
    expect(bus.send).toHaveBeenCalledWith({ type: 'PACK_CHANGED', packId: PACK_ID });
    expect(registrationWhenSent).toHaveLength(1);
    expect(registrationWhenSent[0]).toBeDefined();
    expect(registrationWhenSent[0]).not.toBe(running.features);
  });
});


it.each([false, true])('waits for accepted reload indexes before hooks or actor restart (failure: %s)', async fails => {
  let finish!: () => void, refuse!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { finish = resolve; refuse = reject; });
  const readiness = vi.spyOn(registry, 'indexesReady').mockReturnValue(ready);
  const marker = path.join(tmpDir, 'reload-initialized');
  writeRebuild(runtime('lifecycle: { onInit() { require("node:fs").writeFileSync(' + JSON.stringify(marker) + ', "yes"); } },'),
    { lifecycle: { onInit: 'init.ts#onInit' } });
  const pending = reloadPackById(registry, PACK_ID, bus as never);
  try {
    expect(readiness).toHaveBeenCalledWith(PACK_ID);
    expect(fs.existsSync(marker)).toBe(false);
    expect(shutdown).not.toHaveBeenCalled();
    expect(bus.send.mock.calls.map(([event]) => event.type)).not.toContain('RELOAD_PACK');
    if (fails) {
      refuse(new Error('reload index build failed'));
      await expect(pending).rejects.toThrow('reload index build failed');
      expect(registry.getPackRegistration(PACK_ID)).toBeNull();
      expect(registry.loadProblem(PACK_ID)).toContain('index readiness failed');
      expect(bus.send.mock.calls.map(([event]) => event.type)).not.toContain('RELOAD_PACK');
    } else {
      finish(); await pending;
      expect(fs.existsSync(marker)).toBe(true);
      expect(shutdown).toHaveBeenCalledOnce();
      expect(bus.send.mock.calls.map(([event]) => event.type)).toContain('RELOAD_PACK');
    }
  } finally { readiness.mockRestore(); }
});
