/**
 * What the compiler says it read, as a dep file.
 *
 * A **dep file** is the build-system name for a tool reporting its own input set after the fact —
 * Buck2's `dep_files`, Ninja's `depfile`, `gcc -MD`. TypeScript writes one whenever `incremental` is on,
 * and every typecheck leg in this repo sets it (`tsBuildInfoFile`, into `node_modules/.cache/tsbuildinfo`,
 * which is why it survives a `dist` clean and is absent on a fresh clone).
 *
 * **It is a proxy, in this repo's taxonomy** (root `CLAUDE.md`, "Three kinds of recorded file"): it
 * records what was read *last* time, so it can go stale from an input nobody listed. It is the known
 * unsoundness of dep files
 * generally, and it is why Bazel pairs them
 * with sandboxing and Gradle pairs them with "undeclared means uncacheable". Here it is paired with
 * `trustworthy()` below and with the rule that a missing dep file is not a cacheable state.
 *
 * **Buck2 uses `dep_files` to prune rather than to key, and that was measured here and declined.** The
 * pruning shape is sound where keying is not: leave the declared set as the key, and when it says stale,
 * skip anyway if every file that *moved* is one this file says was never read — never on an addition or a
 * removal, which are the cases that change resolution without changing a file anyone read, and which
 * `changedInputs` already reports apart from modifications. What it would buy, measured 2026-10-02 over
 * single-file edits: **one or two of the stale typecheck legs per edit**, not fifteen. An edit to
 * `apack-ears/src/edge-store.ts` makes 18 legs stale, and 11 of them genuinely compiled it — everything
 * resolves that source under the `@apackdev/source` condition — while 6 of the 18 have no dep file to prune
 * with at all. Against that: 52ms to parse all 16 of these on every chain invocation, a 6% tax on the 0.9s
 * warm floor, and a new stamp field to tie a dep file to the run that was stamped, since a dep file from a
 * failed run records a subset and would prune too much.
 *
 * **The number that makes it moot is where the time is.** The 18 legs are 49s of the chain's 423s, and the
 * critical path is 125s through `packages:ensure -> build:default-setup -> build:runtime -> test:packaged-authoring`; none
 * of the five most expensive steps is a leg. Pruning every leg to zero would leave that path untouched.
 *
 * Do not read "the legs declare far more than they read" as slack: they do (0-21% of declared files are
 * read), but the padding is `dist` trees and configs that rarely change, while the source that does change
 * is mostly genuinely read. That ratio is a fact about declaration shape, not an opportunity.
 *
 * **Asked again at a second granularity, and the answer held with one exception worth knowing.** Per file it
 * is 29085 unread of 32876 declared (88%, measured 2026-10-05); per *whole declared path* — nothing under it
 * read at all — it is 690 paths. Neither is a finding, and there is a structural reason beyond the one above:
 * `inputs` does double duty, because `dependsOn` is derived as "B reads what A writes", so a step declares
 * another's output to be *ordered* after it whether or not it opens one. Every ordering declaration reads as
 * surplus, which is why a general report over this data would be noise rather than a check. That closes the
 * door `observed-inputs.md` left open — using a trace to check a declaration rather than to key on one.
 *
 * The exception was the one kind of padding that was not a tree that rarely changes: the staged `publish/`
 * trees, a *copy* of the `dist` beside them, which 26 steps keyed on and only `packages:check` opens. 16470
 * declared file-slots of 59073, removed in `PACKAGE_BUILD_READS` (`chain-steps.ts`) and held there by
 * `chain-inputs.spec.ts`. So the rule to carry is narrower than "padding is fine": padding that *duplicates*
 * another declaration is worth removing, and padding that is simply broad is not.
 *
 * **The same question was put to the two expensive pool steps, which have no dep file to ask.** A vitest run
 * reports no read set, so it was answered from history instead — how often each declaration was a reason to
 * run — and it came back the same way: the breadth is paid by the step's startup and absorbed by the
 * per-project cache inside it. The measurement and what it declined to change are recorded on `suiteInputs`
 * (`chain-steps.ts`), beside the declaration it is about.
 *
 * Revisit if a leg lands on the critical path, or if the app-dependent steps stop dominating it.
 *
 * `build-reads.ts` is the same kind of evidence for the other tool this repo can ask: `apack pack build`,
 * whose bundlers report their module graphs. The two are kept apart because everything below is shaped by
 * TypeScript — one cache directory, one suffix, a compiler version per workspace, a dep file traced to the
 * tsconfig that named it — and a bundler's record answers none of those questions.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { PACKAGE_DIRS } from './workspace-deps.ts';

/** Where the legs are configured to write them, which is the one place this looks */
export const DEP_FILE_DIR = path.join(REPO_ROOT, 'node_modules', '.cache', 'tsbuildinfo');

/** The shape this reads. TypeScript writes more; these are the fields with a contract worth relying on. */
interface BuildInfo {
  readonly fileNames?: readonly string[];
  readonly version?: string;
  readonly options?: Record<string, unknown>;
}

const read = (name: string): BuildInfo | undefined => {
  const file = path.join(DEP_FILE_DIR, `${name}.tsbuildinfo`);
  if (!fs.existsSync(file)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as BuildInfo;
  } catch {
    // A half-written or truncated file is a missing one: both mean "no evidence about what was read"
    return undefined;
  }
};

/**
 * The TypeScript a dep file has to have been written by to be worth reading — **the one that workspace
 * resolves**, not the repo's.
 *
 * `packages/main` and `packages/preload` pin typescript to an exact version and so carry their own copy,
 * where every other workspace resolves the root's. Comparing every dep file against the root's version
 * called those two untrustworthy, which was the check being coarser than its subject rather than a finding:
 * the question is whether the file was written by the compiler that would run *this* leg.
 *
 * Read once per workspace. The owner is derived from the dep file's name, which is how TypeScript names one
 * per tsconfig — `main` is a package, `api-test` is `api`'s second config.
 */
const versions = new Map<string, string>();
const typeScriptFor = (depFile: string): string => {
  const owner = sourceOf(depFile)?.workspace;
  const key = owner ?? '';
  const found = versions.get(key);
  if (found !== undefined) return found;
  const candidates = owner === undefined ? [] : [path.join(REPO_ROOT, 'packages', owner, 'node_modules', 'typescript', 'package.json')];
  const manifest = [...candidates, path.join(REPO_ROOT, 'node_modules', 'typescript', 'package.json')]
    .find((file) => fs.existsSync(file))!;
  const version = (JSON.parse(fs.readFileSync(manifest, 'utf-8')) as { version: string }).version;
  versions.set(key, version);
  return version;
};

/** Which tsconfig declared a dep file's name, and the workspace that config belongs to */
export interface DepFileSource {
  /** Repo-relative, so a message can name it */
  readonly config: string;
  /** Undefined for a config outside `packages/`, which no workspace owns */
  readonly workspace?: string;
}

/** `"tsBuildInfoFile": "…/x.tsbuildinfo"` — the one place a dep file's name is declared */
const NAMES_A_DEP_FILE = /"tsBuildInfoFile"\s*:\s*"([^"]+)"/;

/**
 * The two tsconfig homes outside `packages/`. Their dep files belong to no workspace, which is the answer
 * every caller wants: a leg that walks the whole tree is the only candidate for them. Named rather than
 * derived because there are two — and `sourceOf` refusing to map a dep file is what would catch a third.
 */
const REPO_LEVEL = ['scripts', 'tests'];

let declared: Map<string, DepFileSource> | undefined;

/**
 * Where a dep file's name comes from, which is the only non-guess answer to "whose reads are these".
 *
 * TypeScript writes one dep file per tsconfig and each config declares the name itself, through
 * `tsBuildInfoFile` — so this is read from a declaration, not inferred from the dep file's name (`api-test`
 * starts with `api-`), a convention nothing would hold up and two readers depend on: the compiler-version
 * check below, and the gate deciding which leg answers for a dep file.
 *
 * **Enumerated from `PACKAGE_DIRS`, never by searching the tree.** `.claude/worktrees/` holds entire
 * checkouts, so a filesystem walk for `tsconfig*.json` finds another branch's configs — measured, it does.
 *
 * Memoised: the configs are files this process reads once and nothing rewrites mid-run.
 */
export function sourceOf(depFile: string): DepFileSource | undefined {
  if (declared === undefined) {
    declared = new Map();
    const homes = [
      ...PACKAGE_DIRS.map((dir) => ({ at: path.join('packages', dir), workspace: dir as string | undefined })),
      ...REPO_LEVEL.map((at) => ({ at, workspace: undefined })),
    ];
    for (const { at, workspace } of homes) {
      const dir = path.join(REPO_ROOT, at);
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir).filter((name) => /^tsconfig[\w.]*\.json$/.test(name))) {
        const named = NAMES_A_DEP_FILE.exec(fs.readFileSync(path.join(dir, file), 'utf-8'))?.[1];
        // A config writing anywhere else — the renderer's three go to its own `node_modules/.tmp` — has no
        // dep file here to speak for
        if (named === undefined || !named.includes('.cache/tsbuildinfo')) continue;
        declared.set(path.basename(named).replace('.tsbuildinfo', ''), { config: path.join(at, file), ...(workspace === undefined ? {} : { workspace }) });
      }
    }
  }
  return declared.get(depFile);
}

/**
 * Delete the dep files no tsconfig declares, and hand back what went.
 *
 * **Litter, not evidence.** A dep file is written by `tsc` under the name its tsconfig chose, and nothing
 * removes it when that tsconfig goes — so deleting a workspace or renaming a leg leaves a file whose reads
 * answer for nobody. `dep-files.integration.spec.ts` refuses one, correctly, so without pruning the chain
 * would fail on litter until someone deleted the file by hand.
 *
 * **The writer prunes, which is what the two existing records here do** — `pruneStamps` clears a chain stamp
 * with no step, and the pool steps clear a pool stamp no pool would write. `npm run typecheck` drives the
 * compilers that write these, so it calls this before its legs run: before, because a leg mid-write must not
 * have its file taken, though an orphan is safe by construction since no running leg writes a name no
 * tsconfig declares.
 *
 * Takes the directory and the question instead of reading `DEP_FILE_DIR` and `sourceOf`, so it can be run over a
 * population of its own — which is how it gets a case that watches it fail.
 */
export function pruneOrphanDepFiles(cacheDir: string, isDeclared: (depFile: string) => boolean): string[] {
  if (!fs.existsSync(cacheDir)) return [];
  const orphans = fs.readdirSync(cacheDir)
    .filter((file) => file.endsWith('.tsbuildinfo'))
    .map((file) => file.replace('.tsbuildinfo', ''))
    .filter((name) => !isDeclared(name))
    .sort();
  for (const name of orphans) fs.rmSync(path.join(cacheDir, `${name}.tsbuildinfo`));
  return orphans;
}

/** The same over this checkout: the directory the legs write to, and the names their tsconfigs declare */
export const pruneDepFiles = (): string[] => pruneOrphanDepFiles(DEP_FILE_DIR, (name) => sourceOf(name) !== undefined);

/** Every dep file present, by the name its leg writes under */
export const depFileNames = (): string[] => (fs.existsSync(DEP_FILE_DIR)
  ? fs.readdirSync(DEP_FILE_DIR).filter((file) => file.endsWith('.tsbuildinfo')).map((file) => file.replace('.tsbuildinfo', '')).sort()
  : []);

/**
 * The repo files a leg read, or `undefined` when there is no evidence.
 *
 * **`undefined` means no evidence; it is never `[]`.** A compiler that ran read something, so an empty
 * `fileNames` is a file that reports nothing rather than a compilation that touched nothing — and this
 * repo has three of them: the renderer's configs write a build info under `node_modules/.tmp` with an
 * empty `fileNames`, because a solution-style config records its references and not a program. Returning
 * `[]` for those would let a coverage check pass over a leg it learned nothing about, which is the exact
 * shape of "a check that reports nothing may have looked at nothing".
 *
 * Paths in any `node_modules` are dropped, which is the one thing here that is a judgement rather than a
 * reading: they are dependencies, overwhelmingly TypeScript's own `lib.*.d.ts`, and the chain already
 * covers one moving through `package-lock.json` in every step's inputs. **Any** `node_modules`, not a
 * leading one — a package can have its own, and 8401 of the reads recorded here are inside one. Paths in the elmdb
 * checkout (`vendor/elmdb/`) are dropped for the same reason: a dependency, which `vendor/elmdb.rev` covers in every
 * step's inputs. Locally it is a link to a checkout outside the repo, whose reads resolve outside it anyway; in CI it
 * is a clone of the pinned commit inside it.
 *
 * **The paths come back lowercased on a case-insensitive filesystem**, which is TypeScript's doing and
 * not something to correct here: it records `baseform.vue` for `BaseForm.vue`. A caller comparing these
 * against a walk of the tree has to fold case or it will report a declared file as undeclared, which is
 * what `dep-files.spec.ts` does and says.
 */
export function readsOf(name: string): readonly string[] | undefined {
  // The self-check runs here, not at the call site. A read set from another compiler describes another
  // program, and a caller comparing against it would be comparing against the wrong thing quietly.
  if (untrustworthy(name, { version: typeScriptFor(name) }) !== null) return undefined;
  const info = read(name);
  if (info?.fileNames === undefined || info.fileNames.length === 0) return undefined;
  return info.fileNames
    .map((file) => path.relative(REPO_ROOT, path.resolve(DEP_FILE_DIR, file)))
    .filter((file) => !file.startsWith('..') && !/(^|\/)node_modules\//.test(file) && !file.startsWith('vendor/elmdb/'))
    .sort();
}

/**
 * Why a dep file cannot be believed, or `null` when it can — the proxy's self-check.
 *
 * A proxy records a hash of what it *believes* its inputs are, so it goes stale from one nobody listed — an
 * input missing from its key passes the stamp and the whole chain. So a proxy needs a check against
 * *itself*, not only a comparison, and this is that check.
 *
 * Two causes, named separately because they call for different fixes. A compiler upgrade invalidates every
 * recorded read set, and the file says which version wrote it. A changed `tsconfig` changes what the
 * compiler was asked to read, and the file records the options it ran with — so a dep file written under
 * other options describes a different question.
 */
export function untrustworthy(name: string, expect: { version: string; options?: Record<string, unknown> }): string | null {
  const info = read(name);
  if (info === undefined) return `no dep file: ${name} has not run in this checkout, so nothing is recorded about what it reads`;
  if (info.version !== expect.version) {
    return `written by TypeScript ${String(info.version)}, and ${expect.version} is installed: every recorded read set is from another compiler`;
  }
  if (expect.options !== undefined) {
    const moved = Object.keys(expect.options).filter((key) => JSON.stringify(info.options?.[key]) !== JSON.stringify(expect.options?.[key]));
    if (moved.length > 0) return `recorded under different options (${moved.join(', ')}), so it answers a different question`;
  }
  return null;
}
