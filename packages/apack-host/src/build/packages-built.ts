/**
 * Whether the publishable packages' build output still matches the sources it was built from, and the
 * build that refreshes it. `scripts/ensure-packages-built.ts` is the command over this module, run as
 * `npm run packages:ensure` and as `@apackdev/cli`'s `pretest`, whose `published-*` specs read that output.
 *
 * Freshness is a success stamp, not a timestamp. A build removes its output first and neither tsc nor
 * tsdown nor esbuild is transactional, so a failed or interrupted one leaves a complete-looking tree
 * that "output is newer than sources" reads as fresh forever; output mtimes also move for reasons that
 * aren't a build, never move when a source is deleted, and tie on coarse filesystems. So each build
 * runs through `runPackageBuild`, which writes a fingerprint of its inputs only once the build
 * returns, and fresh means both the input fingerprint and the recorded output bytes still match.
 *
 * A unit's `inputs` need only cover what no other unit does, since any stale unit rebuilds all of
 * them. `tests/helpers/published-packages.ts` reads the same verdict, so the specs accept exactly
 * what this builds.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { PUBLISH_TREE } from './published-manifest.ts';
import { SHARED_INSTANCE_PACKAGES } from './shared-deps.ts';
// The signal list, not a second copy of it: `exclusive-lock.ts` owns which interruptions a release has
// to be hung on, and why `SIGBREAK` is in it. Relative, as every import inside this package is
import { INTERRUPTS } from '../exclusive-lock.ts';

/**
 * The file whose presence says a directory is an apack checkout, not an installed package: this
 * module's own source. It names itself on purpose. A marker somewhere else looks correct after that file
 * is renamed, and the guard then reads every checkout as an installed package and quietly does nothing —
 * so the only way to break this one is to move the file holding the constant that names it.
 * `package-freshness.spec.ts` asserts it resolves in this repo, so a move fails a test rather than a run.
 */
export const CHECKOUT_MARKER = path.join('packages', 'apack-host', 'src', 'build', 'packages-built.ts');

/**
 * The checkout this file belongs to, found by walking up from wherever it runs. Bundlers inline this
 * module into packages that ship elsewhere (@apackdev/testing's harness, @apackdev/cli), so a root derived
 * from this file's own location would point inside that bundle; walking up finds the checkout when
 * there is one. With no checkout above it there is nothing to be stale against, and the only caller
 * that runs there (`assertCheckoutPackagesFresh`) tests for the marker below before reading anything.
 */
function findCheckoutRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (; dir !== path.dirname(dir); dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, CHECKOUT_MARKER))) return dir;
  }
  return path.dirname(fileURLToPath(import.meta.url));
}

export const REPO_ROOT = findCheckoutRoot();
const repoFile = (...parts: string[]): string => path.join(REPO_ROOT, ...parts);
const pkgFile = (pkg: string, ...parts: string[]): string => repoFile('packages', pkg, ...parts);

/**
 * Read by every build: the scripts that run it and the toolchain it runs with. This module is not among
 * them — it decides *whether* to build and cannot change what a build emits, so it is the cache's
 * implementation rather than an input. Its two jobs that do affect a verdict are covered without it: the units
 * whose bundles *emit* this file watch it through `packages/apack-host/src`, which they declare because they
 * inline it, and each unit's declared paths are part of its own fingerprint, so editing one unit's input set
 * invalidates that unit alone.
 */
const SHARED_INPUTS = [repoFile('package.json'), repoFile('package-lock.json')];

export interface BuildUnit {
  /** Files and directories the build reads, absolute; a directory is walked */
  readonly inputs: readonly string[];
  /**
   * Trees inside `inputs` that are not part of the fingerprint, and are not this unit's own output either:
   * generated files it declares the parent of but never reads. `typecheck` declares `tests/packs` for
   * the pack sources and does not read the packs' build output — `check:specifiers` filters
   * `__generated__` out itself — so hashing that output would tie this unit's freshness to a build it does
   * not depend on.
   *
   * Distinct from `outputs`, which must exist for the unit to count as built. An exclusion need not exist.
   */
  readonly excludes?: readonly string[];
  /**
   * Suffixes inside `inputs` that are not part of the fingerprint — `excludes` by extension rather than by
   * path, for a unit that reads one kind of file out of a tree holding several.
   *
   * `api:check` is the case and the reason this exists. An API report is a function of the `.d.ts` files a
   * package built, and of nothing else it built; declaring `dist` keys it on the `.js` beside them too, so
   * editing a function body — which moves the compiled output and not the declaration — re-ran a check that
   * provably could not reach a different answer. Measured 2026-10-05, before this: 1438 declared files, of
   * which 239 were the declarations it reads.
   *
   * It is sound here only because the declarations rebuild byte-identically (`KNOWN_IRREPRODUCIBLE` is
   * empty, and `npm run check:repro` is what keeps that true). A unit narrowing its key this way over
   * irreproducible output would cache on a file that moves on its own.
   *
   * **It reaches the key by removing files from the hashed set, and is deliberately not hashed itself.** So
   * narrowing a unit's rule makes it stale — a file it used to hash stops being hashed — while a rule change
   * with no effect on the tree, such as excluding a suffix nothing under the inputs has, changes nothing and
   * re-runs nothing. Hashing the list as well was written first and a mutation check refuted it: deleting
   * that `update` left all 88 cases green, because the set already carries every rule change that can matter,
   * and what it added was an invalidation for a rule that cannot.
   */
  readonly excludeSuffixes?: readonly string[];
  /** Paths the build writes; all must exist for the unit to count as built */
  readonly outputs: readonly string[];
  /**
   * What this unit *runs*, as text — the third of Bazel's triple, beside the inputs and the environment.
   *
   * Optional, and the package builds leave it unset: their command is this module, which cannot change
   * without the module changing, and a module is already bytes under a declared path. The chain's steps
   * set it, because a step is `npm run <name>` and its command lives in a manifest rather than in a file.
   * Without it the only way to key on a command was to hash the whole manifest into every step, which is
   * what made a one-word edit to one script invalidate all of them.
   */
  readonly command?: string;
}

/** A package compiled to its own `dist/` by `scripts/build-package.ts` (or, for @apackdev/ui, build-ui-package.ts) */
function compiled(pkg: string, ...extraInputs: string[]): BuildUnit {
  return {
    // The build scripts live in the repo's scripts/, not the package's: a package's own scripts are its
    // other tooling (the SDK's schema generator) and no input of this build, bar @apackdev/ui's exports
    //
    // The `apack-host/src/build` modules the build script's imports lead to and that decide what it *emits*:
    // `stagePublishTree`, which derives the staged manifest, and what it reaches in turn. All were missing until
    // 2026-09-27. Named rather than the whole `build/` directory, which is what landed first: a directory covers
    // the next sibling automatically, but an import *within* it can then never fail the guard that found this,
    // and it rebuilds three packages when `discover.ts` changes, which none of them reads.
    // `chain-inputs.spec.ts` walks the build script's imports and names anything undeclared — apart from
    // `NOT_A_BUILD_INPUT` below — so the guard is the maintenance a directory was standing in for.
    inputs: [...SHARED_INPUTS, repoFile('scripts', 'lib', 'published-imports.ts'), repoFile('scripts', 'build-package.ts'),
      pkgFile('apack-host', 'src', 'build', 'published-manifest.ts'),
      pkgFile('apack-host', 'src', 'build', 'specifiers.ts'),
      pkgFile('apack-host', 'src', 'build', 'source-resolution.ts'),
      pkgFile('apack-host', 'src', 'build', 'node-options.js'),
      pkgFile('apack-host', 'src', 'build', 'node-options.d.ts'),
      // Reached through this module: it is where the list of inlined packages comes from
      pkgFile('apack-host', 'src', 'build', 'shared-deps.ts'),
      pkgFile('apack-host', 'src', 'build', 'package-inputs.ts'),
      pkgFile('apack-host', 'src', 'build', 'pack-inputs.ts'),
      // How the built tree is published: assembled under `.temp/` and renamed over `dist`, so it decides where
      // the output lands rather than merely whether the build runs — which is what `NOT_A_BUILD_INPUT` is for,
      // and why this is declared instead
      pkgFile('apack-host', 'src', 'replace-dir.ts'), ...extraInputs,
      pkgFile(pkg, 'src'),
      pkgFile(pkg, 'package.json'), pkgFile(pkg, 'tsconfig.json'), pkgFile(pkg, 'tsconfig.package.json')],
    outputs: [pkgFile(pkg, 'dist'), pkgFile(pkg, PUBLISH_TREE)],
  };
}

/**
 * Each workspace whose source a bundle **inlines**, as a directory name.
 *
 * Derived from the list of what is inlined rather than written out, so a third shared-instance package arrives
 * declared. The naming is the repo's own and holds for all of them: `@apackdev/x` lives in `packages/apack-x`.
 */
const INLINED_SOURCE_DIRS = SHARED_INSTANCE_PACKAGES.map((name) => name.replace('@apackdev/', 'apack-'));

/**
 * A package esbuild bundles into `dist/package/`, inlining @apackdev/host and the shared-instance packages from
 * source (scripts/bundle-package.ts).
 *
 * **It declares every source it inlines, which is the whole of what it reads.** `apack-host/src` was there
 * and the shared-instance packages' were not, so an edit to `@apackdev/sdk/src` left the `@apackdev/cli` and
 * `@apackdev/testing` bundles stale with their stamps reading fresh — silent, and the way it surfaced was a
 * packaged-authoring run type-checking a generated file against an SDK whose type no longer matched the CLI
 * that emitted it. `chain-inputs.spec.ts` walks a build script's own imports, which these are not: the
 * bundler reaches them through the package being bundled.
 */
function bundled(pkg: string, ...copiedPaths: string[]): BuildUnit {
  return {
    inputs: [...SHARED_INPUTS, repoFile('scripts', 'bundle-package.ts'),
      repoFile('scripts', 'lib', 'published-imports.ts'), ...copiedPaths.map(file => pkgFile(pkg, file)),
      pkgFile(pkg, 'src'), pkgFile(pkg, 'package.json'), pkgFile(pkg, 'tsconfig.json'),
      pkgFile('apack-host', 'src'), pkgFile('apack-host', 'package.json'),
      ...INLINED_SOURCE_DIRS.flatMap((dir) => [pkgFile(dir, 'src'), pkgFile(dir, 'package.json')])],
    outputs: [pkgFile(pkg, 'dist', 'package', 'package.json'), pkgFile(pkg, 'dist', 'package', 'dist'),
      ...copiedPaths.map(file => pkgFile(pkg, 'dist', 'package', file))],
  };
}

/** The workspaces `npm run packages:build` builds. `tests/build/package-freshness.spec.ts` pins this list against it. */
export const BUILD_UNITS: Record<string, BuildUnit> = {
  '@apackdev/ears': compiled('apack-ears', pkgFile('apack-ears', 'vendor', 'rregex')),
  '@apackdev/sdk': compiled('apack-sdk'),
  '@apackdev/ui': compiled('apack-ui', pkgFile('apack-ui', 'tsdown.config.ts'), repoFile('scripts', 'build-ui-package.ts'),
    pkgFile('apack-ui', 'scripts', 'exports.ts')),
  '@apackdev/testing': bundled('apack-testing'),
  '@apackdev/cli': bundled('apack-cli', 'bin', 'templates'),
};

/**
 * The script a workspace's `build:package` runs, repo-relative — read from that workspace's own manifest.
 *
 * `root` so it can be pointed at a tree: the only way to test what it does with a manifest was to edit a real
 * one, which makes that unit stale and stops the spec running at all — the mutation this exists to allow
 * (`package-freshness.spec.ts`). A function you can point at a tree is a function you can test.
 *
 * **Not from `BUILD_UNITS[workspace].inputs`**, and that is the whole point of it being here. Two checks ask
 * questions *about* those inputs: one walks the build script's imports and requires them to be declared, and one
 * refuses `NOT_A_BUILD_INPUT` for a unit whose build does not inline host source. Deriving the script from the
 * list under test made the first vacuous — dropping an input removed the entry to walk from, and the case passed
 * for having nothing to check. The manifest is the independent answer.
 */
export function buildScriptFor(workspace: string, root = REPO_ROOT): string {
  const packages = path.join(root, 'packages');
  for (const dir of fs.readdirSync(packages)) {
    const manifest = path.join(packages, dir, 'package.json');
    if (!fs.existsSync(manifest)) continue;
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf-8')) as { name?: string; scripts?: Record<string, string> };
    if (pkg.name !== workspace) continue;
    const named = /(scripts\/[\w./-]+\.ts)/.exec(pkg.scripts?.['build:package'] ?? '')?.[1];
    if (named === undefined) throw new Error(`${workspace}'s build:package names no script under scripts/`);
    return named;
  }
  throw new Error(`no packages/* declares the name ${workspace}`);
}

/**
 * Modules a build script imports that are deliberately **not** its inputs, and why.
 *
 * Each decides *whether* to build; none can change what a build emits. Watching one would rebuild every
 * package whenever the freshness rule was edited, for output that would be byte-identical. The exception is a
 * build that *inlines* this source, which emits it and therefore watches it: the case below asks
 * `buildScriptFor` which units bundle, exempts those, and then requires each of them to declare
 * `packages/apack-host/src` — so the exemption is not a hole a unit falls through by declaring nothing.
 *
 * One list, two readers, because two would disagree: `package-freshness.spec.ts` asserts no unit names these,
 * and `chain-inputs.spec.ts`' closure guard would otherwise demand them — which it did, on the day it landed.
 * Repo-relative, as both readers resolve them against `REPO_ROOT`.
 */
export const NOT_A_BUILD_INPUT: Record<string, string> = {
  'scripts/ensure-packages-built.ts': 'the command over the freshness rule; it cannot change what "built" means',
  'packages/apack-host/src/build/packages-built.ts': 'the freshness rule and the stamp protocol itself; '
    + 'the bundles that inline it watch it as ordinary source, and a build that cannot embed it has no verdict '
    + 'that depends on it',
  'packages/apack-host/src/exclusive-lock.ts': 'the lock the build takes so two of them do not interleave; '
    + 'it decides when a build may start, never what one writes',
  'packages/apack-host/src/process-liveness.ts': 'whether the process named by a lock is still there, which '
    + 'is the lock above asking its one question',
};

/**
 * Package directory → the directory inside it that npm publishes, in publish order (a dependency before its
 * dependents). None of the five publishes its workspace `package.json`: `@apackdev/ears`, `/sdk` and `/ui` stage a
 * derived one under `publish/` (`stagePublishTree`), and `@apackdev/cli` and `@apackdev/testing` a generated one
 * under `dist/package`.
 *
 * Here rather than in `scripts/publish-packages.ts` because two callers need it and neither may import the
 * other: that script is the command over this, and `@app/publish-checks` checks what it would publish. It is
 * not `BUILD_UNITS` above — that is what a build reads to decide freshness, `@apackdev/host` included, which
 * nothing publishes.
 */
export const PUBLISHED_TREES: Record<string, string> = {
  'apack-ears': PUBLISH_TREE,
  'apack-sdk': PUBLISH_TREE,
  'apack-ui': PUBLISH_TREE,
  'apack-testing': 'dist/package',
  'apack-cli': 'dist/package',
};

/** Each published tree as an absolute path, by the package's directory name */
export function publishedTreeDirs(): Record<string, string> {
  return Object.fromEntries(Object.entries(PUBLISHED_TREES).map(([pkg, tree]) => [pkg, pkgFile(pkg, tree)]));
}

/** Stamps and the build lock, outside every output tree so a build can remove its own */
const STAMP_DIR = repoFile('node_modules', '.cache', 'apack-packages-build');
const LOCK_FILE = path.join(STAMP_DIR, 'packages-build.lock');
/** How long a `freshness` fix waits for a live holder, and how often it looks. A bound, not a schedule: it
 *  returns the moment the holder is gone. A minute against a longest-unit build of ~15s: four times what
 *  the thing being waited for costs, so a wedged holder is reported in a minute rather than held for ten.
 *  A bound nobody will wait for is the same as no bound. */
const LOCK_WAIT_MS = 60_000;
const LOCK_POLL_MS = 200;

export const stampFile = (workspace: string): string => path.join(STAMP_DIR, `${workspace.replace(/[@/]/g, '-').replace(/^-/, '')}.json`);

/**
 * Where a bundle records what it actually read — the esbuild metafile's inputs, repo-relative.
 *
 * **An observation, never a cache key.** A unit's `inputs` stay a declaration, because a record of the last
 * run's reads cannot invalidate on a file that was not read last time: a newly imported module would be
 * absent from it, so an edit to that module would change nothing and the unit would read fresh over a stale
 * bundle. That is exactly the failure this is here to *catch* — the `@apackdev/cli` and `@apackdev/testing`
 * bundles inline `@apackdev/sdk` and `@apackdev/ears` from source and declared neither, which no check could see,
 * because every other input check compares one declaration against another.
 *
 * In a `reads/` subdirectory so it can never be taken for a stamp: `stampFile` names its files in this
 * directory's root, and nothing walking them descends.
 */
export const bundleReadsFile = (workspace: string): string =>
  path.join(STAMP_DIR, 'reads', `${workspace.replace(/[@/]/g, '-').replace(/^-/, '')}.json`);

/** What a bundle read, as its build recorded it, or `undefined` for a bundle that has not been built here */
export function bundleReadsOf(workspace: string): string[] | undefined {
  try {
    const held = JSON.parse(fs.readFileSync(bundleReadsFile(workspace), 'utf-8')) as { files?: unknown };
    return Array.isArray(held.files) ? held.files.filter((f): f is string => typeof f === 'string') : undefined;
  } catch {
    return undefined;
  }
}

/** Records it, with the build that wrote it: a record from another build is not evidence about this one */
export function recordBundleReads(workspace: string, files: readonly string[]): void {
  const file = bundleReadsFile(workspace);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ workspace, at: new Date().toISOString(), files: [...files].sort() }, null, 2)}\n`);
}

/**
 * Every file under a path, repo-relative — the walk a fingerprint is taken over.
 *
 * Exported because **a claim about what a unit or a step reads is evaluated over resolved files, never over the
 * declared strings**: a guard that walked differently would pass files a fingerprint never hashed, and an input
 * may be a directory, so a claim compared as a string says nothing about what the directory holds.
 *
 * The negative direction is where that matters, and it cost two commits to learn. `package-freshness.spec.ts`
 * refuses `packages-built.ts` as an input while `chain-inputs.spec.ts`' closure guard demanded it, and the
 * contradiction was invisible because the refusal compared declared strings: a declaration of the whole
 * `src/build` directory contains the file without equalling it, so the check passed with its intent violated. A
 * broader declaration must never be the thing that silences a "must not read this" rule.
 */
/**
 * Whether one declared path covers another: they are equal, or the second lies under the first.
 *
 * The rule every question about declared paths asks — is this file excluded, whose output is it, does one step's
 * input tree contain another's. It was written out at each of those, and the one thing it must not get wrong is
 * the prefix: `src/buildings` is not under `src/build`, which is why the separator is part of the comparison.
 */
export const covers = (outer: string, inner: string): boolean => outer === inner || inner.startsWith(`${outer}/`);

/**
 * A path relative to the repo root, always spelled with `/`.
 *
 * Every comparison `covers` makes has a hand-written POSIX literal on at least one side — `chain-steps.ts`
 * declares `'packages/default-setup/dist'` and the like — while the other side came from `path.relative`, which
 * is backslash-separated on Windows. There, nothing matched: a unit's own declared outputs were hashed into its
 * own fingerprint, so it disagreed with the stamp it had just written and rebuilt. Silent, because it costs a
 * redundant build rather than an error, and `build/build.sh` calls `packages:ensure` twice on the release path.
 *
 * So the two sides are spelled the same here, where repo-relative paths are made, rather than in `covers`, which
 * runs once per file per excluded path. On macOS and Linux `path.sep` is already `/` and this changes nothing.
 */
export const repoRelative = (absolute: string): string => path.relative(REPO_ROOT, absolute).split(path.sep).join('/');

/**
 * A config a bundler compiled in order to load it: `bundle-require` writes `<name>.bundled_<id>.mjs` beside
 * the config and removes it again, which is what `tsup` leaves in `packages/api` for the length of a build.
 *
 * Skipped because it is there for part of a build and gone at rest, so a fingerprint taken while one exists
 * records a file the next walk cannot find — the step then never caches and nothing says why. Its id is
 * random, so no `excludes` entry could name it. `.gitignore` carries the same pattern for the tools that
 * honour one; this walk does not, which is why both exist.
 */
const COMPILED_CONFIG = /\.bundled_[^.]+\.[mc]js$/;

export function inputFiles(target: string, out: string[] = []): string[] {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return out;
  }
  if (stat.isFile()) return (out.push(repoRelative(target)), out);
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    // Dot files (editor and OS droppings), installed modules and a bundler's compiled config are not sources
    // of this build
    if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && !COMPILED_CONFIG.test(entry.name)) {
      inputFiles(path.join(target, entry.name), out);
    }
  }
  return out;
}

/** Every produced file, including hidden files, metadata, prose and nested modules. */
export function outputFiles(target: string, out: string[] = [], ancestors = new Set<string>()): string[] {
  const stat = fs.statSync(target);
  if (stat.isFile()) return (out.push(repoRelative(target)), out);
  if (!stat.isDirectory()) throw new Error(`Build output is not a regular file or directory: ${target}`);
  const real = fs.realpathSync(target);
  if (ancestors.has(real)) throw new Error(`Build output contains a directory cycle: ${target}`);
  const nested = new Set(ancestors).add(real);
  for (const entry of fs.readdirSync(target)) outputFiles(path.join(target, entry), out, nested);
  return out;
}

/** What stands in for a digest where the file was not there to read — never a hash of nothing */
export const ABSENT = 'absent';

/**
 * How a fingerprint looks at the tree: what a declared target holds, and what a file holds.
 *
 * Both halves together because they are one question — "the tree, as of now" — and because a caller that shares
 * one and not the other pays for the half it kept. A sweep that shares reads and walks anyway spends 32ms of a
 * 53ms pass on `readdir`, measured over `typecheck`'s inputs.
 */
export interface TreeReader {
  /** The files under a declared target, absolute path in, repo-relative paths out. Defaults to `inputFiles`. */
  readonly listInputs: (target: string) => string[];
  /** Complete produced files; source filters never apply to output evidence. */
  readonly listOutputs: (target: string) => string[];
  /** One input's bytes, repo-relative path in, `null` for a file that is not there. Defaults to `readInput`. */
  readonly read: (file: string) => Buffer | null;
  /**
   * One input's content digest, or `ABSENT`. Separate from `read` because this is the answer a unit's
   * fingerprint is built from, and it is the same answer for every unit that declares the file — a reader
   * asking about many units at one moment memoises it once and the overlap stops costing anything.
   */
  readonly digest: (file: string) => string;
}

/**
 * The default: look now.
 *
 * `ENOENT` is `null` — a file that goes between the walk and the read is absent, never empty. **Every other error
 * propagates**, which is load-bearing rather than incidental: `unitStaleReason` catches it and reports
 * `its sources could not be read (…)`, so an unreadable tree is a refusal instead of a fresh verdict.
 *
 * Tolerating the absent file is why the chain never had the bug its own checks did: `@app/repo-checks` built
 * their populations from `git ls-files`, which reports a file deleted from the worktree and not yet staged, and
 * four of them died reading one. They ask `repoFiles()` now. Keep this branch.
 */
export const readTree: TreeReader = {
  listInputs: (target) => inputFiles(target),
  listOutputs: (target) => outputFiles(target),
  read: (file) => {
    try {
      return fs.readFileSync(repoFile(file));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      return null;
    }
  },
  digest: (file) => digestOf(readTree.read(file)),
};

/** A file's content digest, with one word for "not there" so a digest map distinguishes it from empty */
const digestOf = (contents: Buffer | null): string =>
  contents === null ? ABSENT : createHash('sha256').update(contents).digest('hex');

/**
 * A content fingerprint of `inputs`: every file's repo-relative path and its bytes, sorted.
 *
 * It reads every byte, and that has been proposed twice as the thing to optimise — record each input's
 * `(size, mtimeNs)` in the stamp and skip the hashing when they all match, as Bazel and Turborepo do.
 * Measured on this repo before taking that trade:
 *
 *     417 files, 2.5MB      walk (readdir) 3ms | stat every file 1ms | walk + hash 24ms
 *     npm run packages:ensure, everything fresh: 345ms
 *
 * So the hashing is 24ms of a 345ms command; the other 320ms is the npm spawn, node and tsx starting,
 * and modules loading. Stat-before-hash would save about 20ms, in exchange for a cache key that is right
 * unless a file changes content while keeping its size and timestamp. Bazel makes that trade over
 * gigabytes and thousands of targets; over 2.5MB it buys 6% of one command. Not worth it — if this cost
 * ever matters, the 320ms of process startup is the part to attack, by calling `stalePackageUnits()`
 * from a process that is already running rather than spawning one.
 *
 * Re-measured 2026-09-28 at the largest scale this is asked at, a chain sweep over twelve units and 39.1MB,
 * because the 1ms row above is for 417 files and reads as though stats were nearly free:
 *
 *     12 units, 18001 files (3518 distinct)   walk (which stats every path) 205ms | walk + read + hash 661ms
 *
 * The conclusion is unchanged and the arithmetic is worse than it looks, in three ways. The stats **are** the
 * walk — `inputFiles` already takes one per path and drops it — so they are not an alternative to it and the
 * ceiling is the 456ms of reading and hashing, not the whole 661ms. Skipping the hash for a whole unit whose
 * stats all match saves that only on a tree where nothing moved, and a unit whose stats have moved pays both:
 * 861ms against today's 661ms. On this tree, with no edit outstanding beyond a commit, 8 of 10 stamped steps
 * had a file newer than their stamp — a run of the chain is a run you made because something changed, so the
 * regression is the ordinary case and the saving is the rare one. And a per-file version, hashing only the
 * files whose stats moved, needs the fingerprint composed from per-file digests rather than a byte stream,
 * which moves every recorded fingerprint. That used to include three committed files, until the proxy that
 * read them was deleted for the derivation it stood in for; the cost now falls on chain stamps alone.
 *
 * What did pay, for the same 5.1x overlap, was reading each distinct file once per sweep: see `freshnessSweep`.
 *
 * Note this is a different question from the one the header answers. There, mtimes are rejected for
 * deciding whether *output* is current, where a failed build leaves a complete-looking tree that reads
 * as fresh forever. Here they would be a cache key over *inputs*, which is sound in principle — the
 * reason not to is the arithmetic above, not the same objection.
 *
 * `collect` receives each file's own digest as this walk hashes it: the same files, in the same order, in one
 * pass. It is how a caller that has to say *which* file moved gets an answer that
 * cannot disagree with the verdict, because both come from here. A second walk of its own can disagree, and
 * one did — an mtime walk named a file an E2E test rewrites with identical bytes, and the diagnosis that
 * followed was wrong. The returned hash is unaffected, so a caller wanting only the verdict passes nothing.
 *
 * `tree` is where the walk and the bytes come from, defaulting to looking now (`readTree`, whose `ENOENT` rule
 * this loop used to hold inline). Injected rather than cached here, because a cache has a lifetime and this
 * function has no business owning one: `freshnessSweep` does, for the callers that ask about many units at one
 * moment.
 *
 * It still computes a fingerprint for a caller that wants only the digests (`changedInputs`). Measured at 9ms of
 * that caller's 53ms, against splitting this loop into something two projections consume — which would also
 * dissolve the case that proves the digests and the hash agree, since they would no longer be taken together. The
 * 9ms is the cheaper of the two.
 */
/**
 * Prose for whoever opens a directory, and never an input: skipped wherever a unit's inputs are hashed.
 *
 * It is the first entry in the root `CLAUDE.md`'s list of time-wasters — a prose edit runs nothing — and that
 * was a claim about the chain that the chain did not hold. Guides sit *inside* declared trees rather than at
 * a package root (`default-setup/src/content`, `apack-host/src/migrations` and `src/packs/runtime`,
 * `default-setup/tests/content`, `tests/e2e`), so a sentence of prose re-ran up to four steps, `build:default-setup` among
 * them. Skipped here rather than excluded per step, because the steps that reach them take their inputs from
 * derived lists where there is no literal array to add an entry to.
 *
 * **It was a rule about one filename until 2026-10-05, and the cost it left behind was the same cost.** Only
 * files named `CLAUDE.md` were skipped, so the prose that is not — two `README.md` and an example under
 * `default-setup/src/features/` — kept 9 steps each honest about a typo. The rule is now about markdown
 * rather than about a name, which skips exactly those four and no other tracked file (measured).
 *
 * `READS_MARKDOWN` is the other half: directory names whose markdown is **content**, read or shipped rather
 * than read by a person. `etc` holds the recorded API reports `api:check` compares against — a hand-edited
 * one must invalidate it, which is the one hole the deleted stamp could not see. `content` is a pack's
 * content sources, compiled into entities a user gets. `templates` is the CLI's scaffold, rendered into a
 * new pack.
 * `fixtures` is test input. `docs` is the document tree `doc-links` resolves every relative link in, which
 * is why it is an input of `@app/repo-checks` rather than of every repo-scope step.
 *
 * **The condition that would make this wrong** is a check that asserts one of these files' *text*: it would
 * then be a real input, and skipping it would let that check cache over a doc that had gone stale. One
 * exists — `spec-plan.spec.ts` holds `packages/repo-checks/CLAUDE.md` to naming every spec in that package —
 * which `GUIDES_A_CHECK_READS` takes back. A second, and a new tree whose markdown something starts reading,
 * are both the case to come back here for; a wrong entry is *silent*, so
 * `fingerprint-scope.integration.spec.ts` holds each of these trees to being unskippable rather than
 * trusting the list, and mutates it to prove it can fail.
 */
export const READS_MARKDOWN: ReadonlySet<string> = new Set(['etc', 'content', 'help', 'templates', 'fixtures', 'docs']);

const GUIDE = 'CLAUDE.md';

const isProse = (file: string): boolean => {
  if (!file.endsWith('.md')) return false;
  // A guide is prose wherever it sits, a content tree included: two live under a `content/` directory
  // (`default-setup/src/content`, `default-setup/tests/content`), and keying on them was this rule's first draft
  if (file === GUIDE || file.endsWith(`/${GUIDE}`)) return true;
  return !file.split('/').some((segment) => READS_MARKDOWN.has(segment));
};

/**
 * The exception the comment above names, arrived: a guide some check asserts the *text* of, which makes it a
 * real input. `spec-plan.spec.ts` holds this one to naming every spec in its package, so without it here a
 * row could be deleted and the check that would have caught it would not run.
 *
 * Listed rather than derived, because what a spec reads at a path it builds at runtime cannot be read off
 * the source. Repo-checks' *"prose costs nothing"* holds both directions: a guide not listed here is in no
 * step's fingerprint, and a guide listed here is in one — so an entry that stops applying fails rather than
 * quietly protecting nothing.
 */
export const GUIDES_A_CHECK_READS: ReadonlySet<string> = new Set(['packages/repo-checks/CLAUDE.md']);

/**
 * Whether a unit's `excludeSuffixes` puts this file outside its key.
 *
 * Exported for the same reason `skipsFingerprint` is: `chain-inputs.spec.ts` resolves a step's inputs to ask
 * what it covers, and that walk and this key have to agree about what an input *means*. Two implementations
 * of one rule is how they would stop agreeing.
 */
export const excludedBySuffix = (suffixes: readonly string[] | undefined, file: string): boolean =>
  suffixes !== undefined && suffixes.some((suffix) => file.endsWith(suffix));

/**
 * Whether a file under a unit's inputs is left out of its fingerprint whatever that unit declares.
 *
 * Exported so a check can ask the same question without hashing anything: the gate that holds the rule
 * above walks the inputs and filters with this, where taking a real fingerprint of all twelve chain steps
 * to answer it cost 1.5s and pushed its own spec into the other cost half.
 */
export const skipsFingerprint = (file: string): boolean =>
  !GUIDES_A_CHECK_READS.has(file) && isProse(file);

export function fingerprintInputs(
  inputs: readonly string[],
  exclude: readonly string[] = [],
  collect?: (file: string, digest: string) => void,
  tree: TreeReader = readTree,
  excludeSuffixes?: readonly string[],
): string {
  const hash = createHash('sha256');
  const excluded = exclude.map(repoRelative);
  const isExcluded = (file: string): boolean => skipsFingerprint(file)
    || excludedBySuffix(excludeSuffixes, file)
    || excluded.some((out) => covers(out, file));
  for (const file of [...new Set(inputs.flatMap((target) => tree.listInputs(target)))].sort().filter((f) => !isExcluded(f))) {
    // A hash over each file's digest rather than over its bytes — the same thing Bazel and Buck2 build an
    // action key from, and the reason a file declared by several units is read and hashed once rather than
    // once per unit. Measured 2026-10-01 over the 13 chain steps: 24 618 file-slots over 3 706 distinct
    // files, 283.8 MB against 57.3 MB, 680ms against 108ms. Only the memo makes that saving real, so the
    // digest comes from `tree` (see `freshnessSweep`) and never from a local hash of the bytes.
    const digest = tree.digest(file);
    hash.update(`${file}\0${digest}\0`);
    if (collect) collect(file, digest);
  }
  return hash.digest('hex');
}

/**
 * A unit's fingerprint: the paths it declares, and the bytes under its inputs. The paths are in it so a
 * unit that gains or loses a watched directory invalidates itself — and only itself. Hashing the input
 * contents alone would read the new set against the old stamp and call it fresh.
 */
export function fingerprintUnit(unit: BuildUnit, collect?: (file: string, digest: string) => void, tree?: TreeReader): string {
  return createHash('sha256')
    .update(declaredPaths(unit).join('\0'))
    .update('\0')
    // The command, where the unit has one. Hashed with the paths rather than with the bytes: it is a
    // property of the unit, not a file under it, and a unit that gains one must invalidate itself.
    .update(unit.command ?? '')
    .update('\0')
    // A unit's own output is never its own input, however broadly its inputs are declared. Two steps
    // declare a whole tree and then write into it — `build:default-setup` writes `src/__generated__` under the `src`
    // it reads, and the fixture-pack check writes each pack's `dist` under the `tests/packs` it reads —
    // which makes them self-invalidating the moment their build stops being byte-identical. Both were
    // surviving on the builds happening to be deterministic, and the pack build is already known not to be
    // (two lines of `Omit<…>` union ordering). Excluding self-output here means declaring `outputs`
    // honestly is the whole fix, rather than every such step needing its inputs hand-narrowed.
    .update(fingerprintInputs(unit.inputs, [...unit.outputs, ...(unit.excludes ?? [])], collect, tree, unit.excludeSuffixes))
    .digest('hex');
}

/**
 * The paths a unit declares, sorted and repo-relative — the first thing `fingerprintUnit` hashes.
 *
 * Exported because a stamp records it: a unit that gains a watched directory is stale before anything under it
 * has changed, and that is a different cause from a byte moving. Without the set on the stamp, the two arrive
 * as one verdict and a report of which *files* differ answers "none" while the step is genuinely stale.
 */
export const declaredPaths = (unit: BuildUnit): string[] =>
  [...unit.inputs, ...unit.outputs, ...(unit.excludes ?? [])].map(repoRelative).sort();

/** A unit's fingerprint and the per-file digests it is composed of, from one walk */
export function fingerprintWithDigests(unit: BuildUnit, tree?: TreeReader): { fingerprint: string; files: Record<string, string> } {
  const files: Record<string, string> = {};
  const fingerprint = fingerprintUnit(unit, (file, digest) => { files[file] = digest; }, tree);
  return { fingerprint, files };
}

/** Capture exact output membership and bytes separately from the inputs that produced them. */
export function outputDigests(unit: BuildUnit, tree: TreeReader = readTree): Record<string, string> {
  const files: Record<string, string> = {};
  for (const file of [...new Set(unit.outputs.flatMap(target => tree.listOutputs(target)))].sort()) {
    const digest = tree.digest(file);
    if (digest === ABSENT) throw new Error(`Build output disappeared while recording it: ${file}`);
    files[file] = digest;
  }
  return files;
}

/** What a stale unit's inputs did, against what a run recorded about them */
export interface InputChanges {
  /** Watched paths this unit has gained and lost — a cause on its own, before any file changes */
  readonly gained: readonly string[];
  readonly lost: readonly string[];
  /** Files under the inputs whose bytes differ from the record */
  readonly changed: readonly string[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

/**
 * Which of `unit`'s inputs differ from what a run recorded, so a report can name them instead of guessing.
 *
 * Pure, over digests taken here and digests handed in, because the same three sets are the answer whether the
 * record came from a stamp on disk or from a test. `changed` is only ever bytes: a file rewritten with the
 * bytes it already had appears in none of these, which is the whole point — mtime says it was written and the
 * cache does not care, and reading one as the other is what sent a diagnosis after the wrong file.
 */
export function changedInputs(unit: BuildUnit, recorded: { files: Record<string, string>; declared: readonly string[] }, tree?: TreeReader): InputChanges {
  const now = fingerprintWithDigests(unit, tree).files;
  const declared = new Set(recorded.declared);
  const wasDeclared = declaredPaths(unit);
  return {
    gained: wasDeclared.filter((declaredPath) => !declared.has(declaredPath)),
    lost: recorded.declared.filter((declaredPath) => !wasDeclared.includes(declaredPath)),
    changed: Object.keys(now).filter((file) => recorded.files[file] !== undefined && recorded.files[file] !== now[file]).sort(),
    added: Object.keys(now).filter((file) => recorded.files[file] === undefined).sort(),
    removed: Object.keys(recorded.files).filter((file) => now[file] === undefined).sort(),
  };
}

/**
 * The first input that moved, named, for a row that has no lines under it to spend.
 *
 * For a caller with one line per unit and no room beneath it: the chain's `--dry`, which a cold tree gives
 * twelve stale steps, and `staleMessage`, whose five call sites are each a person stopped. Both printed the
 * same sentence for every unit before this, which is the only verdict a healthy one can have.
 *
 * Here rather than in `scripts/lib/` because `@apackdev/host` may not import the repo's scripts
 * (`check:specifiers`' `findPackageScriptImports`), and it belongs beside `changedInputs`, whose answer it
 * summarises.
 *
 * The verb leads because the rows form a column: `changed`, `added` and `removed` line up where a path would
 * not. Empty when there is nothing to name, and the caller keeps its plain reason.
 */
export function firstChange(changes: InputChanges): string {
  const [gained, lost] = [changes.gained[0], changes.lost[0]];
  if (gained !== undefined || lost !== undefined) {
    const rest = changes.gained.length + changes.lost.length - 1;
    return `${gained === undefined ? `lost ${lost!}` : `gained ${gained}`}${rest > 0 ? ` (and ${rest} more)` : ''}`;
  }
  const [first] = [...changes.changed.map((file) => ({ file, how: 'changed' })),
    ...changes.added.map((file) => ({ file, how: 'added' })),
    ...changes.removed.map((file) => ({ file, how: 'removed' }))];
  if (first === undefined) return '';
  const rest = changes.changed.length + changes.added.length + changes.removed.length - 1;
  return `${first.how} ${first.file}${rest > 0 ? ` (and ${rest} more)` : ''}`;
}

export interface StaleUnit {
  readonly workspace: string;
  readonly reason: string;
  /**
   * What moved, when the unit's own stamp recorded enough to say — `firstChange` over `changedInputs`.
   *
   * Separate from `reason` rather than folded into it, for the reason the chain's report arrived at: the verdict
   * is one sentence every stale unit shares, and what moved is the part that differs. A reader formats them
   * apart; a producer that cannot say leaves this undefined and the message is what it was.
   */
  readonly moved?: string;
}

/**
 * The ordinary verdict, named because a reader compares against it.
 *
 * Every other reason `unitStaleReason` gives is about the stamp rather than the tree — no stamp, another format,
 * an output missing — and a step that has just passed can only have this one. The chain's report says it once in
 * its header instead of on every row, and needs to recognise the unusual case to keep printing it.
 */
export const INPUTS_CHANGED = 'its inputs changed since the last successful run';

/**
 * What a successful run recorded. `fingerprint` is the verdict; the rest is the diagnosis, and a stamp written
 * before those fields existed simply has none of them.
 *
 * **Every field is `unknown`, including the two a diff reads back as data.** This is parsed JSON, and typing
 * `declared` and `files` as the shapes they ought to be is what let three callers check them for `undefined`
 * and hand the rest straight to `changedInputs`, which trusts both. `diffableStamp` is the one place they are
 * narrowed, and these types are what make the compiler say so at every other site.
 */
export interface StampRecord {
  readonly workspace?: unknown;
  readonly fingerprint?: unknown;
  readonly takenAt?: unknown;
  readonly builtAt?: unknown;
  readonly declared?: unknown;
  readonly files?: unknown;
  readonly outputFiles?: unknown;
}

/** A stamp as it was written, or undefined when there is none to read — the one place this file is parsed */
export function stampRecord(stamp: string): StampRecord | undefined {
  try {
    return JSON.parse(fs.readFileSync(stamp, 'utf-8')) as StampRecord;
  } catch {
    return undefined; // missing or unreadable: the same as never built
  }
}

/** A stamp narrowed to what a diff may read: the verdict's own string, the two sets it compares, and the run's brackets */
export interface DiffableStamp {
  readonly fingerprint: string;
  readonly declared: readonly string[];
  readonly files: Record<string, string>;
  /** When the run started and finished, where it recorded them — a diagnosis, so absence is not a failure */
  readonly takenAt?: string;
  readonly builtAt?: string;
}

const isDigestMap = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && Object.values(value).every((digest) => typeof digest === 'string');

const isPathList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const recordedTime = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/**
 * A stamp as something a diff may read, or why it is not one — **the one place this format is checked**.
 *
 * **There is no format version, and the one this had could not have earned its keep.** A stamp records a
 * measurement rather than a decision: it holds a hash, and the other side of the comparison is recomputed here,
 * by today's code, from today's tree. Every policy that decides anything — `skipsFingerprint`, `declaredPaths`,
 * a unit's `command`, the digest function — is inside the preimage, so a change to one moves the digest of
 * exactly the units it affects and a stamp written under the old one comes out *unequal* rather than misread.
 * Coming out wrongly **equal** would take a collision. An integer beside that could only force re-runs somebody
 * had decided they wanted, which `npm run chain -- --all` does per run and per machine instead; the field was
 * bumped and reverted three times before it went, each time for a change the preimage had already covered.
 *
 * What does need checking is the half a verdict never touches. `declared` and `files` are read back as **data**
 * by `changedInputs`: a digest map whose values are not digests makes it report every file as changed, and a
 * declared set that is not a list makes it throw. Both are properties of the bytes on disk, which this can see
 * for itself — where a version could only ever say that someone had remembered.
 *
 * One message covers both, and names neither: it said *digests* while firing for a bad `declared` set too, which
 * sends a reader to the field that was fine. They are one thing to a caller — what the run recorded about what
 * it read — and that is what the words say.
 *
 * The three answers are in `unitStaleReason`'s own order, and the first clause is the same predicate it uses,
 * because the verdict and the explanation disagreeing is a line that has shipped: `its stamp is from another
 * format (0, this is 1) — changed src/a.ts`. The wording sits after a name — a workspace, a project — which is
 * why none of it starts with a subject.
 */
export function diffableStamp(record: StampRecord | undefined):
  | { readonly stamp: DiffableStamp; readonly undiffable?: undefined }
  | { readonly stamp?: undefined; readonly undiffable: string } {
  if (typeof record?.fingerprint !== 'string') return { undiffable: 'has not run yet' };
  const { declared, files } = record;
  if (declared === undefined || files === undefined) return { undiffable: 'its last run recorded no per-file digests' };
  if (!isPathList(declared) || !isDigestMap(files)) return { undiffable: 'its record of what it read is in a shape this cannot read' };
  return { stamp: { fingerprint: record.fingerprint, declared, files, takenAt: recordedTime(record.takenAt), builtAt: recordedTime(record.builtAt) } };
}

/**
 * Why `unit` needs to run, or null when its stamp says a run over exactly these inputs succeeded. Never
 * throws. The wording is deliberately not about building: the chain's steps go through this too, and most
 * of them are checks that produce nothing (`stampedRun`, `scripts/chain.ts`).
 */
export function unitStaleReason(unit: BuildUnit, stamp: string, tree?: TreeReader): string | null {
  const missing = unit.outputs.filter((output) => !fs.existsSync(output)).map(repoRelative);
  if (missing.length > 0) return `not built (no ${missing.join(', ')})`;
  const record = stampRecord(stamp) ?? {};
  if (!diffableStamp(record).stamp || !isDigestMap(record.outputFiles)
    || !Object.values(record.outputFiles).every(value => /^[a-f0-9]{64}$/.test(value))) {
    return 'no stamp — no valid successful input/output record';
  }
  try {
    if (record.fingerprint !== fingerprintUnit(unit, undefined, tree)) return INPUTS_CHANGED;
    return isDeepStrictEqual(record.outputFiles, outputDigests(unit, tree))
      ? null : 'its outputs changed since the last successful run';
  } catch (err) {
    return `its inputs or outputs could not be read (${(err as Error).message})`;
  }
}

/**
 * One reading of the tree, shared by every question asked of this sweep.
 *
 * Units overlap heavily — measured on this repo, twelve chain steps declare 18,001 files between them and only
 * 3,518 distinct ones, and 807 declared targets of which 311 are distinct. So the primitive reads `packages/*`
 * and the shared trees five times over and walks them nearly three times over. Through a sweep each file is read
 * once (456ms of reading and hashing becomes 153ms) and each target walked once (129ms becomes 30ms), and the
 * fingerprints come out byte-identical, because what is shared is the looking and not the derivation.
 *
 * **A sweep must not outlive the one question it was made for.** It answers as of its first read of each file, so
 * a sweep kept across time reports a tree that has moved on. Holding an object is what makes that somebody's
 * decision rather than a default they inherit.
 *
 * **The chain's dispatch decisions use one too, and what makes that sound is the graph rather than this
 * function.** Every reader of a step's output is ordered after that step, because `dependsOn` *is* that
 * relation — derived from `outputs` landing in `inputs`, not declared beside them. A sweep reads lazily, so
 * the first read of any path that some step produces happens after that step has finished. There is no
 * window in which a shared reading holds bytes a later step has overwritten.
 *
 * The sentence this replaced predates that: `needs` was hand-written beside inputs that only implied it, so
 * two records could disagree and reading per step was a net under a property nobody had made structural.
 * Measured on this repo, per-step reads cost 1715ms against 189ms shared, over 28 steps.
 *
 * `forget` is kept as a local net rather than a load-bearing part, and the honest note is that **no
 * end-to-end case distinguishes having it from not**: editing a package's source so `packages:ensure`
 * rebuilds makes `packages:check` re-run either way, because it is ordered after the rebuild and reads the
 * tree for the first time there. What would make this load-bearing is a step reading a path it is not
 * ordered after — which `sweep-forget.spec.ts` holds to zero for transient writes, the one kind that
 * creates a mutex instead of an edge.
 *
 * What a sweep cannot see either way is a write from outside the chain — an editor saving mid-run. Neither
 * can per-step reads, for any step already dispatched; and `willNotCache` reads the tree afresh once
 * everything has stopped and names every step that passed and is already stale again.
 */
export function freshnessSweep(): {
  staleReason: (unit: BuildUnit, stamp: string) => string | null;
  changedInputs: (unit: BuildUnit, recorded: { files: Record<string, string>; declared: readonly string[] }) => InputChanges;
  /** Drop what this sweep remembers under these paths, because something has just written there */
  forget: (paths: readonly string[]) => void;
} {
  const walked = new Map<string, string[]>();
  const outputWalked = new Map<string, string[]>();
  const seen = new Map<string, Buffer | null>();
  const digests = new Map<string, string>();
  const tree: TreeReader = {
    listInputs: (target) => {
      if (!walked.has(target)) walked.set(target, readTree.listInputs(target));
      return walked.get(target)!;
    },
    listOutputs: (target) => {
      if (!outputWalked.has(target)) outputWalked.set(target, readTree.listOutputs(target));
      return outputWalked.get(target)!;
    },
    // `has`, not a truthy check: `null` is an answer — the file was not there when this sweep looked
    read: (file) => {
      if (!seen.has(file)) seen.set(file, readTree.read(file));
      return seen.get(file) ?? null;
    },
    // The one that pays: the units this sweep is asked about overlap 6.64x, so without it the same bytes
    // are hashed six times over and only the reading was ever shared.
    digest: (file) => {
      if (!digests.has(file)) digests.set(file, digestOf(tree.read(file)));
      return digests.get(file)!;
    },
  };
  /**
   * Everything remembered at or under `target`, by prefix rather than by exact key.
   *
   * A caller declares `packages/apack-ears/dist`; what is memoised are the files inside it and the listing
   * of it, so forgetting the one key it was handed would leave every file under it stale in the maps. The
   * listing goes too — a build that adds or removes a file changes what a walk returns, not only what the
   * files contain.
   *
   * **The three maps are not keyed alike, which is the trap.** `walked` is keyed on the target as the caller
   * spells it, absolute; `seen` and `digests` are keyed on what `list` returns, which is repo-relative with
   * forward slashes. Clearing one key space and not the other re-walks the directory and then answers from
   * the bytes it read before — fresh, over a file that moved. `sweep-forget.spec.ts` caught exactly that.
   */
  const under = (map: Map<string, unknown>, target: string, sep: string): string[] =>
    [...map.keys()].filter((key) => key === target || key.startsWith(`${target}${sep}`));

  return {
    staleReason: (unit, stamp) => unitStaleReason(unit, stamp, tree),
    changedInputs: (unit, recorded) => changedInputs(unit, recorded, tree),
    forget: (paths) => {
      for (const target of paths) {
        const relative = repoRelative(target);
        for (const key of under(walked, target, path.sep)) walked.delete(key);
        for (const key of under(outputWalked, target, path.sep)) outputWalked.delete(key);
        for (const key of under(seen, relative, '/')) seen.delete(key);
        for (const key of under(digests, relative, '/')) digests.delete(key);
      }
    },
  };
}

/** Every workspace of `packages:build` that needs building — empty when all of them are up to date */
export function stalePackageUnits(): StaleUnit[] {
  // One reading of the tree across the five, as `--dry` does for the chain's steps: they overlap — every
  // bundled unit reads `packages/apack-host/src` — and the question is asked of all of them at one moment.
  // The verdict goes through it too, not only the diff: two readings can describe two different trees, and
  // sharing pays on the fresh path as well, which is the one that runs eighteen times in a serial chain
  const sweep = freshnessSweep();
  return Object.entries(BUILD_UNITS).flatMap(([workspace, unit]) => {
    const reason = sweep.staleReason(unit, stampFile(workspace));
    // The diff is only for a unit already known to be stale — one about to cost a 14s build — so the path that
    // runs eighteen times in a serial chain, and finds nothing, still costs a stat and a return
    return reason === null ? [] : [{ workspace, reason, moved: whatMovedUnder(unit, stampFile(workspace), sweep) }];
  });
}

/**
 * What moved under a unit, for a message that has a line to spend on it — or undefined when its stamp cannot say.
 *
 * Undefined is a real answer here and not a failure: a stamp written before the digests were recorded has a
 * fingerprint and nothing to diff against, and `node_modules/.cache` is never cleared, so those exist on machines
 * today. The message then reads as it always did.
 */
function whatMovedUnder(unit: BuildUnit, stamp: string, sweep: ReturnType<typeof freshnessSweep>): string | undefined {
  // Nothing rather than a message: the reason this is a suffix to already says why, and a second sentence
  // repeating it would be the widest part of the line
  const { stamp: recorded } = diffableStamp(stampRecord(stamp));
  if (recorded === undefined) return undefined;
  const moved = firstChange(sweep.changedInputs(unit, recorded));
  return moved === '' ? undefined : moved;
}

export const staleMessage = (stale: readonly StaleUnit[]): string =>
  // One line per unit, which a case pins: a reader counts them against "Rebuilding N of M". So what moved is a
  // suffix rather than a line of its own
  stale.map(({ workspace, reason, moved }) => `  ${workspace}: ${reason}${moved === undefined ? '' : ` — ${moved}`}`).join('\n');

interface LockHolder { pid: number; label: string; startedAt: string }

/**
 * Whether the build that took the lock is still running: its pid exists, and it started in this boot.
 *
 * The same rule as `recordIsStale` in `@apackdev/host/process-liveness`, deliberately not that function. This module is
 * the freshness rule the package builds themselves run through, so it resolves the packages' published
 * `dist` — which, while they are being built, is the stale copy that has yet to export anything new. It
 * bounds by the lock's own `startedAt` rather than a file's mtime, which is the better of the two rules:
 * an mtime is whatever last touched the file, a recorded `startedAt` is the writer saying when it began.
 */
function holderIsRunning(holder: LockHolder): boolean {
  try {
    process.kill(holder.pid, 0);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EPERM') return false;
  }
  // Pids are recycled: after a reboot a crashed build's lock names whatever took its number
  const startedAt = Date.parse(holder.startedAt);
  return Number.isFinite(startedAt) && startedAt >= Date.now() - os.uptime() * 1000;
}

/**
 * The build running right now, if one is. A reader of the stamps needs this: a build removes each stamp
 * before it rewrites it, so anything checking freshness while one runs sees units that look unbuilt and
 * would otherwise report them as stale, telling the reader to run the build that is already running.
 */
export function runningPackageBuild(file = LOCK_FILE): { pid: number; label: string; startedAt: string } | undefined {
  const holder = readLock(file);
  return holder && holderIsRunning(holder) ? holder : undefined;
}

/**
 * A build holder as a reader is told about it, which `withBuildLock`'s refusal already words this way.
 * `null` is a lock file whose contents this version cannot read — it says the lock was there and no more.
 */
const describeHolder = (holder: LockHolder | null): string =>
  (holder === null ? 'an unreadable lock file' : `pid ${holder.pid} (${holder.label}, started ${holder.startedAt})`);

/**
 * Who rebuilt the packages under a run that had already built them, as `PackagesWentStale` names them.
 *
 * **`waitedFor` is the one that answers in the ordinary case, and it is the only one that can.** By the time
 * staleness is read the writer has finished — that is what let the reader past `waitForPackageBuild` — so
 * there is no lock left to look at. What the wait returns is therefore the whole of the evidence, and
 * discarding it is why this error said "something" for as long as it did.
 *
 * A lock still on disk means one of three things, none of them the ordinary case: a writer that crashed
 * (its record survives and names it), one wedged past the wait's bound, or one that arrived in the moment
 * between the wait returning and the stamps being read. Each is worth naming, and whether it is still
 * running is the part that tells them apart.
 *
 * With neither, nothing that takes the build lock did this. That is a fact rather than a shrug: it was
 * something that writes `dist` without taking the lock — an editor, a tool outside it, another session.
 *
 * **It does not read the chain's lock.** A process throwing this is a child of the chain run that holds
 * `chain.lock`, so reading it names this run rather than whoever interfered — and since `holdChainLock`
 * admits one chain per checkout, a second chain cannot be the writer.
 */
export function packageWriter(waitedFor: string | undefined, file = LOCK_FILE): string {
  if (waitedFor !== undefined) {
    return `${waitedFor} held the build lock during this run and released it, so its rebuild is what moved them`;
  }
  if (!fs.existsSync(file)) {
    return 'nothing took the build lock, so this was a writer that does not — an editor, a tool outside the '
      + 'lock, or another session in this checkout';
  }
  const holder = readLock(file);
  const running = holder !== null && holderIsRunning(holder);
  return `${describeHolder(holder)} holds the build lock now and ${running ? 'is still running' : 'is gone, having left its lock behind'}`;
}

/** A synchronous pause, for the module-level readers below, which cannot await */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Waits for an in-flight package build to finish, and returns the build it waited for. A reader of the
 * stamps wants this rather than `runningPackageBuild` alone: a build removes each stamp before rewriting
 * it, so a reader that checks freshness mid-build sees units that look unbuilt and reports them stale,
 * telling the reader to run the build that is already running. Waiting turns that into the pause it
 * actually is — the point at which two suites can share one checkout.
 *
 * It waits on the lock rather than on the stamps, because only the lock says a build is in progress; a
 * missing stamp cannot tell "being rebuilt now" from "never built". The timeout is a bound, not a
 * schedule: it returns as soon as the holder is gone, and a holder that outlives it leaves the caller to
 * report staleness as before, which is the pre-existing behaviour rather than a hang.
 */
export function waitForPackageBuild({ timeoutMs = LOCK_WAIT_MS, pollMs = LOCK_POLL_MS }: { timeoutMs?: number; pollMs?: number } = {}): LockHolder | undefined {
  const waitedFor = runningPackageBuild();
  if (!waitedFor) return undefined;
  const deadline = Date.now() + timeoutMs;
  while (runningPackageBuild() && Date.now() < deadline) sleepSync(pollMs);
  return waitedFor;
}

/**
 * Whether every build unit's output exists — the question a spec that reads the built packages asks before
 * it runs — refusing outright when what is there is stale.
 *
 * Checker 6 of the package-freshness doors (they are listed in `packages/apack-testing/CLAUDE.md`). A
 * suite's `pretest` builds what is stale; this is what catches a run that bypassed it (`npx vitest`, a
 * watch run), and it refuses rather than testing output that no longer matches the source beside it.
 * Importing it never builds — that is the pretest's job, in its own process.
 *
 * `buildCommand` is the caller's own way of getting them built, because a message naming another package's
 * command sends the reader somewhere they have no reason to be.
 */
/**
 * Run the specs that read the built packages against an unbuilt tree anyway, knowing they will skip.
 *
 * The refusal above is not gated on `CI`, which is the obvious place for it and the wrong one here: this
 * repo's CI is off by design, so a CI-gated refusal never fires, and thirteen spec files — nine of them all
 * of `@app/publish-checks` — reported green having checked nothing. Every gated path (`test:unit`, `chain`,
 * a package's `pretest`) runs `packages:ensure` first, so refusing costs those nothing; what it changes is a
 * bare run against an unbuilt tree, which now says so.
 */
export const ALLOW_UNBUILT = 'APACK_ALLOW_UNBUILT';

/** Why a caller may not proceed on an unbuilt tree, or `null` when it may */
export const unbuiltRefusal = (built: boolean, buildCommand: string, env: NodeJS.ProcessEnv = process.env): string | null =>
  built || env[ALLOW_UNBUILT] === '1'
    ? null
    : `Specs that read the built packages need them built. Run: ${buildCommand}\n`
      + `To run them anyway, knowing they will check nothing: ${ALLOW_UNBUILT}=1`;

export function packagesBuiltOrRefuse(buildCommand: string): boolean {
  // Another process may be building right now, and a build removes each output and stamp before rewriting
  // it: both checks below would then read a half-built tree and refuse — which is what made a suite
  // started alongside `test:external-pack` fail about the race rather than about the code. Waiting is what
  // lets two suites share one checkout.
  waitForPackageBuild();
  const built = Object.values(BUILD_UNITS).every((unit) => unit.outputs.every((output) => fs.existsSync(output)));
  const refusal = unbuiltRefusal(built, buildCommand);
  if (refusal !== null) throw new Error(refusal);
  const stale = built ? stalePackageUnits() : [];
  if (stale.length > 0) {
    throw new Error(`The published packages are out of date:\n${staleMessage(stale)}\nRun: ${buildCommand}`);
  }
  return built;
}

/**
 * The lock's holder, or `null` for a file this cannot make a holder out of — absent, unparseable, or parsed
 * into something without the two fields every reader here goes on to use.
 *
 * **The fields are checked, not assumed.** Without that, a lock holding anything else parses into a holder
 * whose `pid` is `undefined`: `holderIsRunning` then reads it as not running, so a live writer's lock is
 * ignored and the reader walks into the race the lock exists to prevent, and `describeHolder` renders
 * `pid undefined (undefined, …)`. `exclusive-lock.ts`'s own `readLock` has always checked; this one had not.
 */
function readLock(file: string): LockHolder | null {
  try {
    const held = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<LockHolder> | null;
    if (typeof held?.pid !== 'number' || typeof held.label !== 'string') return null;
    return { pid: held.pid, label: held.label, startedAt: String(held.startedAt ?? '') };
  } catch {
    return null;
  }
}

/**
 * Why this process wants to build, which decides what it does when another build already holds the lock.
 *
 * A `command` is someone asking for a build — `npm run packages:build`, `apack pack build`. It fails at once
 * naming the holder, because the person wants to know, and it builds whether or not the output is already
 * fresh, because they asked for a build.
 *
 * A `freshness` fix is a process that wants the packages *built* and does not care who builds them — a
 * suite's pretest, `ensurePackagesBuilt`. It waits for a live holder rather than failing, and once it has
 * the lock it checks again, because the build it waited for has very likely just done the work. Without
 * that second check the waiting only moves the duplicate build later; without the wait, two processes that
 * both found the same units stale race, and the one that reaches the lock second fails on a lock rather
 * than on anything about the code.
 */
export type BuildIntent = 'command' | 'freshness';

/** Set by `ensurePackagesBuilt` on the builds it spawns, since the intent has to cross a process boundary */
export const BUILD_INTENT_ENV = 'APACK_APP_INTENT';

const intentFromEnv = (): BuildIntent => (process.env[BUILD_INTENT_ENV] === 'freshness' ? 'freshness' : 'command');

/**
 * Runs `run` holding the repo's package-build lock, so two builds never clear and rewrite the same
 * output at once. A lock whose process is gone is taken over. A live holder fails at once for a
 * `command` and is waited for by a `freshness` fix (see `BuildIntent`). Written then `link`ed, so a
 * reader never sees a half-written holder and mistakes it for an abandoned lock.
 */
export interface BuildLockOptions {
  readonly intent?: BuildIntent;
  /** How long a `freshness` fix waits. Injectable so a test can bound it: the default outlasts any suite. */
  readonly timeoutMs?: number;
}

export interface StampedBuildOptions extends BuildLockOptions {
  /** The lock to hold, for a test building a fixture against its own; the repo's by default */
  readonly lock?: string;
}

export async function withBuildLock<T>(label: string, run: () => T | Promise<T>, file = LOCK_FILE, options: BuildLockOptions = {}): Promise<T> {
  const intent = options.intent ?? intentFromEnv();
  const waitMs = options.timeoutMs ?? LOCK_WAIT_MS;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const pending = `${file}.${process.pid}`;
  /**
   * Removes the lock on the way out, however this process ends. Idempotent, and only ever this process's own.
   *
   * **Node runs no `exit` handler for a signal**, so without these a Ctrl-C'd `packages:build` left its lock
   * behind for the next arrival to take over — which works, and costs that arrival the wait and a message
   * about a holder that is gone. `exclusive-lock.ts` has had this since it existed; this lock had not.
   */
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    process.off('exit', release);
    for (const signal of INTERRUPTS) process.off(signal, onInterrupt);
    // Only if it is still ours: a build that overran a stolen lock must not delete the new holder's
    if (readLock(file)?.pid === process.pid) fs.rmSync(file, { force: true });
  };
  function onInterrupt(signal: NodeJS.Signals): void {
    release();
    // Re-raised so the caller's view of how it ended is the signal rather than a clean exit
    process.kill(process.pid, signal);
  }
  // Registered before the lock exists, not after: a process descheduled between taking it and getting here
  // would be killed by the default disposition and leave it behind — the very thing these are for
  process.once('exit', release);
  for (const signal of INTERRUPTS) process.once(signal, onInterrupt);
  fs.writeFileSync(pending, JSON.stringify({ pid: process.pid, label, startedAt: new Date().toISOString() }));
  try {
    const deadline = Date.now() + waitMs;
    // Counted separately from the loop: a `freshness` fix goes round it many times without taking anything
    // over, and taking over twice is what means the lock is not being released rather than merely held.
    for (let takeovers = 0; ; ) {
      try {
        fs.linkSync(pending, file);
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        const holder = readLock(file);
        const live = holder !== null && holderIsRunning(holder);
        if (live && intent === 'freshness' && Date.now() < deadline) {
          sleepSync(LOCK_POLL_MS);
          continue;
        }
        if (takeovers > 0 || holder === null || live) {
          const who = describeHolder(holder);
          const waited = intent === 'freshness' ? ` after waiting ${Math.round(waitMs / 1000)}s` : '';
          throw new Error(`another package build holds ${repoRelative(file)}${waited}: ${who}. Wait for it to finish, then run this again.`);
        }
        takeovers++;
        fs.rmSync(file, { force: true });
      }
    }
  } finally {
    fs.rmSync(pending, { force: true });
  }
  try {
    return await run();
  } finally {
    release();
  }
}

/**
 * Runs `build` under the lock, between clearing the stamp and writing a new one, so the stamp exists
 * only where a build of exactly these inputs returned. The fingerprint is taken before the build
 * touches anything, so a source edited while it runs is recorded as not built.
 */
export async function stampedBuild(
  label: string,
  unit: BuildUnit,
  stamp: string,
  build: () => void | Promise<void>,
  options: StampedBuildOptions = {},
): Promise<void> {
  const { lock, ...lockOptions } = options;
  const intent = options.intent ?? intentFromEnv();
  await withBuildLock(label, async () => {
    // A `freshness` fix that waited for the lock asks again now it holds it: the build it waited for was
    // very likely building this same unit, and rebuilding what is already fresh is the duplicate work the
    // wait exists to avoid. A `command` builds regardless — it was asked for a build, not for freshness.
    if (intent === 'freshness' && unitStaleReason(unit, stamp) === null) return;
    // Every `build:package` script stages its tree and renames it into place (`replaceDir`), so its stamp
    // stays readable for the length of the build
    await stampedRun(label, unit, stamp, build, { atomic: true });
  }, lock, { ...lockOptions, intent });
}

/**
 * `run` between clearing the stamp and writing a new one, with no lock. The chain's steps stamp through
 * this: they are not package builds and must not queue behind the build lock, but the stamp they write has
 * to be the same protocol — one `fingerprintUnit`, one writer, one reader.
 *
 * The fingerprint is taken before `run` touches anything, so a source edited while it runs is recorded as
 * not done. The stamp is written only where `run` returned, so an interrupted step reads as never run.
 */
export interface StampedUnit {
  readonly label: string;
  readonly unit: BuildUnit;
  readonly stamp: string;
}

/**
 * One run, several stamps: every unit is fingerprinted **before** the run starts, and each stamp is written
 * only if it returned.
 *
 * Taking all the fingerprints first is the part worth keeping. A unit pool runs one vitest over several
 * projects, and fingerprinting each one as its own stamp was written measured the units after the first
 * against a tree the run had already begun touching. Nothing writes into a unit's inputs today, so the
 * readings were identical — correct by luck rather than by construction. The day a suite rewrites something
 * under its own `tests/` or `etc/` while it runs (a `content-parity:update`, a recorded snapshot), a later unit
 * would stamp a fingerprint of the output instead of the input and read fresh next time when it was not.
 */
export async function stampedRunAll(
  units: readonly StampedUnit[],
  run: () => void | Promise<void>,
  /**
   * Whether `run` replaces its outputs by renaming rather than writing over them — see the run below.
   *
   * Several output swaps are not one filesystem transaction. If interrupted between swaps,
   * the retained prior record rejects the partial replacement through its output digests.
   */
  { atomic = false }: { atomic?: boolean } = {},
): Promise<void> {
  const takenAt = new Date().toISOString();
  const taken = units.map(({ label, unit, stamp }) => ({ label, unit, stamp, declared: declaredPaths(unit), ...fingerprintWithDigests(unit) }));
  const drop = () => { for (const { stamp } of taken) fs.rmSync(stamp, { force: true }); };
  // Atomic writers may retain the prior record during publication. Output evidence makes a
  // partial replacement stale even if inputs are unchanged and the process never reaches catch.
  if (!atomic) drop();
  try {
    await run();
    const completed = taken.map(record => ({ ...record, outputFiles: outputDigests(record.unit) }));
    const builtAt = new Date().toISOString();
    for (const { label, stamp, fingerprint, declared, files, outputFiles } of completed) {
      fs.mkdirSync(path.dirname(stamp), { recursive: true });
      fs.writeFileSync(stamp, `${JSON.stringify({ workspace: label, fingerprint, takenAt, builtAt, declared, files, outputFiles }, null, 2)}\n`);
    }
  } catch (err) {
    drop();
    throw err;
  }
}

/** The single-unit case, which is most callers */
export async function stampedRun(
  label: string,
  unit: BuildUnit,
  stamp: string,
  run: () => void | Promise<void>,
  options: { atomic?: boolean } = {},
): Promise<void> {
  await stampedRunAll([{ label, unit, stamp }], run, options);
}

/** Every `build:package` script wraps its work in this */
export async function runPackageBuild(workspace: string, build: () => void | Promise<void>): Promise<void> {
  const unit = BUILD_UNITS[workspace];
  if (!unit) throw new Error(`No build unit for ${workspace} in BUILD_UNITS (@apackdev/host/build/packages-built)`);
  await stampedBuild(workspace, unit, stampFile(workspace), build);
}

/**
 * Set by a caller that has already built the publishable packages, so staleness under it is the tree moving
 * mid-run rather than work left to do. `npm run chain` sets it on every step but `packages:ensure`, which is
 * the step that does the building — and what licenses that is a property of the chain's graph: all 27 other
 * steps are transitively ordered after it (`chain-graph.spec.ts` holds this, and it is what would have to
 * change first). It had no writer at all from 2026-09-24 until 2026-10-02, so the refusal below could not
 * happen and a package rewritten under a reader raced a rebuild instead of being reported.
 */
export const PACKAGES_PREBUILT_ENV = 'APACK_PACKAGES_PREBUILT';

/**
 * Thrown where the caller set `PACKAGES_PREBUILT_ENV=1` and a package went stale anyway: something
 * rebuilt or edited it while this run was reading it. `npm run chain` sets it for its parallel steps,
 * because the alternative is two of them rebuilding one `dist` at once.
 */
export class PackagesWentStale extends Error {
  constructor(readonly stale: readonly StaleUnit[], readonly writer: string) {
    super(`the published packages went stale during a run that had already built them:\n${staleMessage(stale)}\n`
      + `Who rebuilt them: ${writer}.\n`
      + 'Nothing was rebuilt here, because that would race the writer.');
  }
}

/** Thrown when the build itself failed, so the caller doesn't report a check error as one */
export class PackagesBuildFailed extends Error {
  constructor(readonly status: number, readonly workspace?: string) {
    super(workspace ? `building ${workspace} failed` : 'npm run packages:build failed');
  }
}

/**
 * One workspace's build, as a freshness fix.
 *
 * One at a time, not `packages:build`, which rebuilds all five whenever one is stale. The units are
 * independent: every build resolves the other packages under the source condition (their tsconfigs'
 * `customConditions`, `bundle-package.ts`'s esbuild conditions), so none reads another's dist and no order is
 * implied. The workspace is named explicitly and the cwd is the repo, so this runs the right script even as a
 * workspace's own pretest. `freshness` rather than `command`, because another process may be building this
 * same unit right now and the right answer is to wait for it and then find the work done.
 */
function buildOnePackage(workspace: string): void {
  // npm is a shell script on Windows, which execFile cannot spawn without one
  const windows = process.platform === 'win32';
  try {
    execFileSync(windows ? 'npm.cmd' : 'npm', ['run', 'build:package', '-w', workspace],
      { cwd: REPO_ROOT, stdio: 'inherit', shell: windows, env: { ...process.env, [BUILD_INTENT_ENV]: 'freshness' } });
  } catch (err) {
    const status = (err as { status?: number }).status;
    throw new PackagesBuildFailed(typeof status === 'number' && status !== 0 ? status : 1, workspace);
  }
}

/**
 * The four things `ensurePackagesBuilt` does, each injectable **so that a case can reach the refusal below**.
 *
 * Without a seam here the refusal had none: its subject is the repo's own packages, and a spec that makes one
 * of them stale has to delete a real cache stamp — which races every other suite in the checkout, and which
 * this file's own rule forbids ("a spec must never build the repo's packages"). So it sat unexercised from
 * 2026-09-24, next to a flag nothing set, and the pair read as working.
 *
 * The wait is one of the four for a reason found in review: a case that injects the other three still took the
 * repo's real build lock, and would sit behind a concurrent `packages:build` for `LOCK_WAIT_MS` before any
 * injected answer was consulted — the shared state the seam exists to keep out of a unit test.
 */
export interface EnsurePackagesOptions {
  /**
   * How it waits for a build already in flight; a case replaces it rather than taking the repo's lock.
   *
   * It returns a description of the holder it waited for, or nothing where no build was running — which is
   * what lets `PackagesWentStale` name the writer. The description rather than the holder, so `LockHolder`
   * stays private to this module and a case passes a string.
   */
  readonly wait?: () => string | undefined;
  /** How it learns what is stale */
  readonly stale?: () => StaleUnit[];
  /** How it fixes one; a case asserts the refusal called this for nothing, which is the half that matters */
  readonly build?: (workspace: string) => void;
  /** Where the report goes. Synchronous by default: a message written just before exit must not sit in a pipe */
  readonly report?: (message: string) => void;
}

/** Builds every publishable package when any of them is stale; a no-op when they are all up to date */
export function ensurePackagesBuilt({
  wait = () => {
    const waitedFor = waitForPackageBuild();
    return waitedFor && describeHolder(waitedFor);
  },
  stale: staleUnits = stalePackageUnits,
  build = buildOnePackage,
  report = (message: string) => { fs.writeSync(2, message); },
}: EnsurePackagesOptions = {}): void {
  // Another process may be building them right now — two test suites started together each run this as
  // their pretest. Wait for that build rather than reading the stamps it is rewriting and starting a
  // second one, which is a race that fails the reader with "no stamp".
  // Kept, not discarded: by the time staleness is read this writer has finished, so what the wait saw is the
  // only evidence of who it was (`packageWriter`)
  const waitedFor = wait();
  const stale = staleUnits();
  if (stale.length === 0) return;
  // A caller that has already built them is asserting nothing will go stale under it, so staleness here
  // means the tree moved mid-run and whatever this process is about to read is half-written. Building it
  // would race the writer; saying so stops two processes fighting over one dist and reports the real
  // problem instead of the build error it turns into.
  if (process.env[PACKAGES_PREBUILT_ENV] === '1') {
    throw new PackagesWentStale(stale, packageWriter(waitedFor));
  }
  report(`Published packages are out of date:\n${staleMessage(stale)}\nRebuilding ${stale.length} of ${Object.keys(BUILD_UNITS).length}\n`);
  for (const { workspace } of stale) build(workspace);
}

/**
 * This module's exports that consult a stamp store, named so a check can ask whether a runner calls one.
 *
 * **Declared here rather than in the check, and as the functions rather than their names.** Only three of
 * this module's exports read a stamp, so the population cannot come from the specifier the way
 * `child_process`'s spawners can — something has to say which. Saying it here puts it in front of whoever
 * adds the fourth, where a list in `chain-table.spec.ts` was a hand-written population two files away that
 * nothing would notice had gone short. Holding the functions and not string literals is what makes a rename
 * a compile error instead of a check that quietly stops matching.
 *
 * What reads it: `chain-table.spec.ts` asks whether a chain step's runner *calls* one of these, because a
 * step whose runner consults its own stamps needs `forceArgs` or the chain's `--all` would skip its work.
 */
export const STAMP_READERS = { ensurePackagesBuilt, stalePackageUnits, unitStaleReason } as const;
