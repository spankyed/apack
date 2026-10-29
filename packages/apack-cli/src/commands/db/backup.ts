import { dbBackupVerify, verifyBackup, VERIFY_USAGE } from './backup-verify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { findRunningApp, holdDatabaseWriteLock, openRunHistory } from '@apackdev/host/database';
import { databaseBackupStore, exportDatabase } from '@apackdev/host/backup';
import { readHostCompatibility } from '@apackdev/host/packs';
import { openTarget, parseDbArgs, realDestination, TARGET_USAGE, withDatabase, type DbIo } from './target';

export const BACKUP_USAGE = [
  'Usage: apack db backup --out <dir> [options]', VERIFY_USAGE, '',
  'Create a restorable backup of the database, the run history and media while the app is closed.',
  'The destination must not exist. Installed packs and secrets are not included.',
  '', '  --out <dir>            New backup directory (required)', TARGET_USAGE,
].join('\n');

export async function dbBackup(args: string[], io: DbIo): Promise<void> {
  if (args[0] === 'verify') return dbBackupVerify(args.slice(1), io);
  const { values, positionals, target } = parseDbArgs(args, { out: { type: 'string' } }, BACKUP_USAGE);
  if (positionals.length || typeof values.out !== 'string' || !values.out.trim()) throw new Error(BACKUP_USAGE);
  const destination = path.resolve(values.out);
  const relative = path.relative(fs.realpathSync(target.userDataDir), realDestination(destination));
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('The backup destination must be outside the source data directory.');
  }
  if (fs.existsSync(destination)) throw new Error(`Backup destination already exists: ${destination}`);
  const lock = holdDatabaseWriteLock(target.userDataDir, 'apack db backup');
  let stage: string | undefined;
  let reserved = false;
  try {
    if (findRunningApp(target)) throw new Error('Quit the app before taking a full offline backup.');
    const db = await openTarget(target, { write: false, command: 'backup' }, io);
    await withDatabase(db, async () => {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      stage = fs.mkdtempSync(path.join(path.dirname(destination), '.apack-backup-'));
      // A data dir the app never ran a flow in has no run history yet
      const runHistory = fs.existsSync(db.paths.runHistory) ? openRunHistory(db.paths.runHistory, { readOnly: true, storageFormat: db.database.format }) : undefined;
      let backup: string;
      try {
        backup = await exportDatabase({ lmdb: databaseBackupStore(db.database), ...(runHistory && { runHistory: databaseBackupStore(runHistory.database) }) }, stage, {
          name: 'backup', databases: runHistory ? ['lmdb', 'runHistory'] : ['lmdb'], mediaPath: db.paths.media,
          appVersion: readHostCompatibility(target.userDataDir).version,
          log: { info: message => io.err(message), warn: message => io.err(message) },
        });
      } finally {
        runHistory?.database.close();
      }
      verifyBackup(backup);
      fs.chmodSync(backup, 0o700);
      // Exclusive reservation prevents overwriting a destination created while the snapshot was copied.
      fs.mkdirSync(destination);
      reserved = true;
      fs.renameSync(backup, destination);
      reserved = false;
    });
    io.out(destination);
  } finally {
    try {
      if (reserved) fs.rmdirSync(destination);
      if (stage) fs.rmSync(stage, { recursive: true, force: true });
    } finally { lock.release(); }
  }
}
