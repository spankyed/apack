// The pack-facing replacements for @apackdev/host in pack code: relation reads in @apackdev/ears,
// and the host-implemented services.appData, as the API's host init registers it.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

/** The app version the migrations read, when a test sets one; the bound app's otherwise */
const version = vi.hoisted(() => ({ current: undefined as string | undefined }));
vi.mock('@apackdev/sdk/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apackdev/sdk/env')>();
  return { ...actual, getAppVersion: () => version.current ?? actual.getAppVersion() };
});

// The app's store, opened as the API opens it, in a throwaway data dir
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-host-data-services-'));
process.env.APACK_ENV = 'test';
process.env.APACK_USER_DATA_DIR = dataDir;
const { openAppStore } = await import('../../src/runtime/index.ts');
const { database: store, runHistory, engine, packs } = openAppStore();
const { untypedQuery, untypedCreate, untypedUpsert, untypedWrite } = await import('@apackdev/sdk/ears');
const { boundHost } = await import('@apackdev/sdk/runtime/internals');
const { services } = boundHost();
const settingsAdmin = () => boundHost().services.settings;

afterAll(() => {
  store.close();
  runHistory.database.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('services.appData', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports a backup directory, and null for anything else', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-data-backup-'));
    dirs.push(dir);
    expect(await services.appData.readBackupSummary(dir)).toBeNull();

    version.current = '0.4.1';
    try {
      const backup = await services.appData.exportBackup(dir, 'probe', ['lmdb']);
      expect(backup).toBe(path.join(dir, 'probe'));
      // What made it, so a backup folder says where it came from without opening its databases
      expect(await services.appData.readBackupSummary(backup)).toEqual({
        timestamp: expect.any(Number), databases: ['lmdb'], size: expect.any(Number), hasMedia: false, appVersion: '0.4.1',
      });
      const metadata = JSON.parse(fs.readFileSync(path.join(backup, 'metadata.json'), 'utf-8'));
      expect(metadata).toMatchObject({ appVersion: '0.4.1', storageFormats: { lmdb: 'elmdb/2' } });
    } finally {
      version.current = undefined;
    }
  });

  it("refuses a backup holding a store this app doesn't have, then imports it without that store when told to", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-data-unknown-db-backup-'));
    dirs.push(dir);
    const backup = await services.appData.exportBackup(dir, 'unknown', ['lmdb']);
    const metadataPath = path.join(backup, 'metadata.json');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    fs.writeFileSync(metadataPath, JSON.stringify({ ...metadata, databases: ['lmdb', 'unknownLmdb'] }));
    fs.mkdirSync(path.join(backup, 'unknownLmdb'));
    untypedCreate('Prompt', { id: 'Prompt-kept', label: 'still here', inputs: {}, templateFn: 'return ""' });

    // A partial restore of a backup a newer apack made would cost the user their data to learn that
    const refused = services.appData.importBackup(backup);
    await expect(refused).rejects.toThrow("The backup holds data this apack doesn't have: unknownLmdb");
    await expect(refused).rejects.toMatchObject({ name: 'UnknownBackupDatabasesError', databases: ['unknownLmdb'] });
    expect(untypedQuery.ids('Prompt-kept').pickOne(['label'])).toMatchObject({ label: 'still here' });

    // The app asks the user first, and imports it without that store when they say to
    expect(await services.appData.importBackup(backup, { skipUnknownDatabases: true }))
      .toEqual({ databases: ['lmdb'], missingDatabases: [], unknownEntityTypes: [] });
    expect(untypedQuery.ids('Prompt-kept').pickOne(['label'])).toBeUndefined();
  });

  it('restores current preferences, onboarding completion and unavailable feature overrides', async () => {
    const { appState } = await import('@apackdev/host/app-state');
    version.current = '0.4.0';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-data-current-backup-'));
    dirs.push(dir);
    engine.admin.clear();
    const settings = {
      app: { personal: { name: 'Ada', phoneNumber: '123' }, projects: [
        { name: 'Restored', directories: ['/second', '/first'], color: 'blue' },
      ] },
      features: { 'removed/feature': { retained: true } },
    };
    appState.update({ hasOnboarded: true, version: '0.4.0' });
    untypedUpsert('Settings', { id: 'Settings-app', data: settings });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const backup = await services.appData.exportBackup(dir, 'current', ['lmdb']);

    try {
      appState.update({ hasOnboarded: false });
      settingsAdmin().resetAll();
      await services.appData.importBackup(backup);
      expect(services.onboarding.isComplete()).toBe(true);
      expect(appState.get().version).toBe('0.4.0');
      expect(settingsAdmin().getOverrides()).toEqual(settings);
      settingsAdmin().set({ kind: 'app' }, ['personal', 'name'], 'Edited after restore');
      expect(settingsAdmin().get<{ personal: { name: string } }>({ kind: 'app' }).personal.name).toBe('Edited after restore');
      expect(settingsAdmin().getOverrides().features).toEqual(settings.features);
      await services.appData.importBackup(backup);
      expect(settingsAdmin().getOverrides()).toEqual(settings);
      expect(services.onboarding.isComplete()).toBe(true);
    } finally {
      version.current = undefined;
    }
  });

  it('reports rows of a type no installed pack declares, and keeps them', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-data-gone-pack-backup-'));
    dirs.push(dir);
    // Backed up while the pack that declares Bookmark was installed
    packs.catalog.setNative([...packs.catalog.getSnapshot().native, { id: 'bookmarks', data: { entities: { Bookmark: {}, Tag: {} } } }, { id: 'tags', data: { entities: { Tag: {} } } }]);
    packs.registerPack({
      id: 'bookmarks',
      ears: { entities: { Bookmark: 'Bookmark', Tag: 'Tag' }, relKinds: {}, roles: {} },
    });
    const bookmark = untypedCreate('Bookmark').set('url', 'https://example.com').id();
    untypedCreate('Tag').set('name', 'reading');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const backup = await services.appData.exportBackup(dir, 'with-pack', ['lmdb']);
    packs.unregisterPack('bookmarks');
    // Still installed, so its rows are not reported: only what nothing declares is
    packs.registerPack({ id: 'tags', ears: { entities: { Tag: 'Tag' }, relKinds: {}, roles: {} } });

    try {
      // Restored without the other pack: the rows come back, and the app is told so it can say why nothing shows them
      const result = await services.appData.importBackup(backup);
      expect(result.unknownEntityTypes).toContainEqual(['Bookmark', 1]);
      expect(result.unknownEntityTypes.map(([type]) => type)).not.toContain('Tag');
      // The row is there, found by id: with no pack declaring the type, a query by type is refused
      expect(untypedQuery.ids(bookmark).pickOne(['url'])).toMatchObject({ url: 'https://example.com' });
    } finally {
      packs.unregisterPack('tags');
    }
  });

  it.each([
    { app: { projects: 'invalid' } },
    { general: { personal: { name: 'obsolete address' } } },
    null,
  ])('refuses invalid backup settings before clearing live memory or entering replacement', async data => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-data-invalid-settings-'));
    dirs.push(dir);
    const settingsId = 'Settings-app';
    untypedUpsert('Settings', { id: settingsId, data });
    await new Promise(resolve => setTimeout(resolve, 0));
    const backup = await services.appData.exportBackup(dir, 'invalid', ['lmdb']);
    // The fixture wrote an invalid row directly to create the candidate; seed valid live data independently.
    untypedWrite(settingsId).set('data', {});
    settingsAdmin().set({ kind: 'app' }, ['personal', 'name'], 'Keep live');
    const before = settingsAdmin().getSnapshot();
    const heard: string[] = [];
    const off = settingsAdmin().onChange(change => heard.push(change));
    try {
      await expect(services.appData.importBackup(backup)).rejects.toThrow();
      expect(settingsAdmin().getSnapshot()).toEqual(before);
      expect(heard).toEqual([]);
    } finally { off(); }
  });

  it('restores a backup whose listed store it holds nothing for, and says which', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-data-empty-db-backup-'));
    dirs.push(dir);
    const backup = await services.appData.exportBackup(dir, 'sparse', ['lmdb', 'runHistory']);
    fs.rmSync(path.join(backup, 'runHistory'), { recursive: true, force: true });

    // Reported, so the app can tell the user that store came back empty rather than dropping it silently
    expect(await services.appData.importBackup(backup)).toMatchObject({ databases: ['lmdb'], missingDatabases: ['runHistory'] });
  });

  it('brings back the run history a backup holds, with what was running then stopped', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-data-history-backup-'));
    dirs.push(dir);
    const { id } = services.runHistory.start({ kind: 'flow', label: 'Running at the backup' });
    const backup = await services.appData.exportBackup(dir, 'history', ['lmdb', 'runHistory']);
    services.runHistory.update(id, { label: 'Changed since' });

    await services.appData.importBackup(backup);

    expect(services.runHistory.get(id)).toMatchObject({ label: 'Running at the backup', status: 'stopped' });
  });

  it('rejects an import of a directory that is not a backup', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-data-not-backup-'));
    dirs.push(dir);
    await expect(services.appData.importBackup(dir)).rejects.toThrow(`${dir} isn't a backup: it has no metadata.json`);
  });
});

describe('a reset', () => {
  it('empties the run history with the database', async () => {
    const { id } = services.runHistory.start({ kind: 'flow', label: 'Before the reset' });

    await services.appData.reset();

    expect(services.runHistory.get(id)).toBeUndefined();
  });
});
