// Whether what this checkout has installed is what it pins, asked before the chain runs anything.
//
// **Both answers are cheap, and both questions are otherwise answered by a step failing late for a reason it does
// not name.** A run over an install that does not match its pins spends the whole chain on a result that cannot
// pass: a terminal broker the lockfile moved past fails every terminal case in `test:e2e` as `terminal.ERROR`, and a
// package left at an older version fails whichever spec happens to reach the behaviour that changed. So these refuse
// up front, naming what is stale and the command that fixes it.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SINGLE_COPY_PACKAGES, extraCopies } from '../../build/prod/single-copy.mjs';
import { missingBroker } from './broker-installed.mjs';

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

/**
 * Whether the install holds more than one copy of a package the app loads once (`SINGLE_COPY_PACKAGES`: EARS and
 * `elmdb`), read from npm's record of the install like `lockfileDrift`. A link and the directory it points at are one
 * copy; two directories, or links to two, are two. The lockfile can pin two, and an install matching it is still
 * refused: one copy is what the app needs, not what the lockfile says.
 *
 * Answers the refusals, none when each has one copy (or the install has no record, which `lockfileDrift` refuses).
 */
export function duplicateCopies(repoRoot: string): string[] {
  const hidden = path.join(repoRoot, 'node_modules', '.package-lock.json');
  if (!fs.existsSync(hidden)) return [];
  const marker = 'node_modules/';
  const copies = Object.entries(packagesOf(hidden)).flatMap(([key, entry]) => {
    const name = key.slice(key.lastIndexOf(marker) + marker.length);
    if (!key.includes(marker) || !SINGLE_COPY_PACKAGES.includes(name)) return [];
    return [{ name, copy: entry.link ? entry.resolved ?? key : key, where: key }];
  });
  return extraCopies(copies).map((refusal) => `node_modules holds a package twice — ${refusal}`);
}

/** Every refusal this checkout's install earns: empty when it holds what it pins */
export function installRefusals(repoRoot: string): string[] {
  // The broker only once the install matches, since a stale or absent install is its own refusal and may hold no broker
  const drift = lockfileDrift(repoRoot);
  return [drift, ...duplicateCopies(repoRoot), drift === undefined ? missingBroker(repoRoot) : undefined]
    .filter((line) => line !== undefined);
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
