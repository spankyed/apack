// The packages apack takes from its other repositories, and where each repository's CI publishes them: every commit
// on its default branch packs them and attaches the tarballs to a GitHub release tagged `<tag>-<commit>`. The root
// `package.json`'s `overrides` name each tarball by URL, which `npm run deps:pin` writes from this table, and the
// lockfile holds each one's integrity. A workspace manifest names them by version alone, as it would a registry
// package (`workspace-manifests.spec.ts`).
//
// Plain Node, importing nothing outside `node:`: `deps.mjs` runs it before anything is installed, and the janitor
// runs under launchd with no npm.
import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs';
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

/**
 * Removes stale nested workspace `packages/<ws>/node_modules/<pkg>` copies/symlinks and stale root `node_modules/<pkg>`
 * symlinks for `packageNames` before reinstalling after an override switch (`deps:local` <-> `deps:pin` /
 * `deps:released`), so npm hoists a single clean copy into root `node_modules` instead of leaving stale links behind.
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
      const segments = name.split('/');
      const target = path.join(rootNodeModules, ...segments);
      let isLink = false;
      try {
        isLink = lstatSync(target).isSymbolicLink();
      } catch {
        isLink = false;
      }
      if (!isLink) continue;
      rmSync(target, { recursive: true, force: true });
      removed.push(path.relative(root, target).split(path.sep).join('/'));
    }
  }
  const packagesDir = path.join(root, 'packages');
  if (!existsSync(packagesDir)) return removed;
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nodeModules = path.join(packagesDir, entry.name, 'node_modules');
    if (!existsSync(nodeModules)) continue;
    for (const name of packageNames) {
      const segments = name.split('/');
      const target = path.join(nodeModules, ...segments);
      let present = false;
      try {
        lstatSync(target);
        present = true;
      } catch {
        present = false;
      }
      if (!present) continue;
      rmSync(target, { recursive: true, force: true });
      removed.push(path.relative(root, target).split(path.sep).join('/'));
      // Remove now-empty @scope folder so stale empty scope directories do not linger
      if (segments.length === 2) {
        const scopeDir = path.join(nodeModules, segments[0]);
        try {
          if (readdirSync(scopeDir).length === 0) rmSync(scopeDir, { recursive: true, force: true });
        } catch {
          // Scope directory already gone
        }
      }
    }
  }
  return removed;
}

/**
 * Returns any package in `packageNames` missing a readable `package.json` in root `node_modules` after install (for
 * example, when a `file:` override was not hoisted, points at a missing directory, or left an empty folder).
 *
 * @param {string} root
 * @param {readonly string[]} packageNames
 * @returns {string[]}
 */
export function missingHoistedOverrides(root, packageNames) {
  return packageNames.filter((name) => !existsSync(path.join(root, 'node_modules', ...name.split('/'), 'package.json')));
}
