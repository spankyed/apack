import { _packEntityTypes, _packRelationRules, _packRelationTypes, _packRoles, _packShortCodes, _shortCodeTypes } from '@apackdev/sdk/framework';
// The EARS names and partition policy of the packs installed in a data dir, read from validated builds without
// running pack code: what a tool opening the data dir's database needs to hydrate and query it as the app does
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AppEnvironment } from '@apackdev/sdk/env';
import { parseManifest, parseSnapshot, type PackManifest } from '@apackdev/sdk/build';
import { readInstalledPacks } from '../packs/installed.ts';
import { SDK_ENTITIES, SDK_REL_KINDS, SDK_RELATION_RULES, SDK_ROW_RULES, SDK_ROLES, SDK_SHORT_CODES, _withSdkIndexes } from '@apackdev/sdk/types';
import { HOST_ENTITY_TYPES } from '../app-state/index.ts';
import type { EngineSchema, RelationRules, RowRules } from '@apackdev/ears';
import { PACK_LAYOUT } from '../packs/layout.ts';
import { readInstalledPackBuilds } from '../packs/discovery.ts';

/** What opening a database needs from the packs: which names are entity types, and where each type is stored */
export interface DatabaseSchema {
  /** The SDK's entity types, the host's and the packs' */
  getRegisteredEntityTypes(): ReadonlySet<string>;
  /** The SDK's relation kinds and the packs' */
  getRegisteredRelationKinds(): ReadonlySet<string>;
  /** The SDK's roles and the packs' */
  getRegisteredRoles(): ReadonlySet<string>;
  /**
   * What an entity type's created row is held to. The app's registry knows every registered pack's; a data dir read
   * from its manifests knows the SDK's whole, and of a pack's the short code prefix its manifest declares — not its
   * required fields, which its shapes hold and no manifest carries
   */
  getRowRules?(type: string): RowRules | undefined;
  /** What a relation kind's edges are held to; none when the kind declares no rule */
  getRelationRules?(kind: string): RelationRules | undefined;
  /** Calls `listener` after the names change — the app's registry, as a pack registers — returning the unsubscribe */
  onRegistrationChanged?(listener: (packId: string) => void): () => void;
}

/**
 * The schema an engine's database is held to, from what `schema` names: each entity type with its row rules and the
 * SDK's indexes, each relation kind with its rules, and each role
 */
export function engineSchemaOf(schema: DatabaseSchema): EngineSchema {
  return {
    types: Object.fromEntries([...schema.getRegisteredEntityTypes()].map((type) => [type, _withSdkIndexes(schema.getRowRules?.(type))])),
    relations: Object.fromEntries([...schema.getRegisteredRelationKinds()].map((kind) => [kind, schema.getRelationRules?.(kind) ?? {}])),
    roles: [...schema.getRegisteredRoles()],
  };
}

/** The installed packs' schema, with the names a tool shows and the packs it was read from */
export interface InstalledSchema extends DatabaseSchema {
  /** Entity types by name, the SDK's, the host's and the packs' */
  entities: Record<string, string>;
  /** Relation kinds by name, the SDK's and the packs' */
  relKinds: Record<string, string>;
  /** Roles by name, the SDK's and the packs' */
  roles: Record<string, string>;
  /** The packs read: every enabled pack installed in the data dir */
  packs: Array<{ id: string }>;
  /**
   * Why this schema knows no pack's names, or nothing when it read at least one pack.
   *
   * It is a field rather than a log line because a *write* against names the schema lacks stops part way:
   * the engine asks it whether a name is an entity type and refuses one it has never heard of, so a write
   * fails on the first type it lacks, after whatever it wrote before. So `openAppDatabase` refuses a writable
   * open, and only a read degrades.
   *
   * **The condition is "no pack was read", not "the rows are accounted for", and the difference is a hole
   * this does not close.** Rows outlive the pack that declared their types on purpose — uninstalling
   * deletes a pack's directory, not its rows (`AppState.packVersions`) — so a dir with ten packs installed
   * and an eleventh's rows still in it reads as complete here and is not. Closing that needs the entity
   * types present in the data, which only hydration knows; this fires where the whole of a data dir's
   * schema is missing, which is what a failed or absent install of the packs the app ships produces.
   */
  degraded?: string;
  /** Things worth telling the user that are not degradation — a `--schema-from` that turned out unnecessary */
  notes: string[];
  /** The entity type a short code belongs to, from the SDK's and the installed packs' prefixes, as the app answers it */
  entityTypeOfShortCode(code: string): string | undefined;
}

/** The directories and files of a data dir the schema is read from */
export type SchemaContext = Pick<AppEnvironment, 'userDataDir' | 'packsDir' | 'installedPacksFile'>;

function readJSON(file: string, what: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (error) {
    throw new Error(`${file} isn't readable ${what}: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object') throw new Error(`${file} isn't ${what}`);
  return parsed;
}

/**
 * Every enabled pack installed in the data dir, admitted through the common build reader: everything in `packsDir`
 * that the registry doesn't list as disabled, since the app registers a pack it hasn't listed yet as enabled.
 */
function installedManifests({ packsDir, installedPacksFile }: SchemaContext): PackManifest[] {
  const disabled = new Set(readInstalledPacks(installedPacksFile, { strict: true }).filter(pack => !pack.enabled).map(pack => pack.id));
  return readInstalledPackBuilds(packsDir).filter(entry => !disabled.has(entry.id)).map(entry => {
    if (!entry.build) throw new Error(`Pack "${entry.id}" declarations in ${entry.dir}: ${entry.problem}`);
    return entry.build.snapshot.manifest;
  });
}

/**
 * Adds a pack's names to `names`, refusing one another pack or the app already declares: the app's registry refuses
 * the same collision when it registers packs, so a tool that took the last one would read the database by a schema
 * the app can't even start with.
 */
function addNames(names: Record<string, string>, owners: Map<string, string>, pack: string, declared: Record<string, string> | undefined, what: string): void {
  for (const [name, value] of Object.entries(declared ?? {})) {
    for (const key of [name, value]) {
      const owner = owners.get(key);
      if (owner !== undefined && owner !== pack) throw new Error(`Two packs declare the ${what} ${key}: "${owner}" and "${pack}"`);
      owners.set(key, pack);
    }
    names[name] = value;
  }
}

/**
 * Where a pack directory keeps the names, in the order a directory is probed. Three shapes are in the wild and
 * each supplies a different file: an installed pack and the host's published packs have the snapshot and no
 * manifest, a checkout has the manifest and its build's snapshot, and a packaged app ships both.
 */
const PACK_CANDIDATES = [
  { file: PACK_LAYOUT.snapshot, read: readSnapshotManifest },
  { file: path.join('dist', PACK_LAYOUT.snapshot), read: readSnapshotManifest },
  { file: PACK_LAYOUT.manifest, read: readManifestFile },
] as const;

function readSnapshotManifest(file: string): PackManifest {
  const parsed = parseSnapshot(readJSON(file, "a pack's snapshot"));
  if (!parsed.snapshot) throw new Error(`${file}: ${parsed.diagnostics.map(issue => issue.message).join('; ')}`);
  return parsed.snapshot.manifest;
}

function readManifestFile(file: string): PackManifest {
  const raw = readJSON(file, "a pack's manifest");
  const { diagnostics } = parseManifest(raw);
  if (diagnostics.length > 0) throw new Error(`${file}: ${diagnostics.map(issue => issue.message).join('; ')}`);
  // The schema it just passed is what `PackManifest` is inferred from, which is why the installer reads one
  // the same way (`packs/installer.ts`)
  return raw as PackManifest;
}

/** The names in one pack directory, or nothing when it holds none of the three files a pack keeps them in. */
function packAt(dir: string): PackManifest | undefined {
  for (const { file, read } of PACK_CANDIDATES) {
    const candidate = path.join(dir, file);
    if (fs.existsSync(candidate)) return read(candidate);
  }
  return undefined;
}

/**
 * The packs named by `--schema-from`: a snapshot file, one pack directory, or a **directory of pack
 * directories** — an app's `host-packs`, a checkout's `packages`, a packaged app's `Resources/app/packages`.
 *
 * Naming a place rather than a list is what lets one flag cover every pack behind it. A directory is tried as
 * one pack first, since that is the narrower reading and a pack directory never holds packs; only if it is not
 * one are its children read, and a directory holding neither is an error rather than an empty answer, so a path
 * that names nothing is reported instead of quietly adding nothing.
 */
function namedManifests(schemaFrom: string): PackManifest[] {
  if (schemaFrom.endsWith('.json')) {
    if (!fs.existsSync(schemaFrom)) throw new Error(`No pack snapshot at ${schemaFrom}`);
    return [readSnapshotManifest(schemaFrom)];
  }
  if (!fs.existsSync(schemaFrom)) throw new Error(`No pack or pack directory at ${schemaFrom}`);
  const one = packAt(schemaFrom);
  if (one) return [one];

  const byId = new Map<string, PackManifest>();
  for (const entry of fs.readdirSync(schemaFrom, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const manifest = packAt(path.join(schemaFrom, entry.name));
    if (manifest) byId.set(manifest.id, manifest);
  }
  if (byId.size === 0) {
    throw new Error(
      `${schemaFrom} holds no pack: a pack keeps its names in ${PACK_CANDIDATES.map(({ file }) => file).join(', ')}, `
      + 'and neither it nor any directory in it has one of those.',
    );
  }
  return [...byId.values()];
}

/**
 * The schema of the packs installed in a data dir, as the app registers them: entity types and relation
 * kinds from every installed pack's own `apack.json`.
 *
 * **One account of the data dir, which is the packs directory.** Every pack is installed there, the ones
 * the app ships included, so there is no second source to prefer and no dir that holds packs without
 * holding their manifests.
 *
 * A dir with no packs installed knows only the names the app itself declares, and that is reported as
 * `degraded` rather than passed off as a complete reading of it: the statement is true about what is
 * *installed*, and a caller about to write needs to know it is not true about what is *stored*. See the
 * field, which says what it does and does not cover.
 *
 * `schemaFrom` names packs to read *as well*, for a dir whose rows outlived the packs that declared their
 * types: a snapshot, a pack directory, or a directory of them (see `namedManifests`). It is resolved whether
 * or not it adds anything, so a path that names nothing is an error rather than a flag that quietly did
 * nothing, and one that only names packs already installed is reported in `notes`.
 */
export function readInstalledSchema(context: SchemaContext, options: { schemaFrom?: string } = {}): InstalledSchema {
  const named = options.schemaFrom === undefined ? [] : namedManifests(options.schemaFrom);
  const installed = installedManifests(context);
  const installedIds = new Set(installed.map((manifest) => manifest.id));
  const added = named.filter((manifest) => !installedIds.has(manifest.id));
  const alreadyInstalled = named.filter((manifest) => installedIds.has(manifest.id)).map(({ id }) => id);
  const notes = alreadyInstalled.length === 0 ? [] : [
    `${context.userDataDir} already has ${alreadyInstalled.join(', ')} installed, so --schema-from `
    + `${options.schemaFrom} added ${added.length === 0 ? 'nothing' : added.map(({ id }) => id).join(', ')}.`,
  ];
  const packs = [...installed, ...added];
  const degraded = packs.length === 0
    ? `${context.userDataDir} has no packs installed in ${context.packsDir}, so only apack's own entity `
      + "types are known. Rows still load and are reachable by id, but a query that starts from a pack's "
      + 'entity type cannot be written. Name a snapshot with --schema-from to read them.'
    : undefined;

  const entities: Record<string, string> = {
    ...SDK_ENTITIES,
    ...Object.fromEntries(HOST_ENTITY_TYPES.map((type) => [type, type])),
  };
  const relKinds: Record<string, string> = { ...SDK_REL_KINDS };
  const roles: Record<string, string> = { ...SDK_ROLES };
  const entityOwners = new Map<string, string>(Object.keys(entities).map((name) => [name, 'apack']));
  const relKindOwners = new Map<string, string>(Object.entries(relKinds).flatMap(([name, value]) => [[name, 'apack'], [value, 'apack']] as Array<[string, string]>));
  const roleOwners = new Map<string, string>(Object.entries(roles).flatMap(([name, value]) => [[name, 'apack'], [value, 'apack']] as Array<[string, string]>));
  // A prefix numbers one entity type across the app, so a tool refuses two packs sharing one as the app's registry does
  const prefixes: Record<string, string> = {};
  const relationRules: Record<string, RelationRules> = { ...SDK_RELATION_RULES };
  // Each prefix's owner, as a pack id and how a refusal names it; the SDK's are taken before any pack's
  const prefixOwners = new Map<string, { id: string; name: string }>(
    Object.entries(SDK_SHORT_CODES).map(([type, prefix]) => [prefix, { id: 'apack', name: `the SDK's ${type}` }]));
  for (const manifest of packs) {
    addNames(entities, entityOwners, manifest.id, _packEntityTypes(manifest), 'entity type');
    addNames(relKinds, relKindOwners, manifest.id, _packRelationTypes(manifest), 'relation kind');
    addNames(roles, roleOwners, manifest.id, _packRoles(manifest), 'role');
    Object.assign(relationRules, _packRelationRules(manifest));
    for (const [type, prefix] of Object.entries(_packShortCodes(manifest))) {
      const owner = prefixOwners.get(prefix);
      if (owner !== undefined && owner.id !== manifest.id) {
        throw new Error(`The short code prefix ${prefix} numbers both ${owner.name} and ${type} of pack "${manifest.id}"`);
      }
      prefixOwners.set(prefix, { id: manifest.id, name: `${type} of pack "${manifest.id}"` });
      prefixes[type] = prefix;
    }
  }
  const entityTypes = new Set(Object.values(entities));
  const shortCodeTypes = _shortCodeTypes([
    ...Object.entries(SDK_ROW_RULES as Record<string, RowRules>),
    ...Object.entries(prefixes).map(([type, shortCode]) => [type, { shortCode }] as const),
  ]);
  const relationKinds = new Set(Object.values(relKinds));
  const roleNames = new Set(Object.values(roles));

  return {
    entities,
    relKinds,
    roles,
    packs: packs.map(({ id }) => ({ id })),
    getRegisteredEntityTypes: () => entityTypes,
    getRegisteredRelationKinds: () => relationKinds,
    getRegisteredRoles: () => roleNames,
    // A pack type's prefix, so a row created here is numbered as the app numbers it; its required fields stay unknown
    getRowRules: (type) => (SDK_ROW_RULES as Record<string, RowRules>)[type]
      ?? (prefixes[type] === undefined ? undefined : { required: [], shortCode: prefixes[type] }),
    getRelationRules: (kind) => relationRules[kind],
    entityTypeOfShortCode: shortCodeTypes,
    ...(degraded !== undefined && { degraded }),
    notes,
  };
}
