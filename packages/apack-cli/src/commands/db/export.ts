// apack db export: each entity type's entities, with their attributes, to a file per type, and the relations
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RESERVED_ENTITY_TYPES, type EARS } from '@apackdev/ears';
import { openTarget, parseDbArgs, TARGET_USAGE, withDatabase, type DbIo } from './target';
import { toCSV, toJSON } from './output';

const OPTIONS = {
  type: { type: 'string', short: 't', multiple: true },
  out: { type: 'string' },
  format: { type: 'string', default: 'json' },
} as const;

export const EXPORT_USAGE = [
  'Usage: apack db export --out <dir> [--type <Entity>...] [options]',
  '',
  'Writes each entity type\'s entities, with every attribute, to <dir>/<Entity>.json (or .csv), the relations to',
  '<dir>/Relation.json (each { id, kind, source, target, info }, and weight for a weighted kind; not with --type), and',
  'a summary to <dir>/export.json.',
  'Roles are an attribute, `role`.',
  '',
  'Options:',
  '  --out <dir>            Where the files go (required)',
  '  -t, --type <Entity>    An entity type to export; repeat for more (default: every type with entities)',
  '  --format <format>      json (default) or csv',
  TARGET_USAGE,
].join('\n');

export async function dbExport(args: string[], io: DbIo): Promise<void> {
  const { values, positionals, target } = parseDbArgs(args, OPTIONS, EXPORT_USAGE);
  if (positionals.length > 0) throw new Error(`Unexpected argument ${positionals[0]}\n\n${EXPORT_USAGE}`);
  if (!values.out) throw new Error(`--out is required\n\n${EXPORT_USAGE}`);
  const format = values.format as string;
  if (format !== 'json' && format !== 'csv') throw new Error('--format must be json or csv');

  const db = await openTarget(target, { write: false, command: 'export' }, io);
  await withDatabase(db, () => {
    const known = db.schema.getRegisteredEntityTypes();
    const requested = values.type as string[] | undefined;
    const unknown = requested?.filter((type) => !known.has(type)) ?? [];
    if (unknown.length > 0) throw new Error(`Not an entity type of the installed packs: ${unknown.join(', ')}`);
    const types = (requested ?? [...known].sort()).filter((type, index, all) => all.indexOf(type) === index);

    const outDir = path.resolve(values.out as string);
    fs.mkdirSync(outDir, { recursive: true });
    const counts: Record<string, number> = {};
    for (const type of types) {
      const ids = db.admin.getEntitiesOfType(type as EARS.Entity);
      if (ids.length === 0 && !requested) continue;
      // Listed ids are the engine's, so each has a row
      const rows = ids.map((id) => db.ears.getRow(id)!);
      fs.writeFileSync(path.join(outDir, `${type}.${format}`), format === 'csv' ? toCSV(rows) : `${toJSON(rows)}\n`);
      counts[type] = rows.length;
      io.out(`${type}: ${rows.length}`);
    }
    // Relations are no entity type: every one, unless the export was narrowed to types. Their file is named for the
    // engine's own relation prefix, which no entity type can be, so it never takes an entity type's file
    let relations: number | undefined;
    if (!requested) {
      const rows = db.ears.findRelations();
      fs.writeFileSync(path.join(outDir, `${RESERVED_ENTITY_TYPES.relation}.${format}`), format === 'csv' ? toCSV(rows) : `${toJSON(rows)}\n`);
      relations = rows.length;
      io.out(`relations: ${relations}`);
    }
    const summary = {
      exportedAt: new Date().toISOString(),
      userDataDir: db.userDataDir,
      format,
      counts,
      ...(relations !== undefined && { relations }),
    };
    fs.writeFileSync(path.join(outDir, 'export.json'), `${toJSON(summary)}\n`);
    const entities = Object.values(counts).reduce((sum, n) => sum + n, 0);
    io.err(`Exported ${entities} entities${relations === undefined ? '' : ` and ${relations} relations`} to ${outDir}`);
  });
}
