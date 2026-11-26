// The packages apack takes from its other repositories, and where each repository's CI publishes them: every commit
// on its default branch packs them and attaches the tarballs to a GitHub release tagged `<tag>-<commit>`. The root
// `package.json`'s `overrides` name each tarball by URL, which `npm run deps:pin` writes from this table, and the
// lockfile holds each one's integrity. A workspace manifest names them by version alone, as it would a registry
// package (`workspace-manifests.spec.ts`).
//
// Plain Node, importing nothing outside `node:`: `deps.mjs` runs it before anything is installed, and the janitor
// runs under launchd with no npm.
import { existsSync, lstatSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';

/**
 * @typedef {{ file: string, dir: string }} ExternalPackage
 *   `file` is the tarball's name in the release; `dir` is the package's directory in a checkout of its repository,
 *   which `npm run deps:local` points the override at
 * @typedef {{ tag: string, packages: Record<string, ExternalPackage> }} ExternalRepository
 */

/** The GitHub owner of every repository below */
export const OWNER = 'spankyed';

/** @type {Record<string, ExternalRepository>} */
export const REPOSITORIES = {
  elmdb: {
    tag: 'pkg',
    packages: {
      elmdb: { file: 'elmdb-0.1.0.tgz', dir: 'crates/elmdb-node' },
      '@elmdb/ears': { file: 'elmdb-ears-0.1.0.tgz', dir: 'packages/ears' },
    },
  },
  'apack-clock': {
    tag: 'pkg',
    packages: {
      '@apackdev/clock': { file: 'apackdev-clock-0.1.0.tgz', dir: '.' },
    },
  },
  'apack-git': {
    tag: 'pkg',
    packages: {
      '@apackdev/git': { file: 'apackdev-git-0.1.0.tgz', dir: '.' },
    },
  },
  'apack-link': {
    tag: 'pkg',
    packages: {
      '@apackdev/link': { file: 'apackdev-link-0.1.0.tgz', dir: '.' },
    },
  },
  'apack-orderings': {
    tag: 'pkg',
    packages: {
      '@apackdev/orderings': { file: 'apackdev-orderings-0.1.0.tgz', dir: '.' },
    },
  },
  'apack-state': {
    tag: 'pkg',
    packages: {
      '@apackdev/state': { file: 'apackdev-state-0.1.0.tgz', dir: '.' },
    },
  },
  // The broker's binary is in a platform package per target, `@apackdev/terminal-<platform>`, which
  // `@apackdev/terminal` names as optional dependencies by URL, so npm installs the one this machine runs
  'apack-terminal': {
    tag: 'bin',
    packages: {
      '@apackdev/terminal': { file: 'apackdev-terminal-0.1.0.tgz', dir: 'node' },
      '@apackdev/terminal-view': { file: 'apackdev-terminal-view-0.1.0.tgz', dir: 'view' },
    },
  },
};

/** The URL of a package's tarball in the release of `commit` @param {string} repo @param {string} commit @param {string} name */
export function releaseUrl(repo, commit, name) {
  const { tag, packages } = REPOSITORIES[repo];
  return `https://github.com/${OWNER}/${repo}/releases/download/${tag}-${commit}/${packages[name].file}`;
}

/**
 * The repository and commit a release URL names, or `undefined` for anything else (a `file:` spec, a registry
 * version) @param {string} spec @returns {{ repo: string, commit: string } | undefined}
 */
export function releaseOf(spec) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/[a-z]+-([0-9a-f]{40})\//.exec(spec);
  return match && match[1] === OWNER && match[2] in REPOSITORIES ? { repo: match[2], commit: match[3] } : undefined;
}

/** The repository that publishes `name`, or `undefined` @param {string} name */
export function repositoryOf(name) {
  return Object.keys(REPOSITORIES).find((repo) => name in REPOSITORIES[repo].packages);
}

/** @param {string} root @returns {string[]} */
function workspaceNodeModulesDirs(root) {
  const packagesDir = path.join(root, 'packages');
  if (!existsSync(packagesDir)) return [];
  /** @type {string[]} */
  const dirs = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nodeModules = path.join(packagesDir, entry.name, 'node_modules');
    if (existsSync(nodeModules)) dirs.push(nodeModules);
  }
  return dirs;
}

/** @param {string} target @returns {import('node:fs').Stats | undefined} */
function lstatOrUndefined(target) {
  try {
    return lstatSync(target);
  } catch {
    return undefined;
  }
}

/** @param {string} target @returns {string | undefined} */
function realpathOrUndefined(target) {
  try {
    return realpathSync(target);
  } catch {
    return undefined;
  }
}

/** @param {string} root @param {string} nodeModules @param {string} name @param {boolean} onlySymlinks @returns {string | undefined} */
function removePackageEntry(root, nodeModules, name, onlySymlinks) {
  const segments = name.split('/');
  const target = path.join(nodeModules, ...segments);
  const stat = lstatOrUndefined(target);
  if (stat === undefined || (onlySymlinks && !stat.isSymbolicLink())) return undefined;
  rmSync(target, { recursive: true, force: true });
  // Remove now-empty @scope folder so stale empty scope directories do not linger
  if (segments.length === 2) {
    const scopeDir = path.join(nodeModules, segments[0]);
    try {
      if (readdirSync(scopeDir).length === 0) rmSync(scopeDir, { recursive: true, force: true });
    } catch {
      // Scope directory already gone
    }
  }
  return path.relative(root, target).split(path.sep).join('/');
}

/**
 * Removes stale nested workspace `packages/<ws>/node_modules/<pkg>` copies/symlinks and stale root `node_modules/<pkg>`
 * symlinks for `packageNames` before reinstalling after an override switch (`deps:local` <-> `deps:pin` /
 * `deps:released`), so npm hoists a single clean copy into root `node_modules` without wiping a working real root
 * directory if `npm install` fails.
 *
 * @param {string} root
 * @param {readonly string[]} packageNames
 * @returns {string[]} paths removed, relative to `root`
 */
export function pruneNestedOverrides(root, packageNames) {
  /** @type {string[]} */
  const removed = [];
  const rootNodeModules = path.join(root, 'node_modules');
  if (existsSync(rootNodeModules)) {
    for (const name of packageNames) {
      const rel = removePackageEntry(root, rootNodeModules, name, true);
      if (rel !== undefined) removed.push(rel);
    }
  }
  for (const nodeModules of workspaceNodeModulesDirs(root)) {
    for (const name of packageNames) {
      const rel = removePackageEntry(root, nodeModules, name, false);
      if (rel !== undefined) removed.push(rel);
    }
  }
  return removed;
}

/**
 * Verifies every switched override in `specs` after `npm install`:
 * - present in root `node_modules` with a readable `package.json`,
 * - installed with the right kind (`file:` -> symlink resolving to the requested directory; release URL -> real
 *   directory, not a leftover symlink), and
 * - no duplicate nested copy under `packages/<ws>/node_modules/<pkg>` (nested symlinks resolving to the same
 *   `realpath` as root are allowed, since npm can link both root and a workspace to the same `file:` checkout).
 *
 * @param {string} root
 * @param {Readonly<Record<string, string>>} specs
 * @returns {string[]} human-readable problems; empty when clean
 */
export function verifyHoistedOverrides(root, specs) {
  /** @type {string[]} */
  const problems = [];
  const nestedDirs = workspaceNodeModulesDirs(root);
  for (const [name, spec] of Object.entries(specs)) {
    const segments = name.split('/');
    const rootTarget = path.join(root, 'node_modules', ...segments);
    /** @type {string | undefined} */
    let rootReal;
    if (!existsSync(path.join(rootTarget, 'package.json'))) {
      problems.push(`${name}: missing from root node_modules (no package.json)`);
    } else {
      const isLink = lstatSync(rootTarget).isSymbolicLink();
      rootReal = realpathOrUndefined(rootTarget);
      if (spec.startsWith('file:')) {
        if (!isLink) {
          problems.push(`${name}: expected symlink to ${spec} in root node_modules, found a real directory`);
        } else {
          const expectedPath = path.resolve(root, spec.slice('file:'.length));
          const expectedReal = realpathOrUndefined(expectedPath) ?? expectedPath;
          if (rootReal !== expectedReal) {
            problems.push(`${name}: root node_modules symlink resolves to ${rootReal ?? rootTarget}, expected ${expectedReal}`);
          }
        }
      } else if (isLink) {
        problems.push(`${name}: expected installed package in root node_modules for ${spec}, found a symlink`);
      }
    }
    for (const nodeModules of nestedDirs) {
      const nestedTarget = path.join(nodeModules, ...segments);
      const nestedStat = lstatOrUndefined(nestedTarget);
      if (nestedStat === undefined) continue;
      if (nestedStat.isSymbolicLink() && rootReal !== undefined && realpathOrUndefined(nestedTarget) === rootReal) {
        continue;
      }
      problems.push(`${name}: duplicate nested install at ${path.relative(root, nestedTarget).split(path.sep).join('/')}`);
    }
  }
  return problems;
}
