/**
 * Where the import rules look: the packs, the packages, and the files under a given path.
 *
 * The definition, not the rules — `scripts/check-import-specifiers.ts` is the command over it, the same split
 * as `scripts/spec.ts` over `scripts/lib/spec-plan.ts`. These were four separate regions of that file, far
 * enough apart that `PACK_CODE_DIRS` was declared after seven functions that take it as a default.
 *
 * **It walks the filesystem, and cannot ask git.** Every function here takes a `root`, and the rules' own specs
 * pass one from `mkdtempSync` — a fixture tree that is no git repository, where `git ls-files` answers nothing.
 * So this is a different answer to "what files are there" from `repoFiles()` in `@app/internal-repo-checks`, on purpose
 * rather than by accident: that one asks git because its subject is this repo, and this one cannot because its
 * subject is whatever directory it is handed. `SKIPPED_DIRS` is the price — a hand-kept partial of `.gitignore`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sourceFiles } from '../../packages/apack-cli/src/build/pack-sources.ts';

export const repoRoot = path.resolve(import.meta.dirname, '..', '..');

/** A path as this repo writes one: relative to the root, `/`-separated whatever the platform uses */
export const repoRelative = (from: string, to: string): string => path.relative(from, to).split(path.sep).join('/');

/**
 * Directories that hold no workspace source: dependencies, build output, test output and dot directories
 * (worktrees, caches).
 *
 * `results`/`test-results` are Playwright's, and it writes and removes them *while a run is in progress* — so
 * a walk that descends into one races it, and a chain run whose E2E suite overlapped this failed with ENOENT
 * on a directory that existed when it was listed. Two of them also sit inside the fixture packs, where they
 * would otherwise read as that pack's own test sources.
 */
export const SKIPPED_DIRS = /^(?:node_modules|dist|out|coverage|results|test-results|\..+)$/;

export const CLI_TEMPLATE_PACK = 'packages/apack-cli/templates/pack';

/** A JSON file's contents, named in the error when it doesn't parse (one bad manifest shouldn't sink the run) */
export function readJsonFile<T>(file: string): T {
  const text = fs.readFileSync(file, 'utf-8');
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`${file}: invalid JSON (${(error as Error).message})`);
  }
}

/**
 * This checkout's packs, walked once.
 *
 * Measured 2026-09-30: a whole-repo `check:specifiers` made **103 286 `readdirSync` calls**, reading single
 * directories 189 times each — one full walk per `packDirs()` call, and the rules make about 189 of them.
 * That was 2.06s of the run's 4.6s, and the population walk everyone assumes is the cost is 5ms.
 *
 * **Only for this repo's root, which is what makes it need no reset.** A walk cannot be keyed on content
 * the way `pack-features.ts`'s `publishedEntryPoints` keys on a manifest's mtime and size — a directory's
 * mtime moves when its own entries do, not when something three levels down changes — so the alternative
 * is a `resetSourceCache()`-shaped hatch, which a caller forgets and then runs quadratic.
 *
 * Two facts make the condition sound, neither of them guarded — a spec pinning the first is worth writing:
 *
 * - **No test reaches it.** Every one builds its tree under `fs.mkdtempSync`, so `root` is never this one.
 * - **Nothing adds a pack to this repo mid-process.** The tools that read it exit; the one that writes
 *   (`npm run specifiers:fix`) rewrites specifiers inside files it already found.
 */
let packsInRepo: string[] | undefined;

/**
 * Every pack in this checkout: a directory holding `apack.json`, which is already how the source-condition
 * rule defines one, plus the scaffold's templates — the pack every pack author starts from, which has no
 * manifest because `apack.json` is the one thing the scaffold still builds in code.
 *
 * Derived rather than listed, so a fixture pack added tomorrow is covered by every rule here on the day it
 * lands. `dist`, `node_modules` and dot-directories are skipped, which is what keeps a *built* pack's copy of
 * itself out (`tests/packs/external-pack/.apack/bundle/…` is the same pack, built).
 */
export function packDirs(root = repoRoot): string[] {
  const memo = root === repoRoot ? packsInRepo : undefined;
  if (memo?.length !== undefined) return memo;
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.test(entry.name)) walk(path.join(dir, entry.name));
      } else if (entry.name === 'apack.json') {
        found.push(repoRelative(root, dir));
      }
    }
  };
  walk(root);
  const packs = [...found, CLI_TEMPLATE_PACK].sort();
  if (root === repoRoot) packsInRepo = packs;
  return packs;
}

const packHalves = (half: 'src' | 'tests', root = repoRoot): string[] =>
  packDirs(root).map((pack) => `${pack}/${half}`).filter((dir) => fs.existsSync(path.join(root, dir)));

export const PACK_SOURCE_DIRS = packHalves('src');

/**
 * A pack's own code, tests included: the population for a rule about a specifier a pack may not write, wherever
 * it writes it. `apack pack test` runs the whole rule set over a pack's `tests` (`refusePackRuleViolations(cwd,
 * TEST_DIRS)`), so a rule that reads only `src` here is narrower in this repo than the same rule is for a pack.
 */
export const PACK_TEST_DIRS = packHalves('tests');
export const PACK_CODE_DIRS = [...PACK_SOURCE_DIRS, ...PACK_TEST_DIRS];
export const PACK_DIRS = packDirs();

/** For the spec: the population above, which has to cover every pack's `src` and its `tests` */
export const packCodeDirs = (): readonly string[] => PACK_CODE_DIRS;

/**
 * Every package's own code. Derived from `packages/*`, not listed: the list named five of the fifteen, and
 * pointing the rule at the rest found 87 unmigrated specifiers in `@app/main` and `@app/preload` — both of
 * which bundle (one `dist/index.js` each), so `./AppModule.js` named a file that never exists.
 */
export const CHECKED_DIRS = fs.readdirSync(path.join(repoRoot, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(repoRoot, 'packages', entry.name, 'package.json')))
  .flatMap((entry) => ['src', 'tests', 'scripts'].map((part) => `packages/${entry.name}/${part}`))
  .filter((dir) => fs.existsSync(path.join(repoRoot, dir)))
  // A pack's own code belongs to `own-modules`, which resolves the specifier and so names the file to write.
  // `packages/default-setup` is both a package and a pack, so without this both rules report its every
  // relative `.js`.
  .filter((dir) => !PACK_DIRS.some((pack) => dir === pack || dir.startsWith(`${pack}/`)))
  .sort();

export const checkedDirs = (): readonly string[] => CHECKED_DIRS;

export function packageSourceDirs(root = repoRoot): string[] {
  return fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, 'packages', entry.name, 'src')))
    .map((entry) => `packages/${entry.name}/src`);
}

/**
 * Where the feature-topology rules look. The app is the pack `host` (`features/` is its features), and it has
 * no manifest to be found by, so it is named rather than derived.
 */
export const PACK_SRC_ROOTS = [...PACK_SOURCE_DIRS, 'packages/apack-host/src'];

/** Emitted extension → the source extensions that compile to it */
export const SOURCE_EXTENSIONS: Record<string, string[]> = { '.js': ['.ts', '.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] };

/**
 * The pack a path belongs to: the nearest directory at or above it holding a manifest.
 *
 * Not `dirname` of the given directory, which is right only when a caller names a pack's `src` — and a
 * per-file run names whatever the author is editing. A fixture tree with no manifest anywhere falls back to
 * the parent, which is what the specs that pass `['src/pack']` mean by a pack.
 */
export function packRootOf(from: string, root: string): string {
  // A directory this repo already calls a pack wins over the walk below. The CLI's scaffold is one and has no
  // manifest to be found by — `apack.json` is built in code, from computed keys — so the walk climbed past it
  // to `packages/apack-cli` and handed every rule that package as the pack. Measured: `contract-leaves`,
  // `cross-feature-imports` and `own-modules` all reported nothing over the scaffold, each for a different
  // reason and none of them "it is clean".
  const inside = (pack: string) => from === pack || from.startsWith(pack + path.sep);
  const known = packDirs(root).map((pack) => path.join(root, pack)).find(inside);
  if (known !== undefined) return known;
  let dir = fs.statSync(from).isFile() ? path.dirname(from) : from;
  while (dir.startsWith(root) && dir !== root) {
    if (fs.existsSync(path.join(dir, 'apack.json')) || fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return path.dirname(fs.statSync(from).isFile() ? path.dirname(from) : from);
}

/**
 * The source files under each of `dirs`, each of which may be a directory or a single file.
 *
 * It skips `SKIPPED_DIRS`, as `packDirs` does. `sourceFiles` alone skips only `node_modules` and `dist`, so a walk
 * over a whole package descended into `.apack/` — where a concurrent `apack pack build` writes and removes its
 * staged output — and failed a chain run with ENOENT on a file that existed when it was listed.
 */
export function filesUnder(dirs: readonly string[], root: string): string[] {
  return dirs.flatMap((dir) => {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) return [];
    return fs.statSync(full).isFile() ? [full] : [...sourceFiles(full, (name) => SKIPPED_DIRS.test(name))];
  });
}
