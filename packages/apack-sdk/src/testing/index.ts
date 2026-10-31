import type { SettingsAdmin } from '../services/settings.ts';
// The runtime a pack's unit tests run against: the EARS engine on a database in a temporary directory, without the app.
// @apackdev/testing's harness drives it; it lives in the SDK so tests share the pack's SDK instance
// (its query, repository and content-writer registries) instead of a copy.
import { createEarsEngine, type CallCounting, type EarsDatabase, type EarsEngine, type EngineSchema, type RelationRules, type RowRules } from '@apackdev/ears';
import { createTestDatabases } from './databases.ts';
import { _bindEars } from '../ears/index.ts';
import type { ContentRuntime } from '../framework/content-runtime.ts';
export { nativePackDeclarationFixture } from './pack-declaration.ts';
import { SDK_ENTITIES, SDK_REL_KINDS, SDK_RELATION_RULES, SDK_ROW_RULES, SDK_ROLES, _withSdkIndexes } from '../types/sdk-entities.ts';
import type { EARS } from '../types/entities.ts';
import type { PackRegistryView } from '../runtime/packs-view.ts';
import { _isHostBound } from '../runtime/host-runtime.ts';
import { testPacks } from './packs.ts';
import { bindTestRuntime, resetTestHostState } from './host.ts';
import type { OnboardingService } from '../services/onboarding.ts';

export { testRootEvents, testRunHistory, takeSystemErrors, addTestSecret, type TestRootEvents } from './host.ts';
export { _openTestRunHistory } from './run-history.ts';
export { testPacks, type TestPacks } from './packs.ts';
export { fakeInference, type FakeInference, type FakeInferenceCall, type FakeInferenceReplies, type FakeInferenceReply, type FakeTextCall } from './fake-inference.ts';
// A pack's own tests bind a frontend host for the file and forget it again; bindFeHost is the renderer's,
// bound once at boot, and its unbind is host-only
export { startFeTestRuntime, stopFeTestRuntime, type FeTestRuntimeOptions } from './fe-runtime.ts';
export { fakeSettings, type FakeSettings, type FakeSettingsUpdate } from './fake-settings.ts';
// What a delivery door puts on an answer, for a spec that drives a machine with no door in front of it
export { answerTo } from './answers.ts';

/** What `startTestRuntime` starts the test app with */
export interface TestRuntimeStartOptions {
  /** Entity types beyond the SDK's; later calls add theirs */
  entityTypes?: readonly string[];
  /** Relation kinds beyond the SDK's; later calls add theirs */
  relationKinds?: readonly string[];
  /** Roles beyond the SDK's; later calls add theirs */
  roles?: readonly string[];
  /** What each entity type's created row is held to, beyond the SDK's; later calls add theirs */
  rowRules?: Readonly<Record<string, RowRules>>;
  /** What each relation kind's edges are held to, beyond the SDK's; later calls add theirs */
  relationRules?: Readonly<Record<string, RelationRules>>;
  /**
   * The registered packs the SDK's lookups read (the harness passes the registry it creates), under `testPacks`, which
   * tests fill directly; none by default. First call only
   */
  packs?: PackRegistryView;
  /** What `getAppVersion()` returns; `0.0.0-test` by default. First call only */
  appVersion?: string;
  /**
   * Where `onboarding.isComplete` and `complete` keep their state (the harness passes the host's app state);
   * in memory by default. First call only
   */
  onboarding?: OnboardingService;
  /**
   * Backs `services.settings` (the harness passes the host's settings store, so a test writes settings the way the
   * app does); without one, reading or writing settings says to run on the harness. First call only
   */
  settings?: SettingsAdmin;
  /** Per-test replacements for native host ports, read from this runtime's map. First call only. */
  serviceOverrides?: ReadonlyMap<string, unknown>;
}

const entityTypes = new Set<string>(Object.values(SDK_ENTITIES));
const relationKinds = new Set<string>(Object.values(SDK_REL_KINDS));
const roles = new Set<string>(Object.values(SDK_ROLES));
const rowRules = new Map<string, RowRules>(Object.entries(SDK_ROW_RULES));
const relationRules = new Map<string, RelationRules>(Object.entries(SDK_RELATION_RULES));
let started: Pick<TestRuntimeStartOptions, 'packs' | 'appVersion' | 'onboarding' | 'settings' | 'serviceOverrides'> | undefined;
let engine: EarsEngine | undefined;
let disposeDatabase: (() => void) | undefined;
/** The process's test databases, each removed when it is replaced or the process exits */
const databases = createTestDatabases();

/** The test runtime's names, each with its rules, as the database's schema */
const testSchema = (): EngineSchema => ({
  types: Object.fromEntries([...entityTypes].map((type) => [type, _withSdkIndexes(rowRules.get(type))])),
  relations: Object.fromEntries([...relationKinds].map((kind) => [kind, relationRules.get(kind) ?? {}])),
  roles: [...roles],
});

/** A new engine on a new database holding the test runtime's names, and installed */
function installFreshEngine(): EarsEngine {
  disposeDatabase?.();
  const { database, dispose } = databases.open(testSchema());
  disposeDatabase = dispose;
  // Every value a read gives back is frozen: code that changes one, expecting the database to change, throws here
  // rather than silently not persisting in the app
  engine = createEarsEngine({ database, freeze: true });
  _bindEars(engine);
  return engine;
}

/**
 * @internal A new database in a temporary directory of its own, apart from the test runtime's, and an engine over it:
 * the SDK's entity types, relation kinds and roles plus those given, a type held only to the rules given. For host
 * specs that build an engine of their own
 */
export function _openTestDatabase({ entityTypes: types = [], relationKinds: kinds = [], roles: given = [], rowRules: rules = {} }: Pick<TestRuntimeStartOptions, 'entityTypes' | 'relationKinds' | 'roles' | 'rowRules'> = {}): { database: EarsDatabase; engine: EarsEngine } {
  const { database } = databases.open({
    types: Object.fromEntries([...Object.values(SDK_ENTITIES), ...types].map((type) => [type, _withSdkIndexes(rules[type])])),
    relations: Object.fromEntries([...Object.values(SDK_REL_KINDS), ...kinds].map((kind) => [kind, SDK_RELATION_RULES[kind] ?? {}])),
    roles: [...Object.values(SDK_ROLES), ...given],
  });
  return { database, engine: createEarsEngine({ database }) };
}

/** @internal `_openTestDatabase`'s engine */
export const _createTestEngine = (options: Parameters<typeof _openTestDatabase>[0] = {}): EarsEngine => _openTestDatabase(options).engine;

/** The test runtime's engine (both faces); throws before `startTestRuntime` */
function testEngine(): EarsEngine {
  if (!engine) throw new Error('No test engine: call startTestRuntime() from @apackdev/sdk/testing first');
  return engine;
}

/**
 * Starts the test runtime: an EARS engine (created and installed) on a database in a temporary directory, removed as the
 * process exits, with the SDK's entity types plus `entityTypes`, relation kinds plus `relationKinds` and roles plus
 * `roles`, and binds a test app (`bindHost`): `testRootEvents` as its bus (so `broadcastToSurface`, `sendToSystem`, `onIncoming` and
 * log events go there; its log events are printed and its SYSTEM_ERROR events recorded for `takeSystemErrors`),
 * `testPacks` over `packs`, `appVersion`, an `appData` that resets the database and keeps onboarding in `onboarding`, a run history in memory
 * over it, `secrets` in memory, and an `inference` that fails until a test mocks it. Safe to call again; entity types
 * accumulate, and `packs`, `appVersion` and `onboarding` must be given on the first call.
 */
export function startTestRuntime(options: TestRuntimeStartOptions = {}): void {
  for (const type of options.entityTypes ?? []) entityTypes.add(type);
  for (const kind of options.relationKinds ?? []) relationKinds.add(kind);
  for (const role of options.roles ?? []) roles.add(role);
  for (const [type, rules] of Object.entries(options.rowRules ?? {})) rowRules.set(type, rules);
  for (const [kind, rules] of Object.entries(options.relationRules ?? {})) relationRules.set(kind, rules);
  if (started) {
    // The names added since are held to as the app holds them
    engine?.admin.setSchema(testSchema());
    for (const key of ['packs', 'appVersion', 'onboarding', 'serviceOverrides'] as const) {
      if (options[key] !== undefined && options[key] !== started[key]) {
        throw new Error(`startTestRuntime already bound the test app without this ${key}: pass ${key} on its first call`);
      }
    }
    // Still bound: nothing to start. Unbound since (a test unbound the host): bound again, as first started
    if (_isHostBound()) return;
  } else {
    started = { packs: options.packs, appVersion: options.appVersion, onboarding: options.onboarding, settings: options.settings, serviceOverrides: options.serviceOverrides };
  }
  installFreshEngine();
  bindTestRuntime({ engine: testEngine, resetData: resetTestData, ...started });
}

/** Registers a pack's content runtime: its entity types, and its repositories and content writers (in `testPacks`) */
export function registerContentRuntime(runtime: ContentRuntime): void {
  startTestRuntime({ entityTypes: Object.values(runtime.entities), relationKinds: Object.values(runtime.relKinds), roles: Object.values(runtime.roles), rowRules: runtime.rowRules, relationRules: runtime.relationRules });
  for (const [name, repo] of Object.entries(runtime.repositories)) testPacks.repositories.set(name, repo);
  for (const [entity, hooks] of Object.entries(runtime.contentWriters)) testPacks.contentWriters.set(entity, hooks);
}

/**
 * Replaces the database with a fresh one and its engine, and empties the stored keys and the onboarding state
 * (registrations, repositories among them, stay)
 */
export function resetTestData(): void {
  installFreshEngine();
  resetTestHostState();
}

/** Every entity id in the test database, those in the trash included */
export function entityIds(): EARS.EntityId[] {
  return testEngine().admin.getAllEntities();
}

/**
 * Counting the test engine's calls to its database, as a development app counts its own (`EarsAdmin.calls`): what a
 * spec asserts a read costs in crossings. The engine `resetTestData` installs counts from nothing
 */
export function testCalls(): CallCounting {
  return testEngine().admin.calls;
}

/** Removes an attribute from a row, as data written before the attribute existed would lack it */
export function dropAttribute(id: EARS.EntityId, kind: string): void {
  testEngine().admin.deleteAttr(id, kind as EARS.AttrKind);
}

/** The subject a check asserted over, confirmed to be there — see its own doc comment for the rule */
export { population } from './population.ts';

export { nativeFrontendDeclarationFixture } from './frontend-declaration.ts';
