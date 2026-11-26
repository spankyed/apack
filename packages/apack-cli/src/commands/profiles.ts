/**
 * What apack data exists on this machine, and the verbs for the part of it you own.
 *
 * Two kinds of directory, listed apart because the difference is the whole point. An **environment** is
 * where an app of that channel keeps its data whatever anyone does — `production`, `beta`, `development`,
 * `test`, one per `APP_ENVS` — and nothing here removes one. A **profile** is a data dir you can throw
 * away (`app/profiles.ts`), created on demand by `apack pack dev --profile x` or by `new` below. The word is
 * `profile` and not `instance` because an instance of an app is a running process, which is what Electron's
 * single-instance lock is about; a named, disposable data dir that leaves the app's identity alone is a
 * browser profile.
 *
 * **The environments are listed because that is where the bytes are**, and the two differ in a way worth
 * knowing before reaching for either verb. Measured 2026-10-10: `development` held 1.6GB of which `trim`
 * gave back **1.3GB**, nearly all of it `Cache` and `Code Cache`; `production` held 1.4GB and gave back
 * **13MB**, because its bulk is 666MB of `Partitions` — the in-app browser's logged-in sessions — beside
 * 712MB of the user's own media and database. So a dev dir is mostly disposable and a production one is
 * mostly not, which is why the verbs split on who owns a directory rather than on how big it is: `rm`
 * removes a profile, which is yours to throw away, and `trim` reclaims only what Chromium rebuilds, which
 * is the one thing that is safe to do to an environment nothing may remove.
 */
import * as fs from 'node:fs';
import { _appDirOf, APP_ENVS, appDataDirFor, type AppEnv } from '@apackdev/sdk/env';
import { readHostCompatibility } from '@apackdev/host/packs';
import { readSession } from '@apackdev/host/dev-session';
import { findRunningApp } from '@apackdev/host/database';
import { errorMessage } from '@apackdev/sdk/utils/pure';
import { cliDirs, type CliDirs } from '../app/pack-host';
import {
  REGENERABLE_DIRS, chromiumLockHeld, dirBytes, dataDirInUse, profileNameProblem, listProfiles, mintProfile, openProfile,
  chromiumHolding, endAppHolding, removeProfile, renameProfile, size, trimDataDir, type ListedProfile,
} from '../app/profiles';

const HELP = `
Usage: apack profiles [--sizes] [--all] [--json]
       apack profiles new [name]
       apack profiles rename <from> <to>
       apack profiles rm <name>... | --leaked
       apack profiles trim [<name>...]
       apack profiles stop <name> | --all

List every apack data dir on this machine: the environments an app of each channel uses, and the
profiles you created. Works outside a pack — a data dir belongs to you rather than to any pack.

trim           Delete the caches Chromium rebuilds, from the dirs you name or from all of them:
               ${REGENERABLE_DIRS.join(', ')}.
               Your data, settings, installed packs and the in-app browser's logins are left alone.
               A dir with an app running on it is skipped — close it, or \`apack profiles stop\` it.
stop           Close the app running on a data dir and wait for the dir to come free.

Options:
  --json         Print one structured listing (listing only)
  --sizes        Add a size column, which walks every directory
  --all          Include the throwaway profiles \`--fresh --rm\` made, and say which a dead run left behind
  --leaked       With rm, remove exactly those
  --help, -h     Show this help
`.trim();

/** One environment's data dir, as a row. `resolve` is a parameter so a spec can answer for a temp tree. */
export interface EnvironmentRow {
  env: AppEnv;
  dir: string;
  exists: boolean;
  /**
   * Whether the app's own directory is in there (`_appDirOf`), which is what tells a data dir from a
   * directory Electron left behind: measured on this machine, `development` holds 1.5GB of Chromium profile
   * and no app dir at all, and reporting that as a data dir with an unknown version says the wrong thing.
   */
  hasAppData: boolean;
  /** What the app that last used it recorded of itself (`host.json`), where it wrote one */
  version?: string;
  inUse: boolean;
  /** What an attachable app published here: who started it, and the pid that ends it */
  session?: { startedBy: 'dev' | 'drive'; supervisorPid: number };
}

export function environmentRows(resolve: (env: AppEnv) => string = appDataDirFor): EnvironmentRow[] {
  return APP_ENVS.map((env) => {
    const dir = resolve(env);
    const exists = fs.existsSync(dir);
    const hasAppData = exists && fs.existsSync(_appDirOf(dir));
    return {
      env,
      dir,
      exists,
      hasAppData,
      // Absent is a row rather than an omission: that nothing has ever run this channel here is the useful
      // half of the answer, and a missing line reads as a bug in the listing
      ...(hasAppData ? { version: readHostCompatibility(dir).version } : {}),
      inUse: exists && dataDirInUse(dir),
      // The session an attachable app published, so a row says who started the app holding this dir and
      // what ends it. The development dir is where a `drive --spawn` lands by default, which makes this
      // the row a forgotten app is found on
      ...(exists ? { session: readSession(dir) } : {}),
    };
  });
}

/**
 * What a row says beside its name, and the first clause is the one that matters.
 *
 * **A line printed once is not documentation.** A question that started an app says so, but forty minutes
 * later that has scrolled away — and on the caller this is for, an agent's stdout, it was read by nothing.
 * So the listing is where a forgotten app is found: who started it, how long it has been up, and the pid
 * that ends it. `npm run dev:open --` is the `docker ps` to a spawn's `docker run`.
 */
const note = (profile: ListedProfile): string => {
  const session = readSession(profile.dir);
  if (session) {
    const by = session.startedBy === 'drive' ? 'a question' : 'a development session';
    return `running, started by ${by} — pid ${session.supervisorPid}`;
  }
  // An app with no session file is one that published no debug port, so nothing can attach to it — still
  // running, and still worth saying, because it is what makes the dir unavailable
  return profile.inUse
    ? 'an app is running on it'
    : profile.leaked
      ? 'left by a run that has gone'
      : profile.ephemeral ? 'ephemeral' : '';
};

/**
 * What a listing asks of the machine. Both are parameters so a spec can answer for a temp tree and watch
 * whether `--sizes` is really what decides the walk — the listing's one performance claim, and the reason
 * sizes are opt-in at all.
 */
export interface ListOptions {
  sizes: boolean;
  json?: boolean;
  /** Include the throwaway profiles the listing hides by default */
  all: boolean;
  resolve?: (env: AppEnv) => string;
  bytes?: (dir: string) => number;
}

export function list(dirs: CliDirs, { sizes, all, json = false, resolve, bytes = dirBytes }: ListOptions): void {
  /** Taken only where asked for, since taking it is the slow half */
  const sized = (dir: string): string => size(bytes(dir));
  const envs = environmentRows(resolve);
  const profiles = listProfiles(dirs).filter(profile => all || !profile.ephemeral);
  if (json) {
    console.log(JSON.stringify({
      environments: envs.map(row => ({ ...row, ...(sizes && { bytes: row.exists ? bytes(row.dir) : 0 }) })),
      profiles: profiles.map(profile => ({ ...profile, session: readSession(profile.dir) ?? null, ...(sizes && { bytes: bytes(profile.dir) }) })),
    }));
    return;
  }
  const width = Math.max(...envs.map((row) => row.env.length), 'ENVIRONMENT'.length);

  console.log(`\n  ${'ENVIRONMENT'.padEnd(width)}${sizes ? '    SIZE' : ''}  APP         DATA DIR`);
  for (const row of envs) {
    const running = row.session === undefined
      ? '  (running)'
      : `  (running, started by ${row.session.startedBy === 'drive' ? 'a question' : 'a development session'} — pid ${row.session.supervisorPid})`;
    const state = !row.exists ? '  (none yet)' : !row.hasAppData ? '  (no app data)' : row.inUse ? running : '';
    console.log(`  ${row.env.padEnd(width)}${sizes ? `  ${(row.exists ? sized(row.dir) : '—').padStart(6)}` : ''}`
      + `  ${(row.version ?? '—').padEnd(10)}  ${row.dir}${state}`);
  }

  if (profiles.length === 0) {
    console.log(`\n  no profiles${all ? '' : ' (--all includes the throwaway ones)'}\n`);
    return;
  }
  const names = Math.max(...profiles.map((profile) => profile.name.length), 'PROFILE'.length);
  console.log(`\n  ${'PROFILE'.padEnd(names)}${sizes ? '    SIZE' : ''}  CREATED`);
  for (const profile of profiles) {
    console.log(`  ${profile.name.padEnd(names)}${sizes ? `  ${sized(profile.dir).padStart(6)}` : ''}`
      + `  ${(profile.created ?? '—').slice(0, 10).padEnd(10)} ${note(profile)}`.trimEnd());
  }
  console.log();
}

/**
 * A new profile. A name that is already taken is refused rather than opened: `openProfile` exists for
 * `run --profile x`, where reusing the dir you named last time is the whole point, and here it would hand
 * you someone else's data under the impression you had made something.
 */
export function create(dirs: CliDirs, name: string | undefined): void {
  if (name === undefined) {
    const minted = mintProfile(dirs, false);
    console.log(`  created ${minted.name}\n  ${minted.dir}\n\n  apack pack dev --profile ${minted.name}`);
    return;
  }
  const problem = profileNameProblem(name);
  if (problem) throw new Error(problem);
  const opened = openProfile(dirs, name);
  if (!opened.created) throw new Error(`A profile named "${name}" already exists (${opened.dir}).`);
  console.log(`  created ${opened.name}\n  ${opened.dir}\n\n  apack pack dev --profile ${opened.name}`);
}

export function remove(dirs: CliDirs, names: string[], leaked: boolean): void {
  const profiles = listProfiles(dirs);
  const doomed = leaked
    ? profiles.filter((profile) => profile.leaked)
    : names.map((name) => {
      const found = profiles.find((profile) => profile.name === name);
      if (!found) throw new Error(`No profile named "${name}". Run apack profiles to see what there is.`);
      return found;
    });

  if (doomed.length === 0) {
    console.log(leaked ? '  no profiles were left behind' : '  nothing to remove');
    return;
  }

  let reclaimed = 0;
  for (const profile of doomed) {
    const bytes = dirBytes(profile.dir);
    // Per profile, because the state was read a moment ago: an app started since makes `removeProfile`
    // refuse, and one refusal should not stop the rest from being considered
    try {
      removeProfile(dirs, profile.dir);
      reclaimed += bytes;
      console.log(`  removed  ${profile.name.padEnd(24)} ${size(bytes).padStart(6)}`);
    } catch (error) {
      console.log(`  kept     ${profile.name.padEnd(24)}        ${errorMessage(error)}`);
    }
  }
  if (reclaimed > 0) console.log(`\n  reclaimed ${size(reclaimed)}`);
}

/**
 * The data directories for built-in and custom profile names, or all known profiles.
 *
 * **One lookup for both kinds, which only works because the two cannot collide.** A profile may not be
 * named after a built-in profile (`profileNameProblem`), so a name is unambiguously one or the other and nobody has to
 * say which with a flag. A name that is neither lists what there is rather than resolving to a path the
 * caller never typed.
 */
function dataDirsNamed(
  dirs: CliDirs, names: string[], resolve: (env: AppEnv) => string,
): { label: string; dir: string }[] {
  const profiles = listProfiles(dirs);
  if (names.length === 0) {
    return [
      ...APP_ENVS.map((env) => ({ label: env, dir: resolve(env) })),
      ...profiles.map((profile) => ({ label: profile.name, dir: profile.dir })),
    ];
  }
  return names.map((name) => {
    if ((APP_ENVS as readonly string[]).includes(name)) return { label: name, dir: resolve(name as AppEnv) };
    const found = profiles.find((profile) => profile.name === name);
    if (found) return { label: found.name, dir: found.dir };
    const known = [...APP_ENVS, ...profiles.map((profile) => profile.name)].join(', ');
    throw new Error(`"${name}" is not a built-in or custom profile. There is: ${known}.`);
  });
}

/**
 * Reclaims the caches Chromium rebuilds, and says what each dir gave back.
 *
 * A dir it skipped says why on its own line rather than being left out, because "nothing happened" and
 * "there was nothing there" are different answers and the one that matters — an app is running — is the
 * one a silent listing would hide.
 */
export function trim(
  dirs: CliDirs, names: string[],
  { resolve = appDataDirFor, bytes = dirBytes }: { resolve?: (env: AppEnv) => string; bytes?: (dir: string) => number } = {},
): void {
  const targets = dataDirsNamed(dirs, names, resolve);
  const width = Math.max(...targets.map((target) => target.label.length), 7);
  let freed = 0;
  console.log('');
  for (const { label, dir } of targets) {
    const result = trimDataDir(dir, bytes);
    freed += result.freed;
    const outcome = result.refused ?? (result.freed === 0 ? 'nothing to trim' : `freed ${size(result.freed)}`);
    console.log(`  ${label.padEnd(width)}  ${outcome.padEnd(26)}  ${dir}`);
  }
  console.log(`\n  reclaimed ${size(freed)}${freed === 0 ? '' : ' — the app rebuilds what it needs'}\n`);
}

/**
 * Closes the app running on a data dir, and waits for the dir to come free.
 *
 * **The pid comes from a record, never from a search**, which is the rule that makes this safe to ship: a
 * session file's `supervisorPid` first, because that is the process whose teardown closes the app *and*
 * cleans up after it — ending the Electron instead would free the data dir and leave a watcher and a dev
 * server running with nothing to serve. Failing that, the app lock's pid, which is what a packaged app the
 * user launched themselves publishes. Nothing here matches on a process name.
 *
 * **It exists because the listing already names the pid.** A command that tells you which process to signal
 * and then leaves you to `kill` it has stopped one step short — and the step it leaves out is the one where
 * a mistyped pid reaches something else entirely.
 */
export async function stop(
  dirs: CliDirs, names: string[], all: boolean,
  { resolve = appDataDirFor }: { resolve?: (env: AppEnv) => string } = {},
): Promise<void> {
  const targets = all ? dataDirsNamed(dirs, [], resolve) : dataDirsNamed(dirs, names, resolve);
  const held = targets
    .map(({ label, dir }) => ({ label, dir, pid: pidHolding(dir) }))
    .filter((target): target is { label: string; dir: string; pid: number } => target.pid !== undefined);

  // A dir whose Chromium lock was written by another machine is held and has no pid here to signal, so
  // "no app is running" would be a lie: it is the one case where there is something to close and this is
  // not the machine that can. **Reported whether or not anything else was closed**, because a run that
  // signalled one dir and could not reach another has given a partial answer, and a partial answer that
  // names only the half it managed reads as a whole one. Dirs already in `held` are left out of it: a
  // foreign Chromium lock does not stop a session or app lock here naming a pid, and one dir reported
  // twice says two things are holding it.
  const signalled = new Set(held.map(({ dir }) => dir));
  const elsewhere = targets.filter(({ dir }) => !signalled.has(dir) && chromiumLockHeld(dir));

  if (held.length === 0 && elsewhere.length === 0) {
    // Named rather than silent, because "it was already closed" and "I misspelled it" read the same from
    // an empty answer, and only one of them is fine
    console.log(`\n  no app is running on ${all ? 'any data dir' : targets.map((target) => target.label).join(', ')}\n`);
    return;
  }
  console.log('');
  for (const { label, dir, pid } of held) {
    console.log(`  closing the app on ${label} (pid ${pid})...`);
    await endAppHolding(dir, pid);
    console.log(`    it has gone — ${dir}`);
  }
  if (elsewhere.length > 0) {
    console.log(`  held by an app on another machine — nothing here to signal:`);
    for (const { label, dir } of elsewhere) console.log(`    ${label}  ${dir}`);
  }
  console.log('');
}

/**
 * The one process to signal to end whatever holds a data dir, or nothing.
 *
 * A session is preferred over the app lock for the reason `@apackdev/host/dev-session` records: its pid is
 * the *holder*, which closes the app as part of going, where the lock's is the app alone.
 */
export function pidHolding(dir: string): number | undefined {
  const session = readSession(dir);
  if (session !== undefined) return session.supervisorPid;
  // Last, the browser's own lock: an app whose session, app lock and runtime file have all gone is still one
  return findRunningApp({ userDataDir: dir })?.pid ?? chromiumHolding(dir);
}

export async function profiles(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    return;
  }
  const [subcommand, ...rest] = args.filter((arg) => !arg.startsWith('--'));
  const flags = args.filter((arg) => arg.startsWith('--'));
  // Rejected rather than ignored, for `clean`'s reason: this command removes directories, and a mistyped
  // flag that fell through used to take the pack's build output with it
  const known = ['--sizes', '--all', '--leaked', '--json'];
  const unknown = flags.filter((flag) => !known.includes(flag));
  if (unknown.length > 0) throw new Error(`Unknown option${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')}. See apack profiles --help.`);

  if (flags.filter(flag => flag === '--json').length > 1) throw new Error('Specify --json once.');
  if (flags.includes('--json') && subcommand !== undefined) throw new Error('--json is supported only for profile listings.');
  const dirs = cliDirs();
  switch (subcommand) {
    case undefined:
      list(dirs, { sizes: flags.includes('--sizes'), all: flags.includes('--all'), json: flags.includes('--json') });
      return;
    case 'new':
      if (rest.length > 1) throw new Error('apack profiles new takes one name, or none to mint one.');
      create(dirs, rest[0]);
      return;
    case 'rename': {
      if (rest.length !== 2) throw new Error('apack profiles rename takes the name it has and the name it should have.');
      const { dir } = renameProfile(dirs, rest[0]!, rest[1]!);
      console.log(`  renamed ${rest[0]} to ${rest[1]}\n  ${dir}`);
      return;
    }
    case 'rm': {
      const leaked = flags.includes('--leaked');
      // Neither and both are different mistakes, and one message for the two told whoever passed nothing
      // that they had passed too much
      if (!leaked && rest.length === 0) {
        throw new Error('apack profiles rm takes a name, or --leaked for the ones a killed run left.');
      }
      if (leaked && rest.length > 0) {
        throw new Error(`apack profiles rm takes names or --leaked, not both. Drop --leaked to remove ${rest.join(', ')}.`);
      }
      remove(dirs, rest, leaked);
      return;
    }
    case 'trim':
      trim(dirs, rest);
      return;
    case 'stop': {
      const all = flags.includes('--all');
      if (!all && rest.length === 0) {
        throw new Error('apack profiles stop takes a profile name, or --all for every app running.');
      }
      await stop(dirs, rest, all);
      return;
    }
    default:
      throw new Error(`Unknown subcommand "${subcommand}". See apack profiles --help.`);
  }
}
