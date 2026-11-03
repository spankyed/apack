// Keeps this machine's rebuildable build caches inside a budget: `npm run janitor` once, `npm run janitor:install` to
// have launchd run it every hour. `--dry` says what it would remove and removes nothing.
//
// Its reach is the elmdb checkout `vendor/elmdb` links to and every worktree of it, which is where the disk went:
// rustc's incremental sessions accumulate one directory per compilation unit, and a unit whose features or flags
// change starts another without removing the last — 270 of them, 11 GB, in two days of one checkout. What it may
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
  type IncrementalUnit, limitsFor, planIncrementalEviction, planTmpRemoval,
} from './lib/janitor-policy.ts';

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

/** The elmdb checkout `vendor/elmdb` links to, and its worktrees */
function elmdbCheckouts(): string[] {
  let main: string;
  try { main = fs.realpathSync(path.join(REPO_ROOT, 'vendor', 'elmdb')); } catch { return []; }
  const listed = run('git', ['-C', main, 'worktree', 'list', '--porcelain']);
  const worktrees = listed.status === 0
    ? listed.stdout.split('\n').filter((line) => line.startsWith('worktree ')).map((line) => line.slice('worktree '.length))
    : [main];
  return [...new Set(worktrees)].filter((dir) => fs.existsSync(dir));
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
    <string>--disable-warning=ExperimentalWarning</string>
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
  const checkouts = elmdbCheckouts();
  sweepRust(checkouts, limits.incrementalBudgetBytes, limits.sweepDays);
  sweepTestTmp(checkouts);
  say(`${gb(freeBytes())} free`);
  if (!dry) writeLog();
}
