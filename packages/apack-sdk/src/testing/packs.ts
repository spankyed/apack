import type { ProjectionDefinition } from '../framework/projections.ts';
import type { StepBackendBinding } from '../steps/catalog.ts';
import type { StepCatalogEntry } from '../framework/catalog-view.ts';
// The registered packs in unit tests that run without an app: a plain in-memory stand-in tests fill directly.
// startTestRuntime binds it over the registry it's given (the harness's), so what a test puts here is found first.
import type { PackRegistryView } from '../runtime/packs-view.ts';
import type { FeatureRef } from '../ids/refs.ts';
import type { StepDefinition } from '../steps/types.ts';
import { _mergeStepDefinitions } from '../steps/merge.ts';
import type { ArtifactDefinition } from '../artifacts/types.ts';
import type { BlockDefinition } from '../blocks/types.ts';
import type { ContentWriter } from '../content/writers.ts';
import type { ContentApplier } from '../utils/apply.ts';
import type { HelpArticle } from '../framework/pack-help.ts';
import type { SettingsCatalog } from '../framework/pack-settings.ts';
import { SDK_ENTITIES, SDK_REL_KINDS, SDK_ROLES, SDK_ROW_RULES } from '../types/sdk-entities.ts';
import { _shortCodeTypes } from '../framework/data-declaration.ts';

/** What tests register without an app, each lookup keyed as the SDK looks it up */
export interface TestPacks {
  /** Role → id of the system that plays it */
  readonly designations: Map<string, string>;
  /** Projections a test registers, each with the name it is known by */
  readonly projections: Array<{ name: string; projection: ProjectionDefinition }>;
  /** Refs of systems a test says run, besides the registered packs': what `services.emitter` resolves a send against */
  readonly systems: Set<string>;
  /** Refs of surfaces a test says are there, besides the registered packs' */
  readonly surfaces: Set<string>;
  /** Step definitions by type */
  readonly steps: Map<string, StepDefinition>;
  /** Explicit declaration data, independent of executable test doubles. */
  readonly stepDeclarations: Map<string, StepCatalogEntry>;
  /** Artifact definitions by type */
  readonly artifacts: Map<string, ArtifactDefinition>;
  /** Block definitions by type */
  readonly blocks: Map<string, BlockDefinition>;
  /** Services by name, over the registered packs' */
  readonly services: Map<string, unknown>;
  /** Content writers by entity type */
  readonly contentWriters: Map<string, ContentWriter>;
  /** Repositories by name, over the registered packs' */
  readonly repositories: Map<string, unknown>;
  /** Appliers by pack id */
  readonly appliers: Map<string, ContentApplier[]>;
  readonly help: Map<string, HelpArticle[]>;
  /** Entity types by the name they're declared under, over the registered packs' */
  readonly earsEntities: Map<string, string>;
  /** Relation kinds by the name they're declared under, over the registered packs' */
  readonly earsRelKinds: Map<string, string>;
  /** Roles by the name they're declared under, over the registered packs' */
  readonly earsRoles: Map<string, string>;
  /** Empties every lookup */
  clear(): void;
}

function createTestPacks(): TestPacks {
  const lookups = {
    designations: new Map<string, string>(),
    systems: new Set<string>(),
    surfaces: new Set<string>(),
    steps: new Map<string, StepDefinition>(),
    stepDeclarations: new Map<string, StepCatalogEntry>(),
    artifacts: new Map<string, ArtifactDefinition>(),
    blocks: new Map<string, BlockDefinition>(),
    services: new Map<string, unknown>(),
    contentWriters: new Map<string, ContentWriter>(),
    repositories: new Map<string, unknown>(),
    appliers: new Map<string, ContentApplier[]>(),
    help: new Map<string, HelpArticle[]>(),
    earsEntities: new Map<string, string>(),
    earsRelKinds: new Map<string, string>(),
    earsRoles: new Map<string, string>(),
  };
  const projections: TestPacks['projections'] = [];
  return {
    ...lookups,
    projections,
    clear: () => {
      projections.length = 0;
      Object.values(lookups).forEach((lookup) => lookup.clear());
    },
  };
}

/** The in-memory stand-in for the registered packs that `startTestRuntime` binds */
export const testPacks: TestPacks = createTestPacks();

const noSettings: SettingsCatalog = { revision: 0, app: { schema: { type: 'object' }, defaults: {} }, packs: {}, features: {}, dependencies: {} };

/** Definitions of `registered` with the ones tests put in `own` in place of those of the same type, then the rest of `own` */
function withOwn<T extends { type: string }>(registered: readonly T[] = [], own: Map<string, T>): T[] {
  return [...registered.filter((def) => !own.has(def.type)), ...own.values()];
}

/** A test's step definitions over the registered ones: a type both define is merged facet by facet, as the registry merges a pack's */
function stepsWithOwn(registered: readonly StepDefinition[] = []): StepDefinition[] {
  const own = testPacks.steps;
  const merged = registered.map((def) => (own.has(def.type) ? _mergeStepDefinitions(def, own.get(def.type)!) : def));
  const registeredTypes = new Set(registered.map((def) => def.type));
  return [...merged, ...[...own.values()].filter((def) => !registeredTypes.has(def.type))];
}

let nextStepIdentity = 0;
const ownBindings = new WeakMap<StepDefinition, StepBackendBinding>();

/** A standalone provider needs explicitly authored metadata before it can authorize a write. */
function ownStepBinding(definition: StepDefinition, entry: StepCatalogEntry): StepBackendBinding {
  let binding = ownBindings.get(definition);
  if (!binding) {
    binding = Object.freeze({ packId: entry.packId, declaration: structuredClone(entry.declaration),
      declarationRevision: entry.declarationRevision, buildRevision: entry.buildRevision,
      registrationId: `test-step-${++nextStepIdentity}`, binding: definition,
      servicesForAction: () => { throw new Error(`Standalone step "${definition.type}" has no accepted service binding`); } });
    ownBindings.set(definition, binding);
  }
  return binding;
}

/** The view `startTestRuntime` binds: `testPacks`, then the registry it was given */
export function testPacksView(registered?: PackRegistryView): PackRegistryView {
  // With no registry, the SDK's own prefixes are every one there is
  const sdkShortCodeTypes = _shortCodeTypes(Object.entries(SDK_ROW_RULES));
  return {
    // A test names a role's id as it likes; it stands for a ref here
    designation: (role) => (testPacks.designations.get(role) as FeatureRef | undefined) ?? registered?.designation(role),
    stepDeclarations: () => withOwn(registered?.stepDeclarations(), testPacks.stepDeclarations),
    stepBindings: () => {
      const bindings = new Map(registered?.stepBindings());
      for (const [type, definition] of testPacks.steps) {
        const declared = testPacks.stepDeclarations.get(type);
        const accepted = bindings.get(type);
        if (declared) bindings.set(type, ownStepBinding(definition, declared));
        else if (accepted) bindings.set(type, { ...accepted, binding: _mergeStepDefinitions(accepted.binding, definition) });
      }
      return bindings;
    },
    step: (type) => {
      const own = testPacks.steps.get(type);
      const def = registered?.step(type);
      return own && def ? _mergeStepDefinitions(def, own) : own ?? def;
    },
    steps: () => stepsWithOwn(registered?.steps()),
    artifact: (type) => testPacks.artifacts.get(type) ?? registered?.artifact(type),
    artifacts: () => withOwn(registered?.artifacts(), testPacks.artifacts),
    block: (type) => testPacks.blocks.get(type) ?? registered?.block(type),
    blocks: () => withOwn(registered?.blocks(), testPacks.blocks),
    projections: () => [...(registered?.projections() ?? []), ...testPacks.projections],
    getRegisteredServices: () => ({ ...registered?.getRegisteredServices(), ...Object.fromEntries(testPacks.services) }),
    repository: (name) => testPacks.repositories.get(name) ?? registered?.repository(name),
    // A test names a ref as it likes, as it does a role's
    systemIds: () => [...new Set([...(registered?.systemIds() ?? []), ...testPacks.systems])] as FeatureRef[],
    surfaceIds: () => [...new Set([...(registered?.surfaceIds() ?? []), ...testPacks.surfaces])] as FeatureRef[],
    contentWriters: (entity) => testPacks.contentWriters.get(entity) ?? registered?.contentWriters(entity),
    appliers: (packId) => testPacks.appliers.get(packId) ?? registered?.appliers(packId) ?? [],
    settingsCatalog: () => registered?.settingsCatalog() ?? noSettings,
    onCatalogChanged: (listener) => registered?.onCatalogChanged(listener) ?? (() => {}),
    surfaceDefaults: () => registered?.surfaceDefaults() ?? {},
    help: () => ({ articles: [...(registered?.help().articles ?? []), ...[...testPacks.help.values()].flat()], problems: registered?.help().problems ?? [] }),
    earsNames: () => {
      const base = registered?.earsNames() ?? { entities: { ...SDK_ENTITIES }, relKinds: { ...SDK_REL_KINDS }, roles: { ...SDK_ROLES } };
      return {
        entities: { ...base.entities, ...Object.fromEntries(testPacks.earsEntities) },
        relKinds: { ...base.relKinds, ...Object.fromEntries(testPacks.earsRelKinds) },
        roles: { ...base.roles, ...Object.fromEntries(testPacks.earsRoles) },
      };
    },
    entityTypeOfShortCode: (code) => (registered ? registered.entityTypeOfShortCode(code) : sdkShortCodeTypes(code)),
  };
}
