// apack db inspect: an entity's relations, followed a few levels, or relation counts per entity type and what the
// engine holds
import type { Ears, EARS, MemoryStats } from '@apackdev/ears';
import type { LmdbStoreStats } from '@apackdev/ears/lmdb';
import { openTarget, parseDbArgs, TARGET_USAGE, withDatabase, type DbIo } from './target';

const OPTIONS = {
  type: { type: 'string', short: 't' },
  depth: { type: 'string', default: '1' },
  incoming: { type: 'boolean', default: false },
  outgoing: { type: 'boolean', default: false },
} as const;

export const INSPECT_USAGE = [
  'Usage: apack db inspect [<entity-id> | --type <Entity>] [options]',
  '',
  'Prints an entity with its relations, or the first five entities of a type, or with neither, relation counts per',
  'entity type and what the engine holds: per type in memory, out of memory, its cache, and what loading took.',
  '',
  'Options:',
  '  -t, --type <Entity>    The first five entities of a type',
  '  --depth <n>            Levels of relations to follow (default 1)',
  '  --incoming             Only relations pointing at the entity',
  '  --outgoing             Only relations from the entity (with neither, or both: both)',
  TARGET_USAGE,
].join('\n');

type Direction = 'outgoing' | 'incoming';

export interface InspectOptions {
  depth: number;
  directions: Direction[];
}

const entityType = (id: string) => id.split('-')[0];

/** The ids an entity's relations in one direction reach, by relation kind */
function relatedByKind(ears: Ears, entityId: EARS.EntityId, direction: Direction): Map<string, string[]> {
  const relations = direction === 'outgoing'
    ? ears.findRelations({ source: entityId })
    : ears.findRelations({ target: entityId });
  const byKind = new Map<string, string[]>();
  for (const relation of relations) {
    const other = direction === 'outgoing' ? relation.target : relation.source;
    // Pushed onto the kind's own array: an entity with thousands of relations of one kind is common (a thread's
    // messages), and rebuilding the array for each of them is quadratic
    const kind = byKind.get(relation.kind);
    if (kind) kind.push(other);
    else byKind.set(relation.kind, [other]);
  }
  return byKind;
}

/**
 * The lines showing an entity and its relations in `options.directions`, followed `options.depth` levels (a
 * related entity at the last level is listed by id, and one already shown isn't shown again)
 */
export function graphLines(ears: Ears, entityId: string, options: InspectOptions, depth = options.depth, indent = '', seen = new Set<string>()): string[] {
  if (seen.has(entityId)) return [`${indent}[${entityType(entityId)}] ${entityId} (shown above)`];
  seen.add(entityId);
  const attributes = ears.getRow(entityId as EARS.EntityId);
  if (!attributes) return [`${indent}Not found: ${entityId}`];

  const name = String(attributes.label ?? attributes.name ?? attributes.title ?? '');
  const lines = [`${indent}[${entityType(entityId)}] ${entityId}${name ? ` "${name.length > 40 ? `${name.slice(0, 40)}...` : name}"` : ''}`];
  const roles = ears.getRoles(entityId as EARS.EntityId);
  if (roles.length > 0) lines.push(`${indent}  roles: ${roles.join(', ')}`);

  for (const direction of options.directions) {
    const byKind = relatedByKind(ears, entityId as EARS.EntityId, direction);
    const arrow = direction === 'outgoing' ? '->' : '<-';
    for (const [kind, related] of byKind) {
      lines.push(`${indent}  ${arrow} ${kind} (${related.length})`);
      const shown = related.slice(0, 10);
      for (const relatedId of shown) {
        lines.push(...(depth > 1
          ? graphLines(ears, relatedId, options, depth - 1, `${indent}    `, seen)
          : [`${indent}      [${entityType(relatedId)}] ${relatedId}`]));
      }
      if (related.length > shown.length) lines.push(`${indent}      ... and ${related.length - shown.length} more`);
    }
  }
  return lines;
}

/** Entities and outgoing relations per entity type, for the types that have entities */
export function relationStatsLines(ears: Ears, entityTypes: Iterable<string>): string[] {
  const rows = [...entityTypes].sort().flatMap((type) => {
    // The registered types, the trash included: what the data dir holds of each
    const ids = ears.query.withTrashed(type).ids();
    if (ids.length === 0) return [];
    const relations = ids.reduce((sum, id) => sum + ears.findRelations({ source: id }).length, 0);
    return [[type, String(ids.length), String(relations), (relations / ids.length).toFixed(1)]];
  });
  const header = ['Entity type', 'Entities', 'Relations', 'Per entity'];
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)));
  const line = (cells: string[]) => cells.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join('  ');
  return [line(header), ...rows.map(line)];
}

/** Lines of a table: a left-aligned first column and right-aligned numbers */
function table(header: string[], rows: string[][]): string[] {
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)));
  const line = (cells: string[]) => cells.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join('  ');
  return [line(header), ...rows.map(line)];
}

const mb = (bytes: number) => `${(bytes / 2 ** 20).toFixed(1)} MB`;

/**
 * What the engine holds per type (its values' size serialized, an out-of-line value counted as its marker), what it
 * keeps out of memory, its cache, and what opening the data took
 */
export function memoryLines(memory: MemoryStats, store: LmdbStoreStats): string[] {
  const types = Object.entries(memory.types).sort(([, a], [, b]) => b.bytes - a.bytes);
  const total = types.reduce((sum, [, { bytes }]) => sum + bytes, 0);
  const { cache } = memory;
  const reads = cache.hits + cache.misses;
  return [
    ...table(['In memory', 'Entities', 'Attributes', 'Values'], types.map(([type, stats]) => [type, String(stats.entities), String(stats.attributes), mb(stats.bytes)])),
    `${mb(total)} of values in memory; ${memory.outOfLine.values} values out of memory: ${mb(memory.outOfLine.bytes)}`,
    `cache: ${cache.values} values, ${mb(cache.bytes)} of ${mb(cache.capacity)}; ${reads === 0 ? 'no reads' : `${cache.hits} of ${reads} reads answered`}`,
    `loaded in ${store.hydrateMs === null ? '—' : `${Math.round(store.hydrateMs)} ms`}; heap ${mb(process.memoryUsage().heapUsed)}`,
  ];
}

export async function dbInspect(args: string[], io: DbIo): Promise<void> {
  const { values, positionals, target } = parseDbArgs(args, OPTIONS, INSPECT_USAGE);
  if (positionals.length > 1) throw new Error(`Inspect one entity at a time\n\n${INSPECT_USAGE}`);
  const [entityId] = positionals;
  if (entityId && values.type) throw new Error(`Pass an entity id or --type, not both\n\n${INSPECT_USAGE}`);
  const depth = Number(values.depth);
  if (!Number.isInteger(depth) || depth < 1) throw new Error('--depth must be a whole number from 1');
  const [incoming, outgoing] = [values.incoming as boolean, values.outgoing as boolean];
  const directions: Direction[] = incoming === outgoing ? ['outgoing', 'incoming'] : incoming ? ['incoming'] : ['outgoing'];

  const db = await openTarget(target, { write: false, command: 'inspect' }, io);
  await withDatabase(db, () => {
    if (entityId) {
      graphLines(db.ears, entityId, { depth, directions }).forEach((line) => io.out(line));
    } else if (values.type) {
      if (!db.schema.getRegisteredEntityTypes().has(values.type as string)) {
        throw new Error(`Not an entity type of the installed packs: ${values.type as string}`);
      }
      const ids = db.admin.getEntitiesOfType(values.type as EARS.Entity);
      io.out(`${ids.length} ${values.type} entities${ids.length > 5 ? ', the first 5:' : ''}`);
      for (const id of ids.slice(0, 5)) graphLines(db.ears, id, { depth, directions }).forEach((line) => io.out(line));
    } else {
      relationStatsLines(db.ears, db.schema.getRegisteredEntityTypes()).forEach((line) => io.out(line));
      io.out('');
      memoryLines(db.admin.memoryStats(), db.store.stats()).forEach((line) => io.out(line));
    }
  });
}
