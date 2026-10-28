// What every `apack db` command shares: the data dir it targets, and opening its database offline
import * as path from 'node:path';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { resolveAppEnvironment, APP_ENVS, type AppEnvironment, type AppEnv } from '@apackdev/sdk/env';
import { configuredDatabaseFormat, findRunningApp, holdDatabaseWriteLock, openAppDatabase, type AppDatabase } from '@apackdev/host/database';
import { consoleEars, type ConsoleScope } from '@apackdev/sdk/database-console';
import { errorMessage } from '@apackdev/sdk/utils/pure';
import { cliDirs } from '../../app/pack-host';
import { resolveStoredProfile } from '../../app/profiles';
import { defaultDataEnv } from '../../utils';

/** Where a command's lines go: results on stdout, what it targets and warnings on stderr */
export interface DbIo {
  out(text: string): void;
  err(text: string): void;
}

export const processIo: DbIo = {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
};

const TARGET_OPTIONS = {
  'data-dir': { type: 'string' },
  profile: { type: 'string', multiple: true },
  'schema-from': { type: 'string' },
} satisfies ParseArgsConfig['options'];

export const TARGET_USAGE = [
  '  --data-dir <path>      A data dir, a copy of the user\'s for example',
  '  --profile <name>       Built-in or custom stored profile',
  '  --schema-from <path>   Packs to read entity types from, for a data dir that publishes none: a snapshot,',
  '                         a pack directory, or a directory of them (an app, a checkout)',
].join('\n');

export type DbTarget = Pick<AppEnvironment, 'env' | 'userDataDir' | 'apiPortFile'> & {
  /** The command named this data dir (`--data-dir` or `--profile`) rather than taking the default */
  named: boolean;
  /** `--schema-from`: packs naming the entity types a data dir doesn't publish — a snapshot, a pack, or a directory of packs */
  schemaFrom?: string;
};

/** Parse command options and resolve one explicit storage target, including temporary profile names. */
export function parseDbArgs<O extends NonNullable<ParseArgsConfig['options']>>(args: string[], options: O, usage: string) {
  let parsed;
  try {
    parsed = parseArgs({ args, options: { ...TARGET_OPTIONS, ...options }, allowPositionals: true, strict: true });
  } catch (error) {
    throw new Error(`${(error as Error).message}\n\n${usage}`);
  }
  const { 'data-dir': dataDir, profile: profileValues, 'schema-from': schemaFrom } = parsed.values as
    { 'data-dir'?: string; profile?: string[]; 'schema-from'?: string };
  if (profileValues && profileValues.length > 1) throw new Error('Specify --profile once.');
  const profile = profileValues?.[0];
  // An empty value would otherwise read as "not given" and target the default data dir
  if (dataDir !== undefined && dataDir.trim() === '') throw new Error(`--data-dir needs a path\n\n${usage}`);
  if (profile !== undefined && profile.trim() === '') throw new Error(`--profile needs a name\n\n${usage}`);
  if (schemaFrom !== undefined && schemaFrom.trim() === '') throw new Error(`--schema-from needs a path\n\n${usage}`);
  const named = [profile !== undefined && '--profile', dataDir !== undefined && '--data-dir'].filter(Boolean) as string[];
  if (named.length > 1) throw new Error(`Name one data dir, not ${named.length}: ${named.join(', ')}\n\n${usage}`);
  const env: AppEnv = APP_ENVS.find(env => env === profile) ?? defaultDataEnv();
  // Explicit targets override inherited data paths. Only an unnamed read honors APACK_USER_DATA_DIR.
  const userDataDir = dataDir !== undefined ? path.resolve(dataDir)
    : profile !== undefined ? resolveStoredProfile(cliDirs(), profile)
    : undefined;
  const context = resolveAppEnvironment({ env, ...(userDataDir !== undefined && { userDataDir }) });
  // Candidate isolation is checked before commands reserve backup paths or take a profile write lock.
  configuredDatabaseFormat(context.userDataDir);
  const target: DbTarget = {
    env, userDataDir: context.userDataDir, apiPortFile: context.apiPortFile, named: named.length === 1,
    ...(schemaFrom !== undefined && { schemaFrom: path.resolve(schemaFrom) }),
  };
  return { values: parsed.values as typeof parsed.values & Record<keyof O, unknown>, positionals: parsed.positionals, target };
}

export interface OpenOptions {
  /** The command changes the database: refused while an app runs on the data dir */
  write: boolean;
  /** The command's name, for the lock a change holds */
  command: string;
}

/**
 * Opens the target's database offline, after printing which data dir it is. A command that changes the database says
 * which data dir it means, so the production app's data is never the one a forgotten flag hits, and is refused while
 * an app runs on that data dir, which holds the database in memory and would overwrite the change or lose it; a read
 * warns that it may miss what the app hasn't written yet.
 */
export async function openTarget(target: DbTarget, { write, command }: OpenOptions, io: DbIo): Promise<AppDatabase> {
  if (write && !target.named) {
    throw new Error('Name the data dir to change: --profile <name> or --data-dir <path>');
  }
  io.err(`Database: ${target.userDataDir} (offline)`);
  // Taken before the check, so an app that starts from here on finds it and refuses to open the database
  const lock = write ? holdDatabaseWriteLock(target.userDataDir, `apack db ${command}`) : null;
  try {
    const running = findRunningApp(target);
    if (running && write) {
      // Named only here: a refusal has to say how to get out of it, and the file is the way out when the app
      // that wrote it is gone. The warning below must not say it — there the app really is running.
      const clear = running.marker ? ` If it isn't running, delete ${running.marker} and try again.` : '';
      throw new Error(`apack is running on ${target.userDataDir} (${running.why}): quit it first, this command changes its database.${clear}`);
    }
    if (running) io.err(`Warning: apack is running on it (${running.why}); this reads what it has committed, as of each query`);
    const db = await openAppDatabase({
      env: target.env,
      userDataDir: target.userDataDir,
      readOnly: !write,
      ...(target.schemaFrom !== undefined && { schemaFrom: target.schemaFrom }),
    });
    // On stderr, before the command answers: a read against an incomplete schema answers a query that names
    // an entity type with the whole database rather than an error, so this is the one chance to say so
    if (db.schema.degraded !== undefined) io.err(`Warning: ${db.schema.degraded}`);
    for (const note of db.schema.notes) io.err(`Note: ${note}`);
    // What the schema could not tell the user, now that the data is here: which types are in it that nothing
    // declares. A read of one is fine — `consoleScope` names it — and a write goes through with no pack to check
    // it, which is the half `degraded` cannot cover, since its condition is that no pack was read at all
    const undeclared = undeclaredEntityTypes(db);
    if (undeclared.length > 0) {
      const listed = undeclared.map(({ type, rows }) => `${type} (${rows})`).join(', ');
      io.err(`Note: no installed pack declares these entity types, which the data holds anyway: ${listed}.`);
      io.err('  A query may name them here, and so may a write — but no installed pack checks what it writes, '
        + 'so name their pack with --schema-from before changing them.');
    }
    return lock ? { ...db, close: () => { try { db.close(); } finally { lock.release(); } } } : db;
  } catch (error) {
    lock?.release();
    throw error;
  }
}

/** The message of whatever a command threw */
const reason = (error: unknown) => (errorMessage(error));

/**
 * Runs `use` with the database and closes it after, whatever happens. Closing syncs what the command committed to
 * disk, so a failure there is reported — but never in place of what the command hit first.
 */
export async function withDatabase<T>(db: AppDatabase, use: () => Promise<T> | T): Promise<T> {
  let result: T;
  let failure: unknown;
  try {
    result = await use();
  } catch (error) {
    failure = error;
  }
  try {
    db.close();
  } catch (closeFailure) {
    if (failure === undefined) throw closeFailure;
    throw new Error(`${reason(failure)}\n  The database also failed to close: ${reason(closeFailure)}`, { cause: failure });
  }
  if (failure !== undefined) throw failure;
  return result!;
}

/**
 * The entity types the data holds that no installed pack declares, with how many rows each has, commonest first.
 *
 * Rows outlive the pack that declared their types — uninstalling deletes a pack's directory, not its rows — so a
 * data dir can hold types its schema knows nothing about, which `InstalledSchema.degraded` says it cannot detect
 * (its condition is "no pack was read", not "the rows are accounted for"). The types are only knowable from the
 * data, which is why this is asked of the open database rather than of the schema.
 */
export function undeclaredEntityTypes(db: AppDatabase): Array<{ type: string; rows: number }> {
  const declared = db.schema.getRegisteredEntityTypes();
  return Object.entries(db.ears.getSchemaStats().entities)
    .filter(([type]) => !declared.has(type))
    .map(([type, rows]) => ({ type, rows }))
    .sort((left, right) => right.rows - left.rows || left.type.localeCompare(right.type));
}

/**
 * `EARS` for console code: the SDK's names, the installed packs' — and the entity types the data turned out to
 * hold, so that a type whose pack is gone can still be named in a query.
 *
 * **Declared wins on a collision**, so a pack's name keeps the value it declared and an observed type only ever
 * adds a name that stood for nothing. That ordering is the whole of what keeps this a widening of the console
 * rather than of the schema: `db.schema` still means *declared*. The engine's entity-type check is wider —
 * `openAppDatabase` adds the types the data holds, so a write naming an observed type goes through, unchecked
 * by any pack.
 *
 * **`relKinds` and `roles` are deliberately not widened.** `EARS.RelKind.RELATES_TO` is `'relates_to'` and the data
 * holds only the value, so no amount of observation produces the alias; a dir with no snapshots has to be given one.
 */
export function consoleScope(db: AppDatabase): ConsoleScope {
  const observed = Object.fromEntries(Object.keys(db.ears.getSchemaStats().entities).map((type) => [type, type]));
  return {
    EARS: consoleEars({ entities: { ...observed, ...db.schema.entities }, relKinds: db.schema.relKinds, roles: db.schema.roles }, {
      hint: 'Name the pack that declares it with --schema-from, which takes a snapshot, a pack, or a directory of packs.',
    }),
  };
}
