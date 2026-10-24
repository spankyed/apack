// apack db import | reset | clear-settings: commands that replace or delete data, and only list what they would
// change unless given --force
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { readInstalledContributionCatalog, disabledPackIds } from '@apackdev/host/packs';
import { createSettingsBackupValidator } from '@apackdev/host/settings';
import type { EARS } from '@apackdev/ears';
import { importDatabase, readBackup, type BackupLog } from '@apackdev/host/backup';
import { openRunHistoryStore, type AppDatabase } from '@apackdev/host/database';
import { createSecretsStore } from '@apackdev/host/secrets';
import { _secretProviderLabel } from '@apackdev/sdk/services';
import { openTarget, parseDbArgs, TARGET_USAGE, withDatabase, type DbIo } from './target';

const FORCE = { force: { type: 'boolean', default: false } } as const;
const RESET_OPTIONS = { ...FORCE, 'keep-keys': { type: 'boolean', default: false } } as const;
const IMPORT_OPTIONS = { ...FORCE, 'skip-unknown': { type: 'boolean', default: false } } as const;
const FORCE_USAGE = '  --force                Make the change (without it, the command only lists it)';

const DRY_RUN = 'Dry run: nothing was changed. Run again with --force to make the change.';

/** The backup's progress lines as command output: on stderr, where everything that isn't the result goes */
const backupLog = (io: DbIo): BackupLog => ({
  info: (message) => io.err(message),
  warn: (message, detail) => io.err(`Warning: ${message}${detail ? `: ${Object.values(detail).flat().join(', ')}` : ''}`),
});

/** Entities per type in the hydrated database, for the types that have some */
function entityCounts(db: AppDatabase): Array<[string, number]> {
  return [...db.schema.getRegisteredEntityTypes()].sort()
    .map((type) => [type, db.admin.getEntitiesOfType(type as EARS.Entity).length] as [string, number])
    .filter(([, count]) => count > 0);
}

function countLines(counts: Array<[string, number]>): string[] {
  return counts.length > 0 ? counts.map(([type, count]) => `  ${type}: ${count}`) : ['  (no entities)'];
}

/**
 * The stored keys by provider and label, never their values, so what a reset deletes is named: a key is entered
 * again from the provider's own account, and the label says which account it was
 */
function keyLines(secrets: ReturnType<typeof secretsStoreAt>): string[] {
  return secrets.list()
    .map(({ provider, label, selected }) => `  ${_secretProviderLabel(provider)} — ${label}${selected ? ' (selected)' : ''}`)
    .sort();
}

/** The stored API keys' file, whose keys a reset deletes; listing them needs no data key */
function secretsStoreAt(db: AppDatabase) {
  const refuse = () => { throw new Error('apack db never reads a key value'); };
  const vault = () => ({ backend: 'none', protection: 'unprotected' as const, get: refuse, set: refuse, delete: refuse });
  return createSecretsStore({ filePath: db.paths.secretsFile, osVault: vault, fileVault: vault });
}

// ── reset ────────────────────────────────────────────────────────────────

export const RESET_USAGE = [
  'Usage: apack db reset [--force] [options]',
  '',
  'Deletes all of the app\'s data, as Reset Database in the Database settings does: both database partitions and the',
  'stored API keys, which no backup holds: each is entered again in Settings → Secrets.',
  'apack creates its default data again on its next start, and shows onboarding.',
  '',
  'Options:',
  FORCE_USAGE,
  '  --keep-keys            Leave the stored API keys where they are, and delete only the data',
  TARGET_USAGE,
].join('\n');

export async function dbReset(args: string[], io: DbIo): Promise<void> {
  const { values, positionals, target } = parseDbArgs(args, RESET_OPTIONS, RESET_USAGE);
  if (positionals.length > 0) throw new Error(`Unexpected argument ${positionals[0]}\n\n${RESET_USAGE}`);
  const force = values.force as boolean;
  const keepKeys = values['keep-keys'] as boolean;

  // Without --force nothing is changed, so the database opens read-only: a copy the user may not write is listed too
  const db = await openTarget(target, { write: force, command: 'reset' }, io);
  const done = await withDatabase(db, async () => {
    const secrets = secretsStoreAt(db);
    const keys = fs.existsSync(db.paths.secretsFile) ? keyLines(secrets) : [];
    io.out(`${force ? 'Deleting' : 'Would delete'} the database (${db.paths.lmdb}):`);
    countLines(entityCounts(db)).forEach((line) => io.out(line));
    const hasHistory = fs.existsSync(db.paths.runHistory);
    if (hasHistory) io.out(`${force ? 'Deleting' : 'Would delete'} the run history (${db.paths.runHistory})`);
    if (keepKeys) {
      io.out(`Keeping ${keys.length} stored API key(s) (--keep-keys)`);
    } else {
      // Named, because no backup holds them: the provider and the account's label are what it takes to enter one again
      io.out(`${force ? 'Deleting' : 'Would delete'} ${keys.length} stored API key(s), which no backup holds:`);
      keys.forEach((line) => io.out(line));
    }
    if (!force) {
      io.out(`\n${DRY_RUN}`);
      return null;
    }
    db.store.reset();
    db.admin.clear();
    // The write lock is held and no app runs on the data dir, so nothing has the run history open
    if (hasHistory) fs.rmSync(db.paths.runHistory, { recursive: true, force: true });
    if (!keepKeys) secrets.clearAll();
    return '\nReset. apack creates its default data on its next start.';
  });
  if (done) io.out(done);
}

// ── clear-settings ───────────────────────────────────────────────────────

const SETTINGS_ENTITY = 'Settings';

export const CLEAR_SETTINGS_USAGE = [
  'Usage: apack db clear-settings [--force] [options]',
  '',
  'Destroys every Settings row; apack recreates the default settings on its next start.',
  '',
  'Options:',
  FORCE_USAGE,
  TARGET_USAGE,
].join('\n');

export interface SettingsRow {
  id: string;
  label?: string;
  /** Top-level keys of its stored data (the user's changes from the defaults) */
  dataKeys: string[];
}

function describeSettingsRow(db: AppDatabase, id: EARS.EntityId): SettingsRow {
  // A listed Settings row is in the engine
  const attributes = db.ears.getRow(id)!;
  const data = attributes.data;
  return {
    id,
    ...(typeof attributes.label === 'string' && { label: attributes.label }),
    dataKeys: data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : [],
  };
}

export async function dbClearSettings(args: string[], io: DbIo): Promise<void> {
  const { values, positionals, target } = parseDbArgs(args, FORCE, CLEAR_SETTINGS_USAGE);
  if (positionals.length > 0) throw new Error(`Unexpected argument ${positionals[0]}\n\n${CLEAR_SETTINGS_USAGE}`);
  const force = values.force as boolean;

  // Without --force nothing is destroyed, so the database opens read-only
  const db = await openTarget(target, { write: force, command: 'clear-settings' }, io);
  const done = await withDatabase(db, () => {
    const rows = db.admin.getEntitiesOfType(SETTINGS_ENTITY as EARS.Entity).map((id) => describeSettingsRow(db, id));
    if (rows.length === 0) {
      io.out('No Settings rows: nothing to destroy.');
      return null;
    }
    io.out(`${force ? 'Destroying' : 'Would destroy'} ${rows.length} Settings row(s):`);
    for (const row of rows) {
      io.out(`  ${row.id}${row.label ? `  label: ${row.label}` : ''}  stored keys: ${row.dataKeys.join(', ') || '(none)'}`);
    }
    if (!force) {
      io.out(`\n${DRY_RUN}`);
      return null;
    }
    for (const row of rows) db.ears.write(row.id as EARS.EntityId).destroy();
    return `\nDestroyed ${rows.length} Settings row(s). apack recreates the defaults on its next start.`;
  });
  if (done) io.out(done);
}

// ── import ───────────────────────────────────────────────────────────────

export const IMPORT_USAGE = [
  'Usage: apack db import <backup-dir> [--force] [options]',
  '',
  'Replaces the database (and media) with a backup made in the Database settings\' Backup & Restore, after checking',
  'the backup opens. A backup from a newer apack, holding stores this one doesn\'t have, is refused unless you',
  'say to leave those out.',
  '',
  'Options:',
  FORCE_USAGE,
  '  --skip-unknown         Import a newer apack\'s backup without the stores this one doesn\'t have',
  TARGET_USAGE,
].join('\n');

export async function dbImport(args: string[], io: DbIo): Promise<void> {
  const { values, positionals, target } = parseDbArgs(args, IMPORT_OPTIONS, IMPORT_USAGE);
  if (positionals.length !== 1) throw new Error(`Name one backup directory\n\n${IMPORT_USAGE}`);
  const backupDir = path.resolve(positionals[0]);
  const force = values.force as boolean;

  // Without --force nothing is replaced, so the database opens read-only
  const db = await openTarget(target, { write: force, command: 'import' }, io);
  const done = await withDatabase(db, async () => {
    // The backup is checked before anything changes
    const environment = resolveAppEnvironment({ env: target.env, userDataDir: db.userDataDir });
    const catalog = readInstalledContributionCatalog(environment.packsDir, disabledPackIds(environment.installedPacksFile));
    const validate = createSettingsBackupValidator(catalog.settings());
    const backup = readBackup(backupDir, db.schema.getRegisteredEntityTypes(), validate);
    const skipUnknown = values['skip-unknown'] as boolean;
    if (backup.unknownDatabases.length > 0 && !skipUnknown) {
      throw new Error(
        `The backup also holds ${backup.unknownDatabases.join(', ')}, which this apack doesn't have: it was made by a newer ` +
        'one, and importing it would replace your data with an incomplete copy. Run again with --skip-unknown to import it without those.',
      );
    }
    io.out(`Backup: ${backupDir}`);
    if (backup.timestamp) io.out(`  made ${new Date(backup.timestamp).toISOString()}${backup.appVersion ? ` by apack ${backup.appVersion}` : ''}`);
    io.out(`  databases: ${backup.databases.join(', ')}${backup.hasMedia ? ', with media' : ''}`);
    if (backup.unknownDatabases.length > 0) io.out(`  leaving out ${backup.unknownDatabases.join(', ')}, which this apack doesn't have`);
    if (backup.missingDatabases.length > 0) io.out(`  lists ${backup.missingDatabases.join(', ')} but holds nothing for it, so it comes back empty`);
    // A pack that was installed when the backup was made and isn't now: its rows come back, unread until it is
    if (backup.unknownEntityTypes.length > 0) {
      io.out(`  holds ${backup.unknownEntityTypes.map(([type, count]) => `${count} ${type}`).join(', ')} that no installed pack declares; they stay, unread, until that pack is installed again`);
    }
    countLines(backup.counts).forEach((line) => io.out(line));
    io.out(`${force ? 'Replacing' : 'Would replace'} the current database, which holds:`);
    countLines(entityCounts(db)).forEach((line) => io.out(line));
    if (backup.hasMedia) io.out(`${force ? 'Replacing' : 'Would replace'} ${db.paths.media}`);
    if (!force) {
      io.out(`\n${DRY_RUN}`);
      return null;
    }
    // Its progress lines go to stderr with everything else that isn't the result, so `apack db import > file` holds
    // only what the command was asked for
    const runHistory = openRunHistoryStore(db.paths.runHistory);
    try {
      await importDatabase({ lmdb: db.store, runHistory }, backupDir, db.paths.media, { skipUnknownDatabases: skipUnknown, log: backupLog(io), validate });
    } finally {
      runHistory.close();
    }
    return '\nImported.';
  });
  if (done) io.out(done);
}
