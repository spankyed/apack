// Logical recovery files preserve primary bytes. Host publication and import own persistence and rollback.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { databaseStorage, findRunningApp, holdDatabaseWriteLock } from '@apackdev/host/database';
import { databaseBackupStore, exportLogicalDatabase, importLogicalDatabase, readLogicalBackup,
  type BackupStores, type LogicalDatabaseArchives } from '@apackdev/host/backup';
import { databaseSelection, withSelectedDatabases } from './stores';
import { settingsBackupValidator } from './backup-validation';
import { openTarget, parseDbArgs, realDestination, TARGET_USAGE, withDatabase, type DbIo } from './target';
const FILE_OPTIONS = { primary: { type: 'string' }, runs: { type: 'string' } } as const;
const FILE_USAGE = [
  '  --primary <file>      Primary database archive',
  '  --runs <file>         Run-history archive; name either or both files',
  'Each file is one independently verified database snapshot. Media, packs and secrets are not included.',
  'SQLite candidate only. Use db backup for a full database-and-media backup.',
];
export const DUMP_USAGE = [
  'Usage: apack db dump [--primary <file>] [--runs <file>] [options]', '',
  'Write lossless logical archives while the app is closed. Each destination must be new, with an existing parent,',
  'outside the source profile. Completed files remain valid if a later selected export fails.',
  ...FILE_USAGE, TARGET_USAGE,
].join('\n');
export const LOAD_USAGE = [
  'Usage: apack db load [--primary <file>] [--runs <file>] [--force] [options]', '',
  'Fully verify, rebuild and audit the selected archives before replacing any selected database.',
  'Without --force this validates a dry run. Unselected stores and existing media are preserved.',
  '  --force               Replace the selected stores using protected import and recovery',
  ...FILE_USAGE, TARGET_USAGE,
].join('\n');
function inputs(values: Record<string, unknown>, usage: string) {
  const files = (['primary', 'runs'] as const).flatMap(name => {
    const value = values[name];
    if (value === undefined) return [];
    if (typeof value !== 'string' || !value.trim()) throw new Error(`--${name} needs a file path\n\n${usage}`);
    return [{ name, file: path.resolve(value) }];
  });
  if (!files.length) throw new Error(`Name --primary and/or --runs\n\n${usage}`);
  return files;
}
const selection = (files: ReturnType<typeof inputs>) => databaseSelection(files.length === 2 ? 'all' : files[0]!.name);
const storeName = (name: 'primary' | 'runs') => name === 'primary' ? 'lmdb' : 'runHistory';

export async function dbDump(args: string[], io: DbIo): Promise<void> {
  const { values, positionals, target } = parseDbArgs(args, FILE_OPTIONS, DUMP_USAGE);
  if (positionals.length) throw new Error(`Unexpected argument ${positionals[0]}\n\n${DUMP_USAGE}`);
  const files = inputs(values, DUMP_USAGE);
  if (!target.named) throw new Error('Name the data dir to dump: --profile <name> or --data-dir <path>');
  const source = fs.realpathSync(target.userDataDir), destinations = files.map(file => realDestination(file.file));
  if (new Set(destinations).size !== destinations.length) throw new Error('Each selected store needs a different output file');
  for (let i = 0; i < files.length; i++) {
    const relative = path.relative(source, destinations[i]!);
    if (!relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)))
      throw new Error('Logical archive destinations must be outside the source profile');
    try { fs.lstatSync(files[i]!.file); throw Object.assign(new Error(`Archive target exists: ${files[i]!.file}`), { code: 'EEXIST' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const lock = holdDatabaseWriteLock(target.userDataDir, 'apack db dump');
  let failed = false, failure: unknown;
  try {
    if (findRunningApp(target)) throw new Error('Quit the app before dumping logical archives');
    const app = await openTarget(target, { write: false, command: 'dump' }, io);
    await withDatabase(app, () => withSelectedDatabases(app, selection(files), false, async selected => {
      for (const store of selected) if (!databaseStorage(store.database.format).exportLogicalSnapshot)
        throw new Error(`Logical export is not implemented for ${store.database.format}`);
      const completed: string[] = [];
      try {
        for (const store of selected) {
          const file = files.find(file => file.name === store.name)!.file;
          await exportLogicalDatabase(store.database, file); completed.push(file); io.out(`${store.name}: ${file}`);
        }
      } catch (error) {
        if (completed.length) io.err(`Completed logical archives retained: ${completed.join(', ')}`);
        throw error;
      }
    }));
  } catch (error) { failed = true; failure = error; }
  try { lock.release(); }
  catch (cleanup) { throw new AggregateError(failed ? [failure, cleanup] : [cleanup], 'Logical dump lock cleanup failed', { cause: failed ? failure : cleanup }); }
  if (failed) throw failure;
}

export async function dbLoad(args: string[], io: DbIo): Promise<void> {
  const { values, positionals, target } = parseDbArgs(args, { ...FILE_OPTIONS, force: { type: 'boolean', default: false } }, LOAD_USAGE);
  if (positionals.length) throw new Error(`Unexpected argument ${positionals[0]}\n\n${LOAD_USAGE}`);
  const files = inputs(values, LOAD_USAGE), force = values.force === true;
  if (!target.named) throw new Error('Name the data dir to load: --profile <name> or --data-dir <path>');
  const app = await openTarget(target, { write: force, command: 'load' }, io);
  await withDatabase(app, () => withSelectedDatabases(app, selection(files), force, async selected => {
    const stores: BackupStores = { lmdb: databaseBackupStore(app.database) }, archives: LogicalDatabaseArchives = {};
    for (const store of selected) {
      const name = storeName(store.name); stores[name] = databaseBackupStore(store.database);
      archives[name] = files.find(file => file.name === store.name)!.file;
    }
    const validate = settingsBackupValidator(app, target.env), entityTypes = app.schema.getRegisteredEntityTypes();
    const validated = `Validated logical archives: ${files.map(file => file.name).join(', ')}. Media is preserved.`;
    if (!force) {
      const preview = await readLogicalBackup(stores, archives, entityTypes, validate);
      io.out(validated);
      if (preview.unknownEntityTypes.length) io.err(`Types absent from installed packs: ${preview.unknownEntityTypes.map(([type, count]) => `${type} (${count})`).join(', ')}`);
      io.out('Dry run: nothing was changed. Run again with --force to replace selected stores.'); return;
    }
    await importLogicalDatabase(stores, archives, app.paths.media, { validate, entityTypes,
      withReplacement: async replace => { io.out(validated); return replace(); },
      log: { info: message => io.err(message), warn: message => io.err(message) } });
    io.out('Loaded logical archives.');
  }));
}
