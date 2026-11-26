#!/usr/bin/env node
// Where the packages apack takes from its other repositories come from, chosen in one place: the root
// `package.json`'s `overrides` (`lib/external-packages.mjs` has the table). Each command rewrites the overrides of
// one repository's packages and runs `npm install`, which records what it installed in the lockfile.
//
//   npm run deps:pin -- <repo> <commit>    each package's tarball from the release CI made of that commit
//   npm run deps:local -- <repo> [path]    each package's directory in a local checkout (default: the sibling
//                                          checkout named for the repository), which must be built
//   npm run deps:released [-- <repo>]      the release URLs this checkout's HEAD commits, undoing deps:local
//
// A local checkout is for working across repositories and is never committed: the overrides it writes are `file:`
// specs, which CI cannot resolve.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPOSITORIES, pruneNestedOverrides, releaseOf, releaseUrl, verifyHoistedOverrides } from './lib/external-packages.mjs';
import { primaryWorktree } from './lib/worktrees.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const MANIFEST = path.join(ROOT, 'package.json');

/** @param {string} message @returns {never} */
function refuse(message) {
  console.error(message);
  process.exit(1);
}

/** @param {string | undefined} repo @returns {string} */
function repository(repo) {
  if (repo === undefined || !(repo in REPOSITORIES)) refuse(`Name a repository: ${Object.keys(REPOSITORIES).join(', ')}.`);
  return /** @type {string} */ (repo);
}

/**
 * Rewrites the overrides named in `specs`, line by line, so the rest of the manifest keeps its bytes (its scripts
 * hold escapes `JSON.stringify` would not write back) @param {Record<string, string>} specs
 */
function writeOverrides(specs) {
  let text = readFileSync(MANIFEST, 'utf8');
  const start = text.indexOf('\n  "overrides": {');
  const end = text.indexOf('\n  }', start);
  if (start < 0 || end < 0) refuse('package.json has no "overrides" object.');
  let block = text.slice(start, end);
  for (const [name, spec] of Object.entries(specs)) {
    const line = new RegExp(`^(    ${JSON.stringify(name).replace(/[/]/g, '\\/')}: )"[^"]*"`, 'm');
    if (!line.test(block)) refuse(`package.json's overrides have no entry for ${name}.`);
    block = block.replace(line, `$1${JSON.stringify(spec)}`);
  }
  text = text.slice(0, start) + block + text.slice(end);
  writeFileSync(MANIFEST, text);
}

/**
 * The oldest npm that applies a changed override to a locked package: measured 2026-11-21, npm 11.13.0 kept the old
 * source, and once the entry was gone asked the registry for the version instead; 11.21.1, the version CI pins, installs
 * what the override names
 */
const NPM_FLOOR = [11, 21, 1];

/** @param {Readonly<Record<string, string>>} switchedSpecs */
function install(switchedSpecs) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const version = spawnSync(npmCommand, ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' }).stdout.trim();
  const parts = version.split('.').map(Number);
  const older = NPM_FLOOR.findIndex((floor, at) => parts[at] !== floor);
  if (older >= 0 && parts[older] < NPM_FLOOR[older]) {
    refuse(`npm ${version} does not apply a changed override to a locked package; this needs npm ${NPM_FLOOR.join('.')} or later `
      + `(npm install -g npm@${NPM_FLOOR.join('.')}). package.json is rewritten: run npm install with it.`);
  }
  const pruned = pruneNestedOverrides(ROOT, Object.keys(switchedSpecs));
  if (pruned.length > 0) console.log(`Removed ${pruned.length} stale override path(s): ${pruned.join(', ')}`);
  const npm = spawnSync(npmCommand, ['install', '--no-audit', '--no-fund'], {
    cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32',
  });
  if ((npm.status ?? 1) !== 0) process.exit(npm.status ?? 1);
  const problems = verifyHoistedOverrides(ROOT, switchedSpecs);
  if (problems.length > 0) {
    refuse(`Override install verification failed:\n  - ${problems.join('\n  - ')}\n`
      + 'Check that the target checkout is built or re-run `npm install` after cleaning node_modules.');
  }
  process.exit(0);
}

/** @param {string} repo @param {string | undefined} commit @returns {Record<string, string>} */
function pin(repo, commit) {
  if (commit === undefined || !/^[0-9a-f]{40}$/.test(commit)) refuse('Name the commit by its full 40-character hash.');
  const specs = Object.fromEntries(Object.keys(REPOSITORIES[repo].packages).map((name) => [name, releaseUrl(repo, commit, name)]));
  writeOverrides(specs);
  console.log(`${repo}: the release of ${commit}`);
  return specs;
}

/** @param {string} repo @param {string | undefined} given @returns {Record<string, string>} */
function local(repo, given) {
  const checkout = path.resolve(given ?? path.join(path.dirname(primaryWorktree(ROOT)), repo));
  const specs = Object.fromEntries(Object.entries(REPOSITORIES[repo].packages).map(([name, { dir }]) => {
    const packageDir = path.join(checkout, dir);
    if (!existsSync(path.join(packageDir, 'package.json'))) refuse(`${packageDir} holds no package.json: is ${checkout} a checkout of ${repo}?`);
    return [name, `file:${path.relative(ROOT, packageDir).split(path.sep).join('/')}`];
  }));
  writeOverrides(specs);
  console.log(`${repo}: the checkout at ${checkout}, which has to be built (npm run deps:released undoes this)`);
  return specs;
}

/** @param {string[]} repos @returns {Record<string, string>} */
function released(repos) {
  const committed = /** @type {{ overrides?: Record<string, string> }} */ (
    JSON.parse(execFileSync('git', ['show', 'HEAD:package.json'], { cwd: ROOT, encoding: 'utf8' }))).overrides ?? {};
  /** @type {Record<string, string>} */
  const specs = {};
  for (const repo of repos) {
    for (const name of Object.keys(REPOSITORIES[repo].packages)) {
      const spec = committed[name];
      if (spec === undefined || releaseOf(spec)?.repo !== repo) refuse(`HEAD's package.json does not name a release of ${repo} for ${name}: ${spec}`);
      specs[name] = spec;
    }
  }
  writeOverrides(specs);
  console.log(`${repos.join(', ')}: the releases HEAD names`);
  return specs;
}

const [command, repo, argument] = process.argv.slice(2);
/** @type {Record<string, string>} */
let switched;
if (command === 'pin') switched = pin(repository(repo), argument);
else if (command === 'local') switched = local(repository(repo), argument);
else if (command === 'released') switched = released(repo === undefined ? Object.keys(REPOSITORIES) : [repository(repo)]);
else refuse('Usage: node scripts/deps.mjs <pin <repo> <commit> | local <repo> [path] | released [repo]>');
install(switched);
