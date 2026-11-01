import type { AppMigrationTarget, PackMigrationTarget } from '../migrations/index.ts';
import { captureData } from './captured-data.ts';
import type { StepBackendBinding } from '@apackdev/sdk/steps';
import type { DeclarationData } from '@apackdev/sdk/framework';
import type { StepEntry } from '@apackdev/sdk/build';
import { captureStepBinding, captureStepDeclaration } from './step-bindings.ts';
import { lifecycleBindingProblem } from './lifecycle-binding.ts';
import { _packEntityTypes, _packRelationTypes, _packRoles, _shortCodeTypes } from '@apackdev/sdk/framework';
import { apiBindingProblem, backendBindingProblem, backendContentBindingProblem, backendViewerBindingProblem, backendStepBindingProblem, contentBindingProblem, migrationBindingProblem } from './declaration-binding.ts';
import { eventBindingProblem } from './event-binding.ts';
import { SYSTEM_EVENT_TYPES, type PackEventContracts } from '@apackdev/sdk/framework';
/**
 * Pack Registration
 *
 * The registered packs, as an instance: the app's composition root, the test harness and the CLI each create one.
 * It holds what packs contributed and the only writes to it (register, unregister), and implements the read-only
 * view the SDK's lookups read once it's bound (`HostRuntime.packs`).
 */

import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { AnyStateMachine } from 'xstate';
import type { RelationRules, RowRules } from '@apackdev/ears';
import type { PackRegistration, PackLifecycleHooks, PackEARS, PackMigration, PackFeature, PackFeatureSystem } from '@apackdev/sdk/framework';
import { _packDeclarationProblem, type ContentRuntime } from '@apackdev/sdk/framework';
import type { MigrationLine, PackManifest } from '@apackdev/sdk/build';
import type { PackRegistryView } from '@apackdev/sdk/runtime';
import type { SettingsService } from '@apackdev/sdk/services';
import { _HOST_SERVICE_NAMES, _packServiceSelection } from '@apackdev/sdk/framework';
import { assertPackServiceRequirements, packServiceDeclaration, type PackServiceOwner } from './service-requirements.ts';
import type { ContentOffer, ContentApplier } from '@apackdev/sdk/utils';
import type { ArtifactDefinition } from '@apackdev/sdk/artifacts';
import type { BlockDefinition } from '@apackdev/sdk/blocks';
import { SDK_ENTITIES, SDK_REL_KINDS, SDK_RELATION_RULES, SDK_ROW_RULES, SDK_ROLES, SDK_SHORT_CODES, _reservedEntries } from '@apackdev/sdk/types';
import { HOST_SYSTEM_EVENT_TYPES, SURFACE_EVENT_TYPES } from '@apackdev/sdk/events';
import { HOST_PACK_ID, resolveName, type FeatureRef } from '@apackdev/sdk/ids';
import { HOST_ENTITY_TYPES } from '../app-state/index.ts';
import { readInstalledPackBuilds, packContentOrder } from './discovery.ts';
import type { PackContentTarget } from './runtime/apply.ts';
import { createOwnedStepStore, createDesignationStore } from './extensions.ts';
import { createContentWriterStore, createApplierStore, createShutdownHooks } from './backend-extensions.ts';
import { checkFeatureIds } from './feature-ids.ts';
import { readAppPackSources } from './app-sources.ts';
import { createContributionCatalog, type ContributionCatalog, type PackCatalogProblem, type PackCatalogSource } from './catalog.ts';
import { disabledPackIds } from './installed.ts';
import { appSettingsDefinition } from '../features/settings/be/app-definition.ts';
import { createPackServiceBinding } from './service-binding.ts';

export type { PackRegistration, PackLifecycleHooks, PackEARS, PackMigration };

/** Entity types no pack may declare: the SDK's and the host's */
const RESERVED_ENTITIES: readonly string[] = [...Object.values(SDK_ENTITIES), ...HOST_ENTITY_TYPES] as const;
/** The app's own EARS names, as a manifest writes them, which no pack may use as a key or a value */
const appEARS = (): PackEARS => ({
  entities: { ...SDK_ENTITIES, ...Object.fromEntries(HOST_ENTITY_TYPES.map((type) => [type, type])) },
  relKinds: SDK_REL_KINDS,
  roles: SDK_ROLES,
});

/** A registration's features, each with the ref it runs at, `<packId>/<featureId>` */
function featuresOf({ id, features = {} }: PackRegistration): Array<{ featureId: string; ref: FeatureRef; feature: PackFeature }> {
  return Object.entries(features).map(([featureId, feature]) => ({ featureId, ref: resolveName(featureId, id), feature }));
}

/** A registration's systems at their refs; `early` ones too, which the app starts itself, outside the bus */
function systemsOf(reg: PackRegistration): Array<{ ref: FeatureRef; system: PackFeatureSystem }> {
  return featuresOf(reg).flatMap(({ ref, feature }) => (feature.system ? [{ ref, system: feature.system }] : []));
}

/** The refs of the systems the bus runs for a registration, before or after it registers */
export function packSystemIds(reg: PackRegistration): FeatureRef[] {
  return systemsOf(reg).map(({ ref }) => ref);
}

/** Role → the ref of the feature playing it: its system and its surface share it */
function designationsOf(reg: PackRegistration): Record<string, FeatureRef> {
  return Object.fromEntries(featuresOf(reg).flatMap(({ ref, feature }) => (feature.designation ? [[feature.designation, ref]] : [])));
}

/** What the app lists of a pack's feature (the Packs surface shows it) */
export interface PackFeatureSummary {
  id: string;
  description: string;
  designation?: string;
  hasSystem: boolean;
  surface?: import('@apackdev/sdk/framework').SurfaceDeclaration;
  references?: import('@apackdev/sdk/framework').ReferenceDeclarations;
  services: readonly string[];
}

export interface PackExtensions {
  systems: string[];
  services: string[];
  steps: string[];
  artifacts: string[];
  blocks: string[];
  relKinds: Record<string, string>;
  roles: Record<string, string>;
  migrationCount: number;
  lifecycleHooks: string[];
  features: PackFeatureSummary[];
}

/** An available app default; neither an installed build nor an active owner. */
export interface AppPackSourceSummary {
  id: string;
  name: string;
  version: string;
  sourceRevision: string;
}

export interface InstalledPackSummary extends PackExtensions {
  id: string;
  name: string;
  /** Absent when this installed build has no accepted declarations. */
  version?: string;
  enabled: boolean;
  /** Installation ownership determines automatic updates; advertisement never grants privileges. */
  updatesWith: 'app' | 'user';
  entityCount: number;
  /** Whether the pack has frontend code: its `runtime/fe.js` */
  hasFrontend: boolean;
  hostVersion?: string;
  description?: string;
  entities: Record<string, string>;
  relKinds: Record<string, string>;
  roles: Record<string, string>;
  permissions: string[];
  dir?: string;
  installedAt?: string;
  installedFrom?: string;
  availableVersion?: string;
  /** A selected app-managed source update; independent of remote release checks. */
  appUpdate?: AppPackSourceSummary;
  appSourceProblem?: string;
  /** Why the last update check couldn't finish or confirm compatibility */
  updateCheckError?: string;
  /** Why this installed pack isn't running although it is enabled: the app skipped it or failed to load it */
  loadProblem?: string;
  /**
   * The decisions the last apply left the user about this pack's content, in the order the view draws them.
   *
   * It is derived from the pack's `AppliedContent` on every list rather than kept anywhere else, so the
   * answer is whatever the record holds now: a pack applied between two lists simply lists differently.
   */
  contentOffers: PackContentOffer[];
  /**
   * The items the user kept their own version of, which is where "reset to factory" is offered.
   *
   * It is the items carrying a `dismissed` hash, so it is **the ones we know about** rather than every item
   * the user has ever edited: an edit under a `theirs` entry is recorded nowhere, by design, and an unresolved offer
   * is in `contentOffers` instead. Restoring one is the same call as taking an offered version — one item,
   * written over — differing only in what prompted it.
   */
  contentKept: Array<{ key: string; label: string }>;
}

/**
 * One decision about one content item, as the Packs view draws it: what the item is, which parts moved, and
 * which kind of decision it is (`ContentOffer`).
 *
 * `label` is the item rendered from its own key (`describeContentKey`), because the key already holds the
 * entity type and the identity that names it — nothing has to be stored beside it to say what an item is.
 */
export interface PackContentOffer extends ContentOffer {
  /** The content key, which is what resolving it names */
  key: string;
  label: string;
}

/** What a surface's sends are checked against: the event types it receives */
export type SurfaceEventTypes = Set<string>;

/**
 * Where the app found a pack, and what the pack says it is. The registration says what a pack contributes;
 * this says where it came from, which only the app knows — `apack.json` is not something a pack's own
 * generated registration can see, and a built-in pack has no install directory of its own to report.
 *
 * It is a second argument to `registerPack` rather than a field on `PackRegistration` because that type is
 * the pack contract: `generate-entries` writes it into every pack and `etc/framework.api.md` pins it.
 */
export interface PackOrigin {
  id: string;
  /** The declarations validated for this active runtime, retained across filesystem changes. */
  declarationRevision: string;
  /** Verified installed file identity; absent only for native registrations supplied by the host. */
  buildRevision?: string;
  /** File membership/checksums admitted with this runtime, never reconstructed from changed disk bytes. */
  buildFiles?: Readonly<Record<string, string>>;
  eventContracts?: Readonly<PackEventContracts>;
  name: string;
  version: string;
  /** Where the pack's files are: `packs/<id>`, for every pack */
  dir: string;
  /** The pack's `apack.json`, which its loader read to find the pack at all */
  manifest?: PackManifest;
}

/** The registered packs, the host's own (`hostRegistration`) among them, and their shutdown hooks */
/** Runtime coordinators retain incumbent bindings until their actors finish stopping. */
export interface PackReplacementOptions {
  retireBinding(dispose: () => string[]): void;
}

export interface PackRegistry extends PackRegistryView {
  readonly catalog: ContributionCatalog;
  refreshCatalog(packsDir?: string, disabled?: ReadonlySet<string>): void;
  /** Registers a pack; throws on a collision, registering none of it */
  registerPack(pack: PackRegistration, origin?: PackOrigin): void;
  /** Replace an accepted runtime atomically; returns retirement errors after a successful commit. */
  replacePack(pack: PackRegistration, origin?: PackOrigin, options?: PackReplacementOptions): string[];
  /** Bind data operations without activating backend systems or services. */
  registerContentRuntime(runtime: ContentRuntime, origin: PackOrigin, appliers?: ContentApplier[]): void;
  unregisterPack(packId: string): void;
  /**
   * Hears a pack registering, being replaced or unregistering, once the change has committed: what its code is now
   * is what `getPackRegistration` answers by then. Returns the unsubscribe.
   */
  onRegistrationChanged(listener: (packId: string) => void): () => void;
  /** Wait for declared indexes before lifecycle hooks, migrations or actors read them. */
  indexesReady(packId?: string): Promise<void>;
  /**
   * Notes why an installed pack isn't running: the loader skipped it, or its registration was refused. The Packs
   * view shows it in place of the pack's enabled state. Cleared when the pack registers or is torn down.
   */
  recordLoadProblem(packId: string, problem: string): void;
  /** Why an installed pack failed to load, while it hasn't since registered or been torn down */
  loadProblem(packId: string): string | undefined;
  clearLoadProblem(packId: string): void;
  /**
   * Claims a pack id, or an install's source, for one operation: install, update, restore, uninstall, enable
   * or disable, reload, or a development install. False when another operation holds it, so the copy of a
   * pack's files and the load of its runtime never overlap. Release with `releasePackOperation`.
   */
  claimPackOperation(key: string): boolean;
  releasePackOperation(key: string): void;
  /**
   * Claims every pack at once, for replacing the app's data (a reset or a backup import). False while any
   * operation holds a pack; while held, `claimPackOperation` refuses every key. Release with
   * `releaseAllPackOperations`.
   */
  claimAllPackOperations(): boolean;
  releaseAllPackOperations(): void;
  /** Host systems and every registered pack's that the bus runs, by id: all but the early ones */
  getRegisteredSystems(): Map<string, AnyStateMachine>;
  /** The refs of a registered pack's systems, `<packId>/<featureId>` */
  getRegisteredPackSystemIds(packId: string): string[];
  /**
   * Each registered system's id → the incoming event types it accepts (`*` accepts any). Cached until a
   * pack or host system registers or a pack unregisters.
   */
  getEventValidationMap(): Map<string, Set<string>>;
  /**
   * Each surface's id → the event types it receives, the outgoing counterpart of `getEventValidationMap`.
   * A pack declares its own surfaces' (`surface.receives`, generated from its systems' outgoing unions) and the
   * host declares its own. A surface absent from the map is one no registered pack owns. Cached on the same
   * terms as the incoming map.
   */
  getSurfaceEventValidationMap(): Map<string, SurfaceEventTypes>;
  /** The SDK's entity types, the host's and the registered packs' */
  getRegisteredEntityTypes(): ReadonlySet<string>;
  /** The SDK's relation kinds and the registered packs' */
  getRegisteredRelationKinds(): ReadonlySet<string>;
  /** The SDK's roles and the registered packs' */
  getRegisteredRoles(): ReadonlySet<string>;
  /** What an entity type's created row is held to, by its shape: the SDK's and the registered packs' */
  getRowRules(type: string): RowRules | undefined;
  /** What a relation kind's edges are held to, as the SDK or the registered pack declaring it says; none when it declares no rule */
  getRelationRules(kind: string): RelationRules | undefined;
  /** Lifecycle hooks of the currently registered packs, in registration order. */
  getLifecycleHooks(): PackLifecycleHooks[];
  /** A registered pack's registration, as it was registered */
  getPackRegistration(packId: string): PackRegistration | null;
  /** Where a registered pack came from, or `null` for one registered without an origin (a test's) */
  packOrigin(packId: string): PackOrigin | null;
  /** Accepted installed runtime identity; replacement changes it even when build bytes do not. */
  getPackRuntime(packId: string): { origin: PackOrigin; registrationId: string } | null;
  /** The packs this app loaded, in registration order */
  loadedPacks(): PackOrigin[];
  /**
   * Admitted native and installed migrations on the requested version line. Pack-line results include
   * the owner's declared version; app-line migrations use the bound app version instead.
   * Dependency order is computed before filtering a caller subset. The app runner sorts globally by
   * target, so its execution order does not promise dependency ordering between packs.
   * Unversioned native owners can declare app-line migrations only. Installed origins without accepted
   * manifests cannot bind migrations or participate in targeting.
   */
  packMigrationTargets(line: 'app', packIds?: Iterable<string>): AppMigrationTarget[];
  packMigrationTargets(line: 'pack', packIds?: Iterable<string>): PackMigrationTarget[];
  packMigrationTargets(line: MigrationLine, packIds?: Iterable<string>): Array<AppMigrationTarget | PackMigrationTarget>;
  /**
   * Every registered pack as `applyPacks` takes it, in dependency order: where its content are and what it
   * depends on. With `packIds`, only those — activation and reload apply the one pack they handled.
   *
   * A pack the app ships is in here beside an installed one: one apply path, one freshness record, one
   * policy mechanism.
   */
  packContentTargets(packIds?: Iterable<string>): PackContentTarget[];
  /** Registers a hook run when the pack `key` stops, or, without a key, when the app exits */
  registerShutdownHook(hook: () => void, key?: string): void;
  /** Runs every registered shutdown hook (the app exiting) */
  runShutdownHooks(): void;
  /** Runs and removes a pack's shutdown hooks (the pack stopping) */
  runShutdownHooksForKey(key: string): void;
  /** Removes a pack's shutdown hooks without running them */
  removeShutdownHooksForKey(key: string): void;
}

/** Capture ownership and collection membership once; executable values retain their identity. */
function admitContributions(registration: PackRegistration, { steps: declarations, eventContracts, migrationOwner, serviceOwner, servicesForAction }: {
  serviceOwner?: PackServiceOwner;
  servicesForAction: import('@apackdev/sdk/services').PackServiceAccess['servicesForAction'];
  steps?: DeclarationData<Record<string, StepEntry>>;
  eventContracts?: Readonly<PackEventContracts>;
  migrationOwner?: { version?: string; dependencies?: Readonly<Record<string, string>> };
}, origin?: PackOrigin) {
  const registrationId = randomUUID();
  const migrations = (line: MigrationLine) => registration.migrations?.[line]?.map(({ target, description, up }) =>
    Object.freeze({ target, description, up }));
  const steps = (registration.steps ?? []).map(binding => {
    if (!declarations || !Object.hasOwn(declarations, binding.type)) throw new Error(`Pack "${registration.id}" needs accepted declarations for step "${binding.type}"`);
    return [binding.type, Object.freeze({ packId: registration.id, registrationId, servicesForAction,
      declaration: captureStepDeclaration(declarations[binding.type]), binding,
      ...(origin && { declarationRevision: origin.declarationRevision, buildRevision: origin.buildRevision }),
    })] as const;
  });
  return {
    id: registration.id,
    registrationId,
    serviceOwner,
    migrationOwner: migrationOwner && { id: registration.id, version: migrationOwner.version,
      dependencies: migrationOwner.dependencies, migrations: { app: migrations('app'), pack: migrations('pack') } },
    steps,
    systems: new Map(featuresOf(registration).flatMap(({ featureId, ref, feature }) => feature.system
      ? [[ref, { machine: feature.system.machine, receives: [...eventContracts![featureId].system!.incoming, ...SYSTEM_EVENT_TYPES] }] as const] : [])),
    surfaceEvents: new Map(featuresOf(registration).flatMap(({ featureId, ref, feature }) => feature.surface
      ? [[ref, [...eventContracts![featureId].surface!.receives, ...SURFACE_EVENT_TYPES]] as const] : [])),
    designations: designationsOf(registration),
    repositories: new Map(Object.entries(registration.repositories ?? {})),
    services: new Map(Object.entries(registration.services ?? {})),
    artifacts: (registration.artifacts ?? []).map(value => [value.type, value] as const),
    blocks: (registration.blocks ?? []).map(value => [value.type, value] as const),
    contentWriters: Object.entries(registration.contentWriters ?? {}),
    appliers: [...(registration.appliers ?? [])],
  };
}
type AdmittedPackContributions = ReturnType<typeof admitContributions>;

/** Build candidate lookups without binding services or writing to the engine. */
function buildContributionTables(packs: Iterable<AdmittedPackContributions>) {
  const tables = {
    designations: createDesignationStore(),
    steps: createOwnedStepStore<StepBackendBinding>(),
    artifacts: new Map<string, ArtifactDefinition>(),
    blocks: new Map<string, BlockDefinition>(),
    contentWriters: createContentWriterStore(),
    appliers: createApplierStore(),
    repositories: new Map<string, unknown>(),
  };
  for (const pack of packs) {
    tables.designations.register(pack.designations);
    for (const [type, value] of pack.steps) tables.steps.set(type, value, pack.id);
    for (const [type, value] of pack.artifacts) tables.artifacts.set(type, value);
    for (const [type, value] of pack.blocks) tables.blocks.set(type, value);
    for (const [name, value] of pack.contentWriters) tables.contentWriters.register(name, value, pack.id);
    tables.appliers.register(pack.id, pack.appliers);
    for (const [name, value] of pack.repositories) tables.repositories.set(name, value);
  }
  return tables;
}

/** A new, empty registry */
export interface PackRegistryOptions {
  /** Composition supplies the owning database's readiness; declaration-only registries have no build work. */
  indexesReady?: (types?: readonly string[]) => Promise<void>;
  /** Native data is admitted before executable registration and survives runtime unload. */
  nativeDeclarations?: readonly import('@apackdev/sdk/framework').NativePackDeclaration[];
  /**
   * The app's packs dir: the installed packs, running or not. A pack there that isn't registered (disabled, or one that
   * didn't load) keeps its settings, so its features count among the features with settings. None when omitted (a
   * build, a test).
   */
  installedPacksDir?: () => string;
  /** Available app defaults remain separate from installed/active contributions. */
  appPackSourcesDir?: () => string | undefined;
  /** Composition supplies scoped authority; registrations cannot choose a caller identity. */
  settingsForPack?: (packId: string) => SettingsService;
  /** Host-owned test doubles replace selected implementations, never declaration ownership or settings policy. */
  serviceOverrides?: ReadonlyMap<string, unknown>;
}

export function createPackRegistry({ indexesReady = () => Promise.resolve(), installedPacksDir, appPackSourcesDir, settingsForPack, serviceOverrides, nativeDeclarations = [] }: PackRegistryOptions = {}): PackRegistry {
  let registrations = new Map<string, PackRegistration>();
  /** Where each registered pack came from. Same keys as `registrations`, so it comes and goes with them */
  let origins = new Map<string, PackOrigin>();
  /** Pack id → why it failed to load. Only for packs not in `registrations`: registering one removes its entry */
  const loadProblems = new Map<string, string>();
  const operations = new Set<string>();
  let allClaimed = false;
  let admitted = new Map<string, AdmittedPackContributions>();
  let tables = buildContributionTables(admitted.values());
  const bindings = new Map<string, ReturnType<typeof createPackServiceBinding>>();
  const catalog = createContributionCatalog(appSettingsDefinition);
  catalog.setNative(nativeDeclarations);
  let changing = false;
  function mutate<T>(operation: () => T): T {
    if (changing) throw new Error('A pack registration change is already in progress');
    changing = true;
    try { return operation(); }
    finally { changing = false; }
  }
  const registrationListeners = new Set<(packId: string) => void>();
  /**
   * `operation`, then every listener told `packId` once the registry takes changes again — when it committed, which
   * `changed()` marks, so a refused registration tells nobody and an unregistration whose cleanup then failed does
   */
  function mutateAndTell<T>(packId: string, operation: () => T): T {
    const before = revision;
    try {
      return mutate(operation);
    } finally {
      if (revision !== before) for (const listener of registrationListeners) listener(packId);
    }
  }
  const shutdownHooks = createShutdownHooks();

  let catalogDir: string | undefined;

  function refreshCatalog(packsDir = installedPacksDir?.() ?? catalogDir, disabled?: ReadonlySet<string>): void {
    const appSources = appPackSourcesDir?.();
    if (appPackSourcesDir) catalog.setAppPackSources(appSources === undefined
      ? { sources: [], problems: [] } : readAppPackSources(appSources));
    if (!packsDir) return;
    disabled ??= disabledPackIds();
    const sources: PackCatalogSource[] = [];
    const problems: PackCatalogProblem[] = [];
    const previousByDir = new Map(catalog.getSnapshot().packs.map(entry => [entry.dir, entry]));
    for (const entry of readInstalledPackBuilds(packsDir)) {
      const { id, dir } = entry;
      if (entry.build) {
        const { snapshot, integrity } = entry.build;
        sources.push({ snapshot, integrity, dir, enabled: !disabled.has(id) });
      } else {
        const previous = previousByDir.get(dir);
        problems.push({ id, dir, enabled: !disabled.has(id), message: `its declarations were refused: ${entry.problem}` });
        if (previous) sources.push({ snapshot: previous.snapshot, integrity: previous.integrity, dir, enabled: !disabled.has(id) });
      }
    }
    // The first discovery is boot's, which takes what is installed (`admitSettings`)
    catalog.replace(sources, problems, { reportConflicts: true, admitSettings: catalogDir !== undefined });
    catalogDir = packsDir;
  }


  /** Bumped by every write, so whatever is derived from the registrations is rebuilt on its next read */
  let revision = 0;
  function changed(): void {
    revision++;
  }
  /** `build`'s result, rebuilt only when `stamp` changed since it last ran: by default, when the registrations changed */
  function derived<T>(build: () => T, stamp: () => number = () => revision): () => T {
    let builtAt = NaN;
    let value: T;
    return () => {
      const now = stamp();
      if (builtAt !== now) {
        value = build();
        builtAt = now;
      }
      return value;
    };
  }

  /**
   * Throws when a pack's EARS entry uses a name (key or value) the app or another registered pack declares:
   * the rule the manifest schema and the code generator apply
   */
  function checkEARS(registration: PackRegistration, replacing?: string): void {
    if (!registration.ears) return;
    const kinds = [
      ['entity type', (ears: PackEARS) => ears.entities],
      ['relation kind', (ears: PackEARS) => ears.relKinds],
      ['role', (ears: PackEARS) => ears.roles],
    ] as const;
    for (const [kind, namesOf] of kinds) {
      const declared = namesOf(registration.ears);
      const [reserved] = _reservedEntries(declared, namesOf(appEARS()));
      if (reserved) throw new Error(`EARS collision: ${kind} ${reserved} — pack "${registration.id}" vs the app's own`);
      for (const [existingId, existing] of registrations) {
        if (existingId === replacing) continue;
        const [taken] = existing.ears ? _reservedEntries(declared, namesOf(existing.ears)) : [];
        if (taken) throw new Error(`EARS collision: ${kind} ${taken} — pack "${registration.id}" vs "${existingId}"`);
      }
    }
    // A short code names one entity type across the app, so two types may not number with one prefix
    const prefixes = (ears: PackEARS) => Object.entries(ears.rowRules ?? {}).flatMap(([type, { shortCode }]) => (shortCode ? [[shortCode, type] as const] : []));
    const owners = new Map<string, string>(Object.entries(SDK_SHORT_CODES).map(([type, prefix]) => [prefix, `the SDK's ${type}`]));
    for (const [existingId, existing] of registrations) {
      if (existingId === replacing || !existing.ears) continue;
      for (const [prefix, type] of prefixes(existing.ears)) owners.set(prefix, `${type} of pack "${existingId}"`);
    }
    for (const [prefix, type] of prefixes(registration.ears)) {
      const owner = owners.get(prefix);
      if (owner) throw new Error(`EARS collision: short code prefix ${prefix} — ${type} of pack "${registration.id}" vs ${owner}`);
    }
  }

  /** Order admitted owners once per registration set, before narrowing either line or caller subset. */
  const orderedMigrationOwners = derived(() => packContentOrder([...admitted.values()]
    .flatMap(pack => pack.migrationOwner ? [pack.migrationOwner] : [])));

  function packMigrationTargets(line: 'app', packIds?: Iterable<string>): AppMigrationTarget[];
  function packMigrationTargets(line: 'pack', packIds?: Iterable<string>): PackMigrationTarget[];
  function packMigrationTargets(line: MigrationLine, packIds?: Iterable<string>): Array<AppMigrationTarget | PackMigrationTarget>;
  function packMigrationTargets(line: MigrationLine, packIds?: Iterable<string>): Array<AppMigrationTarget | PackMigrationTarget> {
    const wanted = packIds && new Set(packIds);
    const owners = orderedMigrationOwners().filter(owner => !wanted || wanted.has(owner.id));
    if (line === 'app') return owners.map(owner => ({ packId: owner.id, migrations: owner.migrations.app }));
    return owners.flatMap(owner => owner.version === undefined ? []
      : [{ packId: owner.id, version: owner.version, migrations: owner.migrations.pack }]);
  }

  /** The first of `keys` a registered pack already holds in what `held` reads off it, and that pack */
  function firstTaken(keys: readonly string[], held: (reg: AdmittedPackContributions) => ReadonlyMap<string, unknown>, replacing?: string): { key: string; holder: string } | undefined {
    for (const [holder, existing] of admitted) {
      if (holder === replacing) continue;
      const holds = held(existing);
      const key = keys.find((k) => holds.has(k));
      if (key) return { key, holder };
    }
    return undefined;
  }

  function registerPack(registration: PackRegistration, origin?: PackOrigin): void {
    mutateAndTell(registration.id, () => registerContributions(registration, origin, backendBindingProblem));
  }

  /** Register the content facet without claiming backend actors, roles or services. */
  function registerContentRuntime(runtime: ContentRuntime, origin: PackOrigin, appliers?: ContentApplier[]): void {
    const manifest = origin.manifest;
    if (!manifest) throw new Error(`Pack "${origin.id}" content runtime needs accepted manifest declarations`);
    const problem = _packDeclarationProblem(origin, runtime);
    if (problem) throw new Error(problem);
    mutateAndTell(runtime.id, () => registerContributions({
      id: runtime.id, declarationRevision: runtime.declarationRevision,
      settings: manifest.extensions?.settings,
      features: Object.fromEntries(Object.entries(manifest.features ?? {})
        .filter(([, feature]) => feature.settings !== undefined).map(([id, feature]) => [id, { settings: feature.settings }])),
      ears: { entities: runtime.entities, relKinds: runtime.relKinds, roles: runtime.roles, ...(runtime.rowRules && { rowRules: runtime.rowRules }), ...(runtime.relationRules && { relationRules: runtime.relationRules }) },
      repositories: runtime.repositories, contentWriters: runtime.contentWriters, appliers,
    }, origin, manifest => contentBindingProblem(manifest, runtime, appliers)));
  }

  function serviceEnabled(owner: PackServiceOwner): boolean {
    if (owner.origin !== 'installed') return true;
    const snapshot = catalog.getSnapshot();
    const id = owner.declaration.id;
    return snapshot.packs.find(pack => pack.snapshot.manifest.id === id)?.enabled !== false
      && snapshot.problems.find(pack => pack.id === id)?.enabled !== false;
  }

  function registerContributions(registration: PackRegistration, origin: PackOrigin | undefined,
    checkBinding: typeof backendBindingProblem, replacing = false, replacement?: PackReplacementOptions): string[] {
    if (origin) origin = Object.freeze({ ...origin,
      ...(origin.manifest && { manifest: captureData(origin.manifest) }),
      ...(origin.buildFiles && { buildFiles: Object.freeze({ ...origin.buildFiles }) }),
      ...(origin.eventContracts && { eventContracts: captureData(origin.eventContracts) }),
    });
    if (registrations.has(registration.id) && !replacing) {
      throw new Error(`Pack "${registration.id}" is already registered`);
    }
    if (origin && (origin.id !== registration.id || (origin.manifest && origin.manifest.id !== registration.id))) {
      throw new Error(`Pack "${registration.id}" runtime identity does not match its accepted origin "${origin.id}"`);
    }
    const stepBindings = Array.isArray(registration.steps) ? registration.steps.map(captureStepBinding) : registration.steps;
    const checkedRegistration = { ...registration, steps: stepBindings };
    checkFeatureIds(registration.id, Object.keys(registration.features ?? {}));
    if (!origin) {
      const declaration = catalog.getSnapshot().native.find(pack => pack.id === registration.id);
      if (!declaration) throw new Error(`Native pack "${registration.id}" must declare its data before binding`);
      const eventsProblem = eventBindingProblem(declaration.eventContracts, registration.features ?? {}, true);
      if (eventsProblem) throw new Error(`Native pack "${registration.id}" runtime ${eventsProblem} does not match its admitted declarations`);
      const contentProblem = backendContentBindingProblem(declaration, registration);
      if (contentProblem) throw new Error(`Native pack "${registration.id}" runtime ${contentProblem} does not match its admitted declarations`);
      const viewerProblem = backendViewerBindingProblem(declaration, registration);
      if (viewerProblem) throw new Error(`Native pack "${registration.id}" runtime ${viewerProblem} does not match its admitted declarations`);
      const apiProblem = apiBindingProblem(declaration.features, declaration, registration);
      if (apiProblem) throw new Error(`Native pack "${registration.id}" runtime ${apiProblem} does not match its admitted declarations`);
      if (!isDeepStrictEqual(registration.ears?.relKinds ?? {}, _packRelationTypes(declaration))) {
        throw new Error(`Native pack "${registration.id}" runtime ears.relKinds does not match its admitted declarations`);
      }
      if (!isDeepStrictEqual(registration.ears?.roles ?? {}, _packRoles(declaration))) {
        throw new Error(`Native pack "${registration.id}" runtime ears.roles does not match its admitted declarations`);
      }
      const migrationProblem = migrationBindingProblem(declaration.migrations, registration.migrations);
      if (migrationProblem) throw new Error(`Native pack "${registration.id}" runtime ${migrationProblem} does not match its admitted declarations`);
      const lifecycleProblem = lifecycleBindingProblem(declaration.lifecycle, registration.lifecycle);
      if (lifecycleProblem) throw new Error(`Native pack "${registration.id}" runtime ${lifecycleProblem} does not match its admitted declarations`);
      const stepProblem = backendStepBindingProblem(declaration.steps, stepBindings);
      if (stepProblem) throw new Error(`Native pack "${registration.id}" runtime ${stepProblem} does not match its admitted declarations`);
      const runtimeFeatures = registration.features === undefined ? {} : registration.features;
      const settingsOf = (features: Record<string, { settings?: unknown }> = {}) => Object.fromEntries(
        Object.entries(features).filter(([, feature]) => feature.settings !== undefined).map(([id, feature]) => [id, feature.settings]));
      if (!runtimeFeatures || typeof runtimeFeatures !== 'object' || Array.isArray(runtimeFeatures)
        || Object.values(runtimeFeatures).some(feature => !feature || typeof feature !== 'object' || Array.isArray(feature))
        || !isDeepStrictEqual(Object.keys(runtimeFeatures).sort(), Object.keys(declaration.features ?? {}).sort())
        || !isDeepStrictEqual(registration.ears?.entities ?? {}, _packEntityTypes(declaration))
        || !isDeepStrictEqual(registration.dependencies === undefined ? {} : registration.dependencies, declaration.dependencies ?? {})
        || !isDeepStrictEqual(registration.settings === undefined ? {} : registration.settings, declaration.settings ?? {})
        || !isDeepStrictEqual(settingsOf(runtimeFeatures), settingsOf(declaration.features))) {
        throw new Error(`Native pack "${registration.id}" runtime does not match its admitted declarations`);
      }
      for (const [id, feature] of Object.entries(runtimeFeatures)) {
        if (feature.designation !== declaration.features?.[id]?.designation) {
          throw new Error(`Native pack "${registration.id}" runtime features.${id}.designation does not match its admitted declarations`);
        }
      }
    }


    const source = catalog.getSnapshot().sourcePacks.find(pack => pack.manifest.id === registration.id);
    if (source && (registration.declarationRevision !== source.declarationRevision || origin?.declarationRevision !== source.declarationRevision)) {
      throw new Error(`Pack "${registration.id}" runtime does not match its accepted source declarations`);
    }
    if (source?.eventContracts && checkBinding === backendBindingProblem
      && !isDeepStrictEqual(source.eventContracts, origin?.eventContracts)) {
      throw new Error(`Pack "${registration.id}" runtime event contracts do not match its accepted source declarations`);
    }

    if (origin?.manifest) {
      const definitions = (features: Record<string, { settings?: unknown }> = {}) => Object.fromEntries(
        Object.entries(features).filter(([, feature]) => feature.settings !== undefined).map(([id, feature]) => [id, feature.settings]),
      );
      if (!isDeepStrictEqual(definitions(registration.features), definitions(origin.manifest.features))
        || !isDeepStrictEqual(registration.settings === undefined ? {} : registration.settings, origin.manifest.extensions?.settings ?? {})) {
        throw new Error(`Pack "${registration.id}" runtime settings do not match its accepted declarations`);
      }
      const problem = checkBinding(origin.manifest, checkedRegistration, origin.eventContracts);
      if (problem) throw new Error(problem);
    }
    if (origin && !origin.manifest && checkBinding === backendBindingProblem) {
      const migrationProblem = migrationBindingProblem(undefined, registration.migrations);
      if (migrationProblem) throw new Error(`Pack "${registration.id}" runtime ${migrationProblem} has no accepted migration declarations`);
      const problem = eventBindingProblem(origin.eventContracts, registration.features ?? {});
      if (problem) throw new Error(`Pack "${registration.id}" runtime ${problem} has no matching admitted event contract`);
    }

    checkEARS(registration, replacing ? registration.id : undefined);

    const providedServices = Object.keys(registration.services ?? {});
    const hostService = providedServices.find((key) => (_HOST_SERVICE_NAMES as readonly string[]).includes(key));
    if (hostService) throw new Error(`Service collision: key "${hostService}" — pack "${registration.id}" vs the host's own "${hostService}" service`);
    const service = firstTaken(providedServices, (reg) => reg.services, replacing ? registration.id : undefined);
    if (service) throw new Error(`Service collision: key "${service.key}" — pack "${registration.id}" vs "${service.holder}"`);
    const repository = firstTaken(Object.keys(registration.repositories ?? {}), (reg) => reg.repositories, replacing ? registration.id : undefined);
    if (repository) throw new Error(`Repository collision: "${repository.key}" — pack "${registration.id}" vs "${repository.holder}"`);

    let binding: ReturnType<typeof createPackServiceBinding> | undefined;
    const candidate = new Map(admitted);
    const native = origin ? undefined : catalog.getSnapshot().native.find(pack => pack.id === registration.id);
    const serviceOwner: PackServiceOwner | undefined = origin?.manifest
      ? { origin: source ? 'source' : 'installed', declaration: origin.manifest }
      : native ? { origin: 'native', declaration: native } : undefined;
    const selection = serviceOwner && assertPackServiceRequirements(catalog.getSnapshot(), serviceOwner);
    candidate.set(registration.id, admitContributions(checkedRegistration, {
      steps: origin ? origin.manifest?.extensions?.steps : native?.steps,
      eventContracts: origin ? origin.eventContracts : native?.eventContracts,
      migrationOwner: origin ? origin.manifest : native,
      serviceOwner,
      servicesForAction: label => {
        if (!binding) throw new Error(`Pack "${registration.id}" has no accepted service binding for its steps`);
        return binding.servicesForAction(label);
      },
    }, origin));
    const nextTables = buildContributionTables(candidate.values());
    try {
      if (registration.bindServices) {
        if (!settingsForPack) throw new Error(`Pack "${registration.id}" needs a host settings service binding`);
        if (!selection || !serviceOwner) throw new Error(`Pack "${registration.id}" needs accepted service declarations`);
        const accepted = candidate.get(registration.id)!;
        binding = createPackServiceBinding({ caller: registration.id, selection,
          settings: settingsForPack(registration.id), overrides: serviceOverrides, bind: registration.bindServices,
          provider: (id, name) => {
            // Own actors drain on their accepted services until the coordinator disposes the binding.
            if (id === registration.id) return accepted.services.has(name)
              ? { generation: accepted, value: accepted.services.get(name) } : undefined;
            const owner = admitted.get(id);
            if (!owner?.serviceOwner || !serviceEnabled(owner.serviceOwner) || !owner.services.has(name)) return;
            // Validate the requested API against its accepted provider, not a prospective replacement.
            _packServiceSelection({ ...packServiceDeclaration(serviceOwner), consumes: { services: [`${id}/${name}`] } },
              providerId => {
                const active = admitted.get(providerId)?.serviceOwner;
                return active && serviceEnabled(active) ? packServiceDeclaration(active) : undefined;
              });
            return { generation: owner, value: owner.services.get(name) };
          },
        });
      }
    } catch (error) {
      const failures = binding?.dispose() ?? [];
      if (failures.length) throw new AggregateError([error, ...failures.map(message => new Error(message))], 'Pack admission and provisional cleanup failed');
      throw error;
    }
    const previousBinding = bindings.get(registration.id);
    registrations = new Map(registrations).set(registration.id, registration);
    origins = new Map(origins);
    if (origin) origins.set(registration.id, origin);
    else origins.delete(registration.id);
    admitted = candidate;
    tables = nextTables;
    if (binding) { bindings.set(registration.id, binding); binding.activate(); }
    else bindings.delete(registration.id);
    loadProblems.delete(registration.id);
    changed();
    if (!previousBinding) return [];
    if (!replacement) return previousBinding.dispose();
    try {
      replacement.retireBinding(() => previousBinding.dispose());
      return [];
    } catch (error) {
      return [`Pack "${registration.id}" committed, but binding retirement could not be scheduled: ${String(error)}`,
        ...previousBinding.dispose()];
    }
  }

  function unregisterPack(packId: string): void {
    mutateAndTell(packId, () => {
      if (!registrations.has(packId)) throw new Error(`Pack "${packId}" is not registered`);
      const candidate = new Map(admitted);
      candidate.delete(packId);
      const nextTables = buildContributionTables(candidate.values());
      const binding = bindings.get(packId);
      bindings.delete(packId);
      registrations = new Map(registrations);
      registrations.delete(packId);
      origins = new Map(origins);
      origins.delete(packId);
      admitted = candidate;
      tables = nextTables;
      changed();
      const failures = binding?.dispose() ?? [];
      if (failures.length) throw new Error(`Pack "${packId}" is unregistered, but its binding cleanup failed: ${failures.join('; ')}`);
    });
  }

  function getRegisteredPackSystemIds(packId: string): string[] {
    return [...(admitted.get(packId)?.systems.keys() ?? [])];
  }

  function buildEventValidationMap(): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    for (const pack of admitted.values()) {
      for (const [ref, system] of pack.systems) map.set(ref, new Set(system.receives));
    }
    // What pack code may send the host's own systems (`HostSystemEvents`): from a frontend too, so the client path
    // checks them as the backend's does. It runs where the host is registered.
    //
    // **Merged into whatever is already there, never set over it.** One of these refs is the bus, which is no
    // feature's system and so has no entry of its own; the rest name a host feature whose system declared its
    // incoming events a few lines above, and overwriting that entry would drop every event the system itself
    // accepts — leaving a system reachable only by the events packs may send it.
    if (registrations.has(HOST_PACK_ID)) {
      for (const [ref, types] of Object.entries(HOST_SYSTEM_EVENT_TYPES)) {
        const existing = map.get(ref);
        if (existing) for (const type of types) existing.add(type);
        else map.set(ref, new Set(types));
      }
    }
    return map;
  }

  function buildSurfaceEventValidationMap(): Map<string, SurfaceEventTypes> {
    const map = new Map<string, SurfaceEventTypes>();
    // Each pack's surfaces are under its own refs, the host's included, so no pack reaches another's entry
    for (const pack of admitted.values()) {
      for (const [ref, receives] of pack.surfaceEvents) map.set(ref, new Set(receives));
    }
    return map;
  }

  const eventValidationMap = derived(buildEventValidationMap);
  const surfaceEventValidationMap = derived(buildSurfaceEventValidationMap);
  const entityTypes = derived((): ReadonlySet<string> => new Set<string>([
    ...RESERVED_ENTITIES,
    ...[...registrations.values()].flatMap((reg) => Object.values(reg.ears?.entities ?? {})),
  ]));
  const relationKinds = derived((): ReadonlySet<string> => new Set<string>([
    ...Object.values(SDK_REL_KINDS),
    ...[...registrations.values()].flatMap((reg) => Object.values(reg.ears?.relKinds ?? {})),
  ]));
  const roles = derived((): ReadonlySet<string> => new Set<string>([
    ...Object.values(SDK_ROLES),
    ...[...registrations.values()].flatMap((reg) => Object.values(reg.ears?.roles ?? {})),
  ]));
  const rowRules = derived((): ReadonlyMap<string, RowRules> => new Map<string, RowRules>([
    ...Object.entries(SDK_ROW_RULES),
    ...[...registrations.values()].flatMap((reg) => Object.entries(reg.ears?.rowRules ?? {})),
  ]));
  const relationRules = derived((): ReadonlyMap<string, RelationRules> => new Map<string, RelationRules>([
    ...Object.entries(SDK_RELATION_RULES),
    ...[...registrations.values()].flatMap((reg) => Object.entries(reg.ears?.relationRules ?? {})),
  ]));
  // Each prefix's entity type, from those same rules, so a pack's codes come and go with it
  const shortCodeTypes = derived(() => _shortCodeTypes([...rowRules()]));
  const services = derived((): Record<string, unknown> =>
    Object.fromEntries([...admitted.values()].flatMap(pack => [...pack.services])));

  function indexReadinessScope(packId: string) {
    const snapshot = catalog.getSnapshot();
    const native = new Map(snapshot.native.map(pack => [pack.id, pack]));
    const installed = new Map(snapshot.packs.map(pack => [pack.snapshot.manifest.id, pack.snapshot.manifest]));
    const types = new Set<string>(RESERVED_ENTITIES);
    const owners = new Map<string, { binding: AdmittedPackContributions | undefined; declaration: unknown }>();
    const pending = [packId];
    while (pending.length) {
      const id = pending.pop()!;
      if (owners.has(id)) continue;
      const registration = registrations.get(id);
      const declaration = native.get(id) ?? installed.get(id);
      owners.set(id, { binding: admitted.get(id), declaration });
      for (const type of Object.values(registration?.ears?.entities ?? (declaration ? _packEntityTypes(declaration) : {}))) types.add(type);
      pending.push(...Object.keys(registration?.dependencies ?? declaration?.dependencies ?? {}));
    }
    return { types, owners };
  }

  return {
    catalog,
    refreshCatalog,
    registerPack,
    replacePack: (registration, origin, options) => mutateAndTell(registration.id, () => {
      if (!registrations.has(registration.id)) throw new Error(`Pack "${registration.id}" is not registered`);
      return registerContributions(registration, origin, backendBindingProblem, true, options);
    }),
    registerContentRuntime,
    unregisterPack,
    async indexesReady(packId) {
      if (packId === undefined) return indexesReady();
      if (!registrations.has(packId)) throw new Error(`Pack "${packId}" is not registered`);
      const scope = indexReadinessScope(packId);
      await indexesReady([...scope.types]);
      const current = indexReadinessScope(packId);
      // A dependency can add types while an older type scope waits (or after an immediate ready result).
      // Compare only these owners: unrelated catalog changes must not invalidate a healthy activation.
      if (!isDeepStrictEqual(scope.types, current.types) || scope.owners.size !== current.owners.size
        || [...scope.owners].some(([id, owner]) => {
          const next = current.owners.get(id);
          return !next || next.binding !== owner.binding || !isDeepStrictEqual(next.declaration, owner.declaration);
        })) throw Object.assign(new Error(`Pack "${packId}" or its dependencies changed during index readiness`), { code: 'CANCELLED' });
    },
    onRegistrationChanged(listener) {
      registrationListeners.add(listener);
      return () => { registrationListeners.delete(listener); };
    },

    recordLoadProblem(packId, problem) {
      loadProblems.set(packId, problem);
    },
    claimPackOperation(key) {
      if (allClaimed || operations.has(key)) return false;
      operations.add(key);
      return true;
    },
    releasePackOperation: key => { operations.delete(key); },
    claimAllPackOperations() {
      if (allClaimed || operations.size > 0) return false;
      allClaimed = true;
      return true;
    },
    releaseAllPackOperations: () => { allClaimed = false; },
    loadProblem: (packId) => catalog.getSnapshot().problems.find(problem => problem.id === packId)?.message ?? loadProblems.get(packId),
    clearLoadProblem(packId) {
      loadProblems.delete(packId);
    },

    getRegisteredSystems() {
      const systems = new Map<string, AnyStateMachine>();
      for (const pack of admitted.values()) {
        for (const [ref, system] of pack.systems) systems.set(ref, system.machine);
      }
      return systems;
    },

    getRegisteredPackSystemIds,
    packOrigin: (packId) => origins.get(packId) ?? null,
    getPackRuntime(packId) {
      const origin = origins.get(packId);
      const contribution = admitted.get(packId);
      return origin && contribution ? { origin, registrationId: contribution.registrationId } : null;
    },
    loadedPacks: () => [...origins.values()],
    packMigrationTargets,

    // Both maps are keyed by the registered features' refs, the host's included
    systemIds: () => [...eventValidationMap().keys()] as FeatureRef[],
    surfaceIds: () => [...surfaceEventValidationMap().keys()] as FeatureRef[],

    getEventValidationMap: eventValidationMap,
    getSurfaceEventValidationMap: surfaceEventValidationMap,

    earsNames() {
      const { entities, relKinds, roles } = appEARS();
      const names = { entities: { ...entities }, relKinds: { ...relKinds }, roles: { ...roles } };
      for (const reg of registrations.values()) {
        Object.assign(names.entities, reg.ears?.entities ?? {});
        Object.assign(names.relKinds, reg.ears?.relKinds ?? {});
        Object.assign(names.roles, reg.ears?.roles ?? {});
      }
      return names;
    },

    getRegisteredEntityTypes: entityTypes,
    getRegisteredRelationKinds: relationKinds,
    getRegisteredRoles: roles,
    getRowRules: (type) => rowRules().get(type),
    getRelationRules: (kind) => relationRules().get(kind),
    entityTypeOfShortCode: (code) => shortCodeTypes()(code),
    getRegisteredServices: services,

    getLifecycleHooks: () => [...registrations.values()].flatMap((reg) => (reg.lifecycle ? [reg.lifecycle] : [])),
    getPackRegistration: (packId) => registrations.get(packId) ?? null,

    packContentTargets(packIds) {
      const wanted = packIds && new Set(packIds);
      // Dependency order over every pack. A pack the app ships declares no dependencies — it is what others
      // depend on — so it sorts ahead of them, which is the order the two separate paths used to produce by
      // running one after the other
      const ordered = packContentOrder([...origins.values()]
        .filter((origin) => !wanted || wanted.has(origin.id))
        .map((origin) => ({ id: origin.id, dependencies: origin.manifest?.dependencies, origin })));
      return ordered.map(({ origin }) => ({
        manifest: { id: origin.id, dependencies: origin.manifest?.dependencies },
        dir: origin.dir,
      }));
    },

    ...shutdownHooks,

    // The SDK's lookups (PackRegistryView)
    designation: key => tables.designations.get(key),
    stepDeclarations: catalog.steps,
    stepBindings: () => new Map(tables.steps.entries()),
    step: key => tables.steps.get(key)?.binding,
    steps: () => tables.steps.all().map(row => row.binding),
    artifact: key => tables.artifacts.get(key),
    artifacts: () => [...tables.artifacts.values()],
    block: key => tables.blocks.get(key),
    blocks: () => [...tables.blocks.values()],
    contentWriters: key => tables.contentWriters.get(key),
    repository: name => tables.repositories.get(name),
    appliers: key => tables.appliers.get(key),
    settingsCatalog: catalog.settings,
    onCatalogChanged: catalog.onChanged,
    surfaceDefaults: () => Object.fromEntries(catalog.surfaces()
      .filter(surface => surface.origin !== 'source' && surface.enabled === true && surface.declaration.defaultVisible !== undefined)
      .map(surface => [surface.featureRef, surface.declaration.defaultVisible!])),
    help: catalog.help,
  };
}
