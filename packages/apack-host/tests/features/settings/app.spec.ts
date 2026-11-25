import { readFileSync } from 'node:fs';
import { beforeEach, expect, it } from 'vitest';
import { boundEars, untypedQuery, untypedCreate } from '@apackdev/sdk/ears';
import type { EARS } from '@apackdev/sdk';
import { resetTestData } from '@apackdev/sdk/testing';
import { generateSettingsTypes } from '@apackdev/sdk/build';
import { registry } from '../../packs/runtime/test-host.ts';
import { appSettingsDefinition } from '../../../src/features/settings/be/app-definition.ts';
import { compileSettingsDefinition } from '../../../src/features/settings/compile.ts';
import { createSettingsStore } from '../../../src/features/settings/be/store.ts';

const id = 'Settings-app' as EARS.EntityId;
beforeEach(() => resetTestData());
const store = () => createSettingsStore({ ears: boundEars, catalog: () => registry.settingsCatalog() });

it('derives the public SDK types from the host definition', async () => {
  const generated = await generateSettingsTypes(appSettingsDefinition, 'AppSettings', { validate: compileSettingsDefinition });
  const recorded = readFileSync(new URL('../../../../apack-sdk/src/types/app-settings.ts', import.meta.url), 'utf8');
  expect(recorded.slice(recorded.indexOf('\n') + 1)).toBe(generated);
});

it('provides and resets app preferences without default-setup and owns returned values', () => {
  const settings = store();
  expect(settings.get({ kind: 'app' })).toEqual(appSettingsDefinition.defaults);
  expect(untypedQuery.ids(id).pickOne(['data'])).toBeUndefined();
  const first = settings.get<{ hotkeys: { switchSurfaceUp: { modifiers: string[] } } }>({ kind: 'app' });
  first.hotkeys.switchSurfaceUp.modifiers.push('changed');
  expect(settings.get({ kind: 'app' })).toEqual(appSettingsDefinition.defaults);
  settings.set({ kind: 'app' }, ['personal', 'name'], 'Ada');
  expect(settings.getOverrides()).toEqual({ app: { personal: { name: 'Ada' } } });
  settings.removeOverrides(['app', 'personal', 'name']);
  expect(settings.get({ kind: 'app' })).toEqual(appSettingsDefinition.defaults);
});

it.each([
  [['projects'], [{ name: 'Missing directories and color' }]],
  [['hotkeys', 'switchSurfaceUp', 'modifiers'], 1],
  [['personal', 'name'], undefined],
  [['unknown'], true],
])('refuses invalid app writes at %j without storing them', (path, value) => {
  const settings = store();
  expect(() => settings.set({ kind: 'app' }, path as string[], value)).toThrow();
  expect(settings.getOverrides()).toEqual({});
});

it('refuses writes retaining invalid app values, including an unchanged replacement', () => {
  const data = { app: { projects: 'invalid' } };
  untypedCreate('Settings', { id }).set('data', data);
  const settings = store();
  const heard: string[] = [];
  settings.onChange(change => heard.push(change));
  expect(() => settings.set({ kind: 'app' }, ['personal', 'name'], 'Ada')).toThrow();
  expect(() => settings.replaceAll(settings.getAll())).toThrow();
  expect(settings.getOverrides()).toEqual(data);
  expect(heard).toEqual([]);
  settings.removeOverrides(['app', 'projects']);
  settings.set({ kind: 'app' }, ['personal', 'name'], 'Ada');
  expect(settings.getOverrides()).toEqual({ app: { personal: { name: 'Ada' } } });
});

it('keeps a pack group named app separate from host preferences', () => {
  registry.registerPack({ id: 'app-claim', settings: { app: {
    schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, defaults: { name: 'pack value' },
  } } });
  try {
    expect(store().get({ kind: 'app' })).toEqual(appSettingsDefinition.defaults);
    expect(store().get({ kind: 'pack', packId: 'app-claim', groupId: 'app' })).toEqual({ name: 'pack value' });
  } finally { registry.unregisterPack('app-claim'); }
});

it('refuses newly missing required fields in feature arrays too', () => {
  registry.registerPack({ id: 'array-settings', features: { entries: { settings: {
    defaults: { items: [] }, schema: { type: 'object', properties: { items: { type: 'array', items: {
      type: 'object', properties: { name: { type: 'string' } }, required: ['name'],
    } } }, required: ['items'] },
  } } } });
  try {
    const settings = createSettingsStore({ ears: boundEars, catalog: () => registry.settingsCatalog() });
    expect(() => settings.set({ kind: 'feature', featureRef: 'array-settings/entries' as import('@apackdev/sdk/ids').FeatureRef }, ['items'], [{}])).toThrow('name');
    expect(settings.getOverrides()).toEqual({});
  } finally { registry.unregisterPack('array-settings'); }
});

it('refuses unknown root sections even when unchanged', () => {
  const data = { obsolete: { value: true } };
  untypedCreate('Settings', { id }).set('data', data);
  const settings = store();
  expect(() => settings.set({ kind: 'app' }, ['personal', 'name'], 'Ada')).toThrow('settings owner');
  expect(settings.getOverrides()).toEqual(data);
  settings.removeOverrides(['obsolete']);
  expect(settings.getOverrides()).toEqual({});
});


it('notifies a caller-bound handle when declared defaults change and stops on unsubscribe', async () => {
  const { createContributionCatalog } = await import('../../../src/packs/catalog.ts');
  const { createSettingsService } = await import('../../../src/services/settings.ts');
  const { _settingsHandle } = await import('@apackdev/sdk/services');
  const catalog = createContributionCatalog(appSettingsDefinition);
  const declaration = (name: string) => ({ id: 'observed', settings: { assistant: {
    schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false },
    defaults: { name },
  } } });
  catalog.setNative([declaration('Ada')]);
  const settings = createSettingsStore({ ears: boundEars, catalog: catalog.settings, onCatalogChanged: catalog.onChanged });
  const service = createSettingsService(settings).forPack('observed');
  const handle = _settingsHandle<{ name: string }>({ kind: 'pack', packId: 'observed', groupId: 'assistant' }, service);
  const heard: string[] = [];
  const stop = handle.onChange(value => heard.push(value.name));
  catalog.setNative([declaration('Grace')]);
  handle.set({ path: ['name'], value: 'User choice' });
  catalog.setNative([declaration('Changed baseline')]);
  expect(heard).toEqual(['Grace', 'User choice', 'User choice']);
  expect(handle.get()).toEqual({ name: 'User choice' });
  stop();
  catalog.setNative([declaration('After unsubscribe')]);
  expect(heard).toHaveLength(3);
});
