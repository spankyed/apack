// Explicit developer tooling over a stopped source copy; never part of app startup or automatic migration.
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { APP_ENVS, appDataDirFor, resolveAppEnvironment } from '@apackdev/sdk/env';
import { _appDataPaths } from '@apackdev/sdk/utils';
import { appLockFile, findRunningApp, holdDatabaseWriteLock, openAppDatabase, openRunHistory, storedSettings } from '@apackdev/host/database';
import { assertNoImportRecovery } from '../packages/apack-host/src/backup/recovery.ts';
import { convertElmdbDump } from '../packages/apack-ears/scripts/convert-elmdb-dump.ts';

const within = (parent: string, child: string) => {
  const selected = relative(parent, child);
  return selected === '' || (selected !== '..' && !selected.startsWith('..' + sep) && !isAbsolute(selected));
};
function canonical(file: string): string {
  try { return realpathSync(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(file) === file) throw error;
    return join(canonical(dirname(file)), basename(file));
  }
}

function ordinaryTree(directory: string): void {
  for (const entry of readdirSync(directory)) {
    const file = join(directory, entry), stat = lstatSync(file);
    if (stat.isDirectory()) ordinaryTree(file);
    else if (!stat.isFile()) throw new Error(`Conversion requires a materialized source copy; refuses links or special files: ${file}`);
  }
}

export interface ConvertSqliteProfileOptions {
  source: string;
  /** New private container; the completed profile is its child named profile. Parent must already exist. */
  output: string;
  /** elmdb CLI built from the source version that can open the copied native stores. */
  producer: string;
}

export async function convertSqliteProfile(options: ConvertSqliteProfileOptions) {
  const source = realpathSync(options.source), parent = realpathSync(dirname(resolve(options.output)));
  const output = join(parent, basename(resolve(options.output)));
  if (within(source, output) || within(output, source)) throw new Error('Conversion source and output must be separate trees');
  for (const env of APP_ENVS) {
    // No implicit or default production-profile destination, including an alias of an existing parent.
    const defaultPath = canonical(resolve(appDataDirFor(env)));
    if (within(defaultPath, output)) throw new Error('Conversion requires an isolated output outside default app profiles');
  }
  if (existsSync(output)) throw Object.assign(new Error('Conversion output must not exist'), { code: 'EEXIST' });
  const context = resolveAppEnvironment({ env: 'test', userDataDir: source }), paths = _appDataPaths(source);
  const producer = realpathSync(options.producer);
  if (!lstatSync(context.appDir).isDirectory()) throw new Error('Source copy has no ordinary app directory');
  if (!existsSync(join(paths.lmdb, 'data.mdb')) || existsSync(join(paths.lmdb, 'data.sqlite3'))) throw new Error('Source primary store must be native elmdb');
  const selected = [{ name: 'primary', path: paths.lmdb }];
  if (existsSync(paths.runHistory)) {
    if (!existsSync(join(paths.runHistory, 'data.mdb')) || existsSync(join(paths.runHistory, 'data.sqlite3'))) throw new Error('Existing history must be native elmdb; refusing to discard it');
    selected.push({ name: 'runs', path: paths.runHistory });
  }
  assertNoImportRecovery(paths.lmdb);
  ordinaryTree(context.appDir);
  const lock = holdDatabaseWriteLock(source, 'explicit SQLite profile conversion');
  let reserved = false, completed = false;
  const failures: unknown[] = [];
  let result: { path: string; source: string; format: 'sqlite/1'; stores: Array<{name: string; loads: number; audit: {ok: boolean}}> } | undefined;
  try {
    const running = findRunningApp(context);
    if (running) throw new Error(`Stop the source app before conversion: ${running.why}`);
    mkdirSync(output, { mode: 0o700 }); reserved = true;
    const building = join(output, '.profile-incomplete'), profile = join(output, 'profile');
    mkdirSync(building, { mode: 0o700 });
    const builtContext = resolveAppEnvironment({ env: 'test', userDataDir: building }), builtPaths = _appDataPaths(building);
    const omit = new Set([paths.lmdb, paths.runHistory, appLockFile(source), context.apiPortFile, context.apiTokenFile,
      join(context.appDir, 'db-write.lock'), join(context.appDir, 'db-recovery.lock'), join(context.appDir, 'db-readers')]);
    // Chromium/browser state outside appDir is deliberately excluded. App-owned media, settings/secrets,
    // materialized packs and per-pack data stay byte copies; runtime endpoint/lock claims do not transfer.
    cpSync(context.appDir, builtContext.appDir, { recursive: true, force: false, errorOnExist: true,
      filter: file => !omit.has(resolve(file)) });
    const stores: NonNullable<typeof result>['stores'] = [];
    for (const store of selected) {
      const dump = join(output, `${store.name}.dump`);
      const produced = spawnSync(producer, ['dump', store.path, dump], { encoding: 'utf8', timeout: 300_000 });
      if (produced.error || produced.status !== 0) throw new Error(`Native ${store.name} dump failed: ${produced.stderr || produced.error || produced.signal}`, { cause: produced.error });
      const container = join(output, `${store.name}-conversion`), converted = await convertElmdbDump(dump, container);
      const destination = store.name === 'primary' ? builtPaths.lmdb : builtPaths.runHistory;
      renameSync(converted.path, destination);
      rmSync(container, { recursive: true }); rmSync(dump);
      stores.push({ name: store.name, loads: converted.loads, audit: { ok: converted.audit.ok } });
    }
    // Use normal host composition, including persisted schema, SDK binding, settings and history admission.
    const app = await openAppDatabase({ env: 'test', userDataDir: building, storageFormat: 'sqlite/1' });
    try { await app.database.indexesReady(); storedSettings(app.ears); } finally { app.close(); }
    if (selected.some(store => store.name === 'runs')) {
      const runs = openRunHistory(builtPaths.runHistory, { storageFormat: 'sqlite/1', replaceUnreadable: false });
      try { await runs.database.indexesReady(); } finally { runs.database.close(); }
    }
    renameSync(building, profile); completed = true;
    result = { path: profile, source, format: 'sqlite/1', stores };
  } catch (error) { failures.push(error); }
  // Never delete a successfully completed profile because releasing a source claim failed.
  try { lock.release(); } catch (error) { failures.push(error); }
  if (failures.length && reserved && !completed) try { rmSync(output, { recursive: true, force: true }); } catch (error) { failures.push(error); }
  if (failures.length) {
    if (completed) throw Object.assign(new AggregateError(failures, 'Profile completed but source-lock cleanup failed', { cause: failures[0] }), { completedPath: result!.path });
    if (failures.length === 1) throw failures[0];
    throw new AggregateError(failures, 'Profile conversion and cleanup failed', { cause: failures[0] });
  }
  return result!;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, output, producer, ...extra] = process.argv.slice(2);
  if (!source || !output || !producer || extra.length) throw new Error('Usage: node scripts/with-source.mjs node --import tsx scripts/convert-sqlite-profile.ts <source-copy> <new-output-container> <matching-elmdb-cli>');
  console.log(JSON.stringify(await convertSqliteProfile({ source, output, producer }), null, 2));
}
