// The link to the elmdb checkout apack consumes two packages of: `vendor/elmdb`, a gitignored symlink, beside the
// commit it is pinned to, `vendor/elmdb.rev`. Plain Node with no dependencies, since it runs before `npm ci`: npm
// resolves the `file:` dependencies through the link. The checkout is `ELMDB_DIR`, or `~/Develop/Projects/apack/elmdb`.
//
// The two packages are the binding (`crates/elmdb-node`, npm `elmdb`) and EARS (`packages/ears`, npm `@elmdb/ears`),
// which is TypeScript consumed as its built `dist`. **Whether that `dist` is the build of the checkout as it is now is
// elmdb's to answer**, by `packages/ears/scripts/dist-current.mjs`, so the two repositories can't disagree about it;
// this asks it and builds `dist` when it isn't. And **EARS' `elmdb` is a peer, which resolves from EARS' real path**,
// inside the checkout: it is apack's binding only when the checkout's `node_modules/elmdb` is the workspace's link to
// `crates/elmdb-node`, the file apack's own `node_modules/elmdb` links to, so a second binding is refused here.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitIn, pinWarnings } from './lib/vendor-pin.mjs';

/** The elmdb checkout the link points at @param {NodeJS.ProcessEnv} [env] */
export function elmdbCheckout(env = process.env) {
  return path.resolve(env.ELMDB_DIR ?? path.join(os.homedir(), 'Develop', 'Projects', 'apack', 'elmdb'));
}

/** The checkout's directories apack consumes, relative to it: what the pin warning compares */
export const ELMDB_PACKAGES = ['crates/elmdb-node', 'packages/ears'];

/**
 * Why EARS' `dist` in the checkout is not current, or undefined when it is, as elmdb's `dist-current.mjs` answers
 * @param {string} checkout
 */
export function earsStaleness(checkout) {
  try {
    execFileSync(process.execPath, [path.join(checkout, 'packages', 'ears', 'scripts', 'dist-current.mjs')], {
      cwd: checkout, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8',
    });
    return undefined;
  } catch (error) {
    const said = /** @type {{ stderr?: string }} */ (error).stderr?.trim();
    return said || String(error);
  }
}

/**
 * Throws unless the checkout's `node_modules/elmdb` is the workspace's link to its `crates/elmdb-node`: what EARS'
 * peer resolves to from inside the checkout, which has to be the binding apack's own `elmdb` links to
 * @param {string} checkout
 */
export function assertWorkspaceBinding(checkout) {
  const installed = path.join(checkout, 'node_modules', 'elmdb');
  const binding = path.join(checkout, 'crates', 'elmdb-node');
  let resolved;
  try { resolved = fs.realpathSync(installed); } catch { resolved = undefined; }
  if (resolved !== fs.realpathSync(binding)) {
    throw new Error(`${installed} is ${resolved === undefined ? 'missing' : `${resolved}, not the workspace's link to ${binding}`}, so EARS' elmdb would not be apack's: run npm ci in ${checkout}`);
  }
}

/** Builds EARS' `dist` in the checkout, with the checkout's own tools @param {string} checkout */
function buildEars(checkout) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npm, ['run', 'build:ears'], { cwd: checkout, stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });
}

/**
 * Points `<root>/vendor/elmdb` at the checkout, refusing one that isn't an elmdb checkout, that doesn't hold the
 * pinned commit in its history, whose binding isn't built for this platform, or whose installed `elmdb` isn't its
 * own binding, and builds EARS' `dist` when elmdb says it isn't current. A link already there is replaced
 * @param {string} root @param {string} [checkout]
 */
export function linkElmdb(root, checkout = elmdbCheckout()) {
  const revFile = path.join(root, 'vendor', 'elmdb.rev');
  // Named, because the bare read threw `ENOENT` at an absolute path — which says a file is
  // missing and not that this checkout declares no elmdb pin
  if (!fs.existsSync(revFile)) {
    throw new Error(`${root} declares no elmdb pin: vendor/elmdb.rev is missing`);
  }
  const rev = fs.readFileSync(revFile, 'utf8').trim();
  const binding = path.join(checkout, 'crates', 'elmdb-node');
  const manifest = path.join(binding, 'package.json');
  if (!fs.existsSync(manifest) || JSON.parse(fs.readFileSync(manifest, 'utf8')).name !== 'elmdb') {
    throw new Error(`${checkout} isn't an elmdb checkout (no crates/elmdb-node/package.json naming elmdb). Clone github.com/spankyed/elmdb there, or set ELMDB_DIR`);
  }
  try {
    execFileSync('git', ['-C', checkout, 'merge-base', '--is-ancestor', rev, 'HEAD'], { stdio: 'ignore' });
  } catch {
    throw new Error(`The elmdb checkout at ${checkout} doesn't hold the pinned commit ${rev} (vendor/elmdb.rev) in its history: fetch and check out a commit that does`);
  }
  if (!fs.existsSync(path.join(checkout, 'packages', 'ears', 'scripts', 'dist-current.mjs'))) {
    throw new Error(`${checkout} holds no EARS (packages/ears/scripts/dist-current.mjs), though it holds the pin: check out a commit that does`);
  }
  if (!fs.readdirSync(binding).some((file) => file.endsWith('.node'))) {
    throw new Error(`elmdb's binding isn't built in ${binding}: run npm ci && npm run build there (Rust from rustup, the version rust-toolchain.toml pins)`);
  }
  assertWorkspaceBinding(checkout);
  const stale = earsStaleness(checkout);
  if (stale !== undefined) buildEars(checkout);
  const link = path.join(root, 'vendor', 'elmdb');
  const held = fs.lstatSync(link, { throwIfNoEntry: false });
  if (held?.isSymbolicLink()) fs.unlinkSync(link);
  else if (held) throw new Error(`${link} is a ${held.isDirectory() ? 'directory' : 'file'}, not the link to an elmdb checkout: move it away first`);
  // A junction on Windows, which needs neither elevation nor Developer Mode as a directory symlink does; Node reads
  // either as a symbolic link, so the replacement above holds for both
  fs.symlinkSync(checkout, link, process.platform === 'win32' ? 'junction' : 'dir');
  // A build of a package with changes not committed is never current, since no tree id names what it built: it is
  // built and used, and said, as a checkout past its pin is (`lib/vendor-pin.mjs`)
  const after = stale === undefined ? undefined : earsStaleness(checkout);
  /** @type {string[]} */
  const warnings = after === undefined ? [] : [`EARS' dist in ${checkout} was built, and still isn't current: ${after}`];
  // Reported rather than refused, and after the link is in place: what they describe costs a CI run or a
  // local one testing the wrong code, never this command (`lib/vendor-pin.mjs`)
  warnings.push(...pinWarnings({ name: 'elmdb', rev, checkout, run: gitIn(checkout), packages: ELMDB_PACKAGES }));
  return { link, checkout, rev, rebuilt: stale !== undefined, warnings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const { link, checkout, rev, rebuilt, warnings } = linkElmdb(root);
    console.log(`${path.relative(root, link)} → ${checkout} (pinned ${rev.slice(0, 12)})${rebuilt ? ", EARS' dist rebuilt" : ''}`);
    for (const warning of warnings) console.warn(`\n! ${warning}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
