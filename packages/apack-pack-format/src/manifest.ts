import {
  _packEntityTypes, _packRanks, _packRelationTypes, _packWeightedKinds, _packRoles,
  type ContentFormatConfig, type ContentSourceConfig, type DslEntry, type FrontendDeclaration,
  type PackDataDeclarations, type PackDependencySnapshot, type PackEntityDeclaration,
  type PackFeatureEntry, type PackFlowHelpers, type PackLifecycleConfig, type PackManifest,
  type PackMigrationDeclaration, type PackPermission, type PackProvenance, type PackSnapshot,
  type PackSurfaceEntry, type PackSystemEntry, type PackTypeManifest, type ProvenanceKind,
  type ReferenceDeclarations, type StepDSLMeta, type StepEntry,
} from '@apackdev/sdk/framework';
import { resolveName } from '@apackdev/sdk/ids';

/** A manifest feature entry paired with its map key. */
export type PackFeature = PackFeatureEntry & { id: string };

export type {
  ContentFormatConfig, ContentSourceConfig, DslEntry, PackDependencySnapshot, PackFeatureEntry,
  PackFlowHelpers, PackLifecycleConfig, PackManifest, PackMigrationDeclaration, PackPermission, PackProvenance,
  PackSnapshot, PackSurfaceEntry, PackSystemEntry, PackTypeManifest, ProvenanceKind, StepDSLMeta, StepEntry,
};

/**
 * A manifest's features as a list, each carrying the id it is keyed by. `features` is a map, so a duplicate
 * id is unrepresentable and nothing has to check for one; everything that reads them wants the id beside
 * the entry, which is this one derivation rather than an id written twice.
 *
 * The order is the manifest's own. Generated code follows it — the `NodeEntity` union, the surface list a
 * pack's frontend registers — so it is a declaration like any other key order in the file.
 */
export function packFeatures(manifest: { features?: Record<string, PackFeatureEntry> }): PackFeature[] {
  return Object.entries(manifest.features ?? {}).map(([id, entry]) => ({ ...entry, id }));
}

// Not part of apack.json — used for dist/snapshot.json and build-time type exchange.

/**
 * The format of a pack's build, recorded in its snapshot: everything another apack reads from what `apack pack build`
 * wrote. A dependent's codegen reads the facade types in `facades['pack-types']` and the exports generated code imports
 * from them, `types`, `provenance` and its kinds, `flowHelpers`, and the manifest's fields. The app loads the
 * registration the runtime bundle exports, and refuses to install or load a build in another format.
 *
 * Bump it with any change the other side would misread: a field, facade export, provenance kind, manifest or
 * registration field removed, renamed or reshaped, or keys that now mean something else.
 */
export const PACK_SNAPSHOT_FORMAT = 1;

/**
 * A build whose snapshot is in another format than `PACK_SNAPSHOT_FORMAT`: what's wrong, and which side is older, since
 * that decides which one moves. Each reader adds its own remedy.
 *
 * @internal Host-only: the apack CLI, the pack test harness and the app's pack loader.
 */
export interface SnapshotFormatMismatch {
  /** Written by a newer apack than the reader: only then can an older build of the same pack still match */
  newer: boolean;
  /** `its snapshot is format 2, written by a newer apack CLI (SDK 0.4.0)` */
  problem: string;
}

/**
 * The build's mismatch with the snapshot format its reader reads, or undefined when they agree. The reader is this
 * apack unless `readerFormat` names another: the installed app's, which the CLI reads from the app's data dir.
 *
 * @internal Host-only: the apack CLI, the pack test harness, the pack installer and the app's pack loader.
 */
export function _snapshotFormatMismatch(
  snapshot: unknown,
  readerFormat: number = PACK_SNAPSHOT_FORMAT,
): SnapshotFormatMismatch | undefined {
  const format = snapshot && typeof snapshot === 'object' && 'format' in snapshot ? snapshot.format : undefined;
  if (format === readerFormat) return undefined;
  const newer = typeof format === 'number' && format > readerFormat;
  const sdkVersion = snapshot && typeof snapshot === 'object' && 'sdkVersion' in snapshot ? snapshot.sdkVersion : undefined;
  const builtWith = typeof sdkVersion === 'string' && sdkVersion ? ` (SDK ${sdkVersion})` : '';
  return {
    newer,
    problem: `its snapshot is format ${typeof format === 'number' ? format : '(none)'}, written by ${newer ? 'a newer' : 'an older'} apack CLI${builtWith}`,
  };
}

/**
 * A mismatch as a CLI reading a dependency states it
 *
 * @internal Host-only: the apack CLI and the pack test harness.
 */
export function _cliFormatMismatchMessage({ problem }: SnapshotFormatMismatch): string {
  return `${problem}; this CLI reads format ${PACK_SNAPSHOT_FORMAT}. Build it and this pack with the same apack version`;
}

/**
 * How each kind of declared name is read off a manifest, given the pack it belongs to. Adding a kind is
 * an entry here: the reader, the snapshot field and every consumer are already generic over it.
 */
export const PROVENANCE_KINDS = {
  entities: (m: ProvenanceManifest) => Object.keys(_packEntityTypes(m)),
  relKinds: (m: ProvenanceManifest) => Object.keys(_packRelationTypes(m)),
  weightedKinds: (m: ProvenanceManifest) => Object.keys(_packWeightedKinds(m)),
  roles: (m: ProvenanceManifest) => Object.keys(_packRoles(m)),
  rankIndexes: (m: ProvenanceManifest) => Object.keys(_packRanks(m)),
  referenceTypes: (m: ProvenanceManifest) => Object.values(m.features ?? {}).flatMap(f => Object.keys(f.references?.types ?? {})),
  referenceCategories: (m: ProvenanceManifest) => Object.values(m.features ?? {}).flatMap(f => Object.keys(f.references?.categories ?? {})),
  tiptapExtensions: (m: ProvenanceManifest) => Object.values(m.extensions?.textEditor ?? {}).flatMap(surface => Object.keys(surface.extensions ?? {})),
  surfaces: (m: ProvenanceManifest, packId: string) => Object.entries(m.features ?? {}).filter(([, f]) => f.surface).map(([id]) => resolveName(id, packId)),
} as const satisfies Record<ProvenanceKind, (m: ProvenanceManifest, packId: string) => string[]>;

type _Asserted<T extends true> = T;
export type _ProvenanceKindsExact = _Asserted<
  Exclude<keyof typeof PROVENANCE_KINDS, ProvenanceKind> extends never
    ? (Exclude<ProvenanceKind, keyof typeof PROVENANCE_KINDS> extends never ? true : false)
    : false
>;

/** The parts of a manifest `PROVENANCE_KINDS` reads; a `PackManifest` satisfies it */
export interface ProvenanceManifest extends PackDataDeclarations {
  extensions?: { textEditor?: FrontendDeclaration['textEditor'] };
  features?: Record<string, { entities?: Record<string, PackEntityDeclaration>; surface?: unknown; references?: ReferenceDeclarations }>;
}

/**
 * @internal Host-only: apack CLI build tooling.
 *
 * A record of declared names, safe to index with any of them (null-prototype so `constructor` and `__proto__` are ordinary keys).
 */
export function _provenanceRecord(source?: Record<string, string>): Record<string, string> {
  const record: Record<string, string> = Object.create(null);
  if (source) for (const name of Object.keys(source)) record[name] = source[name]!;
  return record;
}

/** What `_mergeProvenance` reads from a dependency: its own manifest, and what it inherited */
export interface ProvenanceSource {
  manifest: ProvenanceManifest;
  provenance?: PackProvenance;
}

/**
 * @internal Host-only: apack CLI build tooling.
 *
 * Every name of `kind` declared across these dependencies and everything they depend on, once each,
 * with the pack declaring it. `own` folds in the pack being built, which declares nearer than any of them.
 */
export function _mergeProvenance(
  kind: ProvenanceKind,
  dependencies: ReadonlyArray<readonly [string, ProvenanceSource]>,
  own?: { id: string; manifest: ProvenanceManifest },
): Record<string, string> {
  const namesOf = PROVENANCE_KINDS[kind];
  const declaredBy = _provenanceRecord();
  for (const [depId, snapshot] of dependencies) {
    const inherited = snapshot.provenance?.[kind];
    if (inherited) for (const name of Object.keys(inherited)) declaredBy[name] = inherited[name]!;
    for (const name of namesOf(snapshot.manifest, depId)) declaredBy[name] = depId;
  }
  if (own) for (const name of namesOf(own.manifest, own.id)) declaredBy[name] = own.id;
  return declaredBy;
}

/**
 * @internal Host-only: apack CLI build tooling.
 *
 * Every kind at once, for writing a snapshot. A kind that declared nothing is left out rather than
 * written as an empty record, so a snapshot says what it means.
 */
export function _buildProvenance(
  dependencies: ReadonlyArray<readonly [string, ProvenanceSource]>,
  own?: { id: string; manifest: ProvenanceManifest },
): PackProvenance {
  const provenance: PackProvenance = {};
  for (const kind of Object.keys(PROVENANCE_KINDS) as ProvenanceKind[]) {
    const declaredBy = _mergeProvenance(kind, dependencies, own);
    if (Object.keys(declaredBy).length > 0) provenance[kind] = declaredBy;
  }
  return provenance;
}

/** The bundle of a pack's content compiler modules, in its build dir: dependents compile its formats with it */
export const CONTENT_COMPILERS_FILE = 'content-compilers.mjs';

/** The index compilePack writes next to a pack's compiled content */
export const CONTENT_INDEX_FILE = 'content.json';

export function contentFile(name: string): string {
  return `${name}.content.json`;
}
