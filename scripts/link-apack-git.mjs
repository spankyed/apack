// The link to the apack-git checkout the built-in pack's git engine comes from: `vendor/apack-git`, a
// gitignored symlink, beside the commit it is pinned to, `vendor/apack-git.rev`. Arranged as
// `link-apack-terminal.mjs` is, and plain Node with no dependencies for the same reason: it runs before
// anything is installed. The checkout is `APACK_GIT_DIR`, or `~/Develop/Projects/apack/apack-git`.
//
// **npm resolves through this link** to the one npm package in that checkout: the built-in pack depends on
// `apack-git` at `file:../../vendor/apack-git`, the engine that runs git for the code feature and keeps the
// picture of a working tree.
//
// **What the package's entries name is built, so this builds it.** The engine is TypeScript and what a
// consumer bundles is its `dist/`, which is not tracked: a pack build resolving a link to a checkout that had
// never been built would fail on a path, in another package's output. The build is a few seconds and
// reproducible, so rather than refuse and name the command, this runs it whenever `dist/` is missing or older
// than what it is built from.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitIn, pinWarnings } from './lib/vendor-pin.mjs';

/** The apack-git checkout the link points at @param {NodeJS.ProcessEnv} [env] */
export function apackGitCheckout(env = process.env) {
  return path.resolve(env.APACK_GIT_DIR ?? path.join(os.homedir(), 'Develop', 'Projects', 'apack', 'apack-git'));
}

/** The newest modification time among the engine's sources and the files that decide how they build @param {string} checkout */
function newestSource(checkout) {
  let newest = 0;
  const visit = (/** @type {string} */ entry) => {
    const stat = fs.statSync(entry);
    if (!stat.isDirectory()) {
      newest = Math.max(newest, stat.mtimeMs);
      return;
    }
    for (const name of fs.readdirSync(entry)) visit(path.join(entry, name));
  };
  for (const name of ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']) {
    const entry = path.join(checkout, name);
    if (fs.existsSync(entry)) visit(entry);
  }
  return newest;
}

/**
 * Whether the engine's `dist/` is what its sources now build, by modification time. Exported so a caller can
 * say why it is about to build @param {string} checkout
 */
export function engineIsBuilt(checkout) {
  const entries = ['index.js', 'index.d.ts', 'staging.js', 'staging.d.ts'].map((file) => fs.statSync(path.join(checkout, 'dist', file), { throwIfNoEntry: false }));
  return entries.every((entry) => entry !== undefined) && Math.min(...entries.map((entry) => /** @type {fs.Stats} */ (entry).mtimeMs)) >= newestSource(checkout);
}

/** Installs the engine's own tools if it has none, and builds its `dist/` @param {string} checkout */
function buildEngine(checkout) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const run = (/** @type {string[]} */ args) => execFileSync(npm, args, { cwd: checkout, stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });
  if (!fs.existsSync(path.join(checkout, 'node_modules'))) run(['ci', '--no-audit', '--no-fund']);
  run(['run', 'build']);
}

/**
 * Points `<root>/vendor/apack-git` at the checkout, refusing one that isn't an apack-git checkout or that
 * doesn't hold the pinned commit in its history, and builds the engine when what it ships is not what its
 * sources build. A link already there is replaced
 * @param {string} root @param {string} [checkout]
 */
export function linkApackGit(root, checkout = apackGitCheckout()) {
  const revFile = path.join(root, 'vendor', 'apack-git.rev');
  if (!fs.existsSync(revFile)) {
    throw new Error(`${root} declares no apack-git pin: vendor/apack-git.rev is missing`);
  }
  const rev = fs.readFileSync(revFile, 'utf8').trim();
  let name;
  try { name = JSON.parse(fs.readFileSync(path.join(checkout, 'package.json'), 'utf8')).name; } catch { name = undefined; }
  if (name !== 'apack-git') {
    throw new Error(`${checkout} isn't an apack-git checkout (no package.json naming apack-git). Clone it there, or set APACK_GIT_DIR`);
  }
  try {
    execFileSync('git', ['-C', checkout, 'merge-base', '--is-ancestor', rev, 'HEAD'], { stdio: 'ignore' });
  } catch {
    throw new Error(`The apack-git checkout at ${checkout} doesn't hold the pinned commit ${rev} (vendor/apack-git.rev) in its history: fetch and check out a commit that does`);
  }
  const built = engineIsBuilt(checkout);
  if (!built) buildEngine(checkout);
  const link = path.join(root, 'vendor', 'apack-git');
  const held = fs.lstatSync(link, { throwIfNoEntry: false });
  if (held?.isSymbolicLink()) fs.unlinkSync(link);
  else if (held) throw new Error(`${link} is a ${held.isDirectory() ? 'directory' : 'file'}, not the link to an apack-git checkout: move it away first`);
  // A junction on Windows, as the other two are: neither elevation nor Developer Mode, and Node reads either as a link
  fs.symlinkSync(checkout, link, process.platform === 'win32' ? 'junction' : 'dir');
  // Reported rather than refused, and after the link is in place: what they describe costs a CI run or a
  // local one testing the wrong code, never this command (`lib/vendor-pin.mjs`)
  return { link, checkout, rev, rebuilt: !built, warnings: pinWarnings({ name: 'apack-git', rev, checkout, run: gitIn(checkout) }) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const { link, checkout, rev, rebuilt, warnings } = linkApackGit(root);
    console.log(`${path.relative(root, link)} → ${checkout} (pinned ${rev.slice(0, 12)})${rebuilt ? ', engine built' : ''}`);
    for (const warning of warnings) console.warn(`\n! ${warning}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
