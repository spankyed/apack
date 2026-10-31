import { _packEntityTypes } from '@apackdev/sdk/framework';
import { writeInstalledPackFixture, sealPack, sealBuild, eventContractsFixture } from '../../../packs/runtime/build-fixture.ts';
import { _declarationRevision } from '@apackdev/sdk/build';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createActor, setup, type AnyEventObject } from 'xstate';
import { HOST } from '../../../../src/refs.ts';
import { _appDirOf, resolveAppEnvironment } from '@apackdev/sdk/env';
import { startTestRuntime, resetTestData, takeSystemErrors, testRootEvents } from '@apackdev/sdk/testing';
import { readInstalledPacks, recordUserInstall, setPackEnabled } from '../../../../src/packs/installed.ts';
import { registry } from '../../../packs/runtime/test-host.ts';
import { appliedContent, appState } from '../../../../src/app-state/index.ts';
import { installPackFromLocal, restoreShippedPack } from '../../../../src/packs/installer.ts';
import { createPacksSystem, type InstalledPackSummary } from '../../../../src/features/packs/be/system.ts';
import { activatePack } from '../../../../src/packs/runtime/lifecycle.ts';
import { loadAppPacks } from '../../../../src/packs/runtime/loader.ts';
import { reloadPackById } from '../../../../src/packs/runtime/reload.ts';
import { PACK_SNAPSHOT_FORMAT } from '@apackdev/sdk/build';
import { readPackBuild, createPackArchive, stagePack } from '../../../../src/packs/layout.ts';
import { PACK_LAYOUT } from '../../../../src/packs/layout.ts';
import { applyPacks } from '../../../../src/packs/runtime/apply.ts';
import { readAppPackSources } from '../../../../src/packs/app-sources.ts';
import { createFormatApplier } from '@apackdev/sdk/content';
import { type EARS } from '@apackdev/ears';
import { untypedQuery, untypedWrite } from '@apackdev/sdk/ears';

const referenceDeclarations = {
  types: { note: { category: 'notes', icon: 'NotebookText', svgElements: [] } },
  categories: { notes: { label: 'Notes', icon: 'NotebookText', useItems: 'src/references.ts#useItems' } },
};

const PACK_ID = 'reinstall-pack';

let tmpDir: string;
let origEnv: { env?: string; userDataDir?: string };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'packs-system-'));
  origEnv = { env: process.env.APACK_ENV, userDataDir: process.env.APACK_USER_DATA_DIR };
  process.env.APACK_ENV = 'test';
  process.env.APACK_USER_DATA_DIR = tmpDir;
});

afterEach(() => {
  if (registry.getPackRegistration(PACK_ID)) registry.unregisterPack(PACK_ID);
  registry.clearLoadProblem(PACK_ID);
  registry.catalog.setAppPackSources({ sources: [], problems: [] });
  if (origEnv.env === undefined) delete process.env.APACK_ENV;
  else process.env.APACK_ENV = origEnv.env;
  if (origEnv.userDataDir === undefined) delete process.env.APACK_USER_DATA_DIR;
  else process.env.APACK_USER_DATA_DIR = origEnv.userDataDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** The pack source `apack pack build` would leave, at `version`; `content` gives it compiled data that won't content */
function packSource(version: string, { failsImport = false, id = PACK_ID, runtime = '', manifest = {} } = {}): string {
  const dir = path.join(tmpDir, 'source');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'dist', 'runtime'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'dist', 'types'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'apack.json'), JSON.stringify({ id, name: 'Reinstall Pack', version, ...manifest }));
  fs.writeFileSync(path.join(dir, 'dist', 'runtime', 'index.cjs'), (`module.exports = { registration: { id: ${JSON.stringify(id)} } };\n${runtime}`) + `
if (module.exports.registration) module.exports.registration.declarationRevision = '${_declarationRevision(JSON.parse(fs.readFileSync(path.join(dir, 'apack.json'), 'utf-8')))}';`);
  fs.writeFileSync(path.join(dir, 'dist', PACK_LAYOUT.snapshot), JSON.stringify({ declarationRevision: _declarationRevision(JSON.parse(fs.readFileSync(path.join(dir, 'apack.json'), 'utf-8'))), format: PACK_SNAPSHOT_FORMAT, manifest: JSON.parse(fs.readFileSync(path.join(dir, 'apack.json'), 'utf-8')), eventContracts: eventContractsFixture(JSON.parse(fs.readFileSync(path.join(dir, 'apack.json'), 'utf-8'))), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {} }));
  fs.writeFileSync(path.join(dir, 'dist', PACK_LAYOUT.feEntry), 'export {};');
  if (failsImport) {
    // Compiled data with no content.json: the applier can't tell whose records these are, so applying fails
    fs.mkdirSync(path.join(dir, 'dist', 'runtime', 'content'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dist', 'runtime', 'content', 'flows.content.json'), '[]');
  }
  sealBuild(dir);
  return dir;
}

/** A GitHub release of `source`, served to `fetch` from memory, with its published checksum */
async function stubRelease(source: string) {
  const stage = path.join(tmpDir, 'stage');
  fs.rmSync(stage, { recursive: true, force: true });
  stagePack(source, stage);
  const { file, sha256 } = await createPackArchive(stage, path.join(tmpDir, 'release'));
  const name = path.basename(file);
  const assets = [
    { name, browser_download_url: `https://example.test/${name}` },
    { name: `${name}.sha256`, browser_download_url: `https://example.test/${name}.sha256` },
  ];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('https://api.github.com/')) return new Response(JSON.stringify({ assets }), { status: 200 });
    if (url.endsWith('.sha256')) return new Response(`${sha256}  ${name}\n`, { status: 200 });
    return new Response(fs.readFileSync(file), { status: 200 });
  }));
  return sha256;
}

/**
 * The packs system running next to a bus that records what it is sent, and what it sends its surface. A bus told
 * to `deferStops` holds each teardown's completion in `stops`, as a real one does until the actors have stopped.
 */
function runPacksSystem({ deferStops = false } = {}) {
  const sent: AnyEventObject[] = [];
  const stops: Array<() => void> = [];
  const busStub = setup({ types: {} as { events: AnyEventObject } }).createMachine({
    on: { '*': { actions: ({ event }) => {
      sent.push(event);
      if (typeof event.afterStop === 'function') {
        if (deferStops) stops.push(event.afterStop);
        else event.afterStop();
      }
    } } },
  });
  const stopListening = testRootEvents.onSurfaceSend((message) => void sent.push({ type: 'OUTGOING', message }));
  const root = setup({ actors: { bus: busStub, packs: createPacksSystem(registry) } }).createMachine({
    invoke: [
      { src: 'bus', systemId: HOST.bus },
      { src: 'packs', systemId: HOST.packs },
    ],
  });
  const actor = createActor(root).start();
  const stop = () => {
    actor.stop();
    stopListening();
  };
  return { sent, stops, send: (event: AnyEventObject) => actor.system.get(HOST.packs).send(event), stop };
}

/** The pack-scoped events the system emitted, unwrapped from the bus envelope */
const emitted = (sent: AnyEventObject[]) => sent.flatMap(e => {
  const inner = (e as { message?: { event: AnyEventObject } }).message?.event;
  return inner ? [inner] : [];
});

describe('installing over a pack that is already running', () => {
  it.each([false, true])('holds the install claim and withholds activation while indexes build (failure: %s)', async fails => {
    let finish!: () => void, refuse!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { finish = resolve; refuse = reject; });
    const readiness = vi.spyOn(registry, 'indexesReady').mockReturnValue(ready);
    const release = vi.spyOn(registry, 'releasePackOperation');
    const system = runPacksSystem();
    try {
      system.send({ type: 'INSTALL_PACK', packSlug: packSource('1.0.0'), sourceKind: 'local' });
      await vi.waitFor(() => expect(readiness).toHaveBeenCalled());
      const claimed = registry.claimPackOperation(PACK_ID);
      if (claimed) registry.releasePackOperation(PACK_ID);
      expect(claimed).toBe(false);
      expect(emitted(system.sent).map(event => event.type)).not.toContain('PACK_ACTIVATED');
      expect(emitted(system.sent).map(event => event.type)).not.toContain('PACK_INSTALL_COMPLETE');
      expect(release.mock.calls.some(([id]) => id === PACK_ID)).toBe(false);
      if (fails) refuse(new Error('install index build failed')); else finish();
      await vi.waitFor(() => expect(emitted(system.sent).map(event => event.type)).toContain(fails ? 'PACK_INSTALL_FAILED' : 'PACK_INSTALL_COMPLETE'));
      await vi.waitFor(() => expect(release.mock.calls.some(([id]) => id === PACK_ID)).toBe(true));
      if (fails) {
        expect(registry.getPackRegistration(PACK_ID)).toBeNull();
        expect(emitted(system.sent).map(event => event.type)).not.toContain('PACK_ACTIVATED');
      } else expect(emitted(system.sent).map(event => event.type)).toContain('PACK_ACTIVATED');
    } finally {
      finish(); await new Promise<void>(resolve => setImmediate(resolve));
      readiness.mockRestore(); release.mockRestore(); system.stop();
    }
  });

  it('replaces the registered copy without a deactivation window', async () => {
    const system = runPacksSystem();
    try {
      const { installPackFromLocal } = await import('../../../../src/packs/installer.ts');
      await installPackFromLocal(packSource('1.0.0'));
      expect(await activatePack(registry, PACK_ID, { send: () => {} } as never)).toBe(true);

      system.send({ type: 'INSTALL_PACK', packSlug: packSource('2.0.0'), sourceKind: 'local' });

      await vi.waitFor(() => {
        const types = emitted(system.sent).map(e => e.type);
        expect(types, JSON.stringify(emitted(system.sent))).toContain('PACK_INSTALL_COMPLETE');
      });
      expect(emitted(system.sent).map(e => e.type)).not.toContain('PACK_INSTALL_FAILED');
      expect(emitted(system.sent).map(e => e.type)).not.toContain('PACK_DEACTIVATED');
      expect(system.sent.map(e => e.type)).toContain('RELOAD_PACK');
      // Registered once, by the copy that was just installed
      expect(registry.getPackRegistration(PACK_ID)).not.toBeNull();
      expect(emitted(system.sent).find(e => e.type === 'PACK_INSTALL_COMPLETE')).toMatchObject({ version: '2.0.0' });
    } finally {
      system.stop();
    }
  });
});

describe('install provenance for updates', () => {
  it.each([
    [undefined, 'fixture/pack@v1.0.0', 'fixture/pack@v1.0.0'],
    ['github', 'fixture/pack@v1.0.0', 'fixture/pack@v1.0.0'],
    [undefined, 'http-tools/pack', 'http-tools/pack'],
    ['github', 'https://example.test/release.tgz', undefined],
    ['url', 'https://example.test/release.tgz', undefined],
  ])('records the actual route for %s: %s', async (sourceKind, packSlug, installedFrom) => {
    const sha256 = await stubRelease(packSource('1.0.0'));
    const system = runPacksSystem();
    try {
      system.send({ type: 'INSTALL_PACK', packSlug, sourceKind, sha256 });
      await vi.waitFor(() => expect(emitted(system.sent).map(event => event.type)).toContain('PACK_INSTALL_COMPLETE'));
      expect(readInstalledPacks().find(pack => pack.id === PACK_ID)?.installedFrom).toBe(installedFrom);
    } finally {
      system.stop();
      vi.unstubAllGlobals();
    }
  });
});

describe('a community release checksum pin', () => {
  it('refuses changed release bytes before replacing the running pack, even when GitHub publishes their checksum', async () => {
    await installPackFromLocal(packSource('1.0.0'));
    expect(await activatePack(registry, PACK_ID, { send: () => {} } as never)).toBe(true);
    await stubRelease(packSource('2.0.0'));
    const system = runPacksSystem();
    try {
      system.send({ type: 'INSTALL_PACK', packSlug: 'fixture/pack@v2.0.0', sha256: '0'.repeat(64) });
      await vi.waitFor(() => expect(emitted(system.sent).map(event => event.type)).toContain('PACK_INSTALL_FAILED'));
      expect(emitted(system.sent).find(event => event.type === 'PACK_INSTALL_FAILED')?.error).toContain('Checksum mismatch');
      expect(emitted(system.sent).map(event => event.type)).not.toContain('PACK_INSTALL_COMPLETE');
      const installed = JSON.parse(fs.readFileSync(path.join(resolveAppEnvironment().packsDir, PACK_ID, 'apack.json'), 'utf8'));
      expect(installed.version).toBe('1.0.0');
      expect(registry.getPackRegistration(PACK_ID)).not.toBeNull();
    } finally {
      system.stop();
      vi.unstubAllGlobals();
    }
  });
});

describe('app-default installation intent and lifecycle', () => {
  function advertise() {
    const input = readAppPackSources(tmpDir);
    registry.catalog.setAppPackSources(input);
    expect(input.sources).toHaveLength(1);
    return input.sources[0];
  }

  it('refuses host removal without affecting any installed pack', async () => {
    const system = runPacksSystem();
    try {
      system.send({ type: 'UNINSTALL_PACK', packId: 'host' });
      await vi.waitFor(() => expect(emitted(system.sent).map(e => e.type)).toContain('PACK_UNINSTALL_FAILED'));
      expect(emitted(system.sent).find(e => e.type === 'PACK_UNINSTALL_FAILED')?.error).toContain('part of apack');
      expect(emitted(system.sent).map(e => e.type)).not.toContain('PACK_DEACTIVATED');
    } finally { system.stop(); }
  });

  it.each(['absent', 'disabled', 'activation-failed', 'invalid-source'])('requires explicit replacement of an advertised id: %s', async kind => {
    const dir = packSource('1.0.0');
    if (kind !== 'absent' && kind !== 'invalid-source') await installPackFromLocal(dir);
    if (kind === 'disabled') setPackEnabled(PACK_ID, false);
    if (kind === 'activation-failed') registry.recordLoadProblem(PACK_ID, 'runtime refused');
    if (kind === 'invalid-source') fs.rmSync(path.join(dir, 'dist'), { recursive: true });
    registry.catalog.setAppPackSources(readAppPackSources(tmpDir));
    const system = runPacksSystem();
    try {
      system.send({ type: 'INSTALL_PACK', packSlug: packSource('2.0.0'), sourceKind: 'local' });
      await vi.waitFor(() => expect(emitted(system.sent).map(e => e.type)).toContain('PACK_INSTALL_FAILED'));
      expect(emitted(system.sent).find(e => e.type === 'PACK_INSTALL_FAILED')?.error).toContain('Use Replace');
      expect(emitted(system.sent).map(e => e.type)).not.toContain('PACK_DEACTIVATED');
      const installed = path.join(resolveAppEnvironment().packsDir, PACK_ID);
      if (kind === 'absent' || kind === 'invalid-source') expect(fs.existsSync(installed)).toBe(false);
      else expect(readPackBuild(installed).snapshot.manifest.version).toBe('1.0.0');
    } finally { system.stop(); }
  });

  it('disables an app-owned pack without deleting its declarations, then removes it deliberately', async () => {
    await restoreShippedPack(PACK_ID, packSource('1.0.0'), resolveAppEnvironment().packsDir, {
      installedPacksFile: resolveAppEnvironment().installedPacksFile,
    });
    expect(await activatePack(registry, PACK_ID, { send: () => {} } as never)).toBe(true);
    const system = runPacksSystem();
    try {
      system.send({ type: 'TOGGLE_PACK_ENABLED', packId: PACK_ID });
      expect(readInstalledPacks().find(record => record.id === PACK_ID)?.enabled).toBe(false);
      expect(registry.catalog.get(PACK_ID)?.enabled).toBe(false);
      expect(registry.getPackRegistration(PACK_ID)).toBeNull();
      expect(fs.existsSync(path.join(resolveAppEnvironment().packsDir, PACK_ID))).toBe(true);
      // The disable holds the pack until its teardown has settled
      await vi.waitFor(() => expect(emitted(system.sent).map(e => e.type)).toContain('PACKS_LIST'));
      await new Promise(resolve => setTimeout(resolve, 0));
      system.send({ type: 'UNINSTALL_PACK', packId: PACK_ID });
      await vi.waitFor(() => expect(emitted(system.sent).map(e => e.type)).toContain('PACK_UNINSTALL_COMPLETE'));
      expect(fs.existsSync(path.join(resolveAppEnvironment().packsDir, PACK_ID))).toBe(false);
      expect(readInstalledPacks().find(record => record.id === PACK_ID)?.suppressAppInstall).toBe(true);
      expect(registry.catalog.get(PACK_ID)).toBeUndefined();
    } finally { system.stop(); }
  });

  it('restores a missing default, replaces it with a user fork, then restores the selected app revision', async () => {
    const appDefault = path.join(tmpDir, 'app-default');
    fs.renameSync(packSource('1.0.0'), appDefault);
    const source = advertise();
    const system = runPacksSystem();
    try {
      system.send({ type: 'RESTORE_PACK', packId: PACK_ID, sourceRevision: source.sourceRevision });
      await vi.waitFor(() => expect(emitted(system.sent).filter(e => e.type === 'PACK_INSTALL_COMPLETE')).toHaveLength(1));
      expect(readInstalledPacks().find(record => record.id === PACK_ID)).toMatchObject({ updatesWith: 'app', enabled: true });
      const initialRevision = registry.getPackRuntime(PACK_ID)!.registrationId;
      system.send({ type: 'REPLACE_PACK', packId: PACK_ID, packSlug: packSource('2.0.0'), sourceKind: 'local' });
      await vi.waitFor(() => expect(emitted(system.sent).filter(e => e.type === 'PACK_INSTALL_COMPLETE')).toHaveLength(2));
      expect(readInstalledPacks().find(record => record.id === PACK_ID)?.updatesWith).toBe('user');
      expect(registry.getPackRuntime(PACK_ID)!.registrationId).not.toBe(initialRevision);
      expect(readPackBuild(path.join(resolveAppEnvironment().packsDir, PACK_ID)).snapshot.manifest.version).toBe('2.0.0');
      system.send({ type: 'RESTORE_PACK', packId: PACK_ID, sourceRevision: source.sourceRevision });
      await vi.waitFor(() => expect(emitted(system.sent).filter(e => e.type === 'PACK_INSTALL_COMPLETE')).toHaveLength(3));
      expect(readInstalledPacks().find(record => record.id === PACK_ID)).toMatchObject({ updatesWith: 'app', enabled: true });
      expect(readPackBuild(path.join(resolveAppEnvironment().packsDir, PACK_ID)).snapshot.manifest.version).toBe('1.0.0');
      expect(emitted(system.sent).map(e => e.type)).not.toContain('PACK_INSTALL_FAILED');
    } finally { system.stop(); }
  });

  it('refuses stale restore selections and replacement id mismatches before changing the incumbent', async () => {
    await installPackFromLocal(packSource('1.0.0'));
    const source = advertise();
    expect(await activatePack(registry, PACK_ID, { send: () => {} } as never)).toBe(true);
    const before = registry.getPackRuntime(PACK_ID);
    const record = readInstalledPacks();
    const system = runPacksSystem();
    try {
      system.send({ type: 'RESTORE_PACK', packId: PACK_ID, sourceRevision: '0'.repeat(64) });
      await vi.waitFor(() => expect(emitted(system.sent).filter(e => e.type === 'PACK_INSTALL_FAILED')).toHaveLength(1));
      expect(emitted(system.sent).find(e => e.type === 'PACK_INSTALL_FAILED')?.error).toContain('changed; refresh');
      system.send({ type: 'REPLACE_PACK', packId: PACK_ID, packSlug: packSource('2.0.0', { id: 'other-pack' }), sourceKind: 'local' });
      await vi.waitFor(() => expect(emitted(system.sent).filter(e => e.type === 'PACK_INSTALL_FAILED')).toHaveLength(2));
      expect(registry.getPackRuntime(PACK_ID)).toEqual(before);
      expect(readInstalledPacks()).toEqual(record);
      expect(registry.catalog.getSnapshot().appPackSources[0].sourceRevision).toBe(source.sourceRevision);
      expect(readPackBuild(path.join(resolveAppEnvironment().packsDir, PACK_ID)).snapshot.manifest.version).toBe('1.0.0');
    } finally { system.stop(); }
  });
});

// The system whose whole job is listing packs once did not re-send it, so an open Packs view stayed stale
// after an `apack pack dev` reload. It publishes on the one ask now, whatever caused it — the bus sends that
// after a pack changes, a client connects or the data is replaced (`tests/bus/send-state.spec.ts`).
describe('the packs system asked to publish', () => {
  it('sends the list again', () => {
    const system = runPacksSystem();
    try {
      system.send({ type: 'SEND_STATE' });

      expect(emitted(system.sent).map(e => e.type)).toEqual(['PACKS_LIST']);
    } finally {
      system.stop();
    }
  });
});

// The packs directory is what makes a pack installed. `apack pack install` and `apack pack dev` write it and
// never installed-packs.json, so a pack with no row is the ordinary case, not a broken one.
describe('a pack with nothing recorded about it', () => {
  it('is listed, enabled', async () => {
    const system = runPacksSystem();
    try {
      const { installPackFromLocal } = await import('../../../../src/packs/installer.ts');
      await installPackFromLocal(packSource('1.0.0'));
      expect(fs.existsSync(resolveAppEnvironment({ env: 'test', userDataDir: tmpDir }).installedPacksFile)).toBe(false);

      system.send({ type: 'GET_INSTALLED_PACKS' });

      const list = emitted(system.sent).find(e => e.type === 'PACKS_LIST');
      expect(list?.packs).toContainEqual(
        expect.objectContaining({ id: PACK_ID, version: '1.0.0', enabled: true, updatesWith: 'user' }),
      );
    } finally {
      system.stop();
    }
  });
});

describe('pack information without activation', () => {
  const list = (system: ReturnType<typeof runPacksSystem>) => {
    system.sent.length = 0;
    system.send({ type: 'GET_INSTALLED_PACKS' });
    const event = emitted(system.sent).find(event => event.type === 'PACKS_LIST');
    expect(event).toBeDefined();
    return (event!.packs as InstalledPackSummary[]).find(pack => pack.id === PACK_ID)!;
  };

  it.each(['disabled', 'activation-failed'])('lists %s declarations without activating backend or frontend code', async kind => {
    const dir = path.join(resolveAppEnvironment().packsDir, PACK_ID);
    const manifest = { id: PACK_ID, name: 'Declared pack', version: '1.0.0',
      data: { relations: { parent: {} } },
      features: { notes: { description: 'Feature declaration fixture.', entities: { Memo: {} }, designation: 'notes', system: { entry: 'src/system.ts' },
        surface: { label: 'Fixture', state: 'src/surface.ts' }, references: referenceDeclarations, services: { notesApi: 'src/api.ts#notesApi' } } },
      extensions: { services: { packApi: 'src/api.ts#packApi' }, artifacts: { memo: { icon: 'File' } } },
      migrations: { pack: { '1.0.0': { description: 'Create notes', up: 'src/migration.ts#up' } } },
      lifecycle: { onInit: 'src/hooks.ts#onInit' } };
    fs.mkdirSync(path.join(dir, 'runtime'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'types'));
    fs.writeFileSync(path.join(dir, PACK_LAYOUT.manifest), JSON.stringify(manifest));
    fs.writeFileSync(path.join(dir, PACK_LAYOUT.snapshot), JSON.stringify({ format: PACK_SNAPSHOT_FORMAT,
      declarationRevision: _declarationRevision(manifest), manifest, eventContracts: eventContractsFixture(manifest), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {} }));
    const marker = path.join(tmpDir, 'executed');
    fs.writeFileSync(path.join(dir, PACK_LAYOUT.runtimeEntry), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'yes'); throw new Error('Do not activate');`);
    fs.writeFileSync(path.join(dir, PACK_LAYOUT.feEntry), 'throw new Error("Do not activate frontend");');
    sealPack(dir);
    expect(() => readPackBuild(dir)).not.toThrow();
    setPackEnabled(PACK_ID, kind !== 'disabled');
    if (kind === 'activation-failed') {
      const bus = createActor(setup({}).createMachine({})).start();
      try { expect(await activatePack(registry, PACK_ID, bus)).toBe(false); }
      finally { bus.stop(); }
      expect(registry.loadProblem(PACK_ID)).toContain('Do not activate');
    }
    registry.refreshCatalog(resolveAppEnvironment().packsDir);
    const system = runPacksSystem();
    try {
      expect(list(system)).toMatchObject({ name: 'Declared pack', version: '1.0.0', enabled: kind !== 'disabled',
        entities: { Memo: 'Memo' }, entityCount: 1, relKinds: { PARENT: 'parent' }, roles: {}, hasFrontend: true,
        systems: [`${PACK_ID}/notes`], services: ['packApi', 'notesApi'], artifacts: ['memo'],
        migrationCount: 1, lifecycleHooks: ['onInit'],
        features: [{ id: 'notes', description: manifest.features.notes.description, designation: 'notes', hasSystem: true, surface: manifest.features.notes.surface, references: referenceDeclarations, services: ['notesApi'] }] });
      expect(registry.getPackRegistration(PACK_ID)).toBeNull();
      expect(fs.existsSync(marker)).toBe(kind === 'activation-failed');
    } finally { system.stop(); }
  });

  it('retains accepted metadata and publishes a replacement refusal before notifying readers', async () => {
    await installPackFromLocal(packSource('1.0.0'));
    registry.refreshCatalog(resolveAppEnvironment().packsDir);
    const observations: Array<string | undefined> = [];
    const stop = registry.catalog.onChanged(() => observations.push(registry.loadProblem(PACK_ID)));
    const dir = path.join(resolveAppEnvironment().packsDir, PACK_ID);
    fs.writeFileSync(path.join(dir, PACK_LAYOUT.manifest), JSON.stringify({ id: PACK_ID, name: 'Unaccepted', version: '9.0.0' }));
    const system = runPacksSystem();
    try {
      const pack = list(system);
      expect(pack).toMatchObject({ name: 'Reinstall Pack', version: '1.0.0', loadProblem: expect.stringContaining('declarations were refused') });
      expect(observations).toEqual([pack.loadProblem]);
    } finally { stop(); system.stop(); }
  });

  it('can remove an unreadable installation without treating its manifest as authority', async () => {
    const dir = path.join(resolveAppEnvironment().packsDir, PACK_ID);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, PACK_LAYOUT.manifest), '{');
    const system = runPacksSystem();
    try {
      system.send({ type: 'UNINSTALL_PACK', packId: PACK_ID });
      await vi.waitFor(() => expect(emitted(system.sent).some(event => event.type === 'PACK_UNINSTALL_COMPLETE')).toBe(true));
      expect(fs.existsSync(dir)).toBe(false);
    } finally { system.stop(); }
  });

  it('shows unreadable installations without trusting their manifest metadata', () => {
    const dir = path.join(resolveAppEnvironment().packsDir, PACK_ID);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, PACK_LAYOUT.manifest), '{');
    const system = runPacksSystem();
    try {
      expect(list(system)).toMatchObject({ id: PACK_ID, name: PACK_ID, enabled: true,
        loadProblem: expect.stringContaining('declarations were refused') });
      expect(list(system).version).toBeUndefined();
    } finally { system.stop(); }
  });
});

// The app skips an installed pack it can't load and boots on. The pack is still installed and enabled, so the Packs
// view lists it, and has to say why it isn't running rather than show it as enabled.
describe('an installed pack the app could not load', () => {
  const listed = (system: ReturnType<typeof runPacksSystem>) => {
    system.sent.length = 0;
    system.send({ type: 'GET_INSTALLED_PACKS' });
    const list = emitted(system.sent).find(e => e.type === 'PACKS_LIST');
    // Named rather than dereferenced through `?.`: no PACKS_LIST is the regression this helper exists to
    // catch, and a truncated chain reports it as a TypeError on the next line instead of by name
    expect(list, 'the system emitted no PACKS_LIST').toBeDefined();
    return (list!.packs as InstalledPackSummary[]).find(p => p.id === PACK_ID);
  };
  const snapshotFile = () => path.join(resolveAppEnvironment().packsDir, PACK_ID, PACK_LAYOUT.snapshot);

  it('is listed with why, until a load of it succeeds', async () => {
    await installPackFromLocal(packSource('1.0.0'));
    // A build another apack made: what an app update leaves an installed pack as
    fs.writeFileSync(snapshotFile(), JSON.stringify({ format: PACK_SNAPSHOT_FORMAT + 1 }));
    loadAppPacks(registry);
    expect(registry.getPackRegistration(PACK_ID)).toBeNull();

    const system = runPacksSystem();
    try {
      expect(listed(system)).toMatchObject({
        enabled: true,
        loadProblem: `its declarations were refused: its snapshot is format ${PACK_SNAPSHOT_FORMAT + 1}, written by a newer apack CLI; this apack reads format ${PACK_SNAPSHOT_FORMAT}. Update apack to use it`,
      });

      fs.writeFileSync(snapshotFile(), JSON.stringify({ declarationRevision: _declarationRevision(JSON.parse(fs.readFileSync(path.join(resolveAppEnvironment().packsDir, PACK_ID, 'apack.json'), 'utf-8'))), format: PACK_SNAPSHOT_FORMAT, manifest: JSON.parse(fs.readFileSync(path.join(resolveAppEnvironment().packsDir, PACK_ID, 'apack.json'), 'utf-8')), eventContracts: eventContractsFixture(JSON.parse(fs.readFileSync(path.join(resolveAppEnvironment().packsDir, PACK_ID, 'apack.json'), 'utf-8'))), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {} }));
      await reloadPackById(registry, PACK_ID, { send: () => {} } as never);

      expect(registry.getPackRegistration(PACK_ID)).not.toBeNull();
      expect(listed(system)?.loadProblem).toBeUndefined();
    } finally {
      system.stop();
    }
  });

  it('keeps a declaration failure visible after the pack is disabled', async () => {
    await installPackFromLocal(packSource('1.0.0'));
    fs.writeFileSync(snapshotFile(), JSON.stringify({}));
    expect(await activatePack(registry, PACK_ID, { send: () => {} } as never)).toBe(false);

    const system = runPacksSystem();
    try {
      expect(listed(system)?.loadProblem).toMatch(/^its declarations were refused: its snapshot is format \(none\), written by an older apack CLI/);

      system.send({ type: 'TOGGLE_PACK_ENABLED', packId: PACK_ID });

      expect(listed(system)).toMatchObject({
        enabled: false,
        loadProblem: expect.stringMatching(/^its declarations were refused: its snapshot is format \(none\)/),
      });
      expect(registry.getPackRegistration(PACK_ID)).toBeNull();
    } finally {
      system.stop();
    }
  });
});

// A write that fails is only a log line by default, and the app then disagrees with the user until the
// next boot puts the pack back the way it was. The decision that was lost is what has to be said.
describe('a decision that could not be saved', () => {
  it('says which one, rather than letting the toggle look like it worked', async () => {
    const system = runPacksSystem();
    try {
      const { installPackFromLocal } = await import('../../../../src/packs/installer.ts');
      await installPackFromLocal(packSource('1.0.0'));
      expect(await activatePack(registry, PACK_ID, { send: () => {} } as never)).toBe(true);
      takeSystemErrors();
      // A directory where the record goes: the rename onto it fails, whatever is written beside it
      fs.mkdirSync(resolveAppEnvironment({ env: 'test', userDataDir: tmpDir }).installedPacksFile, { recursive: true });

      system.send({ type: 'TOGGLE_PACK_ENABLED', packId: PACK_ID });

      expect(takeSystemErrors().map(e => e.message).join('\n'))
        .toMatch(new RegExp(`Couldn't save that ${PACK_ID} is disabled`));
      expect(registry.getPackRegistration(PACK_ID)).not.toBeNull();
      expect(emitted(system.sent).map(event => event.type)).not.toContain('PACK_DEACTIVATED');
      expect(emitted(system.sent).find(event => event.type === 'PACK_ENABLED_CHANGED')).toMatchObject({ enabled: true });
    } finally {
      system.stop();
    }
  });
});

describe('a pack that is gone', () => {
  it('records deliberate removal when it is uninstalled', async () => {
    const system = runPacksSystem();
    try {
      const { installPackFromLocal } = await import('../../../../src/packs/installer.ts');
      await installPackFromLocal(packSource('1.0.0'));
      const { recordInstalled } = await import('../../../../src/packs/installed.ts');
      recordInstalled(PACK_ID, 'acme/reinstall-pack');

      system.send({ type: 'UNINSTALL_PACK', packId: PACK_ID });

      await vi.waitFor(() => {
        expect(emitted(system.sent).map(e => e.type)).toContain('PACK_UNINSTALL_COMPLETE');
      });
      expect(readInstalledPacks()).toEqual([{ id: PACK_ID, enabled: true, suppressAppInstall: true }]);
    } finally {
      system.stop();
    }
  });

  // The pack is still in the packs directory, so it is still installed — there is no record to roll back,
  // because the record never claimed it was installed in the first place
  it('stays listed when the uninstall fails', async () => {
    const system = runPacksSystem();
    try {
      const { installPackFromLocal } = await import('../../../../src/packs/installer.ts');
      await installPackFromLocal(packSource('1.0.0'));
      expect(await activatePack(registry, PACK_ID, { send: () => {} } as never)).toBe(true);
      const accepted = registry.getPackRuntime(PACK_ID);
      // A read-only pack directory: the uninstall can't unlink what is inside it, so it throws with the
      // pack still there — which is the case this is about, an uninstall that did not happen
      fs.chmodSync(path.join(_appDirOf(tmpDir), 'packs', PACK_ID), 0o500);

      system.send({ type: 'UNINSTALL_PACK', packId: PACK_ID });

      await vi.waitFor(() => {
        expect(emitted(system.sent).map(e => e.type)).toContain('PACK_UNINSTALL_FAILED');
      });
      expect(registry.getPackRuntime(PACK_ID)).toEqual(accepted);
      expect(emitted(system.sent).map(event => event.type)).not.toContain('PACK_DEACTIVATED');
      fs.chmodSync(path.join(_appDirOf(tmpDir), 'packs', PACK_ID), 0o700);
      system.send({ type: 'GET_INSTALLED_PACKS' });
      const list = emitted(system.sent).filter(e => e.type === 'PACKS_LIST').pop();
      expect(list?.packs).toContainEqual(expect.objectContaining({ id: PACK_ID }));
    } finally {
      fs.chmodSync(path.join(_appDirOf(tmpDir), 'packs', PACK_ID), 0o700);
      system.stop();
    }
  });

  it("drops what was recorded about packs boot doesn't find, so rows don't pile up", async () => {
    const { recordInstalled, forgetPacksExcept } = await import('../../../../src/packs/installed.ts');
    recordInstalled('gone-pack', 'acme/gone');
    recordInstalled('here-pack', 'acme/here');

    forgetPacksExcept(new Set(['here-pack']));

    expect(readInstalledPacks()).toMatchObject([{ id: 'here-pack' }]);
  });
});

describe('installing over a pack that is already running', () => {

  it.each([
    ['runtime import', 'throw new Error("candidate import refused");'],
    ['runtime binding', 'module.exports.registration.bindServices = () => { throw new Error("candidate binding refused"); };'],
  ])('preserves the incumbent and build after refused %s', async (_kind, runtime) => {
    const installed = await installPackFromLocal(packSource('1.0.0'));
    expect(await activatePack(registry, PACK_ID, { send: () => {} } as never)).toBe(true);
    const previous = registry.getPackRuntime(PACK_ID);
    const registration = registry.getPackRegistration(PACK_ID);
    const build = readPackBuild(installed.dir);
    const records = readInstalledPacks();
    const system = runPacksSystem();
    try {
      system.send({ type: 'INSTALL_PACK', packSlug: packSource('2.0.0', { runtime }), sourceKind: 'local' });
      await vi.waitFor(() => expect(emitted(system.sent).map(e => e.type)).toContain('PACK_INSTALL_FAILED'));
      expect(registry.getPackRegistration(PACK_ID)).toBe(registration);
      expect(registry.getPackRuntime(PACK_ID)).toEqual(previous);
      expect(readPackBuild(installed.dir)).toEqual(build);
      expect(readInstalledPacks()).toEqual(records);
      expect(emitted(system.sent).map(e => e.type)).not.toContain('PACK_DEACTIVATED');
      expect(system.sent.map(e => e.type)).not.toContain('TEARDOWN_PACK');
      expect(system.sent.map(e => e.type)).not.toContain('RELOAD_PACK');
      expect(registry.loadProblem(PACK_ID)).toBeUndefined();
    } finally { system.stop(); }
  });

  it('reserves the resolved owner across installs from different sources', async () => {
    const a = path.join(tmpDir, 'source-a');
    const b = path.join(tmpDir, 'source-b');
    fs.cpSync(packSource('2.0.0'), a, { recursive: true });
    fs.cpSync(packSource('3.0.0'), b, { recursive: true });
    const system = runPacksSystem();
    try {
      system.send({ type: 'INSTALL_PACK', packSlug: a, sourceKind: 'local' });
      system.send({ type: 'INSTALL_PACK', packSlug: b, sourceKind: 'local' });
      await vi.waitFor(() => {
        expect(emitted(system.sent).map(e => e.type)).toContain('PACK_INSTALL_COMPLETE');
        expect(emitted(system.sent).map(e => e.type)).toContain('PACK_INSTALL_FAILED');
      });
      expect(emitted(system.sent).find(e => e.type === 'PACK_INSTALL_FAILED')).toMatchObject({
        packSlug: b, error: expect.stringContaining('Another operation on reinstall-pack is in progress'),
      });
      expect(registry.packOrigin(PACK_ID)?.version).toBe('2.0.0');
      expect(readPackBuild(path.join(resolveAppEnvironment().packsDir, PACK_ID)).integrity.version).toBe('2.0.0');
    } finally { system.stop(); }
  });

  it('retains accepted files but stops runtime after initialization fails', async () => {
    await installPackFromLocal(packSource('1.0.0'));
    expect(await activatePack(registry, PACK_ID, { send: () => {} } as never)).toBe(true);
    const source = packSource('2.0.0', {
      runtime: 'module.exports.registration.lifecycle = { onInit() { throw new Error("initialization refused"); } };',
      manifest: { lifecycle: { onInit: 'init.ts#onInit' } },
    });
    const system = runPacksSystem();
    try {
      system.send({ type: 'INSTALL_PACK', packSlug: source, sourceKind: 'local' });
      await vi.waitFor(() => expect(emitted(system.sent).map(e => e.type)).toContain('PACK_INSTALL_FAILED'));
      expect(emitted(system.sent).find(e => e.type === 'PACK_INSTALL_FAILED')).toMatchObject({
        error: expect.stringContaining('initialization refused'),
      });
      expect(registry.getPackRegistration(PACK_ID)).toBeNull();
      expect(registry.settingsCatalog().dependencies).toHaveProperty(PACK_ID);
      expect(readPackBuild(path.join(resolveAppEnvironment().packsDir, PACK_ID)).integrity.version).toBe('2.0.0');
      expect(system.sent.map(e => e.type)).toContain('PACK_CHANGED');
    } finally { system.stop(); }
  });

  it('refuses a second install of the same slug while one is in flight', async () => {
    const system = runPacksSystem();
    try {
      const slug = packSource('1.0.0');
      system.send({ type: 'INSTALL_PACK', packSlug: slug, sourceKind: 'local' });
      system.send({ type: 'INSTALL_PACK', packSlug: slug, sourceKind: 'local' });

      await vi.waitFor(() => {
        expect(emitted(system.sent).map(e => e.type)).toContain('PACK_INSTALL_COMPLETE');
      });
      // One install started, not two, and the second is told why
      expect(emitted(system.sent).filter(e => e.type === 'PACK_INSTALL_STARTED')).toHaveLength(1);
      expect(emitted(system.sent)).toContainEqual({ type: 'PACK_INSTALL_FAILED', packSlug: slug, error: expect.stringContaining('in progress') });
    } finally {
      system.stop();
    }
  });
});

// What the app has done to a pack's data outlives the pack's directory, because the data does: an
// uninstall removes packs/<id> and nothing in the database. Running a reinstalled pack's migrations
// again over rows they have already moved is the failure this avoids.
describe('what a reinstall does not redo', () => {
  it('leaves the applied content and migrated version an uninstall did not invalidate', async () => {
    resetTestData();
    appState.update({ packVersions: { [PACK_ID]: '1.0.0' } });
    appliedContent.record(PACK_ID, { revision: 'the-revision', wrote: new Map([['k', { parts: {} }]]) });
    await installPackFromLocal(packSource('1.0.0'));

    const system = runPacksSystem();
    try {
      system.send({ type: 'UNINSTALL_PACK', packId: PACK_ID });
      await vi.waitFor(() => {
        expect(emitted(system.sent).map(e => e.type)).toContain('PACK_UNINSTALL_COMPLETE');
      });

      expect(appliedContent.get(PACK_ID)).toEqual({ revision: 'the-revision', items: { k: { parts: {} } } });
      expect(appState.get().packVersions[PACK_ID]).toBe('1.0.0');
    } finally {
      system.stop();
    }
  });
});

// Installing is the remedy a user reaches for when a pack's data didn't content, so what it reports has to be about
// the pack they end up with. It wasn't: `recordInstalled` replaces the record, which dropped the `lastError` the
// earlier failure left — so reinstalling a pack whose data never written reported that it had installed cleanly,
// and took away the only sign that it hadn't.
//
// **What makes the report true changed on 2026-10-07, and this case did not.** A reinstall used to re-apply by
// accident, through the file times that were once in the content revision: the apply failed again and wrote the error
// back. Content are keyed on content now, so the same pack installed again is the same bytes and nothing is
// re-imported — and what keeps this honest is `recordInstalled` preserving `lastError`, which belongs to the
// content outcome (`recordApplyOutcomes`) and is not an install's to clear. `activationProblem` reads it, so the
// install still says the pack's data failed to apply, which is what the user needs to know.
describe('reinstalling a pack whose data did not content', () => {
  const outcomes = (sent: AnyEventObject[]) =>
    emitted(sent).map(e => e.type).filter(t => t === 'PACK_INSTALL_COMPLETE' || t === 'PACK_INSTALL_FAILED');

  it('says so again, rather than reporting the reinstall as clean', async () => {
    const source = packSource('1.0.0', { failsImport: true });

    const first = runPacksSystem();
    try {
      first.send({ type: 'INSTALL_PACK', packSlug: source, sourceKind: 'local' });
      await vi.waitFor(() => expect(outcomes(first.sent)).toHaveLength(1));
      expect(outcomes(first.sent)).toEqual(['PACK_INSTALL_FAILED']);
      expect(readInstalledPacks().find(r => r.id === PACK_ID)?.lastError).toBeTruthy();
    } finally {
      first.stop();
    }

    // The same pack again, byte for byte: nothing about its data has changed, so nothing is written again
    const second = runPacksSystem();
    try {
      second.send({ type: 'INSTALL_PACK', packSlug: source, sourceKind: 'local' });
      await vi.waitFor(() => expect(outcomes(second.sent)).toHaveLength(1));

      expect(outcomes(second.sent)).toEqual(['PACK_INSTALL_FAILED']);
      expect(readInstalledPacks().find(r => r.id === PACK_ID)?.lastError,
        'the reinstall erased the earlier failure, which is the only sign the data never written').toBeTruthy();
    } finally {
      second.stop();
    }
  });
});

// The id an uninstall is given names the directory it deletes, recursively
describe('uninstalling by an id that is not an installed pack', () => {
  it.each([['..'], [''], ['a/../..'], ['not-installed']])('is refused before anything stops or is deleted: %j', async (packId) => {
    await installPackFromLocal(packSource('1.0.0'));
    const system = runPacksSystem();
    try {
      system.send({ type: 'UNINSTALL_PACK', packId });

      await vi.waitFor(() => expect(emitted(system.sent).map(e => e.type)).toContain('PACK_UNINSTALL_FAILED'));
      expect(emitted(system.sent).find(e => e.type === 'PACK_UNINSTALL_FAILED')).toMatchObject({ error: `"${packId}" is not an installed pack` });
      expect(emitted(system.sent).map(e => e.type)).not.toContain('PACK_DEACTIVATED');
      expect(fs.existsSync(path.join(_appDirOf(tmpDir), 'packs', PACK_ID, 'apack.json'))).toBe(true);
    } finally {
      system.stop();
    }
  });
});

describe('live updates preserve availability and enablement', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the incumbent throughout a refused download', async () => {
    await installPackFromLocal(packSource('1.0.0'));
    const { recordInstalled } = await import('../../../../src/packs/installed.ts');
    recordInstalled(PACK_ID, 'acme/pack');
    expect(await activatePack(registry, PACK_ID, { send: () => {} } as never)).toBe(true);
    const previous = registry.getPackRuntime(PACK_ID);
    const records = readInstalledPacks();
    let respond!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { respond = resolve; })));
    const system = runPacksSystem();
    try {
      system.send({ type: 'UPDATE_PACK', packId: PACK_ID });
      expect(registry.getPackRuntime(PACK_ID)).toEqual(previous);
      expect(system.sent.map(e => e.type)).not.toContain('TEARDOWN_PACK');
      respond(new Response('missing', { status: 404 }));
      await vi.waitFor(() => expect(emitted(system.sent).map(e => e.type)).toContain('PACK_UPDATE_FAILED'));
      expect(registry.getPackRuntime(PACK_ID)).toEqual(previous);
      expect(readInstalledPacks()).toEqual(records);
      expect(emitted(system.sent).map(e => e.type)).not.toContain('PACK_DEACTIVATED');
    } finally { system.stop(); }
  });

  it('updates a disabled build without activating it', async () => {
    await installPackFromLocal(packSource('1.0.0'));
    const { recordInstalled } = await import('../../../../src/packs/installed.ts');
    recordInstalled(PACK_ID, 'acme/pack');
    setPackEnabled(PACK_ID, false);
    registry.refreshCatalog();
    await stubRelease(packSource('2.0.0'));
    const system = runPacksSystem();
    try {
      system.send({ type: 'UPDATE_PACK', packId: PACK_ID });
      await vi.waitFor(() => expect(emitted(system.sent).map(e => e.type)).toContain('PACK_UPDATE_COMPLETE'));
      expect(registry.getPackRegistration(PACK_ID)).toBeNull();
      expect(readInstalledPacks().find(entry => entry.id === PACK_ID)?.enabled).toBe(false);
      expect(registry.catalog.getSnapshot().packs.find(pack => pack.snapshot.manifest.id === PACK_ID))
        .toMatchObject({ enabled: false, snapshot: { manifest: { version: '2.0.0' } } });
      expect(emitted(system.sent).map(e => e.type)).not.toContain('PACK_ACTIVATED');
    } finally { system.stop(); }
  });
});

describe('app-source update offers and acceptance', () => {
  const installed = () => path.join(resolveAppEnvironment().packsDir, PACK_ID);
  async function ownDefault(enabled = true) {
    await restoreShippedPack(PACK_ID, packSource('1.0.0'), resolveAppEnvironment().packsDir, {
      installedPacksFile: resolveAppEnvironment().installedPacksFile,
    });
    if (!enabled) setPackEnabled(PACK_ID, false);
    else expect(await activatePack(registry, PACK_ID, { send: () => {} } as never)).toBe(true);
  }
  function offer() {
    const input = readAppPackSources(tmpDir);
    registry.catalog.setAppPackSources(input);
    return input.sources[0];
  }

  it.each([true, false])('updates selected app-owned bytes while preserving enablement: %s', async enabled => {
    await ownDefault(enabled);
    const marker = path.join(tmpDir, 'activated');
    packSource('2.0.0', { runtime: enabled ? '' : `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'activated'); throw new Error('Disabled update executed');` });
    const source = offer();
    const system = runPacksSystem();
    try {
      system.send({ type: 'GET_INSTALLED_PACKS' });
      expect(emitted(system.sent).find(event => event.type === 'PACKS_LIST')?.packs)
        .toContainEqual(expect.objectContaining({ id: PACK_ID, appUpdate: expect.objectContaining({ sourceRevision: source.sourceRevision }) }));
      system.send({ type: 'UPDATE_APP_PACK', packId: PACK_ID, sourceRevision: source.sourceRevision });
      await vi.waitFor(() => expect(emitted(system.sent).map(event => event.type)).toContain('PACK_UPDATE_COMPLETE'));
      expect(readInstalledPacks().find(record => record.id === PACK_ID)).toMatchObject({ enabled, updatesWith: 'app', shippedRevision: source.sourceRevision });
      expect(readPackBuild(installed()).snapshot.manifest.version).toBe('2.0.0');
      expect(registry.catalog.get(PACK_ID)?.enabled).toBe(enabled);
      if (!enabled) {
        expect(registry.getPackRegistration(PACK_ID)).toBeNull();
        expect(fs.existsSync(marker)).toBe(false);
        expect(emitted(system.sent).map(event => event.type)).not.toContain('PACK_ACTIVATED');
      }
      system.send({ type: 'GET_INSTALLED_PACKS' });
      const last = emitted(system.sent).filter(event => event.type === 'PACKS_LIST').pop();
      expect(last?.packs.find((pack: InstalledPackSummary) => pack.id === PACK_ID)?.appUpdate).toBeUndefined();
    } finally { system.stop(); }
  });

  it('offers a changed build with the same version, while user-owned forks get no app update', async () => {
    await ownDefault(false);
    const dir = packSource('1.0.0');
    fs.appendFileSync(path.join(dir, 'dist', PACK_LAYOUT.runtimeEntry), '\n// new app build');
    sealBuild(dir);
    const source = offer();
    const system = runPacksSystem();
    try {
      system.send({ type: 'GET_INSTALLED_PACKS' });
      expect(emitted(system.sent).filter(event => event.type === 'PACKS_LIST').pop()?.packs[0].appUpdate)
        .toMatchObject({ version: '1.0.0', sourceRevision: source.sourceRevision });
      await installPackFromLocal(dir, undefined, { installedPacksFile: resolveAppEnvironment().installedPacksFile });
      system.send({ type: 'GET_INSTALLED_PACKS' });
      expect(emitted(system.sent).filter(event => event.type === 'PACKS_LIST').pop()?.packs[0].appUpdate).toBeUndefined();
      system.send({ type: 'UPDATE_APP_PACK', packId: PACK_ID, sourceRevision: source.sourceRevision });
      await vi.waitFor(() => expect(emitted(system.sent).map(event => event.type)).toContain('PACK_UPDATE_FAILED'));
      expect(emitted(system.sent).find(event => event.type === 'PACK_UPDATE_FAILED')?.error).toContain('user-managed');
      expect(readInstalledPacks().find(record => record.id === PACK_ID)?.updatesWith).toBe('user');
    } finally { system.stop(); }
  });

  it('keeps an invalid app source visible and refuses the remote route for app-owned records', async () => {
    await ownDefault(false);
    const records = readInstalledPacks();
    const { writeInstalledPacks } = await import('../../../../src/packs/installed.ts');
    writeInstalledPacks(records.map(record => ({ ...record, installedFrom: 'acme/pack', availableVersion: '9.0.0' })));
    const dir = packSource('2.0.0');
    fs.rmSync(path.join(dir, 'dist'), { recursive: true });
    offer();
    const fetch = vi.fn(() => { throw new Error('No remote fetch permitted'); });
    vi.stubGlobal('fetch', fetch);
    const system = runPacksSystem();
    try {
      system.send({ type: 'GET_INSTALLED_PACKS' });
      const pack = emitted(system.sent).find(event => event.type === 'PACKS_LIST')?.packs[0];
      expect(pack.appUpdate).toBeUndefined();
      expect(pack.availableVersion).toBeUndefined();
      expect(pack.appSourceProblem).toContain('not built');
      system.send({ type: 'UPDATE_PACK', packId: PACK_ID });
      expect(emitted(system.sent).find(event => event.type === 'PACK_UPDATE_FAILED')?.error).toContain('app-source');
      expect(fetch).not.toHaveBeenCalled();
      expect(readPackBuild(installed()).snapshot.manifest.version).toBe('1.0.0');
    } finally { system.stop(); vi.unstubAllGlobals(); }
  });

  it('refuses stale selections without replacing the incumbent build, runtime or record', async () => {
    await ownDefault();
    packSource('2.0.0');
    offer();
    const before = readPackBuild(installed()).revision;
    const runtime = registry.getPackRuntime(PACK_ID);
    const records = readInstalledPacks();
    const system = runPacksSystem();
    try {
      system.send({ type: 'UPDATE_APP_PACK', packId: PACK_ID, sourceRevision: '0'.repeat(64) });
      await vi.waitFor(() => expect(emitted(system.sent).map(event => event.type)).toContain('PACK_UPDATE_FAILED'));
      expect(readPackBuild(installed()).revision).toBe(before);
      expect(registry.getPackRuntime(PACK_ID)).toEqual(runtime);
      expect(readInstalledPacks()).toEqual(records);
    } finally { system.stop(); }
  });
});

// An update takes whatever the release holds, which its source decides and the app doesn't
describe('updating to a release that holds another pack', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    if (registry.getPackRegistration('shipped-pack')) registry.unregisterPack('shipped-pack');
  });

  async function updateTo(releaseId: string) {
    await installPackFromLocal(packSource('1.0.0'));
    const { recordInstalled } = await import('../../../../src/packs/installed.ts');
    recordInstalled(PACK_ID, 'acme/reinstall-pack');
    expect(await activatePack(registry, PACK_ID, { send: () => {} } as never)).toBe(true);
    await stubRelease(packSource('2.0.0', { id: releaseId }));

    const previous = registry.getPackRuntime(PACK_ID);
    const system = runPacksSystem();
    try {
      system.send({ type: 'UPDATE_PACK', packId: PACK_ID });
      await vi.waitFor(() => expect(emitted(system.sent).map(e => e.type)).toContain('PACK_UPDATE_FAILED'));
      expect(registry.getPackRuntime(PACK_ID)).toEqual(previous);
      expect(system.sent.map(e => e.type)).not.toContain('TEARDOWN_PACK');
      return emitted(system.sent);
    } finally {
      system.stop();
    }
  }

  const installedVersion = () => JSON.parse(fs.readFileSync(path.join(_appDirOf(tmpDir), 'packs', PACK_ID, 'apack.json'), 'utf-8')).version;

  // Refused for the same reason as any other id, and worded the same: the release is for a different pack
  // than the one being updated. A shipped pack gets no refusal of its own — it is installed like any other
  it("is refused the same way when that pack is one the app ships, and the incumbent keeps running", async () => {
    registry.registerPack({ id: 'shipped-pack' }, { declarationRevision: 'fixture-revision', id: 'shipped-pack', name: 'Shipped', version: '1.0.0', dir: 'packs/shipped-pack' });

    const sent = await updateTo('shipped-pack');

    expect(sent.find(e => e.type === 'PACK_UPDATE_FAILED')).toMatchObject({ error: expect.stringContaining('holds the pack "shipped-pack", not "reinstall-pack"') });
    expect(fs.existsSync(path.join(_appDirOf(tmpDir), 'packs', 'shipped-pack'))).toBe(false);
    expect(installedVersion()).toBe('1.0.0');
    expect(sent.map(e => e.type)).not.toContain('PACK_ACTIVATED');
    expect(sent.map(e => e.type)).not.toContain('PACK_DEACTIVATED');
  });

  it('is refused when that pack is any other, and the incumbent keeps running', async () => {
    const sent = await updateTo('other-pack');

    expect(sent.find(e => e.type === 'PACK_UPDATE_FAILED')).toMatchObject({ error: expect.stringContaining('holds the pack "other-pack", not "reinstall-pack"') });
    expect(fs.existsSync(path.join(_appDirOf(tmpDir), 'packs', 'other-pack'))).toBe(false);
    expect(installedVersion()).toBe('1.0.0');
    expect(sent.map(e => e.type)).not.toContain('PACK_ACTIVATED');
    expect(sent.map(e => e.type)).not.toContain('PACK_DEACTIVATED');
  });
});

/**
 * **An import is write-only, which is what makes it an import and not an apply.** It reads nothing of what
 * the last apply wrote — so no verdict here can be reached from it — and it records what it wrote, because
 * an import that rewrote entities and recorded nothing would leave the applied content describing the
 * version before it, which the next boot's apply would read as the user's edits.
 */
describe('importing a pack’s content', () => {
  /** A compiled directory the real generic applier can read, with one memo item */
  function compiledMemos(): string {
    const dir = path.join(tmpDir, 'compiled');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'content.json'), JSON.stringify({
      version: 1, packId: PACK_ID, entries: [{ key: 'memos', written: true, count: 1, identity: ['name'], items: [{ key: 'Intro' }] }],
    }));
    fs.writeFileSync(path.join(dir, 'memos.content.json'), JSON.stringify({
      records: [{ entity: 'Memo', name: 'Intro', body: 'Hello', contentHash: 'intro-v1' }],
    }));
    return dir;
  }

  it('records what it wrote and leaves the revision where it is', async () => {
    const { startTestRuntime, testPacks } = await import('@apackdev/sdk/testing');
    const { createFormatApplier } = await import('@apackdev/sdk/content');
    resetTestData();
    startTestRuntime({ entityTypes: ['Memo'] });
    appliedContent.record(PACK_ID, { revision: 'the-revision', wrote: new Map() });
    testPacks.appliers.set(PACK_ID, [createFormatApplier({ key: 'memos', entities: ['Memo'], identity: ['name'] })]);

    const system = runPacksSystem();
    try {
      system.send({ type: 'IMPORT_PACK_CONTENT', directory: compiledMemos(), mode: 'replace-on-collision' });
      await vi.waitFor(() => {
        expect(emitted(system.sent).map((e) => e.type)).toContain('PACK_CONTENT_IMPORTED');
      });

      const content = appliedContent.get(PACK_ID);
      expect(Object.values(content.items), 'the item the import wrote, with a part per field')
        .toEqual([{ entityType: 'Memo', contentHash: 'intro-v1', parts: { body: expect.any(String), name: expect.any(String) } }]);
      expect(content.revision, 'asking for the data again is not a change to what the pack declares')
        .toBe('the-revision');

      /**
       * **And the record it wrote is not one it reads.** The user destroys the entity and asks for the
       * pack's content back: an apply would read the entry it just wrote and leave the deletion alone,
       * which is exactly not what was asked for.
       */
      const { untypedQuery, untypedWrite } = await import('@apackdev/sdk/ears');
      const memos = () => untypedQuery('Memo').pickAll();
      untypedWrite(memos()[0]!.id).destroy();
      expect(memos(), 'a destroyed entity leaves nothing behind, which is the premise').toEqual([]);

      system.send({ type: 'IMPORT_PACK_CONTENT', directory: compiledMemos(), mode: 'replace-on-collision' });
      await vi.waitFor(() => {
        expect(memos(), 'the content the user asked for was not put back').toHaveLength(1);
      });
    } finally {
      testPacks.appliers.delete(PACK_ID);
      system.stop();
    }
  });
});

/**
 * **The three answers a user gives to one content item**, which are the only requests in the app that write
 * a pack's content over what the user has made of it, or remove it.
 *
 * The fixture has two entries: an SDK action and a pack-owned prompt with its own writer, one that offers
 * and one that does not. Two entries rather than one because the thing most worth holding here is what a
 * request about *one* item does to everything else — the answer was "overwrites all of it", and nothing
 * could have said so with a single entry.
 */
describe('a user answering for one of a pack’s content items', () => {
  const CONTENT_PACK = 'content-pack';
  const ACTION_KEY = `${CONTENT_PACK}:actions/${encodeURIComponent(JSON.stringify(['Action', 'Echo']))}`;
  const PROMPT_KEY = `${CONTENT_PACK}:pack-prompts/${encodeURIComponent(JSON.stringify(['PackPrompt', 'Greet']))}`;

  /**
   * The pack as installed, in the data dir's packs directory — which is where the restore looks, because
   * the host put it there and a pack never says where its compiled content is.
   */
  function contentPack(version: 'v1' | 'v2'): string {
    const dir = path.join(_appDirOf(tmpDir), 'packs', CONTENT_PACK);
    const content = path.join(dir, PACK_LAYOUT.contentDir);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(content, { recursive: true });
    writeInstalledPackFixture(dir, { id: CONTENT_PACK, name: 'Content Pack', version: '1.0.0',
      data: { entities: { PackPrompt: {} } },
      content: { sources: { actions: 'src/actions', 'pack-prompts': { path: 'src/prompts', format: 'pack-prompts', onUserEdit: 'offer' } },
        formats: { 'pack-prompts': { format: 'json', entity: 'PackPrompt', identity: ['label'] } },
        writers: { PackPrompt: 'src/writers.ts#promptWriter' } } });
    fs.writeFileSync(path.join(content, 'content.json'), JSON.stringify({ version: 1, packId: CONTENT_PACK, entries: [
      { key: 'actions', written: true, count: 1, identity: ['label'], items: [{ key: 'Echo' }] },
      { key: 'pack-prompts', written: true, count: 1, identity: ['label'], items: [{ key: 'Greet' }] },
    ] }));
    fs.writeFileSync(path.join(content, 'actions.content.json'), JSON.stringify({
      records: [{ entity: 'Action', label: 'Echo', description: `theirs ${version}`, input: {}, actionFn: 'return params', contentHash: `echo-${version}` }],
    }));
    fs.writeFileSync(path.join(content, 'pack-prompts.content.json'), JSON.stringify({
      records: [{ entity: 'PackPrompt', label: 'Greet', description: `theirs ${version}`, contentHash: `greet-${version}` }],
    }));
    sealPack(dir);
    return dir;
  }

  /** The prompt's writer records its removal instead of destroying, as a pack's own delete does */
  const removed: string[] = [];

  function registerContentPack(): void {
    const dir = path.join(resolveAppEnvironment().packsDir, CONTENT_PACK);
    const { snapshot, integrity, revision } = readPackBuild(dir);
    const manifest = snapshot.manifest;
    registry.registerPack({
      declarationRevision: snapshot.declarationRevision,
      ears: { entities: { ..._packEntityTypes(manifest) }, relKinds: {}, roles: {} },
      id: CONTENT_PACK,
      appliers: [
        createFormatApplier({ key: 'actions', entities: ['Action'], identity: ['label'], onUserEdit: 'offer' }),
        createFormatApplier({ key: 'pack-prompts', entities: ['PackPrompt'], identity: ['label'], onUserEdit: 'offer' }),
      ],
      contentWriters: {
        PackPrompt: {
          remove(id) {
            removed.push(id);
            untypedWrite(id).set('deleted', true);
          },
        },
      },
    }, { id: manifest.id, name: manifest.name, version: manifest.version, manifest, dir,
      declarationRevision: snapshot.declarationRevision, buildRevision: revision, buildFiles: integrity.files });
  }

  const describedBy = (id: string) => untypedQuery.ids(id as EARS.EntityId).pickOne(['description'])?.description as string | undefined;

  let dir: string;
  beforeEach(() => {
    resetTestData();
    removed.length = 0;
    startTestRuntime({ entityTypes: ['PackPrompt'] });
    dir = contentPack('v1');
    registerContentPack();
    // The apply that writes both items and records what it wrote, which is what makes the rest an answer
    applyPacks([{ manifest: { id: CONTENT_PACK }, dir }]);
  });

  afterEach(() => {
    if (registry.getPackRegistration(CONTENT_PACK)) registry.unregisterPack(CONTENT_PACK);
  });

  const entityOf = (key: string, entity: 'Action' | 'PackPrompt') =>
    (untypedQuery(entity).where('contentKey', key).pickAll()[0] as { id: string } | undefined)?.id;

  /**
   * **One item restored leaves every other entry alone**, which is the whole of what makes this request
   * safe to put behind a button. A selection naming one entry says nothing about the others, and a run
   * that read it as "everything else too" would write the pack's version over every item the user had
   * edited under every other entry — on a click that asked for one.
   */
  it('writes the item the user asked for, and nothing of any other entry', () => {
    const prompt = entityOf(PROMPT_KEY, 'PackPrompt')!;
    untypedWrite(prompt as EARS.EntityId).set('description', 'mine');
    fs.rmSync(dir, { recursive: true, force: true });
    contentPack('v2');

    const system = runPacksSystem();
    try {
      system.send({ type: 'RESTORE_CONTENT_ITEM', packId: CONTENT_PACK, key: ACTION_KEY });

      expect(describedBy(entityOf(ACTION_KEY, 'Action')!), 'the item they asked for').toBe('theirs v2');
      expect(describedBy(prompt), 'and the one they did not, which they had edited').toBe('mine');
      expect(takeSystemErrors()).toEqual([]);
    } finally {
      system.stop();
    }
  });

  /**
   * **Deleting goes through the owner's own delete.** The entity types a pack writes are removed by whoever
   * declared them — a flow through its repository, which takes its nodes and wiring with it, and anything
   * with a `remove` writer the way that pack removes one. Destroying the entity here would orphan the first
   * and skip the second, which for a note is the user's undo.
   */
  it('removes a deleted item through its pack’s own writer', () => {
    const prompt = entityOf(PROMPT_KEY, 'PackPrompt')!;

    const system = runPacksSystem();
    try {
      system.send({ type: 'DELETE_CONTENT_ITEM', packId: CONTENT_PACK, key: PROMPT_KEY });

      expect(removed, 'the writer that owns the entity type').toEqual([prompt]);
      expect(appliedContent.get(CONTENT_PACK).items[PROMPT_KEY], 'and nothing is left for a later apply to describe').toBeUndefined();
    } finally {
      system.stop();
    }
  });

  /**
   * **An offer the restore could not answer stays open.** A run that wrote nothing for the item has changed
   * nothing about it, and clearing the offer anyway would mean the user is never asked again about a
   * version they never received.
   */
  it('keeps the offer when the restore wrote nothing for that item', () => {
    const offer = { kind: 'update' as const, parts: ['description'], contentHash: 'echo-v2' };
    appliedContent.record(CONTENT_PACK, { wrote: new Map(), offers: new Map([[ACTION_KEY, offer]]) });
    // The content no longer holds an item under that label, so the selection matches no record
    fs.writeFileSync(path.join(dir, PACK_LAYOUT.contentDir, 'actions.content.json'), JSON.stringify({ records: [] }));
    sealPack(dir);

    const system = runPacksSystem();
    try {
      system.send({ type: 'RESTORE_CONTENT_ITEM', packId: CONTENT_PACK, key: ACTION_KEY });

      expect(appliedContent.get(CONTENT_PACK).items[ACTION_KEY]?.offer, 'still outstanding').toEqual(offer);
    } finally {
      system.stop();
    }
  });

  /** "Keep mine" records the version they declined, and the list then offers to reset it instead */
  it('records the version the user declined, and lists the item as one they keep', () => {
    appliedContent.record(CONTENT_PACK, {
      wrote: new Map(),
      offers: new Map([[ACTION_KEY, { kind: 'update', parts: ['description'], contentHash: 'echo-v2' }]]),
    });

    const system = runPacksSystem();
    try {
      system.send({ type: 'DISMISS_CONTENT_OFFER', packId: CONTENT_PACK, key: ACTION_KEY });

      const item = appliedContent.get(CONTENT_PACK).items[ACTION_KEY];
      expect(item?.dismissed, 'the version they were shown').toBe('echo-v2');
      expect(item?.offer, 'and the decision is taken').toBeUndefined();

      system.send({ type: 'GET_INSTALLED_PACKS' });
      const lists = emitted(system.sent).filter((e) => e.type === 'PACKS_LIST');
      const listed = lists[lists.length - 1]?.packs as InstalledPackSummary[];
      const pack = listed.find(p => p.id === CONTENT_PACK);
      expect(pack?.contentOffers, 'nothing outstanding').toEqual([]);
      expect(pack?.contentKept.map(k => k.key), 'and an item to reset to factory').toEqual([ACTION_KEY]);
    } finally {
      system.stop();
    }
  });
});


it('refuses a conflicting destination before saving enablement or importing its runtime', async () => {
  const feature = { description: 'Open actions', surface: { label: 'Actions', state: 'missing.ts' } };
  const marker = path.join(tmpDir, 'conflicting-runtime-imported');
  for (const id of ['incumbent', PACK_ID]) {
    const source = packSource('1.0.0', { id, manifest: { features: { view: feature } },
      runtime: `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');` });
    const file = path.join(source, 'dist', PACK_LAYOUT.snapshot);
    const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
    snapshot.entityDestinations = { Action: 'view' };
    fs.writeFileSync(file, JSON.stringify(snapshot)); sealBuild(source);
    await installPackFromLocal(source);
  }
  setPackEnabled(PACK_ID, false);
  const system = runPacksSystem();
  try {
    registry.refreshCatalog(resolveAppEnvironment().packsDir);
    const before = registry.catalog.getSnapshot();
    takeSystemErrors();
    system.send({ type: 'TOGGLE_PACK_ENABLED', packId: PACK_ID });
    expect(readInstalledPacks().find(entry => entry.id === PACK_ID)?.enabled).toBe(false);
    expect(registry.catalog.getSnapshot()).toBe(before);
    expect(registry.getPackRegistration(PACK_ID)).toBeNull();
    expect(fs.existsSync(marker)).toBe(false);
    expect(takeSystemErrors().map(error => error.message).join(' ')).toMatch(/Action.*incumbent\/view.*reinstall-pack\/view/);
    expect(emitted(system.sent).find(event => event.type === 'PACK_ENABLED_CHANGED')).toMatchObject({ enabled: false });
  } finally { system.stop(); }
});


describe('catalog refresh refusal after a completed pack mutation', () => {
  it.each(['disable', 'uninstall'] as const)('reports a failed refresh once and still publishes the completed %s', async operation => {
    await installPackFromLocal(packSource('1.0.0'));
    expect(await activatePack(registry, PACK_ID, { send: () => {} } as never)).toBe(true);
    const system = runPacksSystem();
    const refresh = vi.spyOn(registry, 'refreshCatalog').mockImplementation(() => { throw new Error('Refresh refused'); });
    takeSystemErrors();
    try {
      system.send({ type: operation === 'disable' ? 'TOGGLE_PACK_ENABLED' : 'UNINSTALL_PACK', packId: PACK_ID });
      await vi.waitFor(() => expect(emitted(system.sent).map(event => event.type)).toContain('PACKS_LIST'));
      const events = emitted(system.sent);
      expect(events).toContainEqual(expect.objectContaining(operation === 'disable'
        ? { type: 'PACK_ENABLED_CHANGED', packId: PACK_ID, enabled: false }
        : { type: 'PACK_UNINSTALL_COMPLETE', packId: PACK_ID }));
      expect(events.map(event => event.type)).not.toContain('PACK_UNINSTALL_FAILED');
      expect(registry.getPackRegistration(PACK_ID)).toBeNull();
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(takeSystemErrors().map(error => error.message)).toEqual(['Refresh refused']);
      system.send({ type: 'GET_INSTALLED_PACKS' });
      expect(emitted(system.sent).filter(event => event.type === 'PACKS_LIST')).toHaveLength(2);
      expect(takeSystemErrors().map(error => error.message)).toEqual(['Refresh refused']);
    } finally { refresh.mockRestore(); system.stop(); }
  });
});


describe('the claim on a pack', () => {
  /** Whether a claim is free now, taking nothing */
  const probeClaim = (key: string) => {
    const free = registry.claimPackOperation(key);
    if (free) registry.releasePackOperation(key);
    return free;
  };
  const withSystem = {
    manifest: { features: { widget: { description: 'Widget.', system: { entry: 'src/system.ts' } } } },
    runtime: "module.exports.registration.features = { widget: { system: { machine: { id: 'widget', config: {} }, receives: [] } } };",
  };

  it.each(['disable', 'uninstall'] as const)('is held until the bus has torn the pack down after %s', async operation => {
    await installPackFromLocal(packSource('1.0.0', withSystem));
    expect(await activatePack(registry, PACK_ID, { send: () => {} } as never)).toBe(true);
    const system = runPacksSystem({ deferStops: true });
    try {
      system.send({ type: operation === 'disable' ? 'TOGGLE_PACK_ENABLED' : 'UNINSTALL_PACK', packId: PACK_ID });
      await vi.waitFor(() => expect(system.stops).toHaveLength(1));
      // Drain queued continuations while the bus completion remains explicitly held.
      await new Promise<void>(resolve => setImmediate(resolve));
      // The pack is still registered until the bus finishes, so another operation may not start on it yet
      expect(registry.getPackRegistration(PACK_ID)).not.toBeNull();
      expect(probeClaim(PACK_ID)).toBe(false);
      system.stops.splice(0).forEach(finish => finish());
      await vi.waitFor(() => expect(probeClaim(PACK_ID)).toBe(true));
      expect(registry.getPackRegistration(PACK_ID)).toBeNull();
    } finally { system.stop(); }
  });

  it("turns a pack back on when the toggle comes while the pack's disable is still tearing it down", async () => {
    await installPackFromLocal(packSource('1.0.0', withSystem));
    expect(await activatePack(registry, PACK_ID, { send: () => {} } as never)).toBe(true);
    const system = runPacksSystem({ deferStops: true });
    try {
      system.send({ type: 'TOGGLE_PACK_ENABLED', packId: PACK_ID });
      await vi.waitFor(() => expect(system.stops).toHaveLength(1));
      system.send({ type: 'TOGGLE_PACK_ENABLED', packId: PACK_ID });
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(emitted(system.sent).filter(e => e.type === 'PACK_ENABLED_CHANGED').map(e => e.enabled)).toEqual([false]);

      system.stops.splice(0).forEach(finish => finish());
      await vi.waitFor(() => expect(emitted(system.sent).filter(e => e.type === 'PACK_ENABLED_CHANGED').map(e => e.enabled))
        .toEqual([false, true]));
      expect(readInstalledPacks().find(record => record.id === PACK_ID)?.enabled).toBe(true);
      expect(registry.getPackRegistration(PACK_ID)).not.toBeNull();
    } finally { system.stop(); }
  });

  it('refused for another operation is reported, and the state that holds broadcast', async () => {
    await installPackFromLocal(packSource('1.0.0'));
    const system = runPacksSystem();
    takeSystemErrors();
    expect(registry.claimPackOperation(PACK_ID)).toBe(true);
    try {
      system.send({ type: 'TOGGLE_PACK_ENABLED', packId: PACK_ID });
      expect(takeSystemErrors().map(e => e.message).join('\n')).toContain('in progress');
      expect(emitted(system.sent).filter(e => e.type === 'PACK_ENABLED_CHANGED')).toEqual([
        { type: 'PACK_ENABLED_CHANGED', packId: PACK_ID, enabled: true },
      ]);
      expect(readInstalledPacks().find(record => record.id === PACK_ID)?.enabled ?? true).toBe(true);
    } finally { registry.releasePackOperation(PACK_ID); system.stop(); }
  });

  it.each(['uninstall', 'update'] as const)('refused for %s is reported to the Packs view', async operation => {
    await installPackFromLocal(packSource('1.0.0'));
    // An update needs a source to update from before it asks for the claim
    recordUserInstall(resolveAppEnvironment().installedPacksFile, PACK_ID, 'owner/repo');
    const system = runPacksSystem();
    expect(registry.claimPackOperation(PACK_ID)).toBe(true);
    try {
      system.send(operation === 'uninstall' ? { type: 'UNINSTALL_PACK', packId: PACK_ID } : { type: 'UPDATE_PACK', packId: PACK_ID });
      await vi.waitFor(() => expect(emitted(system.sent)).toContainEqual({
        type: operation === 'uninstall' ? 'PACK_UNINSTALL_FAILED' : 'PACK_UPDATE_FAILED',
        packId: PACK_ID, error: expect.stringContaining('in progress'),
      }));
    } finally { registry.releasePackOperation(PACK_ID); system.stop(); }
  });
});
