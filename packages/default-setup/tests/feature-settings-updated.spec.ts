// Every feature, any pack's, hears when its settings change: its system (with what changed in its lists) and its
// surface get FEATURE_SETTINGS_UPDATED, which the SDK declares for every system and surface, whatever changed the
// settings. A feature with no system, or no surface, just doesn't get that half.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assign, setup } from 'xstate';
import { getTestSettings, mockService, registerPack, startApp, takeSystemErrors, unregisterPack } from '@apackdev/testing/harness';
import { untypedCreate, untypedUpsert } from '@apackdev/sdk/ears';
import type { EARS } from '@apackdev/sdk';


/** A system that keeps each FEATURE_SETTINGS_UPDATED it gets */
const recorder = setup({ types: { context: {} as { heard: unknown[] } } }).createMachine({
  context: { heard: [] },
  on: { FEATURE_SETTINGS_UPDATED: { actions: assign({ heard: ({ context, event }) => [...context.heard, event] }) } },
});

beforeEach(() => {
  registerPack({
    id: 'memo-pack',
    features: {
      memos: { system: { machine: recorder, receives: [] }, surface: { receives: [] }, settings: { defaults: { tags: [{ name: 'a' }] }, schema: { type: 'object' } } },
      // Settings but no system: only its surface hears
      board: { surface: { receives: [] }, settings: { defaults: { columns: 2 }, schema: { type: 'object' } } },
    },
  });
});
afterEach(() => {
  try { unregisterPack('memo-pack'); } catch { /* the test unregistered it */ }
  vi.restoreAllMocks();
});

const heardBy = (app: Awaited<ReturnType<typeof startApp>>) => (app.system('memo-pack/memos').getSnapshot().context as { heard: any[] }).heard;

describe('a feature whose settings change', () => {
  it('tells its system, with what changed in its lists, and its surface', async () => {
    const app = await startApp({ systems: ['memo-pack/memos', 'host/settings'] });
    await app.connect();

    await app.send('host/settings', { type: 'UPDATE_SETTINGS', target: { kind: 'feature', featureRef: 'memo-pack/memos' }, path: ['tags'], value: [{ name: 'b' }] }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });

    expect(heardBy(app)).toEqual([{
      type: 'FEATURE_SETTINGS_UPDATED',
      settings: { tags: [{ name: 'b' }] },
      changes: { tags: expect.objectContaining({ added: [{ name: 'b' }], removed: [{ name: 'a' }] }) },
    }]);
    expect(app.emitted('memo-pack/memos')).toContainEqual({ type: 'FEATURE_SETTINGS_UPDATED', settings: { tags: [{ name: 'b' }] } });
  });

  it('tells only the features whose settings differ, when the settings are replaced or reset', async () => {
    const warned = vi.spyOn(console, 'warn');
    const app = await startApp({ systems: ['memo-pack/memos', 'host/settings'] });
    await app.connect();

    const replacement = getTestSettings().getAll();
    replacement.features['memo-pack/board'] = { columns: 3 };
    await app.send('host/settings', { type: 'REPLACE_SETTINGS', data: replacement }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });
    expect(heardBy(app)).toEqual([]);
    expect(app.emitted('memo-pack/board')).toContainEqual({ type: 'FEATURE_SETTINGS_UPDATED', settings: { columns: 3 } });

    await app.send('host/settings', { type: 'RESET_ALL_SETTINGS' }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });
    expect(app.emitted('memo-pack/board')).toContainEqual({ type: 'FEATURE_SETTINGS_UPDATED', settings: { columns: 2 } });
    expect(heardBy(app)).toEqual([]);
    // The board runs no system: its half of the event is nobody's, and nothing warns of a missing system
    expect(warned.mock.calls.flat().join(' ')).not.toContain('not found');
  });

  // A system's own write (the code system's browsed directory, the brain's inspect toggle), an action's or an apply's goes
  // straight to the repository. It reaches the feature once, and a later unrelated change doesn't send it again: told
  // late, a stale difference had the code explorer jump back to its default directory.
  it('tells the feature once when its settings are written outside the settings system, and not again later', async () => {
    const app = await startApp({ systems: ['memo-pack/memos', 'host/settings'] });
    await app.connect();

    getTestSettings().forPack('memo-pack').set({ kind: 'feature', featureRef: 'memo-pack/memos' }, ['tags'], [{ name: 'c' }]);
    await app.settle();
    expect(heardBy(app).map((e) => e.settings)).toEqual([{ tags: [{ name: 'c' }] }]);

    await app.send('host/settings', { type: 'UPDATE_SETTINGS', target: { kind: 'feature', featureRef: 'memo-pack/board' }, path: ['columns'], value: 4 }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });
    expect(heardBy(app)).toHaveLength(1);
  });

  it("tells the feature when an action writes its settings through services.settings", async () => {
    const app = await startApp({ systems: ['memo-pack/memos', 'host/settings'] });
    await app.connect();

    getTestSettings().forPack('memo-pack').set({ kind: 'feature', featureRef: 'memo-pack/memos' }, ['tags'], [{ name: 'd' }]);
    await app.settle();

    expect(heardBy(app).map((e) => e.settings)).toEqual([{ tags: [{ name: 'd' }] }]);
  });

  // A reset rewrites the settings with the rest of the data. Each feature is told its settings with no changes once it
  // ends, however it ends, and a later change isn't told as a difference across the reset.
  describe('an app reset', () => {
    /** A reset that writes the settings as the real one does, then succeeds or throws */
    const resetWriting = (tags: unknown[], outcome: 'succeeds' | 'fails') => mockService('appData', {
      reset: () => getTestSettings().whileReplacingData(async () => {
        getTestSettings().set({ kind: 'feature', featureRef: 'memo-pack/memos' }, ['tags'], tags);
        if (outcome === 'fails') throw new Error('store could not reopen');
      }),
    });

    it.each(['succeeds', 'fails'] as const)('tells each feature its settings with no changes once it %s', async (outcome) => {
      resetWriting([{ name: 'fresh' }], outcome);
      const app = await startApp({ systems: ['memo-pack/memos', 'host/settings'] });
      await app.connect();

      await app.send('host/settings', { type: 'RESET_APP' }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });
      await app.settle();

      expect(heardBy(app)).toEqual([{ type: 'FEATURE_SETTINGS_UPDATED', settings: { tags: [{ name: 'fresh' }] }, changes: null }]);
      await app.send('host/settings', { type: 'UPDATE_SETTINGS', target: { kind: 'feature', featureRef: 'memo-pack/board' }, path: ['columns'], value: 5 }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });
      expect(heardBy(app)).toHaveLength(1);
      if (outcome === 'fails') takeSystemErrors();
    });
  });

  // An import replaces the stored rows past the settings' writer, so nothing else tells the features
  it('tells each feature its settings with no changes after a backup import, and not a diff across it later', async () => {
    mockService('appData', {
      importBackup: () => getTestSettings().whileReplacingData(async () => {
        untypedUpsert('Settings', { id: 'Settings-app' as EARS.EntityId, data: { features: { 'memo-pack/memos': { tags: [{ name: 'imported' }] } } } })
        return { databases: ['lmdb'], missingDatabases: [], unknownEntityTypes: [] }
      }),
    });
    const app = await startApp({ systems: ['database', 'memo-pack/memos', 'host/settings'] });
    await app.connect();

    expect(await app.ask('database', { type: 'IMPORT_DATABASE', path: '/backups/1' }, { client: 'c-window' })).toMatchObject({ ok: true });
    await app.settle();

    expect(heardBy(app)).toEqual([{ type: 'FEATURE_SETTINGS_UPDATED', settings: { tags: [{ name: 'imported' }] }, changes: null }]);
    await app.send('host/settings', { type: 'UPDATE_SETTINGS', target: { kind: 'feature', featureRef: 'memo-pack/board' }, path: ['columns'], value: 6 }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });
    expect(heardBy(app)).toHaveLength(1);
  });

  // The import's migrations write the settings through the repository before the imported data is announced: a diff
  // against what features heard before the import would have them rewrite rows that came in with it
  describe('a backup import whose migrations write the settings', () => {
    const importWriting = (outcome: 'succeeds' | 'fails') => mockService('appData', {
      importBackup: () => getTestSettings().whileReplacingData(async () => {
        // Before the import's first await, and after it: the writes tell nothing whenever they happen
        getTestSettings().set({ kind: 'feature', featureRef: 'memo-pack/memos' }, ['tags'], [{ name: 'early' }]);
        await Promise.resolve();
        untypedUpsert('Settings', { id: 'Settings-app' as EARS.EntityId, data: { features: { 'memo-pack/memos': { tags: [{ name: 'imported' }] } } } });
        getTestSettings().set({ kind: 'feature', featureRef: 'memo-pack/memos' }, ['tags'], [{ name: 'migrated' }]);
        if (outcome === 'fails') throw new Error('backup unreadable');
        return { databases: ['lmdb'], missingDatabases: [], unknownEntityTypes: [] };
      }),
    });

    it.each(['succeeds', 'fails'] as const)('tells each feature no changes when it %s', async (outcome) => {
      importWriting(outcome);
      const app = await startApp({ systems: ['database', 'memo-pack/memos', 'host/settings'] });
      await app.connect();

      const imported = await app.ask('database', { type: 'IMPORT_DATABASE', path: '/backups/1' }, { client: 'c-window' });
      expect(imported.ok).toBe(outcome === 'succeeds');
      await app.settle();

      expect(heardBy(app)).toEqual([{ type: 'FEATURE_SETTINGS_UPDATED', settings: { tags: [{ name: 'migrated' }] }, changes: null }]);
      await app.send('host/settings', { type: 'UPDATE_SETTINGS', target: { kind: 'feature', featureRef: 'memo-pack/board' }, path: ['columns'], value: 7 }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });
      expect(heardBy(app)).toHaveLength(1);
    });
  });

  // A settings form says "Saved" on the store's answer, so every change it sends gets one
  it('answers a change with what the store did: stored, or refused with its reasons', async () => {
    const app = await startApp({ systems: ['memo-pack/memos', 'host/settings'] });
    await app.connect();

    await app.send('host/settings', { type: 'UPDATE_SETTINGS', target: { kind: 'feature', featureRef: 'memo-pack/memos' }, path: ['tags'], value: [] }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });
    expect(app.emitted('host/settings')).toContainEqual(expect.objectContaining({ type: 'ASK_ANSWERED', answer: { snapshot: expect.any(Object) } }));

    await app.send('host/settings', { type: 'UPDATE_SETTINGS', target: { kind: 'feature', featureRef: 'memos' }, path: ['tags'], value: [] }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });
    expect(app.emitted('host/settings')).toContainEqual(expect.objectContaining({ type: 'ASK_FAILED', failure: expect.objectContaining({ kind: 'refused', problems: [expect.stringContaining('settings target')] }) }));
  });

  // The import replaces the same stores a reset does, and a pack's defaults coming or going while it runs would be
  // diffed against what features were told before it
  describe('while a backup import runs', () => {
    let endImport: (() => Promise<void>) | undefined;
    afterEach(async () => {
      try { await endImport?.(); }
      finally { endImport = undefined; }
    });

    /** Starts an import that settles when `finish` is called, and waits until the settings system has heard it start */
    async function importing(app: Awaited<ReturnType<typeof startApp>>) {
      let finish!: () => void;
      const done = new Promise<void>((resolve) => { finish = resolve; });
      endImport = async () => { finish(); await app.settle(); };
      mockService('appData', { importBackup: () => getTestSettings().whileReplacingData(async () => { await done; return { databases: ['lmdb'], missingDatabases: [], unknownEntityTypes: [] }; }) });
      // Asked as a window asks, and not waited for: the import holds until `finish`
      await app.send('database', { type: 'IMPORT_DATABASE', path: '/backups/1' }, { sender: 'default-setup/database', client: 'c-window' });
      return { finish };
    }

    it('refuses an app reset, which would race it over the same stores', async () => {
      const app = await startApp({ systems: ['database', 'memo-pack/memos', 'host/settings'] });
      await app.connect();
      const { finish } = await importing(app);

      await app.send('host/settings', { type: 'RESET_APP' }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });

      expect(app.emitted('host/settings')).toContainEqual({ type: 'APP_RESET_FAILED', error: 'App data is being replaced. Reset the app once it has finished.' });
      finish();
      await app.settle();
    });

    it("tells no feature a pack's settings changed until it ends", async () => {
      const app = await startApp({ systems: ['database', 'memo-pack/memos', 'host/settings'] });
      await app.connect();
      getTestSettings().forPack('memo-pack').set({ kind: 'feature', featureRef: 'memo-pack/memos' }, ['tags'], [{ name: 'before' }]);
      await app.settle();
      const heardBefore = heardBy(app).length;
      const { finish } = await importing(app);

      untypedUpsert('Settings', { id: 'Settings-app' as EARS.EntityId, data: { features: { 'memo-pack/memos': { tags: [{ name: 'imported' }] } } } });
      await app.send('host/settings', { type: 'PACK_CHANGED', packId: 'memo-pack' }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });
      expect(heardBy(app)).toHaveLength(heardBefore);

      finish();
      await app.settle();
      expect(heardBy(app).slice(heardBefore)).toEqual([{ type: 'FEATURE_SETTINGS_UPDATED', settings: { tags: [{ name: 'imported' }] }, changes: null }]);
    });

    // A settings form waits for the store's answer before it says "Saved", so a change taken and never answered
    // leaves it saying "Saving" for good
    it('refuses a change sent while it runs, rather than leaving the form waiting for an answer', async () => {
      const app = await startApp({ systems: ['database', 'memo-pack/memos', 'host/settings'] });
      await app.connect();
      const { finish } = await importing(app);

      await app.send('host/settings', { type: 'UPDATE_SETTINGS', target: { kind: 'feature', featureRef: 'memo-pack/memos' }, path: ['tags'], value: [] }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });

      expect(app.emitted('host/settings')).toContainEqual(expect.objectContaining({ type: 'ASK_FAILED', failure: expect.objectContaining({ kind: 'refused', problems: ['App data is being replaced. Change the settings once it has finished.'] }) }));
      finish();
      await app.settle();
    });

    // A read only reports what is stored, and the settings page waits for one before it renders
    it('serves a read, so opening the settings page while it runs still loads', async () => {
      const app = await startApp({ systems: ['database', 'memo-pack/memos', 'host/settings'] });
      await app.connect();
      const { finish } = await importing(app);
      const before = app.emitted('host/settings').length;

      await app.send('host/settings', { type: 'GET_SETTINGS' }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });

      expect(app.emitted('host/settings').slice(before)).toContainEqual(
        expect.objectContaining({ type: 'ASK_ANSWERED', asked: 'GET_SETTINGS', answer: { snapshot: expect.any(Object) } }),
      );
      finish();
      await app.settle();
    });
  });

  // A bare key would be stored where nothing reads it, for good. A refusal is the user's to fix, not the system's
  // error: the settings surface hears it with the reasons
  it('refuses replaced settings holding an unqualified feature key', async () => {
    const app = await startApp({ systems: ['memo-pack/memos', 'host/settings'] });
    await app.connect();

    const replacement = getTestSettings().getAll();
    replacement.features.memos = { tags: [] };
    await app.send('host/settings', { type: 'REPLACE_SETTINGS', data: replacement }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });

    expect(app.emitted('host/settings')).toContainEqual(expect.objectContaining({ type: 'ASK_FAILED', failure: expect.objectContaining({ kind: 'refused', problems: [expect.stringContaining(`"memos" isn't a ref`)] }) }));
    expect(app.emitted('host/settings').map((e) => e.type)).not.toContain('ASK_ANSWERED');
    expect(getTestSettings().getOverrides()).toEqual({});
    expect(heardBy(app)).toEqual([]);
  });

  it.each([
    ['null', null, 'The settings must be a JSON object'],
    ['an array', [], 'The settings must be a JSON object'],
    ['an owner map that is not an object', { features: null }, '"features" must be an object'],
    ['an unknown settings owner', { extra: {} }, `"extra" isn't a settings owner`],
  ])('refuses replaced settings that are %s, storing nothing', async (_, data, problem) => {
    const app = await startApp({ systems: ['memo-pack/memos', 'host/settings'] });
    await app.connect();

    await app.send('host/settings', { type: 'REPLACE_SETTINGS', data }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });

    expect(app.emitted('host/settings')).toContainEqual(expect.objectContaining({ type: 'ASK_FAILED', failure: expect.objectContaining({ kind: 'refused', problems: expect.arrayContaining([expect.stringContaining(problem)]) }) }));
    expect(getTestSettings().getOverrides()).toEqual({});
  });

  // Whole-document edits store the explicit supplied choices; reset is how the user returns to defaults.
  it('stores explicit replaced settings, including default-equal values, and says it saved them', async () => {
    const app = await startApp({ systems: ['memo-pack/memos', 'host/settings'] });
    await app.connect();
    const inEffect = getTestSettings().getAll();

    const replacement = { ...inEffect, features: { ...inEffect.features, 'memo-pack/board': { columns: 5 } } };
    await app.send('host/settings', { type: 'REPLACE_SETTINGS', data: replacement }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });

    expect(getTestSettings().getOverrides()).toEqual(replacement);
    expect(app.emitted('host/settings')).toContainEqual(expect.objectContaining({ type: 'ASK_ANSWERED', answer: { snapshot: expect.any(Object) } }));
  });

  // Its defaults leave with the pack, so the settings of its features change; their system and surface are gone,
  // which is no mistake to report (the harness fails a test that leaves a reported drop)
  it('tells nobody, and reports nothing, when its pack leaves', async () => {
    const app = await startApp({ systems: ['host/settings'] });
    await app.connect();

    unregisterPack('memo-pack');
    await app.settle();

    expect(app.emitted('host/settings').map((e) => e.type)).toContain('SETTINGS_UPDATED');
  });

  // A pack installed but not running (disabled) keeps its settings, which can change (the host's registry lists its
  // features from its manifest, host/tests/packs); one no installed pack has is refused, and one of an uninstalled
  // pack stays as it was, for its reinstall
  it('refuses changed settings of a feature no installed pack has, and keeps an uninstalled pack\'s unchanged', async () => {
    untypedCreate('Settings', { id: 'Settings-app' as EARS.EntityId }).set('data', { features: { 'gone-pack/journal': { font: 'serif' } } });
    const app = await startApp({ systems: ['host/settings'] });
    await app.connect();

    const invalid = getTestSettings().getAll();
    invalid.features['memo-pack/memo'] = { tags: [] };
    await app.send('host/settings', { type: 'REPLACE_SETTINGS', data: invalid }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });
    expect(app.emitted('host/settings')).toContainEqual(expect.objectContaining({ type: 'ASK_FAILED', failure: expect.objectContaining({ kind: 'refused', problems: [expect.stringContaining('memo-pack/memo')] }) }));

    const replacement = getTestSettings().getAll();
    replacement.features['memo-pack/board'] = { columns: 9 };
    await app.send('host/settings', { type: 'REPLACE_SETTINGS', data: replacement }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });
    expect(getTestSettings().getOverrides()).toEqual(replacement);
    expect(getTestSettings().getOverrides().features?.['gone-pack/journal']).toEqual({ font: 'serif' });
  });
});

// A key such as `__proto__` in a path or in replaced settings is data: it's stored as an own key and reaches no
// prototype, in the API process or in the settings merged from the defaults
describe('settings naming prototype machinery', () => {
  afterEach(() => { delete (Object.prototype as Record<string, unknown>).polluted; });

  it.each([
    ['a path segment', { target: { kind: 'pack', packId: 'default-setup', groupId: 'assistant' }, path: [ '__proto__', 'polluted'] }],
    ['a constructor path', { target: { kind: 'pack', packId: 'default-setup', groupId: 'assistant' }, path: [ 'constructor', 'prototype', 'polluted'] }],
    ["a surface's path", { target: { kind: 'feature', featureRef: 'memo-pack/memos' }, path: ['__proto__', 'polluted'] }],
  ])('keeps %s as data, and pollutes nothing', async (_, update) => {
    const app = await startApp({ systems: ['host/settings'] });
    await app.connect();

    await app.send('host/settings', { type: 'UPDATE_SETTINGS', ...update, value: 'yes' }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(getTestSettings().getAll().packs['default-setup'].assistant)).toBe(Object.prototype);
  });

  it('keeps such a key in replaced settings as data, and pollutes nothing', async () => {
    const app = await startApp({ systems: ['host/settings'] });
    await app.connect();

    // As a client's JSON arrives: "__proto__" an own key
    const data = getTestSettings().getAll();
    data.features['memo-pack/memos'] = JSON.parse('{ "tags": [], "__proto__": { "polluted": "yes" } }');
    await app.send('host/settings', { type: 'REPLACE_SETTINGS', data }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });

    const memos = getTestSettings().forPack('memo-pack').get({ kind: 'feature', featureRef: 'memo-pack/memos' }) as Record<string, unknown>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(memos.polluted).toBeUndefined();
    expect(Object.getPrototypeOf(memos)).toBe(Object.prototype);
    expect(Object.hasOwn(memos, '__proto__')).toBe(true);
    expect(memos.__proto__).toEqual({ polluted: 'yes' });
    expect(app.emitted('host/settings')).toContainEqual(expect.objectContaining({ type: 'ASK_ANSWERED', answer: { snapshot: expect.any(Object) } }));
  });
});

// Paths are relative to an explicit owner; app and pack preferences cannot share document roots.
describe('a change to an explicit settings owner', () => {
  it('writes app and pack preferences at their own addresses', async () => {
    const app = await startApp({ systems: ['host/settings'] });
    await app.connect();

    await app.send('host/settings', { type: 'UPDATE_SETTINGS', target: { kind: 'app' }, path: ['projects'], value: [{ name: 'one', directories: [], color: 'blue' }] }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });
    await app.send('host/settings', { type: 'UPDATE_SETTINGS', target: { kind: 'pack', packId: 'default-setup', groupId: 'assistant' }, path: ['name'], value: 'Ada' }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });

    const all = getTestSettings().getAll();
    expect(all.app.projects).toEqual([{ name: 'one', directories: [], color: 'blue' }]);
    expect(all.app).not.toHaveProperty('general');
    expect(all.packs['default-setup'].assistant).toEqual({ name: 'Ada' });
    expect(all.app).not.toHaveProperty('assistant');
  });

  it('refuses an undeclared pack group without writing', async () => {
    const app = await startApp({ systems: ['host/settings'] });
    await app.connect();

    await app.send('host/settings', { type: 'UPDATE_SETTINGS', target: { kind: 'pack', packId: 'default-setup', groupId: 'missing' }, path: ['x'], value: 1 }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });

    expect(app.emitted('host/settings').map((e) => e.type)).toContain('ASK_FAILED');
    expect(getTestSettings().getOverrides()).toEqual({});
  });
});
