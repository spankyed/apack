import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILD_UNITS, bundleReadsOf, inputFiles, REPO_ROOT, type BuildUnit } from '@apackdev/host/build/packages-built';
import { CHAIN_STEPS, poolStepName } from '../../../scripts/lib/chain-steps.ts';
import { ENSURE, namedByScript, scopeOf, TYPECHECK_LEGS } from '../../../scripts/lib/typecheck-legs.ts';
import { PACKAGE_DIRS } from '../../../scripts/lib/workspace-deps.ts';
import { UNIT_SUITES, unitStepName } from '../../../scripts/lib/unit-suites.ts';
import { depFileNames, pruneOrphanDepFiles, readsOf, sourceOf, untrustworthy } from '../../../scripts/lib/dep-files.ts';
import * as buildReads from '../../../scripts/lib/build-reads.ts';
import { evidenceOrRefuse } from './_support/evidence.ts';
import { population } from '@apackdev/sdk/testing';

/**
 * The compiler reports what it read, and what `typecheck` declares has to cover it.
 *
 * This is the affordable stand-in for hermeticity. A sandbox would *fail* an undeclared read; nothing here
 * can, so the next best thing is to ask the tool afterwards and compare. Every other input check in this
 * repo compares a declaration against another declaration — the module graph, the manifest — and this one
 * compares it against an observation, which is the only one of them that can catch a read nobody modelled.
 *
 * It is evidence-dependent by nature: a dep file exists only where the leg has run. A fresh clone has none,
 * and every case that reads one then skips naming the run that would have left it, rather than reporting a
 * defect nobody's change caused. Inside a chain run it refuses instead, since that is the run which both
 * produces the evidence and is the gate — `_support/evidence.ts` has the whole of that split.
 */
const tsVersion = (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'node_modules/typescript/package.json'), 'utf-8')) as { version: string }).version;

/**
 * What one step declares, as a question about a file — and the one place case is folded.
 *
 * **Folded on both sides, because TypeScript records a lowercased path on a case-insensitive filesystem**
 * — `baseform.vue` for `BaseForm.vue`. Comparing as written reported eleven declared files as undeclared.
 * Folding can only make this more permissive, and `declares no two files that differ only by case` rules out
 * the one way that could hide something: two tracked files differing only by case.
 *
 * **Inside the comparison, never before asking the filesystem.** A caller tests existence on the path as
 * recorded, so a report names what was read and no lowercased path is ever looked up on disk — which a
 * case-insensitive filesystem answers anyway and a case-sensitive one does not. Nine of the recorded reads
 * are mixed-case, so the other order would drop them and a gate would look at less while reporting the same
 * nothing. `keeps a mixed-case read where the filesystem is case-sensitive` is what watches it.
 *
 * Both gates below ask this: a leg against each leg that might own its dep file (`covering`, which answers
 * *which* legs those are), a build against the one step that builds its pack.
 */
/** Whether a recorded read is still on disk, asked of the path as recorded */
const onDisk = (file: string): boolean => fs.existsSync(path.join(REPO_ROOT, file));

const coverageOf = (step: { inputs: readonly string[]; excludes?: readonly string[] } | undefined) => {
  const declared = new Set((step?.inputs ?? [])
    .flatMap((input) => inputFiles(path.join(REPO_ROOT, input)))
    .map((file) => file.toLowerCase()));
  const skips = (step?.excludes ?? []).map((skip) => skip.toLowerCase());
  return (file: string): boolean => {
    const folded = file.toLowerCase();
    return declared.has(folded) || skips.some((skip) => folded === skip || folded.startsWith(`${skip}/`));
  };
};

/** Where the renderer's leg leaves its build infos, and which of them are there */
const RENDERER_TMP = path.join(REPO_ROOT, 'packages/renderer/node_modules/.tmp');
const rendererBuildInfos = (): string[] => (fs.existsSync(RENDERER_TMP)
  ? fs.readdirSync(RENDERER_TMP).filter((file) => file.endsWith('.tsbuildinfo'))
  : []);

/**
 * The three observations this file reads, each named with the run that writes it.
 *
 * No dep file means no typecheck has run here, which is missing evidence rather than a finding about
 * coverage — and the same of a pack nothing has built and of the renderer's build infos. Evaluated once at
 * module scope so a refusal names its cause once rather than per case.
 */
const DEP_FILES = evidenceOrRefuse({
  what: 'dep file in node_modules/.cache/tsbuildinfo',
  from: 'npm run typecheck',
  present: depFileNames().length > 0,
});
const BUILD_RECORDS = evidenceOrRefuse({
  what: 'pack with a .apack/reads.json',
  from: 'npm run build:default-setup',
  present: buildReads.packsWithReads().length > 0,
});
/** The renderer's leg writes these instead of a dep file, which is the fact its own case is about */
const RENDERER_INFOS = evidenceOrRefuse({
  what: 'build info in packages/renderer/node_modules/.tmp',
  from: 'npm run typecheck:renderer',
  present: rendererBuildInfos().length > 0,
});

describe('the compiler says what it read', () => {
  /**
   * Which legs this can speak for, named rather than implied.
   *
   * The gate below is only as wide as the evidence, and one leg produces none: `typecheck:renderer` writes build
   * infos that record no program at all, because a solution-style config records its references and the
   * referenced configs do the compiling. Asserting the list keeps that honest in both directions — a leg
   * quietly losing its dep file shows up here, and so does one gaining it.
   */
  it('says which legs it can speak for, so the gate is not wider than its evidence', (ctx) => {
    DEP_FILES.orSkip(ctx);
    const owners = new Set(depFileNames()
      .map((file) => PACKAGE_DIRS.find((dir) => file === dir)
        ?? PACKAGE_DIRS.filter((dir) => file.startsWith(`${dir}-`)).sort((a, b) => b.length - a.length)[0])
      .filter((dir): dir is string => dir !== undefined));
    const legs = TYPECHECK_LEGS.filter((leg) => leg.name !== 'packages:ensure');
    const uncovered = legs
      .filter((leg) => { const scope = scopeOf(leg); return scope !== 'repo' && !scope.some((dir) => owners.has(dir)); })
      .map((leg) => leg.name)
      .sort();
    expect(uncovered, 'the legs no dep file speaks for — change this list only with the reason why')
      .toEqual(['typecheck:renderer']);
  });

  it('reads dep files with reads in them, or says which run would have left them', (ctx) => {
    DEP_FILES.orSkip(ctx);
    const found = depFileNames();
    population('dep files', found, { atLeast: 10 });
    expect(found.flatMap((name) => readsOf(name) ?? []).length, 'every dep file is empty of repo files')
      .toBeGreaterThan(100);
  });

  /**
   * The gate. `typecheck` declares `EVERY_SOURCE` and the build outputs, which is broad on purpose, and
   * the question is whether broad is *enough* — a file the compiler reads that no input covers is a step
   * reporting `cached` over work that changed.
   */
  /**
   * Case is folded on both sides, because TypeScript records a lowercased path on a case-insensitive
   * filesystem — `baseform.vue` for `BaseForm.vue`. Comparing as written reported eleven declared files
   * as undeclared. Folding can only make this more permissive, so the case below rules out the one way
   * that could hide something: two tracked files differing only by case.
   */
  it('declares no two files that differ only by case, so the fold in coverageOf hides nothing', () => {
    const declared = CHAIN_STEPS.flatMap((step) => step.inputs).flatMap((input) => inputFiles(path.join(REPO_ROOT, input)));
    const byFolded = new Map<string, Set<string>>();
    for (const file of declared) byFolded.set(file.toLowerCase(), (byFolded.get(file.toLowerCase()) ?? new Set()).add(file));
    expect([...byFolded.values()].filter((group) => group.size > 1).map((group) => [...group]),
      'these collide when case is folded').toEqual([]);
  });

  /**
   * The gate, per leg rather than per chain.
   *
   * Each typecheck leg is its own step now, with inputs derived from the scope it declares, and the dep
   * file is the only thing that can say whether that scope is wide enough. A leg reading a file its own
   * step does not declare is a step reporting `cached` over work that changed — and because the scopes
   * are narrow, this is the check that makes narrowing them safe.
   *
   * Which leg a dep file belongs to is `covering`'s answer, below.
   */
  /**
   * Every dep file is traced to the config that named it, so none reaches the fallback by accident.
   *
   * The fallback — a repo-scoped leg answering for a dep file no workspace owns — is right for `scripts` and
   * `tests` and wrong for everything else, and it is silent: a dep file this cannot place is checked against
   * `lint:check`, which declares the tree and so vouches for anything. Without this case, a config that
   * stopped declaring `tsBuildInfoFile`, or wrote it somewhere new, would quietly loosen the gate above
   * rather than fail here.
   */
  it('traces every dep file to the tsconfig that named it', (ctx) => {
    DEP_FILES.orSkip(ctx);
    const placed = depFileNames().map((depFile) => ({ depFile, source: sourceOf(depFile) }));
    expect(placed.length, 'no dep files, so this would pass over nothing').toBeGreaterThan(10);
    expect(placed.filter(({ source }) => source === undefined).map(({ depFile }) => depFile),
      'no tsconfig under a workspace or at the repo level declares these names, so their reads answer for '
      + 'nobody. `npm run typecheck` prunes a dep file whose tsconfig has gone, so one that survives it was '
      + 'written by something other than a declared leg').toEqual([]);
    // The ones with no workspace are exactly the repo-level configs, which is what licenses the fallback
    expect(placed.filter(({ source }) => source?.workspace === undefined).map(({ source }) => source?.config).sort())
      .toEqual([path.join('scripts', 'tsconfig.json'), path.join('tests', 'tsconfig.json')]);
  });

  /**
   * And the prune that keeps the case above about something, run by `npm run typecheck` before its legs.
   *
   * Nothing removed a dep file when its tsconfig went, so deleting a workspace left one whose reads answer
   * for nobody and the step above stayed red on litter until someone deleted a file by hand. It is tested
   * over a directory of its own rather than the checkout's: this writes, and a case that prunes the real
   * cache would delete the evidence every other case here reads.
   *
   * What that leaves the case above is the cause a prune cannot fix — a dep file written by something other
   * than a declared leg — which is what its message now says.
   */
  it('deletes a dep file no tsconfig declares, and keeps the ones that are owned', () => {
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-case-'));
    try {
      for (const name of ['owned', 'orphan', 'another-orphan']) {
        fs.writeFileSync(path.join(cache, `${name}.tsbuildinfo`), '{}');
      }
      fs.writeFileSync(path.join(cache, 'not-a-dep-file.json'), '{}');

      expect(pruneOrphanDepFiles(cache, (name) => name === 'owned')).toEqual(['another-orphan', 'orphan']);
      expect(fs.readdirSync(cache).sort(), 'it takes the orphans and nothing else')
        .toEqual(['not-a-dep-file.json', 'owned.tsbuildinfo']);
    } finally {
      // In a `finally` because a failing assertion throws, and this file's subject is cache litter
      fs.rmSync(cache, { recursive: true, force: true });
    }
  });

  it('has nothing to say about a cache directory that is not there', () => {
    expect(pruneOrphanDepFiles(path.join(os.tmpdir(), `absent-${String(Date.now())}`), () => false)).toEqual([]);
  });

  /**
   * The legs that *own* this dep file, and the repo-wide ones only when none does.
     *
     * **A repo-wide leg is not an answer about the leg that compiles the file.** `lint:check` declares the
     * whole tree, so with it in the covering set every read of anything was vouched for by something — which
     * is how `typecheck:main` and `typecheck:preload` came to compile `types/*.d.ts` without declaring them,
     * cached through an edit to a file they were reading, with this check green. The fallback is for a dep
     * file no package owns (`scripts`, `tests`), where a repo-scoped leg genuinely is the compiler.
     *
     * **Ownership comes from the script, not from `scopeOf`, and that is the whole point.** A leg's `scope`
     * is its cache key, which wants to be *wide* — every file it reads — while ownership wants to be
     * *narrow*: only what it compiles. Reading one field for both meant widening a key made a leg vouch for
     * reads it never compiles, so the honest declaration could not be made. It cost two answers before it
     * was split: `packages:ensure` owned six dep files it only builds, and `repo-checks` and
     * `publish-checks` owned none at all, because the leg that compiles them declares `scope: 'repo'` for
     * its key and so was not in the owning set — they were being vouched for by `lint:check`, the very
     * hole this case was tightened to close.
     */
  const covering = (depFile: string) => {
    const dir = sourceOf(depFile)?.workspace;
    const owning = dir === undefined ? [] : TYPECHECK_LEGS.filter((leg) => namedByScript(leg.name).dirs.includes(dir));
    return owning.length > 0 ? owning : TYPECHECK_LEGS.filter((leg) => scopeOf(leg) === 'repo');
  };

  /**
   * The split itself, pinned on the one leg where the two answers differ today.
   *
   * `packages:ensure` declares a `scope` naming the five packages it builds — a correct cache key, since it
   * re-runs when any of them changes — and its script names none of them, because it compiles none of them.
   * Read ownership off the key and it vouches for five dep files whose reads it never made; read it off the
   * script and it vouches for nothing. Switch `covering` back to `scopeOf` and this is what says so.
   */
  it('asks the script which leg compiles a dep file, not the leg\'s cache key', () => {
    const ensure = TYPECHECK_LEGS.find((leg) => leg.name === ENSURE)!;
    expect(scopeOf(ensure), 'its key names the packages it builds, which is what makes this a difference')
      .toContain('apack-sdk');
    expect(namedByScript(ENSURE).dirs, 'and its script names none of them, because it compiles none').toEqual([]);
    expect(covering('apack-sdk').map((leg) => leg.name)).not.toContain(ENSURE);
  });

  it('leaves nothing a leg read outside what that leg declares', (ctx) => {
    DEP_FILES.orSkip(ctx);
    const missing = depFileNames().flatMap((depFile) => {
      const reads = readsOf(depFile) ?? [];
      const legs = covering(depFile);
      if (legs.length === 0) return [`${depFile}: no leg declares it, so nothing re-runs on what it read`];
      // Any one *owning* leg is enough, and that is the only ambiguity the rule is for: a package can have
      // several configs — `api`, `api-test`, `api-scripts` — and which leg compiles which is not derivable
      // from the name. It was never meant to let a leg that merely walks the tree answer for one that compiles
      const declares = legs.map((leg) => coverageOf(CHAIN_STEPS.find((candidate) => candidate.name === leg.name)));
      return reads
        .filter((file) => onDisk(file))
        .filter((file) => !declares.some((covers) => covers(file)))
        .slice(0, 5)
        .map((file) => `${depFile} read ${file}, which no leg covering it declares`);
    });
    expect([...new Set(missing)], 'the compiler read these and nothing re-runs the leg when they change')
      .toEqual([]);
  });
});

/**
 * And the dep file is a proxy, so it is checked against itself.
 *
 * A proxy records what it believes its inputs were, which is a guess about someone else's behaviour.
 * The API report stamp, deleted since, was bitten by exactly that — an input missing from its key let a
 * change pass the stamp and the whole chain — so the rule it left behind is that a proxy needs a
 * self-check rather than only a comparison.
 */
describe('a dep file is checked against itself before it is believed', () => {
  /**
   * Against the compiler *that workspace* resolves. `packages/main` and `packages/preload` pin typescript
   * to an exact version and carry their own copy, so a check against the repo's called their dep files
   * untrustworthy — the check being coarser than its subject rather than a finding about the files.
   */
  it('trusts one written by the compiler its own workspace resolves', (ctx) => {
    DEP_FILES.orSkip(ctx);
    for (const name of depFileNames()) {
      expect(readsOf(name), `${name} is refused, so something it was written by has moved`).toBeDefined();
    }
  });

  it('is asked against a version, and says so when that version is not the one', (ctx) => {
    DEP_FILES.orSkip(ctx);
    const [name] = depFileNames();
    expect(untrustworthy(name!, { version: tsVersion })).toBeNull();
  });

  /**
   * And the reader applies it, rather than leaving it to whoever remembers.
   *
   * This is the half that was missing: `untrustworthy` existed, the gate above called `readsOf`, and
   * nothing joined them — so a dep file from another compiler would have been compared against in
   * silence. The check belongs in the reader for the reason `CLAUDE.md` gives about reset hatches: one
   * that a caller has to invoke is one a caller will forget.
   */
  it('reads nothing out of a dep file it would not trust', (ctx) => {
    DEP_FILES.orSkip(ctx);
    const [name] = depFileNames();
    expect(readsOf(name!), 'the fixture is unreadable, so the case below proves nothing').toBeDefined();

    const file = path.join(REPO_ROOT, 'node_modules/.cache/tsbuildinfo', `${name!}.tsbuildinfo`);
    const original = fs.readFileSync(file, 'utf-8');
    try {
      const info = JSON.parse(original) as Record<string, unknown>;
      fs.writeFileSync(file, JSON.stringify({ ...info, version: '0.0.0-another-compiler' }));
      expect(readsOf(name!), 'a read set from another compiler describes another program').toBeUndefined();
    } finally {
      fs.writeFileSync(file, original);
    }
    expect(readsOf(name!), 'the fixture was not restored').toBeDefined();
  });

  it('refuses one written by another compiler, naming the version', (ctx) => {
    DEP_FILES.orSkip(ctx);
    const [name] = depFileNames();
    expect(untrustworthy(name!, { version: '0.0.0-not-installed' }))
      .toMatch(/written by TypeScript .*, and 0\.0\.0-not-installed is installed/);
  });

  it('refuses one recorded under different options, naming which moved', (ctx) => {
    DEP_FILES.orSkip(ctx);
    const [name] = depFileNames();
    expect(untrustworthy(name!, { version: tsVersion, options: { strict: 'not-what-it-ran-with' } }))
      .toMatch(/different options \(strict\)/);
  });

  // The cold-tree case, which is the one that must not read as "it read nothing"
  it('refuses a name it has no file for, rather than reporting an empty read set', () => {
    expect(readsOf('no-such-leg')).toBeUndefined();
    expect(untrustworthy('no-such-leg', { version: tsVersion })).toMatch(/has not run in this checkout/);
  });

  /**
   * Why `typecheck:renderer` is on the uncovered list, as a fact rather than a claim.
   *
   * The renderer *does* write build infos — three, under `packages/renderer/node_modules/.tmp` — and they
   * record no program at all: no `fileNames` key, because a solution-style config records its references
   * and the referenced configs do the compiling. So there is nothing to read, and pointing the reader at
   * that directory would buy a leg's worth of silence rather than a leg's worth of evidence. If these
   * ever grow a `fileNames`, this case fails and the gate can widen.
   */
  it('finds no program recorded in the renderer build infos, which is why its leg is uncovered', (ctx) => {
    RENDERER_INFOS.orSkip(ctx);
    for (const file of population('renderer build infos', rendererBuildInfos())) {
      const info = JSON.parse(fs.readFileSync(path.join(RENDERER_TMP, file), 'utf-8')) as { fileNames?: unknown };
      expect(info.fileNames, `${file} now records a program; the reader could read it`).toBeUndefined();
    }
  });
});

/**
 * And the same question of `apack pack build`, which is the other tool here that can be asked.
 *
 * Two chain steps run it — `build:default-setup` and `test:external-pack:contract`, 70s between them — and until the
 * command started recording, their declared inputs were compared against nothing. The bundlers it runs had
 * the answer all along and threw it away: esbuild's `metafile.inputs`, Rollup's `watchFiles` for the three
 * declaration bundles, and the frontend bundle's module graph.
 *
 * **Evidence-dependent in the same way the dep files are**, and for the same reason it is worth saying so
 * out loud: a record exists only where the pack has been built in this checkout. A fresh clone has none, and
 * the first case below fails with the command to run rather than passing over an empty population.
 *
 * **It covers the bundling, not the step.** The phases with no bundler to ask are absent from the record,
 * which is why both steps stay on the list at the end of this file.
 */
describe('apack pack build says what it read', () => {
  /** The step that builds a pack: the one that declares that pack's `dist` among its outputs */
  const building = (packDir: string) =>
    CHAIN_STEPS.find((step) => (step.outputs ?? []).includes(`${packDir}/dist`));

  /**
   * The comparison, as a function of what was read and what is declared, so the case below can hand it a
   * read nobody declares and watch it report.
   *
   * A firing case has to come from this direction. Dropping a *capture* makes the recorded set smaller,
   * which a reads-are-declared check cannot notice by construction — that failure is caught by the phase
   * case above it, not here.
   */
  /**
   * `exists` is injectable because no `existsSync` on this machine can answer as a case-sensitive filesystem
   * would, and that is the difference the order of these two filters is about (`covering`).
   */
  const undeclared = (
    files: readonly string[],
    step: { inputs: readonly string[]; excludes?: readonly string[] },
    exists: (file: string) => boolean = onDisk,
  ): string[] => {
    const declares = coverageOf(step);
    return files.filter((file) => exists(file)).filter((file) => !declares(file)).sort();
  };

  /** Every read of every built pack, repo-relative: a pack records its own paths, and `..` leaves the pack */
  const readsByPack = (): { packDir: string; files: string[] }[] => buildReads.packsWithReads().flatMap((packDir) => {
    const record = buildReads.readsOf(packDir);
    return record === undefined ? [] : [{
      packDir,
      files: buildReads.filesRead(record).map((file) => path.normalize(path.join(packDir, file))),
    }];
  });

  it('reads a build record with reads in it, or says which run would have left one', (ctx) => {
    BUILD_RECORDS.orSkip(ctx);
    for (const packDir of population('built packs', buildReads.packsWithReads())) {
      expect(buildReads.readsOf(packDir), `${buildReads.untrustworthy(packDir)}`).toBeDefined();
    }
    expect(readsByPack().flatMap(({ files }) => files).length, 'every record is empty of files')
      .toBeGreaterThan(100);
  });

  /**
   * Which phases this can speak for, named rather than implied — the half that catches a dropped capture.
   *
   * The union across the built packs, because a pack with no `dsl` or `steps.build` records neither phase.
   * A capture that stops reporting takes its phase out of this set, which is the only thing that can see it
   * go; the gate below cannot, because fewer reads is never a finding there.
   *
   * Whether a record is here at all is the case above's question, and one record answers this one: every
   * pack is built by `apack pack build`, so each records all nine phases its manifest asks for.
   */
  it('says which phases it can speak for, so a dropped capture is not a quiet one', (ctx) => {
    BUILD_RECORDS.orSkip(ctx);
    const built = buildReads.packsWithReads();
    const phases = new Set(built.flatMap((packDir) => Object.keys(buildReads.readsOf(packDir)?.phases ?? {})));
    expect([...phases].sort(), 'a phase gone from here is a bundler that stopped reporting; a new one is a '
      + 'bundle that started').toEqual([
      'contentCompilers', 'contentRuntime', 'dslDefs', 'fe', 'flowHelperTypes',
      'flowHelpersModule', 'runtime', 'stepBuild', 'types',
    ]);
  });

  /**
   * The gate. Both steps declare whole trees — `tests/packs` and `PACKAGE_BUILD_OUTPUTS` — and the question
   * is whether whole trees are *enough*, which only an observation can answer. A build reading a file its
   * step does not declare is a step reporting `cached` over work that changed.
   */
  it('leaves nothing a build read outside what the step building that pack declares', (ctx) => {
    BUILD_RECORDS.orSkip(ctx);
    const missing = readsByPack().flatMap(({ packDir, files }) => {
      const step = building(packDir);
      if (step === undefined) return [`${packDir} was built and no step declares its dist, so nothing re-runs on what it read`];
      return undeclared(files, step).slice(0, 5).map((file) => `${step.name} built ${packDir}, which read ${file}, and the step does not declare it`);
    });
    expect(missing, 'the build read these and nothing re-runs the step when they change').toEqual([]);
  });

  /**
   * And the comparison can report, which is the one thing a passing gate never shows.
   *
   * A real file that the step genuinely does not declare, rather than a fabricated path: the gate drops a
   * read that is not on disk, so a made-up name would be filtered out before the comparison it is meant to
   * exercise.
   */
  /**
   * And it still reports a mixed-case read where the filesystem is case-sensitive.
   *
   * The comparison folds case, because TypeScript records lowercased paths on a case-insensitive filesystem
   * and the leg gate above shares this helper's shape. Folding *before* asking whether the file exists reads
   * a lowercased path off disk — which macOS answers anyway, and Linux does not. Measured: nine of the
   * recorded reads are mixed-case, so that order would drop them and the gate would look at less while
   * reporting the same nothing. The filesystem is handed in because no real one here can be the one at risk.
   */
  it('keeps a mixed-case read where the filesystem is case-sensitive', (ctx) => {
    BUILD_RECORDS.orSkip(ctx);
    // From the records rather than written out: a path chosen by hand goes all-lowercase without anyone
    // noticing, and then the case passes whatever the order is — which is what the first version of it did.
    // **The step comes from the same record as the file**, because the two have to be about one pack: naming
    // a step here instead pins the case to whichever pack's record happens to be read first, and it fails
    // the day a build reads one mixed-case file earlier than it used to.
    const mixed = readsByPack().flatMap(({ packDir, files }) => {
      const step = building(packDir);
      return step === undefined ? [] : files.filter((file) => file !== file.toLowerCase()).map((file) => ({ file, step }));
    })[0];
    expect(mixed, 'no recorded read has mixed case, so this case has nothing to be about').toBeDefined();
    // A filesystem that answers for the real case and nothing else, which is every filesystem but this one's
    const caseSensitive = (file: string) => file === mixed!.file;
    expect(undeclared([mixed!.file], { inputs: [] }, caseSensitive), 'a read it cannot find is a read it stops checking')
      .toEqual([mixed!.file]);
    // And the fold is still what the comparison uses, so a step declaring that file covers it whatever its case
    expect(undeclared([mixed!.file], mixed!.step, () => true), 'the comparison stopped folding case').toEqual([]);
  });

  it('reports a read the step does not declare', () => {
    const compile = CHAIN_STEPS.find((step) => step.name === 'build:default-setup')!;
    const elsewhere = 'packages/api/src/server.ts';
    expect(fs.existsSync(path.join(REPO_ROOT, elsewhere)), 'this case needs a real file to be about').toBe(true);
    expect(undeclared([elsewhere], compile)).toEqual([elsewhere]);
    // And the same comparison says nothing about a file the step does declare, so it is not simply failing
    expect(undeclared(['packages/default-setup/apack.json'], compile)).toEqual([]);
  });
});

/**
 * And a build record is a proxy too, so it is checked against itself.
 *
 * The same three-cause shape as a dep file's, over what a bundler's record can be wrong about: never built
 * here, built by bundlers that have since moved, or built with nothing reporting at all. The third has no
 * counterpart on the TypeScript side, because a compiler that ran read something — where every capture here
 * is a line that can be deleted.
 */
describe('a build record is checked against itself before it is believed', () => {
  const built = () => buildReads.packsWithReads()[0];

  it('refuses a pack it has no record for, rather than reporting an empty read set', () => {
    expect(buildReads.readsOf('packages/api')).toBeUndefined();
    expect(buildReads.untrustworthy('packages/api')).toMatch(/has not been built in this checkout/);
  });

  it('refuses one written by another bundler, naming which and both versions', (ctx) => {
    BUILD_RECORDS.orSkip(ctx);
    const packDir = built();
    expect(buildReads.readsOf(packDir), 'the fixture is unreadable, so this case proves nothing').toBeDefined();
    expect(buildReads.untrustworthy(packDir, () => '0.0.0-not-installed'))
      .toMatch(/bundled by \w+ [\d.]+, and 0\.0\.0-not-installed is installed/);
  });

  it('refuses one whose bundler is not installed at all', (ctx) => {
    BUILD_RECORDS.orSkip(ctx);
    expect(buildReads.untrustworthy(built(), () => undefined)).toMatch(/and nothing is installed/);
  });

  /**
   * And the reader applies it, rather than leaving it to whoever remembers — the half that was missing on
   * the dep-file side until a case went looking for it.
   */
  it('reads nothing out of a record it would not trust', (ctx) => {
    BUILD_RECORDS.orSkip(ctx);
    const packDir = built();
    const file = path.join(REPO_ROOT, packDir, '.apack', 'reads.json');
    const original = fs.readFileSync(file, 'utf-8');
    try {
      const record = JSON.parse(original) as { bundlers: Record<string, string> };
      fs.writeFileSync(file, JSON.stringify({ ...record, bundlers: { ...record.bundlers, esbuild: '0.0.0-another-bundler' } }));
      expect(buildReads.readsOf(packDir), 'a module graph from another bundler describes another build').toBeUndefined();

      fs.writeFileSync(file, JSON.stringify({ bundlers: record.bundlers, phases: {} }));
      expect(buildReads.readsOf(packDir), 'a record of no phase is a build that reported nothing').toBeUndefined();
      expect(buildReads.untrustworthy(packDir)).toMatch(/recorded no phase/);
    } finally {
      fs.writeFileSync(file, original);
    }
    expect(buildReads.readsOf(packDir), 'the fixture was not restored').toBeDefined();
  });
});

/**
 * And the same question of the whole chain: which steps has anything looked at.
 *
 * Three answers, and the third is the one worth naming. A **dep file** is the compiler reporting what it
 * read — an observation, the only kind of evidence here that can catch an input nobody modelled. The
 * **module graph** is `suite-reads` walking a suite's specs, which is a declaration checked against
 * another declaration. And for the rest there is **nothing per-step**: builds, shell scenarios and
 * Playwright runs have no tool that reports their reads, and syscall tracing was reasoned out of scope
 * (`docs/archive/plans/one-action-cache.md`) because it cannot tell a read that matters from a stat
 * during module resolution.
 *
 * Those nine are covered only by `chain-inputs`' coverage question — every tracked file is *some* step's
 * input — which cannot catch a step declaring too little. That is a real gap and this is a record of it,
 * not a gate over it: the list is asserted so it cannot drift in prose, so a step gaining observation
 * shows up, and so a new step that nothing watches has to be added here deliberately.
 *
 * `typecheck:renderer` is in this list and in the one above for the same reason.
 */
describe('what has looked at a step at all', () => {
  const observation = (): { byDepFile: string[]; byGraph: string[]; byNothing: string[] } => {
    const owners = new Set(depFileNames()
      .filter((file) => readsOf(file) !== undefined)
      .map((file) => PACKAGE_DIRS.find((dir) => file === dir)
        ?? PACKAGE_DIRS.filter((dir) => file.startsWith(`${dir}-`)).sort((a, b) => b.length - a.length)[0])
      .filter((dir): dir is string => dir !== undefined));
    const byDepFile = new Set(TYPECHECK_LEGS
      .filter((leg) => { const scope = scopeOf(leg); return scope === 'repo' || scope.some((dir) => owners.has(dir)); })
      .map((leg) => leg.name));
    // A pool's specs are walked by `suite-reads`, which is the other kind of evidence
    const byGraph = new Set([...new Set(UNIT_SUITES.map(unitStepName)), poolStepName('integration'), poolStepName('native')]);
    const named = (take: (name: string) => boolean): string[] =>
      CHAIN_STEPS.filter((step) => take(step.name)).map((step) => step.name).sort();
    return {
      byDepFile: named((name) => byDepFile.has(name)),
      byGraph: named((name) => byGraph.has(name)),
      byNothing: named((name) => !byDepFile.has(name) && !byGraph.has(name)),
    };
  };

  it('has looked at most of them, so the list below is a remainder and not the whole table', (ctx) => {
    DEP_FILES.orSkip(ctx);
    const { byDepFile, byGraph, byNothing } = observation();
    expect(byDepFile.length, 'no step is covered by a dep file').toBeGreaterThan(10);
    expect(byGraph.length, 'no step is covered by the module graph').toBeGreaterThan(2);
    expect(byDepFile.length + byGraph.length + byNothing.length, 'the three answers do not partition the table')
      .toBe(CHAIN_STEPS.length);
  });

  /**
   * **Two kinds of entry sit in this list, and the difference is the whole of what to do about them.**
   * Measured 2026-10-02, because the distinction keeps being re-derived.
   *
   * *No tool can report on it.* The two packaged-authoring halves are five `npm pack`s and two
   * `npm install`s into a temp tree outside the monorepo — a package manager writes no dep file, and
   * resolving from the published tarballs is the thing they exist to prove. There is nothing to build here,
   * and what protects them instead is that their inputs are **derived** (`PACKAGE_BUILD_OUTPUTS`,
   * `APP_OUTPUTS`) rather than hand-listed, which is the only protection available to a step nothing can
   * observe. `build:runtime` has one leg that derivation does not reach — it compiles the built-in pack's own
   * sources into the renderer and the api, which no output of another step covers — so that leg is
   * hand-listed and `chain-inputs.spec.ts` asserts it, which is the third kind of protection and the one to
   * reach for when a step reads something nothing writes. Two entries because the check is two steps, split at the app boundary. `test:smoke` and
   * `test` are the same shape: Playwright driving a real Electron process.
   *
   * *A tool could report, and two now are asked.* `build:default-setup` and `test:external-pack:contract` both run
   * `apack pack build`, which records what each bundling phase read — the describe above reads it. Measured
   * 2026-10-02 on its first run: 285 files for `build:default-setup`, 131 of them `@apackdev/sdk`'s and `@apackdev/ears`'
   * published `dist`, which `PACKAGE_BUILD_OUTPUTS` already declared. So it confirmed the declaration
   * rather than finding a hole, which is what a gate over a correct declaration is supposed to do.
   *
   * **Both steps stay on this list, and that is why the distinction is written down rather than inferred
   * from a column.** What is observed is the bundling. Codegen, the tsx-loaded content compilation, the
   * feature settings load and the static pack rules have no bundler to ask. So moving either step out of
   * this list would make it read as verified over part of its work, which is the same judgement the
   * paragraph below makes about the cheap route.
   *
   * `facade:check` is here for the neighbouring reason: it re-bundles the facade through rollup and
   * compares, and records nothing, because a dep file is written where output is committed and a check
   * commits none. Its inputs are declared by hand rather than derived, which is what stands in its place.
   *
   * **The cheap version of that route is a trap**, which is why it is named rather than left to be found:
   * those fixture packs also run `tsc --noEmit`, so giving *their* tsconfigs a `tsBuildInfoFile` would put
   * this step in the observed column while observing 2.5s of its 57s. A step reading as verified over 4% of
   * its work is worse than one honestly listed here.
   */
  it('names the steps nothing verifies per-step', (ctx) => {
    DEP_FILES.orSkip(ctx);
    expect(observation().byNothing,
      'a step here is one whose declared inputs nothing checks against what it touched. Add to this list '
      + 'only a step no tool can report on, and take one out when something can').toEqual([
      // API Extractor reads a package's declarations through its own compiler and emits no manifest of what
      // it touched, so there is nothing to ask. What stands in its place is that its inputs are derived
      // (`PACKAGE_BUILD_OUTPUTS`) rather than hand-listed, plus the two trees it compares being declared
      // outright — which is the protection `test:packaged-authoring` relies on for the same reason.
      'api:check',
      'build:default-setup',
      'build:runtime',
      'facade:check',
      'packages:check',
      'test:e2e',
      'test:external-pack:app',
      'test:external-pack:contract',
      'test:external-pack:fork',
      'test:packaged-authoring:app',
      'test:packaged-authoring:author',
      'test:smoke',
      'typecheck:renderer',
    ]);
  });
});

/**
 * **What a bundle read, against what its build unit declares.**
 *
 * The third thing this repo can observe, after the compilers' dep files and `apack pack build`'s module graphs —
 * and the one whose absence cost a real defect. `@apackdev/cli` and `@apackdev/testing` are bundled by esbuild
 * with `@apackdev/host` *and* the shared-instance packages inlined **from source**, and `bundled()` declared
 * only the first. So an edit to `@apackdev/sdk/src` left both bundles stale with their stamps reading fresh,
 * `packages:ensure` rebuilt nothing, and it surfaced only when a packaged-authoring run type-checked a
 * generated file against an SDK whose type no longer matched the CLI that emitted it.
 *
 * No other input check could see it. `chain-table`'s closure walk follows a build *script's* own imports, and
 * the bundler reaches these through the package being bundled; everything else compares one declaration
 * against another. This compares a declaration against an observation, which is the only kind that can catch
 * a read nobody modelled.
 *
 * The record is never a cache key — `bundleReadsFile`'s comment has why: last run's reads cannot invalidate
 * on a file that was not read last time, which is this same defect wearing a different hat.
 */
describe('a bundle reads nothing its build unit leaves undeclared', () => {
  const BUNDLED = ['@apackdev/cli', '@apackdev/testing'];

  it('finds the records to read, or says plainly that there is no evidence here', () => {
    for (const workspace of BUNDLED) {
      expect(bundleReadsOf(workspace),
        `no record for ${workspace}: run npm run packages:build once, then this can check what its bundle read`)
        .toBeDefined();
    }
  });

  /**
   * What a unit's inputs cover, built from the files each one expands to — `inputFiles` walks a directory and
   * answers for a file as itself, which is what makes a unit naming a tree cover a read inside it.
   *
   * One path for the real cases and the mutation below, so the mutation exercises the rule rather than a copy.
   */
  const notCoveredBy = (unit: BuildUnit, read: readonly string[]): string[] => {
    // `coverageOf` takes repo-relative inputs and joins the root itself, where a `BuildUnit`'s are absolute
    // by design — so the unit is restated in that shape rather than the comparison being written twice
    const declares = coverageOf({
      inputs: unit.inputs.map((input) => path.relative(REPO_ROOT, input)),
      excludes: (unit.excludes ?? []).map((excluded) => path.relative(REPO_ROOT, excluded)),
    });
    // A read that is no longer on disk says nothing about a declaration: the record is of the last build
    return read.filter(onDisk).filter((file) => !declares(file)).sort();
  };

  it.each(BUNDLED)('%s', (workspace) => {
    const read = bundleReadsOf(workspace) ?? [];
    expect(read.length, 'an empty record is not a passing one').toBeGreaterThan(50);
    expect(notCoveredBy(BUILD_UNITS[workspace]!, read).slice(0, 5).map((file) => `${workspace}'s bundle read ${file}, undeclared`),
      "editing one of these leaves the bundle stale while its unit's stamp reads fresh").toEqual([]);
  });

  /**
   * And the comparison can report, which a passing gate never shows. A real source file no bundle declares,
   * rather than a fabricated path: a read that is not on disk is dropped before the comparison it is meant to
   * exercise.
   */
  it('reports a read the unit does not declare', () => {
    const planted = 'packages/renderer/src/main.ts';
    expect(fs.existsSync(path.join(REPO_ROOT, planted)), 'point this at a file that exists').toBe(true);
    expect(notCoveredBy(BUILD_UNITS['@apackdev/cli']!, [planted])).toEqual([planted]);
  });
});
