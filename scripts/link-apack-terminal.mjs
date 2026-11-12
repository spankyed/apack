// The link to the apack-terminal checkout the broker is built from: `vendor/apack-terminal`, a gitignored
// symlink, beside the commit it is pinned to, `vendor/apack-terminal.rev`. Arranged as `link-elmdb.mjs` is, and
// plain Node with no dependencies for the same reason: it runs before anything is installed. The checkout is
// `APACK_TERMINAL_DIR`, or `~/Develop/Projects/apack/apack-terminal`.
//
// **npm resolves through this link**, as it does through elmdb's, to the two npm packages in that checkout:
// `@apackdev/host` and the API depend on `apack-terminal` at `file:../../vendor/apack-terminal/node`, the
// broker, and the built-in pack on `apack-terminal-view` at `file:../../vendor/apack-terminal/view`, what a
// window draws a terminal with. One checkout and one pin hold both, because they are the two halves of one
// protocol.
//
// Unlike elmdb's, this does not refuse a checkout whose broker has not been built — that package's
// `package.json` is tracked, so `npm ci` resolves whether or not a binary has been staged into it, and a
// missing binary is a legible refusal from `brokerBinary()` at the moment a terminal is asked for rather
// than a failure during an install. `cargo xtask package` in the checkout is what stages one.
//
// **What the view's entry names is built, so this builds it.** The view is TypeScript and what a consumer
// bundles is its `dist/`, which is not tracked — a pack build resolving a link to a checkout whose view
// had never been built would fail on a path, in another package's output. The build is a second or two and
// reproducible, so rather than refuse and name the command, this runs it whenever `dist/` is missing or
// older than what it is built from.
//
// The link also carries the toolchain derivation (`lib/vendored-checkouts.ts`) and the janitor's budget.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitIn, pinWarnings } from './lib/vendor-pin.mjs';

/** The apack-terminal checkout the link points at @param {NodeJS.ProcessEnv} [env] */
export function apackTerminalCheckout(env = process.env) {
  return path.resolve(env.APACK_TERMINAL_DIR ?? path.join(os.homedir(), 'Develop', 'Projects', 'apack', 'apack-terminal'));
}

/** The newest modification time among the view's sources and the files that decide how they build @param {string} view */
function newestSource(view) {
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
    const entry = path.join(view, name);
    if (fs.existsSync(entry)) visit(entry);
  }
  return newest;
}

/**
 * Whether the view's `dist/` is what its sources now build, by modification time. Exported so a caller
 * can say why it is about to build @param {string} view the checkout's `view/` directory
 */
export function viewIsBuilt(view) {
  const built = fs.statSync(path.join(view, 'dist', 'index.js'), { throwIfNoEntry: false });
  const declared = fs.statSync(path.join(view, 'dist', 'index.d.ts'), { throwIfNoEntry: false });
  return built !== undefined && declared !== undefined && Math.min(built.mtimeMs, declared.mtimeMs) >= newestSource(view);
}

/** Installs the view's own tools if it has none, and builds its `dist/` @param {string} view */
function buildView(view) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const run = (/** @type {string[]} */ args) => execFileSync(npm, args, { cwd: view, stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });
  if (!fs.existsSync(path.join(view, 'node_modules'))) run(['ci', '--no-audit', '--no-fund']);
  run(['run', 'build']);
}

/**
 * Points `<root>/vendor/apack-terminal` at the checkout, refusing one that isn't an apack-terminal checkout,
 * that doesn't hold the pinned commit in its history, or that holds no view, and builds the view when what
 * it ships is not what its sources build. A link already there is replaced
 * @param {string} root @param {string} [checkout]
 */
export function linkApackTerminal(root, checkout = apackTerminalCheckout()) {
  const revFile = path.join(root, 'vendor', 'apack-terminal.rev');
  // Named, because the bare read threw `ENOENT` at an absolute path — which says a file is
  // missing and not that this checkout declares no apack-terminal pin, and sent one investigation
  // looking at the linker instead of at the tree that had never had the pin.
  if (!fs.existsSync(revFile)) {
    throw new Error(`${root} declares no apack-terminal pin: vendor/apack-terminal.rev is missing`);
  }
  const rev = fs.readFileSync(revFile, 'utf8').trim();
  const manifest = path.join(checkout, 'Cargo.toml');
  if (!fs.existsSync(manifest) || !/^name\s*=\s*"apack-terminal"$/m.test(fs.readFileSync(manifest, 'utf8'))) {
    throw new Error(`${checkout} isn't an apack-terminal checkout (no Cargo.toml naming apack-terminal). Clone it there, or set APACK_TERMINAL_DIR`);
  }
  try {
    execFileSync('git', ['-C', checkout, 'merge-base', '--is-ancestor', rev, 'HEAD'], { stdio: 'ignore' });
  } catch {
    throw new Error(`The apack-terminal checkout at ${checkout} doesn't hold the pinned commit ${rev} (vendor/apack-terminal.rev) in its history: fetch and check out a commit that does`);
  }
  // The view is a package of this checkout. One from before it was has the pin in its history only if the
  // pin is that old too, so this is a checkout on a branch that has not taken the view in
  const view = path.join(checkout, 'view');
  let viewName;
  try { viewName = JSON.parse(fs.readFileSync(path.join(view, 'package.json'), 'utf8')).name; } catch { viewName = undefined; }
  if (viewName !== 'apack-terminal-view') {
    throw new Error(`The apack-terminal checkout at ${checkout} holds no view (no view/package.json naming apack-terminal-view): check out a commit that does`);
  }
  const built = viewIsBuilt(view);
  if (!built) buildView(view);
  const link = path.join(root, 'vendor', 'apack-terminal');
  const held = fs.lstatSync(link, { throwIfNoEntry: false });
  if (held?.isSymbolicLink()) fs.unlinkSync(link);
  else if (held) throw new Error(`${link} is a ${held.isDirectory() ? 'directory' : 'file'}, not the link to an apack-terminal checkout: move it away first`);
  // A junction on Windows, as elmdb's is: neither elevation nor Developer Mode, and Node reads either as a link
  fs.symlinkSync(checkout, link, process.platform === 'win32' ? 'junction' : 'dir');
  // Reported rather than refused, and after the link is in place: what they describe costs a CI run or a
  // local one testing the wrong code, never this command (`lib/vendor-pin.mjs`)
  return { link, checkout, rev, rebuilt: !built, warnings: pinWarnings({ name: 'apack-terminal', rev, checkout, run: gitIn(checkout) }) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const { link, checkout, rev, rebuilt, warnings } = linkApackTerminal(root);
    console.log(`${path.relative(root, link)} → ${checkout} (pinned ${rev.slice(0, 12)})${rebuilt ? ', view built' : ''}`);
    for (const warning of warnings) console.warn(`\n! ${warning}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
