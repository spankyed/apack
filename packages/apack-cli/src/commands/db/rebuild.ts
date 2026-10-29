// Offline derived-index recovery; primary values and valid embeddings remain authoritative.
import { databaseStorage } from '@apackdev/host/database';
import { openTarget, parseDbArgs, TARGET_USAGE, withDatabase, type DbIo } from './target';

export const REBUILD_USAGE = [
  'Usage: apack db rebuild [--force] [options]',
  '',
  'Rebuilds derived indexes from primary data while the app is closed. SQLite candidate only.',
  'Primary values and valid embeddings are retained. A failed rebuild remains recoverable on reopen.',
  'Without --force, only describes the operation. Make a backup before repairing damaged storage.',
  '',
  '  --force                Admit new generations and wait for readiness',
  TARGET_USAGE,
].join('\n');

export async function dbRebuild(args: string[], io: DbIo): Promise<void> {
  const { values, positionals, target } = parseDbArgs(args, { force: { type: 'boolean', default: false } }, REBUILD_USAGE);
  if (positionals.length) throw new Error(`Unexpected argument ${positionals[0]}\n\n${REBUILD_USAGE}`);
  const database = await openTarget(target, { write: values.force === true, command: 'rebuild' }, io);
  await withDatabase(database, async () => {
    const storage = databaseStorage(database.database.format);
    if (!storage.rebuildIndexes) throw new Error(`Index rebuilding is not implemented for ${storage.format}`);
    if (!values.force) {
      io.out('Would rebuild derived indexes from primary data. Dry run: nothing was changed. Run again with --force.');
      return;
    }
    await storage.rebuildIndexes(database.database);
    io.out('Rebuilt derived indexes; all current generations are ready.');
  });
}
