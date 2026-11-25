import { _packEntityTypes } from '@apackdev/sdk/framework';
import { createNativePackTestRegistry } from '@apackdev/host/testing';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ManifestSchema, _declarationRevision } from '@apackdev/pack-format';
import type { ContentRuntime } from '@apackdev/sdk/framework';
import { startTestRuntime, resetTestData } from '@apackdev/sdk/testing';
import { contentBindingProblem } from '../../src/packs/declaration-binding.ts';

const manifest = ManifestSchema.parse({
  id: 'content-pack', name: 'Content', version: '1.0.0', data: { entities: { ContentThing: {} } },
  features: { notes: { description: 'Feature declaration fixture.',
    designation: 'notes', system: { entry: 'system.ts' }, surface: { label: 'Fixture', state: 'surface.ts' },
    services: { notes: 'notes.ts#notes' }, repositories: { contentQueries: 'queries.ts#queries' },
    settings: { schema: { type: 'object' }, defaults: { count: 0 } },
  } },
  content: { writers: { ContentThing: 'writer.ts#writer' }, sources: { things: { applier: 'things.ts' } } },
});
const declarationRevision = _declarationRevision(manifest);
const origin = { id: manifest.id, name: manifest.name, version: manifest.version, manifest,
  declarationRevision, dir: '/source/content-pack' };
const queries = { count: () => 42 };
const writer = { find: () => undefined };
const runtime: ContentRuntime = { id: manifest.id, declarationRevision,
  entities: _packEntityTypes(manifest)!, relKinds: {}, roles: {}, repositories: { contentQueries: queries },
  contentWriters: { ContentThing: writer } };

let registry: ReturnType<typeof createNativePackTestRegistry>;
beforeEach(() => {
  startTestRuntime({ entityTypes: ['ContentThing'] });
  registry = createNativePackTestRegistry();
  registry.catalog.setSources([{ manifest, declarationRevision, dir: origin.dir }]);
});
afterEach(() => {
  if (registry.getPackRegistration(manifest.id)) registry.unregisterPack(manifest.id);
  resetTestData();
});

it('binds content while retaining declarations without backend activation', () => {
  registry.registerContentRuntime(runtime, origin);
  expect(registry.systemIds()).toEqual([]);
  expect(registry.surfaceIds()).toEqual([]);
  expect(registry.designation('notes')).toBeUndefined();
  expect(registry.getRegisteredServices()).toEqual({});
  expect(registry.contentWriters('ContentThing')).toBe(writer);
  expect(registry.repository('contentQueries')).toBe(queries);
  expect(registry.settingsCatalog().features['content-pack/notes'].defaults).toEqual({ count: 0 });
  registry.unregisterPack(manifest.id);
  expect(registry.contentWriters('ContentThing')).toBeUndefined();
  expect(registry.repository('contentQueries')).toBeUndefined();
  expect(registry.settingsCatalog().features).toHaveProperty('content-pack/notes');
});

it('refuses a stale content identity before contributing repositories', () => {
  expect(() => registry.registerContentRuntime({ ...runtime, declarationRevision: 'stale' }, origin)).toThrow('rebuild');
  expect(registry.getPackRegistration(manifest.id)).toBeNull();
  expect(registry.repository('contentQueries')).toBeUndefined();
});

it.each([
  ['entities', { entities: { Other: 'Other' } }],
  ['relKinds', { relKinds: { Extra: 'extra' }, roles: {} }],
  ['repositories', { repositories: { ghost: {} } }],
  ['contentWriters', { contentWriters: {} }],
] as const)('refuses content %s that disagrees with its declaration', (path, change) => {
  const candidate = { ...runtime, ...change };
  expect(contentBindingProblem(manifest, candidate)).toContain(`runtime ${path}`);
  expect(() => registry.registerContentRuntime(candidate, origin)).toThrow(`runtime ${path}`);
  expect(registry.getPackRegistration(manifest.id)).toBeNull();
  expect(registry.repository('contentQueries')).toBeUndefined();
});

it('accepts a declared source applier instance and removes it with the content binding', () => {
  class ThingsApplier {
    key = 'things';
    apply() { return { created: 0, updated: 0, skipped: 0 }; }
  }
  const applier = new ThingsApplier();
  registry.registerContentRuntime(runtime, origin, [applier]);
  expect(registry.appliers(manifest.id)).toEqual([applier]);
  registry.unregisterPack(manifest.id);
  expect(registry.appliers(manifest.id)).toEqual([]);
});

it('refuses an undeclared or duplicate applier before registering content', () => {
  const apply = () => ({ created: 0, updated: 0, skipped: 0 });
  for (const appliers of [[{ key: 'ghost', apply }], [{ key: 'things', apply }, { key: 'things', apply }]]) {
    expect(() => registry.registerContentRuntime(runtime, origin, appliers)).toThrow('runtime appliers');
    expect(registry.getPackRegistration(manifest.id)).toBeNull();
    expect(registry.repository('contentQueries')).toBeUndefined();
  }
});
