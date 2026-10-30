// Runs a command in the Linux test container, from a Mac: `npm run test:linux -- <command>`.
//
// The compiler-runtime, native-fixture and live-watcher suites do not run directly on a daily-use Mac
// (`compilerTestsRunHere`, @apackdev/host/build/compiler-test-host). Linux runs them the way CI's Linux jobs do,
// so this is the local route to them, and `npm run chain` sends its steps that need it here.
//
// The checkout is mounted read-only and copied into a persistent volume, because the container needs its own
// `node_modules` (the Mac's holds macOS binaries) and its own package builds, and because the suites' live
// watchers want an ordinary Linux filesystem rather than a bind mount. Only the first run pays for `npm ci`;
// later runs copy what changed. The elmdb checkout `vendor/elmdb` links to is mounted and copied the same way, into a
// volume of its own, where the container builds its Linux binding. The command's exit code and output pass straight
// through.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PACKAGES_PREBUILT_ENV, REPO_ROOT } from '@apackdev/host/build/packages-built';

const DOCKERFILE = path.join(REPO_ROOT, 'scripts', 'linux', 'Dockerfile');
const short = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex').slice(0, 12);
/** The elmdb checkout `vendor/elmdb` links to (`npm run link:elmdb`), which the container builds its own binding from */
const ELMDB_CHECKOUT = (() => {
  try {
    return fs.realpathSync(path.join(REPO_ROOT, 'vendor', 'elmdb'));
  } catch {
    process.stderr.write('vendor/elmdb links to no elmdb checkout: run npm run link:elmdb first.\n');
    process.exit(1);
  }
})();
/** The Rust toolchain elmdb pins, which the image installs */
const RUST_TOOLCHAIN = /^channel\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(path.join(ELMDB_CHECKOUT, 'rust-toolchain.toml'), 'utf8'))?.[1];
if (RUST_TOOLCHAIN === undefined) {
  process.stderr.write(`${ELMDB_CHECKOUT}/rust-toolchain.toml names no channel\n`);
  process.exit(1);
}
/** Keyed by the Dockerfile's bytes and the toolchain it installs, so either changing builds a new image */
const IMAGE = `apack-linux-test:${short(`${fs.readFileSync(DOCKERFILE, 'utf8')}\n${RUST_TOOLCHAIN}`)}`;
/**
 * The container's copy of the elmdb checkout and its builds, kept across runs as the work volume is. Keyed by the
 * elmdb checkout, so every worktree linking that checkout shares it — and one Rust release build serves them all,
 * which is why it is not per worktree. `ELMDB_LOCK` is what makes sharing it safe
 */
const ELMDB_VOLUME = `apack-linux-elmdb-${short(ELMDB_CHECKOUT)}`;
/**
 * The elmdb volume's lock, at its root: the sync's copy, install and build take it, waiting for one another's, since
 * the run lock below covers only a checkout's own work volume and every checkout's runs share this one
 */
const ELMDB_LOCK = '.apack-elmdb.lock';
/**
 * Written at the elmdb volume's root once a build of what the volume holds finished, and removed before one starts:
 * a copy that changed nothing, onto a finished build, builds nothing, so a sync never rewrites the binding a run in
 * another checkout has loaded unless elmdb's source moved
 */
const ELMDB_BUILT = '.apack-elmdb-built';
/** Cargo's downloaded crates, shared by every checkout's builds */
const CARGO_REGISTRY_VOLUME = 'apack-linux-cargo-registry';
/** One working copy per checkout, so two worktrees never share a container `node_modules` */
const WORK_VOLUME = `apack-linux-work-${short(REPO_ROOT)}`;
const NPM_CACHE_VOLUME = 'apack-linux-npm-cache';
// Bound the whole process tree, including compiler children and native allocations. Equal memory/swap
// limits allow no additional swap; exhaustion fails the container rather than consuming host swap.
const RESOURCE_LIMITS = ['--memory=6g', '--memory-swap=6g', '--cpus=2'];
/**
 * The run lock, at the volume's root. Named once because two places must agree on it: the `flock` below and
 * the rsync filter that keeps `--delete` from removing it while this run holds it.
 */
const RUN_LOCK = '.apack-run.lock';

/**
 * What the copy carries and leaves out, as rsync filters in order. Every `node_modules` stays out (the container
 * installs its own), except the typecheck legs' build infos — `node_modules/.cache/tsbuildinfo` and the renderer's
 * `node_modules/.tmp`: the Mac's legs write them, the integration specs read them, and they hold relative paths.
 * Everything else the Mac's steps produced is carried too — build outputs, `.apack` build records — because the
 * suites read them. Also out: the builds that are platform-specific, which the container makes for itself — the
 * published packages `packages:ensure` builds, and the built-in pack, whose build record names what its
 * compilers read (`@esbuild/darwin-arm64` on a Mac) and so replays only on the platform that built it.
 * Excluded paths in the volume survive each copy, so the container's own installs and builds are kept.
 *
 * **That exemption is why `CONTAINER_CACHES` exists.** `--delete` never touches an excluded path, so everything
 * under `node_modules` is immortal — which is what the container's install needs, and what makes the volume a
 * place anything can be left for ever. One volume reached 40 GB that way, 38.7 GB of it a cache tree nothing in
 * this repo writes, and the disk it filled surfaced as failures that named anything but the disk.
 */
const FILTERS = [
  '--include=/node_modules/', '--include=/node_modules/.cache/', '--include=/node_modules/.cache/tsbuildinfo/***',
  '--exclude=/node_modules/.cache/*', '--exclude=/node_modules/*',
  '--include=/packages/renderer/node_modules/', '--include=/packages/renderer/node_modules/.tmp/***',
  '--exclude=/packages/renderer/node_modules/*',
  '--exclude=node_modules',
  ...['apack-ears', 'apack-sdk', 'apack-ui', 'apack-testing', 'apack-cli'].flatMap((pkg) =>
    [`--exclude=/packages/${pkg}/dist`, `--exclude=/packages/${pkg}/publish`]),
  '--exclude=/packages/default-setup/dist', '--exclude=/packages/default-setup/.apack',
  ...['api', 'main', 'preload', 'renderer'].map(pkg => `--exclude=/packages/${pkg}/dist`),
  '--exclude=/build-manifest.json', '--exclude=/build-integrity.json',
];

/**
 * The caches this repo's own tooling keeps under `node_modules/.cache`, which the sync leaves alone. Anything
 * else there is deleted on every run, because the rsync exemption above means nothing else ever would.
 *
 * **A name missing from this list costs a rebuild or a reading, never a wrong answer**, which is what makes the
 * list safe to be a little out of date: these are caches, so whatever wanted one makes it again. The durations
 * are the ones worth having right — they are a window of recent runs on this machine, and a deleted window
 * starts empty rather than wrong. Add a name when a new cache is worth keeping between runs, not to fix a bug.
 *
 * Re-derive it from the code that writes them, which is two spellings: a `'.cache', '<name>'` path join, and a
 * `node_modules/.cache/<name>` literal. Deriving from one alone misses the other — the first pass here did.
 */
const CONTAINER_CACHES = [
  'apack-chain', 'apack-fixtures', 'apack-packages-build',
  'apack-spec-durations', 'apack-step-durations', 'apack-unit-pool', 'tsbuildinfo',
];

/**
 * The file at a work volume's root naming the checkout it serves, written by every sync.
 *
 * **A file rather than a volume label**, because `docker volume create` adds no label to a volume that already
 * exists and there is no way to label one afterwards — so a label would only ever describe volumes created after
 * this code, leaving every existing one permanently unidentifiable and the prune below permanently idle.
 * A file is written by the run, so one sync makes any volume identifiable, however old.
 */
const CHECKOUT_FILE = '.apack-checkout';
/** Whose elmdb volume this is, as `CHECKOUT_FILE` says whose work volume: the elmdb checkout it copies */
const ELMDB_CHECKOUT_FILE = '.apack-elmdb-checkout';
/**
 * What Docker must have free before a run starts. A run's sync, install and builds grow its volumes by several GB, and
 * a disk that fills mid-run fails it with errors that name neither the disk nor what holds it
 */
const DOCKER_FREE_FLOOR_GB = 8;

const docker = (args: string[], stdio: 'inherit' | 'pipe' = 'pipe') => spawnSync('docker', args, { stdio, encoding: 'utf8' });

function refuse(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const command = process.argv.slice(2);
if (command.length === 0) refuse('usage: npm run test:linux -- <command> [args...]');

if (docker(['info']).status !== 0) {
  refuse('This runs in the Linux test container, and Docker is not running. Start it (OrbStack: `orb start`) and run again.');
}

if (docker(['image', 'inspect', IMAGE]).status !== 0) {
  process.stderr.write(`Building the Linux test image ${IMAGE} (once per Dockerfile change)…\n`);
  if (docker(['build', '-t', IMAGE, '--build-arg', `RUST_TOOLCHAIN=${RUST_TOOLCHAIN}`, '-f', DOCKERFILE, path.dirname(DOCKERFILE)], 'inherit').status !== 0) {
    refuse(`Building ${IMAGE} failed; its output is above.`);
  }
}

/**
 * Work and elmdb volumes whose checkout is gone.
 *
 * A volume is keyed by a hash of the checkout's path, so nothing could tell an abandoned volume from a live one
 * — a deleted worktree's `node_modules` and platform builds simply stayed for ever, and one of them reached
 * 40 GB. `CHECKOUT_FILE` carries the path, so "that directory no longer exists" is a fact this can check rather
 * than a guess about age or size.
 *
 * A volume with no such file yet is left alone: it has not synced since this was added, so nothing says whose it
 * is. One run of its own checkout names it, and it becomes prunable like the rest.
 *
 * **Removal is left to Docker to refuse.** A volume a container still has mounted cannot be removed and the
 * error is ignored, so a run in another checkout is never disturbed by this one tidying up.
 */
function pruneAbandonedVolumes(): void {
  const listed = docker(['volume', 'ls', '--format', '{{.Name}}']);
  if (listed.status !== 0) return;
  const kinds = [
    { prefix: 'apack-linux-work-', mine: WORK_VOLUME, file: CHECKOUT_FILE, what: 'work' },
    { prefix: 'apack-linux-elmdb-', mine: ELMDB_VOLUME, file: ELMDB_CHECKOUT_FILE, what: 'elmdb' },
  ];
  for (const name of listed.stdout.split('\n').map((line) => line.trim())) {
    const kind = kinds.find(({ prefix }) => name.startsWith(prefix));
    if (kind === undefined || name === kind.mine) continue;
    const read = docker(['run', '--rm', ...RESOURCE_LIMITS, '-v', `${name}:/volume:ro`, IMAGE, 'cat', `/volume/${kind.file}`]);
    const checkout = read.status === 0 ? read.stdout.trim() : '';
    if (!checkout || fs.existsSync(checkout)) continue;
    if (docker(['volume', 'rm', name]).status === 0) {
      process.stderr.write(`Removed the container ${kind.what} volume of ${checkout}, which no longer exists.\n`);
    }
  }
}

/** Refuses a run Docker hasn't the space for, saying where to see what holds it */
function refuseWithoutSpace(): void {
  const read = docker(['run', '--rm', ...RESOURCE_LIMITS, IMAGE, 'df', '-Pk', '/']);
  const free = Number(read.stdout.trim().split('\n').at(-1)?.split(/\s+/)[3]) / 1024 ** 2;
  if (read.status !== 0 || !Number.isFinite(free)) refuse(`Could not read Docker's free space: ${read.stderr.trim()}`);
  if (free < DOCKER_FREE_FLOOR_GB) {
    refuse([
      `Docker has ${free.toFixed(1)} GB free, and a run needs ${DOCKER_FREE_FLOOR_GB}.`,
      'What holds it, volumes by size: docker system df -v. A volume no container uses (LINKS 0) can go: docker volume rm <name>.',
    ].join('\n'));
  }
}

/**
 * A linked worktree's `.git` is a file naming the repository's git dir by absolute path. Mounting that dir at the
 * same path lets git resolve it inside the container, so specs that ask git about this checkout still can.
 */
function gitDirMount(): string[] {
  const dotGit = path.join(REPO_ROOT, '.git');
  if (!fs.statSync(dotGit).isFile()) return [];
  const gitDir = /^gitdir: (.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'))?.[1]?.trim();
  if (gitDir === undefined) return [];
  const common = path.resolve(gitDir, fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim());
  return ['-v', `${common}:${common}:ro`];
}

pruneAbandonedVolumes();
refuseWithoutSpace();

/**
 * What the chain and its pools tell a step about the run it is part of.
 *
 * `PACKAGES_PREBUILT_ENV` is the one `APACK_` variable that must not cross: it says the publishable packages
 * are already built, which is true of the Mac's tree and false of this volume by construction — the copy
 * below excludes every `packages/<pkg>/dist`, so the container builds its own. Forwarded, it makes the
 * `packages:ensure` in `sync` read that intended absence as a writer rewriting the tree mid-run, and refuse
 * the very builds it is there to make. A volume warmed by a run outside the chain hides this, which is why
 * it survived: the excluded paths persist, so only the first container run in a checkout is refused.
 */
const forwarded = Object.keys(process.env)
  .filter((key) => (key.startsWith('APACK_') && key !== PACKAGES_PREBUILT_ENV) || key === 'FORCE_COLOR');

const quote = (arg: string): string => `'${arg.replace(/'/g, `'\\''`)}'`;
/**
 * Copy, install when the lockfile differs from the one the volume last installed from, then make the platform's own
 * builds — under one lock on the
 * volume, because the chain runs two of these steps at once and two copies or two installs into one tree race.
 * The containers share the Linux VM's kernel, so `flock` on a file in the volume holds across them.
 */
const sync = [
  // The link is the container's own, to its copy of elmdb, where its Linux binding is built before npm resolves it
  `rsync -a --delete --exclude=/${RUN_LOCK} --exclude=/${CHECKOUT_FILE} --exclude=/vendor/elmdb ${FILTERS.map(quote).join(' ')} /src/ /work/`,
  `exec 8>/elmdb/${ELMDB_LOCK}`,
  'if ! flock -n 8; then',
  '  echo "Waiting for another checkout\'s test:linux run to finish syncing the shared elmdb volume…" >&2',
  '  flock 8',
  'fi',
  `elmdbChanged=$(rsync -aiO --delete --exclude=/${ELMDB_LOCK} --exclude=/${ELMDB_BUILT} --exclude=/${ELMDB_CHECKOUT_FILE} --exclude=/target/ --exclude=node_modules --exclude='*.node' /elmdb-src/ /elmdb/)`,
  'ln -sfn /elmdb /work/vendor/elmdb',
  'elmdbLock=$(sha256sum /elmdb/package-lock.json | cut -d" " -f1)',
  'if [ "$(cat /elmdb/node_modules/.apack-installed-lock 2>/dev/null)" != "$elmdbLock" ]; then',
  '  (cd /elmdb && npm ci --no-audit --no-fund)',
  '  echo "$elmdbLock" > /elmdb/node_modules/.apack-installed-lock',
  '  elmdbChanged=installed',
  'fi',
  `if [ -n "$elmdbChanged" ] || [ ! -f /elmdb/${ELMDB_BUILT} ]; then`,
  `  rm -f /elmdb/${ELMDB_BUILT}`,
  '  (cd /elmdb && npm run -s build >/dev/null)',
  `  touch /elmdb/${ELMDB_BUILT}`,
  'fi',
  // Whose volume this is: see ELMDB_CHECKOUT_FILE
  `printf '%s' ${quote(ELMDB_CHECKOUT)} > /elmdb/${ELMDB_CHECKOUT_FILE}`,
  'exec 8>&-',
  // Whose volume this is, for the prune that cannot otherwise tell: see CHECKOUT_FILE
  `printf '%s' ${quote(REPO_ROOT)} > /work/${CHECKOUT_FILE}`,
  // What the rsync exemption would otherwise keep for ever: see CONTAINER_CACHES
  `for entry in node_modules/.cache/*; do [ -e "$entry" ] || continue; case "\${entry##*/}" in ${CONTAINER_CACHES.join('|')}) ;; *) rm -rf "$entry" ;; esac; done`,
  'lock=$(sha256sum package-lock.json | cut -d" " -f1)',
  'if [ "$(cat node_modules/.apack-installed-lock 2>/dev/null)" != "$lock" ]; then',
  '  npm ci --no-audit --no-fund',
  '  echo "$lock" > node_modules/.apack-installed-lock',
  'fi',
  // The platform's own builds, reused when their inputs have not moved
  'npm run -s packages:ensure',
  'npm run -s build:default-setup >/dev/null',
].join('\n');
/**
 * One container at a time per volume, for the whole run rather than the sync alone.
 *
 * **It is `flock` because the kernel releases it when the holder dies**, which is the one way a lock in here
 * can be resolved: a container cannot tell a dead sibling's record from a live one — its hostname is the
 * instance's and `boot_id` is the host kernel's, so there is nothing to compare a pid against. A lock file
 * naming a pid and a hostname, which is what the pools write, is therefore held for ever once its container
 * is gone (`exclusive-lock.ts`'s foreign-machine branch, correctly, cannot resolve it).
 *
 * So the orphans are cleared here, under this lock, where they are provably orphans: holding it means no
 * other container is working in this volume, so no live pool run owns one. Killing a native run used to wedge
 * every later one until the file was deleted by hand inside the container.
 *
 * Two runs sharing a volume was never safe anyway — they share `node_modules` and the platform builds the
 * sync phase makes — so a second refuses rather than waiting, naming what holds it.
 */
const run = [
  `exec 9>/work/${RUN_LOCK}`,
  'if ! flock -n 9; then',
  '  echo "another test:linux run holds this checkout\'s container volume (apack-linux-work)." >&2',
  `  echo "Wait for it to finish, or stop it: docker ps --filter ancestor=${IMAGE}" >&2`,
  '  exit 1',
  'fi',
  // Orphans of a container that was killed: this run holds the only slot, so none of them is live
  'rm -f /work/node_modules/.cache/apack-unit-pool/*.lock',
  `bash -ec ${quote(sync)}`,
  // `exec` keeps fd 9, so the lock is held for as long as the command runs
  `export APACK_EXECUTION_RECORDS=${quote(JSON.stringify({ source: [RUN_LOCK, CHECKOUT_FILE], native: [ELMDB_LOCK, ELMDB_BUILT, ELMDB_CHECKOUT_FILE] }))}`,
  `exec ${command.map(quote).join(' ')}`,
].join('\n');
const script = ['set -e', run].join('\n');

const child = spawn('docker', [
  // IPv4 loopback only, as on CI's Linux runners: with IPv6 up, `localhost` resolves to ::1 first here, so a
  // dev server binds where a client dialling 127.0.0.1 cannot reach it
  'run', '--rm', '--init', ...RESOURCE_LIMITS, '--sysctl', 'net.ipv6.conf.all.disable_ipv6=1',
  '-v', `${REPO_ROOT}:/src:ro`, '-v', `${WORK_VOLUME}:/work`, '-v', `${NPM_CACHE_VOLUME}:/root/.npm`,
  '-v', `${ELMDB_CHECKOUT}:/elmdb-src:ro`, '-v', `${ELMDB_VOLUME}:/elmdb`, '-v', `${CARGO_REGISTRY_VOLUME}:/usr/local/cargo/registry`,
  ...gitDirMount(),
  ...forwarded.flatMap((key) => ['-e', key]),
  IMAGE, 'bash', '-c', script,
], { stdio: 'inherit' });

// Docker forwards these to the container's init, which stops the command and lets `--rm` clean up
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
child.on('close', (code, signal) => { process.exitCode = code ?? (signal === null ? 1 : 128); });
