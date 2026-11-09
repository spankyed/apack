// In the expensive half because it packs, which is the line this suite's two halves are drawn on.
//
// **Moved 2026-10-06, on the slow report's evidence and against a recorded decision.** It was the one spec
// in the fast half that packed anything — five `npm pack --dry-run` subprocesses — and `CLAUDE.md` kept it
// there on the strength of that costing ~1.5s. It measured **3.74s of the half's 4.5s**, 83% of it, so the
// figure the decision rested on was 2.5x out of date and the fast half was this spec with three
// near-instant specs beside it. That is the first time a placement decision here has been revisited with a
// number rather than an impression.
//
// Which half a spec is in stays a decision, declared by this filename and re-derived by nothing.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BUILD_UNITS, publishedTreeDirs } from '@apackdev/host/build/packages-built';
import { declaredPathFields, manifestPaths, missingPublishedPaths, type Manifest } from '@apackdev/host/build/published-manifest';
import { population } from '@apackdev/sdk/testing';
import { describe, expect, it } from 'vitest';
import { PACKAGES_BUILT, PACKED_PACKAGES, workspacePackList } from '../src/published-packages.ts';

/**
 * A published tarball names only files it contains, and runs nothing on install.
 *
 * Every other check on these packages resolves a *subset*, each on purpose: `assertExportTargetsBuilt` checks
 * the workspace directory, so it cannot see `files`; `publint` packs the file list but skips a target behind a
 * custom condition (`hasCustomCondition`); `attw` resolves standard conditions only; `test-packaged-authoring.sh`
 * imports about eight of the hundred-odd subpaths. So a manifest could name — and until `publishedManifest`
 * landed, did name, 99 times — a file no consumer ever receives, with every check green.
 *
 * It reads the staged and generated trees npm publishes, not the workspace packages they are derived from.
 */
const TREES = Object.fromEntries(population('the published trees', Object.entries(publishedTreeDirs())));

const manifestOf = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')) as Manifest;

/** Packing costs ~0.3s a package, and four cases ask about the same five tarballs */
const packed = new Map<string, Set<string>>();
const filesOf = (dir: string): Set<string> => {
  const known = packed.get(dir) ?? new Set(population(`${dir}'s packed files`, [...workspacePackList(dir)]));
  packed.set(dir, known);
  return known;
};

/** `<package>: <what names it> -> <detail>`, the shape every case below reports in */
const report = (pkg: string, detail: string) => `${pkg}: ${detail}`;

describe.skipIf(!PACKAGES_BUILT)('a published tarball', () => {
  it('names only files it ships', () => {
    const missing = Object.entries(TREES).flatMap(([pkg, dir]) =>
      missingPublishedPaths(manifestOf(dir), filesOf(dir)).map((problem) => report(pkg, problem)));
    expect(missing).toEqual([]);
  });

  /**
   * An absence, not a list of hook names: npm adds those, and the next one would arrive unchecked. It is also
   * what keeps the published manifest a build output — a `prepack` hook rewriting `package.json` in place would
   * race the specs that pack these packages concurrently.
   */
  it('runs no scripts on install', () => {
    const withScripts = Object.entries(TREES)
      .map(([pkg, dir]) => [pkg, manifestOf(dir).scripts] as const)
      .filter(([, scripts]) => scripts !== undefined)
      .map(([pkg, scripts]) => report(pkg, `scripts -> ${Object.keys(scripts as object).join(', ')}`));
    expect(withScripts).toEqual([]);
  });

  /**
   * The inverse of the failure a staged tree can introduce, and the reason the source condition has nothing to
   * resolve to here. Not "no `.ts` file", which is red on a correct package twice over: `@apackdev/cli` ships its
   * pack templates as source on purpose, and `@apackdev/ui`'s declarations are named `*.d.vue.ts`, which no
   * `.d.ts` test matches.
   */
  it('ships no source directory', () => {
    const source = Object.entries(TREES).flatMap(([pkg, dir]) => [...filesOf(dir)]
      .filter((file) => file === 'src' || file.startsWith('src/'))
      .map((file) => report(pkg, `a packed file -> ${file}`)));
    expect(source).toEqual([]);
  });

  /**
   * What stops the cases above passing by finding nothing. `@apackdev/cli`'s `bin` is `"bin/apack.mjs"` with no
   * `./` prefix, so an extractor keyed on that prefix reports green over zero paths — and `bin` is the only path
   * that manifest names at all.
   */
  it('is checked over at least one path per package, and per field it declares', () => {
    const vacuous = Object.entries(TREES).flatMap(([pkg, dir]) => {
      const manifest = manifestOf(dir);
      const found = manifestPaths(manifest);
      if (found.length === 0) return [report(pkg, 'its whole manifest names no path this case could check')];
      return declaredPathFields(manifest)
        .filter((field) => !found.some(([what]) => what === field || /^[.[]/.test(what.slice(field.length))))
        .map((field) => report(pkg, `${field} is declared but contributed no path`));
    });
    expect(vacuous).toEqual([]);
  });
});

/**
 * What the consumer fixture packs, against what the build builds.
 *
 * Here rather than beside `BUILD_UNITS`, which is where it used to be: the constant it guards against widening
 * is this package's, and a spec that only wanted to read it was paying for the built-packages precondition
 * `PACKAGES_BUILT` enforces at import — which is what stopped a mutation of `BUILD_UNITS` being runnable at all
 * (`apack-cli/tests/build/package-freshness.spec.ts`). It needs no built packages itself; it compares two lists.
 */
describe('the packages a consumer fixture installs', () => {
  it('are all packages the build builds', () => {
    expect(Object.keys(PACKED_PACKAGES).sort()).toEqual(['ears', 'sdk', 'ui']);
    for (const name of Object.keys(PACKED_PACKAGES)) expect(BUILD_UNITS[`@apackdev/${name}`]).toBeDefined();
  });
});
