import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { packagesBuiltOrRefuse, REPO_ROOT } from '@apackdev/host/build/packages-built';
import { population } from '@apackdev/sdk/testing';
import { createBuildSession } from '../../../build/build-metadata.ts';
import { completeBuildFixture } from './_support/app-build.ts';
import { PACKAGE_DIRS } from '../../../scripts/lib/workspace-deps.ts';
import { PACK_WORK_DIR } from '@apackdev/host/build/pack-workdir';
import * as fileMatcher from 'app-builder-lib/out/fileMatcher.js';
import { FileMatcher } from 'app-builder-lib/out/fileMatcher.js';
import { doMergeConfigs } from 'app-builder-lib/out/util/config/config.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// What the app installs, asked of the matcher electron-builder itself builds from `electron-builder.mjs`.
//
// Nothing else looks at that file: it is named by no chain step on purpose (`chain-inputs.spec.ts`'s
// `NOT_A_CHAIN_INPUT` — it is read by `npm run build:production`, which is not one), and its patterns have gone wrong
// silently before. The exclusion of `.ts` files once stripped the CLI's scaffold templates out of the installed
// app, found by packaging the app and listing what arrived.
//
// Two things this spec does that a check on a config usually does not, both because both failed here first:
//
//   - **It names no file.** Every subject is a real tree walked at run time. The first version of this spec asked
//     about four string literals, one of which was `templates/pack/src/env.d.ts` — a path no template has been
//     since `.d.ts` templates were ruled out. The matcher answers about any string, so nothing said the probe was
//     fiction. A population that comes from the tree cannot be.
//   - **It mutates the pattern list and asserts the answer flips.** The list is data this spec already holds, so
//     a pattern can be filtered out of a copy in memory and the matcher rebuilt for microseconds. Without that,
//     "no staged file ships" passes just as well when nothing excludes them and nothing is there to ship — which
//     is how the check this replaced went green while the include it pinned was deleted.
//
// `FileMatcher` is app-builder-lib's, reached by its internal path, which an electron-builder upgrade may move.
// That fails here, loudly, naming itself — against a text comparison that cannot fail for the right reason at
// all, it is the better trade. This package declares `app-builder-lib` at electron-builder's own version rather
// than reaching it through hoisting, so the coupling is in a manifest where an upgrade has to look at it.
//
// Line comments, not a doc block: half the subject matter is glob patterns, and a `*` before a `/` ends one.

/** Skips the two cases that read build output, and refuses rather than reading a stale one */
const PACKAGES_BUILT = packagesBuiltOrRefuse('npm run packages:build (or npm test -w @app/repo-checks, which builds them)');

/** The `files` array electron-builder is given, which is also the data the mutation cases edit a copy of */
let patterns: string[];

const stage = createBuildSession({ APACK_ENV: 'production' });
completeBuildFixture(stage);
afterAll(() => { vi.unstubAllEnvs(); fs.rmSync(stage, { recursive: true, force: true }); });
beforeAll(async () => {
  vi.stubEnv('APACK_BUILD_ROOT', stage);
  // Load the same config the packaging command uses.
  const config = (await import(pathToFileURL(path.join(REPO_ROOT, 'electron-builder.mjs')).href)).default as { files: (string | object)[] };
  patterns = config.files.filter((file): file is string => typeof file === 'string');
});

/**
 * The filter electron-builder would use for a pattern list, built once per list.
 *
 * `createFilter()` compiles every pattern into a `Minimatch`, so building one per path made this file 485ms
 * where it is 69 — the populations are a couple of thousand files and each case asks about all of them. Keyed
 * by the array, which is why each case hoists its own list rather than calling `without()` in a loop.
 */
const filters = new Map<readonly string[], (file: string, stat: never) => boolean>();
function filterFor(used: string[]): (file: string, stat: never) => boolean {
  // `from` is the directory the patterns are relative to; the macro expander is identity, because none of these
  // patterns carries a macro. The filter reads nothing off a stat but whether it is a directory.
  const known = filters.get(used) ?? new FileMatcher(REPO_ROOT, 'app', (pattern) => pattern, used).createFilter();
  filters.set(used, known);
  return known;
}

/** Whether the app would carry `relative`, under the given patterns */
const shipsUnder = (used: string[], relative: string): boolean =>
  filterFor(used)(path.join(REPO_ROOT, relative), { isDirectory: () => false } as never);

const ships = (relative: string) => shipsUnder(patterns, relative);
const without = (...dropped: string[]) => patterns.filter((pattern) => !dropped.includes(pattern));

// **A dependency's files are asked of another matcher**, the one electron-builder copies `node_modules` with
// (app-builder-lib's `getNodeModuleFileMatcher`): `**/*` followed by the list's patterns, as electron-builder's
// config merge normalizes them into one file set, which `doMergeConfigs` does here too.
//
// The function is exported but marked `@internal`, so app-builder-lib's declarations leave it out: its shape here is
// the one `platformPackager.js` calls it with.
const { getNodeModuleFileMatcher } = fileMatcher as unknown as {
  getNodeModuleFileMatcher(appDir: string, destination: string, macroExpander: (pattern: string) => string,
    platformSpecificBuildOptions: object, packager: never): FileMatcher;
};
const nodeModuleFilters = new Map<readonly string[], (file: string, stat: never) => boolean>();
function nodeModuleFilterFor(used: string[]): (file: string, stat: never) => boolean {
  // A copy, because the merge normalizes the array it is given in place
  const packager = { config: doMergeConfigs([{ files: [...used] }]), debugLogger: { isEnabled: false } };
  const known = nodeModuleFilters.get(used)
    ?? getNodeModuleFileMatcher(REPO_ROOT, 'app', (pattern: string) => pattern, {}, packager as never).createFilter();
  nodeModuleFilters.set(used, known);
  return known;
}

/** Whether the app would carry `relative`, a file of a dependency under `node_modules`, under the given patterns */
const dependencyShipsUnder = (used: string[], relative: string): boolean =>
  nodeModuleFilterFor(used)(path.join(REPO_ROOT, relative), { isDirectory: () => false } as never);

/**
 * Every file under `dir`, relative to the repo root — the population a case asks about, never a literal.
 *
 * Dirents rather than names, so one recursive read answers both what is there and what is a file, without a
 * `statSync` per entry across a few thousand of them.
 */
function filesUnder(dir: string): string[] {
  const root = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(REPO_ROOT, path.join(entry.parentPath, entry.name)));
}

/**
 * A license, licence, notice or copying file, in any case and with any extension, the word anywhere in the name:
 * `@tiptap/pm` keeps the notices of what it bundles in `THIRD_PARTY_LICENSES.md`
 */
const LICENSE_LIKE = /(licen[cs]e|notice|copying)/i;

/** A directory entry that is a directory, or a link to one: the workspaces and vendored packages are links */
const isDirectory = (dir: string, entry: fs.Dirent): boolean =>
  entry.isDirectory()
  || (entry.isSymbolicLink() && fs.statSync(path.join(dir, entry.name), { throwIfNoEntry: false })?.isDirectory() === true);

/**
 * The files at the root of every package installed at the top of `node_modules`, linked ones included, relative to
 * the repo root: one read per package rather than a walk of the whole tree, which is hundreds of thousands of files.
 * Nested installs are left out: the patterns judge a file by its name and path, so a nested copy's license file is
 * judged as a top-level one is, unless its path runs through a directory a pattern names.
 */
function dependencyRootFiles(): string[] {
  const nodeModules = path.join(REPO_ROOT, 'node_modules');
  const packageDirs = fs.readdirSync(nodeModules, { withFileTypes: true })
    .filter((entry) => isDirectory(nodeModules, entry) && !entry.name.startsWith('.'))
    .flatMap((entry) => entry.name.startsWith('@')
      ? fs.readdirSync(path.join(nodeModules, entry.name), { withFileTypes: true })
        .filter((scoped) => isDirectory(path.join(nodeModules, entry.name), scoped)).map((scoped) => path.join(entry.name, scoped.name))
      : [entry.name]);
  return packageDirs.flatMap((dir) => fs.readdirSync(path.join(nodeModules, dir), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join('node_modules', dir, entry.name)));
}

/**
 * Whether the package a dependency file is at the root of ships at all: the list leaves out some packages whole
 * (`@types`, test runners), and a license file of a package the app doesn't carry is owed to nobody. It asks the
 * matcher under test, so a pattern dropping a whole package is not caught here; one is dropped on purpose.
 */
const packageShips = (file: string): boolean => dependencyShipsUnder(patterns, path.join(path.dirname(file), 'package.json'));

/** Every `packages/<pkg>/<part>` that exists: the populations below are per-package, and derived */
const perPackage = (part: string): string[] =>
  PACKAGE_DIRS.flatMap((pkg) => filesUnder(path.join('packages', pkg, part)));

const TEMPLATES = 'packages/apack-cli/templates';
const PACKED_TEMPLATES = 'packages/apack-cli/dist/package/templates';

describe("the packaged app's file list", () => {
  /**
   * The scaffold's templates, from the source tree — tracked, so this case needs no build — at the path
   * `bundle-package` copies them to. That mapping is the one thing derived rather than read, so the case below
   * checks it against the built tree when there is one.
   */
  const packedTemplates = () =>
    population('the scaffold templates', filesUnder(TEMPLATES))
      .map((file) => path.join(PACKED_TEMPLATES, path.relative(TEMPLATES, file)));

  it("keeps every one of the CLI's scaffold templates", () => {
    expect(packedTemplates().filter((file) => !ships(file))).toEqual([]);
  });

  /**
   * The mutation, and what it taught: **both** patterns carry the templates — `packages/*` + `/dist/**` and the
   * dedicated include — so the app breaks when no pattern reaches them, not when either is edited. That is why
   * the older check on one include's string position is gone: it failed on a harmless edit and not on this.
   *
   * And it is the `.ts` templates that depend on them: the rest are `.yml` and `.vue`, which no exclusion names,
   * so the recursive include of `packages` carries those either way. Asserting every template would have been
   * wrong, and this case said so on its first run.
   */
  it('would lose its TypeScript templates if both patterns that carry them went', () => {
    const stripped = without('packages/*/dist/**', 'packages/apack-cli/dist/package/templates/**');
    const typescript = packedTemplates().filter((file) => file.endsWith('.ts'));
    expect(population('the TypeScript templates', typescript).filter((file) => shipsUnder(stripped, file))).toEqual([]);
  });

  /**
   * The terminal broker the app runs, as a packaged app resolves it: through `node_modules/@app/terminal-broker`,
   * whose resolver is in `src/` — which `packages/*` + `/src/**` keeps out of the app's own copy of `packages/` —
   * and whose installed build is in `bin/`. The population is the package as installed here, so a build the
   * install has not fetched is not asked about, and the resolver always is.
   */
  it('carries the terminal broker where the packaged app resolves it', () => {
    const installed = population('the terminal broker package', [...filesUnder('packages/terminal-broker/src'), ...filesUnder('packages/terminal-broker/bin')])
      .map((file) => path.join('node_modules/@app/terminal-broker', path.relative('packages/terminal-broker', file)));
    expect(installed.filter((file) => !dependencyShipsUnder(patterns, file))).toEqual([]);
    // And the case can fail: an exclusion naming `src` takes the resolver
    const resolver = installed.filter((file) => file.includes('/src/'));
    expect(population('the broker resolver', resolver).filter((file) => dependencyShipsUnder([...patterns, '!**/src/**'], file))).toEqual([]);
  });

  /**
   * And it carries the broker's build once. `@app/terminal-broker` is a workspace, so the same `bin/` is reachable
   * twice: as the dependency under `node_modules`, and under `packages/`, where no resolver ships to answer it. The
   * resolver looks beside itself, so the copy under `node_modules` is the one the app runs and the other is weight:
   * the binary, its notices and, on Windows, the ConPTY beside it.
   */
  const BROKER_BIN_EXCLUSION = '!packages/terminal-broker/bin/**';
  const brokerBuild = () => population("the terminal broker's installed build", filesUnder('packages/terminal-broker/bin'));

  it("ships the terminal broker's build once, beside the resolver the app loads", () => {
    expect(brokerBuild().filter(ships)).toEqual([]);
    // The one resolver that ships answers a path in its own package, so the build it finds is the one kept
    expect(filesUnder('packages/terminal-broker/src').filter(ships)).toEqual([]);
    const { brokerBinaryPath } = createRequire(import.meta.url)(path.join(REPO_ROOT, 'packages/terminal-broker')) as { brokerBinaryPath(): string };
    const answered = path.relative(path.join(REPO_ROOT, 'packages/terminal-broker'), brokerBinaryPath());
    expect(answered.split(path.sep)[0]).toBe('bin');
    expect(dependencyShipsUnder(patterns, path.join('node_modules/@app/terminal-broker', answered))).toBe(true);
  });

  /** The mutation: the recursive include of `packages` carries the second copy without the one exclusion */
  it('would carry a second copy of it without the one pattern that excludes it', () => {
    expect(patterns).toContain(BROKER_BIN_EXCLUSION);
    const stripped = without(BROKER_BIN_EXCLUSION);
    expect(brokerBuild().filter((file) => !shipsUnder(stripped, file))).toEqual([]);
  });

  /**
   * A pack's working directory, which `packages/**` would take — dotted directories included, since
   * electron-builder reads no `.gitignore`. `apack pack build` keeps its dependency cache, its staging and
   * its record of what each bundling phase read there, and the app loads none of it: measured, the built-in
   * pack's record alone was 25K of build-internal data in every installer.
   *
   * The population is the real directory, so it is whatever a build left there rather than a path named here.
   */
  const workDirs = () => PACKAGE_DIRS.flatMap((pkg) => filesUnder(path.join('packages', pkg, PACK_WORK_DIR)));

  it("ships no pack's working directory", () => {
    const found = workDirs();
    if (found.length === 0) return; // nothing built here; the mutation case below says when that hides something
    expect(population('the pack working directories', found).filter(ships)).toEqual([]);
  });

  /**
   * The mutation, and what it is about: the recursive include of `packages` is what would carry these, so
   * dropping the one exclusion has to bring them back. Without this, "none of them ships" passes just as well
   * on a machine where no pack has been built — which is every fresh clone.
   */
  it('would carry them without the one pattern that excludes them', () => {
    const found = workDirs();
    expect(found.length, `no pack has a ${PACK_WORK_DIR} directory here, so this case proves nothing: run npm run build:default-setup`)
      .toBeGreaterThan(0);
    const stripped = without(`!packages/*/${PACK_WORK_DIR}/**`);
    expect(found.filter((file) => shipsUnder(stripped, file)).length,
      'nothing came back, so this pattern is not what keeps the working directories out').toBeGreaterThan(0);
  });

  /**
   * Every license and notice file of every installed dependency ships, which the dependencies' licenses ask a
   * redistribution to carry: the population is what is installed here, so a dependency added later is asked about
   * without anyone naming it.
   */
  const dependencyLicenses = () => population('the dependencies\' license and notice files',
    dependencyRootFiles().filter((file) => LICENSE_LIKE.test(path.basename(file)) && packageShips(file)));

  it("ships every dependency's license and notice files", () => {
    expect(dependencyLicenses().filter((file) => !dependencyShipsUnder(patterns, file))).toEqual([]);
  });

  it("ships the app's own license", () => {
    const own = population("the app's own license files", fs.readdirSync(REPO_ROOT).filter((name) => LICENSE_LIKE.test(name)));
    expect(own.filter((file) => !ships(file))).toEqual([]);
  });

  /** The mutation: an exclusion of `LICENSE*` takes nearly all of them */
  it('would lose them to an exclusion of LICENSE*', () => {
    const stripped = [...patterns, '!**/LICENSE*'];
    expect(dependencyLicenses().filter((file) => !dependencyShipsUnder(stripped, file)).length,
      'nothing was dropped, so the case cannot tell a list that keeps them from one that does not').toBeGreaterThan(0);
  });

  /**
   * Markdown is excluded, and a license only in Markdown (esbuild's and vite's are `LICENSE.md`) still ships: the
   * exclusion spares license-like names. Both halves, so the pattern can neither stop excluding Markdown nor start
   * excluding licenses without one of them failing.
   */
  const markdownExclusion = () => {
    const found = patterns.filter((pattern) => pattern.startsWith('!') && pattern.endsWith('.md'));
    expect(found, 'the list should hold exactly one Markdown exclusion').toHaveLength(1);
    return found[0];
  };

  it('ships license files written in Markdown, and leaves out other Markdown', () => {
    const markdown = dependencyRootFiles().filter((file) => file.toLowerCase().endsWith('.md') && packageShips(file));
    const licenses = population('the license files in Markdown', markdown.filter((file) => LICENSE_LIKE.test(path.basename(file))));
    // README and CHANGELOG files electron-builder drops by itself whatever the list says, so they say nothing of it
    const others = population('the other Markdown files', markdown.filter((file) =>
      !LICENSE_LIKE.test(path.basename(file)) && !/^(readme|changelog)\.md$/i.test(path.basename(file))));
    expect(licenses.filter((file) => !dependencyShipsUnder(patterns, file))).toEqual([]);
    expect(others.filter((file) => dependencyShipsUnder(patterns, file))).toEqual([]);
    // The mutation: a plain `*.md` exclusion drops the Markdown licenses
    const plain = patterns.map((pattern) => (pattern === markdownExclusion() ? '!**/*.md' : pattern));
    expect(licenses.filter((file) => !dependencyShipsUnder(plain, file)).length).toBeGreaterThan(0);
  });

  it('ships no package source', () => {
    expect(population('every package source file', perPackage('src')).filter(ships)).toEqual([]);
  });

  /**
   * The trees `stagePublishTree` writes so `npm publish` has something to publish. The app never loads one — it
   * resolves `@apackdev/sdk` through `node_modules` to `packages/apack-sdk/dist` — and the recursive include of
   * `packages` took all three until the publish exclusion was added, because electron-builder reads no
   * `.gitignore`.
   */
  describe.skipIf(!PACKAGES_BUILT)('over the built trees', () => {
    it('ships no tree staged for npm', () => {
      expect(population('the staged trees', perPackage('publish')).filter(ships)).toEqual([]);
    });

    /**
     * The mutation. Not *all* of them come back: the `.js`, `.css` and `.json` do, where the `.d.ts`, `.map` and
     * `.md` are named by other exclusions already. So the claim is that this pattern is the only thing standing
     * between the app and a second copy of the packages, not that it is the only thing that ever touches those
     * files — which is why the assertion below is "more than none" rather than a number that would date on the
     * next module this package gains.
     */
    it('would carry them without the one pattern that excludes them', () => {
      const stripped = without('!packages/*/publish/**');
      const staged = population('the staged trees', perPackage('publish'));
      expect(staged.filter((file) => shipsUnder(stripped, file)).length,
        'nothing came back, so this pattern is not what keeps the staged trees out').toBeGreaterThan(0);
    });

    it("ships every file of a package's compiled output", () => {
      expect(population("@apackdev/sdk's dist", filesUnder('packages/apack-sdk/dist')).filter((file) => !ships(file))).toEqual([]);
    });

    /** The mapping the templates cases derive: what `bundle-package` copied is what they assumed it would */
    it('carries the templates at the path the build copies them to', () => {
      const packed = population('the packed templates', filesUnder(PACKED_TEMPLATES))
        .map((file) => path.relative(PACKED_TEMPLATES, file));
      const source = filesUnder(TEMPLATES).map((file) => path.relative(TEMPLATES, file));
      expect(packed.sort()).toEqual(source.sort());
    });
  });
});
