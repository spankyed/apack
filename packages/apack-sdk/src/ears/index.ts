/**
 * The app's engine, and the engine operations pack code calls without holding one. `@elmdb/ears` keeps no
 * engine of its own: an operation there is a member of the engine you hold (`engine.create(...)`). Here, the
 * engine is the one this process bound — the app's (`bindHost`), a test's (`startTestRuntime`) or a tool's
 * (`_bindEars`) — and each function acts on it, throwing naming how to bind one when none is.
 *
 * A pack's typed operations are its `#generated/ears`, which binds `defineEars` to `boundEars`. The `untyped*`
 * functions here are their unchecked twins; the rest have no typed form.
 *
 * It is also all of `@elmdb/ears`, re-exported: a pack depends on the SDK alone and names EARS through here.
 *
 * @packageDocumentation
 */
import type { CallSiteNaming, Create, Ears, Query, Upsert, Write } from '@elmdb/ears';

// All of EARS, so that a pack names apack's SDK alone and loads the EARS that SDK was built with. A pack's facade
// writes any EARS type it infers from here (`EARS_THROUGH_SDK`, `@apackdev/host/build/shared-deps`), which holds only
// while this is `export *`: a name EARS exports and this entry doesn't would be a facade naming nothing
export * from '@elmdb/ears';

let bound: Ears | undefined;

/** The error an engine use with none bound throws */
export const NO_ENGINE_BOUND =
  'No EARS engine is bound: the app binds its engine when it starts (bindHost from @apackdev/sdk/runtime), ' +
  'unit tests with startTestRuntime() from @apackdev/sdk/testing, and tooling with _bindEars(engine)';

/**
 * Makes `engine` the one this process's engine operations act on, or none with `undefined`; returns the one it
 * replaced, so a tool can put it back. Host-only: the app binds its engine through `bindHost`.
 *
 * @internal
 */
export function _bindEars(engine: Ears | undefined): Ears | undefined {
  const previous = bound;
  bound = engine;
  return previous;
}

/**
 * How apack's engines name a call's site (`createEarsEngine`'s `callSites`): EARS' frames by its package's paths, since
 * the development app's API bundles it, and a path cut where two checkouts' or two data directories' paths stop differing.
 *
 * @internal
 */
export const _EARS_CALL_SITES: CallSiteNaming = {
  engineFrames: /\/(?:packages\/ears|@elmdb\/ears)\/(?:src|dist)\//,
  roots: ['/packages/', '/node_modules/', '/packs/'],
};

/** The engine this process bound; throws when none is */
export function boundEars(): Ears {
  if (!bound) throw new Error(NO_ENGINE_BOUND);
  return bound;
}

/** `name` on the bound engine, typed as the engine's member */
const onBound = <K extends keyof Ears>(name: K) =>
  ((...args: unknown[]) => (boundEars()[name] as (...a: unknown[]) => unknown)(...args)) as unknown as Ears[K];

/**
 * The unchecked query entry points on the bound engine: `untypedQuery(type)`, `.ids(ids)`, `.all()`, which reach no
 * entity in the trash, `.withTrashed` reaching those too, and `.trashed` only those
 */
export const untypedQuery: Query = Object.assign(
  ((start: unknown) => boundEars().query(start as never)) as unknown as Query,
  {
    ids: ((ids) => boundEars().query.ids(ids)) as Query['ids'],
    all: (() => boundEars().query.all()) as Query['all'],
    withTrashed: Object.assign(
      ((start: unknown) => boundEars().query.withTrashed(start as never)) as unknown as Query['withTrashed'],
      {
        ids: ((ids) => boundEars().query.withTrashed.ids(ids)) as Query['ids'],
        all: (() => boundEars().query.withTrashed.all()) as Query['all'],
      },
    ),
    trashed: Object.assign(
      ((start: unknown) => boundEars().query.trashed(start as never)) as unknown as Query['trashed'],
      {
        ids: ((ids) => boundEars().query.trashed.ids(ids)) as Query['ids'],
        all: (() => boundEars().query.trashed.all()) as Query['all'],
      },
    ),
  },
);
/** `create` on the bound engine, unchecked against any pack's shapes */
export const untypedCreate: Create = onBound('create');
/** `upsert` on the bound engine, unchecked against any pack's shapes */
export const untypedUpsert: Upsert = onBound('upsert');
/** `write` on the bound engine, unchecked against any pack's shapes */
export const untypedWrite: Write = onBound('write');

export const transact = onBound('transact');
export const isEntityType = onBound('isEntityType');
export const getRelation = onBound('getRelation');
export const findRelations = onBound('findRelations');
export const updateRelation = onBound('updateRelation');
export const removeRelation = onBound('removeRelation');
export const getRow = onBound('getRow');
export const getRoles = onBound('getRoles');
export const catalog = onBound('catalog');
export const getSchemaStats = onBound('getSchemaStats');
export const nextLabel = onBound('nextLabel');
export const wouldCreateCycle = onBound('wouldCreateCycle');
