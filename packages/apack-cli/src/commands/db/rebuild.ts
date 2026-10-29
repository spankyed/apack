// Offline derived-index recovery; primary values and valid embeddings remain authoritative.
import { existsSync } from 'node:fs';
import { databaseStorage, openRunHistory } from '@apackdev/host/database';
import { openTarget, parseDbArgs, TARGET_USAGE, withDatabase, type DbIo } from './target';

export const REBUILD_USAGE = [
  'Usage: apack db rebuild [--force] [options]',
  '',
  'Rebuilds derived indexes from primary data while the app is closed. SQLite candidate only.',
  'Primary values and valid embeddings are retained. A failed rebuild remains recoverable on reopen.',
  'Without --force, only describes the operation. Make a backup before repairing damaged storage.',
  '',
  '  --database <store>     primary (default), runs, or all; stores rebuild separately',
  '  --force                Admit new generations and wait for readiness',
  TARGET_USAGE,
].join('\n');

export async function dbRebuild(args: string[], io: DbIo): Promise<void> {
  const { values, positionals, target } = parseDbArgs(args, { force: { type: 'boolean', default: false }, database: { type: 'string', default: 'primary' } }, REBUILD_USAGE);
  if (positionals.length) throw new Error(`Unexpected argument ${positionals[0]}\n\n${REBUILD_USAGE}`);
  if (!['primary', 'runs', 'all'].includes(String(values.database))) throw new Error('--database must be primary, runs or all');
  const database = await openTarget(target, { write: values.force === true, command: 'rebuild' }, io);
  await withDatabase(database, async () => {
    const storage = databaseStorage(database.database.format);
    if (!storage.rebuildIndexes) throw new Error(`Index rebuilding is not implemented for ${storage.format}`);
    if (values.database !== 'primary' && !existsSync(database.paths.runHistory)) {
      throw new Error(`No run history database at ${database.paths.runHistory}; nothing was created`);
    }
    const history = values.database !== 'primary' ? openRunHistory(database.paths.runHistory, {
      readOnly: values.force !== true, storageFormat: database.database.format, replaceUnreadable: false,
    }) : undefined;
    const rebuild = async () => {
      const selected = [
        ...(values.database !== 'runs' ? [{ name: 'primary', database: database.database }] : []),
        ...(history ? [{ name: 'runs', database: history.database }] : []),
      ];
      for (const selectedStore of selected) {
        const prefix = selected.length > 1 || selectedStore.name === 'runs' ? `${selectedStore.name}: ` : '';
        if (!values.force) {
          io.out(prefix + 'Would rebuild derived indexes from primary data. Dry run: nothing was changed. Run again with --force.');
        } else {
          await storage.rebuildIndexes!(selectedStore.database);
          io.out(prefix + 'Rebuilt derived indexes; all current generations are ready.');
        }
      }
    };
    if (history) await withDatabase({ close: () => history.database.close() }, rebuild);
    else await rebuild();
  });
}
