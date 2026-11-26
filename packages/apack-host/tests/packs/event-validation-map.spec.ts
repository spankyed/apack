import { createNativePackTestRegistry } from '@apackdev/host/testing';
// What bus.send accepts: each registered system's incoming events, kept current by registration itself.
import { describe, expect, it } from 'vitest';
import { state } from '@apackdev/state';
import { SYSTEM_EVENT_TYPES } from '@apackdev/sdk/framework';
import type { PackFeature } from '@apackdev/sdk/framework';
import { hostRegistration } from '../../src/features/registration.ts';
import { PACKS_SURFACE_EVENT_TYPES } from '../../src/features/event-contracts.ts';
import { HOST_SYSTEM_EVENT_TYPES, SURFACE_EVENT_TYPES } from '@apackdev/sdk/events';

/** The events a pack's surface receives: what its pack declares, and what the app sends every surface */
const receives = (...types: string[]) => new Set([...types, ...SURFACE_EVENT_TYPES]);

const { getEventValidationMap, registerPack, unregisterPack } = createNativePackTestRegistry();

const machine = state()({});

/** A feature with a surface that receives `types` */
const surface = (types: string[] = []): PackFeature => ({ surface: { receives: types } });

describe('getEventValidationMap', () => {
  it('follows packs registering and unregistering, with no manual invalidation', () => {
    // Cached before the change
    expect(getEventValidationMap().has('validation-pack/feature')).toBe(false);

    registerPack({ id: 'validation-pack', features: { feature: { system: { machine, receives: ['PING'] } } } });
    expect(getEventValidationMap().get('validation-pack/feature')).toEqual(new Set(['PING', ...SYSTEM_EVENT_TYPES]));

    unregisterPack('validation-pack');
    expect(getEventValidationMap().has('validation-pack/feature')).toBe(false);
  });

  // The registry makes every ref `<packId>/<featureId>`, so a feature id naming another pack's feature is refused
  it('refuses a feature id that is not one segment', () => {
    expect(() => registerPack({ id: 'stray-pack', features: { 'other-pack/logs': { system: { machine, receives: [] } } } }))
      .toThrow(/Invalid native declarations:.*features.other-pack\/logs/);
  });

  // The host is a pack like any other: its features' systems are checked the same way — and one of them is also
  // named in `HOST_SYSTEM_EVENT_TYPES`, so its entry is the union of the two. `HELLO` here is what the system itself
  // declares, which the map set over rather than merged into: the sends packs may make reached it and nothing else did.
  it("lists the host's systems once it registers", () => {
    expect(getEventValidationMap().has('host/application')).toBe(false);
    registerPack(hostRegistration({ application: { machine, receives: ['HELLO'] } }));
    expect(getEventValidationMap().get('host/application'))
      .toEqual(new Set(['HELLO', ...SYSTEM_EVENT_TYPES, ...HOST_SYSTEM_EVENT_TYPES['host/application']]));
    // The bus is no feature's system, so its entry is only what packs may send it
    expect(getEventValidationMap().get('host/bus')).toEqual(new Set(HOST_SYSTEM_EVENT_TYPES['host/bus']));
    unregisterPack('host');
  });
});

describe('getSurfaceEventValidationMap', () => {
  const registry = createNativePackTestRegistry();

  it('follows packs registering and unregistering, with no manual invalidation', () => {
    expect(registry.getSurfaceEventValidationMap().has('memo-pack/memos')).toBe(false);

    registry.registerPack({ id: 'memo-pack', features: { memos: surface(['MEMO_ADDED', 'MEMOS_CONNECTED']) } });
    expect(registry.getSurfaceEventValidationMap().get('memo-pack/memos')).toEqual(receives('MEMO_ADDED', 'MEMOS_CONNECTED'));

    registry.unregisterPack('memo-pack');
    expect(registry.getSurfaceEventValidationMap().has('memo-pack/memos')).toBe(false);
  });

  it('leaves a feature without a surface absent, so a send to it is caught', () => {
    registry.registerPack({ id: 'silent-pack', features: { silent: { system: { machine, receives: [] } } } });
    expect(registry.getSurfaceEventValidationMap().has('silent-pack/silent')).toBe(false);
    registry.unregisterPack('silent-pack');
  });

  // A surface its pack's systems send nothing to gets only the app's events: any other send there is a mistake
  it('gives a surface with no declared events only the app\'s', () => {
    registry.registerPack({ id: 'quiet-pack', features: { quiet: surface() } });
    expect(registry.getSurfaceEventValidationMap().get('quiet-pack/quiet')).toEqual(receives());
    registry.unregisterPack('quiet-pack');
  });
});

describe('a pack cannot widen a surface it does not own', () => {
  // A pack names its own features, and the host is the pack `host`, so `application` in a manifest is this
  // pack's `application` feature and never the host's surface.
  it("cannot add event types to the host's surface, because a pack's feature is under its own pack", () => {
    const registry = createNativePackTestRegistry();
    const host = registry.getSurfaceEventValidationMap().get('host/application');

    registry.registerPack({ id: 'impostor-pack', features: { application: surface(['ANYTHING']) } });

    expect(registry.getSurfaceEventValidationMap().get('host/application')).toEqual(host);
    expect(registry.getSurfaceEventValidationMap().get('impostor-pack/application')).toEqual(receives('ANYTHING'));
  });

  // Each pack's surface has its own address, so neither can widen or shadow the other's contract
  it("gives a second pack naming the same feature its own entry, leaving the first's", () => {
    const registry = createNativePackTestRegistry();
    registry.registerPack({ id: 'first-pack', features: { memos: surface(['MEMO_ADDED']) } });
    registry.registerPack({ id: 'second-pack', features: { memos: surface(['HIJACKED']) } });

    expect(registry.getSurfaceEventValidationMap().get('first-pack/memos')).toEqual(receives('MEMO_ADDED'));
    expect(registry.getSurfaceEventValidationMap().get('second-pack/memos')).toEqual(receives('HIJACKED'));
  });
});

describe('native fixture admission', () => {
  it('publishes declarations before binding surfaces, independently of runtime validation maps', () => {
    const registry = createNativePackTestRegistry();
    let seen: Set<string> | undefined = 'unset' as never;
    const stop = registry.onCatalogChanged(() => {
      expect(registry.settingsCatalog().features['memo-pack/memos']).toBeDefined();
      seen = registry.getSurfaceEventValidationMap().get('memo-pack/memos');
    });
    registry.registerPack({
      id: 'memo-pack',
      features: { memos: { ...surface(['MEMO_ADDED']), settings: { defaults: { sort: 'newest' }, schema: { type: 'object' } } } },
    });
    stop();
    expect(seen).toBeUndefined();
    expect(registry.getSurfaceEventValidationMap().get('memo-pack/memos')).toEqual(receives('MEMO_ADDED'));
  });

  // The rollback has to take it back out again, or a refused pack stays listed
  it('is unlisted again when its extensions are refused', () => {
    const registry = createNativePackTestRegistry();
    // Two appliers for one key: refused before registering any contribution
    expect(() => registry.registerPack({
      id: 'clumsy-pack',
      features: { memos: surface(['MEMO_ADDED']) },
      appliers: [{ key: 'notes' } as never, { key: 'notes' } as never],
    })).toThrow('runtime appliers does not match its admitted declarations');
    expect(registry.getSurfaceEventValidationMap().has('clumsy-pack/memos')).toBe(false);
    expect(registry.getRegisteredPackSystemIds('clumsy-pack')).toEqual([]);
  });
});

describe('a host surface', () => {
  it('is checked with the event types its registration declares', () => {
    const registry = createNativePackTestRegistry();
    registry.registerPack(hostRegistration());
    expect(registry.getSurfaceEventValidationMap().get('host/packs')).toEqual(receives(...PACKS_SURFACE_EVENT_TYPES));
    expect(registry.getSurfaceEventValidationMap().get('host/application')).toEqual(receives('CLIENT_CONNECTED', 'APPLICATION_HOTKEYS', 'SURFACE_VISIBILITY_UPDATED', 'COMMANDS_UPDATED', 'ONBOARDING_COMPLETE', 'OPEN_SURFACE', 'PACK_RUNTIMES_UPDATED'));
  });

  // The host is the pack `host`, so a pack with a `packs` feature of its own is not a contest
  it("keeps its ref whatever a pack names its own feature", () => {
    const registry = createNativePackTestRegistry();
    registry.registerPack({ id: 'owner-pack', features: { packs: surface(['NOT_THE_HOSTS']) } });
    registry.registerPack(hostRegistration());
    expect(registry.getSurfaceEventValidationMap().get('host/packs')).toEqual(receives(...PACKS_SURFACE_EVENT_TYPES));
    expect(registry.getSurfaceEventValidationMap().get('owner-pack/packs')).toEqual(receives('NOT_THE_HOSTS'));
  });
});
