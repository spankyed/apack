// Applies default-setup's content sources through its real manifest entries and snapshots the entities they
// produce, with ids and timestamps normalized, so two pipelines can be compared entity for entity.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildPackConfigFromManifest, compilePack } from '@apackdev/sdk/build';
import { createDocumentsApplier } from '@apackdev/sdk/content';
import { applyRecord, importCompiledContent, type ApplyRecord, type AppliedItem, type ImportMode, type ApplyResult, type ContentSelection } from '@apackdev/sdk/utils';
import { type EARS } from '@apackdev/sdk';
import { findRelations, untypedQuery as query } from '@apackdev/sdk/ears';
import { entityIds } from '@apackdev/sdk/testing';
import { resetTestData, testMediaPath } from '@apackdev/testing/harness';

export const PACK_DIR = path.resolve(import.meta.dirname, '../..');
export const FIXTURES = path.join(PACK_DIR, 'tests/_support/fixtures/content-parity');

/**
 * The record that makes a run an **apply**: what the last one wrote, and the containers this one fills.
 * `applyPacks` is the only caller that passes one, so a spec that wants the merge's rules about the user's
 * entities builds it the way that does — and one that passes nothing is an import, which is what asking for
 * a pack's data back is.
 */
export const applyAfter = (previous?: ApplyRecord): ApplyRecord => {
  if (!previous) return applyRecord();
  const items = new Map<string, AppliedItem>(previous.before);
  for (const [key, item] of previous.written) items.set(key, item);
  for (const key of previous.removed) items.delete(key);
  return applyRecord(items);
};

/**
 * The content keys the parity gate covers.
 *
 * Two sides declare different ones and that is not a defect: the `v1`/`v2` fixtures exercise the SDK's
 * `documents` key, which any pack may declare, while default-setup's own documents are its commands. A key
 * neither side has is skipped rather than compiled from nothing.
 */
export const PARITY_KEYS = ['actions', 'prompts', 'documents', 'notes', 'commands'] as const;

/**
 * default-setup ships no documents, so it registers no `documents` applier for the fixtures' documents to be
 * applied with. The harness runs the SDK's own beside the pack's — the one codegen emits for a pack that
 * declares the key — so what the fixtures exercise is what such a pack gets.
 */
const documentsApplier = createDocumentsApplier();

function importParityContent(options: Parameters<typeof importCompiledContent>[0]): Record<string, ApplyResult> {
  const result = importCompiledContent(options);
  const include = options.include?.documents;
  result.documents = include instanceof Set && include.size === 0
    ? { created: 0, updated: 0, skipped: 0 }
    : documentsApplier.apply({ compiledDir: options.compiledDir, include, mode: options.mode, applied: options.applied, log: () => {} });
  return result;
}
const SNAPSHOT_TYPES = ['Action', 'Prompt', 'Document', 'Collection', 'Note'];

const manifest = JSON.parse(fs.readFileSync(path.join(PACK_DIR, 'apack.json'), 'utf-8'));

type ContentEntry = string | { path?: string; [key: string]: unknown };

/** The sources a scenario content: a fixture version of every parity key, or the pack's own sources */
export type SourceSet = 'v1' | 'v2' | 'default-setup';

function withPath(entry: ContentEntry, sourcePath: string): ContentEntry {
  return typeof entry === 'string' ? sourcePath : { ...entry, path: sourcePath };
}

/** Compiles the parity keys' sources through the pack's manifest entries into a fresh directory */
export async function compileContent(sources: SourceSet): Promise<string> {
  const entries: Record<string, ContentEntry> = {};
  for (const key of PARITY_KEYS) {
    const entry = manifest.content.sources[key] as ContentEntry | undefined;
    if (sources === 'default-setup') {
      if (entry === undefined) continue;
      entries[key] = withPath(entry, typeof entry === 'string' ? entry : entry.path!);
      continue;
    }
    const fixtureDir = path.join(FIXTURES, sources, key);
    if (!fs.existsSync(fixtureDir)) continue;
    // A key the pack doesn't declare is one of the SDK's, which takes a path alone
    entries[key] = withPath(entry ?? path.relative(PACK_DIR, fixtureDir), path.relative(PACK_DIR, fixtureDir));
  }
  const pack = { ...manifest, steps: undefined, artifacts: undefined, blocks: undefined, content: { ...manifest.content, artifacts: undefined, sources: entries } };
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-parity-'));
  const packConfig = await buildPackConfigFromManifest(pack, PACK_DIR);
  await compilePack({ packDir: PACK_DIR, outputDir, packConfig });
  return outputDir;
}

/** Empties the in-memory database and the media store */
export function resetDatabase(): void {
  resetTestData();
}

/**
 * An **import**: no record, which is the user asking for the pack's content back. The modes are the whole of
 * its policy, and it detects no edit and removes nothing, so it is what the parity goldens are recorded
 * through — a scenario that content one fixture version over another is about the modes, not about a merge.
 */
export function apply(compiledDir: string, options: { mode?: ImportMode; include?: Record<string, ContentSelection> } = {}): Record<string, ApplyResult> {
  const result = importParityContent({ compiledDir, mode: options.mode, include: options.include });
  return Object.fromEntries(PARITY_KEYS.map((key) => [key, result[key]]));
}

/**
 * An **apply**, carrying the record forward from the run before, which is how the app's boot runs it. A spec
 * about what the user's edit survives needs this rather than `content`: the merge reads what the last apply
 * wrote, and an apply whose record has never seen an item adopts it.
 */
export function applyContent(
  compiledDir: string,
  previous: ApplyRecord | undefined,
  options: { mode?: ImportMode; include?: Record<string, ContentSelection> } = {},
): { counts: Record<string, ApplyResult>; record: ApplyRecord } {
  const record = applyAfter(previous);
  const result = importParityContent({ compiledDir, mode: options.mode, include: options.include, applied: record });
  return { counts: Object.fromEntries(PARITY_KEYS.map((key) => [key, result[key]])), record };
}

export interface Snapshot {
  rows: Record<string, Record<string, unknown>>;
  /** `source --kind--> target`, in creation order */
  relations: string[];
  media: string[];
}

const typeOf = (id: string) => id.slice(0, id.indexOf('-'));
// Which item an entity came from, which carries ids a normalized snapshot must not hold; edited-rows.spec.ts covers it
const DROPPED_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'contentKey']);

export function snapshot(): Snapshot {
  const ids = entityIds() as string[];
  const rows = new Map<string, Record<string, unknown>>();
  const relations: Array<{ source: string; kind: string; target: string }> = findRelations()
    .map(({ source, kind, target }) => ({ source, kind, target }));
  for (const id of ids) {
    if (!SNAPSHOT_TYPES.includes(typeOf(id))) continue;
    const row = (query.withTrashed.ids(id as EARS.EntityId).pickAll() as Array<Record<string, unknown>>)[0];
    if (row) rows.set(id, row);
  }

  // Stable aliases: type plus identity (a note's is its parent chain)
  // Nesting relations only: a note's REFERENCES link to another note doesn't make it that note's parent
  const parentOf = new Map(relations
    .filter((r) => r.kind !== 'references' && rows.has(r.target) && rows.has(r.source))
    .map((r) => [r.target, r.source]));
  const identity = (id: string): string => {
    const row = rows.get(id)!;
    const own = String(row.name ?? row.title ?? row.label);
    const parent = parentOf.get(id);
    return parent && typeOf(id) === 'Note' ? `${identity(parent)}/${own}` : own;
  };
  const alias = new Map<string, string>();
  for (const id of rows.keys()) {
    let name = `${typeOf(id)}:${identity(id)}`;
    for (let n = 2; [...alias.values()].includes(name); n++) name = `${typeOf(id)}:${identity(id)}#${n}`;
    alias.set(id, name);
  }
  const replaceIds = (text: string) => text.replace(/\b[A-Z][A-Za-z]+-[A-Za-z0-9]{6,}\b/g, (id) => alias.get(id) ?? id);

  const normalized: Snapshot['rows'] = {};
  for (const [id, row] of rows) {
    const fields = Object.fromEntries(
      Object.entries(row)
        .filter(([key]) => !DROPPED_FIELDS.has(key))
        .sort(([a], [b]) => a.localeCompare(b)),
    );
    normalized[alias.get(id)!] = JSON.parse(replaceIds(JSON.stringify(fields)));
  }

  const media: string[] = [];
  const mediaRoot = testMediaPath();
  if (fs.existsSync(mediaRoot)) {
    for (const dir of fs.readdirSync(mediaRoot)) {
      for (const file of fs.readdirSync(path.join(mediaRoot, dir))) {
        // A deleted row's media folder stays behind; its id is gone, so name it by type
        media.push(`${alias.get(dir) ?? `${typeOf(dir)}:(deleted)`}/${file}=${fs.readFileSync(path.join(mediaRoot, dir, file), 'utf-8')}`);
      }
    }
  }

  return {
    rows: Object.fromEntries(Object.entries(normalized).sort(([a], [b]) => a.localeCompare(b))),
    // Sorted, as rows and media are: a golden is read by diffing it, so nothing in it may depend on
    // the order a run happened to produce. Insert a content key in the middle of `PARITY_KEYS` and an
    // unsorted field moves every line, which is a diff nobody can confirm is the change they meant.
    relations: relations
      .filter((r) => rows.has(r.source) || rows.has(r.target))
      .map((r) => `${alias.get(r.source) ?? r.source} --${r.kind}--> ${alias.get(r.target) ?? r.target}`)
      .sort(),
    media: media.sort(),
  };
}
