import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { boundEars, untypedQuery, untypedUpsert, untypedWrite } from '@apackdev/sdk/ears';
import { resetTestData } from '@apackdev/sdk/testing';
import type { EARS } from '@apackdev/sdk';
import type { PackRegistration } from '@apackdev/sdk/framework';
import type { SettingsTarget } from '@apackdev/sdk/types';
import { registry } from '../../packs/runtime/test-host.ts';
import { SettingsRefusedError } from '../../../src/features/settings/document.ts';
import { createSettingsStore, SETTINGS_ENTITY } from '../../../src/features/settings/be/store.ts';

const SETTINGS_ID = `${SETTINGS_ENTITY}-app` as EARS.EntityId;
const THREADS = 'default-setup/threads' as import('@apackdev/sdk/ids').FeatureRef;
const feature: SettingsTarget = { kind: 'feature', featureRef: THREADS };
const assistant: SettingsTarget = { kind: 'pack', packId: 'default-setup', groupId: 'assistant' };
const app: SettingsTarget = { kind: 'app' };
const assistantDefinition = {
  defaults: { name: '' },
  schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false },
};
const pack: PackRegistration = {
  id: 'default-setup',
  settings: { assistant: assistantDefinition },
  features: { threads: { settings: {
    defaults: { limit: 10, sort: 'newest' },
    schema: { type: 'object', properties: { limit: { type: 'integer', exclusiveMinimum: 0 }, sort: { type: 'string', enum: ['newest', 'oldest'] } }, required: ['limit', 'sort'], additionalProperties: false },
  } } },
};
registry.registerPack(pack);
afterAll(() => registry.unregisterPack(pack.id));
let store: ReturnType<typeof createSettingsStore>;
beforeEach(() => {
  resetTestData();
  store = createSettingsStore({ ears: boundEars, catalog: () => registry.settingsCatalog() });
});
const rowData = () => untypedQuery.ids(SETTINGS_ID).pickOne(['data'])?.data;

describe('definitions and explicit choices', () => {
  it('reads all three owners without creating a row', () => {
    expect(store.getOverrides()).toEqual({});
    expect(store.get(app)).toMatchObject({ projects: [], personal: {} });
    expect(store.get(assistant)).toEqual({ name: '' });
    expect(store.get(feature)).toEqual({ limit: 10, sort: 'newest' });
    expect(untypedQuery.ids(SETTINGS_ID).pickOne(['data'])).toBeUndefined();
  });

  it('keeps an explicit default-equal value until reset while following untouched defaults', () => {
    store.set(feature, ['limit'], 10);
    let catalog = registry.settingsCatalog();
    const moving = createSettingsStore({ ears: boundEars, catalog: () => catalog });
    const definition = catalog.features[THREADS];
    catalog = { ...catalog, revision: catalog.revision + 1, features: { ...catalog.features, [THREADS]: { ...definition, defaults: { limit: 50, sort: 'oldest' } } } };
    expect(moving.get(feature)).toEqual({ limit: 10, sort: 'oldest' });
    expect(moving.getOverrides()).toEqual({ features: { [THREADS]: { limit: 10 } } });
    moving.reset(feature);
    expect(moving.get(feature)).toEqual({ limit: 50, sort: 'oldest' });
  });

  it('keeps identically named groups independent across packs', () => {
    registry.registerPack({ id: 'another', settings: { assistant: assistantDefinition } });
    try {
      const other: SettingsTarget = { kind: 'pack', packId: 'another', groupId: 'assistant' };
      store.set(assistant, ['name'], 'Ada');
      store.set(other, ['name'], 'Grace');
      store.reset(assistant);
      expect(store.get(assistant)).toEqual({ name: '' });
      expect(store.get(other)).toEqual({ name: 'Grace' });
    } finally { registry.unregisterPack('another'); }
  });

  it('stores replacements as explicit choices, including default-equal values', () => {
    const replacement = store.getAll();
    replacement.features[THREADS] = { limit: 10, sort: 'oldest' };
    store.replaceAll(replacement);
    expect(store.getOverrides()).toEqual(replacement);
    store.resetAll();
    expect(store.getOverrides()).toEqual({});
  });

  it('returns independent snapshots', () => {
    store.get<{ limit: number }>(feature).limit = -1;
    expect(store.get(feature)).toEqual({ limit: 10, sort: 'newest' });
    expect(registry.settingsCatalog().features[THREADS].defaults.limit).toBe(10);
  });
});

describe('one validated writer', () => {
  it.each([['limit', '10'], ['limit', -1], ['sort', 'random'], ['unknown', true], ['sort', undefined]])('refuses invalid %s atomically', (key, value) => {
    const heard: string[] = [];
    store.onChange(change => heard.push(change));
    expect(() => store.set(feature, [key], value)).toThrow(SettingsRefusedError);
    expect(rowData()).toBeUndefined();
    expect(heard).toEqual([]);
  });

  it('validates every declared owner in whole-document replacement', () => {
    store.set(feature, ['sort'], 'oldest');
    const before = store.getOverrides();
    const replacement = store.getAll();
    replacement.packs['default-setup'].assistant = { name: 1 };
    expect(() => store.replaceAll(replacement)).toThrow('packs/default-setup/assistant');
    expect(store.getOverrides()).toEqual(before);
    expect(() => store.replaceAll({ general: {} })).toThrow(SettingsRefusedError);
  });

  it('refuses incomplete replacement instead of silently restoring omitted defaults', () => {
    const heard: string[] = [];
    store.onChange(change => heard.push(change));
    expect(() => store.replaceAll({ features: { [THREADS]: { limit: 10, sort: 'newest' } } })).toThrow('Missing settings owner app');
    const replacement = store.getAll();
    replacement.features[THREADS] = { limit: 10 };
    expect(() => store.replaceAll(replacement)).toThrow('sort');
    expect(store.getOverrides()).toEqual({});
    expect(heard).toEqual([]);
  });

  it('retains current-format unavailable overrides but refuses edits and allows host removal', () => {
    const orphan = { packs: { absent: { assistant: { name: 'Keep' } } }, features: { 'absent/code': { limit: 2 } } };
    untypedUpsert(SETTINGS_ENTITY, { id: SETTINGS_ID, data: orphan });
    store.set(assistant, ['name'], 'Ada');
    expect(store.getOverrides()).toMatchObject(orphan);
    const replacement = store.getAll();
    replacement.features['absent/code'] = { limit: 3 };
    expect(() => store.replaceAll(replacement)).toThrow('Unavailable settings owner');
    expect(() => store.get({ kind: 'pack', packId: 'absent', groupId: 'assistant' })).toThrow('unavailable');
    store.reset({ kind: 'pack', packId: 'absent', groupId: 'assistant' });
    expect(store.getOverrides().packs?.absent).toEqual({});
  });

  it('refuses retaining invalid declared data and permits replacing the invalid slice', () => {
    const data = { features: { [THREADS]: { unknown: true, limit: 'invalid' } } };
    untypedUpsert(SETTINGS_ENTITY, { id: SETTINGS_ID, data });
    expect(() => store.set(assistant, ['name'], 'Ada')).toThrow(SettingsRefusedError);
    expect(store.getOverrides()).toEqual(data);
    store.set(feature, [], { sort: 'oldest' });
    expect(store.get(feature)).toEqual({ limit: 10, sort: 'oldest' });
  });

  it('rejects malformed untyped targets before addressing data', () => {
    for (const target of [{}, { kind: 'app', packId: 'x' }, { kind: 'feature', featureRef: 'threads' }, { kind: 'pack', packId: 'default-setup', groupId: '../app' }]) {
      expect(() => store.reset(target as SettingsTarget)).toThrow(SettingsRefusedError);
    }
    expect(store.getOverrides()).toEqual({});
  });
});

describe('caller policy', () => {
  it('permits declared dependents by default, refuses unrelated and unknown callers', () => {
    registry.registerPack({ id: 'dependent', dependencies: { 'default-setup': '*' } });
    registry.registerPack({ id: 'unrelated' });
    try {
      store.set(assistant, ['name'], 'Ada', 'dependent');
      expect(store.get(assistant, 'dependent')).toEqual({ name: 'Ada' });
      expect(() => store.set(assistant, ['name'], 'No', 'unrelated')).toThrow('does not depend');
      expect(() => store.reset(assistant, 'not-declared')).toThrow('not declared');
      expect(store.get(assistant)).toEqual({ name: 'Ada' });
    } finally { registry.unregisterPack('dependent'); registry.unregisterPack('unrelated'); }
  });

  it('restricts mutations by owner without restricting dependent reads', () => {
    const catalog = registry.settingsCatalog();
    const guarded = createSettingsStore({ ears: boundEars, catalog: () => ({ ...catalog,
      dependencies: { ...catalog.dependencies, dependent: ['default-setup'] },
      packs: { ...catalog.packs, 'default-setup': { assistant: { ...assistantDefinition, access: 'owner' } } },
    }) });
    expect(guarded.get(assistant, 'dependent')).toEqual({ name: '' });
    expect(() => guarded.set(assistant, ['name'], 'No', 'dependent')).toThrow('Only pack');
    expect(() => guarded.reset(assistant, 'dependent')).toThrow('Only pack');
    guarded.set(assistant, ['name'], 'Ada', 'default-setup');
    expect(guarded.get(assistant)).toEqual({ name: 'Ada' });
  });
});

describe('notifications and data replacement', () => {
  it('reports app, pack and feature writes once and unsubscribes', () => {
    const heard: string[] = [];
    const off = store.onChange(change => heard.push(change));
    store.set(app, ['projects'], []);
    store.set(assistant, ['name'], 'Ada');
    store.set(feature, ['sort'], 'oldest');
    off();
    store.resetAll();
    expect(heard).toEqual(['written', 'written', 'written']);
  });

  it('does not notify for removing an absent override', () => {
    const heard: string[] = [];
    store.onChange(change => heard.push(change));
    store.removeOverrides(['features', THREADS, 'missing']);
    expect(heard).toEqual([]);
  });

  it('brackets nested replacement and ends even after failure', async () => {
    const heard: string[] = [];
    store.onChange(change => heard.push(change));
    await expect(store.whileReplacingData(async () => {
      await store.whileReplacingData(async () => { store.set(assistant, ['name'], 'Ada'); });
      throw new Error('import failed');
    })).rejects.toThrow('import failed');
    expect(heard).toEqual(['replacing', 'written', 'replaced']);
  });

  it('publishes hydrated values only after replacement settles', async () => {
    store.set(assistant, ['name'], 'Published');
    const before = store.getSnapshot();
    await store.whileReplacingData(async () => {
      const pending = store.getSnapshot();
      untypedWrite(SETTINGS_ID).set('data', { packs: { 'default-setup': { assistant: { name: 'Restored' } } } });
      expect(store.getAll().packs['default-setup'].assistant).toEqual({ name: 'Restored' });
      expect(store.getSnapshot()).toEqual(pending);
      expect(pending.values).toEqual(before.values);
      pending.values.packs['default-setup'].assistant = { name: 'Detached' };
      expect(store.getSnapshot().values).toEqual(before.values);
    });
    const after = store.getSnapshot();
    expect(after.status).toBe('ready');
    expect(after.revision).toBeGreaterThan(before.revision);
    expect(after.values.packs['default-setup'].assistant).toEqual({ name: 'Restored' });
  });
});


describe('draft comparisons', () => {
  it('refuses stale whole-array edits but permits unrelated preference changes', () => {
    const initial = store.getSnapshot();
    const condition = { runId: initial.runId, expected: { exists: true, value: [] } };
    store.set(assistant, ['name'], 'Unrelated');
    store.set(app, ['projects'], [{ name: 'First', directories: ['/first'], color: '#fff' }], undefined, condition);
    const before = store.getOverrides();
    expect(() => store.set(app, ['projects'], [], undefined, condition)).toThrow('changed since editing began');
    expect(store.getOverrides()).toEqual(before);
  });

  it('refuses a draft from another backend run even if its value is unchanged', () => {
    expect(() => store.set(app, ['projects'], [], undefined, { runId: 'stopped-run', expected: { exists: true, value: [] } })).toThrow('changed since editing began');
    expect(store.getOverrides()).toEqual({});
  });

  it('increments value revision only after a write or data replacement and exposes replacement readiness', async () => {
    const first = store.getSnapshot();
    expect(() => store.set(assistant, ['name'], 1)).toThrow();
    expect(store.getSnapshot().revision).toBe(first.revision);
    store.set(assistant, ['name'], 'Ada');
    expect(store.getSnapshot().revision).toBe(first.revision + 1);
    await store.whileReplacingData(async () => { expect(store.getSnapshot().status).toBe('replacing'); });
    expect(store.getSnapshot()).toMatchObject({ runId: first.runId, revision: first.revision + 3, status: 'ready' });
  });
});


it('permits replacement initialization while refusing unrelated pack writers', async () => {
  let finish!: () => void;
  const wait = new Promise<void>(resolve => { finish = resolve; });
  const replacing = store.whileReplacingData(async () => {
    await wait;
    store.set(assistant, ['name'], 'Initialized', 'default-setup');
    expect(store.get(assistant)).toEqual({ name: 'Initialized' });
    store.reset(assistant, 'default-setup');
  });
  try {
    expect(() => store.set(assistant, ['name'], 'Racing', 'default-setup')).toThrow('Data is being replaced');
    expect(() => store.reset(assistant, 'default-setup')).toThrow('Data is being replaced');
  } finally { finish(); await replacing; }
  expect(store.getOverrides()).toEqual({ packs: { 'default-setup': {} } });
});


it.each([null, [], 'invalid'])('refuses a malformed stored row rather than treating %j as missing preferences', data => {
  untypedUpsert(SETTINGS_ENTITY, { id: SETTINGS_ID, data });
  const before = rowData();
  expect(() => store.getAll()).toThrow('Stored settings must be a JSON object');
  expect(() => store.set(app, ['personal', 'name'], 'Ada')).toThrow('Stored settings must be a JSON object');
  expect(rowData()).toEqual(before);
});

it('keeps committed writes and replacement lifecycle independent of subscriber failures', async () => {
  const heard: string[] = [];
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  store.onChange(() => { throw new Error('broken subscriber'); });
  store.onChange(change => heard.push(change));
  try {
    expect(() => store.set(app, ['personal', 'name'], 'Ada')).not.toThrow();
    expect(store.get(app)).toMatchObject({ personal: { name: 'Ada' } });
    await store.whileReplacingData(async () => {});
    expect(store.getSnapshot().status).toBe('ready');
    expect(heard).toEqual(['written', 'replacing', 'replaced']);
  } finally { log.mockRestore(); }
});


it('does not let detached initialization work retain write access during a later replacement', async () => {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  let detached!: Promise<void>;
  await store.whileReplacingData(async () => {
    detached = wait.then(() => { store.set(assistant, ['name'], 'Stale initialization', 'default-setup'); });
  });
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const replacing = store.whileReplacingData(() => pending);
  try {
    release();
    await expect(detached).rejects.toThrow('Data is being replaced');
  } finally { finish(); await replacing; }
});


describe('explicit settings recovery', () => {
  function corrupt(data: unknown) {
    untypedUpsert(SETTINGS_ENTITY, { id: SETTINGS_ID, data });
    store.enterRecovery();
    return store.getRecovery()!;
  }

  it('reports nothing and reads normally until boot enters recovery', () => {
    untypedUpsert(SETTINGS_ENTITY, { id: SETTINGS_ID, data: { features: { [THREADS]: { limit: 5 } } } });
    expect(store.getRecovery()).toBeUndefined();
    expect(store.get(feature)).toMatchObject({ limit: 5 });
  });

  it('attributes schema problems and refuses typed reads of the invalid values', () => {
    const recovery = corrupt({ features: { [THREADS]: { limit: 'invalid' } } });
    expect(recovery.problems).toContainEqual({ target: feature, path: ['limit'], message: 'must be integer' });
    expect(() => store.get(feature)).toThrow('recovery');
    expect(() => store.getAll()).toThrow('recovery');
    expect(() => store.getSnapshot()).toThrow('recovery');
    expect(rowData()).toEqual({ features: { [THREADS]: { limit: 'invalid' } } });
  });

  it('refuses every write but the recovery reset, leaving the stored row as it was', () => {
    const data = { features: { [THREADS]: { limit: 'invalid' } } };
    corrupt(data);
    expect(() => store.set(feature, ['sort'], 'oldest')).toThrow('recovery');
    expect(() => store.reset(feature)).toThrow('recovery');
    expect(() => store.replaceAll({})).toThrow('recovery');
    expect(() => store.removeOverrides(['features', THREADS])).toThrow('recovery');
    expect(() => store.resetAll()).toThrow('recovery');
    expect(rowData()).toEqual(data);
  });

  it('validates typed reads even before boot explicitly enters recovery', () => {
    untypedUpsert(SETTINGS_ENTITY, { id: SETTINGS_ID, data: { features: { [THREADS]: { limit: 'invalid' } } } });
    expect(store.getRecovery()).toBeUndefined();
    expect(() => store.get(feature)).toThrow('limit');
    expect(() => store.getAll()).toThrow('limit');
    expect(() => store.getSnapshot()).toThrow('limit');
  });

  it('resets selected affected owners atomically, preserving every unselected owner', () => {
    const data = { app: { personal: { name: 'Keep' } },
      features: { [THREADS]: { limit: 'invalid', sort: 'oldest' }, 'absent/feature': { keep: true } },
      packs: { 'default-setup': { assistant: { name: 42 } } },
    };
    const recovery = corrupt(data);
    const heard = vi.fn();
    store.onChange(heard);
    expect(() => store.recover({ version: recovery.version, reset: [feature] })).toThrow('assistant');
    expect(rowData()).toEqual(data);
    expect(heard).not.toHaveBeenCalled();
    expect(() => store.recover({ version: recovery.version, reset: [app] })).toThrow('Only affected');
    store.recover({ version: recovery.version, reset: [feature, assistant] });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(store.getRecovery()).toEqual({ version: { ...recovery.version, revision: recovery.version.revision + 1 }, problems: [] });
    expect(rowData()).toEqual({ app: data.app, features: { 'absent/feature': { keep: true } }, packs: { 'default-setup': {} } });
    expect(() => store.getSnapshot()).toThrow('recovery'); // Normal reads still require a new app lifetime.
  });

  it('requires explicit owner selection for a conditional schema rather than inferring deletions from error paths', () => {
    const id = 'conditional-settings';
    registry.registerPack({ id, settings: { options: {
      defaults: { mode: 'basic', keep: 'default' },
      schema: { type: 'object', properties: { mode: { enum: ['basic', 'advanced'] }, keep: { type: 'string' } },
        required: ['mode', 'keep'], if: { properties: { mode: { const: 'advanced' } } },
        // oxlint-disable-next-line unicorn/no-thenable -- JSON Schema conditional, not a promise callback.
        then: { properties: { details: { type: 'string' } }, required: ['details'] },
      },
    } } });
    try {
      const target: SettingsTarget = { kind: 'pack', packId: id, groupId: 'options' };
      const data = { app: { personal: { name: 'Keep' } }, packs: { [id]: { options: { mode: 'advanced', keep: 'My choice' } } } };
      const recovery = corrupt(data);
      expect(recovery.problems).toContainEqual(expect.objectContaining({ target, path: ['details'] }));
      expect(() => store.recover({ version: recovery.version, reset: [] })).toThrow('Select affected');
      expect(rowData()).toEqual(data);
      store.recover({ version: recovery.version, reset: [target] });
      expect(rowData()).toEqual({ app: data.app, packs: { [id]: {} } });
      expect(store.getRecovery()?.problems).toEqual([]);
    } finally { registry.unregisterPack(id); }
  });

  it.each([null, [], 'broken', { features: null }])('requires a complete reset for malformed data %j', data => {
    const recovery = corrupt(data);
    expect(recovery.problems.every(problem => !problem.target)).toBe(true);
    expect(() => store.recover({ version: recovery.version, reset: [feature] })).toThrow('malformed');
    expect(rowData()).toEqual(data);
    store.recover({ version: recovery.version, reset: 'all' });
    expect(rowData()).toEqual({});
    expect(store.getRecovery()?.problems).toEqual([]);
  });

  it('refuses recovery writes while app data is being replaced', async () => {
    await store.whileReplacingData(async () => {
      const recovery = corrupt({ features: { [THREADS]: { limit: 'invalid' } } });
      const before = rowData();
      expect(() => store.recover({ version: recovery.version, reset: 'all' })).toThrow('being replaced');
      expect(rowData()).toEqual(before);
      // The replacement's own data arrives by hydration, which bypasses the writer
      untypedUpsert(SETTINGS_ENTITY, { id: SETTINGS_ID, data: {} });
    });
  });

  it('refuses a request for another process or revision, and a repeat once repaired, without writing', () => {
    const recovery = corrupt({ features: { [THREADS]: { limit: 'invalid' } } });
    const before = rowData();
    for (const version of [{ ...recovery.version, runId: 'another-process' }, { ...recovery.version, revision: recovery.version.revision + 1 }]) {
      expect(() => store.recover({ version, reset: 'all' })).toThrow('changed');
    }
    expect(rowData()).toEqual(before);
    store.recover({ version: recovery.version, reset: [feature] });
    expect(() => store.recover({ version: store.getRecovery()!.version, reset: 'all' })).toThrow('changed');
  });
});

it.each(['COMMIT_UNKNOWN', 'RECOVERY_REQUIRED'])('never publishes ready settings after %s', async code => {
  const changes: string[] = [];
  const stop = store.onChange(change => { changes.push(change); });
  const failure = Object.assign(new Error('import requires inspection'), { code });
  try {
    await expect(store.whileReplacingData(async () => { throw failure; })).rejects.toBe(failure);
    expect(changes).not.toContain('replaced');
    expect(() => store.getSnapshot()).toThrow(failure);
    expect(() => store.get(app)).toThrow(failure);
    expect(() => store.set(assistant, ['name'], 'unsafe')).toThrow(failure);
    expect(() => store.getRecovery()).toThrow(failure);
  } finally { stop(); }
});
