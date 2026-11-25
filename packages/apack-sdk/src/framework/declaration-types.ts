import type { SearchStemLanguage } from './data-declaration.ts';
import type { PackEventContracts } from './event-contracts.ts';
import type { FrontendDeclaration } from './frontend-declaration.ts';
import type { PackLifecycleDeclaration } from './lifecycle-declaration.ts';
import type { HelpDocument } from './pack-help.ts';
import type { ReferenceDeclarations } from './reference-declaration.ts';
import type { PackConsumption } from './service-consumption.ts';
import type { SettingsDefinition } from './settings-definition.ts';
import type { StepFrontendDeclaration } from './step-frontend-declaration.ts';
import type { SurfaceDeclaration } from './surface-declaration.ts';
import type { EmbeddingModelId } from '../services/models.ts';

/** Development conventions a pack may allow; runtime contract checks remain mandatory. */
export const ALLOWABLE_PACK_CHECKS = [
  'cross-feature-imports', 'untyped-sends', 'raw-transport', 'backend-console', 'repository-casts',
] as const;
export type AllowablePackCheck = (typeof ALLOWABLE_PACK_CHECKS)[number];

/** Build-time source-check policy; does not change runtime permissions. */
export interface PackChecksDeclaration {
  allow?: AllowablePackCheck[];
}

/**
 * Content keys compiled by the SDK's own compilers; they take a path, as a string or `{ path }`. Each writes
 * entities the SDK owns: `documents` a tree of Documents in Collections, and `commands` the same tree with
 * every Document a command list unless it says otherwise.
 */
export const SPECIALTY_CONTENT_KEYS: readonly string[] = ['actions', 'prompts', 'flows', 'documents', 'commands'];

/**
 * The content key the commands a manifest declares are compiled under.
 *
 * It is reserved rather than named by the pack, because the pack never writes the entry: declaring
 * `extensions.commands` is what creates it. A pack may not declare a source of this name — it would be
 * two entries wanting one compiled file — and it is not `commands`, which is the key a pack's own directory of
 * command documents compiles under, so a pack may declare both.
 */
export const DECLARED_COMMANDS_KEY = 'declared-commands';

/**
 * The content keys a manifest declares: its `content.sources`, plus the reserved one its
 * `extensions.commands` creates.
 *
 * **Every check that asks what a pack declared has to ask this**, because the shorthand declares an entry
 * the pack wrote no source for — the compiled index, the applier keys the runtime may carry, and the
 * installed layout each derived the answer separately, and a reserved key is invisible to all three
 * unless they share one.
 */
export function declaredContentKeys(manifest: { content?: { sources?: Record<string, unknown> }; extensions?: { commands?: unknown } }): string[] {
  return [
    ...Object.keys(manifest.content?.sources ?? {}),
    ...(manifest.extensions?.commands ? [DECLARED_COMMANDS_KEY] : []),
  ];
}

/**
 * What an apply does about an item of this entry that the user has edited, and the line is whether editing
 * it meant adoption or customisation.
 *
 * **`theirs` is the default, because it is the quiet one.** Where the pack ships a starting point for the
 * user's own writing, their first edit makes the item theirs: never updated again, and never the subject of
 * a badge about their own prose. Where it ships something of the pack's that the user has customised — a
 * flow, an action, a prompt — they still want its bug fixes, so `offer` records what changed and lets them
 * decide. The dangerous option is the one someone has to type.
 *
 * **Neither value ever overwrites the user**, which is why the pair is named for whose the item is rather
 * than for what happens to their edit: under both, what they wrote stays. What differs is whether the pack
 * goes on offering its own version, and nothing here makes a second copy of anything.
 */
export const CONTENT_EDIT_POLICIES = ['theirs', 'offer'] as const;
export type ContentEditPolicy = (typeof CONTENT_EDIT_POLICIES)[number];

export const PACK_PERMISSIONS = ['ears', 'llm', 'filesystem', 'network', 'terminal'] as const;
export type PackPermission = (typeof PACK_PERMISSIONS)[number];

/** A migration's key: the version it targets, as "major.minor.patch". */
export const MIGRATION_TARGET_PATTERN = /^\d+\.\d+\.\d+$/;

/** The version lines, checked against MigrationsSchema and PackMigrations. */
export const MIGRATION_LINES = ['app', 'pack'] as const;

/** Which version line a migration's target is a version of. */
export type MigrationLine = (typeof MIGRATION_LINES)[number];

export interface PackMigrationDeclaration {
  description: string;
  up: string;
}

export interface PackMigrationsDeclaration {
  app?: Record<string, PackMigrationDeclaration>;
  pack?: Record<string, PackMigrationDeclaration>;
}

export interface PackEntityEntry {
  shape?: string;
  shortCode?: string;
  indexes?: readonly string[];
  search?: {
    fields: Record<string, number>;
    stem?: SearchStemLanguage;
  };
  embed?: {
    from: readonly string[];
    chunk?: 'whole' | 'paragraph' | 'heading';
    model: EmbeddingModelId;
    dims: number;
  };
  substrings?: readonly string[];
  changeOrder?: boolean;
}

export interface PackRelationEntry {
  acyclic?: boolean;
  key?: readonly string[];
  weighted?: boolean;
}

export interface PackRankEntry {
  types: readonly string[];
  relations: readonly string[];
  direction?: 'out' | 'in' | 'both';
  weights?: boolean;
  damping?: number;
  tolerance?: number;
}

export interface PackDataConfig {
  entities?: Record<string, PackEntityEntry>;
  relations?: Record<string, PackRelationEntry>;
  roles?: string[];
  ranks?: Record<string, PackRankEntry>;
}

export interface StepDSLMeta {
  references?: Record<string, string>;
  primaryField?: string;
  defaultLabel?: string;
  helpers?: string;
}

export interface StepRuntimeDeclaration {
  handler?: string;
  sync?: true;
  isAsync?: true;
  waits?: true;
  spawnsSubflow?: true;
}

export interface StepBuildDeclaration {
  compile: string;
  validate: string;
  getLabel: string;
  decompile?: string;
  branches?: string;
  relation?: {
    field: string;
    targetEntity: string;
  };
}

export interface StepTriggerDeclaration {
  trackField: string;
  persistent?: boolean;
  queryFields?: string[];
  compile: string;
  decompile: string;
  validateTrack?: string;
  validate?: string;
  register?: string;
}

export interface StepEntry {
  kind?: 'step' | 'trigger';
  node: {
    label: string;
    defaultLabel?: string;
    defaults?: Record<string, unknown>;
  };
  build?: StepBuildDeclaration;
  trigger?: StepTriggerDeclaration;
  fe?: StepFrontendDeclaration;
  types?: string;
  runtime?: StepRuntimeDeclaration;
  dsl?: StepDSLMeta;
}

export interface DslDeclaration {
  entry: string;
  targets: 'monaco'[];
  prefix?: string;
  globals?: Record<string, string>;
  inline?: string[];
}

export type DslEntry = DslDeclaration;

export interface ArtifactDeclaration {
  icon: string;
  fe?: string;
}

export interface BlockDeclaration {
  kind?: 'display' | 'input';
  fe?: string;
  be?: string;
}

export interface ContentFieldDeclaration {
  from: string;
  default?: unknown;
  type?: 'string';
}

export interface ContentTreeDeclaration {
  branch?: string;
  branchEntity?: string;
  relKind?: string;
}

export interface ContentFormatConfig {
  format?: 'markdown-tree' | 'json';
  compiler?: string;
  entity?: string | string[];
  identity?: string[];
  tree?: ContentTreeDeclaration;
  fields?: Record<string, ContentFieldDeclaration>;
  media?: string;
}

export interface ContentSourceConfig {
  path?: string;
  format?: string;
  applier?: string;
  onUserEdit?: ContentEditPolicy;
}

export interface ContentConfig {
  sources?: Record<string, string | ContentSourceConfig>;
  datasets?: Record<string, ContentSourceConfig>;
  formats?: Record<string, ContentFormatConfig>;
  writers?: Record<string, string>;
}

export interface PackSystemEntry {
  entry: string;
  contract?: string;
  events?: {
    incoming?: string[];
  };
}

export type PackSurfaceEntry = SurfaceDeclaration;

export interface PackFeatureEntry {
  description: string;
  entities?: Record<string, PackEntityEntry>;
  designation?: string;
  settings?: SettingsDefinition;
  types?: string;
  system?: PackSystemEntry;
  surface?: SurfaceDeclaration;
  services?: Record<string, string>;
  repositories?: Record<string, string>;
  views?: string;
  projections?: string;
  references?: ReferenceDeclarations;
}

/** A feature with the id it is declared under: what everything reading a manifest's features works with */
export type PackFeature = PackFeatureEntry & { id: string };

export type PackLifecycleConfig = PackLifecycleDeclaration;

export interface PackBuildConfig {
  opaqueDeps?: string[];
  bundleUi?: boolean;
  workers?: Record<string, string>;
}

export interface CommandsExtensionDeclaration {
  list: Record<string, { placeholder: string }>;
  onUserEdit?: ContentEditPolicy;
}

export interface PackExtensionsDeclaration extends FrontendDeclaration {
  commands?: CommandsExtensionDeclaration;
  settings?: Record<string, SettingsDefinition>;
  help?: { path: string };
  steps?: Record<string, StepEntry>;
  artifacts?: Record<string, ArtifactDeclaration>;
  blocks?: Record<string, BlockDeclaration>;
  services?: Record<string, string>;
  dsl?: Record<string, DslDeclaration>;
}

export interface PackManifest {
  $schema?: string;
  id: string;
  name: string;
  version: string;
  description?: string;
  hostVersion?: string;
  license?: string;
  dependencies?: Record<string, string>;
  consumes?: PackConsumption;
  permissions?: PackPermission[];
  data?: PackDataConfig;
  features?: Record<string, PackFeatureEntry>;
  extensions?: PackExtensionsDeclaration;
  lifecycle?: PackLifecycleDeclaration;
  content?: ContentConfig;
  migrations?: PackMigrationsDeclaration;
  build?: PackBuildConfig;
  checks?: PackChecksDeclaration;
}

export interface PackTypeManifest {
  entities: Record<string, string>;
  relKinds: Record<string, string>;
  roles: Record<string, string>;
}

export type ProvenanceKind =
  | 'entities'
  | 'relKinds'
  | 'weightedKinds'
  | 'roles'
  | 'rankIndexes'
  | 'referenceTypes'
  | 'referenceCategories'
  | 'tiptapExtensions'
  | 'surfaces';

/** Declared name → the pack that declares it, per kind. Absent kinds declared nothing. */
export type PackProvenance = Partial<Record<ProvenanceKind, Record<string, string>>>;

/**
 * A pack's generated flow helpers (src/__generated__/flow-helpers.ts: a helper per step, custom
 * step helpers and trigger track builders, its dependencies' included), bundled by `apack pack build`.
 */
export interface PackFlowHelpers {
  /** The names the module exports */
  exports: string[];
  /** The ES module; only packages stay imports */
  module: string;
  /** Its declarations; only packages stay imports */
  types: string;
}

export interface PackSnapshot {
  /** Identifies the same declared data in generated backend/frontend bindings. */
  declarationRevision: string;
  types: PackTypeManifest;
  /** Dependent-facing TypeScript declaration bundles, keyed by facade name. */
  facades: Record<string, string>;
  /** Entity type to local destination feature, materialized from declared surface contract types. */
  entityDestinations: Record<string, string>;
  /** Compiled names for every declared endpoint; absent only when there are no endpoints. */
  eventContracts?: PackEventContracts;
  manifest: PackManifest;
  /** Self-contained Monaco declarations keyed by DSL name; required for every declared Monaco target. */
  dslDefinitions?: Record<string, string>;
  /** Materialized articles; required when the manifest declares help. */
  help?: HelpDocument[];
  /** The `PACK_SNAPSHOT_FORMAT` of the CLI that wrote it; a snapshot without one predates the format */
  format: number;
  sdkVersion?: string;
  /**
   * What everything this pack's tree declares is declared by: kind → name → the pack declaring it.
   *
   * A snapshot has to tell a dependent about the whole tree, not just this pack, because a dependent
   * sees only its direct dependencies' snapshots. Without it, a dependent of two packs that share an
   * ancestor sees the ancestor's names arriving from both and reads that as two packs declaring the
   * same name — a collision that isn't one. Every pack depends on the base pack, so that is every
   * diamond.
   *
   * Every kind — entities, relation kinds, commands, surfaces — goes through one algorithm,
   * `_mergeProvenance`, and `PROVENANCE_KINDS` is where a new kind costs a line rather than a
   * differently-shaped field with a reader of its own.
   */
  provenance?: PackProvenance;
  /** The pack's flow helpers, which dependents' generated flow helpers re-export */
  flowHelpers?: PackFlowHelpers;
}

/** Type-data inspection retains the recorded stamp when present; it does not authorize execution. */
export type PackDependencySnapshot = Omit<PackSnapshot, 'format'> & { format?: number };
