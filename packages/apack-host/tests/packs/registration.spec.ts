import { createNativePackTestRegistry } from '@apackdev/host/testing';
import { _createPackServices } from '@apackdev/sdk/services';
import { createSettingsStore, createSettingsService } from '../../src/features/settings/be/index.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _createTestEngine } from '@apackdev/sdk/testing';
import { _bindEars, boundEars } from '@apackdev/sdk/ears';
import { repository } from '@apackdev/sdk/services';
import { getSettingsCatalog, type PackFeatureSystem, type PackRegistration } from '@apackdev/sdk/framework';
import { artifactRegistry } from '@apackdev/sdk/artifacts';
import { _contentWriterRegistry } from '@apackdev/sdk/content';
import { SDK_ENTITIES } from '@apackdev/sdk/types';
import { HOST_ENTITY_TYPES } from '../../src/app-state/index.ts';
import { getDesignated, hasDesignation } from '@apackdev/sdk/designations';
import { startTestRuntime } from '@apackdev/sdk/testing';
import { hostRegistration } from '../../src/features/registration.ts';
import { HOST } from '../../src/refs.ts';
import { HOST_PACK_ID } from '@apackdev/sdk/ids';

const registry = createNativePackTestRegistry();
startTestRuntime({ packs: registry });
const {
  getPackRegistration, getRegisteredEntityTypes, getRegisteredRoles, getRegisteredServices,
  registerPack, systemIds, surfaceIds, unregisterPack,
} = registry;

const registered: string[] = [];
afterEach(() => {
  for (const id of registered.splice(0)) unregisterPack(id);
});

function register(id: string, services: Record<string, unknown>): void {
  registerPack({ id, services } as unknown as PackRegistration);
  registered.push(id);
}

describe('registerPack services', () => {
  it('rejects a service name another pack registered', () => {
    register('first-pack', { llm: {} });
    expect(() => register('second-pack', { llm: {} })).toThrow('Service collision: key "llm" — pack "second-pack" vs "first-pack"');
  });

  it.each(['logger', 'emitter', 'repository', 'onboarding'])('rejects a pack service named like the host service %s', (name) => {
    expect(() => register('shadowing-pack', { [name]: {} })).toThrow(`vs the host's own "${name}" service`);
    expect(getRegisteredServices()).not.toHaveProperty(name);
  });

  it.each(['constructor', 'toString'])('only treats an owned service named %s as a collision', name => {
    register('unrelated-pack', {});
    register('first-pack', { [name]: 1 });
    expect(Object.hasOwn(getRegisteredServices(), name)).toBe(true);
    expect(getRegisteredServices()[name]).toBe(1);
    expect(() => register('second-pack', { [name]: 2 })).toThrow(`pack "second-pack" vs "first-pack"`);
    expect(getRegisteredServices()[name]).toBe(1);
  });

  it('registers distinct services', () => {
    register('first-pack', { llm: 1 });
    register('second-pack', { search: 2 });
    expect(getRegisteredServices()).toEqual({ llm: 1, search: 2 });
  });
});

describe('registerPack repositories', () => {
  it("holds a pack's repositories, where repository and services read them", () => {
    const noteQueries = { all: () => [] };
    registerPack({ id: 'repo-pack', repositories: { noteQueries } });
    registered.push('repo-pack');
    expect(registry.repository('noteQueries')).toBe(noteQueries);
    expect(repository.noteQueries).toBe(noteQueries);
  });

  it('removes them when the pack is unregistered', () => {
    registerPack({ id: 'repo-pack', repositories: { noteQueries: {} } });

    unregisterPack('repo-pack');

    expect(registry.repository('noteQueries')).toBeUndefined();
    expect(() => repository.noteQueries).toThrow('"noteQueries" is not registered');
  });

  it('rejects a repository name another pack registered, keeping that pack\'s', () => {
    const theirs = { name: 'theirs' };
    registerPack({ id: 'first-pack', repositories: { settingsQueries: theirs } });
    registered.push('first-pack');

    expect(() => registerPack({ id: 'second-pack', repositories: { memoQueries: {}, settingsQueries: {} } }))
      .toThrow(/"settingsQueries"[\s\S]*"second-pack"[\s\S]*"first-pack"/);
    expect(registry.repository('settingsQueries')).toBe(theirs);
    expect(registry.repository('memoQueries')).toBeUndefined();
  });

  it("holds none of a pack's repositories when a later part of its registration is refused", () => {
    registerPack({ id: 'first-pack', features: { chat: { designation: 'standup' } } } as unknown as PackRegistration);
    registered.push('first-pack');

    expect(() => registerPack({ id: 'second-pack', repositories: { memoQueries: {} }, features: { chat: { designation: 'standup' } } } as unknown as PackRegistration))
      .toThrow('Designation collision');
    expect(registry.repository('memoQueries')).toBeUndefined();
  });
});

/**
 * The host's own features are addressed as `HOST.<feature>`, not by a role. Settings claimed the `settings`
 * designation from when it was a default-setup feature, and every reader of that role turned out to be the app
 * resolving its own surface. The role is gone; the surface is registered and reachable without it, and the name is
 * free for a pack to take.
 */
describe('the host claims no designation', () => {
  it('registers its features with no role, and the Settings view is still registered', () => {
    registry.registerPack(hostRegistration());
    registered.push(HOST_PACK_ID);

    expect(surfaceIds()).toContain(HOST.settings);
    expect(hasDesignation('settings')).toBe(false);
  });

  // A role is a pack's own name for a pack's own feature, `settings` included: the app's view is registered at its
  // ref either way, and the two are not the same thing
  it('leaves every role name to the packs, `settings` included', () => {
    registry.registerPack(hostRegistration());
    registered.push(HOST_PACK_ID);
    registerPack({ id: 'ext', features: { prefs: { designation: 'settings', surface: { receives: [] } } } });
    registered.push('ext');

    expect(getDesignated('settings')).toBe('ext/prefs');
    expect(surfaceIds()).toContain(HOST.settings);
  });
});

describe('registerPack designations', () => {
  const system: PackFeatureSystem = { machine: {} as PackFeatureSystem['machine'], receives: [] };
  const registerDesignated = (id: string, journal: { system?: PackFeatureSystem } = { system }, extra: Partial<PackRegistration> = {}) => {
    registerPack({ id, features: { journal: { designation: 'journal', ...journal } }, ...extra });
    registered.push(id);
  };

  // Its system and surface share the feature's address, so the role resolves to it whether it has a system, runs
  // it early, or has none
  it.each([
    ['with a system', { system }],
    ['with an early system', { system: { ...system, early: true as const } }],
    ['without one', {}],
  ])("resolves a role to the feature's address, %s", (_case, journal) => {
    registerDesignated('ext', journal);
    expect(getDesignated('journal')).toBe('ext/journal');
  });

  it('rejects a role another pack holds, registering none of the pack', () => {
    registerDesignated('first');
    expect(() => registerDesignated('second', { system }, { services: { second: {} } }))
      .toThrow('Designation collision: role "journal" — pack "second" vs "first"');
    expect(getDesignated('journal')).toBe('first/journal');
    expect(getRegisteredServices()).not.toHaveProperty('second');
  });

});

describe('registered addresses', () => {
  it("lists every pack's systems and features at their refs", () => {
    registerPack({ id: 'ext', features: { notes: { system: { machine: {} as PackFeatureSystem['machine'], receives: [] }, surface: { receives: [] } } } });
    registered.push('ext');
    expect(systemIds()).toContain('ext/notes');
    expect(surfaceIds()).toContain('ext/notes');

    unregisterPack(registered.pop()!);
    expect(systemIds()).not.toContain('ext/notes');
    expect(surfaceIds()).not.toContain('ext/notes');
  });
});

describe('registerPack entities', () => {
  const registerEntities = (id: string, entities: Record<string, string>, relKinds: Record<string, string> = {}, roles: Record<string, string> = {}) => {
    registerPack({ id, ears: { entities, relKinds, roles } } as unknown as PackRegistration);
    registered.push(id);
  };

  it('rejects an entity type another pack registered', () => {
    registerEntities('first-pack', { Memo: 'Memo' });
    expect(() => registerEntities('second-pack', { Memo: 'Memo' })).toThrow('EARS collision: entity type "Memo" — pack "second-pack" vs "first-pack"');
  });

  it('rejects a role another pack registered, and refuses one the SDK declares', () => {
    registerEntities('first-pack', {}, {}, { STARRED: 'starred' });
    expect(getRegisteredRoles()).toContain('starred');
    expect(() => registerEntities('second-pack', {}, {}, { STARRED: 'starred' })).toThrow('EARS collision: role "STARRED": "starred" — pack "second-pack" vs "first-pack"');
    expect(() => registerEntities('second-pack', {}, {}, { ROOT_FLOW: 'root_flow' })).toThrow('root_flow');
    expect(getPackRegistration('second-pack')).toBeNull();
  });

  it('rejects a short code prefix another pack, or the SDK, numbers an entity type with', () => {
    const registerNumbered = (id: string, type: string, shortCode: string) => {
      registerPack({ id, ears: { entities: { [type]: type }, relKinds: {}, roles: {}, rowRules: { [type]: { required: [], shortCode } } } } as unknown as PackRegistration);
      registered.push(id);
    };
    registerNumbered('first-pack', 'Memo', 'MEM');
    expect(() => registerNumbered('second-pack', 'Note', 'MEM')).toThrow('EARS collision: short code prefix MEM — Note of pack "second-pack" vs Memo of pack "first-pack"');
    // Refused before the registry: a native declaration carries the prefix, and its schema knows the SDK's
    expect(() => registerNumbered('second-pack', 'Note', 'DOC')).toThrow('"DOC" is the SDK\'s Document prefix');
    expect(getPackRegistration('second-pack')).toBeNull();
  });

  it("answers a short code's entity type from the registered packs' prefixes, and forgets a pack's when it goes", () => {
    registerPack({ id: 'memo-pack', ears: { entities: { Memo: 'Memo' }, relKinds: {}, roles: {}, rowRules: { Memo: { required: [], shortCode: 'MEM' } } } } as unknown as PackRegistration);
    expect([registry.entityTypeOfShortCode('MEM-3'), registry.entityTypeOfShortCode('DOC-1'), registry.entityTypeOfShortCode('XYZ-1')]).toEqual(['Memo', 'Document', undefined]);
    unregisterPack('memo-pack');
    expect(registry.entityTypeOfShortCode('MEM-3')).toBeUndefined();
  });

  it("rejects a relation kind another pack registered, by its name or its value", () => {
    registerEntities('first-pack', {}, { PINNED: 'pinned' });
    expect(() => registerEntities('second-pack', {}, { PINNED: 'pinned' })).toThrow('EARS collision: relation kind "PINNED": "pinned" — pack "second-pack" vs "first-pack"');
    expect(() => registerEntities('second-pack', {}, { STUCK: 'pinned' })).toThrow('Native pack "second-pack" runtime ears.relKinds does not match its admitted declarations');
    expect(() => registerEntities('second-pack', {}, { PINNED: 'stuck' })).toThrow('Native pack "second-pack" runtime ears.relKinds does not match its admitted declarations');
  });

  it("rejects a pack built when its registration still listed its dependency's names", () => {
    registerEntities('base-pack', { Thread: 'Thread' });
    expect(() => registerEntities('older-pack', { Thread: 'Thread', Memo: 'Memo' })).toThrow('EARS collision: entity type "Thread" — pack "older-pack" vs "base-pack"');
  });

  it("has the SDK's and the host's entity types with no pack registered, and a pack's added", () => {
    const appEntities = [...Object.values(SDK_ENTITIES), ...HOST_ENTITY_TYPES];
    expect([...getRegisteredEntityTypes()].sort()).toEqual([...appEntities].sort());
    registerEntities('first-pack', { Memo: 'Memo' }, { PINNED: 'pinned' });
    expect([...getRegisteredEntityTypes()].sort()).toEqual([...appEntities, 'Memo'].sort());
    expect(getPackRegistration('first-pack')?.ears?.relKinds).toEqual({ PINNED: 'pinned' });
  });

  it('refuses SDK entity declarations before native runtime registration', () => {
    expect(() => registerEntities('first-pack', { Flow: 'Flow' })).toThrow('data.entities: "Flow" is defined by the SDK');
    expect(getPackRegistration('first-pack')).toBeNull();
  });

  it.each(['CONTAINS', 'HOLDS'])('refuses SDK relation wires before native registration: %s', key => {
    expect(() => registerEntities('first-pack', {}, { [key]: 'contains' })).toThrow('data.relations: "CONTAINS": "contains" is defined by the SDK');
    expect(getPackRegistration('first-pack')).toBeNull();
  });

  it('refuses a noncanonical native relation binding, including a reserved enum alias', () => {
    expect(() => registerEntities('first-pack', {}, { CONTAINS: 'holds' }))
      .toThrow('Native pack "first-pack" runtime ears.relKinds does not match its admitted declarations');
    expect(getPackRegistration('first-pack')).toBeNull();
  });

  it.each([
    [{ AppState: 'AppState' }, {}, 'entity type "AppState"'],
    [{ AppliedContent: 'AppliedContent' }, {}, 'entity type "AppliedContent"'],
  ])('rejects %o %o, which the app declares', (entities, relKinds, name) => {
    expect(() => registerEntities('first-pack', entities, relKinds)).toThrow(`EARS collision: ${name} — pack "first-pack" vs the app's own`);
    expect(getPackRegistration('first-pack')).toBeNull();
  });

});

describe('registerPack feature settings', () => {
  const memos = { surface: { receives: [] }, settings: { defaults: { sort: 'newest' }, schema: { type: 'object' } } };

  it("rejects invalid feature defaults, registering none of the pack", () => {
    const hooks = { ears: { entities: { Memo: 'Memo' }, relKinds: {}, roles: {} }, contentWriters: { Memo: {} } };
    const invalid = { ...memos, settings: { defaults: { hidden: true }, schema: {"type":"object","properties":{"hidden":{"type":"string"}},"required":["hidden"],"additionalProperties":false,"$schema":"http://json-schema.org/draft-07/schema#"} } };
    expect(() => registerPack({ id: 'bad-pack', ...hooks, features: { memos: invalid } } as unknown as PackRegistration))
      .toThrow(/defaults/);
    expect(getPackRegistration('bad-pack')).toBeNull();
    expect(_contentWriterRegistry.get('Memo')).toBeUndefined();
    expect(getSettingsCatalog().features).toEqual({});
  });
});

describe('registerPack content writers', () => {
  const memoHooks = { find: () => undefined };

  it('rejects hooks for an entity another pack owns, preserving existing lookups', () => {
    registerPack({ id: 'memo-pack', ears: { entities: { Memo: 'Memo' }, relKinds: {}, roles: {} }, contentWriters: { Memo: memoHooks } } as unknown as PackRegistration);
    registered.push('memo-pack');

    const other = {
      id: 'other-pack',
      ears: { entities: { Card: 'Card' }, relKinds: {}, roles: {} },
      artifacts: [{ type: 'card-view' }],
      contentWriters: { Card: {}, Memo: {} },
    };
    expect(() => registerPack(other as unknown as PackRegistration))
      .toThrow('A content writer for "Memo": only entity types this pack declares');

    expect(getPackRegistration('other-pack')).toBeNull();
    expect(_contentWriterRegistry.get('Memo')).toBe(memoHooks);
    expect(_contentWriterRegistry.get('Card')).toBeUndefined();
    expect(artifactRegistry.has('card-view')).toBe(false);
  });

  it("drops a pack's hooks when it unregisters, freeing the entity for another pack", () => {
    registerPack({ id: 'memo-pack', ears: { entities: { Memo: 'Memo' }, relKinds: {}, roles: {} }, contentWriters: { Memo: memoHooks } } as unknown as PackRegistration);
    unregisterPack('memo-pack');
    expect(_contentWriterRegistry.get('Memo')).toBeUndefined();

    const theirs = {};
    registerPack({ id: 'other-pack', ears: { entities: { Memo: 'Memo' }, relKinds: {}, roles: {} }, contentWriters: { Memo: theirs } } as unknown as PackRegistration);
    registered.push('other-pack');
    expect(_contentWriterRegistry.get('Memo')).toBe(theirs);
  });
});

describe('packContentTargets', () => {
  const origin = (id: string, dependencies?: Record<string, string>) =>
    ({ declarationRevision: 'fixture-revision', id, name: id, version: '1.0.0', dir: `/packs/${id}`, manifest: { id, name: id, version: '1.0.0', dependencies } } as unknown as Parameters<typeof registerPack>[1]);

  // **A pack is writable because it is somewhere.** Its compiled content is files in its directory, which the
  // origin knows and a registration does not, so a pack never has to tell the host where its compiled data
  // is: a registration claiming a `compiledDir` is not enough to be written from.
  it('leaves out a pack with no origin, having nowhere to read content from', () => {
    registerPack({ id: 'nowhere-pack', lifecycle: { onInit() {} } } as unknown as PackRegistration);
    registered.push('nowhere-pack');

    expect(registry.packContentTargets().map((t) => t.manifest.id)).not.toContain('nowhere-pack');
    expect(getPackRegistration('nowhere-pack')?.lifecycle?.onInit).toBeTypeOf('function');
  });

  /**
   * An apply target is where a pack's content are and what it depends on, and nothing else: what an apply leaves
   * alone the applier decides from the rows, so nothing about a pack's content travels on its registration.
   */
  it("carries each pack's own id and directory, whoever ships it", () => {
    registerPack({ id: 'shipped-pack' } as PackRegistration, origin('shipped-pack'));
    registerPack({ id: 'installed-pack' } as PackRegistration, origin('installed-pack'));
    registered.push('shipped-pack', 'installed-pack');

    const targets = registry.packContentTargets();
    expect(targets.find((t) => t.manifest.id === 'shipped-pack'))
      .toEqual({ manifest: { id: 'shipped-pack', dependencies: undefined }, dir: '/packs/shipped-pack' });
    // Nothing in an apply target says which app shipped the pack: every pack's content are read from
    // `runtime/content` under its own directory
    expect(targets.find((t) => t.manifest.id === 'installed-pack'))
      .toEqual({ manifest: { id: 'installed-pack', dependencies: undefined }, dir: '/packs/installed-pack' });
  });

  // The order content run in, so a pack's content can reference what the packs it depends on written
  it('orders a pack after the packs it depends on', () => {
    registerPack({ id: 'base-pack' } as PackRegistration, origin('base-pack'));
    registerPack({ id: 'dependent-pack' } as PackRegistration, origin('dependent-pack', { 'base-pack': '*' }));
    registered.push('base-pack', 'dependent-pack');

    const ids = registry.packContentTargets().map((t) => t.manifest.id);
    expect(ids.indexOf('base-pack')).toBeLessThan(ids.indexOf('dependent-pack'));
  });

  it('narrows to the packs it is given, which is what activating or reloading one content', () => {
    registerPack({ id: 'one-pack' } as PackRegistration, origin('one-pack'));
    registerPack({ id: 'two-pack' } as PackRegistration, origin('two-pack'));
    registered.push('one-pack', 'two-pack');

    expect(registry.packContentTargets(['two-pack']).map((t) => t.manifest.id)).toEqual(['two-pack']);
  });
});


describe('runtime settings admission', () => {
  let admission: ReturnType<typeof createNativePackTestRegistry>;
  beforeEach(() => { admission = createNativePackTestRegistry(); });
  const manifest = { id: 'settings-pack', name: 'Settings', version: '1.0.0', features: { widget: { description: 'Feature declaration fixture.',} } };
  const origin = {
    id: manifest.id, name: manifest.name, version: manifest.version, manifest,
    declarationRevision: 'fixture-revision', dir: '/packs/settings-pack',
  };

  it.each([
    { ...origin, id: 'another-pack' },
    { ...origin, manifest: { ...manifest, id: 'another-pack' } },
  ])('refuses identity disagreement without publishing contributions', (candidate) => {
    const before = admission.settingsCatalog();
    expect(() => admission.registerPack({ id: 'settings-pack', services: { unexpectedService: {} } }, candidate))
      .toThrow('runtime identity does not match');
    expect(admission.settingsCatalog()).toBe(before);
    expect(admission.getRegisteredServices()).not.toHaveProperty('unexpectedService');
  });

  it.each([null, false, 0, ''])('does not treat a falsey feature definition (%s) as absent', (settings) => {
    const before = admission.settingsCatalog();
    const registration = { id: 'settings-pack', features: { widget: { settings } }, services: { unexpectedService: {} } };
    expect(() => admission.registerPack(registration as unknown as PackRegistration, origin))
      .toThrow('runtime settings do not match');
    expect(admission.settingsCatalog()).toBe(before);
    expect(admission.getRegisteredServices()).not.toHaveProperty('unexpectedService');
  });

  it('does not treat null pack groups as an absent declaration', () => {
    const before = admission.settingsCatalog();
    expect(() => admission.registerPack({ id: 'settings-pack', settings: null } as unknown as PackRegistration, origin))
      .toThrow('runtime settings do not match');
    expect(admission.settingsCatalog()).toBe(before);
  });
});


describe('registered settings authority', () => {
  const previousEngine = boundEars();
  beforeEach(() => { _bindEars(_createTestEngine({ entityTypes: ['Settings'] })); });
  afterEach(() => { _bindEars(previousEngine); });

  it('binds the accepted pack and revokes retained access when it unregisters', () => {
    const scoped = vi.fn((id: string) => admin.forPack(id));
    const packs = createNativePackTestRegistry({ settingsForPack: scoped });
    const admin = createSettingsService(createSettingsStore({ ears: boundEars, catalog: packs.settingsCatalog }));
    const generated = _createPackServices();
    const target = { kind: 'feature', featureRef: 'caller-pack/widget' } as const;
    packs.registerPack({ id: 'caller-pack', bindServices: generated.bindServices,
      features: { widget: { settings: { defaults: { count: 1 }, schema: { type: 'object' } } } } });

    const retained = generated.services;
    expect(scoped).toHaveBeenCalledWith('caller-pack');
    expect(generated.services.settings.get(target)).toEqual({ count: 1 });
    generated.services.settings.set(target, ['count'], 2);
    expect(admin.getOverrides()).toEqual({ features: { 'caller-pack/widget': { count: 2 } } });
    packs.unregisterPack('caller-pack');

    expect(() => generated.services.settings.set(target, ['count'], 3)).toThrow('until the host accepts');
    expect(admin.getOverrides()).toEqual({ features: { 'caller-pack/widget': { count: 2 } } });
    expect(() => retained.settings.get(target)).toThrow('revoked');
    packs.registerPack({ id: 'caller-pack', bindServices: generated.bindServices,
      features: { widget: { settings: { defaults: { count: 1 }, schema: { type: 'object' } } } } });
    expect(generated.services === retained).toBe(false);
    expect(generated.services.settings.get(target)).toEqual({ count: 2 });
    expect(() => retained.settings.set(target, ['count'], 3)).toThrow('revoked');
    expect(() => Reflect.has(retained, 'settings')).toThrow('revoked');
    packs.unregisterPack('caller-pack');
  });

  it('enforces dependency and owner policies through the injected runtime service', () => {
    const packs = createNativePackTestRegistry({ settingsForPack: id => admin.forPack(id) });
    const admin = createSettingsService(createSettingsStore({ ears: boundEars, catalog: packs.settingsCatalog }));
    const generated = _createPackServices();
    const definition = { defaults: { count: 1 }, schema: { type: 'object' } };
    packs.registerPack({ id: 'owner-pack', settings: {
      shared: definition,
      private: { ...definition, access: 'owner' },
    } });
    packs.registerPack({ id: 'consumer-pack', dependencies: { 'owner-pack': '*' }, bindServices: generated.bindServices });
    const shared = { kind: 'pack', packId: 'owner-pack', groupId: 'shared' } as const;
    const restricted = { kind: 'pack', packId: 'owner-pack', groupId: 'private' } as const;

    expect(generated.services.settings.get(restricted)).toEqual({ count: 1 });
    generated.services.settings.set(shared, ['count'], 2);
    expect(generated.services.settings.get(shared)).toEqual({ count: 2 });
    generated.services.settings.reset(shared);
    expect(generated.services.settings.get(shared)).toEqual({ count: 1 });
    expect(() => generated.services.settings.set(restricted, ['count'], 2)).toThrow('Only pack "owner-pack"');
    expect(() => generated.services.settings.reset(restricted)).toThrow('Only pack "owner-pack"');
    expect(admin.getOverrides().packs?.['owner-pack']).not.toHaveProperty('private');
  });

  it('does not supply authority to a refused registration', () => {
    const scoped = vi.fn();
    const bindServices = vi.fn();
    const packs = createNativePackTestRegistry({ settingsForPack: scoped });
    expect(() => packs.registerPack({ id: 'refused-pack', services: { settings: {} }, bindServices }))
      .toThrow('Service collision');
    expect(scoped).not.toHaveBeenCalled();
    expect(bindServices).not.toHaveBeenCalled();
  });

  it('revokes injected authority if catalog publication refuses the declaration', () => {
    const packs = createNativePackTestRegistry({ settingsForPack: id => admin.forPack(id) });
    const admin = createSettingsService(createSettingsStore({ ears: boundEars, catalog: packs.settingsCatalog }));
    const generated = _createPackServices();
    expect(() => packs.registerPack({ id: 'invalid-pack', bindServices: generated.bindServices,
      features: { widget: { settings: { defaults: { count: 'bad' }, schema: { type: 'object', properties: { count: { type: 'number' } } } } } } }))
      .toThrow();
    expect(() => generated.services.settings.get({ kind: 'app' })).toThrow('until the host accepts');
    expect(packs.settingsCatalog().features).not.toHaveProperty('invalid-pack/widget');
  });
});
