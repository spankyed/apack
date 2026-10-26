// The step table's own shape, which is a different question from what each step reads.
//
// Nothing here opens a file in the repo: every case is answered from `CHAIN_STEPS`, `UNIT_SUITES` and the
// npm scripts, by asking whether the table agrees with itself — that a pool declares what its projects
// declare, that a step keeping its own cache says so, that a recorded file has both of its halves.
// `chain-inputs.spec.ts` is the other half of the split: whether a step's declared inputs cover the files
// that step actually reads, which is answered by walking the tree and is where the cost lives.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUILD_UNITS, buildScriptFor, inputFiles, NOT_A_BUILD_INPUT, repoRelative, REPO_ROOT,
  STAMP_READERS as HOST_STAMP_READERS, type BuildUnit } from '@apackdev/host/build/packages-built';
import { CHAIN_STEPS, INTEGRATION_SUITES, suiteInputs, type ChainStep } from '../../../scripts/lib/chain-steps.ts';
import { UNIT_SUITES, type UnitSuite } from '../../../scripts/lib/unit-suites.ts';
import { reachableText, rootScripts } from '../../../scripts/lib/npm-scripts.ts';
import { closureOf } from './_support/module-closure.ts';
import { TYPECHECK_LEGS } from '../../../scripts/lib/typecheck-legs.ts';
import { POOLS, poolUnitFor, STAMP_READERS as POOL_STAMP_READERS, type Pool } from '../../../scripts/lib/unit-pool.ts';
import { asPercent, POOL_WIDTH, shareOf, UNCAPPED } from '../../../scripts/lib/core-budget.ts';
import { RUNTIME_BUILD_LEGS } from '../../../scripts/lib/runtime-build-legs.ts';
import { reachableFrom } from '../../../scripts/lib/module-graph.ts';
import { importedCallsIn } from '../../../scripts/lib/imported-calls.ts';
import { PACKAGE_DIRS } from '../../../scripts/lib/workspace-deps.ts';
import { population } from '@apackdev/sdk/testing';

/**
 * A vitest config as vitest resolves it, rather than as a regular expression reads it.
 *
 * Both of the checks below used to match the file's text. The unit one anchored its pattern to the start of
 * a line and so happened to skip a commented-out project; the integration one, written from it later, did
 * not — and commenting a project out dropped five specs from the chain while all 46 cases here passed. A
 * config is a module that exports an object, so the object is what to ask.
 */
const resolvedConfig = async (rel: string): Promise<{ test?: {
  projects?: string[];
  maxWorkers?: unknown;
} }> => (await import(path.join(REPO_ROOT, rel))).default;

const projectsOf = async (rel: string): Promise<string[]> => {
  const projects = (await resolvedConfig(rel)).test?.projects ?? [];
  expect(projects.length, `${rel} resolved to no projects, so any comparison against it is vacuous`).toBeGreaterThan(0);
  return projects;
};

const ROOT_SCRIPTS = (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8')) as { scripts: Record<string, string> }).scripts;

/**
 * What a step's runner comprises: the `scripts/` files its npm script names, and everything those reach
 * through relative imports — which is where the behaviour being asked about actually lives.
 *
 * One function for both questions below, because both follow the same indirection and a check that stops at
 * the npm script stops having a subject the moment a runner moves a line into `scripts/lib`.
 *
 * **Transitive, which it was not.** It took the named scripts plus their *direct* imports and stopped, so a
 * runner that moved the line one module further was already out of reach — the exact failure the
 * indirection exists to prevent, one level along. `reachableFrom` is that walk, confined to `scripts/`: the
 * question is what a runner loads, and following it into `packages/` would answer about the product.
 */
function runnerFiles(stepName: string): string[] {
  const named = [...(ROOT_SCRIPTS[stepName] ?? '').matchAll(/\b(scripts\/[\w./-]+\.(?:ts|mjs))/g)]
    .map(([, file]) => path.join(REPO_ROOT, file))
    .filter((full) => fs.existsSync(full));
  return reachableFrom(named, [path.join(REPO_ROOT, 'scripts')]);
}

/** The same files as one string, for a question about what a runner *says* rather than what it calls */
const runnerText = (stepName: string): string =>
  runnerFiles(stepName).map((file) => fs.readFileSync(file, 'utf-8')).join('\n');

// `build:runtime`'s leg table is an enumeration of workspaces, which is the shape that goes stale silently: a
// workspace that gains a `build` script simply would not be built by the chain, and nothing would say so.
// The set is derivable from the manifests, so it is checked rather than trusted.
//
// **It reads `RUNTIME_BUILD_LEGS`, not the npm script.** Until 2026-10-06 the script was
// `npm run build -w a -w b …` and this matched `-w` over its text; the step is a scheduler over those same
// commands now (`scripts/build-runtime.ts`, serial 26.9s against a 16.0s floor), so the list has to be
// imported or this case loses the independently-derived answer that is its whole point.
//
// Two exclusions, and neither is an exception so much as a division of labour. `@app/default-setup`:
// `build:default-setup` runs that exact command, and a second run of it rewrote the `dist` five steps read, which is
// what made a warm chain uncacheable. `@apackdev/sdk`: its `build` is `tsc -p tsconfig.json` over a config
// setting `noEmit`, so it emits nothing a step whose product is `APP_OUTPUTS` could carry, and
// `typecheck:sdk` runs that identical compile as its own step.
describe('the chain builds every workspace that has a build', () => {
  const OWNED_BY_COMPILE = '@app/default-setup';
  const EMITS_NOTHING = '@apackdev/sdk';
  const ELSEWHERE = [OWNED_BY_COMPILE, EMITS_NOTHING];

  it('names them all in build:runtime, or leaves them to another step', () => {
    const named = new Set(RUNTIME_BUILD_LEGS.map((leg) => leg.name));

    const withBuild = PACKAGE_DIRS.flatMap((dir) => {
      const manifest = path.join(REPO_ROOT, 'packages', dir, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(manifest, 'utf-8')) as { name: string; scripts?: Record<string, string> };
      return pkg.scripts?.build ? [pkg.name] : [];
    });

    const unbuilt = withBuild.filter((name) => !ELSEWHERE.includes(name) && !named.has(name));
    expect(unbuilt, 'add these to RUNTIME_BUILD_LEGS, or say which step builds them').toEqual([]);
    const gone = [...named].filter((name) => !withBuild.includes(name));
    expect(gone, 'RUNTIME_BUILD_LEGS names these and they have no build script').toEqual([]);
    for (const name of ELSEWHERE) {
      expect(named.has(name), `${name} is built by another step; a second run of it thrashes the cache`).toBe(false);
    }
  });

  // The leg table is data, so the way to show this case can fail is to drop a workspace from a copy of it
  it('reports a workspace the table stopped naming', () => {
    const short = new Set(RUNTIME_BUILD_LEGS.slice(1).map((leg) => leg.name));
    expect(RUNTIME_BUILD_LEGS[0]!.name, 'the table has something to drop').toBeDefined();
    expect(short.has(RUNTIME_BUILD_LEGS[0]!.name)).toBe(false);
  });
});

// Nested caches that can disagree, which is the defect this pair of checks exists for.
//
// A pool is two caches over one body of work: the chain stamps the step, `scripts/lib/unit-pool.ts` stamps
// each project. Such a pair is only sound when the inner layer's inputs **cover** the outer's — anything the
// outer treats as a reason to run must be a reason for some inner unit to run. Both directions fail, and
// differently, so both are checked.
//
// Narrower than its projects and the chain caches the step while a project inside it is stale: that project
// never runs again. Wider and the step goes stale for a reason no project can see, so it runs, asks each
// project, finds them all fresh, prints "all N project(s) up to date" and stamps green having tested
// nothing. That one happened: four runner files were declared on the step and on no project, and the file
// deciding what the pool runs was the one file the pool could not notice changing.
//
// The second check reads what the pool *actually fingerprints* rather than `suiteInputs` directly. Both are
// derived from it today, so comparing the step with `suiteInputs` would also pass — but it would keep
// passing if the pool started fingerprinting something else, which is the divergence that matters. The
// pool's fingerprint lives in its own module precisely so a spec can ask it: the script runs `main()` on
// import.
describe('a pool step and its projects cache on the same inputs', () => {
  const poolStep = (kind: 'host' | 'pack'): ChainStep => CHAIN_STEPS.find((s) => s.name === `test:unit:${kind}`)!;
  const projects = (kind: 'host' | 'pack'): UnitSuite[] => UNIT_SUITES.filter((suite) => suite.kind === kind);

  it.each(['host', 'pack'] as const)('%s reads everything its projects read', (kind) => {
    const declared = new Set(poolStep(kind).inputs);
    const missing = projects(kind)
      .flatMap((suite) => suiteInputs(suite, 'fast').filter((input) => !declared.has(input)).map((input) => `${suite.workspace} reads ${input}`));
    expect([...new Set(missing)]).toEqual([]);
  });

  it.each(['host', 'pack'] as const)('%s declares nothing its projects cannot see', (kind) => {
    // Either provenance: it changes the preimage's command and never the declared inputs, which is what
    // keeps this question — does the step declare anything its projects cannot see — about the inputs alone
    const fingerprinted = new Set(projects(kind).flatMap((suite) => poolUnitFor(suite, kind, 'chain').inputs.map(repoRelative)));
    const unseen = poolStep(kind).inputs.filter((input) => !fingerprinted.has(input));
    expect(unseen, 'the step would go stale for these and every project would still read fresh, so it would run '
      + 'and test nothing: put them in suiteInputs, where both cache layers read them').toEqual([]);
  });
});

// One chain step runs every expensive half, and which packages those are is derived from the configs each
// one has. The step's inputs follow that derivation; the root config that pools them cannot, being a file
// `check:specifiers` reads as text — so a package that gains an integration config would have its specs
// hashed into the step's cache key and never run. This is the half that has to be checked rather than
// derived, and it moved from the script's `-w` flags to the pool's projects when the three runs became one.
describe('the integration step runs every suite that has an expensive half', () => {
  it('names them all in the pooled config', async () => {
    const named = (await projectsOf('vitest.integration.config.ts'))
      .map((project) => /packages\/([\w-]+)\//.exec(project)?.[1] ?? project);
    expect(named.sort()).toEqual(INTEGRATION_SUITES.map((suite) => suite.dir).sort());
  });

  // That config is what the step eventually runs; naming the projects and then running something else would
  // pass the check above over a file nothing reads. The step is a pool now, so the claim has two halves — the
  // pool builds that command, and the step is that pool.
  //
  // Asked of the command `POOLS.integration.run` returns, not of the runner's text. Text was tried and was
  // vacuous: `chain-steps.ts` names the same config file to *find* the suites that have one, and a runner
  // concatenated with its imports contains that string whatever the command is. Mutating the command left the
  // check green, which is the shape the repo's own rule warns about — a check that reports nothing may have
  // looked at nothing.
  it('is what the step runs, through its pool', () => {
    const [run, ...rest] = POOLS.integration.run(INTEGRATION_SUITES);
    expect(rest, 'the expensive halves are one pooled run, not one per suite').toEqual([]);
    expect(run?.args ?? [], 'the pooled run must name the config whose projects were just checked')
      .toEqual(expect.arrayContaining(['--config', 'vitest.integration.config.ts']));
    expect((run?.args ?? []).filter((arg) => arg === '--project'), 'one --project per stale suite')
      .toHaveLength(INTEGRATION_SUITES.length);

    expect(ROOT_SCRIPTS['test:integration'], 'and the step has to be that pool rather than its own vitest')
      .toContain('test-unit-pool.ts integration');
    expect(runnerText('test:integration'), 'with the guard each package pretest used to provide')
      .toContain('packages:ensure');
  });
});

// `--all` has to arrive somewhere that honours it.
//
// A step declaring `keepsOnFailure` claims it writes those paths, and nothing at run time can tell whether
// it did: a path that names a tree nobody writes is skipped, so the keep reports nothing taken and reads
// exactly like a step that failed before writing. That is the whole value of the field — what a failure
// nobody can reproduce left behind — so the claim is checked against what the step says it writes rather
// than trusted. `outputs` or `excludes`: the first is a tree it declares for a later step, the second one
// it declares the parent of and reads around, and a Playwright output directory is one or the other.
describe('a step that keeps files on failure writes where it says', () => {
  const declaring = CHAIN_STEPS.filter((step) => step.keepsOnFailure !== undefined);

  it('there are some, so this check is not vacuous', () => {
    expect(declaring.map((step) => step.name)).not.toEqual([]);
  });

  it.each(declaring.map((step) => step.name))('%s', (name) => {
    const step = CHAIN_STEPS.find((candidate) => candidate.name === name)!;
    const writes = new Set([...(step.outputs ?? []), ...(step.excludes ?? [])]);
    const unwritten = (step.keepsOnFailure ?? []).filter((kept) => !writes.has(kept));
    expect(unwritten, `${name} keeps these on failure and declares writing none of them`).toEqual([]);
  });
});

// A step declaring `forceArgs` claims its command takes them, and nothing at run time can tell whether it
// did: a command that ignores an argument it does not know looks exactly like one that skipped its cache and
// found nothing to do. That is the shape of the bug this field was added for, so the claim is checked against
// the script rather than trusted.
describe('a step that declares forceArgs runs something that reads them', () => {
  const declaring = CHAIN_STEPS.filter((step) => step.forceArgs !== undefined);

  it('there are some, so this check is not vacuous', () => {
    expect(declaring.map((step) => step.name)).not.toEqual([]);
  });

  it.each(declaring.map((step) => step.name))('%s', (name) => {
    const step = CHAIN_STEPS.find((candidate) => candidate.name === name)!;
    const named = [...(ROOT_SCRIPTS[name] ?? '').matchAll(/\b(scripts\/[\w./-]+\.(?:ts|mjs))/g)].map(([, file]) => file);
    expect(named, `${name} declares forceArgs and its npm script runs no scripts/ file, so nothing can read them`).not.toEqual([]);
    const text = named.map((file) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8')).join('\n');
    const unread = (step.forceArgs ?? []).filter((flag) => !text.includes(`'${flag}'`));
    expect(unread, `${name} passes these under --all and ${named.join(', ')} never reads them`).toEqual([]);
  });
});

// The root vitest config lists its projects literally, because `check:specifiers` reads it as text and
// cannot read a computed list. This is the guard that the literal is the host suites and nothing else — a
// pack project appearing here would resolve workspace source instead of the published dist, silently.
describe('the root pool lists exactly the host suites', () => {
  it('matches UNIT_SUITES', async () => {
    const host = UNIT_SUITES.filter((suite) => suite.kind === 'host').map((suite) => `packages/${suite.dir}`);
    expect(await projectsOf('vitest.config.ts')).toEqual(host);
  });
});

/**
 * Each pool's width, in the config that sets it and in the table the chain's scheduler admits on.
 *
 * `maxWorkers` is process-wide, so it belongs to the root config and a per-project copy is read by nobody
 * — `unit-suites.ts` records the same thing measured for `poolOptions.execArgv` one pool along. Both halves
 * matter here: without the root value the pool silently runs at full width, which is 52.4s against 48.2s
 * measured, and a per-package copy would look like the cap while doing nothing.
 *
 * **`POOL_WIDTH` (`core-budget.ts`) is a second record of these same widths, and that is why it is checked
 * here rather than trusted.** The configs cannot read it — they stay literal because `check:specifiers`
 * reads them as text — so the table describes them, and a cap that moves has to fail somewhere.
 */
describe('every pool runs at the width core-budget.ts says it does', () => {
  /**
   * Each pool's chain step. Declared here rather than exported from `unit-pool.ts`, which `chain-steps.ts`
   * cannot import — it is imported *by* that module already, and the pool steps are built there. The first
   * case holds every entry to the real table, so a renamed step fails instead of reading as covered.
   */
  const STEP_OF: Record<Pool, string> = {
    host: 'test:unit:host',
    pack: 'test:unit:pack',
    integration: 'test:integration',
    native: 'test:native',
  };

  /** The config a pool's own command loads, so each case asks about the file that pool really reads */
  const configOf = (pool: Pool): string => {
    const [first] = POOLS[pool].run(POOLS[pool].suites());
    const named = first!.args.indexOf('--config');
    if (named !== -1) return first!.args[named + 1]!;
    const workspace = first!.args.indexOf('-w');
    if (workspace === -1) return 'vitest.config.ts';
    const suite = POOLS[pool].suites().find((candidate) => candidate.workspace === first!.args[workspace + 1]);
    return path.join('packages', suite!.dir, 'vitest.config.ts');
  };

  it('gives every pool an entry, so none is admitted on a weight nobody chose', () => {
    for (const pool of Object.keys(POOLS) as Pool[]) {
      expect(CHAIN_STEPS.map((step) => step.name), `${pool}'s step name`).toContain(STEP_OF[pool]);
      expect(POOL_WIDTH[STEP_OF[pool]], `${pool} has no POOL_WIDTH entry, so the chain would weigh it at one core`)
        .toBeDefined();
    }
  });

  it('caps the workers in the config that is read for it', async () => {
    const share = shareOf(STEP_OF.integration);
    expect(share, 'the integration pool is declared as a share, which is what a config can set').toBeDefined();
    expect((await resolvedConfig(configOf('integration'))).test?.maxWorkers).toBe(asPercent(share!));
  });

  it('leaves the pools it calls UNCAPPED with no cap in their configs', async () => {
    const uncapped = (Object.keys(POOLS) as Pool[]).filter((pool) => POOL_WIDTH[STEP_OF[pool]] === UNCAPPED);
    expect(uncapped.length, 'no pool is declared UNCAPPED, so this case asks nothing').toBeGreaterThan(0);
    for (const pool of uncapped) {
      const where = configOf(pool);
      const test = (await resolvedConfig(where)).test;
      const why = `${where} caps its workers, so UNCAPPED in POOL_WIDTH is wrong about what ${pool} takes`;
      expect(test?.maxWorkers, why).toBeUndefined();
    }
  });

  it('carries no per-project copy, which would be read by nobody', async () => {
    for (const project of await projectsOf('vitest.integration.config.ts')) {
      expect((await resolvedConfig(project)).test?.maxWorkers, `${project} declares maxWorkers, which is `
        + 'process-wide and set at the root: this one is inert and reads as protection').toBeUndefined();
    }
  });
});

// The other half of `forceArgs`: a step that keeps a cache must say so.
//
// The guard above checks that a step declaring `forceArgs` runs something that reads them. It cannot catch
// the case that actually happened — a step with a cache of its own and no `forceArgs` at all, where `--all`
// runs the step, the step consults its own stamps, finds nothing to do and returns green. Two unit pools
// did that with 2634 tests behind them.
//
// A step's runner reads stamps if it, or a `scripts/lib` module it imports, names one of the freshness
// functions. That is derivable, so it is derived rather than listed.
describe('a step whose runner reads stamps declares forceArgs', () => {
  /**
   * Calling one of these means the runner consults a stamp store, so the chain's `--all` has to reach it.
   *
   * **A call, not a mention, and the population comes from the modules that define them.** This was four
   * string literals here and a `text.includes` over the runner's source, which is wrong in both
   * directions: `scripts/bounded.ts` importing the step table for one constant put three steps in this
   * answer, each needing an exception recording that the name was "in its reach without being in its
   * behaviour", and a stamp reader nobody added to the four was invisible. `STAMP_READERS` is declared
   * beside the functions in each module and holds the functions themselves, so a rename is a compile
   * error; `importedCallsIn` asks the syntax tree whether a bound name is called.
   */
  const STAMP_READERS = new Set([...Object.keys(HOST_STAMP_READERS), ...Object.keys(POOL_STAMP_READERS)]);

  /**
   * Steps that read stamps and take no `forceArgs` on purpose. An entry that stops applying is reported.
   */
  const KEEPS_ITS_CACHE_UNDER_ALL: Record<string, string> = {
    'packages:ensure': 'forcing it would turn the 18 nested ensurePackagesBuilt() calls a chain makes into 18 builds behind one lock; the packages keep their own content-addressed stamps, which package-freshness.spec.ts covers, and "regardless of its stamp" means the chain\'s stamps',
  };

  const readsStamps = CHAIN_STEPS.filter((step) => runnerFiles(step.name)
    .some((file) => importedCallsIn(file, { names: STAMP_READERS }).length > 0));

  it('there are some, so this check is not vacuous', () => {
    expect(readsStamps.map((step) => step.name)).not.toEqual([]);
  });

  it.each(readsStamps.map((step) => step.name))('%s', (name) => {
    const step = CHAIN_STEPS.find((candidate) => candidate.name === name)!;
    if (KEEPS_ITS_CACHE_UNDER_ALL[name] !== undefined) {
      expect(step.forceArgs, `${name} is listed as keeping its cache under --all, so it must declare none`).toBeUndefined();
      return;
    }
    expect(step.forceArgs, `${name}'s runner consults its own stamps, so --all would run it and it would skip its work: give it forceArgs, or list it with why not`).toBeDefined();
  });

  it('lists no exception that has stopped reading stamps', () => {
    const stale = Object.keys(KEEPS_ITS_CACHE_UNDER_ALL).filter((name) => !readsStamps.some((step) => step.name === name));
    expect(stale, 'these no longer consult a stamp store; drop them').toEqual([]);
  });

  /**
   * The distinction the whole check rests on, over files written for it.
   *
   * Without these the derivation above could silently stop matching anything and every case over it would
   * still pass — and the text version it replaces failed in both directions at once, so neither answer can
   * be taken on trust. The third case is the regression that prompted the change: `scripts/bounded.ts`
   * imported the step table for one constant, which put three steps in the answer and wanted three
   * exceptions recording that a name was in their reach without being in their behaviour.
   */
  describe('what counts as reading a stamp', () => {
    const reader = [...STAMP_READERS][0]!;
    let dir = '';
    beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-readers-')); });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
    const wrote = (name: string, body: string): string => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, body);
      return file;
    };

    it('counts a call of an imported reader', () => {
      const file = wrote('calls.ts', `import { ${reader} } from './x.ts';\n${reader}();\n`);
      expect(importedCallsIn(file, { names: STAMP_READERS })).toEqual([reader]);
    });

    it('counts a call through a namespace, however it is spelled', () => {
      const file = wrote('ns.ts', `import * as anything from './x.ts';\nanything.${reader}();\n`);
      expect(importedCallsIn(file, { names: STAMP_READERS })).toEqual([`anything.${reader}`]);
    });

    it('does not count an import that never calls it, which is what an exception used to record', () => {
      const file = wrote('imports.ts', `import { ${reader} } from './x.ts';\nexport const held = ${reader};\n`);
      expect(importedCallsIn(file, { names: STAMP_READERS }),
        'an import is not a use, and three steps needed exceptions saying so').toEqual([]);
    });

    it('does not count a bare mention, which is all the text check ever saw', () => {
      const file = wrote('mentions.ts', `export const prose = 'see ${reader} for why';\n`);
      expect(importedCallsIn(file, { names: STAMP_READERS })).toEqual([]);
    });

    it('does not count a same-named local, since the name has to be bound by an import', () => {
      const file = wrote('local.ts', `function ${reader}(): void {}\n${reader}();\n`);
      expect(importedCallsIn(file, { names: STAMP_READERS })).toEqual([]);
    });

    it('ignores a call that is not one of the readers', () => {
      const file = wrote('other.ts', "import { somethingElse } from './x.ts';\nsomethingElse();\n");
      expect(importedCallsIn(file, { names: STAMP_READERS })).toEqual([]);
    });
  });
});

/**
 * The chain runs every recorded file's check.
 *
 * An `<name>:check` that nothing runs is a recorded file free to go stale with every gate green, and with
 * CI off the chain is the only gate — a check named only by `.github/workflows/ci.yml`, whose triggers are
 * commented out, runs nowhere. This is a check rather than a sweep somebody repeats.
 *
 * It asks what a step *invokes*, not what its text mentions: `check-import-specifiers.ts` prints `api:check` in
 * a message, and a search over the reachable text would read that as the chain running it. The walk is
 * `reachableText` from `scripts/lib/npm-scripts.ts`, which `check:tiers` uses for its own question — one
 * follower, so the two cannot disagree about what a step reaches.
 *
 * A check counts as run when its own `<workspace>:<name>` is invoked **or** the bare `<name>` is: root
 * `lint:check` fans out with `-ws`, which no `-w <name>` pattern can follow, and a recorded file's exception is
 * about the recorded file rather than about each workspace the root script delegates to.
 */
/**
 * A recorded file has both halves.
 *
 * The convention is that `<name>:check` and `<name>:update` carry the same noun, and root CLAUDE.md
 * gives the reason: "a recorded file with only an update is one nothing will notice has gone stale". Until this,
 * that rule was prose — `sdk-modules:update` had no check for as long as it has existed, and the only thing
 * standing between it and a silent staleness was a spec in another package that happens to compare the file.
 *
 * One direction only. Requiring an `:update` for every `:check` would buy an exceptions list and nothing
 * else: `lint:check` pairs with `lint:fix` and `packages:check` with `packages:build`, both under the
 * `<action>:<variant>` shape, and neither records a file that can go stale.
 */
describe('a recorded file has both halves', () => {
  const scriptsByManifest = (): { where: string; scripts: Record<string, string> }[] =>
    [{ where: 'root', file: path.join(REPO_ROOT, 'package.json') },
      ...PACKAGE_DIRS.map((dir) => ({ where: dir, file: path.join(REPO_ROOT, 'packages', dir, 'package.json') }))]
      .map(({ where, file }) => ({ where, scripts: (JSON.parse(fs.readFileSync(file, 'utf-8')) as
        { scripts?: Record<string, string> }).scripts ?? {} }));

  it('gives every `:update` the `:check` that notices it has gone stale', () => {
    const manifests = population('the manifests to read', scriptsByManifest(), { atLeast: 10 });
    const updates = manifests.flatMap(({ where, scripts }) => Object.keys(scripts)
      .filter((name) => name.endsWith(':update'))
      .map((name) => ({ where, noun: name.slice(0, -':update'.length), scripts })));
    expect(updates.length, 'no `:update` script was found, so this would pass over nothing').toBeGreaterThan(3);
    const unchecked = updates
      .filter(({ noun, scripts }) => scripts[`${noun}:check`] === undefined)
      .map(({ where, noun }) => `${where}'s ${noun}:update`);
    expect(unchecked, 'these rewrite a committed file and nothing named for that recorded file re-derives it. Add '
      + 'the `:check` half — it may be a one-line wrapper for a spec that already compares it, as '
      + 'content-parity:check is').toEqual([]);
  });
});

describe("the chain runs every recorded file's check", () => {
  /** A `:check` script the chain does not run, and why. An entry that stops applying is reported. */
  const NOT_RUN_BY_THE_CHAIN: Record<string, string> = {
    'session:check': 'runs the full chain over explicitly named branches in another checkout; nesting it in the chain would recurse',
    // These are commands over a rule a spec already asserts, so the recorded file is checked and the script is
    // a way to ask by hand.
    'content-parity:check': 'a wrapper for `npm test -- tests/content`; those specs run in test:unit:pack',
    'sdk-modules:check': 'a wrapper for `sdk-bridge-drift.spec.ts`, which compares the generated file against a fresh render; it runs in test:unit:host',
    'flow-export:check': 'a wrapper for `npm test -- tests/extensions/steps/export-example.spec.ts`; that spec runs in test:unit:pack, where it compares the flow DSL example rather than recording it',
  };

  /** Every `<name>:check` in the repo, as the label of the manifest declaring it and the script's name */
  const checkScripts = (): { where: string; name: string }[] => {
    const manifests = [path.join(REPO_ROOT, 'package.json'),
      ...PACKAGE_DIRS
        .map((dir) => path.join(REPO_ROOT, 'packages', dir, 'package.json'))
        .filter((file) => fs.existsSync(file))];
    return manifests.flatMap((file) => {
      const pkg = JSON.parse(fs.readFileSync(file, 'utf-8')) as { name?: string; scripts?: Record<string, string> };
      const where = file === path.join(REPO_ROOT, 'package.json') ? 'root' : pkg.name ?? file;
      return Object.keys(pkg.scripts ?? {}).filter((name) => name.endsWith(':check')).map((name) => ({ where, name }));
    });
  };

  const invokedByTheChain = (): Set<string> => {
    const all = rootScripts();
    const invoked = new Set<string>();
    for (const step of CHAIN_STEPS) for (const name of reachableText(step.name, all).invoked) invoked.add(name);
    // `reachableText` follows `npm run` one level, out of a script's own text, and deliberately not out of the
    // files it runs — a text scan cannot tell a command from a mention, and a loose answer here would say a
    // check runs when nothing runs it. `typecheck` moved its commands into a module, so the module says what it
    // runs rather than being read for it.
    for (const leg of TYPECHECK_LEGS) {
      const [, name, workspace] = /npm run ([\w:-]+)(?:.*-w\s+(\S+))?/.exec(leg.command) ?? [];
      if (name === undefined) continue;
      invoked.add(name);
      if (workspace !== undefined) invoked.add(`${workspace}:${name}`);
    }
    return invoked;
  };

  it('leaves none of them unrun', () => {
    const invoked = invokedByTheChain();
    const unrun = checkScripts()
      .filter(({ where, name }) => !invoked.has(name) && !invoked.has(`${where}:${name}`))
      .filter(({ name }) => NOT_RUN_BY_THE_CHAIN[name] === undefined)
      .map(({ where, name }) => `${where}'s ${name}`);
    expect(unrun, 'nothing in the chain runs these, so what they record can go stale with every gate green: '
      + 'add them to a step that already reads what they read, or list them with why not').toEqual([]);
  });

  it('lists no exception that has stopped applying', () => {
    const declared = checkScripts();
    const invoked = invokedByTheChain();
    const stale = Object.keys(NOT_RUN_BY_THE_CHAIN).flatMap((name) => {
      const found = declared.filter((script) => script.name === name);
      if (found.length === 0) return [`${name}: no package declares it any more`];
      return found.every(({ where }) => invoked.has(name) || invoked.has(`${where}:${name}`))
        ? [`${name}: the chain runs it now, so it needs no exception`] : [];
    });
    expect(stale).toEqual([]);
  });

  /** What stops the cases above passing over an empty list */
  it('finds the checks to ask about', () => {
    const found = checkScripts();
    expect(found.length).toBeGreaterThan(5);
    expect(found.map(({ name }) => name), 'schema:check is one of the two this check was written for')
      .toContain('schema:check');
  });
});

/**
 * A build unit declares the modules its build script imports.
 *
 * `BuildUnit.inputs` is a hand-written list of what a build reads, and a list of someone else's inputs is a
 * guess — the same shape that let `api:stamp` pass over an input nobody had listed. Measured 2026-09-27: the
 * three `compiled()` units declared `scripts/build-package.ts` and not
 * `@apackdev/host/build/published-manifest`, which it imports and which derives the manifest they stage. Editing
 * that module left all three staged trees stale while every stamp read fresh.
 *
 * Derived, so it holds for the next module too: follow the script's imports and require the closure to be
 * inside what the unit declares. A subset check, like `gives every step the files its own script names` above —
 * it proves a unit reads what it declares, never that it declares nothing extra, which over-declaring is the
 * harmless direction.
 */
describe('a build unit declares the modules its build script imports', () => {
  /**
   * The script to walk from, `buildScriptFor` (`@apackdev/host/build/packages-built`) — a workspace's own
   * `build:package`, and deliberately **not** the unit's declared inputs, which are the thing under test.
   * Deriving the entry from that list made this case vacuous, and a mutation found it: drop
   * `scripts/build-package.ts` from `compiled()` and there was no entry left to walk from, so the check passed
   * for having nothing to check. `package-freshness.spec.ts` reads the same function to decide which units
   * inline host source, so the two cannot disagree about how a unit is built.
   */
  const buildScriptOf = (workspace: string): string => path.join(REPO_ROOT, buildScriptFor(workspace));

  /**
   * Not `coveredBy` above: that one takes a chain step, whose inputs are repo-relative by design, and joins
   * them to the root. A `BuildUnit`'s are absolute, and `path.join` does not reset on an absolute second
   * argument — it doubles the root, covers nothing, and this case then reports every module including its own
   * entry. Which is what it did.
   */
  const unitCovers = (unit: BuildUnit): Set<string> =>
    new Set(unit.inputs.flatMap((input) => inputFiles(input)));

  it.each(Object.keys(BUILD_UNITS))('%s', (workspace) => {
    const covered = unitCovers(BUILD_UNITS[workspace]!);
    const missing = closureOf([buildScriptOf(workspace)])
      // A module that decides *whether* to build cannot change what the build emits, so it is deliberately not
      // an input — `package-freshness.spec.ts` refuses one, and this demanded one on the day it landed. That
      // spec is also where an entry going stale shows up, since it fails the moment a unit names one; only one
      // of the two entries is even reachable from a build script, the other being the command over them.
      .filter((file) => NOT_A_BUILD_INPUT[file] === undefined)
      .filter((file) => !covered.has(file));
    expect(missing,
      `${workspace}'s build imports these and does not declare them, so editing one leaves its output stale while its stamp reads fresh`)
      .toEqual([]);
  });

  /**
   * An entry nobody reaches is a claim nobody revisits, which every other exception table in this repo reports.
   *
   * Two ways to qualify, because the two entries qualify differently: `packages-built.ts` is *imported* by a
   * build script, and `scripts/ensure-packages-built.ts` is the command that calls the builds — no build script
   * imports it, and `packages:ensure` declares it as its own input. An entry that is neither is describing
   * nothing. Getting this predicate wrong is how it was first written: requiring an import reported the command.
   */
  it('lists no NOT_A_BUILD_INPUT entry that nothing reaches', () => {
    const imported = new Set(Object.keys(BUILD_UNITS).flatMap((workspace) => closureOf([buildScriptOf(workspace)])));
    const declared = new Set(CHAIN_STEPS.flatMap((step) => step.inputs));
    const orphans = Object.keys(NOT_A_BUILD_INPUT)
      .filter((file) => !imported.has(file) && !declared.has(file))
      .map((file) => `${file}: no build script imports it and no chain step declares it`);
    expect(orphans, 'an exception for something nothing reads describes nothing').toEqual([]);
  });

  /** What stops the case above passing by walking nothing */
  it('follows each build script past itself', () => {
    const shallow = Object.keys(BUILD_UNITS).flatMap((workspace) => {
      const closure = closureOf([buildScriptOf(workspace)]);
      return closure.length > 1 ? [] : [`${workspace}'s closure is ${closure.length} files`];
    });
    expect(shallow, 'a closure of one file is the entry alone, which means the walk resolved nothing').toEqual([]);
  });
});
