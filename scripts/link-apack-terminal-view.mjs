// The link to the apack-terminal-view checkout a window's terminals are drawn with: `vendor/apack-terminal-view`,
// a gitignored symlink, beside the commit it is pinned to, `vendor/apack-terminal-view.rev`. Arranged as
// `link-apack-terminal.mjs` is, and plain Node with no dependencies for the same reason: it runs before
// anything is installed. The checkout is `APACK_TERMINAL_VIEW_DIR`, or
// `~/Develop/Projects/apack/apack-terminal-view`.
//
// **npm resolves through this link**: the built-in pack depends on `apack-terminal-view` at
// `file:../../vendor/apack-terminal-view`, the checkout itself, which is one npm package.
//
// **What the package's entry names is built, so this builds it.** The checkout is TypeScript and what a
// consumer bundles is its `dist/`, which is not tracked — a pack build resolving a link to a checkout that
// had never been built would fail on a path, in another package's output. The build is a second or two and
// reproducible, so rather than refuse and name the command, this runs it whenever `dist/` is missing or
// older than what it is built from.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitIn, pinWarnings } from './lib/vendor-pin.mjs';

/** The apack-terminal-view checkout the link points at @param {NodeJS.ProcessEnv} [env] */
export function apackTerminalViewCheckout(env = process.env) {
  return path.resolve(env.APACK_TERMINAL_VIEW_DIR ?? path.join(os.homedir(), 'Develop', 'Projects', 'apack', 'apack-terminal-view'));
}

/** The newest modification time among a checkout's sources and the files that decide how they build @param {string} checkout */
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
  for (const name of ['src', 'package.json', 'package-lock.json', 'tsconfig.build.json', 'vite.config.ts']) {
    const entry = path.join(checkout, name);
    if (fs.existsSync(entry)) visit(entry);
  }
  return newest;
}

/**
 * Whether the checkout's `dist/` is what its sources now build, by modification time. Exported so a caller
 * can say why it is about to build @param {string} checkout
 */
export function viewIsBuilt(checkout) {
  const built = fs.statSync(path.join(checkout, 'dist', 'index.js'), { throwIfNoEntry: false });
  const declared = fs.statSync(path.join(checkout, 'dist', 'index.d.ts'), { throwIfNoEntry: false });
  return built !== undefined && declared !== undefined && Math.min(built.mtimeMs, declared.mtimeMs) >= newestSource(checkout);
}

/** Installs the checkout's own tools if it has none, and builds its `dist/` @param {string} checkout */
function build(checkout) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const run = (/** @type {string[]} */ args) => execFileSync(npm, args, { cwd: checkout, stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });
  if (!fs.existsSync(path.join(checkout, 'node_modules'))) run(['ci', '--no-audit', '--no-fund']);
  run(['run', 'build']);
}

/**
 * Points `<root>/vendor/apack-terminal-view` at the checkout, refusing one that isn't an apack-terminal-view
 * checkout or that doesn't hold the pinned commit in its history, and builds it when what it ships is not
 * what its sources build. A link already there is replaced
 * @param {string} root @param {string} [checkout]
 */
export function linkApackTerminalView(root, checkout = apackTerminalViewCheckout()) {
  const revFile = path.join(root, 'vendor', 'apack-terminal-view.rev');
  if (!fs.existsSync(revFile)) {
    throw new Error(`${root} declares no apack-terminal-view pin: vendor/apack-terminal-view.rev is missing`);
  }
  const rev = fs.readFileSync(revFile, 'utf8').trim();
  const manifest = path.join(checkout, 'package.json');
  let name;
  try { name = JSON.parse(fs.readFileSync(manifest, 'utf8')).name; } catch { name = undefined; }
  if (name !== 'apack-terminal-view') {
    throw new Error(`${checkout} isn't an apack-terminal-view checkout (no package.json naming apack-terminal-view). Clone it there, or set APACK_TERMINAL_VIEW_DIR`);
  }
  try {
    execFileSync('git', ['-C', checkout, 'merge-base', '--is-ancestor', rev, 'HEAD'], { stdio: 'ignore' });
  } catch {
    throw new Error(`The apack-terminal-view checkout at ${checkout} doesn't hold the pinned commit ${rev} (vendor/apack-terminal-view.rev) in its history: fetch and check out a commit that does`);
  }
  const built = viewIsBuilt(checkout);
  if (!built) build(checkout);
  const link = path.join(root, 'vendor', 'apack-terminal-view');
  const held = fs.lstatSync(link, { throwIfNoEntry: false });
  if (held?.isSymbolicLink()) fs.unlinkSync(link);
  else if (held) throw new Error(`${link} is a ${held.isDirectory() ? 'directory' : 'file'}, not the link to an apack-terminal-view checkout: move it away first`);
  fs.symlinkSync(checkout, link, process.platform === 'win32' ? 'junction' : 'dir');
  return { link, checkout, rev, rebuilt: !built, warnings: pinWarnings({ name: 'apack-terminal-view', rev, checkout, run: gitIn(checkout) }) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const { link, checkout, rev, rebuilt, warnings } = linkApackTerminalView(root);
    console.log(`${path.relative(root, link)} → ${checkout} (pinned ${rev.slice(0, 12)})${rebuilt ? ', built' : ''}`);
    for (const warning of warnings) console.warn(`\n! ${warning}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
