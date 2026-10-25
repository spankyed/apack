import { _packServiceDeclarations, _packServiceSelection } from '../framework/service-consumption.ts';
import { _stepBackendParts } from '../framework/step-backend-declaration.ts';
import { dataLiteral, propertyKey } from './code-literals.ts';
import { findSourceModule, SCRIPT_MODULE_EXTENSIONS, TYPE_MODULE_EXTENSIONS } from './source-module.ts';
import { resolveTypeModule } from './type-module.ts';
import { _packModuleTargets, _moduleTargetSource } from './module-targets.ts';
import { _packEntities, _packEntityTypes, _packRelationTypes, _packRoles, _packShortCodes, type PackDataDeclarations } from '../framework/data-declaration.ts';
import { _parseModuleReference } from '../framework/module-reference.ts';
import { generateSettingsTypes } from './settings-types.ts';
import { _declarationRevision } from './declaration-revision.ts';
import { readFileSync, existsSync } from 'fs';
import { HOST_SURFACE_EVENT_TYPES, HOST_SYSTEM_EVENT_TYPES } from '../events/index.ts';
import { extname, join, relative, resolve } from 'path';
import { _mergeProvenance, packFeatures, PROVENANCE_KINDS, type PackManifest, type PackFeature, type PackProvenance, type PackTypeManifest, type PackDependencySnapshot, type ProvenanceKind, type StepEntry } from './manifest.ts';
import { MIGRATION_LINES, StepEntrySchema } from '../framework/declaration-schema.ts';
import { SDK_ENTITIES, SDK_REL_KINDS, SDK_ROLES, SDK_SHAPED_ENTITIES } from '../types/sdk-entities.ts';
import { _reservedEntries } from '../types/reserved-names.ts';
import { formatEntities } from './content/items.ts';
import { resolveContentSources, type ResolvedContentSource } from './content/resolve.ts';
import { createModuleExports, type ModuleExport, type ModuleExports } from './module-exports.ts';
import { hasOwn } from '../utils/shared.ts';
import { compareVersions } from '../utils/compare-versions.ts';
import type { StepDefinition } from '../steps/types.ts';
import type { RowRules } from '@apackdev/ears';
import type { ComponentTarget } from '../framework/surface-declaration.ts';
import type { PackEventContracts } from '../framework/event-contracts.ts';

const HEADER = `// @generated from apack.json — do not edit by hand
// Regenerate: apack pack generate-entries\n`;

/** Generated data read by the build, never an executable pack module. */
export const GENERATED_ENTITY_DESTINATIONS_FILE = 'src/__generated__/entity-destinations.json';
/** Generated endpoint data shared by the snapshot producer and source runtime harness. */
export const GENERATED_EVENT_CONTRACTS_FILE = 'src/__generated__/event-contracts.json';

// ── EARS emitter ─────────────────────────────────────────────────

interface RegistryEntry { value: string; source: string }

/** The registry source of the entities the SDK owns */
const SDK_SOURCE = '@apackdev/sdk';

export function mergeRegistries(
  ownId: string,
  manifest: PackManifest,
  depManifests: Map<string, PackTypeManifest>,
  /**
   * Per dependency, which pack declares each name it surfaces — its snapshot's `provenance`.
   *
   * Per dependency, not merged across them: that distinction is the whole check. Two dependencies
   * naming the same ancestor for a name is a diamond and fine; two naming different packs is a real
   * collision. A single merged record answers "who declares this" and cannot tell those apart.
   */
  depProvenance: Map<string, PackProvenance> = new Map(),
) {
  /** What each kind of declared name reads from: the SDK's own, a dependency's snapshot field and its provenance */
  const KINDS = {
    entity: { sdkOwned: SDK_ENTITIES, fromDep: (dep: PackTypeManifest) => dep.entities, provenance: 'entities' },
    relKind: { sdkOwned: SDK_REL_KINDS, fromDep: (dep: PackTypeManifest) => dep.relKinds, provenance: 'relKinds' },
    role: { sdkOwned: SDK_ROLES, fromDep: (dep: PackTypeManifest) => dep.roles, provenance: 'roles' },
  } as const satisfies Record<string, { sdkOwned: Record<string, string>; fromDep: (dep: PackTypeManifest) => Record<string, string>; provenance: ProvenanceKind }>;

  function merge(own: Record<string, string> = {}, kind: keyof typeof KINDS) {
    // The SDK's own entities, relation kinds and roles are in every pack, and no pack declares them
    const { sdkOwned, fromDep, provenance: provenanceKind } = KINDS[kind];
    const errors = _reservedEntries(own, sdkOwned).map((entry) => `${kind} ${entry} is defined by the SDK; remove it from apack.json`);
    for (const [depId, dep] of depManifests) {
      const depEntries = fromDep(dep);
      for (const entry of _reservedEntries(depEntries, sdkOwned)) {
        errors.push(`${kind} ${entry} from "${depId}" is defined by the SDK: rebuild "${depId}" with the current apack CLI`);
      }
    }
    if (errors.length > 0) throw new Error(`Type conflicts:\n  ${errors.join('\n  ')}`);

    const map = new Map<string, RegistryEntry>();
    // Each name and each value has one source
    const valueSources = new Map<string, string>();
    const sources: Array<[string, Record<string, string>]> = [[ownId, own]];
    for (const [depId, dep] of depManifests) sources.push([depId, fromDep(dep)]);
    /**
     * Who declares a name, rather than which dependency handed it over. A dependency surfaces its own
     * dependencies' names too, so the same ancestor name arrives through every path that reaches it;
     * attributing it to the dependency it came through makes a diamond look like a collision.
     */
    /**
     * `hasOwnProperty` rather than indexing, because these records come off a snapshot read from disk
     * and are indexed by names a manifest chose. `entities`/`relKinds` are unrestricted strings, so a
     * name like `constructor` is legal — and indexing an ordinary object for it finds `Object`'s
     * constructor and returns that function as the declaring pack, instead of falling back to the
     * dependency the name arrived through. (`Object.hasOwn` is newer than the shared lib floor.)
     */
    const declaringPack = (via: string, key: string): string => {
      if (via === ownId) return ownId;
      const declared = depProvenance.get(via)?.[provenanceKind];
      return declared && hasOwn(declared, key) ? declared[key] : via;
    };
    for (const [via, entries] of sources) {
      for (const [key, value] of Object.entries(entries)) {
        const source = declaringPack(via, key);
        const existing = map.get(key)?.source ?? valueSources.get(value);
        if (existing !== undefined && existing !== source) {
          errors.push(`${kind} "${key}" declared by both "${existing}" and "${source}"`);
          continue;
        }
        map.set(key, { value, source });
        valueSources.set(value, source);
      }
    }
    if (errors.length > 0) throw new Error(`Type conflicts:\n  ${errors.join('\n  ')}`);

    for (const [key, value] of Object.entries(sdkOwned)) map.set(key, { value, source: SDK_SOURCE });
    return map;
  }

  return {
    entities: merge(_packEntityTypes(manifest), 'entity'),
    relKinds: merge(_packRelationTypes(manifest), 'relKind'),
    roles: merge(_packRoles(manifest), 'role'),
  };
}

function emitNamespaceMembers(
  ownId: string,
  registry: Map<string, RegistryEntry>,
): string[] {
  const lines: string[] = [];
  const groups = new Map<string, string[]>();
  for (const [key, { source }] of registry) {
    const g = groups.get(source) ?? [];
    g.push(key);
    groups.set(source, g);
  }

  const ownKeys = groups.get(ownId);
  if (ownKeys) {
    for (const key of ownKeys) {
      lines.push(key === '__proto__'
        ? `    export declare const __proto__: ${dataLiteral(registry.get(key)!.value)};`
        : `    export const ${key} = '${registry.get(key)!.value}';`);
      lines.push(`    export type ${key} = typeof ${key};`);
    }
    groups.delete(ownId);
  }

  for (const [depId, keys] of groups) {
    lines.push(`    // ${depId}`);
    for (const key of keys) {
      lines.push(key === '__proto__'
        ? `    export declare const __proto__: ${dataLiteral(registry.get(key)!.value)};`
        : `    export const ${key} = '${registry.get(key)!.value}';`);
      lines.push(`    export type ${key} = typeof ${key};`);
    }
  }

  return lines;
}

// TypeScript emits namespace values as assignments; __proto__ needs an own data property.
function prototypeExport(namespace: string, registry: Map<string, RegistryEntry>): string {
  const entry = registry.get('__proto__');
  return entry ? `\n  Object.defineProperty(${namespace}, "__proto__", { value: ${dataLiteral(entry.value)}, enumerable: true, writable: true, configurable: true });` : '';
}

export function emitEARS(ownId: string, registry: ReturnType<typeof mergeRegistries>): string {
  const entityMembers = emitNamespaceMembers(ownId, registry.entities);
  const relKindMembers = emitNamespaceMembers(ownId, registry.relKinds);
  const roleMembers = emitNamespaceMembers(ownId, registry.roles);

  // A pack with no entities of its own or its dependencies' keeps an open Entity type; the SDK's
  // Relation alone doesn't close it
  const declaresEntities = [...registry.entities.values()].some(({ source }) => source !== SDK_SOURCE);
  const entityUnion = declaresEntities ? [...registry.entities.keys()].map(k => `Entity.${k}`).join(' | ') : 'string';
  // Closed: the SDK's kinds and roles are in every pack, so neither list is ever empty
  const relKindList = [...registry.relKinds.keys()].map(k => `RelKind.${k}`).join(', ');
  const roleList = [...registry.roles.keys()].map(k => `RoleKind.${k}`).join(', ');

  // A namespace without members has no runtime value, and EARS.Entity is read at runtime
  const entityValue = entityMembers.length > 0
    ? `  export namespace Entity {\n${entityMembers.join('\n')}\n  }`
    : '  export const Entity = {};';

  return `// Auto-generated by \`apack pack generate-entries\` — do not edit.

export namespace EARS {
${entityValue}${prototypeExport('Entity', registry.entities)}
  export type Entity = ${entityUnion};

  export type EntityId<E extends string = string> = import('@apackdev/ears').EARS.EntityId<E>;
  export type RelationId = import('@apackdev/ears').EARS.RelationId;

  export namespace RelKind {
${relKindMembers.join('\n')}
  }
  /** Every relation kind this pack may link with: its own, its dependencies' and the SDK's */
  export const RELATION_KINDS = [${relKindList}] as const;
  export type RelKind = (typeof RELATION_KINDS)[number];
  /** Whether a kind that arrived as data (an event's field, a stored row) is one of them */
  export const isRelKind = (value: unknown): value is RelKind => (RELATION_KINDS as readonly unknown[]).includes(value);

  export namespace RoleKind {
${roleMembers.join('\n')}
  }
  /** Every role this pack may grant: its own, its dependencies' and the SDK's */
  export const ROLES = [${roleList}] as const;
  export type RoleKind = (typeof ROLES)[number];
  /** Whether a role that arrived as data is one of them */
  export const isRole = (value: unknown): value is RoleKind => (ROLES as readonly unknown[]).includes(value);

  export const AttrKindValues = { Role: 'role' } as const;
  export namespace AttrKind {
    export const Role = 'role';
    export type Role = typeof Role;
    export const Custom = <T extends string>(k: T) => k as T & AttrKind;
  }
  export type AttrKind = import('@apackdev/ears').EARS.AttrKind;

  export type AttributePayloads = import('@apackdev/ears').EARS.AttributePayloads;
  export type AttributeValue<K extends AttrKind = AttrKind> = import('@apackdev/ears').EARS.AttributeValue<K>;
  export type AttributeTypeMap = import('@apackdev/ears').EARS.AttributeTypeMap;
  export type AttributeStore = import('@apackdev/ears').EARS.AttributeStore;
}

export type BaseEntity = import('@apackdev/ears').BaseEntity;

export const AllEntities = EARS.Entity;
export type AllEntities = EARS.Entity;
`;
}

/**
 * The SDK appliers of the specialty content keys, each as the factory to call and the options it is given
 * besides the entry's own `onUserEdit` — which the caller merges in, since it is the manifest's to say and
 * not this table's.
 */
const SPECIALTY_APPLIERS: Record<string, { factory: string; options: Record<string, unknown> }> = {
  actions: { factory: 'createFormatApplier', options: { key: 'actions', entities: ['Action'], identity: ['label'] } },
  prompts: { factory: 'createFormatApplier', options: { key: 'prompts', entities: ['Prompt'], identity: ['label'] } },
  flows: { factory: 'createFlowApplier', options: {} },
  documents: { factory: 'createDocumentsApplier', options: {} },
  commands: { factory: 'createCommandsApplier', options: {} },
};

const COMPILED_DIR_ACCESSORS = `let _compiledDir = '';
export function setCompiledDir(dir: string): void { _compiledDir = dir; }
export function getCompiledDir(): string {
  if (!_compiledDir) throw new Error('compiledDir not initialized — pack loader must call setCompiledDir()');
  return _compiledDir;
}
`;

// ── Helpers ─────────────────────────────────────────────────────

/** Extensions a manifest path can name a module by; anything else (`memo.types`) is part of the name */
const MODULE_EXTENSIONS = new Set([...SCRIPT_MODULE_EXTENSIONS, '.vue', '.json', '.css']);

/**
 * The module codegen writes the build-time step facets into, which `apack pack build` bundles to
 * `dist/build/steps.build.mjs` — what a dependent pack's build validates its flows with.
 */
export const STEPS_BUILD_MODULE = 'src/__generated__/steps-build.ts';

/** One step as codegen reads it: its manifest entry, its type (the map's key) and the directory its modules sit in */
interface StepDeclaration {
  type: string;
  kind?: 'step' | 'trigger';
  dsl?: StepEntry['dsl'];
  entry: StepEntry;
  types?: string;
  helpers?: string;
}

/**
 * The facets a *registration* can carry. `kind` rides on every literal and `dsl` drives flow helpers and build-only reference inspection
 * rather than runtime registrations, so neither is one of these.
 */
const STEP_FACETS = ['node', 'build', 'trigger', 'runtime', 'fe'] as const satisfies readonly (keyof StepDefinition)[];
type StepFacetName = (typeof STEP_FACETS)[number];

/** A part of `StepDefinition` that is not a routed facet, each for a reason stated above */
type UnroutedPart = Exclude<keyof StepDefinition, 'type' | 'kind' | 'dsl' | StepFacetName>;
const _everyPartIsAFacetOrExcluded: [UnroutedPart] extends [never] ? true : UnroutedPart = true;
void _everyPartIsAFacetOrExcluded;

/**
 * **Which facets each target carries, said once.**
 *
 * A step's facets go to three places and each takes a different subset: the backend registration runs the
 * step, the frontend registration draws it, and the generated build module is what a *dependent* pack's
 * `apack pack build` validates its flows with. Three emitters each rebuilding the literal from its own chain of
 * `if`s is how a facet comes to reach two of the three and not the third — which is exactly what happened
 * to `node`, whose label and field defaults the backend needed and silently never got.
 *
 * `node` is in two targets and not the build module: a dependent's build compiles and validates flows, and
 * never creates a node.
 */
const FACET_TARGETS = {
  backend: ['node', 'build', 'trigger', 'runtime'],
  frontend: ['node', 'fe'],
  buildModule: ['build', 'trigger'],
} as const satisfies Record<string, readonly StepFacetName[]>;

type FacetTarget = keyof typeof FACET_TARGETS;

/** A facet no target carries reaches no registration, which is the failure this table exists to prevent */
type UnroutedFacet = Exclude<StepFacetName, (typeof FACET_TARGETS)[FacetTarget][number]>;
const _everyFacetIsRouted: [UnroutedFacet] extends [never] ? true : UnroutedFacet = true;
void _everyFacetIsRouted;

/** Extensions of the TypeScript sources codegen reads exports from */

/**
 * Specifier from src/__generated__ to a manifest path (relative to the pack root), naming the file that is
 * there.
 *
 * Explicit, because no runtime resolves an extensionless specifier in ESM — and the extension the module
 * *has*, rather than the `.js` this used to write for a `.ts` file. A pack is bundled rather than emitted as
 * individual modules, its tsconfig sets `allowImportingTsExtensions`, and every tool in its toolchain
 * resolves `.ts`: `tsc` and `vue-tsc` under `bundler` resolution, Vite, and esbuild. So `.js` bought nothing
 * here and cost the pack a second convention — its hand-written code names `.ts`, as the `@apackdev` packages'
 * own source does (`check:specifiers`, `findJsSpecifiers`).
 */
function toImportPath(root: string, manifestPath: string): string {
  const normalized = manifestPath.split('\\').join('/');
  const fromGenerated = relative(join(root, 'src', '__generated__'), resolve(root, normalized)).split('\\').join('/');
  const rel = fromGenerated.startsWith('.') ? fromGenerated : `./${fromGenerated}`;
  if (MODULE_EXTENSIONS.has(extname(rel))) return rel;
  if (!existsSync(join(root, `${normalized}.ts`)) && existsSync(join(root, normalized, 'index.ts'))) {
    return `${rel}/index.ts`;
  }
  return `${rel}.ts`;
}


/** This pack's explicitly untyped entities, whose fields read as unknown values. */
export function entitiesWithoutShapes(manifest: PackDataDeclarations): string[] {
  return _packEntities(manifest).filter(({ shape }) => shape === null).map(({ name }) => name);
}

/** The type-bundle key in a pack's snapshot facades, written by `apack pack build` */
export const PACK_TYPES_FACADE = 'pack-types';

/**
 * A dependency's facade types in a pack, relative to the pack root.
 *
 * @internal Host-only: apack CLI build tooling.
 */
export function _depTypesFile(depId: string): string {
  return `src/__generated__/deps/${depId}.d.ts`;
}

const FLOW_HELPERS_SUFFIX = '.flow-helpers';

/** A dependency's flow helpers module (`.js`) or its declarations (`.d.ts`) in a pack, relative to the pack root */
function depFlowHelpersFile(depId: string, extension: '.js' | '.d.ts'): string {
  return `src/__generated__/deps/${depId}${FLOW_HELPERS_SUFFIX}${extension}`;
}

/** The line naming the dependency version a facade types file was generated from */
function depTypesHeader(depId: string, version: string): string {
  return `// ${depId}@${version} facade types\n`;
}

/**
 * The dependency version a facade types file was generated from (its depTypesHeader line).
 *
 * @internal Host-only: apack CLI build tooling.
 */
export function _depTypesVersion(content: string, depId: string): string | undefined {
  const prefix = `// ${depId}@`;
  const suffix = ' facade types';
  const line = content.split('\n').find((l) => l.startsWith(prefix) && l.endsWith(suffix));
  return line?.slice(prefix.length, -suffix.length);
}

/** A local name for a type imported from a dependency, unique per dependency */
function depAlias(depId: string, name: string): string {
  return `__dep_${depId.replace(/[^A-Za-z0-9_$]/g, '_')}_${name}`;
}

function toIdentifier(key: string): string {
  return key.replace(/\W/g, '_');
}

function toPascalCase(id: string): string {
  return id.replace(/(^|-)(\w)/g, (_, _sep, c) => c.toUpperCase());
}

// Local bindings for a feature's default exports start with `__`, which a feature id can't, so they don't
// collide with generated names (`specs`, `ref`, `<feature>Entry`).
const systemBinding = (id: string) => `__system_${id}`;
const surfaceBinding = (id: string) => `__surface_${id}`;

export interface GenerateEntriesOptions {
  packRoot: string;
  depTypes?: Map<string, PackTypeManifest>;
  depSnapshots?: Map<string, PackDependencySnapshot>;
}

export async function generatePackFiles(
  manifest: PackManifest,
  opts: GenerateEntriesOptions,
): Promise<Record<string, string>> {
  const root = opts.packRoot;
  for (const entry of Object.values(manifest.extensions?.steps ?? {})) StepEntrySchema.parse(entry);
  const moduleTargets = _packModuleTargets(manifest).map(entry => ({ ...entry, source: _moduleTargetSource(entry) }));
  const depSnapshots = opts.depSnapshots ?? new Map<string, PackDependencySnapshot>();
  const depIds = [...depSnapshots.keys()];
  const depFacades = new Map([...depSnapshots].map(([depId, snapshot]) => {
    const facade = snapshot.facades[PACK_TYPES_FACADE];
    if (typeof facade !== 'string' || !facade.trim()) {
      throw new Error(`Dependency "${depId}" is missing its ${PACK_TYPES_FACADE} facade; rebuild that dependency with "apack pack build" before generating entries`);
    }
    return [depId, facade] as const;
  }));
  const facadeSources = new Map([...depFacades].map(([id, content]) => [resolve(root, _depTypesFile(id)), content]));
  /** `import type { name as alias }` from each dependency's facade, and the aliases */
  function depTypeImports(name: string, from: readonly string[] = depIds): { imports: string[]; aliases: string[] } {
    for (const depId of from) {
      const file = resolve(root, _depTypesFile(depId));
      try {
        if (!moduleReader().hasTypeExport(file, name)) throw new Error(`does not export required type "${name}"`);
      } catch (error) {
        throw new Error(`Dependency "${depId}" has an unusable ${PACK_TYPES_FACADE} facade: ${error instanceof Error ? error.message : String(error)}; rebuild that dependency with "apack pack build"`, { cause: error });
      }
    }
    return {
      imports: from.map((depId) => `import type { ${name} as ${depAlias(depId, name)} } from './deps/${depId}.ts';`),
      aliases: from.map((depId) => depAlias(depId, name)),
    };
  }

  /**
   * Whether a pack publishes `PackSurfaceState` — it has at least one feature with a surface. Three outputs turn on
   * this one fact and must agree: whether `fe.ts` is emitted, whether `pack-types.ts` re-exports the type, and
   * whether a dependent imports it. Spelling it three ways is what left a dependent of a surface-less pack with an
   * import nothing resolved.
   */
  const publishesSurfaceState = (forManifest: PackManifest, packId: string) => PROVENANCE_KINDS.surfaces(forManifest, packId).length > 0;

  /** The dependencies whose facade publishes `PackSurfaceState`, by the same rule applied to their manifests */
  const depsWithSurfaces = depIds.filter((depId) => publishesSurfaceState(depSnapshots.get(depId)!.manifest, depId));


  /**
   * The repository names the pack's direct dependencies declare, with the pack declaring each. A name
   * this pack declares too fails the build: the app's registry refuses a pack whose repository name
   * another registered pack holds, so the pack would build and then break the app at registration.
   */
  function checkRepositoryNames(): void {
    const taken = new Map<string, string>();
    for (const [depId, snap] of depSnapshots) {
      for (const feature of packFeatures(snap.manifest)) {
        for (const name of Object.keys(feature.repositories ?? {})) taken.set(name, depId);
      }
    }
    for (const feature of packFeatures(manifest)) {
      for (const name of Object.keys(feature.repositories ?? {})) {
        const owner = taken.get(name);
        if (owner) {
          throw new Error(`Repository "${name}" (feature "${feature.id}") is declared by "${owner}", which this pack depends on: the app refuses a pack whose repository name another pack registered, so rename it in apack.json \`repositories\``);
        }
      }
    }
  }
  checkRepositoryNames();

  /**
   * Providers share the host's flat service namespace even when consumers select qualified refs.
   * Report collisions here rather than waiting for runtime registration; filtering is not ownership.
   */
  function checkServiceNames(): void {
    const serviceNames = (m: PackManifest): string[] => _packServiceDeclarations({
      id: m.id, features: m.features, services: m.extensions?.services,
    }).map(entry => entry.name);
    const taken = new Map<string, string>();
    for (const [depId, snap] of depSnapshots) {
      for (const name of serviceNames(snap.manifest)) {
        const owner = taken.get(name);
        if (owner && owner !== depId) {
          throw new Error(`Service "${name}" is declared by both "${owner}" and "${depId}", which this pack depends on: their services are intersected into one \`services\`, so the two would silently merge. Only one of them can provide it.`);
        }
        taken.set(name, depId);
      }
    }
    for (const name of serviceNames(manifest)) {
      const owner = taken.get(name);
      if (owner) {
        throw new Error(`Service "${name}" is declared by "${owner}", which this pack depends on: the app refuses a pack whose service name another pack registered, so rename it in apack.json \`services\``);
      }
    }
  }
  checkServiceNames();
  const selectedServices = _packServiceSelection({ ...manifest, services: manifest.extensions?.services }, id => {
    const dependency = depSnapshots.get(id)?.manifest;
    return dependency && { ...dependency, services: dependency.extensions?.services };
  });

  // ── Manifest export targets ────────────────────────────────────

  /** The pack source file a manifest path names: the file itself, `<path>.ts` or `<path>/index.ts` */
  function sourceFileOf(manifestPath: string, label = `Module "${manifestPath}"`): string | undefined {
    return findSourceModule(root, manifestPath, SCRIPT_MODULE_EXTENSIONS, label);
  }

  /** A `"path#exportName"` manifest value: the source path, the export and the file */
  function exportTarget(label: string, target: string, extensions: readonly string[] = SCRIPT_MODULE_EXTENSIONS): { source: string; exportName: string; file: string } {
    const { source, exportName } = _parseModuleReference(target, label);
    const file = findSourceModule(root, source, extensions, label);
    if (!file) throw new Error(`${label}: no file found at ${source} (.ts or /index.ts)`);
    return { source, exportName, file };
  }

  /** Every file whose exports codegen reads, so one TypeScript program covers them all */
  function exportedFromFiles(): string[] {
    const files = moduleTargets.flatMap(({ source, kind, label }) => {
      if (source.endsWith('.vue')) return [];
      const file = findSourceModule(root, source, kind === 'type' || kind === 'types' ? TYPE_MODULE_EXTENSIONS : SCRIPT_MODULE_EXTENSIONS, label);
      return file ? [file] : [];
    });
    return [...new Set(files)];
  }

  let moduleExports: ModuleExports | undefined;
  function moduleReader(): ModuleExports {
    return moduleExports ??= createModuleExports(root, [...exportedFromFiles(), ...facadeSources.keys()], facadeSources);
  }
  function exportOf(file: string, name: string): ModuleExport | undefined {
    return moduleReader().exportOf(file, name);
  }

  // Whole-module readers take conventional exports; Vue's component export is compiled by the SFC build.
  for (const { source, kind, label, conventionalExport } of moduleTargets) {
    if (!conventionalExport || (kind === 'component' && source.endsWith('.vue'))) continue;
    const file = findSourceModule(root, source, SCRIPT_MODULE_EXTENSIONS, label);
    if (!file) throw new Error(`${label}: no module found at ${source}`);
    if (!exportOf(file, conventionalExport)?.value) {
      throw new Error(`${label}: ${source} doesn't export "${conventionalExport}" as a value`);
    }
  }

  function outgoingEventTypesOf(file: string, name: string): string[] {
    return moduleReader().outgoingEventTypesOf(file, name);
  }

  function inboxEventTypesOf(file: string, name: string): string[] {
    return moduleReader().inboxEventTypesOf(file, name);
  }

  /** Where a contract lives: the module as the manifest spells it, the resolved file, and the type's name */
  type ContractTarget = { source: string; exportName: string; file: string };

  /**
   * A feature's contract, as `apack.json` names it at `features[].<kind>.contract` — the module and the type in
   * it. A feature that names none publishes nothing: a system with no surface of its own sends nothing anyone
   * receives, and a surface without one still receives its own system's events.
   *
   * The contract is a *type*, so the check is that the module declares one: a name that is only a value is the
   * mistake worth catching, since reading it would silently yield an empty inbox.
   */
  function contractTarget(feature: PackFeature, kind: 'system' | 'surface'): ContractTarget | undefined {
    const declared = kind === 'system' ? feature.system?.contract : feature.surface?.contract;
    if (!declared) return undefined;
    const label = `Feature "${feature.id}": ${kind}.contract`;
    const target = exportTarget(label, declared);
    const info = exportOf(target.file, target.exportName);
    if (!info) throw new Error(`${label}: ${target.source} doesn't export "${target.exportName}"`);
    if (!info.type) throw new Error(`${label}: ${target.source} exports "${target.exportName}" only as a value, not a type. A ${kind}'s contract is a declared type codegen reads without running anything`);
    return target;
  }

  /** The contract each of `features` declares for `kind`, by feature id; a feature that declares none is absent */
  function contractsOf(features: PackFeature[], kind: 'system' | 'surface'): Map<string, ContractTarget> {
    return new Map(features.flatMap((feature) => {
      const target = contractTarget(feature, kind);
      return target ? [[feature.id, target] as const] : [];
    }));
  }

  /** Read contract metadata without execution, attributing failures to its feature. */
  function contractTypes(feature: PackFeature, kind: 'system' | 'surface', read: (file: string, name: string) => string[]): string[] {
    const contract = contractTarget(feature, kind);
    if (!contract) return [];
    try {
      return read(contract.file, contract.exportName);
    } catch (err) {
      (err as Error).message = `Feature "${feature.id}": ${(err as Error).message}`;
      throw err;
    }
  }

  /** The event types a feature's system sends, read from its contract */
  function sentEventTypes(feature: PackFeature): string[] {
    return contractTypes(feature, 'system', outgoingEventTypesOf);
  }

  /** The event types a surface's contract declares that any other surface or system may send it */
  function acceptedEventTypes(feature: PackFeature): string[] {
    return contractTypes(feature, 'surface', inboxEventTypesOf);
  }

  let compiledEvents: PackEventContracts | undefined;
  function eventContracts(): PackEventContracts {
    return compiledEvents ??= Object.fromEntries(packFeatures(manifest)
      .filter(feature => feature.system || feature.surface).map(feature => [feature.id, {
        ...(feature.system && { system: {
          incoming: [...new Set([...contractTypes(feature, 'system', (file, name) => moduleReader().incomingEventTypesOf(file, name)),
            ...(feature.system.events?.incoming ?? [])])].sort(),
          outgoing: [...new Set(sentEventTypes(feature))].sort(),
        } }),
        ...(feature.surface && { surface: { receives: receivedEventTypes(feature) } }),
      }]));
  }

  function entityDestinations(): Record<string, string> {
    const known = new Set([...Object.values(SDK_ENTITIES), ...Object.keys(_packEntityTypes(manifest)),
      ...[...depSnapshots.values()].flatMap(snapshot => Object.keys(snapshot.types.entities))]);
    const claims = new Map<string, string>();
    for (const feature of packFeatures(manifest)) {
      for (const entity of contractTypes(feature, 'surface', (file, name) => moduleReader().openedEntityTypesOf(file, name))) {
        if (!known.has(entity)) throw new Error(`Feature "${feature.id}": Contract.opens names unknown entity "${entity}"`);
        const owner = claims.get(entity);
        if (owner !== undefined) throw new Error(`Entity destination "${entity}" claimed by both features "${owner}" and "${feature.id}"`);
        claims.set(entity, feature.id);
      }
    }
    return Object.fromEntries([...claims].sort(([a], [b]) => a.localeCompare(b, 'en')));
  }

  /**
   * The event types one of this pack's surfaces receives: what its own feature's system sends it, and every audience
   * of the inbox its contract declares. The bus checks each send against this (`getSurfaceEventValidationMap`).
   *
   * One flat list, deliberately: the audiences are a type-level split, and a passing check here means the event's
   * **shape** was accepted, not that this sender was allowed to send it. `Message.from` is a label the generated
   * sends stamp, not a claim the bus checks — `docs/archive/goals/goal-sender-enforced-audiences.md` says why.
   */
  /**
   * The blocks a manifest declares, for the backend registration: the type is the map's key and the kind is
   * plain data, so the literal is written out rather than imported from a barrel. Only the backend facet is
   * a reference, and it is the half a backend process can run.
   */
  function blockDefinitions(): { imports: string[]; literal: string } {
    const imports: string[] = [];
    const items = Object.entries(manifest.extensions?.blocks ?? {}).map(([type, entry], index) => {
      const parts = [`type: '${type}'`];
      if (entry.kind) parts.push(`kind: '${entry.kind}'`);
      if (entry.be) {
        const { source, exportName } = valueExport(`Block "${type}": be`, entry.be);
        const local = `__blockBE_${index}`;
        imports.push(`import { ${exportName} as ${local} } from '${toImportPath(root, source)}';`);
        parts.push(`be: ${local}`);
      }
      return `    { ${parts.join(', ')} },`;
    });
    return { imports, literal: items.length ? `[\n${items.join('\n')}\n  ]` : '' };
  }

  /**
   * The same blocks for the frontend registration, carrying the component each declares instead of the
   * backend facet. A component is taken by its default export, as a surface's entry is, so the manifest
   * names a file rather than a `"path#export"` target.
   */
  function blockDefinitionsFE(): { imports: string[]; literal: string } {
    const imports: string[] = [];
    const items = Object.entries(manifest.extensions?.blocks ?? {}).map(([type, entry], index) => {
      const parts = [`type: '${type}'`];
      if (entry.kind) parts.push(`kind: '${entry.kind}'`);
      if (entry.fe) {
        const local = `__blockFE_${index}`;
        imports.push(`import ${local} from '${toImportPath(root, componentFile(`Block "${type}": fe`, entry.fe))}';`);
        parts.push(`fe: { component: ${local} }`);
      }
      return `    { ${parts.join(', ')} },`;
    });
    return { imports, literal: items.length ? `[\n${items.join('\n')}\n  ]` : '' };
  }

  /**
   * A step's facets, each as an import and a member of the literal codegen writes. Three callers want
   * three subsets — the backend registration (build or trigger, plus runtime), the generated build module
   * a dependent pack loads (build or trigger alone) and the frontend registration (fe) — so each facet is
   * emitted once here and picked there.
   *
   * `handler` and `register` are wrapped in a lazy import rather than imported: a step's runtime module is
   * what reaches models, the filesystem and the terminal, and it is loaded on the step's first run. The
   * flags beside it are data, because the brain reads them before deciding how to run the step.
   */
  function stepFacet(label: string, target: string, local: string): { import: string; expr: string } {
    const { source, exportName } = valueExport(label, target);
    return { import: `import { ${exportName} as ${local} } from '${toImportPath(root, source)}';`, expr: local };
  }

  /** A function reached through `await import(...)`, so its module loads when the step first needs it */
  function lazyCall(label: string, target: string, args: string): string {
    const { source, exportName } = valueExport(label, target);
    return `async (${args}) => (await import('${toImportPath(root, source)}')).${exportName}(${args})`;
  }

  /**
   * An import local for one of a step's facets, named after the **step type** rather than its position.
   * An index was what the three emitters used, and the frontend one indexed after filtering out the steps
   * with no `fe` — so `__stepFE_3` and `__stepBuild_3` named different steps as soon as one lacked a facet.
   */
  function facetLocal(type: string, facet: string): string {
    return `__step_${type.replace(/[^A-Za-z0-9]/g, '_')}_${facet}`;
  }

  /** What one facet contributes to a step's literal: the imports it needs and the `name: expr` member */
  interface FacetEmission { imports: string[]; member: string }

  function stepBackend(step: StepDeclaration, facet: 'build' | 'trigger', target: FacetTarget): FacetEmission | null {
    const parts = _stepBackendParts(step.entry)[facet];
    if (!parts) return null;
    const imports: string[] = [];
    const members = Object.entries(parts.data).map(([key, value]) => `${propertyKey(key, key)}: ${dataLiteral(value)}`);
    for (const [name, reference] of Object.entries(parts.callbacks)) {
      if (!reference || (name === 'register' && target !== 'backend')) continue;
      const label = `Step "${step.type}": ${facet}.${name}`;
      const { value } = valueExport(label, reference);
      if (value !== 'function') throw new Error(`${label}: expected an exported function`);
      if (name === 'register') members.push(`register: ${lazyCall(label, reference, 'node, ctx')}`);
      else {
        const binding = stepFacet(label, reference, facetLocal(step.type, `${facet}_${name}`));
        imports.push(binding.import);
        members.push(`${name}: ${binding.expr}`);
      }
    }
    return { imports, member: `${facet}: { ${members.join(', ')} }` };
  }

  /** Shared component binding grammar for feature surfaces and step presentation. */
  function frontendBindings(prefix: string, owner: string) {
    const imports: string[] = [];
    let nextBinding = 0;
    function reference(target: string, label = owner) {
      const parsed = _parseModuleReference(target, label, 'default');
      if (parsed.source.endsWith('.vue')) {
        if (parsed.exportName !== 'default') throw new Error(`${label}: Vue components use their default export`);
        if (!findSourceModule(root, parsed.source, ['.vue'], label)) throw new Error(`${label}: no component found at ${parsed.source}`);
      } else {
        const file = sourceFileOf(parsed.source, label);
        if (!file) throw new Error(`${label}: no module found at ${parsed.source}`);
        if (!exportOf(file, parsed.exportName)?.value) throw new Error(`${label}: ${parsed.source} doesn't export ${parsed.exportName} as a value`);
      }
      return parsed;
    }
    function target(value: string, field?: string): string {
      const { source, exportName } = reference(value, field ? `${owner}.${field}` : owner);
      const binding = `${prefix}_${nextBinding++}`;
      const from = dataLiteral(toImportPath(root, source));
      imports.push(exportName === 'default' ? `import ${binding} from ${from};`
        : `import { ${exportName} as ${binding} } from ${from};`);
      return binding;
    }
    function component(value: ComponentTarget): string {
      if (typeof value === 'string' || value.load !== 'lazy') return target(typeof value === 'string' ? value : value.entry);
      const { source, exportName } = reference(value.entry);
      imports.push("import { defineAsyncComponent } from 'vue';");
      return `defineAsyncComponent(() => import(${dataLiteral(toImportPath(root, source))}).then(module => module.${exportName}))`;
    }
    function icon(value: NonNullable<StepEntry['fe']>['nodeConfig']['icon']): string {
      if (typeof value !== 'string') return component(value);
      const binding = `${prefix}_icon`;
      imports.push(`import { ${value} as ${binding} } from 'lucide-vue-next';`);
      return binding;
    }
    function callable(value: string): string {
      const { value: kind } = valueExport(owner, value);
      if (kind !== 'function') throw new Error(`${owner}: expected an exported function`);
      return target(value);
    }
    return { imports, target, component, icon, callable };
  }

  function stepFrontend(step: StepDeclaration): FacetEmission | null {
    const declaration = step.entry.fe;
    if (!declaration) return null;
    const binding = frontendBindings(facetLocal(step.type, 'fe'), `Step "${step.type}": fe`);
    const { icon, ...config } = declaration.nodeConfig;
    const parts = [`nodeConfig: { ...${dataLiteral(config)}, icon: ${binding.icon(icon)} }`];
    for (const key of ['colorKey', 'handlePrefix'] as const) {
      if (declaration[key] !== undefined) parts.push(`${propertyKey(key, key)}: ${dataLiteral(declaration[key])}`);
    }
    if (declaration.components !== undefined) parts.push(`components: { ${Object.entries(declaration.components)
      .map(([key, value]) => `${propertyKey(key, key)}: ${binding.component(value)}`).join(', ')} }`);
    if (declaration.layout !== undefined) parts.push(`layout: { ${Object.entries(declaration.layout)
      .map(([key, value]) => `${propertyKey(key, key)}: ${typeof value === 'string' ? binding.callable(value) : dataLiteral(value)}`).join(', ')} }`);
    return { imports: binding.imports, member: `fe: { ${parts.join(', ')} }` };
  }

  /**
   * How each facet is emitted. The table above says *which* target carries a facet; this says *how* it is
   * written, and is the one place a facet's emission lives. A facet absent from the entry emits nothing.
   */
  const FACET_EMITTERS: Record<StepFacetName, (step: StepDeclaration, target: FacetTarget) => FacetEmission | null> = {
    node: (step) => ({ imports: [], member: `node: JSON.parse(${dataLiteral(JSON.stringify(step.entry.node))})` }),
    build: (step, target) => stepBackend(step, 'build', target),
    fe: (step) => stepFrontend(step),

    trigger: (step, target) => stepBackend(step, 'trigger', target),

    runtime: (step) => {
      const runtime = step.entry.runtime;
      if (!runtime) return null;
      const imports: string[] = [];
      const parts: string[] = [];
      if (runtime.handler) {
        const label = `Step "${step.type}": runtime.handler`;
        if (runtime.sync) {
          // The one case the module is imported with the entry: the handler's sends have to land in the
          // brain's own dispatch, and `await import(...)` puts them a tick too late
          const facet = stepFacet(label, runtime.handler, facetLocal(step.type, 'handler'));
          imports.push(facet.import);
          parts.push(`handler: ${facet.expr}`);
        } else {
          parts.push(`handler: ${lazyCall(label, runtime.handler, 'runNode, node, ctx, actor')}`);
        }
      }
      for (const flag of ['isAsync', 'waits', 'spawnsSubflow'] as const) {
        if (runtime[flag]) parts.push(`${flag}: true`);
      }
      return parts.length ? { imports, member: `runtime: { ${parts.join(', ')} }` } : null;
    },
  };

  /**
   * The steps a manifest declares, as the literal one target carries: `type`, `kind`, and each facet
   * `FACET_TARGETS` routes there. One builder for all three targets, so a facet cannot reach two of them
   * and be forgotten in the third.
   */
  function stepLiterals(target: FacetTarget, indent: string): { imports: string[]; items: string[] } {
    const imports: string[] = [];
    const items: string[] = [];
    for (const step of stepDefinitions) {
      const parts = [`type: '${step.type}'`];
      if (step.kind) parts.push(`kind: '${step.kind}'`);
      if (target === 'buildModule' && step.dsl?.references) parts.push(`dsl: ${dataLiteral({ references: step.dsl.references })}`);
      for (const facet of FACET_TARGETS[target]) {
        const emitted = FACET_EMITTERS[facet](step, target);
        if (!emitted) continue;
        imports.push(...emitted.imports);
        parts.push(emitted.member);
      }
      // A step the target carries nothing of is not registered there: the frontend skips one with no `fe`
      if (parts.length === 1) continue;
      items.push(`${indent}{ ${parts.join(', ')} },`);
    }
    return { imports, items };
  }

  /** Metadata comes from declarations; exported functions supply only behavior. */
  function migrationEntries(): { imports: string[]; literal: string } {
    const imports: string[] = [];
    const lines = MIGRATION_LINES.flatMap((line) => {
      const entries = Object.entries(manifest.migrations?.[line] ?? {})
        .sort(([a], [b]) => compareVersions(a, b));
      if (entries.length === 0) return [];
      const items = entries.map(([version, target]) => {
        const label = `Migration "${line}/${version}"`;
        const local = `__migration_${line}_${version.replace(/[^A-Za-z0-9]/g, '_')}`;
        const { source, exportName, value } = valueExport(label, target.up);
        if (value !== 'function') throw new Error(`${label}: "${exportName}" in ${source} must export an up function`);
        imports.push(`import { ${exportName} as ${local} } from '${toImportPath(root, source)}';`);
        return `      { target: '${version}', description: ${dataLiteral(target.description)}, up: ${local} },`;
      });
      return [`    ${line}: [\n${items.join('\n')}\n    ],`];
    });
    if (lines.length === 0) return { imports: [], literal: '' };
    return { imports, literal: `{\n${lines.join('\n')}\n  }` };
  }

  /** The steps for a registration literal, or no literal at all when the target carries none */
  function stepDefinitionsFor(target: FacetTarget): { imports: string[]; literal: string } {
    const { imports, items } = stepLiterals(target, '    ');
    return { imports, literal: items.length ? `[\n${items.join('\n')}\n  ]` : '' };
  }

  /**
   * The module a dependent pack's `apack pack build` loads to validate its flows: the build-time facets alone,
   * with no runtime handler and nothing frontend. It is generated from the same manifest entries and the
   * same builder the registrations are, so the two cannot name different facets — which is what the
   * hand-written second barrel could do and what `build-barrel.spec.ts` existed to catch.
   */
  function generateStepsBuild(): string {
    if (stepDefinitions.length === 0) return '';
    const { imports, items } = stepLiterals('buildModule', '  ');
    return `${HEADER}
import type { StepDefinition } from '@apackdev/sdk/steps';
${imports.join('\n')}

export const steps: StepDefinition[] = [
${items.join('\n')}
];
`;
  }

  /**
   * The artifact types a manifest declares, for the backend registration: the type alone, since both facets
   * an artifact has are frontend ones. This is what keeps `lucide-vue-next` out of the pack's backend
   * bundle, where a barrel of `fe: { icon }` literals put the whole icon set.
   */
  function artifactDefinitions(): string {
    const items = Object.keys(manifest.extensions?.artifacts ?? {}).map((type) => `    { type: '${type}' },`);
    return items.length ? `[\n${items.join('\n')}\n  ]` : '';
  }

  /**
   * The same artifacts for the frontend registration, each with the icon it names and the viewer it
   * declares. The icons are one import from `lucide-vue-next`, which the host provides the frontend.
   */
  function artifactDefinitionsFE(): { imports: string[]; literal: string } {
    const entries = Object.entries(manifest.extensions?.artifacts ?? {});
    if (entries.length === 0) return { imports: [], literal: '' };
    const icons = [...new Set(entries.map(([, entry]) => entry.icon))].sort();
    const imports = [`import { ${icons.join(', ')} } from 'lucide-vue-next';`];
    const items = entries.map(([type, entry], index) => {
      const facet = [`icon: ${entry.icon}`];
      if (entry.fe) {
        const local = `__artifactFE_${index}`;
        imports.push(`import ${local} from '${toImportPath(root, componentFile(`Artifact "${type}": fe`, entry.fe))}';`);
        facet.push(`component: ${local}`);
      }
      return `    { type: '${type}', fe: { ${facet.join(', ')} } },`;
    });
    return { imports, literal: `[\n${items.join('\n')}\n  ]` };
  }

  /** A manifest path naming a component file, taken by its default export */
  function componentFile(label: string, manifestPath: string): string {
    const file = findSourceModule(root, manifestPath, [...SCRIPT_MODULE_EXTENSIONS, '.vue'], label);
    if (!file) throw new Error(`${label}: no file at ${manifestPath}`);
    return relative(root, file).split('\\').join('/');
  }

  function receivedEventTypes(feature: PackFeature): string[] {
    const own = feature.system ? sentEventTypes(feature) : [];
    return [...new Set([...own, ...acceptedEventTypes(feature)])].sort();
  }

  /** A `"path#exportName"` target that must export a runtime value */
  function valueExport(label: string, target: string): { source: string; exportName: string; value: NonNullable<ModuleExport['value']> } {
    const { source, exportName, file } = exportTarget(label, target);
    const info = exportOf(file, exportName);
    if (!info) throw new Error(`${label}: ${source} doesn't export "${exportName}"`);
    if (!info.value) throw new Error(`${label}: ${source} exports "${exportName}" only as a type, not a value`);
    return { source, exportName, value: info.value };
  }

  /** A service: `"path#exportName"` of the service object (an object literal or a class instance) */
  function serviceExport(key: string, target: string): { source: string; exportName: string } {
    const label = `Service "${key}"`;
    const { source, exportName, value } = valueExport(label, target);
    if (value === 'function') throw new Error(`${label}: "${exportName}" in ${source} is a function; export the service object itself (export const ${exportName} = { … })`);
    if (value === 'class') throw new Error(`${label}: "${exportName}" in ${source} is a class; export an instance of it (export const <name> = new …)`);
    return { source, exportName };
  }


  /** Step type and helper modules are explicit declarations, independent of executable facet locations. */
  const stepDefinitions: StepDeclaration[] = Object.entries(manifest.extensions?.steps ?? {}).map(([type, entry]) => {
    const types = entry.types === undefined ? undefined : resolveTypeModule(root, entry.types, `Step "${type}": types`);
    let helpers: string | undefined;
    if (entry.dsl?.helpers !== undefined) {
      const file = sourceFileOf(entry.dsl.helpers, `Step "${type}": dsl.helpers`);
      if (!file) throw new Error(`Step "${type}": no helpers module found at ${entry.dsl.helpers}`);
      helpers = relative(root, file).split('\\').join('/');
    }
    return { type, kind: entry.kind, dsl: entry.dsl, entry, types, helpers };
  });

  // ── Backend entry ──────────────────────────────────────────────

  function generateBackendEntry(): string {
    const features = packFeatures(manifest);
    const systemFeatures = features.filter(f => f.system);
    // Every system's events are read, a system without a surface's too: an entry that lost them (annotated
    // `: SystemEntry`) would give the facade types nothing but `{ type: string }`
    for (const feature of systemFeatures) sentEventTypes(feature);

    const systemImports = systemFeatures
      .map(f => `import ${systemBinding(f.id)} from '${toImportPath(root, f.system!.entry)}';`)
      .join('\n');

    // Routing comes from the compiled contract, never the machine's private handler inventory.
    const systemExpr = (f: PackFeature): string => {
      return `packSystem(${systemBinding(f.id)}, { incoming: ${dataLiteral(eventContracts()[f.id].system!.incoming)} })`;
    };

    const hookEntries = Object.entries(manifest.lifecycle ?? {}).map(([name, target]) => {
      const { source, exportName, value } = valueExport(`Boot hook "${name}"`, target);
      if (value !== 'function') throw new Error(`Boot hook "${name}": "${exportName}" in ${source} must export a function`);
      return { name, binding: `__lifecycle_${name}`, source, exportName };
    });
    const hooksImport = hookEntries.map(({ source, exportName, binding }) =>
      `import { ${exportName} as ${binding} } from '${toImportPath(root, source)}';`).join('\n');

    const writerEntries = contentWriterEntries();

    const featuresLiteral = features.map(f => {
      const parts: string[] = [];
      if (f.designation) parts.push(`      designation: '${f.designation}'`);
      if (f.system) parts.push(`      system: ${systemExpr(f)}`);
      if (f.surface) parts.push(`      surface: { receives: ${dataLiteral(eventContracts()[f.id].surface!.receives)} }`);
      parts.push(`      services: [${Object.keys(f.services ?? {}).map(s => `'${s}'`).join(', ')}]`);
      // JSON.parse preserves own __proto__ keys, which an object literal would treat as a prototype setter.
      if (f.settings) parts.push(`      settings: JSON.parse(${dataLiteral(JSON.stringify(f.settings))})`);
      return `    '${f.id}': {\n${parts.join(',\n')},\n    }`;
    }).join(',\n');
    const blocks = blockDefinitions();
    const artifacts = artifactDefinitions();
    const steps = stepDefinitionsFor('backend');
    const migrations = migrationEntries();
    // Validated Markdown articles embedded into the runtime registration

    // The machine each system was built from is typed by the contract the manifest names for its feature, and
    // nothing in either file says so: this asserts it where both are in scope.
    const contracted = systemFeatures.filter(f => contractTarget(f, 'system'));
    const contractCheck = contracted.length === 0 ? '' : `
// Each system's machine is typed by the contract apack.json names for its feature — the one its facade publishes.
// A machine built from some other contract compiles on its own, so a mismatch reads here as the sentence
// \`MachineMatchesContract\` returns, in place of the \`true\` the constraint asks for. Type-only: it leaves
// nothing behind in the pack's bundle. Exported because a local type nobody reads is what noUnusedLocals
// reports, and the assertion is the same either way.
type __ContractMatches<T extends true> = T;
export type __ContractChecks = {
${contracted.map(f => `  '${f.id}': __ContractMatches<MachineMatchesContract<typeof ${systemBinding(f.id)}, __SystemContracts['${f.id}']>>;`).join('\n')}
};
`;

    return `${HEADER}
import type { PackRegistration } from '@apackdev/sdk/framework';
${contracted.length ? "import type { MachineMatchesContract } from '@apackdev/sdk/framework';\nimport type { SystemContracts as __SystemContracts } from './system-specs.ts';\n" : ''}${systemFeatures.length ? "import { packSystem } from '@apackdev/sdk/framework';\n" : ''}${hasRepositories() ? "import { repositories } from './repositories.ts';\n" : ''}
${systemImports}
import { featureServices, bindServices } from './services.ts';
${hooksImport}
${writerEntries.map(([, path, exportName], i) => `import { ${exportName} as __contentWriter_${i} } from '${path}';`).join('\n')}
${migrations.imports.join('\n')}
${steps.imports.join('\n')}
${blocks.imports.join('\n')}
import { appliers } from './appliers.ts';
export { setCompiledDir } from './appliers.ts';



export const registration: PackRegistration = {
  id: '${manifest.id}',
  dependencies: ${dataLiteral(manifest.dependencies ?? {})},
  declarationRevision: '${_declarationRevision(manifest)}',
  features: {${featuresLiteral ? `\n${featuresLiteral},\n  ` : ''}},
  services: featureServices,
  bindServices,
${hasRepositories() ? '  repositories,' : ''}
${steps.literal ? `  steps: ${steps.literal},` : ''}
${artifacts ? `  artifacts: ${artifacts},` : ''}
${blocks.literal ? `  blocks: ${blocks.literal},` : ''}
${writerEntries.length > 0 ? `  contentWriters: { ${writerEntries.map(([entity], i) => `${propertyKey(entity)}: __contentWriter_${i}`).join(', ')} },` : ''}
  appliers,
${manifest.extensions?.settings ? `  settings: ${dataLiteral(manifest.extensions.settings)},` : ''}
  ears: {
    // Only this pack's own: EARS also names its dependencies' and the SDK's, which they register
    entities: ${dataLiteral(_packEntityTypes(manifest))},
    relKinds: ${dataLiteral(_packRelationTypes(manifest))},
    roles: ${dataLiteral(_packRoles(manifest))},
    rowRules: ${rowRulesLiteral()},
  },
${hookEntries.length ? `  lifecycle: { ${hookEntries.map(({ name, binding }) => `${propertyKey(name, name)}: ${binding}`).join(', ')} },\n` : ''}${migrations.literal ? `  migrations: ${migrations.literal},` : ''}
};
${contractCheck}`;
  }

  // ── Frontend entry ─────────────────────────────────────────────

  function generateFrontendEntry(): string {
    const features = packFeatures(manifest);
    const surfaceFeatures = features.filter(f => f.surface);
    const featureForms = features.filter(f => f.settings?.form);
    const groupForms = Object.entries(manifest.extensions?.settings ?? {}).filter(([, definition]) => definition.form);
    const formImports = [
      ...featureForms.map(f => `import __settingsFeature_${f.id} from '${toImportPath(root, f.settings!.form!)}';`),
      ...groupForms.map(([id, definition]) => `import __settingsGroup_${id} from '${toImportPath(root, definition.form!)}';`),
    ];

    const surfaceImports: string[] = [];
    const surfaceDefinitions: string[] = [];
    for (const feature of surfaceFeatures) {
      const surface = feature.surface!;
      const binding = frontendBindings(surfaceBinding(feature.id), `features.${feature.id}.surface`);
      const { target, component } = binding;
      const properties = [`label: ${dataLiteral(surface.label)}`, `state: ${target(surface.state)}`];
      if (surface.icon) properties.push(`icon: ${binding.icon(surface.icon)}`);
      if (surface.canvas !== undefined) {
        const canvas = surface.canvas;
        properties.push(`canvas: ${typeof canvas === 'object' && 'routes' in canvas
          ? `{ ${Object.entries(canvas.routes).map(([route, reference]) => `${propertyKey(route)}: ${component(reference)}`).join(', ')} }`
          : component(canvas)}`);
      }
      for (const field of ['panel', 'chat'] as const) if (surface[field]) properties.push(`${field}: ${component(surface[field])}`);
      for (const field of ['isPinned', 'hotkeys', 'options'] as const) if (surface[field] !== undefined) properties.push(`${field}: ${dataLiteral(surface[field])}`);
      if (surface.fallbackPanel) properties.push(`fallbackPanel: { label: ${dataLiteral(surface.fallbackPanel.label)}, toggle: ${dataLiteral(surface.fallbackPanel.toggle)}, isShown: ${target(surface.fallbackPanel.isShown, 'fallbackPanel.isShown')} }`);
      surfaceImports.push(...binding.imports);
      surfaceDefinitions.push(`const ${surfaceBinding(feature.id)} = { ${properties.join(', ')} } satisfies SurfaceDefinition;`);
    }
    // The feature whose surface claims it, and no fallback: `features` is a map, so "the pack's first" would
    // be whatever key order JSON tooling left behind. A pack claiming none has no default surface, which the
    // shell handles (`defaultSurface: null`, `wantsDefaultSurface`)
    const defaultFeature = surfaceFeatures.find(f => f.surface?.default);
    // A designated feature with no surface is listed for its role, so a frontend send to that role resolves
    const featureEntries = features.filter((f) => f.surface || f.designation || f.settings?.form || f.references).map((f) => {
      const parts = f.surface ? [`surface: ${surfaceBinding(f.id)}`] : [];
      if (f.designation) parts.push(`designation: '${f.designation}'`);
      if (f === defaultFeature) parts.push('default: true');
      if (f.settings?.form) parts.push(`settingsForm: __settingsFeature_${f.id}`);
      if (f.references) parts.push(`references: FEATURE_REFERENCES[${dataLiteral(f.id)}]!`);
      return `    '${f.id}': { ${parts.join(', ')} },\n`;
    }).join('');

    const frontend = manifest.extensions ?? {};

    const blocks = blockDefinitionsFE();
    const artifacts = artifactDefinitionsFE();
    const steps = stepDefinitionsFor('frontend');

    const extraImports: string[] = [];
    if (features.some(feature => feature.references)) extraImports.push("import { FEATURE_REFERENCES } from './references.ts';");
    let nextEditorBinding = 0;
    const editorBinding = (label: string, target: string, callable = false) => {
      const { source, exportName, value } = valueExport(label, target);
      const expected = callable ? 'function' : 'object';
      if (value !== expected) throw new Error(`${label}: expected an ${callable ? 'exported function' : 'exported extension object'}`);
      const local = `__editor_${nextEditorBinding++}`;
      extraImports.push(`import { ${exportName} as ${local} } from '${toImportPath(root, source)}';`);
      return local;
    };
    const contributions = Object.entries(frontend.textEditor ?? {}).map(([id, contribution]) => {
      const label = `extensions.textEditor.${id}`;
      const parts: string[] = [];
      if (contribution.extensions) parts.push(`extensions: { ${Object.entries(contribution.extensions).map(([name, target]) =>
        `${propertyKey(name)}: ${editorBinding(`${label}.extensions.${name}`, target)}`).join(', ')} }`);
      if (contribution.popups) parts.push(`popups: { ${Object.entries(contribution.popups).map(([name, target]) => {
        const local = `__editor_${nextEditorBinding++}`;
        extraImports.push(`import ${local} from '${toImportPath(root, componentFile(`${label}.popups.${name}`, target))}';`);
        return `${propertyKey(name)}: ${local}`;
      }).join(', ')} }`);
      if (contribution.isSuggestionActive) parts.push(`isSuggestionActive: ${editorBinding(`${label}.isSuggestionActive`, contribution.isSuggestionActive, true)}`);
      return `${propertyKey(id)}: { ${parts.join(', ')} }`;
    });
    extraImports.push(...steps.imports, ...artifacts.imports, ...blocks.imports);
    const appExt = Object.entries(frontend.appExtensions ?? {});
    for (const [key, extPath] of appExt) {
      extraImports.push(`import __appExtension_${key} from '${toImportPath(root, extPath)}';`);
    }

    const regProps: string[] = [];
    if (groupForms.length) regProps.push(`  settingsForms: { ${groupForms.map(([id]) => `'${id}': __settingsGroup_${id}`).join(', ')} },`);
    if (steps.literal) regProps.push(`  steps: ${steps.literal},`);
    if (contributions.length) regProps.push(`  textEditor: { ${contributions.join(', ')} },`);
    if (appExt.length) {
      const extObj = appExt.map(([key]) => `${propertyKey(key, key)}: __appExtension_${key}`).join(', ');
      regProps.push(`  appExtensions: { ${extObj} },`);
    }
    if (artifacts.literal) regProps.push(`  artifacts: ${artifacts.literal},`);
    if (blocks.literal) regProps.push(`  blocks: ${blocks.literal},`);

    return `${HEADER}
import type { PackFERegistration${surfaceFeatures.length ? ', SurfaceDefinition' : ''} } from '@apackdev/sdk/fe';
import { bindSettings } from './settings-fe.ts';
${[...new Set([...surfaceImports, ...formImports, ...extraImports])].join('\n')}
${surfaceDefinitions.join('\n')}

export default {
  id: '${manifest.id}',
  declarationRevision: '${_declarationRevision(manifest)}',
  bindSettings,
  features: {${featureEntries ? `\n${featureEntries}  ` : ''}},
${regProps.join('\n')}
} satisfies PackFERegistration;
`;
  }

  // ── Registries ────────────────────────────────────────────────

  // The generated PackShapes, EntityName and Node override are part of the typed EARS contract
  // (packages/apack-sdk/TYPED-EARS.md)
  function packRegistry() {
    let depTypes = opts.depTypes;
    if (!depTypes) {
      depTypes = new Map<string, PackTypeManifest>();
      for (const [id, snap] of depSnapshots) depTypes.set(id, snap.types);
    }
    const depProvenance = new Map([...depSnapshots].map(([id, snap]) => [id, snap.provenance ?? {}] as const));
    return mergeRegistries(manifest.id, manifest, depTypes, depProvenance);
  }

  function generateEars(): string {
    const registry = packRegistry();
    const { imports: shapeImports, entries: shapeEntries } = entityShapeEntries();
    const depShapes = depTypeImports('PackEntityShapes');
    // The type names rows carry (the values; apack.json requires each key to equal its value)
    const entityNames = [...registry.entities.values()].map(({ value }) => `'${value}'`);
    const ownNodes = stepNodeTypes().length > 0;
    // Each dependency's facade names its step node types (never when it defines none)
    const depNodes = depTypeImports('PackStepNodes');
    const packNodes = [ownNodes ? 'NodeEntity' : 'never', ...depNodes.aliases].join(' | ');
    return `${emitEARS(manifest.id, registry)}
// ── Typed EARS helpers ──────────────────────────────────────────
// The query helpers typed against this pack's entity shapes (its own and its
// dependencies'), bound to the app's engine (\`boundEars\`). The call is pure, so bundles that only use the
// EARS constants above drop it.

import { defineEars, type EarsSchema, type ShapeOf, type ShortCode } from '@apackdev/ears';
import { boundEars } from '@apackdev/sdk/ears';
import type { SdkEntityShapes } from '@apackdev/sdk';
${ownNodes ? "import type { NodeEntity } from './types.ts';\n" : ''}${shapeImports.join('\n')}

${[...depShapes.imports, ...depNodes.imports].join('\n')}

/** Entity shapes this pack declares */
export type OwnEntityShapes = {
${shapeEntries.join('\n')}
};

/** The step node types of this pack and its dependencies; never when none defines one */
export type PackStepNodes = ${packNodes};

/**
 * Every entity shape this pack can read: the SDK's, its own and its dependencies'. Node is the union of
 * the step node types (NodeBase when no step defines one), not an intersection of each pack's.
 */
export type PackShapes = Omit<SdkEntityShapes & OwnEntityShapes${depShapes.aliases.map((a) => ` & ${a}`).join('')}, 'Node'> & {
  Node: [PackStepNodes] extends [never] ? SdkEntityShapes['Node'] : PackStepNodes;
};

/** An entity type's shape in this pack; undeclared types read as base fields plus \`unknown\` values. */
export type EntityShape<E extends string> = ShapeOf<PackShapes, E>;

/**
 * A numbered entity's short code type, \`ShortCode<prefix>\` from the prefix its manifest entry declares
 * (\`ShortCodeOf<'Thread'>\` is THR-<n>): this pack's, its dependencies' and the SDK's. Never for an entity
 * that isn't numbered, or one declared without a shape.
 */
export type ShortCodeOf<E extends keyof PackShapes> = PackShapes[E] extends { shortCode: infer C } ? C : never;

/**
 * Entity names the helpers below accept as literals: this pack's, its dependencies' and the SDK's. A name
 * known only at runtime (typed \`string\`) is accepted unchecked.
 */
export type EntityName = ${entityNames.join(' | ')};

/** What the helpers below check against: this pack's shapes, entity names, relation kinds and roles */
export interface PackSchema extends EarsSchema {
  shapes: PackShapes;
  names: EntityName;
  relKinds: EARS.RelKind;
  roles: EARS.RoleKind;
}

export const {
  query, create, upsert, write, transact, newId, getAttr,
} = /*#__PURE__*/ defineEars<PackSchema>(boundEars);
`;
  }

  // Definitions are manifest data; frontend accessors import schema-derived shapes as types.
  async function generateSettings(): Promise<string> {
    const groups = Object.entries(manifest.extensions?.settings ?? {});
    // Isolate referenced schema types too: two groups may both define a type named Project.
    const groupTypes = await Promise.all(groups.map(async ([name, definition]) =>
      `declare namespace __PackSettings_${toPascalCase(name)} {\n${await generateSettingsTypes(definition, 'Value')}\n}`));
    const features = packFeatures(manifest).filter(f => f.settings);
    const restricted = (kind: 'feature' | 'pack') => [...depSnapshots].flatMap(([packId, snapshot]) => {
      const declarations = kind === 'feature'
        ? packFeatures(snapshot.manifest).filter(feature => feature.settings).map(feature => [feature.id, feature.settings!] as const)
        : Object.entries(snapshot.manifest.extensions?.settings ?? {});
      return declarations.filter(([, definition]) => definition.access === 'owner').map(([id]) => dataLiteral(`${packId}/${id}`));
    }).join(' | ') || 'never';
    const featureTypes = await Promise.all(features.map(async f =>
      `declare namespace __FeatureSettings_${toPascalCase(f.id)} {\n${await generateSettingsTypes(f.settings!, 'Value')}\n}`));
    const entries = features.map(f => `  '${f.id}': __FeatureSettings_${toPascalCase(f.id)}.Value;`);
    const groupDeps = depTypeImports('PackGroupSettings');
    const groupQualified = depIds.map(id => `{ [K in keyof ${depAlias(id, 'PackGroupSettings')} & string as \`${id}/\${K}\`]: ${depAlias(id, 'PackGroupSettings')}[K] }`);
    const deps = depTypeImports('PackFeatureSettings');
    const qualified = depIds.map(id => `{ [K in keyof ${depAlias(id, 'PackFeatureSettings')} & string as \`${id}/\${K}\`]: ${depAlias(id, 'PackFeatureSettings')}[K] }`);
    return `${HEADER}
import type { SettingUpdate as __SettingUpdate, SettingsHandle, ReadonlySettingsHandle } from '@apackdev/sdk/types';
import { ref } from './ref.ts';
import { runtimeServices } from './runtime-services.ts';
${deps.imports}
${groupDeps.imports}

${groupTypes.join('\n')}
${featureTypes.join('\n')}
/** Local pack preference groups, inferred from schemas rather than default literals. */
export type PackGroupSettings = {
${groups.map(([name]) => `  '${name}': __PackSettings_${toPascalCase(name)}.Value;`).join('\n')}
};

export type PackFeatureSettings = {
${entries.join('\n')}
};
type AvailableSettings = PackFeatureSettings & { [K in keyof PackFeatureSettings & string as \`${manifest.id}/\${K}\`]: PackFeatureSettings[K] }${qualified.map(t => ` & ${t}`).join('')};
export type SettingsName = keyof AvailableSettings & string;
export type SettingsOf<K extends keyof AvailableSettings> = AvailableSettings[K];
export type SettingUpdate<K extends keyof AvailableSettings> = __SettingUpdate<SettingsOf<K>>;
export type ReadonlyFeatureSettingsName = ${restricted('feature')};
export type FeatureSettingsHandle<K extends SettingsName> = K extends ReadonlyFeatureSettingsName
  ? ReadonlySettingsHandle<SettingsOf<K>> : SettingsHandle<SettingsOf<K>>;

export const featureSettings = {
  forFeature: <K extends SettingsName>(name: K): FeatureSettingsHandle<K> =>
    runtimeServices.settingsHandle<SettingsOf<K>>({ kind: 'feature', featureRef: ref(name) }) as FeatureSettingsHandle<K>,
};

type AvailableGroups = PackGroupSettings & { [K in keyof PackGroupSettings & string as \`${manifest.id}/\${K}\`]: PackGroupSettings[K] }${groupQualified.map(t => ` & ${t}`).join('')};
export type PackSettingsName = keyof AvailableGroups & string;
export type ReadonlyPackSettingsName = ${restricted('pack')};
export type PackSettingsHandle<K extends PackSettingsName> = K extends ReadonlyPackSettingsName
  ? ReadonlySettingsHandle<PackSettingsOf<K>> : SettingsHandle<PackSettingsOf<K>>;
export type PackSettingsOf<K extends keyof AvailableGroups> = AvailableGroups[K];
export const packSettings = {
  forGroup: <K extends PackSettingsName>(name: K): PackSettingsHandle<K> => {
    const selector: string = name;
    const qualified = selector.includes('/') ? selector : ${dataLiteral(manifest.id)} + '/' + selector;
    const [packId, groupId] = qualified.split('/');
    return runtimeServices.settingsHandle<PackSettingsOf<K>>({ kind: 'pack', packId, groupId }) as PackSettingsHandle<K>;
  },
};

`;
  }

  function generateSettingsFe(): string {
    return `${HEADER}
import { _createFeSettings, type FeSettingsHandle, type ReadonlyFeSettingsHandle } from '@apackdev/sdk/fe';
import type { AppSettings } from '@apackdev/sdk/types';
import { ref } from './ref.ts';
import type { SettingsOf, SettingsName, ReadonlyFeatureSettingsName, PackSettingsOf, PackSettingsName, ReadonlyPackSettingsName } from './settings.ts';
export type { SettingsOf, SettingUpdate, PackSettingsOf, PackSettingsName } from './settings.ts';

const frontendSettings = _createFeSettings();
export const bindSettings = frontendSettings.bindSettings;

export const useAppSettings = (): FeSettingsHandle<AppSettings> =>
  frontendSettings.useSettings<AppSettings>({ kind: 'app' });

export type FeatureSettingsHandle<K extends SettingsName> = K extends ReadonlyFeatureSettingsName
  ? ReadonlyFeSettingsHandle<SettingsOf<K>> : FeSettingsHandle<SettingsOf<K>>;
export type PackSettingsHandle<K extends PackSettingsName> = K extends ReadonlyPackSettingsName
  ? ReadonlyFeSettingsHandle<PackSettingsOf<K>> : FeSettingsHandle<PackSettingsOf<K>>;

export const useSettings = <K extends SettingsName>(name: K): FeatureSettingsHandle<K> =>
  frontendSettings.useSettings<SettingsOf<K>>({ kind: 'feature', featureRef: ref(name) }) as FeatureSettingsHandle<K>;

export const usePackSettings = <K extends PackSettingsName>(name: K): PackSettingsHandle<K> => {
  const selector: string = name;
    const qualified = selector.includes('/') ? selector : ${dataLiteral(manifest.id)} + '/' + selector;
  const [packId, groupId] = qualified.split('/');
  return frontendSettings.useSettings<PackSettingsOf<K>>({ kind: 'pack', packId, groupId }) as PackSettingsHandle<K>;
};
`;
  }

  function generateRef(): string {
    const names = [...new Set([
      ...packFeatures(manifest).flatMap((f) => [f.id, `${manifest.id}/${f.id}`]),
      ...[...depSnapshots].flatMap(([depId, snap]) => packFeatures(snap.manifest).map((f) => `${depId}/${f.id}`)),
      ...Object.keys(_mergeProvenance('surfaces', [...depSnapshots])),
      ...Object.keys(HOST_SURFACE_EVENT_TYPES),
      ...Object.keys(HOST_SYSTEM_EVENT_TYPES),
    ])];
    return `${HEADER}
import { resolveName, type FeatureRef } from '@apackdev/sdk/ids';

/** Own features accept local IDs or qualified refs; dependencies and host features use qualified refs. */
export type FeatureName = ${names.map((name) => `'${name}'`).join(' | ')};

/** This pack's id, as \`apack.json\` declares it: what its sends stamp as \`Message.from\` */
export const packId = '${manifest.id}';

/** The ref of a feature this pack's code names */
export const ref = (name: FeatureName): FeatureRef => resolveName(name, packId);
`;
  }

  // A pack's own data directory, with its id bound — the same shape as `ref` above and as the sends in
  // events.ts, so a pack never writes its own id and never reaches another pack's data.
  function generatePaths(): string {
    return `${HEADER}
import { _packDataDir } from '@apackdev/sdk/utils';

/**
 * A directory this pack keeps data in, under its own namespace (\`pack-data/${manifest.id}/<name>\`).
 *
 * \`name\` is one directory: letters, digits, dot, dash and underscore, up to 64 characters. A separator or a
 * traversal throws, because the name used to be joined straight onto the directory Chromium also writes to.
 */
export const getDataDirPath = (name: string): string => _packDataDir('${manifest.id}', name);
`;
  }

  // Frontend helpers that take the names this pack's code writes: its own surfaces by feature id, those its
  // dependencies declare as `<packId>/<featureId>`. Kept apart from events.ts, which backend systems import,
  // because these reach the frontend SDK.
  function generateFe(): string {
    const features = packFeatures(manifest);
    const surfaceFeatures = features.filter(f => f.surface);
    if (!publishesSurfaceState(manifest, manifest.id)) return '';
    const own = surfaceFeatures.map(f => f.id);
    const surfaces = [...own, ...Object.keys(_mergeProvenance('surfaces', [...depSnapshots])).sort()].map(name => `'${name}'`);

    // Each own surface's published state, from the same contract the inbox is read from. A feature that declares no
    // contract publishes nothing, and `never` is what a selector for it gets.
    const contracts = contractsOf(surfaceFeatures, 'surface');
    const stateImports = [...contracts]
      .map(([id, contract]) => `import type { ${contract.exportName} as __state_contract_${id} } from '${toImportPath(root, contract.source)}';`)
      .join('\n');
    const ownState = surfaceFeatures
      .map(f => `  '${f.id}': ${contracts.has(f.id) ? `SurfaceStateOf<__state_contract_${f.id}>` : 'never'};`)
      .join('\n');
    const depState = depTypeImports('PackSurfaceState', depsWithSurfaces);
    const qualifiedState = depsWithSurfaces.map((depId) => `Qualified<'${depId}', ${depAlias(depId, 'PackSurfaceState')}>`);

    return `${HEADER}
import { surfaceIsRunning, readUntypedSurfaceState, untypedOpenSurface, useUntypedSurfaceState, type SurfaceStateOf } from '@apackdev/sdk/fe';
${qualifiedState.length > 0 ? "import type { Qualified } from '@apackdev/sdk/events';\n" : ''}import type { Ref } from 'vue';
import type { SendableSurfaceEvents } from './events.ts';
import { ref } from './ref.ts';
${stateImports}
${depState.imports.join('\n')}

/**
 * A surface as this pack's code names it: its own by feature id, a dependency's as \`<packId>/<featureId>\`.
 * A surface named by data (a link's target, a registered surface's \`id\`) opens through \`untypedOpenSurface\`
 * from \`@apackdev/sdk/fe\`, which checks it at runtime instead.
 */
export type SurfaceName = ${surfaces.join(' | ')};

/** Feature id → the state this pack's surface for that feature publishes (dependents name it \`${manifest.id}/<feature>\`). */
export type PackSurfaceState = {
${ownState}
};

/** A surface of this pack, whose actor is running whenever this pack's frontend is */
export type OwnSurfaceName = keyof PackSurfaceState & string;
${qualifiedState.length > 0 ? `
/** A dependency's surface, whose frontend may still be loading */
type DependencySurfaceState = ${qualifiedState.join(' & ')};
export type DependencySurfaceName = keyof DependencySurfaceState & string;
` : ''}
/**
 * Opens a surface and hands its actor \`event\` once it's running; throws if no such surface is registered.
 *
 * The events are the target's inbox, the same one \`sendToSurface\` takes — this delivers to that surface's actor
 * too, so leaving it open would be a second, unchecked door to what the inbox exists to declare. A pack's own
 * surfaces take their own feature's system's events as well, so a UI command a machine handles
 * (\`FLOW.SELECT\`, \`TAB.CREATE\`) needs declaring only where another pack sends it.
 */
export function openSurface<Name extends SurfaceName>(
  name: Name,
  event?: SendableSurfaceEvents[Name] | SendableSurfaceEvents[Name][],
): void {
  untypedOpenSurface(ref(name), event);
}

const OWN_SURFACES = new Set<string>([${own.map(id => `'${id}'`).join(', ')}]);

/**
 * The ref to read at, checked where this pack's own surfaces are concerned. Their overloads say the value is never
 * \`undefined\`, and this is what keeps that true instead of handing back an \`undefined\` the type denies. A
 * dependency's may legitimately not be running yet, and reads as \`undefined\` until its frontend loads.
 *
 * **The spawn is the shell's, not the registration's**, which bounds where "never running is a bug" holds. The
 * shell spawns a pack's surfaces when it handles the \`PACK_FRONTEND_LOADED\` it is sent *after*
 * \`registerPackFE\` hands them back — so inside a surface's own views the surface is certainly running, while a
 * component the host renders outside any of them (an app extension, an artifact viewer) can be drawn in
 * between. Such a component reads another surface with the \`untyped\` readers, which answer \`undefined\`; the
 * throw below says so.
 */
function ownSurface(name: SurfaceName): string {
  const target = ref(name);
  if (OWN_SURFACES.has(name) && !surfaceIsRunning(target)) {
    throw new Error(\`No surface is running at "\${target}", which is this pack's own. Inside that surface's own views this is a bug rather than a state to render. A component the host renders — an app extension, an artifact viewer — can be drawn before the shell has spawned the surfaces it just registered, and there it is a state: read with readUntypedSurfaceState or useUntypedSurfaceState, which answer undefined.\`);
  }
  return target;
}

/**
 * A value from the state a surface publishes, followed until the calling scope is disposed — so it runs in a
 * component's setup or an effect scope, never inside a \`computed\`. The selector takes that surface's published
 * state, not an XState snapshot.
 *
 * This pack's own surfaces are spawned in the step that registers them, so one of those is always running and the
 * value is never \`undefined\`. A dependency's frontend may still be loading, so reading one of its surfaces gives
 * \`undefined\` until it arrives — that is a state to render, not an error.
 *
 * \`useUntypedSurfaceState\` from \`@apackdev/sdk/fe\` is the escape hatch, for a ref that arrives as data.
 */
export function useSurfaceState<Name extends OwnSurfaceName, TSelected>(name: Name, selector: (state: PackSurfaceState[Name]) => TSelected): Readonly<Ref<TSelected>>;${qualifiedState.length > 0 ? `
export function useSurfaceState<Name extends DependencySurfaceName, TSelected>(name: Name, selector: (state: DependencySurfaceState[Name]) => TSelected): Readonly<Ref<TSelected | undefined>>;` : ''}
export function useSurfaceState(name: SurfaceName, selector: (state: never) => unknown): Readonly<Ref<unknown>> {
  return useUntypedSurfaceState(ownSurface(name), (snapshot: { context: never }) => selector(snapshot.context));
}

/** The same read, once, for code outside a reactive scope — a machine's action, an event handler. */
export function readSurfaceState<Name extends OwnSurfaceName, TSelected>(name: Name, selector: (state: PackSurfaceState[Name]) => TSelected): TSelected;${qualifiedState.length > 0 ? `
export function readSurfaceState<Name extends DependencySurfaceName, TSelected>(name: Name, selector: (state: DependencySurfaceState[Name]) => TSelected): TSelected | undefined;` : ''}
export function readSurfaceState(name: SurfaceName, selector: (state: never) => unknown): unknown {
  return readUntypedSurfaceState(ownSurface(name), (snapshot: { context: never }) => selector(snapshot.context));
}
`;
  }


  /**
   * Surface id → the events that surface receives: what its own feature's system sends it, plus the inbox the
   * surface's `Contract` declares (`features[].surface.contract`). Only features that have a surface get a key: nothing can
   * receive an event sent to a feature that has none.
   *
   * Every dependency's surfaces and the host's are addressable with no declaration on this side — the receiver's
   * own `PackSurfaceEvents` says what it takes, as a system's `PackSystemEvents` does. Only the pack that owns a
   * surface widens what it receives, since only it can handle a new event, and only the declared half crosses:
   * what passes between a feature's own two halves is nobody else's to send.
   */
  function generateEvents(): string {
    const features = packFeatures(manifest);
    const systemFeatures = features.filter(f => f.system);
    const surfaceFeatures = features.filter(f => f.surface);
    const hasSystems = systemFeatures.length > 0;

    // Each system's sent events, read from its spec: the one place they are declared
    const outgoingAliases = surfaceFeatures.filter(f => f.system)
      .map(f => `type __events_${f.id} = OutgoingEventsOf<__SystemContracts['${f.id}']>;`)
      .join('\n');
    // Each surface's declared contract, from the leaf module apack.json names — never the surface module itself,
    // whose machine imports cycle back through this file
    const contracts = contractsOf(surfaceFeatures, 'surface');
    const acceptsImports = [...contracts]
      .map(([id, contract]) => `import type { ${contract.exportName} as __contract_${id} } from '${toImportPath(root, contract.source)}';`)
      .join('\n');
    const acceptsAliases = surfaceFeatures
      .flatMap(f => contracts.has(f.id)
        ? [`type __accepts_${f.id} = SurfaceInboxOf<__contract_${f.id}>;`, `type __public_${f.id} = PublicSurfaceInboxOf<__contract_${f.id}>;`]
        : [`type __accepts_${f.id} = never;`, `type __public_${f.id} = never;`])
      .join('\n');
    // A surface receives what its own feature's system sends it, and whatever it declares anyone else may send
    const entries = surfaceFeatures.map((f) => {
      const ownSystem = systemFeatures.some(s => s.id === f.id) ? [`__events_${f.id}`] : [];
      return `  '${f.id}': ${[...ownSystem, `__accepts_${f.id}`].join(' | ')};`;
    }).join('\n');
    const systemEntries = systemFeatures.map(f => `  '${f.id}': IncomingEventsOf<__SystemContracts['${f.id}']>;`).join('\n');
    const pack = `'${manifest.id}'`;
    const depSurfaces = depTypeImports('PackSurfaceEvents');
    const depSystems = depTypeImports('PackSystemEvents');
    // Every map keyed by ref; the maps pack code sends with name the pack's own features by bare id instead (`WithOwnNames`)
    const qualifiedSurfaces = [
      `Qualified<${pack}, OwnSurfaceEvents>`,
      ...depIds.map((depId) => `Qualified<'${depId}', ${depAlias(depId, 'PackSurfaceEvents')}>`),
      'HostSurfaceEvents',
    ].join(' & ');
    const qualifiedSystems = [
      `Qualified<${pack}, PackSystemEvents>`,
      ...depIds.map((depId) => `Qualified<'${depId}', ${depAlias(depId, 'PackSystemEvents')}>`),
      'HostSystemEvents',
    ].join(' & ');
    return `${HEADER}
import { defineEvents, type HostSurfaceEvents, type HostSystemEvents, type IncomingEventsOf${outgoingAliases ? ', type OutgoingEventsOf' : ''}${contracts.size > 0 ? ', type SurfaceInboxOf, type PublicSurfaceInboxOf' : ''}, type Qualified, type WithOwnNames } from '@apackdev/sdk/events';
${hasSystems ? `import type { SystemContracts as __SystemContracts } from './system-specs.ts';\n` : ''}${acceptsImports ? `${acceptsImports}\n` : ''}${[...depSurfaces.imports, ...depSystems.imports].join('\n')}
${[outgoingAliases, acceptsAliases].filter(Boolean).join('\n')}

/**
 * Surface id → the events that surface receives: its own feature's system's, and every audience of the inbox its
 * contract declares. This pack's own sends are checked against it, so a sibling may send the \`pack\` half.
 */
export type OwnSurfaceEvents = {
${entries}
};

/**
 * Feature id → the \`public\` half of the inbox this pack's surface declares (dependents name it
 * \`${manifest.id}/<feature>\`). Neither its own system's events nor its \`pack\` audience are here: the first is
 * between the two halves of one feature, the second between this pack's features. What is left is what a dependent
 * pack may send, and it mirrors \`PackSystemEvents\`.
 */
export type PackSurfaceEvents = {
${surfaceFeatures.map(f => `  '${f.id}': __public_${f.id};`).join('\n')}
};

/** Feature id → the events this pack's system for that feature receives (dependents name it \`${manifest.id}/<feature>\`). */
export type PackSystemEvents = {
${systemEntries}
};

/**
 * Every surface this pack's code can send to, by ref: its own, its dependencies' and the host's. A surface owned
 * elsewhere takes the inbox its own pack declares — a pack widens only its own. Actions (\`services.emitter\`)
 * send with it.
 */
export type QualifiedSurfaceEvents = ${qualifiedSurfaces};

/** Every system this pack's code can send to, by ref: its own, its dependencies' and the host's. */
export type QualifiedSystemEvents = ${qualifiedSystems};

/** The surfaces this pack's code sends to: \`QualifiedSurfaceEvents\`, with its own named by feature id instead of ref */
export type SendableSurfaceEvents = WithOwnNames<${pack}, QualifiedSurfaceEvents>;

/** The systems this pack's code sends to: \`QualifiedSystemEvents\`, with its own named by feature id instead of ref */
export type SendableSystemEvents = WithOwnNames<${pack}, QualifiedSystemEvents>;

export const { broadcastToSurface, sendToWindow, sendToSurface, sendToSystem } = /*#__PURE__*/ defineEvents<SendableSurfaceEvents, SendableSystemEvents>('${manifest.id}');
`;
  }

  /** The events each system receives and sends, from its spec; type-only, so facades carry no machines or contexts */
  function generateSystemSpecs(): string {
    const systemFeatures = packFeatures(manifest).filter(f => f.system);
    if (!systemFeatures.length) return '';
    const contracts = contractsOf(systemFeatures, 'system');
    const imports = [...contracts]
      .map(([id, contract]) => `import type { ${contract.exportName} as __system_contract_${id} } from '${toImportPath(root, contract.source)}';`)
      .join('\n');
    const entries = systemFeatures
      .map(f => `  '${f.id}': ${contracts.has(f.id) ? `__system_contract_${f.id}` : 'never'};`)
      .join('\n');
    return `${HEADER}
// Type-only: #generated/events reads each system's incoming and outgoing events from its feature's contract, by
// feature id. It imports the contracts and never the system modules — those import #generated/events themselves,
// so reading them here would put the machine in front of the file that describes it.
${imports}

export type SystemContracts = {
${entries}
};
`;
  }

  /** Step node shapes come only from the explicitly declared type modules. */
  function stepNodeTypes(): Array<{ name: string; importPath: string }> {
    const sources = [...new Set(stepDefinitions.flatMap(step => step.types === undefined ? [] : [step.types]))];
    return sources.flatMap(source =>
      [...readFileSync(join(root, source), 'utf-8').matchAll(/export\s+interface\s+(\w+)\s+extends\s+NodeBase\b/g)]
        .map(m => ({ name: m[1], importPath: toImportPath(root, source) })));
  }

  function generateTypes(): string {
    // Type contributions are independent of systems; only explicitly declared modules enter the barrel.
    const perFeature = packFeatures(manifest).flatMap(({ id, types }) => {
      if (types === undefined) return [];
      const source = resolveTypeModule(root, types, `Feature "${id}": types`);
      return [`export type * from '${toImportPath(root, source)}';`];
    }).join('\n\n');

    const nodeTypes = stepNodeTypes();
    const nodeEntity = nodeTypes.length
      ? `${nodeTypes.map(n => `import type { ${n.name} } from '${n.importPath}';`).join('\n')}\n\n` +
        "/** Discriminated union (on `nodeType`) of this pack's step node entities. */\n" +
        `export type NodeEntity = ${nodeTypes.map(n => n.name).join(' | ')};\n`
      : '';

    // Only this pack's own types: SDK types are imported from the SDK
    return `${HEADER}
${perFeature}
${nodeEntity}`;
  }

  function generateServices(): string {
    const provided = _packServiceDeclarations({ id: manifest.id, features: manifest.features, services: manifest.extensions?.services });
    const imports: string[] = [];
    const entries: string[] = [];

    // Imports are aliased so a service name can't shadow a generated binding (e.g. `services`)
    function addService(key: string, target: string) {
      const { source, exportName } = serviceExport(key, target);
      const local = `__service_${key}`;
      imports.push(`import { ${exportName} as ${local} } from '${toImportPath(root, source)}';`);
      entries.push(`  ${propertyKey(key, key)}: ${local},`);
    }

    for (const { name, target } of provided) addService(name, target);

    const deps = depTypeImports('Services');
    const hostKeys = selectedServices.filter(entry => entry.packId === 'host' && !['repository', 'emitter'].includes(entry.name))
      .map(entry => JSON.stringify(entry.name)).join(' | ');
    const selectedDependencies = depIds.flatMap((id, index) => {
      const keys = selectedServices.filter(entry => entry.packId === id).map(entry => JSON.stringify(entry.name));
      return keys.length ? [`Pick<${deps.aliases[index]}, ${keys.join(' | ')}>`] : [];
    });

    return `${HEADER}
import type { z } from 'zod';
import type { EARS } from '@apackdev/ears';
import type { HostServices, PackServiceAccess } from '@apackdev/sdk/services';
import { runtimeServices } from './runtime-services.ts';
import type { TypedSendToSurface, TypedSendToWindow, TypedSendToSystem } from '@apackdev/sdk/events';
import type { Repositories } from './repository.ts';
import type { QualifiedSurfaceEvents, QualifiedSystemEvents } from './events.ts';
${imports.join('\n')}
${deps.imports.filter((_, index) => selectedServices.some(entry => entry.packId === depIds[index])).join('\n')}

export const featureServices = {
${entries.join('\n')}
};

/**
 * \`services.emitter\`, typed with this pack's events. A system and a surface are both named
 * \`<pack>/<feature>\`, this pack's own and the host's too; a system may also be a role.
 *
 * Naming its own pack is the point, not a gap left by the action having no pack scope. An action is content,
 * not source: a row a user can edit in the Actions surface, read in the DB console, export to a content file and
 * copy into another pack. A bare name would rebind on that copy — \`'threads'\` quietly meaning the new pack's
 * feature, or nothing — where a ref that no longer fits is wrong visibly, and is refused at the bus rather
 * than doing something else.
 */
export type PackEmitter = Omit<HostServices['emitter'], 'broadcastToSurface' | 'sendToWindow' | 'sendToSystem'> & {
  broadcastToSurface: TypedSendToSurface<QualifiedSurfaceEvents>;
  sendToWindow: TypedSendToWindow<QualifiedSurfaceEvents>;
  sendToSystem: TypedSendToSystem<QualifiedSystemEvents>;
};

/**
 * The declared service selection: own services, the SDK baseline and explicitly consumed APIs.
 * The featureServices value itself stays feature-only.
 */
export type Services = typeof featureServices & Pick<HostServices, ${hostKeys}> & { repository: Repositories; emitter: PackEmitter }${selectedDependencies.map(type => ` & ${type}`).join('')};

/** The host's services proxy, typed with this pack's feature services. */
export let services = runtimeServices.services as unknown as Services;
export let servicesForAction = runtimeServices.servicesForAction as (label: string) => Services;

/** Rebinding publishes a fresh facade; retained roots keep their retired lifetime. */
export function bindServices(source: PackServiceAccess): () => void {
  const dispose = runtimeServices.bindServices(source);
  services = runtimeServices.services as unknown as Services;
  servicesForAction = runtimeServices.servicesForAction as (label: string) => Services;
  return () => {
    try { dispose(); }
    finally {
      services = runtimeServices.services as unknown as Services;
      servicesForAction = runtimeServices.servicesForAction as (label: string) => Services;
    }
  };
}
export type Z = typeof z;
export type EntityId = EARS.EntityId;
`;
  }

  // ── Repositories ──────────────────────────────────────────────

  /** [name, source module specifier, export name] of each repository the manifest declares */
  function repositoryEntries(): [string, string, string][] {
    const seen = new Map<string, string>();
    return packFeatures(manifest).flatMap(f => Object.entries(f.repositories ?? {}).map(([name, target]) => {
      if (seen.has(name)) throw new Error(`Repository "${name}" is declared by features "${seen.get(name)}" and "${f.id}"`);
      seen.set(name, f.id);
      const { source, exportName } = valueExport(`Repository "${name}" (feature "${f.id}")`, target);
      return [name, toImportPath(root, source), exportName] as [string, string, string];
    }));
  }

  function hasRepositories(): boolean {
    return packFeatures(manifest).some(f => Object.keys(f.repositories ?? {}).length > 0);
  }

  /** `repository`, typed with this pack's repositories and its dependencies'. Type-only imports: no cycles. */
  function generateRepository(): string {
    const entries = repositoryEntries();
    const deps = depTypeImports('Repositories');
    return `${HEADER}
import { repository as registeredRepository } from '@apackdev/sdk/services';
${entries.map(([name, path, exportName]) => `import type { ${exportName} as __repo_${name} } from '${path}';`).join('\n')}
${deps.imports.join('\n')}

/** The repositories this pack declares (apack.json features[].repositories) */
export type OwnRepositories = {
${entries.map(([name]) => `  ${propertyKey(name, name)}: typeof __repo_${name};`).join('\n')}
};

/** Every repository this pack can use: its own and its dependencies' */
export type Repositories = OwnRepositories${deps.aliases.map(a => ` & ${a}`).join('')};

export const repository = registeredRepository as unknown as Repositories;
`;
  }

  /** This pack's repositories by name, which its registration carries (the app holds them with its other contributions) */
  function generateRepositories(): string {
    const entries = repositoryEntries();
    if (entries.length === 0) return '';
    return `${HEADER}
${entries.map(([name, path, exportName]) => `import { ${exportName} as __repo_${name} } from '${path}';`).join('\n')}

export const repositories: Record<string, unknown> = {
${entries.map(([name]) => `  ${propertyKey(name, name)}: __repo_${name},`).join('\n')}
};
`;
  }

  /**
   * The pack's content runtime (entity types, relation kinds, repositories, content writers), what applying its
   * entity types needs outside the app. \`apack pack build\` bundles it into dist/build/content-runtime.mjs for
   * dependents' unit tests; the pack's own tests import it from #generated/content-runtime.
   */
  function generateContentRuntime(): string {
    const repositories = repositoryEntries();
    const hooks = contentWriterEntries();
    return `${HEADER}
import type { ContentRuntime } from '@apackdev/sdk/framework';
${repositories.map(([name, path, exportName]) => `import { ${exportName} as __repo_${name} } from '${path}';`).join('\n')}
${hooks.map(([, path, exportName], i) => `import { ${exportName} as __contentWriter_${i} } from '${path}';`).join('\n')}

export const contentRuntime: ContentRuntime = {
  id: ${dataLiteral(manifest.id)},
  declarationRevision: ${dataLiteral(_declarationRevision(manifest))},
  entities: ${dataLiteral(_packEntityTypes(manifest))},
  relKinds: ${dataLiteral(_packRelationTypes(manifest))},
  roles: ${dataLiteral(_packRoles(manifest))},
  rowRules: ${rowRulesLiteral()},
  repositories: { ${repositories.map(([name]) => `${propertyKey(name, name)}: __repo_${name}`).join(', ')} },
  contentWriters: { ${hooks.map(([entity], i) => `${propertyKey(entity)}: __contentWriter_${i}`).join(', ')} },
};
`;
  }

  /** The facade types dependents import, bundled into dist/types/pack-types.d.ts by \`apack pack build\` */
  function generatePackTypes(): string {
    // `fe.ts` is generated only for a pack with surfaces, and `PackSurfaceState` lives there: a pack with none has no
    // surface state to publish, and naming the module anyway leaves the facade bundle unable to resolve it.
    const hasSurfaces = publishesSurfaceState(manifest, manifest.id);
    return `${HEADER}
export type { PackShapes as PackEntityShapes, PackStepNodes } from './ears.ts';
export type { PackSurfaceEvents, PackSystemEvents } from './events.ts';
${hasSurfaces ? "export type { PackSurfaceState } from './fe.ts';\n" : ''}export type { Services } from './services.ts';
export type { Repositories } from './repository.ts';
export type { PackFeatureSettings, PackGroupSettings } from './settings.ts';
`;
  }

  function generateReferences(): string {
    const claims = { referenceTypes: new Map<string, string>(), referenceCategories: new Map<string, string>() };
    for (const kind of Object.keys(claims) as (keyof typeof claims)[]) {
      const claim = (name: string, owner: string) => {
        const previous = claims[kind].get(name);
        if (previous !== undefined && previous !== owner) throw new Error(`${kind} "${name}" declared by both packs "${previous}" and "${owner}"`);
        claims[kind].set(name, owner);
      };
      for (const [depId, snapshot] of depSnapshots) {
        for (const [name, owner] of Object.entries(snapshot.provenance?.[kind] ?? {})) claim(name, owner);
        for (const name of PROVENANCE_KINDS[kind](snapshot.manifest)) claim(name, depId);
      }
      for (const name of PROVENANCE_KINDS[kind](manifest)) claim(name, manifest.id);
    }
    for (const feature of packFeatures(manifest)) {
      for (const [name, type] of Object.entries(feature.references?.types ?? {})) {
        if (!claims.referenceCategories.has(type.category)) throw new Error(`features.${feature.id}.references.types.${name}: undeclared category "${type.category}"`);
      }
    }
    const imports: string[] = [];
    const featureBindings: string[] = [];
    let lazyComponents = false;
    let nextBinding = 0;
    const bind = (label: string, reference: string, callable: boolean, lazy = false): string => {
      const { source, exportName: exported } = _parseModuleReference(reference, label, 'default');
      if (source!.endsWith('.vue')) {
        if (callable || exported !== 'default') throw new Error(`${label}: expected a function export, or a default component export`);
        if (!findSourceModule(root, source, ['.vue'], label)) throw new Error(`${label}: no component found at ${source}`);
      } else {
        const file = sourceFileOf(source, label);
        if (!file) throw new Error(`${label}: no module found at ${source}`);
        const value = exportOf(file, exported)?.value;
        if (!value || (callable && value !== 'function')) throw new Error(`${label}: ${source} must export ${exported} as ${callable ? 'a function' : 'a value'}`);
      }
      if (lazy) {
        lazyComponents = true;
        return `defineAsyncComponent(() => import(${dataLiteral(toImportPath(root, source!))}).then(module => module.${exported}))`;
      }
      const binding = `__reference_${nextBinding++}`;
      const from = dataLiteral(toImportPath(root, source!));
      imports.push(exported === 'default' ? `import ${binding} from ${from};` : `import { ${exported} as ${binding} } from ${from};`);
      return binding;
    };
    const icon = (label: string, declaration: NonNullable<PackFeature['references']>['types'][string]['icon']): string => {
      if (typeof declaration === 'string') {
        const binding = `__reference_${nextBinding++}`;
        imports.push(`import { ${declaration} as ${binding} } from 'lucide-vue-next';`);
        return binding;
      }
      return bind(label, declaration.entry, false, declaration.load === 'lazy');
    };
    for (const feature of packFeatures(manifest)) {
      const references = feature.references;
      if (!references) continue;
      const types: string[] = [];
      const categories: string[] = [];
      for (const [name, type] of Object.entries(references.types)) {
        const label = `features.${feature.id}.references.types.${name}`;
        const { icon: declaredIcon, ...data } = type;
        types.push(`  ${propertyKey(name)}: { ...${dataLiteral(data)}, icon: ${icon(`${label}.icon`, declaredIcon)} },`);
      }
      for (const [name, category] of Object.entries(references.categories)) {
        const label = `features.${feature.id}.references.categories.${name}`;
        categories.push(`  ${propertyKey(name)}: { label: ${dataLiteral(category.label)}, icon: ${icon(`${label}.icon`, category.icon)}, useItems: ${bind(`${label}.useItems`, category.useItems, true)} },`);
      }
      featureBindings.push(`  ${propertyKey(feature.id)}: { types: {\n${types.join('\n')}\n  }, categories: {\n${categories.join('\n')}\n  } },`);
    }
    if (lazyComponents) imports.push("import { defineAsyncComponent } from 'vue';");
    return `${HEADER}
import type { ReferenceBindings } from '@apackdev/sdk/fe/references';
${imports.join('\n')}
export const FEATURE_REFERENCES: Record<string, ReferenceBindings> = {
${featureBindings.join('\n')}
};

`;
  }

  function generateAppliers(): string {
    const entityNames = new Set(packRegistry().entities.keys());
    const applierImports = new Set<string>();
    const packImports: string[] = [];
    const registrations: string[] = [];

    // This pack's own formats are checked whether or not a source uses them: dependents may
    for (const [name, format] of Object.entries(manifest.content?.formats ?? {})) {
      for (const entity of formatEntities(format)) {
        if (!entityNames.has(entity)) {
          throw new Error(`Content format "${name}": entity "${entity}" isn't declared by this pack, its dependencies or the SDK`);
        }
      }
    }

    /** A pack module's `apply`, registered under the content key */
    const packApplier = (key: string, applier: string) => {
      const importName = `__applier_${toIdentifier(key)}`;
      packImports.push(`import { apply as ${importName} } from '${toImportPath(root, applier)}';`);
      registrations.push(`{ key: ${dataLiteral(key)}, apply: ${importName} }`);
    };

    for (const [key, source] of Object.entries(resolvedContentSources())) {
      if (source.kind === 'applier') {
        packApplier(key, source.applier);
        continue;
      }

      /**
       * The declared commands apply as ordinary Document content, so removal, offers and the three-way
       * merge are the machinery every other entry uses — there is no second path for a command.
       */
      if (source.kind === 'declared') {
        applierImports.add('createFormatApplier');
        const options = { key, entities: [SDK_ENTITIES.Document], identity: ['name'], ...(source.onUserEdit && { onUserEdit: source.onUserEdit }) };
        registrations.push(`createFormatApplier(${dataLiteral(options)})`);
        continue;
      }

      if (source.kind === 'specialty') {
        const specialty = SPECIALTY_APPLIERS[key]!;
        applierImports.add(specialty.factory);
        const options = { ...specialty.options, ...(source.onUserEdit && { onUserEdit: source.onUserEdit }) };
        // A factory with a fixed key (`createFlowApplier()`, the document appliers) takes no options at all
        // when the entry declares none, which is most packs
        registrations.push(`${specialty.factory}(${Object.keys(options).length > 0 ? dataLiteral(options) : ''})`);
        continue;
      }

      const { format } = source;
      for (const entity of formatEntities(format)) {
        if (!entityNames.has(entity)) {
          throw new Error(`Content "${key}": format "${source.formatRef}" writes entity "${entity}", which isn't declared by this pack, its dependencies or the SDK`);
        }
      }
      if (source.applier) {
        packApplier(key, source.applier);
        continue;
      }

      applierImports.add('createFormatApplier');
      const options = {
        key,
        entities: formatEntities(format),
        ...(format.identity && { identity: format.identity }),
        ...(format.tree?.relKind && { relKind: format.tree.relKind }),
        ...(format.media && { media: true }),
        ...(source.onUserEdit && { onUserEdit: source.onUserEdit }),
      };
      registrations.push(`createFormatApplier(${dataLiteral(options)})`);
    }

    if (registrations.length === 0) {
      return `${HEADER}\nimport type { ContentApplier } from '@apackdev/sdk/utils';\n\n${COMPILED_DIR_ACCESSORS}\n/** The pack's appliers, which its registration carries */\nexport const appliers: ContentApplier[] = [];\n`;
    }

    return `${HEADER}
${applierImports.size > 0 ? `import { ${Array.from(applierImports).join(', ')} } from '@apackdev/sdk/content';` : ''}
import { importCompiledContent, type ContentApplier, type ApplyResult, type ContentSelection } from '@apackdev/sdk/utils';
${packImports.join('\n')}

${COMPILED_DIR_ACCESSORS}
/** The pack's appliers, one per content key, which its registration carries */
export const appliers: ContentApplier[] = [
${registrations.map((registration) => `  ${registration},`).join('\n')}
];

export { importCompiledContent };
export type { ApplyResult, ContentSelection };
export type { ImportMode } from '@apackdev/sdk/utils';
`;
  }

  /** `content.sources` resolved against this pack's formats and its dependencies' (compiler modules aren't loaded here) */
  function resolvedContentSources(): Record<string, ResolvedContentSource> {
    const dependencies = new Map([...depSnapshots].map(([id, snap]) => [id, { manifest: snap.manifest }]));
    return resolveContentSources(manifest, root, dependencies);
  }

  /** [entity, source module specifier, export name] of each content writer the manifest declares */
  function contentWriterEntries(): [string, string, string][] {
    return Object.entries(manifest.content?.writers ?? {}).map(([entity, target]) => {
      const { source, exportName } = valueExport(`A content writer for "${entity}"`, target);
      return [entity, toImportPath(root, source), exportName] as [string, string, string];
    });
  }

  /**
   * What each of this pack's own entities holds a created row to: the fields the engine refuses a created row without,
   * read off its shape, and the prefix it numbers a short code with, which its manifest entry declares (`shortCode`).
   * The shape declares no `shortCode`: the engine writes it, and `#generated/ears` types it from that same prefix, so
   * the type and the numbering have one source. Its `indexes` are its manifest entry's, each a field its shape
   * declares. An entity with neither a shape, a prefix nor an index is held to nothing, and a dependency's register
   * their own.
   */
  function rowRulesLiteral(): string {
    const entities = _packEntities(manifest);
    const prefixes = new Map(entities.flatMap(({ name, shortCode }) => (shortCode ? [[name, shortCode] as const] : [])));
    const indexed = new Map(entities.flatMap(({ name, indexes }) => (indexes ? [[name, indexes] as const] : [])));
    // A prefix numbers one type across the app, so a dependency's are taken as the SDK's are: a collision fails the
    // build here, rather than the install at the host registry. A dependency's snapshot carries its manifest whole
    const taken = new Map<string, string>();
    for (const [depId, snapshot] of depSnapshots) {
      for (const [type, prefix] of Object.entries(_packShortCodes(snapshot.manifest))) taken.set(prefix, `${type} of the dependency "${depId}"`);
    }
    for (const [entity, prefix] of prefixes) {
      const owner = taken.get(prefix);
      if (owner) throw new Error(`Entity "${entity}": the short code prefix "${prefix}" numbers ${owner}: choose another`);
    }
    const shaped = new Set<string>();
    const rules: Record<string, RowRules> = {};
    for (const { entity, exportName, source, file } of packShapes()) {
      shaped.add(entity);
      const { required, declaresShortCode, fields } = moduleReader().rowRulesOf(file, exportName);
      const declared = prefixes.get(entity);
      // The engine writes a short code and #generated/ears types it, from the prefix the entry declares: a shape
      // declaring the field would be a second account of it, which could disagree with the first
      if (declaresShortCode) {
        throw new Error(`Entity "${entity}": ${source}#${exportName} declares shortCode, which the engine writes: `
          + (declared === undefined
            ? 'remove it, or number the entity by giving its manifest entry a "shortCode" prefix'
            : `remove it — the manifest entry's "${declared}" types the field, as ShortCodeOf<'${entity}'> from #generated/ears`));
      }
      const indexes = indexed.get(entity);
      // An index names a field the shape declares: one it doesn't is a typo, or a field that is gone
      const unknown = indexes?.filter((field) => !fields.includes(field) && field !== 'shortCode') ?? [];
      if (unknown.length > 0) {
        throw new Error(`Entity "${entity}": its indexes name ${unknown.map((field) => `"${field}"`).join(', ')}, which ${source}#${exportName} doesn't declare`);
      }
      rules[entity] = { required, ...(declared !== undefined && { shortCode: declared }), ...(indexes && { indexes }) };
    }
    for (const { name: entity, shortCode, indexes } of entities) {
      if (shaped.has(entity) || (shortCode === undefined && indexes === undefined)) continue;
      rules[entity] = { required: [], ...(shortCode !== undefined && { shortCode }), ...(indexes && { indexes }) };
    }
    return dataLiteral(rules);
  }

  /** This pack's own shaped entities, each shape checked to be a type its module exports */
  function packShapes(): Array<{ entity: string; source: string; exportName: string; file: string }> {
    return _packEntities(manifest).flatMap(({ name: entity, shape }) => {
      if (shape === null) return [];
      const { source, exportName, file } = exportTarget(`Entity shape "${entity}"`, shape, TYPE_MODULE_EXTENSIONS);
      try {
        if (!moduleReader().hasTypeExport(file, exportName)) {
          throw new Error(`${source} doesn't export a type named "${exportName}"`);
        }
      } catch (error) {
        throw new Error(`Entity shape "${entity}": ${error instanceof Error ? error.message : String(error)}`);
      }
      return [{ entity, source, exportName, file }];
    });
  }

  /** Imports and map entries for this pack's own entity shapes. Dependencies' come from their facade types. */
  function entityShapeEntries(): { imports: string[]; entries: string[] } {
    const imports: string[] = [];
    const entries: string[] = [];
    const prefixes = new Map(_packEntities(manifest).flatMap(({ name, shortCode }) => (shortCode ? [[name, shortCode] as const] : [])));
    for (const { entity, source, exportName: typeName } of packShapes()) {
      if ((SDK_SHAPED_ENTITIES as readonly string[]).includes(entity)) {
        throw new Error(`Entity shape "${entity}": the SDK declares this entity's shape; remove its entity declaration`);
      }
      const alias = `__shape_${entity.replace(/[^A-Za-z0-9_$]/g, '_')}`;
      imports.push(`import type { ${typeName} as ${alias} } from '${toImportPath(root, source)}';`);
      // A numbered entity's row holds the short code the engine writes, typed by its entry's prefix
      const prefix = prefixes.get(entity);
      entries.push(`  '${entity}': ${alias}${prefix ? ` & { shortCode: ShortCode<'${prefix}'> }` : ''};`);
    }
    return { imports, entries };
  }

  // ── Flow helpers ───────────────────────────────────────────────

  /** A step type or track field as a helper name: `-` and `_` separate words (`keep_alive`, `keep-alive` → `keepAlive`) */
  function toCamelCase(s: string): string {
    return s.replace(/[-_]+([A-Za-z0-9])/g, (_, c: string) => c.toUpperCase());
  }

  /** A step's helper: its name and code, or a re-export of its custom helpers module */
  function emitStepHelper(step: StepDeclaration): { name?: string; imports: string[]; helper?: string; reExport?: string } | null {
    if (!step.dsl) return null;
    const dsl = step.dsl;
    const name = toCamelCase(step.type);

    if (step.helpers !== undefined) {
      return { imports: [], reExport: `export * from '${toImportPath(root, step.helpers)}';` };
    }

    if (dsl.primaryField) {
      if (step.types === undefined) throw new Error(`Step "${step.type}": dsl.primaryField requires a declared types module`);
      const content = readFileSync(join(root, step.types), 'utf-8');
      const dslMatch = content.match(/export\s+interface\s+(DSL\w+Node)\b/);
      if (!dslMatch) {
        throw new Error(`Step "${step.type}": no DSL*Node interface found in ${step.types}`);
      }
      const dslTypeName = dslMatch[1];
      return {
        name,
        imports: [`import type { ${dslTypeName} } from '${toImportPath(root, step.types)}';`],
        // Omit would drop the node's fields: DSLNodeBase's index signature makes keyof every string
        helper: `export function ${name}(${dsl.primaryField}: string, opts?: { [K in keyof ${dslTypeName} as K extends 'type' | '${dsl.primaryField}' ? never : K]: ${dslTypeName}[K] }): DSLStepNode {\n  return { type: '${step.type}', ${dsl.primaryField}, ...opts };\n}`,
      };
    }

    if (dsl.defaultLabel) {
      return {
        name,
        imports: [],
        helper: `export function ${name}(label: string = ${dataLiteral(dsl.defaultLabel)}): DSLStepNode {\n  return { type: '${step.type}', label };\n}`,
      };
    }

    return {
      name,
      imports: [],
      helper: `export function ${name}(label?: string): DSLStepNode {\n  return { type: '${step.type}', ...(label && { label }) };\n}`,
    };
  }

  function emitTriggerTrackBuilder(step: StepDeclaration): { name: string; helper: string } | null {
    if (step.kind !== 'trigger') return null;
    const trackField = step.entry.trigger?.trackField;
    if (!trackField) return null;
    if (trackField === 'event') return null;
    const name = toCamelCase(trackField);
    return {
      name,
      helper: `export function ${name}(${trackField}: string, exits: DSLStepNode[][], label?: string): Track {\n  return { ${trackField}, label: label ?? \`${toPascalCase(trackField)} (\${${trackField}})\`, exits };\n}`,
    };
  }

  /**
   * This pack's flow helpers: one per step it defines (custom steps re-export their helpers module),
   * its trigger track builders, and its dependencies' flow helpers, re-exported from the modules
   * their snapshots carry (the helpers and option types each dependency generated for itself). A
   * name this pack or an earlier dependency exports isn't re-exported again.
   */
  function generateFlowHelpers(): string {
    const imports: string[] = [];
    const helpers: string[] = [];
    const customReExports: string[] = [];
    const names = new Set(['entry', 'on']);
    const seenTypes = new Set<string>();

    for (const step of stepDefinitions) {
      if (seenTypes.has(step.type)) continue;
      seenTypes.add(step.type);

      const result = emitStepHelper(step);
      if (result) {
        imports.push(...result.imports);
        if (result.name) names.add(result.name);
        if (result.helper) helpers.push(result.helper);
        if (result.reExport) customReExports.push(result.reExport);
      }

      const track = emitTriggerTrackBuilder(step);
      if (track) {
        names.add(track.name);
        helpers.push(track.helper);
      }
    }

    const depReExports: string[] = [];
    for (const [depId, snap] of depSnapshots) {
      if (!snap.flowHelpers) continue;
      const reExported = snap.flowHelpers.exports.filter(name => !names.has(name));
      for (const name of reExported) names.add(name);
      if (reExported.length > 0) {
        depReExports.push(`// ${depId}\nexport { ${reExported.join(', ')} } from './deps/${depId}${FLOW_HELPERS_SUFFIX}.js';`);
      }
    }

    const sections = [
      ["import type { DSLStepNode, Track } from '@apackdev/sdk/build';", "export { entry, on } from '@apackdev/sdk/build';", ...imports].join('\n'),
      ...helpers,
      customReExports.join('\n'),
      ...depReExports,
    ].filter(Boolean);
    return `${HEADER}\n${sections.join('\n\n')}\n`;
  }

  function generateStepTypes(): string {
    if (!stepDefinitions.length) return '';
    const sources = [...new Set(stepDefinitions.flatMap(step => step.types === undefined ? [] : [step.types]))];
    const reExports = sources.map(source => `export type * from '${toImportPath(root, source)}';`);
    if (!reExports.length) return '';
    return `${HEADER}\n${reExports.join('\n')}\n`;
  }

  // ── Assemble ────────────────────────────────────────────────────

  const files: [string, string][] = ([
    [GENERATED_ENTITY_DESTINATIONS_FILE, JSON.stringify(entityDestinations(), null, 2) + '\n'],
    [GENERATED_EVENT_CONTRACTS_FILE, JSON.stringify(eventContracts(), null, 2) + '\n'],
    ['src/__generated__/pack-entry.ts', generateBackendEntry()],
    ['src/__generated__/pack-entry-fe.ts', generateFrontendEntry()],
    ['src/__generated__/ears.ts', generateEars()],
    ['src/__generated__/ref.ts', generateRef()],
    ['src/__generated__/paths.ts', generatePaths()],
    ['src/__generated__/settings.ts', await generateSettings()],
    ['src/__generated__/settings-fe.ts', generateSettingsFe()],
    ['src/__generated__/fe.ts', generateFe()],
    ['src/__generated__/system-specs.ts', generateSystemSpecs()],
    ['src/__generated__/events.ts', generateEvents()],
    ['src/__generated__/types.ts', generateTypes()],
    ['src/__generated__/services.ts', generateServices()],
    ['src/__generated__/runtime-services.ts', `${HEADER}
import { _createPackServices } from '@apackdev/sdk/services';
// No feature imports: module-level settings handles must not depend on the services import graph.
export const runtimeServices = _createPackServices();
`],
    ['src/__generated__/repository.ts', generateRepository()],
    ['src/__generated__/repositories.ts', generateRepositories()],
    ['src/__generated__/pack-types.ts', generatePackTypes()],
    // Each dependency's facade types, from its snapshot
    ...depIds.map((depId) => {
      const snap = depSnapshots.get(depId)!;
      return [_depTypesFile(depId), `${HEADER}${depTypesHeader(depId, snap.manifest.version)}\n${depFacades.get(depId)!}`];
    }),
    // Each dependency's flow helpers module and its declarations, from its snapshot
    ...[...depSnapshots].flatMap(([depId, snap]) => snap.flowHelpers
      ? [
        [depFlowHelpersFile(depId, '.js'), `${HEADER}\n${snap.flowHelpers.module}`],
        [depFlowHelpersFile(depId, '.d.ts'), `${HEADER}\n${snap.flowHelpers.types}`],
      ]
      : []),
    ['src/__generated__/references.ts', generateReferences()],
    ['src/__generated__/appliers.ts', generateAppliers()],
    ['src/__generated__/content-runtime.ts', generateContentRuntime()],
    ['src/__generated__/flow-helpers.ts', generateFlowHelpers()],
    ['src/__generated__/step-types.ts', generateStepTypes()],
    [STEPS_BUILD_MODULE, generateStepsBuild()],
  ] as [string, string][]).filter(([, content]) => content);

  return Object.fromEntries(files);
}
