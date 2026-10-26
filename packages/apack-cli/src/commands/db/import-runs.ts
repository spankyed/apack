// apack db import-runs: a run history dumped from a record store (elmdb's tools/lmdb-js-export --records), into a data
// dir's run history
import * as fs from 'node:fs';
import type { EARS } from '@apackdev/ears';
import { openRunHistory } from '@apackdev/host/database';
import { openTarget, parseDbArgs, TARGET_USAGE, withDatabase, type DbIo } from './target';

const OPTIONS = { force: { type: 'boolean', default: false } } as const;

export const IMPORT_RUNS_USAGE = [
  'Usage: apack db import-runs <dump> [--force] [options]',
  '',
  'Puts the runs in a record store\'s dump — what elmdb\'s tools/lmdb-js-export --records writes from a run history',
  'apack kept before it ran on elmdb — into the data dir\'s run history, each node under the id it had. Refuses a run',
  'history that already holds a run, so it never merges two. Run it on a copy of the data dir.',
  '',
  'Options:',
  '  --force                Make the change (without it, the command only lists it)',
  TARGET_USAGE,
].join('\n');

/** The header a records dump starts with, and the one format of record store the run history was kept in */
const DUMP = { dump: 'apack-records', version: 1, format: 1 };

/** The dump's records, after its header is checked */
export function readRunsDump(file: string): Record<string, unknown>[] {
  const [header, ...lines] = fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.length > 0);
  const parsed = header === undefined ? undefined : JSON.parse(header) as Record<string, unknown>;
  if (!parsed || parsed.dump !== DUMP.dump || parsed.version !== DUMP.version || parsed.format !== DUMP.format) {
    throw new Error(`${file} isn't a run history dump: it starts with ${header ?? 'nothing'}, not ${JSON.stringify(DUMP)}`);
  }
  return lines.map((line, at) => {
    const record = JSON.parse(line) as Record<string, unknown>;
    if (typeof record.id !== 'string' || !record.id.startsWith('RunNode-')) {
      throw new Error(`${file}, record ${at + 1}: not a run node (its id is ${JSON.stringify(record.id)})`);
    }
    return record;
  });
}

export async function dbImportRuns(args: string[], io: DbIo): Promise<void> {
  const { values, positionals, target } = parseDbArgs(args, OPTIONS, IMPORT_RUNS_USAGE);
  const [file, ...extra] = positionals;
  if (!file) throw new Error(`Name the dump to import\n\n${IMPORT_RUNS_USAGE}`);
  if (extra.length > 0) throw new Error(`Unexpected argument ${extra[0]}\n\n${IMPORT_RUNS_USAGE}`);
  const force = values.force as boolean;
  const records = readRunsDump(file);

  // The app's database is opened for its write lock and its refusal while an app runs on the data dir
  const db = await openTarget(target, { write: force, command: 'import-runs' }, io);
  const done = await withDatabase(db, () => {
    const dir = db.paths.runHistory;
    if (!force) {
      io.out(`Would import ${records.length} run node(s) into the run history (${dir})`);
      io.out('\nDry run: nothing was changed. Run again with --force to make the change.');
      return null;
    }
    const runs = openRunHistory(dir);
    try {
      const held = runs.engine.query('RunNode').count();
      if (held > 0) throw new Error(`The run history at ${dir} already holds ${held} run node(s): import into one that holds none`);
      runs.engine.transact(() => {
        for (const { id, ...fields } of records) runs.engine.create('RunNode', { ...fields, id: id as EARS.EntityId });
      });
    } finally {
      runs.database.close();
    }
    return `Imported ${records.length} run node(s) into ${dir}`;
  });
  if (done) io.out(done);
}
