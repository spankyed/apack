import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { packagesBuiltOrRefuse, REPO_ROOT } from '@apackdev/host/build/packages-built';
import { population } from '@apackdev/sdk/testing';
import { createBuildSession } from '../../../build/build-metadata.ts';
import { completeBuildFixture } from './_support/app-build.ts';
import { PACKAGE_DIRS } from '../../../scripts/lib/workspace-deps.ts';
import { PACK_WORK_DIR } from '@apackdev/host/build/pack-workdir';
import { FileMatcher } from 'app-builder-lib/out/fileMatcher.js';
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
    expect(installed.filter((file) => !ships(file))).toEqual([]);
    // And it is these two patterns that carry them, so the case can fail
    const BROKER_INSTALL = 'node_modules/@app/terminal-broker/bin/**/*';
    expect(installed.filter((file) => shipsUnder(without('node_modules/**/*', BROKER_INSTALL), file))).toEqual([]);
    // **The second is what carries a release's notices**, which the list otherwise leaves out of every package:
    // the resolver answers no binary while one file the pin names is missing, so dropping it is an app with no
    // terminal. Asked of a path rather than of what is installed here, since a pin names no license on every platform
    const notice = 'node_modules/@app/terminal-broker/bin/0000000000000000000000000000000000000000/darwin-arm64/LICENSE-MIT';
    expect(ships(notice)).toBe(true);
    expect(shipsUnder(without(BROKER_INSTALL), notice)).toBe(false);
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
