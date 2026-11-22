/** Repository and pack automation: scripts launch isolated apps; live questions attach or explicitly spawn. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { findPackRoot, readManifest } from '../utils';
import { cliDirs, parseHostFlags, resolvePackHost, resolveRepositoryHost, type CliDirs } from '../app/pack-host';
import {
  freshProfileName, resolveProfileDir, profileFor, dataDirInUse, parseProfileFlags, removeProfile, PROFILE_USAGE,
  type ProfileMode,
} from '../app/profiles';
import { askAttached, attachableApp, spawnOrAttach, type AttachableApp } from '../app/drive-attach.ts';
import type { DevSession } from '@apackdev/host/dev-session';
import { appDataDirFor, resolveAppEnvironment } from '@apackdev/sdk/env';
import { errorMessage } from '@apackdev/sdk/utils/pure';
import { resolveName, splitRef, type FeatureRef } from '@apackdev/sdk/ids';
import { fixtureEnv } from './test';
import { hostEnvironment } from './dev';
import { copySecretsInto } from '../app/profile-secrets.ts';
import { resolvePlaywrightCli } from '../app/playwright';
import { renderTemplate } from '../templates.ts';
import { configCallsHelper } from '../build/config-text.ts';
import { ensureCheckoutPackages } from '../build/checkout-packages.ts';

const DRIVE_DIR = 'drive';
const QUERY_TARGET_REQUIRED = '--query needs --database-system <pack/feature> to select its database system.';

type DriveScope = 'app' | 'pack';

function driveCommands(scope: DriveScope) {
  return scope === 'app'
    ? { drive: 'npm run dev:drive --', open: 'npm run dev:open --' }
    : { drive: 'apack pack drive', open: 'apack pack dev' };
}

function driveHelp(scope: DriveScope): string {
  const command = driveCommands(scope);
  const context = scope === 'app'
    ? 'App contributor tool: run from the root of the apack source monorepo.\nPack authors: run apack pack drive from your pack repository.'
    : 'Run from your pack repository to automate this pack in an app.';
  return `
${context}

Usage: ${command.drive} [script | --eval <body> | --query <code> | --state]${scope === 'pack' ? ' [--host <path|beta>]' : ''} [profile flags]

Scripts in drive/ launch a built app with visible windows. With no script, run every script.
These scripts are for interactive development; they are not collected by pack tests.
The default data directory is disposable. A custom --profile keeps state between runs.
Scripts refuse built-in profiles. Pack frontend HMR is available through apack pack dev.

Live questions (--eval, --query, --state) attach to the app ${command.open} is holding.
They print one JSON object to stdout: value, state, startedBy, supervisorPid.
Exit codes: 0 with a value, 3 when no app is running, 1 when the verb failed.
With no app running, --spawn explicitly starts a source development app and leaves it running.
Fresh state, --rm, and --with-secrets require a new --spawn session.
Live questions can use the shared development profile or a custom profile.
A spawned custom-profile app closes after 10 minutes without a question.
Use apack profiles to inspect or stop it.

--eval takes a function body; return is required: --eval 'return document.title'.

Options:
  --eval <body>       Evaluate a function body in the page
  --query <code>      Run one EARS read over the bus
  --database-system <pack/feature>  Address --query to a database feature${scope === 'pack' ? ' (required for --query)' : ''}
  --state             Read the app shell's state
  --spawn             Start a source app if none is running
${scope === 'pack' ? '  --host <path|beta>  Select a host for scripts or live --spawn\n' : ''}${PROFILE_USAGE}
  --help, -h          Show this help
`.trim();
}

/** Repository help, also checked against the command's behavior. */
export const DRIVE_USAGE = driveHelp('app');

const CONFIG = (): string => renderTemplate('drive/playwright.config.ts');

function driveReadme(scope: DriveScope): string {
  const command = driveCommands(scope);
  return `# drive/

Scripts that drive the app. **Not tests.** Nothing here is collected by \`apack pack test\` or gates anything.

**Mainly for an agent.** This is how a coding agent debugs and develops against your pack: open what it
just built, click through it, read the state back, screenshot it, and see whether the change worked. You
can use it the same way — the app's windows are shown so you can watch.

\`\`\`ts
// drive/notes.ts
import { drive } from '@apackdev/testing';

drive('open notes and look at it', async ({ app, appPage }) => {
  await app.navigate('notes');
  await app.screenshot('notes');
  // appPage is a Playwright Page: click, type, evaluate — whatever you need
});
\`\`\`

Run everything with \`${command.drive}\`, or one script with \`${command.drive} drive/notes.ts\`.

For one question, no script is needed — \`${command.drive} --eval 'return document.title'\` asks the app
\`${command.open}\` is holding and prints one JSON object (\`value\`, \`state\`, \`startedBy\`,
\`supervisorPid\`). It is a function *body*, so \`return\` is required. \`--query\` and \`--state\` ask the
same way. With no app running it exits 3 and says so; \`--spawn\` starts one and keeps it.

A script drives a built app of its own — \`apack pack dev\` serves a pack's frontend with HMR.

\`app.report(name, value)\` is for an answer you want to read rather than watch: it writes
\`.apack/drive/results/<name>.json\` and prints one \`[drive:report] <name> <json>\` line.

Add \`--profile <name>\` to keep the app's data between sessions, or \`--fresh --rm\` to start clean and
leave nothing behind. With neither, the app gets a fresh data dir that is thrown away afterwards, so a
script cannot reach your real data. Everything but this file and \`playwright.config.ts\` is gitignored.
`;
}

const GITIGNORE = `*
!.gitignore
!README.md
!playwright.config.ts
`;

export const ASK_NAMES = ['eval', 'query', 'state'] as const;
export type AskName = (typeof ASK_NAMES)[number];
const ASKS_TAKING_A_VALUE = new Set<AskName>(['eval', 'query']);

/** Consume live-question flags before forwarding script arguments to Playwright. */
export function takeOneShotFlags(argv: string[]): { ask?: AskName; argument?: string; databaseSystem?: FeatureRef; spawn: boolean; rest: string[] } {
  const rest: string[] = [];
  let ask: AskName | undefined;
  let argument: string | undefined;
  let spawn = false;
  let databaseSystem: FeatureRef | undefined;

  for (let i = 0; i < argv.length; i++) {
    const [name, inline] = argv[i]!.split(/=(.*)/s, 2) as [string, string | undefined];
    if (name === '--spawn') {
      if (inline !== undefined) throw new Error('--spawn does not take a value.');
      spawn = true;
      continue;
    }
    if (name === '--database-system') {
      if (databaseSystem !== undefined) throw new Error('--database-system was given twice.');
      const value = inline ?? argv[++i];
      if (value === undefined || !splitRef(value)) throw new Error('--database-system needs a pack/feature address.');
      databaseSystem = resolveName(value);
      continue;
    }
    const asked = ASK_NAMES.find((verb) => name === `--${verb}`);
    if (asked === undefined) { rest.push(argv[i]!); continue; }
    if (ask !== undefined) {
      throw new Error(ask === asked
        ? `--${asked} was given twice; a one-shot asks one question.`
        : `--${asked} can't be combined with --${ask}; a one-shot asks one question.`);
    }
    ask = asked;
    if (!ASKS_TAKING_A_VALUE.has(asked)) {
      if (inline !== undefined) throw new Error(`--${asked} does not take a value.`);
      continue;
    }
    argument = inline ?? argv[++i];
    if (argument === undefined) {
      throw new Error(`--${asked} needs a value. For --eval it is a function *body*, not an expression, so`
        + ' `return` is required: --eval "return document.title"');
    }
  }
  if (databaseSystem !== undefined && ask !== 'query') throw new Error('--database-system is only for --query.');
  return { ...(databaseSystem === undefined ? {} : { databaseSystem }), ...(ask === undefined ? {} : { ask }), ...(argument === undefined ? {} : { argument }), spawn, rest };
}

/**
 * What a scaffolder left alone, so the caller can say so.
 *
 * Write-if-absent is right for both of these files — one holds a pack's own verbs, the other is a call to
 * a helper that owns every setting — but it means a file written before the helper existed is never
 * updated and nothing notices. Reporting is the half that makes the delegation reachable: a config still
 * assembling its own settings is named once, with the two lines that replace it.
 */
export interface DriveScaffold {
  /** Files written, as paths relative to the pack */
  created: string[];
  /** Configs kept that do not call their helper, so their settings no longer follow @apackdev/testing */
  keptStale: string[];
}

/** The helper a scaffolded drive config delegates to. One kind of run is left, and so one entry */
const CONFIG_HELPERS: Record<string, readonly string[]> = {
  'playwright.config.ts': ['defineDriveConfig'],
};

/** Whether a config that is already there still delegates, which is what decides if it has gone stale */
function keptStale(dir: string, name: string): boolean {
  const helpers = CONFIG_HELPERS[name];
  if (helpers === undefined) return false;
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) return false;
  return !configCallsHelper(fs.readFileSync(file, 'utf-8'), helpers);
}

/** The driving scripts in a pack, which is what decides whether there is anything to run. */
export function driveScripts(root: string): string[] {
  try {
    // Recursive, because the config this scaffolds is `testDir: '.'` with `testMatch: '**/*.ts'` — a
    // shallow read would refuse a pack whose only script sits in a subdirectory, for a file Playwright
    // would have collected and run
    return fs.readdirSync(path.join(root, DRIVE_DIR), { recursive: true, encoding: 'utf-8' })
      .filter(name => name.endsWith('.ts') && name !== 'playwright.config.ts');
  } catch {
    return [];
  }
}

/**
 * Writes the layer the first time, so driving needs no setup step of its own.
 *
 * It keeps a config that is already there, which is why it reports one that has stopped delegating: a pack
 * scaffolded before `defineDriveConfig` existed would otherwise never hear that its settings had stopped
 * following the package.
 */
export function scaffold(root: string, scope: 'app' | 'pack' = 'app'): DriveScaffold {
  const dir = path.join(root, DRIVE_DIR);
  const report: DriveScaffold = { created: [], keptStale: [] };
  if (fs.existsSync(path.join(dir, 'playwright.config.ts'))) {
    if (keptStale(dir, 'playwright.config.ts')) report.keptStale.push(path.join(DRIVE_DIR, 'playwright.config.ts'));
    return report;
  }
  fs.mkdirSync(dir, { recursive: true });
  const readme = driveReadme(scope);
  for (const [name, body] of [['playwright.config.ts', CONFIG()], ['README.md', readme], ['.gitignore', GITIGNORE]] as const) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) continue;
    fs.writeFileSync(file, body);
    report.created.push(path.join(DRIVE_DIR, name));
  }
  return report;
}

/** One line per config that has stopped delegating, naming the two lines that put it back */
function reportStaleConfigs(stale: string[]): void {
  for (const file of stale) {
    const helper = CONFIG_HELPERS[path.basename(file)]![0]!;
    console.error(`${file} does not call ${helper}(), so its settings no longer follow @apackdev/testing. Replace its body with:`);
    console.error(`  import { ${helper} } from '@apackdev/testing/playwright';`);
    console.error(`  export default ${helper}();\n`);
  }
}

/** What a driving run is about: a pack, or the app itself */
interface DriveTarget {
  /** Where `drive/` lives, and the Playwright run's working directory */
  readonly root: string;
  /** The pack under test. Absent when the app itself is the subject, which unsets `PACK_DIR` */
  readonly packDir?: string;
  readonly hostVersion: string;
}

/** Command scope selects the subject; a root app drive never installs a nearby pack. */
export function driveTarget(cwd: string, scope: 'app' | 'pack'): DriveTarget {
  const pack = scope === 'pack' ? findPackRoot(cwd) : undefined;
  if (pack !== undefined) return { root: pack, packDir: pack, hostVersion: readManifest(pack).hostVersion ?? '*' };
  if (!fs.existsSync(path.join(cwd, 'packages', 'entry-point.mjs'))) {
    throw new Error('App driving scripts require the apack checkout root. Use its repository npm scripts.');
  }
  return { root: cwd, hostVersion: '*' };
}

/** Resolve storage and child arguments together. Fresh names are chosen without creating a directory. */
interface AskTarget {
  /** The data dir the question is asked of, created by nothing here */
  readonly dir: string;
  /** What to hand the `dev` this spawns, so it opens exactly `dir` */
  readonly spawnArgs: readonly string[];
  /** What a person should know about a dir this question named, on stderr */
  readonly note?: string;
}

export function askTarget(mode: ProfileMode, withSecrets: boolean, dirs: CliDirs = cliDirs(), scope: DriveScope = 'app'): AskTarget {
  const secrets = withSecrets ? ['--with-secrets'] : [];
  if (mode.kind === 'shared') {
    return { dir: resolveAppEnvironment({ env: 'development' }).userDataDir, spawnArgs: [...secrets] };
  }
  if (mode.kind === 'named' && mode.name === 'development' && !mode.rm && !withSecrets) {
    return { dir: appDataDirFor('development'), spawnArgs: ['--profile', 'development'] };
  }
  const name = mode.kind === 'named' ? mode.name : freshProfileName();
  const rm = mode.rm ? ['--rm'] : [];
  return {
    dir: resolveAppEnvironment({ env: 'development', userDataDir: resolveProfileDir(dirs, name) }).userDataDir,
    spawnArgs: ['--profile', name, ...rm, ...secrets],
    ...(mode.kind === 'fresh' ? {
      note: `Fresh profile ${name}${mode.rm ? ' — removed when the app closes' : ''}.`
        + ` \`${driveCommands(scope).drive} --profile ${name}\` asks the next question of it.`,
    } : {}),
  };
}

/** A live question prints JSON only on success; a missing app exits 3 without an answer. */
export const MISS_EXIT_CODE = 3;

interface OneShotOutput {
  /** The object for stdout, or nothing when the run failed */
  readonly line?: string;
  /** What a person watching should know, on stderr */
  readonly notes: readonly string[];
  readonly code: number;
}

/** What a one-shot asks of a session, by the flag that was passed. */
async function answerAttached(
  live: AttachableApp, root: string, ask: AskName, argument: string | undefined, state: 'attached' | 'spawned', databaseSystem: FeatureRef | undefined,
): Promise<OneShotOutput> {
  const screenshotDir = path.join(root, '.apack', DRIVE_DIR, 'screenshots');
  const notes: string[] = [];
  // Prose only where something was left behind — a process still running, or a write to the user's data.
  // An attach that changed nothing says nothing, because the fields already said it
  if (state === 'spawned') {
    notes.push(`Started the development app (pid ${live.session.supervisorPid}) and left it running. Use \`apack profiles\` to inspect or stop it.`);
  }
  try {
    const answer = await askAttached(live, root, screenshotDir, async (session) => {
      if (ask === 'state') return session.state();
      if (argument === undefined) throw new Error(`--${ask} needs something to run`);
      if (ask === 'eval') return session.evaluate(argument);
      if (databaseSystem === undefined) throw new Error(QUERY_TARGET_REQUIRED);
      return session.query(argument, databaseSystem);
    });
    const result = answer.value as { ok?: boolean; value?: unknown; error?: string };
    if (result?.ok === false) {
      return { notes: [...notes, `--${ask} failed: ${result.error ?? 'no reason given'}`], code: 1 };
    }
    return {
      line: answerLine({ value: result?.value, state, startedBy: answer.startedBy, supervisorPid: answer.supervisorPid }),
      notes,
      code: 0,
    };
  } catch (error) {
    return { notes: [...notes, errorMessage(error)], code: 1 };
  }
}

/**
 * The one JSON object a question puts on stdout, built in one place so the documented contract has one
 * declaration.
 *
 * **`?? null`, because `JSON.stringify` drops an `undefined` value entirely.** `--eval 'void 0'` answered
 * `{"state":…,"startedBy":…,"supervisorPid":…}` with no `value` at all, which a caller reading `.value`
 * cannot tell from a verb that never ran — and the exit code, which is what says that, was 0 either way.
 * A verb that answers nothing answers `null`.
 */
export function answerLine(answer: {
  value: unknown;
  state: 'attached' | 'spawned';
  startedBy: DevSession['startedBy'];
  supervisorPid: number;
}): string {
  return JSON.stringify({
    value: answer.value ?? null,
    state: answer.state,
    startedBy: answer.startedBy,
    supervisorPid: answer.supervisorPid,
  });
}

/** Says there is no app, and what the two ways forward are. Exit 3, and nothing on stdout. */
function noAppHere(dataDir: string): OneShotOutput {
  return {
    notes: [
      `No app is running on ${dataDir}.`,
      '  Start one with `apack pack dev` or `npm run dev:open`, or add --spawn to have this start one and keep it.',
    ],
    code: MISS_EXIT_CODE,
  };
}

/** Writes an answer: the object to stdout, the prose to stderr, the status as the exit code. */
function report(output: OneShotOutput): void {
  for (const note of output.notes) console.error(note);
  if (output.line !== undefined) console.log(output.line);
  process.exitCode = output.code;
}

export async function packDrive(args: string[]) {
  return drive(args, 'pack');
}

export async function drive(args: string[], scope: 'app' | 'pack' = 'app', defaultDatabaseSystem?: FeatureRef) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(driveHelp(scope));
    return;
  }

  const cwd = process.cwd();
  const { ask, argument, databaseSystem = defaultDatabaseSystem, spawn: spawnFlag, rest } = takeOneShotFlags(args);
  const { mode, withSecrets, rest: scriptArgs } = parseProfileFlags(rest);
  const flags = parseHostFlags(scriptArgs);

  if (spawnFlag && ask === undefined) throw new Error('--spawn is only for live questions.');
  if (ask !== undefined) {
    if (flags.args.length) throw new Error(`Unexpected live-question arguments: ${flags.args.join(' ')}. See --help.`);
    if (flags.release || flags.prebuilt) throw new Error('Pack build flags belong to script runs, not live questions.');
    if (ask === 'query' && databaseSystem === undefined) throw new Error(QUERY_TARGET_REQUIRED);
    const root = scope === 'pack' ? findPackRoot(cwd) : cwd;
    if (scope === 'app' && flags.host) throw new Error('Repository automation uses its own checkout; host selection belongs to pack commands.');
    if (!spawnFlag && flags.host) throw new Error('--host requires --spawn for a live question.');
    if (!spawnFlag && mode.kind === 'fresh') throw new Error('A fresh live question requires --spawn.');
    const needsNewSession = withSecrets || (mode.kind !== 'shared' && mode.rm);
    if (!spawnFlag && needsNewSession) throw new Error('--rm and --with-secrets require --spawn for a live question.');
    const target = askTarget(mode, withSecrets, cliDirs(), scope);
    const selected = spawnFlag
      ? scope === 'app' ? resolveRepositoryHost(root)
        : await resolvePackHost({ policy: 'development', flags, hostVersion: readManifest(root).hostVersion ?? '*', from: root })
      : undefined;
    if (selected?.kind === 'packaged') throw new Error('Live questions require a source development host; packaged apps are not attachable.');
    const expectedRoot = scope === 'app' ? root : selected?.kind === 'source' ? selected.root : undefined;
    const live = attachableApp(target.dir, expectedRoot);
    if (live) {
      if (needsNewSession) throw new Error('--rm and --with-secrets require a new session; this app is already running. Attach without those flags.');
      return report(await answerAttached(live, root, ask, argument, 'attached', databaseSystem));
    }
    if (spawnFlag) {
      if (target.note !== undefined) console.error(target.note);
      const spawnArgs = scope === 'pack' && selected?.kind === 'source'
        ? [...target.spawnArgs, '--host', selected.root] : target.spawnArgs;
      const { app, state } = await spawnOrAttach(root, target.dir, spawnArgs, { scope, expectedRoot, reuse: !needsNewSession });
      return report(await answerAttached(app, root, ask, argument, state, databaseSystem));
    }
    return report(noAppHere(target.dir));
  }

  if (scope === 'app' && (flags.host || flags.release || flags.prebuilt)) throw new Error('Repository automation uses its own checkout; pack host and build flags belong to pack commands.');
  const target = driveTarget(cwd, scope);
  const root = target.root;

  // Before the app is resolved, which can download a Beta: a first run has nothing to drive, and used to
  // find that out only after paying for a build and a launch and then failing with Playwright's
  // "No tests found"
  const layer = scaffold(root, scope);
  if (layer.created.length > 0) console.error(`Created ${DRIVE_DIR}/ — a README and a config are in there.\n`);
  reportStaleConfigs(layer.keptStale);
  if (driveScripts(root).length === 0) {
    console.error(`No driving scripts yet. Write one in ${DRIVE_DIR}/ and run this again:\n`);
    console.error(`  // ${DRIVE_DIR}/look.ts`);
    console.error("  import { drive } from '@apackdev/testing';\n");
    console.error("  drive('look at it', async ({ app, appPage }) => {");
    console.error("    await app.screenshot('look');");
    console.error('  });');
    return;
  }

  // Repository scripts own their checkout; packs use the explicit development-host policy.
  const app = scope === 'app' ? resolveRepositoryHost(target.root)
    : await resolvePackHost({ policy: 'development', flags, hostVersion: target.hostVersion, from: target.packDir ?? target.root });
  const profile = profileFor(mode, cliDirs());

  /**
   * Reachable from every way this ends, and set up the moment the profile exists — a signal or a throw
   * in between used to leak it, and `ensureCheckoutPackages` below is a package rebuild that takes
   * seconds and throws on failure, so "in between" is where an interrupt actually lands.
   *
   * It declines rather than throws when an app still holds the dir: this runs in a `finally`, where a
   * throw would replace whatever the session was already reporting.
   */
  let tornDown = false;
  function teardown(): void {
    if (tornDown || !profile?.ephemeral) return;
    tornDown = true;
    if (dataDirInUse(profile.dir)) {
      console.warn(`\nLeft the ephemeral profile ${profile.name}: an app is still running on it.`);
      return;
    }
    removeProfile(cliDirs(), profile.dir);
    console.error(`\nRemoved the ephemeral profile ${profile.name}.`);
  }

  let child: ChildProcess | undefined;
  let interrupted = false;
  // A handler is also what stops the default action killing this process where it stands, which is how
  // the teardown was skipped before there was one
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      interrupted = true;
      if (child) return void child.kill(signal);
      teardown();
      process.exit(0);
    });
  }

  try {
    await session();
  } finally {
    teardown();
  }

  async function session(): Promise<void> {
    if (profile && withSecrets) {
      const { count, from } = copySecretsInto(profile, hostEnvironment(app));
      console.error(`Copied ${count} secret${count === 1 ? '' : 's'} from ${from}\n`);
    }

    // Electron allows one app per data dir, so a second one here would die inside Playwright's 45s window
    // for a main window and report that it never saw one, which names neither the profile nor the cause
    if (profile && dataDirInUse(profile.dir)) {
      throw new Error(`An app is already running on profile ${profile.name}. Close it, or drive a different profile.`);
    }

    // No build here: the fixture builds the pack itself when PACK_DIR is set, which `fixtureEnv` does
    // below. `apack pack test` leaves it to the fixture for the same reason
    ensureCheckoutPackages(root);

    if (profile) {
      console.error(`Profile ${profile.name}${profile.ephemeral ? ' (removed when this exits)' : ''}`);
      console.error(`  ${profile.dir}\n`);
    }

    // With no pack there is nothing resolving `dist`, and the subject is this checkout's own source
    const env = fixtureEnv(app, target.packDir, process.env, { release: flags.release, prebuilt: flags.prebuilt, keepSourceCondition: target.packDir === undefined });
    // Shown, because the whole point of a script is to watch it. Under Playwright the app hides its
    // windows unless this says otherwise (the guards in packages/main)
    env.PLAYWRIGHT_VISIBLE = '1';
    // The fixture makes a throwaway dir unless it is given one; a profile is the caller's to keep
    if (profile) env.E2E_DATA_DIR = profile.dir;
    // Beside the scripts that take them, not under `tests/` — driving output is not test output
    env.E2E_SCREENSHOT_DIR = path.join(root, '.apack', DRIVE_DIR, 'screenshots');
    // Reports and screenshots share the run's private output scope.
    env.E2E_REPORT_DIR = path.join(root, '.apack', DRIVE_DIR, 'results');

    // Spawned rather than spawnSync'd so this process keeps an event loop. With spawnSync a Ctrl-C took
    // the default action and killed this process where it stood, so the teardown below never ran and an
    // ephemeral profile was left on disk — measured, not reasoned about.
    const playwright = [
      resolvePlaywrightCli(root), 'test',
      '--config', path.join(DRIVE_DIR, 'playwright.config.ts'),
      ...flags.args,
    ];

    child = spawn(process.execPath, playwright, { cwd: root, env, stdio: 'inherit' });
    const [code, killedBy] = await new Promise<[number | null, NodeJS.Signals | null]>(resolve => {
      child!.on('exit', (exitCode, signal) => resolve([exitCode, signal]));
    });
    // A driving session someone interrupted ended the way they asked, not in failure. Tracked rather than
    // read off the status, because Playwright turns the signal into an exit code of its own (130) that is
    // otherwise indistinguishable from a script failing
    if (!interrupted && killedBy === null && code !== 0) {
      throw new Error(`drive exited ${code ?? 'without a status'}`);
    }
  }
}
