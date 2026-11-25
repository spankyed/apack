// Keeps this machine's rebuildable build caches inside a budget: `npm run janitor` once, `npm run janitor:install` to
// have launchd run it every hour. `--dry` says what it would remove and removes nothing.
//
// Its reach is the checkout of each repository apack takes packages from (`lib/external-packages.mjs`) that sits beside
// the main one and is a Rust checkout, and every worktree of each: what `npm run deps:local` builds against. That is where
// the disk went:
// rustc's incremental sessions accumulate one directory per compilation unit, and a unit whose features or flags
// change starts another without removing the last — 270 of them, 11 GB, in two days of one checkout. And every
// worktree builds into a target of its own, so when the disk is low the ones nobody is building in give theirs back. What it may
// remove, and when, is `lib/janitor-policy.ts`. Every removal in a Rust target holds that profile's `.cargo-lock`,
// the lock cargo builds under, so a build in progress is never cut short: the janitor skips that target this hour.
//
// Plain Node (its type stripping), importing nothing outside `node:` and its policy, because launchd runs it with no
// npm, no tsx and no workspace resolution.
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  type IncrementalUnit, type ProfileOutput, type SystemTmpEntry, classifySystemTmpName, limitsFor,
  planIdleProfileClearing, planIncrementalEviction, planSystemTmpRemoval, planTmpRemoval, psHasCargoMutants,
} from './lib/janitor-policy.ts';
import { REPOSITORIES } from './lib/external-packages.mjs';
import { primaryWorktree } from './lib/worktrees.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const LABEL = 'dev.apack.janitor';
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const LOG = path.join(os.homedir(), 'Library', 'Logs', 'apack-janitor.log');
/** The log keeps its most recent lines, so the thing that bounds caches is not itself unbounded */
const LOG_LINES = 2000;
/** lockf's exit status when `-t 0` finds the lock held: cargo is building there */
const LOCK_HELD = 75;

const dry = process.argv.includes('--dry');
const GB = 1024 ** 3;
const gb = (bytes: number) => `${(bytes / GB).toFixed(1)} GB`;
const lines: string[] = [];
const say = (line: string) => { lines.push(line); process.stdout.write(`${line}\n`); };

function freeBytes(): number {
  const stats = fs.statfsSync(os.homedir());
  return stats.bavail * stats.bsize;
}

const run = (command: string, args: string[], cwd?: string) => spawnSync(command, args, { cwd, encoding: 'utf8' });

/** A checkout and every worktree of it, each of which builds into a target directory of its own */
function worktreesOf(main: string): string[] {
  const listed = run('git', ['-C', main, 'worktree', 'list', '--porcelain']);
  const worktrees = listed.status === 0
    ? listed.stdout.split('\n').filter((line) => line.startsWith('worktree ')).map((line) => line.slice('worktree '.length))
    : [main];
  return [...new Set(worktrees)].filter((dir) => fs.existsSync(dir));
}

/**
 * Every Rust checkout of the repositories apack takes packages from, beside this checkout and named for its
 * repository, worktrees included. **It refuses an empty set rather than answering one**: a janitor holding nothing to
 * its budget would report one every hour, a check that reports nothing having looked at nothing.
 */
function rustCheckouts(): string[] {
  const siblings = Object.keys(REPOSITORIES).map((repo) => path.join(path.dirname(primaryWorktree(REPO_ROOT)), repo));
  const rust = siblings.filter((dir) => fs.existsSync(path.join(dir, 'Cargo.toml')));
  if (rust.length === 0) throw new Error(`No Rust checkout beside this one: looked for ${siblings.join(', ')}`);
  return [...new Set(rust.flatMap(worktreesOf))];
}

/** A target's profile directories: those cargo locks, `target/debug` and `target/<triple>/debug` alike */
function profileDirs(target: string): string[] {
  const found: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (fs.existsSync(path.join(dir, '.cargo-lock'))) found.push(dir);
    if (depth === 0) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(path.join(dir, entry.name), depth - 1);
    }
  };
  visit(target, 2);
  return found;
}

function incrementalUnits(profileDir: string): IncrementalUnit[] {
  const incremental = path.join(profileDir, 'incremental');
  if (!fs.existsSync(incremental)) return [];
  const sizes = run('du', ['-k', '-d', '1', incremental]);
  return sizes.stdout.split('\n').flatMap((line) => {
    const [kb, unit] = line.split('\t');
    if (!unit || unit === incremental) return [];
    return [{ path: unit, profileDir, bytes: Number(kb) * 1024, mtimeMs: fs.statSync(unit).mtimeMs }];
  });
}

/** Runs `command` holding every lock in `locks`, or reports them held: lockf nests, one lock per process */
function underLocks(locks: string[], command: string[]): { outcome: 'done' | 'held' | 'failed'; output: string } {
  const args = locks.flatMap((lock) => ['lockf', '-k', '-t', '0', lock]).concat(command);
  const result = run(args[0]!, args.slice(1));
  const output = `${result.stdout}${result.stderr}`.trim();
  if (result.status === LOCK_HELD) return { outcome: 'held', output };
  if (result.status !== 0) { say(`  failed: ${command.join(' ')}: ${output}`); return { outcome: 'failed', output }; }
  return { outcome: 'done', output };
}

function sweepRust(checkouts: string[], budget: number, sweepDays: number): void {
  const targets = checkouts.map((dir) => path.join(dir, 'target')).filter((dir) => fs.existsSync(dir));
  const units = targets.flatMap((target) => profileDirs(target).flatMap(incrementalUnits));
  const held = units.reduce((sum, unit) => sum + unit.bytes, 0);
  const evict = planIncrementalEviction(units, budget, Date.now());
  say(`rust incremental: ${units.length} units, ${gb(held)} across ${targets.length} targets; budget ${gb(budget)}; evicting ${evict.length}`);
  for (const profileDir of new Set(evict.map((unit) => unit.profileDir))) {
    const mine = evict.filter((unit) => unit.profileDir === profileDir);
    const bytes = mine.reduce((sum, unit) => sum + unit.bytes, 0);
    if (dry) { say(`  would evict ${mine.length} units (${gb(bytes)}) from ${profileDir}`); continue; }
    const { outcome } = underLocks([path.join(profileDir, '.cargo-lock')], ['rm', '-rf', ...mine.map((unit) => unit.path)]);
    say(outcome === 'held' ? `  skipped ${profileDir}: cargo is building there` : `  evicted ${mine.length} units (${gb(bytes)}) from ${profileDir}`);
  }
  for (const target of targets) {
    const checkout = path.dirname(target);
    const locks = profileDirs(target).map((dir) => path.join(dir, '.cargo-lock'));
    const { outcome, output } = underLocks(locks, ['cargo', 'sweep', ...(dry ? ['--dry-run'] : []), '--time', String(sweepDays), checkout]);
    if (outcome === 'held') say(`  skipped sweeping ${target}: cargo is building there`);
    else if (outcome === 'done') say(`  sweep ${sweepDays}d: ${output.split('\n').at(-1)?.replace(/^\[INFO\] /, '')}`);
  }
}

/** Newest mtime of `dir` and its direct children (without following symlinks) */
function newestChildMs(dir: string): number {
  let newest = 0;
  try { newest = fs.lstatSync(dir).mtimeMs; } catch { return 0; }
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return newest; }
  for (const name of names) {
    try { newest = Math.max(newest, fs.lstatSync(path.join(dir, name)).mtimeMs); } catch {}
  }
  return newest;
}

/** When anything was last compiled into a profile directory: the newest of the directories a build adds to */
function profileBuiltMs(profileDir: string): number {
  const added = [
    ...['deps', 'build'].flatMap((name) => {
      try { return [fs.lstatSync(path.join(profileDir, name)).mtimeMs]; } catch { return []; }
    }),
    ...['.fingerprint', 'incremental'].map((name) => newestChildMs(path.join(profileDir, name))).filter((ms) => ms > 0),
  ];
  return added.length > 0 ? Math.max(...added) : fs.lstatSync(profileDir).mtimeMs;
}

/** A profile directory's size and when anything was last compiled into it */
function profileOutput(profileDir: string): ProfileOutput {
  const sized = run('du', ['-sk', profileDir]);
  return { profileDir, bytes: Number(sized.stdout.split('\t')[0]) * 1024, builtMs: profileBuiltMs(profileDir) };
}

/**
 * Gives back the whole build output of every profile nothing has compiled into for `idleMs`, which is set only
 * when the disk is low (`planIdleProfileClearing` on why this and not a size). Under the profile's `.cargo-lock`,
 * which stays, so a build that is running there is never cut short.
 */
function clearIdleProfiles(checkouts: string[], idleMs: number | undefined): void {
  if (idleMs === undefined) return;
  const targets = checkouts.map((dir) => path.join(dir, 'target')).filter((dir) => fs.existsSync(dir));
  const profiles = targets.flatMap(profileDirs).map(profileOutput);
  const idle = planIdleProfileClearing(profiles, idleMs, Date.now());
  const total = profiles.reduce((sum, profile) => sum + profile.bytes, 0);
  say(`rust build output: ${profiles.length} profiles, ${gb(total)} across ${targets.length} targets; clearing the ${idle.length} not compiled into for ${Math.round(idleMs / 3_600_000)}h`);
  for (const profile of idle) {
    if (dry) { say(`  would clear ${gb(profile.bytes)} from ${profile.profileDir}`); continue; }
    const { outcome } = underLocks([path.join(profile.profileDir, '.cargo-lock')],
      ['find', profile.profileDir, '-mindepth', '1', '-maxdepth', '1', '!', '-name', '.cargo-lock', '-exec', 'rm', '-rf', '{}', '+']);
    say(outcome === 'held' ? `  skipped ${profile.profileDir}: cargo is building there`
      : outcome === 'done' ? `  cleared ${gb(profile.bytes)} from ${profile.profileDir}` : `  could not clear ${profile.profileDir}`);
  }
}

function pidIsLive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

function authoringOwnerLive(dir: string): boolean {
  let pid = Number.NaN;
  try { pid = Number(fs.readFileSync(path.join(dir, 'owner'), 'utf8').trim()); } catch { return false; }
  return Number.isSafeInteger(pid) && pid > 0 && pidIsLive(pid);
}

function authoringCheckoutExists(dir: string): boolean | undefined {
  let checkout: string;
  try { checkout = fs.readFileSync(path.join(dir, 'checkout'), 'utf8').trim(); } catch { return undefined; }
  return checkout.length > 0 ? fs.existsSync(checkout) : undefined;
}

/** Makes every directory under `dir` owner-writable so read-only compiler stores inside a work dir can be removed */
function makeWritable(dir: string): void {
  let stat: fs.Stats;
  try { stat = fs.lstatSync(dir); } catch { return; }
  if (stat.isSymbolicLink() || !stat.isDirectory()) return;
  try { fs.chmodSync(dir, 0o700); } catch { return; }
  for (const entry of fs.readdirSync(dir)) makeWritable(path.join(dir, entry));
}

function systemTmpEntries(tmpRoot: string): SystemTmpEntry[] {
  let names: string[];
  try { names = fs.readdirSync(tmpRoot); } catch { return []; }
  const entries: SystemTmpEntry[] = [];
  for (const name of names) {
    const kind = classifySystemTmpName(name);
    if (!kind) continue;
    const at = path.join(tmpRoot, name);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(at); } catch { continue; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
    let activityMs = stat.mtimeMs;
    if (kind === 'cargo-mutants') {
      const target = path.join(at, 'target');
      if (fs.existsSync(target)) {
        for (const profile of profileDirs(target)) {
          try { activityMs = Math.max(activityMs, profileBuiltMs(profile)); } catch {}
        }
      }
      entries.push({ name, path: at, kind, activityMs });
    } else if (kind === 'apack-authoring') {
      try { activityMs = Math.max(activityMs, fs.statSync(path.join(at, 'owner')).mtimeMs); } catch {}
      entries.push({
        name, path: at, kind, activityMs,
        ownerLive: authoringOwnerLive(at),
        checkoutExists: authoringCheckoutExists(at),
      });
    } else {
      entries.push({ name, path: at, kind, activityMs });
    }
  }
  return entries;
}

/** Whether any `cargo-mutants` process is running on this host (fails closed as true if `ps` fails) */
function cargoMutantsRunning(): boolean {
  const probe = run('ps', ['-A', '-o', 'pid=,comm=']);
  if (probe.error || probe.status !== 0) return true;
  return psHasCargoMutants(probe.stdout, process.pid);
}

/** Unique temp roots to inspect: `os.tmpdir()` plus `/tmp` when they resolve to different directories (macOS) */
function systemTmpRoots(): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [os.tmpdir(), '/tmp']) {
    let real: string;
    try { real = fs.realpathSync(candidate); } catch { continue; }
    if (seen.has(real)) continue;
    seen.add(real);
    roots.push(real);
  }
  return roots;
}

function sweepSystemTmp(idleMs: number | undefined): void {
  const mutantsLive = cargoMutantsRunning();
  for (const tmpRoot of systemTmpRoots()) {
    const entries = systemTmpEntries(tmpRoot);
    const stale = planSystemTmpRemoval(entries, idleMs, Date.now(), { cargoMutantsRunning: mutantsLive });
    if (stale.length === 0) continue;
    say(`system tmp: ${dry ? 'would remove' : 'removing'} ${stale.length} of ${entries.length} owned directories in ${tmpRoot}`);
    for (const entry of stale) {
      if (dry) { say(`  would remove ${entry.path}`); continue; }
      if (entry.kind === 'cargo-mutants') {
        const target = path.join(entry.path, 'target');
        const locks = fs.existsSync(target) ? profileDirs(target).map((dir) => path.join(dir, '.cargo-lock')) : [];
        if (locks.length > 0) {
          const { outcome } = underLocks(locks, ['rm', '-rf', entry.path]);
          say(outcome === 'held' ? `  skipped ${entry.path}: cargo is building there`
            : outcome === 'done' ? `  removed ${entry.path}` : `  could not remove ${entry.path}`);
          continue;
        }
      }
      try {
        if (entry.kind === 'apack-authoring') makeWritable(entry.path);
        fs.rmSync(entry.path, { recursive: true, force: true });
        say(`  removed ${entry.path}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EACCES' || (error as NodeJS.ErrnoException).code === 'EPERM') {
          try {
            makeWritable(entry.path);
            fs.rmSync(entry.path, { recursive: true, force: true });
            say(`  removed ${entry.path}`);
            continue;
          } catch {}
        }
        say(`  could not remove ${entry.path}: ${(error as Error).message}`);
      }
    }
  }
}

function sweepTestTmp(checkouts: string[]): void {
  for (const checkout of checkouts) {
    const tmp = path.join(checkout, 'tmp');
    if (!fs.existsSync(tmp)) continue;
    const entries = fs.readdirSync(tmp).map((name) => ({ name, mtimeMs: fs.lstatSync(path.join(tmp, name)).mtimeMs }));
    const stale = planTmpRemoval(entries, Date.now());
    if (stale.length === 0) continue;
    say(`${dry ? 'would remove' : 'removing'} ${stale.length} leftover test directories from ${tmp}`);
    if (dry) continue;
    for (const entry of stale) {
      const at = path.join(tmp, entry.name);
      try { fs.rmSync(at, { recursive: true, force: true }); } catch (error) { say(`  could not remove ${at}: ${(error as Error).message}`); }
    }
  }
}

function writeLog(): void {
  const previous = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean) : [];
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.writeFileSync(LOG, `${[...previous, ...lines].slice(-LOG_LINES).join('\n')}\n`);
}

function install(): void {
  // launchd starts it with almost no PATH: node's own directory, cargo's and the system's
  const pathEnv = [path.dirname(process.execPath), path.join(os.homedir(), '.cargo', 'bin'), '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin'].join(':');
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${path.join(REPO_ROOT, 'scripts', 'janitor.ts')}</string>
  </array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${pathEnv}</string></dict>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>LowPriorityIO</key><true/>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>${LOG}</string>
</dict>
</plist>
`;
  uninstall();
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.writeFileSync(PLIST, plist);
  const loaded = run('launchctl', ['bootstrap', `gui/${process.getuid!()}`, PLIST]);
  if (loaded.status !== 0) { process.stderr.write(`launchctl bootstrap failed: ${loaded.stderr}`); process.exit(1); }
  process.stdout.write(`Installed ${PLIST}: hourly, logging to ${LOG}\n`);
}

function uninstall(): void {
  if (!fs.existsSync(PLIST)) return;
  run('launchctl', ['bootout', `gui/${process.getuid!()}/${LABEL}`]);
  fs.rmSync(PLIST);
}

if (process.argv.includes('--install')) install();
else if (process.argv.includes('--uninstall')) { uninstall(); process.stdout.write(`Removed ${LABEL}\n`); }
else {
  const before = freeBytes();
  const limits = limitsFor(before);
  say(`--- ${new Date().toISOString()}${dry ? ' (dry)' : ''}: ${gb(before)} free`);
  // **A refusal is reported into the log this writes, not thrown past it.** `rustCheckouts` refuses an
  // empty set on purpose, and thrown from here that refusal escaped before `writeLog()` — the only
  // thing that trims the log to `LOG_LINES`. So an hourly launchd run with no link appended a stack trace to
  // the one file this script exists to keep bounded, for ever, and swept nothing while doing it.
  let checkouts: string[] = [];
  let refused: unknown;
  try {
    checkouts = rustCheckouts();
  } catch (error) {
    refused = error;
  }
  if (refused === undefined) {
    sweepRust(checkouts, limits.incrementalBudgetBytes, limits.sweepDays);
    clearIdleProfiles(checkouts, limits.idleProfileMs);
    sweepTestTmp(checkouts);
    sweepSystemTmp(limits.idleProfileMs);
  } else {
    say(`swept nothing: ${refused instanceof Error ? refused.message : String(refused)}`);
  }
  say(`${gb(freeBytes())} free`);
  if (!dry) writeLog();
  if (refused !== undefined) process.exit(1);
}
