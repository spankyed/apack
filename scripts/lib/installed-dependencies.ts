// Whether what this checkout has installed is what it pins, asked before the chain runs anything.
//
// **Both answers are cheap, and both questions are otherwise answered by a step failing late for a reason it does
// not name.** A run over an install that does not match its pins spends the whole chain on a result that cannot
// pass: a broker the pin moved past fails every terminal case in `test:e2e` as `terminal.ERROR`, and a package
// left at an older version fails whichever spec happens to reach the behaviour that changed. So these refuse up
// front, naming what is stale and the command that fixes it.
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

/** One entry of a lockfile's `packages`: only the fields that say which bytes are installed, and whether it may be absent */
interface LockedPackage {
  version?: string;
  resolved?: string;
  integrity?: string;
  link?: boolean;
  optional?: boolean;
  devOptional?: boolean;
}

/** How many names a refusal lists before it counts the rest */
const LISTED = 5;

/**
 * Whether `node_modules` holds what `package-lock.json` pins, read from what npm itself records of the install.
 *
 * **npm writes the tree it installed to `node_modules/.package-lock.json`**, its hidden lockfile, in the same
 * shape as the committed one. So the comparison is two JSON reads and a walk over keys, not a walk over every
 * package directory: an entry whose version, tarball or integrity differs, one the lockfile pins that was never
 * installed, and one installed that the lockfile no longer has. An `optional` or `devOptional` entry the install
 * left out is a platform's package for another platform (`@esbuild/linux-x64` on a Mac), which npm skips by
 * design, so its absence is not staleness.
 *
 * Answers `undefined` when they match, and otherwise the refusal.
 */
export function lockfileDrift(repoRoot: string): string | undefined {
  const fix = 'run `npm ci` (move node_modules aside first, rather than letting npm delete it in place)';
  const hidden = path.join(repoRoot, 'node_modules', '.package-lock.json');
  if (!fs.existsSync(hidden)) {
    return fs.existsSync(path.join(repoRoot, 'node_modules'))
      ? `node_modules has no record of what npm installed (node_modules/.package-lock.json) — ${fix}`
      : `nothing is installed (no node_modules) — ${fix}`;
  }
  const locked = packagesOf(path.join(repoRoot, 'package-lock.json'));
  const installed = packagesOf(hidden);
  const differs: string[] = [];
  const missing: string[] = [];
  for (const [key, want] of Object.entries(locked)) {
    if (key === '') continue;
    const have = installed[key];
    if (have === undefined) {
      if (!want.optional && !want.devOptional) missing.push(key);
      continue;
    }
    if (have.version !== want.version || have.resolved !== want.resolved || have.integrity !== want.integrity
      || Boolean(have.link) !== Boolean(want.link)) {
      differs.push(`${key} ${have.version ?? '(link)'} where the lockfile has ${want.version ?? '(link)'}`);
    }
  }
  const extraneous = Object.keys(installed).filter((key) => key !== '' && !(key in locked));
  if (differs.length + missing.length + extraneous.length === 0) return undefined;
  const parts = [
    listed('installed at another version', differs),
    listed('in the lockfile and not installed', missing),
    listed('installed and not in the lockfile', extraneous),
  ].filter((part) => part !== '');
  return `node_modules does not match package-lock.json — ${fix}:\n    ${parts.join('\n    ')}`;
}

/** The terminal broker package's directory in a checkout */
export const brokerPackageDir = (repoRoot: string): string => path.join(repoRoot, 'packages', 'terminal-broker');

/**
 * Whether the terminal broker the pin names is installed for this platform, asked of `@app/terminal-broker` itself.
 *
 * **Its own answer, not a second reading of `pin.json`**: `brokerBinary()` is what the app, the CLI and the tests
 * resolve the broker with, and it answers absence when the pin moved without an install. A platform the pin has
 * no files for has nothing an install could fetch, so that is not refused here.
 *
 * Answers `undefined` when it is installed, and otherwise the refusal.
 */
export function brokerDrift(packageDir: string): string | undefined {
  const broker = createRequire(path.join(packageDir, 'package.json'))(path.join(packageDir, 'src', 'index.js')) as {
    PLATFORM: string;
    brokerBinary(): string | undefined;
    brokerBinaryPath(): string;
    commit: string;
  };
  const pin = JSON.parse(fs.readFileSync(path.join(packageDir, 'src', 'pin.json'), 'utf8')) as { files: Record<string, unknown> };
  if (pin.files[broker.PLATFORM] === undefined || broker.brokerBinary() !== undefined) return undefined;
  return `the terminal broker pinned at apack-terminal ${broker.commit.slice(0, 7)} is not installed for ${broker.PLATFORM}`
    + ` (looked for ${path.relative(process.cwd(), broker.brokerBinaryPath())}) — run \`npm run fetch:terminal-broker\``;
}

/** Every refusal this checkout's install earns: empty when it holds what it pins */
export function installRefusals(repoRoot: string): string[] {
  return [lockfileDrift(repoRoot), brokerDrift(brokerPackageDir(repoRoot))].filter((line) => line !== undefined);
}

function packagesOf(file: string): Record<string, LockedPackage> {
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as { packages?: Record<string, LockedPackage> }).packages ?? {};
}

function listed(what: string, keys: readonly string[]): string {
  if (keys.length === 0) return '';
  const names = keys.slice(0, LISTED).map((key) => key.replace(/^node_modules\//, ''));
  const more = keys.length > LISTED ? `, and ${keys.length - LISTED} more` : '';
  return `${keys.length} ${what}: ${names.join(', ')}${more}`;
}
