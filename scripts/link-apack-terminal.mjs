// The link to the apack-terminal checkout the broker is built from: `vendor/apack-terminal`, a gitignored
// symlink, beside the commit it is pinned to, `vendor/apack-terminal.rev`. Arranged as `link-elmdb.mjs` is, and
// plain Node with no dependencies for the same reason: it runs before anything is installed. The checkout is
// `APACK_TERMINAL_DIR`, or `~/Develop/Projects/apack/apack-terminal`.
//
// **npm resolves through this link**, as it does through elmdb's: `@apackdev/host` and the API depend on
// `apack-terminal` at `file:../../vendor/apack-terminal/node`, the npm package in that checkout. Unlike
// elmdb's, this one does not refuse a checkout that has not been built — that package's `package.json` is
// tracked, so `npm ci` resolves whether or not a binary has been staged into it, and a missing binary is a
// legible refusal from `brokerBinary()` at the moment a terminal is asked for rather than a failure during
// an install. `cargo xtask package` in the checkout is what stages one.
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

/**
 * Points `<root>/vendor/apack-terminal` at the checkout, refusing one that isn't an apack-terminal checkout or
 * that doesn't hold the pinned commit in its history. A link already there is replaced
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
  const link = path.join(root, 'vendor', 'apack-terminal');
  const held = fs.lstatSync(link, { throwIfNoEntry: false });
  if (held?.isSymbolicLink()) fs.unlinkSync(link);
  else if (held) throw new Error(`${link} is a ${held.isDirectory() ? 'directory' : 'file'}, not the link to an apack-terminal checkout: move it away first`);
  // A junction on Windows, as elmdb's is: neither elevation nor Developer Mode, and Node reads either as a link
  fs.symlinkSync(checkout, link, process.platform === 'win32' ? 'junction' : 'dir');
  // Reported rather than refused, and after the link is in place: what they describe costs a CI run or a
  // local one testing the wrong code, never this command (`lib/vendor-pin.mjs`)
  return { link, checkout, rev, warnings: pinWarnings({ name: 'apack-terminal', rev, checkout, run: gitIn(checkout) }) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const { link, checkout, rev, warnings } = linkApackTerminal(root);
    console.log(`${path.relative(root, link)} → ${checkout} (pinned ${rev.slice(0, 12)})`);
    for (const warning of warnings) console.warn(`\n! ${warning}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
