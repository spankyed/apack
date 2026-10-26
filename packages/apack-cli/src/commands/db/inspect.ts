// apack db inspect: an entity's relations, followed a few levels, or relation counts per entity type
import type { Ears, EARS } from '@apackdev/ears';
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
  'entity type.',
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

/**
 * Entities and outgoing relations per entity type, for the types that have entities. `idsOf` lists a type's ids raw,
 * the trash included, so a type the database's own schema doesn't declare yet — a database no app has opened — is
 * counted rather than refused
 */
export function relationStatsLines(ears: Ears, entityTypes: Iterable<string>, idsOf: (type: string) => EARS.EntityId[]): string[] {
  const rows = [...entityTypes].sort().flatMap((type) => {
    const ids = idsOf(type);
    if (ids.length === 0) return [];
    const relations = ids.reduce((sum, id) => sum + ears.findRelations({ source: id }).length, 0);
    return [[type, String(ids.length), String(relations), (relations / ids.length).toFixed(1)]];
  });
  const header = ['Entity type', 'Entities', 'Relations', 'Per entity'];
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)));
  const line = (cells: string[]) => cells.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join('  ');
  return [line(header), ...rows.map(line)];
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
      relationStatsLines(db.ears, db.schema.getRegisteredEntityTypes(), (type) => db.admin.getEntitiesOfType(type as EARS.Entity))
        .forEach((line) => io.out(line));
    }
  });
}
