import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { _declarationRevision, PACK_SNAPSHOT_FORMAT, type PackManifest } from '@apackdev/sdk/build';
import { PACK_LAYOUT, sealPackBuild } from '@apackdev/host/packs';
import { createEarsEngine } from '@apackdev/ears';
import { bindSettingsRequest } from '@apackdev/host/settings';
import type { Message } from '@apackdev/sdk/events';
import { rootEvents } from '../../src/transport/emitter.ts';
import { unbindHost } from '@apackdev/sdk/runtime/internals';
import { _settingsAdmin } from '@apackdev/sdk/services';
import type { EARS } from '@apackdev/sdk';

const fixture = vi.hoisted(() => ({ data: { app: { projects: 'invalid' }, features: { 'memo/notes': { limit: 'invalid' } } } as unknown }));
vi.mock('@apackdev/host/database', async importOriginal => ({
  ...await importOriginal<typeof import('@apackdev/host/database')>(),
  openDatabaseStore: ({ schema }: import('@apackdev/host/database').DatabaseStoreOptions) => {
    const engine = createEarsEngine({ isRelationKind: () => true, isRole: () => true, isEntityType: name => schema.getRegisteredEntityTypes().has(name) });
    // The store as the app reads it: an engine over the database, holding the settings row
    engine.admin.bulkLoad(() => {
      engine.admin.bulkLoadAttr('Settings-app' as EARS.EntityId, 'entityType' as EARS.AttrKind, 'Settings');
      engine.admin.bulkLoadAttr('Settings-app' as EARS.EntityId, 'data' as EARS.AttrKind, fixture.data);
    });
    return { engine, store: { requestSync: () => {}, close: () => {} } };
  },
}));
vi.mock('@apackdev/host/packs/runtime', async importOriginal => ({
  ...await importOriginal<typeof import('@apackdev/host/packs/runtime')>(),
  loadAppPacks: vi.fn(() => ({ loaded: [] })),
  startPacks: vi.fn(),
}));
const { loadAppPacks, startPacks } = await import('@apackdev/host/packs/runtime');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-settings-recovery-'));
vi.stubEnv('APACK_ENV', 'test');
vi.stubEnv('APACK_USER_DATA_DIR', dataDir);
vi.stubEnv('SHIPPED_PACKS_DIR', '');
// A complete data-only installed declaration. Executing its runtime is a fixture failure.
const packDir = path.join(resolveAppEnvironment({ env: 'test', userDataDir: dataDir }).packsDir, 'memo');
fs.mkdirSync(path.join(packDir, 'types'), { recursive: true });
fs.mkdirSync(path.join(packDir, 'runtime'), { recursive: true });
const manifest: PackManifest = { id: 'memo', name: 'Memo', version: '1.0.0', features: {
  notes: { description: 'Notes', settings: { defaults: { limit: 10 }, schema: { type: 'object', properties: { limit: { type: 'integer' } }, required: ['limit'] } } },
} };
fs.writeFileSync(path.join(packDir, PACK_LAYOUT.manifest), JSON.stringify(manifest));
fs.writeFileSync(path.join(packDir, PACK_LAYOUT.snapshot), JSON.stringify({ format: PACK_SNAPSHOT_FORMAT,
  manifest, declarationRevision: _declarationRevision(manifest), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {},
}));
fs.writeFileSync(path.join(packDir, PACK_LAYOUT.runtimeEntry), 'throw new Error("must not activate during recovery");');
sealPackBuild(packDir, manifest);
const backend = await import('../../src/runtime/index.ts');
afterAll(() => { backend.backendActor?.stop(); unbindHost(); fs.rmSync(dataDir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

it('boots host recovery before loading external modules, repairs, and starts normally only on a new boot', async () => {
  await backend.setupBackend();
  expect(loadAppPacks).not.toHaveBeenCalled();
  expect(startPacks).not.toHaveBeenCalled();
  expect(backend.appPacks.getRegisteredSystems().get('host/settings')).toBeDefined();
  expect(backend.appPacks.getRegisteredSystems().get('host/packs')).toBeUndefined();
  const settings = _settingsAdmin();
  const recovery = settings.getRecovery()!;
  expect(recovery.problems).toContainEqual({ target: { kind: 'app' }, path: ['projects'], message: 'must be array' });
  expect(recovery.problems).toContainEqual({ target: { kind: 'feature', featureRef: 'memo/notes' }, path: ['limit'], message: 'must be integer' });
  expect(() => settings.getSnapshot()).toThrow('recovery');
  const outgoing: Message[] = [];
  const stop = rootEvents.onOutgoing(message => { outgoing.push(message); });
  rootEvents.emitConnected();
  // A write other than the recovery reset is refused and answered, and the system stays up to take the repair
  const stored = settings.getOverrides();
  for (const [call, write] of [
    ['set', { type: 'UPDATE_SETTINGS' as const, target: { kind: 'app' as const }, path: ['projects'], value: [] }],
    ['reset-all', { type: 'RESET_ALL_SETTINGS' as const }],
  ] as const) {
    bindSettingsRequest(write, () => backend.appSettingsAccess.resolve('recovery-window', backend.appSettingsAccess.issueHost('recovery-window')));
    rootEvents.emitIncoming({ to: 'host/settings', sender: 'host/settings', from: 'host', client: 'recovery-window', call, event: write });
    await Promise.resolve();
    expect(outgoing).toContainEqual(expect.objectContaining({ answering: call, event: expect.objectContaining({ type: 'SETTINGS_REFUSED' }) }));
  }
  expect(settings.getOverrides()).toEqual(stored);
  const event = { type: 'RECOVER_SETTINGS' as const, request: { version: recovery.version, reset: [{ kind: 'app' as const }, { kind: 'feature' as const, featureRef: 'memo/notes' as const }] } };
  const credential = backend.appSettingsAccess.issueHost('recovery-window');
  bindSettingsRequest(event, () => backend.appSettingsAccess.resolve('recovery-window', credential));
  rootEvents.emitIncoming({ to: 'host/settings', sender: 'host/settings', from: 'host', client: 'recovery-window', call: 'repair', event });
  await Promise.resolve();
  expect(outgoing).toContainEqual(expect.objectContaining({ answering: 'repair', event: expect.objectContaining({ type: 'SETTINGS_RECOVERY', recovery: expect.objectContaining({ problems: [] }) }) }));
  // A new window gets the retained restart requirement rather than an apparently ready host-only app.
  rootEvents.emitIncoming({ to: 'host/settings', sender: 'host/settings', from: 'host', client: 'recovery-window', call: 'new-window', event: { type: 'GET_SETTINGS' } });
  await Promise.resolve();
  expect(outgoing).toContainEqual(expect.objectContaining({ answering: 'new-window', event: expect.objectContaining({ type: 'SETTINGS_RECOVERY', recovery: expect.objectContaining({ problems: [] }) }) }));
  stop();
  expect(settings.getRecovery()).toMatchObject({ problems: [] });
  expect(() => backend.appPacks.catalog.assertPackSettings({ id: 'candidate', name: 'Candidate', version: '1.0.0' })).toThrow('Restart the app');
  expect(loadAppPacks).not.toHaveBeenCalled();
  expect(startPacks).not.toHaveBeenCalled();
  fixture.data = settings.getOverrides();
  backend.backendActor.stop();
  unbindHost();
  await backend.setupBackend();
  expect(loadAppPacks).toHaveBeenCalledTimes(1);
  expect(startPacks).toHaveBeenCalledTimes(1);
  expect(_settingsAdmin().getRecovery()).toBeUndefined();
});
