import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { relativeSpecifiers } from '../../../scripts/lib/module-graph.ts';
import { repoFiles } from './_support/repo-files.ts';

/**
 * What this package is for, as a check rather than as a convention.
 *
 * The repo's own tooling is checked by specs like everything else, and those specs used to live in
 * `@apackdev/cli` — not because they were about the CLI, but because it was the package with a vitest config
 * nearest the scripts. Fifteen of them accumulated there, and they were invisible to `npm run spec`: a
 * change to `scripts/` belongs to no package, so the command that runs "the specs your changes affect" ran
 * none of them.
 *
 * Both halves of that are fixed, and both need holding. `scripts/spec.ts` routes repo tooling here; this is
 * the other half.
 */

/** Where the repo's own scripts live — not a package's `scripts/`, which is that package's business */
const REPO_SCRIPTS = path.join(REPO_ROOT, 'scripts') + path.sep;
const PERFORMANCE_HARNESS = path.join(REPO_ROOT, 'tests/performance') + path.sep;

/**
 * **Importing** a module under the repo's `scripts/`.
 *
 * Resolves each relative specifier rather than matching `/scripts/` as text, because `@apackdev/ui` has a
 * `scripts/` of its own and a spec about *its* export map is not a repo check.
 *
 * This is what the first check below asks, and it asks only this, because what that check protects is
 * *reachability*: `scripts/spec.ts` routes a change under `scripts/` to this package, so a spec that imports
 * one and lives elsewhere is a spec that will not run when what it covers changes. An import is the only
 * thing that can create that, and it is now the only thing that can, since `check:specifiers` refuses a
 * package reaching into `scripts/` at all.
 */
const importsRepoTooling = (file: string): boolean => {
  const abs = path.join(REPO_ROOT, file);
  // From the tree, not a pattern over the text: a side-effect `import './x'` has no `from` for a regex to
  // find, and a specifier written inside a fixture string is not an import at all
  return relativeSpecifiers(abs).some((specifier) => {
    const target = path.resolve(path.dirname(abs), specifier);
    // Manual scenarios use their own harness; unit checks of that harness belong to this workspace.
    return target.startsWith(REPO_SCRIPTS) || target.startsWith(PERFORMANCE_HARNESS) && !abs.startsWith(PERFORMANCE_HARNESS);
  });
};

/**
 * Importing one, **or running one as a process**.
 *
 * This is what the second check asks, and the wider question is right there: it is about *cohesion*, that
 * this package holds nothing unrelated, and a spec that spawns `scripts/with-source.mjs` is as much about
 * repo tooling as one that imports it. `with-source` and `import-specifiers-script` reach their subject
 * that way and import nothing.
 *
 * Two checks, each asking only what it needs: one question between them would trip on a spec naming a
 * script path as an *expected value* — `package-freshness` asserting `BUILD_UNITS` covers the build
 * scripts — which cannot affect reachability, and would need an allowlist.
 */
const namesRepoTooling = (file: string): boolean =>
  importsRepoTooling(file) || /REPO_ROOT,\s*'scripts'/.test(fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8'));

const IS_SPEC = /\.(spec|test)\.[cm]?[jt]sx?$/;
const OWN_PACKAGE = 'packages/repo-checks/';
/**
 * The specs here whose subject is the repo's own *layout* rather than a module under `scripts/`, and why.
 *
 * They are the reason the converse check below is not simply "names a repo script". A check on where specs
 * live, or on which packages have suites, has no `scripts/` module behind it to import — it reads the tree.
 * That still belongs here: it is a property of the repo, owned by no package, which is what this package is
 * for. Kept as a named list rather than a widened predicate, because "its subject is repo-wide" is not
 * something a check can decide about itself.
 */
const LAYOUT_CHECKS: Record<string, string> = {
  'tests/doc-links.spec.ts': 'that a relative link between the repo\'s documents resolves — a property of '
    + 'the doc tree, read from git, with no scripts/ module behind it either',
  'tests/pack-test-config.spec.ts': 'that every pack\'s vitest config calls definePackTestConfig rather than '
    + 'restating it — a property of the packs in the tree, read from git and the manifests',
  'tests/playwright-config.spec.ts': 'that every Playwright config in the tree calls the helper for its '
    + 'kind of run rather than restating its settings — the same property as the row above for the other '
    + 'runner, read from git, over the repo\'s own config as well as the packs\'',
  'tests/lint-scope.spec.ts': 'what the root lint command excludes from packages/ — a property of the '
    + 'script at the tree\'s root and the templates it names, with no scripts/ module behind it',
  'tests/identity-guard.spec.ts': 'that only @apackdev/sdk/env decides the app\'s environment and data '
    + 'paths — a property of every tracked file, read from git, with no scripts/ module behind it. It is '
    + 'here because its subject is the repo: a suite whose project does not declare the repo is not re-run '
    + 'when the thing it checks moves, which is how it missed one for two chain runs',
  'tests/dev-pack-hmr.integration.spec.ts': 'that the dev server serves **every** workspace pack\'s '
    + 'frontend from source, so a component edit patches rather than reloads — a property quantified over '
    + 'the packs in the tree, which no one workspace owns: it reads the renderer\'s config, @apackdev/host\'s '
    + 'discovery and a pack under tests/packs, and would be a suite declaring none of the others wherever '
    + 'else it sat',
  'tests/surface-vocabulary.spec.ts': 'that the frontend actor is named a surface and `surface` is left to '
    + 'ProseMirror and bundler plugins — a property of every tracked file, read from git, with no scripts/ module '
    + 'behind it. Here for the same reason as identity-guard: a suite whose project does not declare the repo '
    + 'is not re-run when the thing it checks moves',
  'tests/repo-files.spec.ts': 'what "the files this repo has" means for the checks above — the working tree '
    + 'rather than the index, which is a property of the repo read from git, and the one the six populations '
    + 'here are built from',
};

const specs = (): string[] =>
  repoFiles().filter((file) => IS_SPEC.test(file));

describe('a package spec about the repo\'s tooling lives in @app/repo-checks', () => {
  it('has none anywhere else', () => {
    const elsewhere = specs().filter((file) => !file.startsWith(OWN_PACKAGE)).filter(importsRepoTooling);
    expect(elsewhere, 'move these to packages/repo-checks/tests: npm run spec routes a change under scripts/ '
      + 'to this package alone, so a spec importing one from anywhere else will not run when what it covers '
      + 'changes').toEqual([]);
  });

  // The converse, so the package stays what it says it is. A spec that lands here and checks something else
  // makes "the repo checks" a name for wherever a spec was inconvenient, which is what it replaced.
  it('holds nothing else', () => {
    const here = specs().filter((file) => file.startsWith(OWN_PACKAGE)
      && !(file.slice(OWN_PACKAGE.length) in LAYOUT_CHECKS));
    expect(here.filter((file) => !namesRepoTooling(file)),
      'this package is for specs whose subject is a repo script or the repo\'s own layout; these are '
      + 'neither — move them, or add them to LAYOUT_CHECKS with what repo-wide property they check').toEqual([]);
  });

  // The list is only honest while each entry is still here and still needs the exemption
  it('lists no layout check that has stopped applying', () => {
    const stale = Object.keys(LAYOUT_CHECKS).filter((rel) => {
      const file = `${OWN_PACKAGE}${rel}`;
      return !fs.existsSync(path.join(REPO_ROOT, file)) || namesRepoTooling(file);
    });
    expect(stale, 'these are gone, or now name a repo script and need no exemption; drop them from '
      + 'LAYOUT_CHECKS').toEqual([]);
  });
});
