// A test is bounded by its progress and its CPU, never by the clock: a busy machine makes a test slow and never
// stuck, and a deadline measured on the clock failed healthy tests for the load they ran under. Every config turns
// vitest's clock off (`testTimeout: 0`, `hookTimeout: 0`) and loads the progress guard (`@apackdev/testing`'s
// `vitest-progress-guard.ts`), which fails a test or hook whose process tree stalls and a test that spends its CPU
// budget. The budget is per size, not per package: a config provides its size's (`apack.testCpuMs`, `DEADLINE_FACTOR`
// times `SIZE_MS`), and a test that needs more declares `meta: cpuBudget(ms)` with a reason listed here.
//
// The configs keep plain literals, deliberately: a vitest config importing a constant across package layers is the
// thing `check:specifiers` exists to prevent. So the literals are checked here, both directions — a budget tighter
// than the size is not a safe default — and every test's own declaration is read from its syntax tree, since a
// config states the policy and a test can still escape it.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { INTEGRATION_SUITES, NATIVE_SUITES } from '../../../scripts/lib/chain-steps.ts';
import { DEADLINE_FACTOR, SIZE_MS, UNIT_SUITES, type Size } from '../../../scripts/lib/unit-suites.ts';
import ts from 'typescript';
import { constantMs, overrideKey, sizeOf, specFilesUnder, timeoutOverrides, type TimeoutOverride } from '../../../scripts/lib/test-timeouts.ts';
import { repoFiles } from './_support/repo-files.ts';

/**
 * Tests allowed a CPU budget above their size's, and why.
 *
 * A reason composes its budget from the phases its test runs, and its figures are what those phases take or are
 * bounded at on the clock. As CPU budgets, the integration half's were each found to be at least twice what its test
 * spends (forced readings, 2026-11-07); the native half's have no such reading, and a native test whose compilers
 * run in parallel can spend more CPU than its wall time, so a failure there at its budget is a figure to re-take.
 *
 * An entry is a claim that one test genuinely needs more than its size gives — not that the default was
 * once 5s and nobody revisited it, which is what the other overrides turned out to be. The check below
 * fails on an entry whose override has gone, so the list shrinks when the reason does.
 */
const TIMEOUT_EXCEPTIONS: Record<string, string> = {
  'packages/apack-cli/tests/build/watch-package-edit.native.spec.ts > publishes one build when a refresh rewrites what the pack builds against':
    'One bounded cold watcher build (120s), one watched rebuild and the wait for a second build that must not start are sequential.',
  'packages/apack-cli/tests/build/own-declarations.integration.spec.ts > preserves owned names through authoring, compiled snapshots, source-free discovery and runtime loading':
    'One explicitly bounded cold backend/frontend build (120s) precedes snapshot checks, source-free inspection and runtime admission (20s). Its registered builder receives test cancellation and drains before inputs are deleted; all declaration/shape/provenance/activation assertions remain.',
  'packages/apack-cli/tests/build/types-bundler-determinism.integration.spec.ts > is identical from the workspace and from the packed tarballs a consumer installs':
    'Two bounded cold public builds (180s each), package materialization (60s) and verification/disposal (20s) are sequential. Asynchronous commands preserve runner responsiveness; test cancellation kills the active command and teardown waits for it before removing inputs.',
  'packages/apack-cli/tests/build/compiler-native-runtime.native.spec.ts > builds and archives a real pack under the %s Electron runtime':
    'Four sequential commands: init/add/archive retain 60s each; the real Electron build includes captured backend (180s allowance) and cold frontend (120s). Control 39257458780 reaches frontend compilation before the former 180s full-build limit aborts it. The 540s case composes these commands plus 60s verification/disposal, retaining forced-close grace and every runtime/output/retirement/passive-archive assertion.',

  'packages/apack-cli/tests/commands/scaffold.integration.spec.ts > adds a step (declared, shipped in build/steps.build.mjs) and a service that build':
    "Step generation (60s), service generation (60s), public backend/frontend build (180s + 120s), typecheck (60s) and cleanup (20s) are sequential. Diagnostic 39306120746 measures the build at 116.345s and the two generators at 23.120s/49.270s; Run 39309152812 proves a full public build exceeds the mistaken backend-only 120s limit after emitting its frontend. Match the existing Electron public-build composition; separate command bounds remain cancellable.",
  'packages/apack-cli/tests/build/frontend-resources-watch.native.spec.ts > watches initially empty external Tailwind content through nested directory links':
    "Initial capture precedes two directory-membership/link-retarget builds, with separate request, compiler and notification bounds from watch-builds.",
  'packages/apack-cli/tests/build/staged-dsl.integration.spec.ts > preserves a verified build on a later failure, then publishes and reuses the current definitions with its frontend':
    "Five real builds cover publication, refusal, repair, reuse and removal, followed by verification and disposal.",
  'packages/apack-cli/tests/build/build-output-swap.integration.spec.ts > does not reuse facade files from an incumbent with stamps from a refused replacement':
    "Three sequential real builds, including refusal and recovery, followed by integrity verification and disposal.",
  'packages/apack-cli/tests/build/watch-external-types.native.spec.ts > rebuilds external contracts and recovers a retargeted missing input without an authored edit':
    "Initial capture precedes replacement, refusal and recovery builds; watch-builds bounds each request/compiler operation before the unchanged notification checks.",
  'packages/apack-cli/tests/build/compiler-pe-libraries.native.spec.ts > repairs a failed Vite assembly context through newly discovered watch inputs':
    'The cold initial build (120s; 118.6s on the two-core Windows runner in 39635524957) precedes four watch phases of up to 60s each: the initial frontend, the refused build, draining a refused build its own edits queued, and the repair build. Cleanup has 20s. Every refusal, subscription, publication and loaded-value assertion remains.',
  'packages/apack-cli/tests/build/build-worker.native.spec.ts > uses the captured compiler and retains unchanged build/cache identity on repeat builds':
    'Two independent cold compiler installations/builds plus archive and reuse verification. On the two-core Windows VM, the first build takes 155.705 seconds and 240 seconds expires during the second. Two-worker macOS control 39206807491 completes the second build at 111.034 seconds; the broad pool expires at its former 120s outer bound after the first build. The same sequential scenario gets 360 seconds on every platform. Both builders are teardown-owned and all source-path, cache, output and disposal assertions remain.',
  "packages/apack-cli/tests/build/build-output-swap.integration.spec.ts > publishes help as snapshot data and retains accepted articles after an invalid edit":
    "Two successful builds and one refused help edit share the case; retain article, revision and staging assertions.",
  "packages/apack-cli/tests/build/dependency-inputs.integration.spec.ts > retains the consumer build when a content compiler changes accepted dependency bytes":
    "Producer and consumer builds precede a refused replacement; dependency bytes and incumbent verification remain required.",
  "packages/apack-cli/tests/build/build-registry.integration.spec.ts > compiles flows against the steps it loaded, and leaves the bound registry untouched":
    "One successful compilation and one refused replacement share the scenario; retain registry and receipt assertions.",
  "packages/apack-cli/tests/build/frontend-resources.integration.spec.ts > rebuilds Vue styles after only an external stylesheet changes":
    "Initial publication and stylesheet-only rebuild are sequential; verification and disposal follow.",
  "packages/apack-cli/tests/commands/scaffold.integration.spec.ts > adds a feature, builds, typechecks and packs a verified archive":
    "Feature generation, validate, doctor, typecheck and archive have 60s allowances, the full public build has 180s backend + 120s frontend, and extraction/verification/cleanup have 20s. Commands run asynchronously with independent cancellation.",
  "packages/apack-cli/tests/commands/scaffold.integration.spec.ts > records the facade dependents compile against, and then reports it up to date":
    "Three source-facade derivations (60s each) on the pack the preceding case built precede verification/cleanup (20s); keep missing, update and current-report assertions.",
  "packages/apack-cli/tests/commands/scaffold.integration.spec.ts > keeps unit tests runnable after init-tests adds Playwright specs":
    "Test scaffolding and the pack's nested Vitest process each retain a 60s operation bound; compose those with 20s verification/cleanup.",
  "packages/apack-cli/tests/commands/scaffold.integration.spec.ts > refuses to build, pack or generate entries for a manifest the installer would reject":
    "Three distinct CLI refusals each retain a 60s operation bound; compose them with 20s verification/cleanup rather than timing their sum as one operation.",
  "packages/apack-cli/tests/build/tool-identity.integration.spec.ts > refuses skipped generation after a packaged helper chunk changes at the same CLI version":
    "Two generations, a refused build and a regeneration from a copied packaged CLI are sequential, each a cold CLI start with its own 60s bound; compose them with 20s verification/cleanup. Strict run 39585955406 measured the four at 62.6s together, past the half's 60s.",
  "packages/apack-cli/tests/commands/scaffold.integration.spec.ts > regenerates entries when a source file codegen reads changes, not only the manifest":
    "Two separate CLI generation commands prove invalidation and subsequent unchanged reuse.",
  "packages/apack-cli/tests/build/dsl-snapshot.integration.spec.ts > publishes and reuses editor definitions without globals or frontend activation, readable from an installed copy without source":
    "Two real builds prove editor definition publication and cached reuse; installed source-free discovery, integrity and input-record verification follow.",
  "packages/apack-cli/tests/build/compiler-esbuild-configuration.integration.spec.ts > publishes captured %s despite a transient live edit restored during bundling":
    "A complete cold backend build generates and bundles declarations before staging, source-path checks and actual runtime execution; verification follows its 120s build allowance.",
  "packages/apack-cli/tests/commands/add-extensions.integration.spec.ts > scaffolds a hyphenated trigger with declared track metadata and checked callbacks":
    "Pack initialization, trigger scaffolding with code generation and TypeScript checking are three sequential toolchain operations.",
  "packages/apack-cli/tests/commands/add-extensions.integration.spec.ts > scaffolds an artifact viewer taking artifact, declared with its icon and viewer":
    "Each of two artifact scaffolds regenerates pack entries; declaration and component assertions follow.",
  "packages/apack-cli/tests/commands/add-extensions.integration.spec.ts > scaffolds display blocks taking their props and input blocks taking disabled/response, emitting submit/cancel":
    "Display and input block scaffolds each regenerate entries before component/manifest verification.",
  "packages/apack-cli/tests/commands/add-extensions.integration.spec.ts > declares each migration under its version line and the version it targets, which the pack entry registers and tsc accepts":
    "Four migration scaffolds, explicit generation and a real TypeScript program run sequentially.",
  "packages/apack-cli/tests/build/watch-module-freshness.native.spec.ts > refreshes flow modules loaded through ordinary imports on the next watched build":
    "Initial capture precedes a real flow rebuild; its request, compiler operation and original notification check have separate bounds.",
  "packages/apack-cli/tests/build/watch-module-freshness.native.spec.ts > recompiles changed transitive content modules and retains the accepted build on failure":
    "Initial capture precedes a replacement and a refused content build, each with separate request/compiler bounds and the original notification check.",
  "packages/apack-cli/tests/build/frontend-workers.native.spec.ts > retains the accepted build after a worker error and publishes its repair":
    "Initial capture precedes refused and repaired worker builds, bounded separately from their unchanged notification checks.",
  "packages/apack-cli/tests/build/frontend-resources-watch.native.spec.ts > watches an external %s asset in a separate directory":
    "Initial capture precedes an asset rebuild; watch-builds separates the request/compiler limits from the original notification check.",
  "packages/apack-cli/tests/build/package-inputs-watch.native.spec.ts > automatically rebuilds an undeclared runtime imported by $name without a type or authored edit":
    "Initial capture precedes an imported-runtime rebuild with separate request/compiler bounds and the original notification check.",
  "packages/apack-cli/tests/build/editor-declarations.integration.spec.ts > builds declared editor members and step presentation, then discovers a copied source-free build":
    "A cold captured public build precedes source-free inspection, actual frontend loading and disposal.",
  "packages/apack-cli/tests/build/package-inputs.integration.spec.ts > keeps a captured build current after standalone generation with unchanged generated code":
    "Cold public build, standalone generation and common-record replays run sequentially.",
  "packages/apack-cli/tests/commands/info.integration.spec.ts > reports authentic compiled content and cached dependency provenance after producer source removal":
    "Two actual pack builds and three CLI archive/inspection commands precede source-removal/provenance assertions.",
  "packages/apack-cli/tests/build/frontend-generation.native.spec.ts > refreshes backend and live frontend together, retains failed incumbents and awaits retirement":
    "Frontend startup, refused cold replacement and repaired cold replacement are sequential; existing 2s HMR/fetch limits and retirement checks remain.",
  "packages/apack-cli/tests/build/build-output-swap.integration.spec.ts > rebuilds damaged %s data instead of renewing its checksums":
    "Two sequential captured builds precede checksum, facade restoration and staged-build verification; both variants exceeded the former 60s case limit.",
  "packages/apack-cli/tests/build/dependency-graph.integration.spec.ts > still fails when two independent packs declare the same entity":
    "A rival pack build precedes a separate public CLI collision refusal and its diagnostic assertions; the combined case exceeded 60s.",
  "packages/apack-cli/tests/commands/scaffold.integration.spec.ts > fails the build on an unresolvable dependency":
    "Separate public build and archive refusals verify the diagnostic and retained incumbent; their combined case exceeded 60s.",
  "packages/apack-cli/tests/commands/add-extensions.integration.spec.ts > generates flow helpers for the kebab-case step that typecheck with tsc":
    "Step scaffolding/regeneration, explicit code generation and a separate TypeScript program run sequentially; affected acceptance measured 51.5s against the old 60s aggregate.",
  "packages/apack-cli/tests/commands/add-extensions.integration.spec.ts > refuses a version it already declares on that line, leaving the manifest as it was":
    "After the immediate duplicate refusal, app-line migration scaffolding/regeneration, explicit generation and a separate typecheck run sequentially.",
  "packages/apack-cli/tests/commands/facade-report.integration.spec.ts > checks the verified current build without changing generated files":
    "Publishing the newly authored report requires a cold build before passive from-build inspection and unchanged-file assertions.",
  "packages/apack-cli/tests/build/frontend-resources-watch.native.spec.ts > recovers a missing nested stylesheet while retaining the accepted build":
    "After the separate startup hook, replacement, missing-input refusal and repair each need a bounded request/build followed by the unchanged notification check.",
  "packages/apack-cli/tests/build/watch-publication.native.spec.ts > publishes source and manifest edits together and retains the incumbent after refusal":
    "After initial setup, changed, refused and repaired builds each have separate request/compiler/notification bounds, retaining host reload and incumbent assertions.",
  "packages/apack-cli/tests/build/watch-publication.native.spec.ts > follows retargeted manifest links through refusal, repair and atomic replacement":
    "A malformed-manifest preflight refusal keeps its original 20s bound; repair and atomic replacement then use separate request/build/notification bounds.",
};

/** Every override in the repo's spec files, with the size it has to fit inside */
function overrides(): (TimeoutOverride & { size?: Size; budget?: number })[] {
  const specs = UNIT_SUITES.flatMap(suite => specFilesUnder(path.join(REPO_ROOT, 'packages', suite.dir, 'tests')));
  const helpers = repoFiles().filter(file => file.includes('/tests/_support/') && file.endsWith('.ts'))
    .map(file => path.join(REPO_ROOT, file));
  return [...new Set([...specs, ...helpers])]
    .flatMap((file) => timeoutOverrides(file, REPO_ROOT))
    .map((override) => {
      // Shared helpers have no runnable target; each override requires an explicit reason.
      if (override.file.includes('/tests/_support/')) return override;
      const size = sizeOf(override.file);
      return { ...override, size, budget: SIZE_MS[size] };
    });
}

/** Every test config in the repo, and its size — so a new one cannot go unchecked */
function configs(): { file: string; size: Size }[] {
  const found: string[] = [
    ...UNIT_SUITES.map((suite) => path.join('packages', suite.dir, 'vitest.config.ts')),
    ...INTEGRATION_SUITES.map((suite) => path.join('packages', suite.dir, 'vitest.integration.config.ts')),
    ...NATIVE_SUITES.map((suite) => path.join('packages', suite.dir, 'vitest.native.config.ts')),
    'playwright.config.ts',
  ];
  return found
    .filter((file) => fs.existsSync(path.join(REPO_ROOT, file)))
    .map((file) => ({ file, size: sizeOf(file) }));
}

const TIMEOUT_KEYS = ['testTimeout', 'hookTimeout', 'teardownTimeout', 'timeout'];
/** The CPU a config gives each test, which the progress guard reads (`provide: { 'apack.testCpuMs': … }`) */
const CPU_KEY = 'apack.testCpuMs';

/**
 * Where a config's timeouts are declared: its own text, and the helper it delegates to.
 *
 * A pack's config is a call to one of these helpers, which holds the budget so that every pack's suite runs
 * with the same one — the whole point of collapsing the copies into it. This check reads a config as *text*
 * rather than importing it (importing one creates a temp data dir), so the delegation has to be followed
 * here or the property it checks reads as absent the moment a pack stops restating it. The helper's source
 * comes first, so a pack that overrides a key still wins.
 *
 * One entry per runner, because a timeout means something different to each: `definePackTestConfig` holds
 * `testTimeout`/`hookTimeout` for vitest, `definePackE2EConfig` holds Playwright's `timeout`. A helper
 * missing from here reads as a config that declares nothing — which is a passing `declares nothing above
 * its budget` and a failing `declares its budget`, so it fails loudly rather than quietly.
 */
const DELEGATES: Record<string, string> = {
  definePackTestConfig: path.join('packages', 'apack-testing', 'src', 'vitest.ts'),
  definePackE2EConfig: path.join('packages', 'apack-testing', 'src', 'playwright.ts'),
};

/**
 * The helper's own body, not the whole file it lives in.
 *
 * One module can hold several helpers with different answers: `src/playwright.ts` has three, and two of
 * them declare `timeout: 0` because a driving run and a serving session have no deadline at all. Reading
 * the file whole found those zeros for a config that delegates to the E2E helper and reported the root
 * suite's budget as 0ms. So the delegation is to a declaration, and this is where it ends.
 */
function helperBody(source: string, helper: string): string {
  const from = source.indexOf(`export function ${helper}`);
  if (from === -1) return source;
  const rest = source.slice(from);
  const next = rest.indexOf('\nexport ', 1);
  return next === -1 ? rest : rest.slice(0, next);
}

function timeoutSources(file: string): string[] {
  const own = fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8');
  const delegate = Object.entries(DELEGATES).find(([helper]) => own.includes(helper));
  if (delegate === undefined) return [own];
  const [helper, source] = delegate;
  return [helperBody(fs.readFileSync(path.join(REPO_ROOT, source), 'utf-8'), helper), own];
}

/** The timeout values a config declares, ignoring commented-out lines */
function declaredTimeouts(file: string): { key: string; ms: number }[] {
  const out: { key: string; ms: number }[] = [];
  for (const raw of timeoutSources(file).join('\n').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('//') || line.startsWith('*')) continue;
    for (const key of TIMEOUT_KEYS) {
      const match = new RegExp(`\\b${key}\\s*:\\s*([\\d_]+)`).exec(line);
      if (match) out.push({ key, ms: Number(match[1].replace(/_/g, '')) });
    }
    const cpu = /'apack\.testCpuMs'\s*:\s*([\d_]+)/.exec(line);
    if (cpu) out.push({ key: CPU_KEY, ms: Number(cpu[1]!.replace(/_/g, '')) });
  }
  return out;
}

describe('a test does not quietly buy itself more CPU than its size allows', () => {
  it('declares no CPU budget above its size budget, except where the list says why', () => {
    const over = overrides().filter((override) => override.kind === 'cpu')
      .filter((override) => override.budget === undefined || override.ms === undefined || override.ms > override.budget)
      .filter((override) => !(overrideKey(override) in TIMEOUT_EXCEPTIONS))
      .map((override) => `${override.file}:${override.line} ${override.runner} sets ${override.ms === undefined ? 'a timeout this cannot evaluate' : `${override.ms / 1000}s`}; `
        + (override.budget === undefined ? 'a shared helper\'s budget requires explicit review'
          : `a ${override.size} target allows ${override.budget / 1000}s`));
    expect(over, 'remove it, or add it to TIMEOUT_EXCEPTIONS with the reason it needs more').toEqual([]);
  });

  // A list of exceptions is honest only while each one is still an exception: an override that has gone, or
  // that now fits its size's budget, excuses nothing
  it('lists no exception whose override has gone or fits its budget', () => {
    const live = new Set(overrides()
      .filter((override) => override.kind === 'cpu')
      .filter((override) => override.budget === undefined || override.ms === undefined || override.ms > override.budget)
      .map(overrideKey));
    expect(Object.keys(TIMEOUT_EXCEPTIONS).filter((key) => !live.has(key)), 'drop these from TIMEOUT_EXCEPTIONS').toEqual([]);
  });
});

describe('no test is timed out by the clock', () => {
  it('sets no timeout vitest measures on the clock, in any test or hook', () => {
    const clocks = overrides().filter((override) => override.kind === 'clock')
      .map((override) => `${override.file}:${override.line} ${override.runner} sets ${override.ms === undefined ? 'a timeout' : `${override.ms / 1000}s`} on the clock`);
    expect(clocks, 'a busy machine reaches any clock: declare `meta: cpuBudget(ms)` for a test that needs more CPU, '
      + 'and nothing for a hook, which the guard bounds by its progress').toEqual([]);
  });

  // Over a file written here, so each form the reader must refuse has a firing case of its own, and the form it
  // must accept is shown to read as CPU rather than slipping through as neither
  it('reads a trailing timeout and an options `timeout` as the clock, and `cpuBudget` as CPU', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-timeouts-'));
    try {
      const file = path.join(dir, 'forms.spec.ts');
      fs.writeFileSync(file, [
        "it('trailing', () => {}, 5_000);",
        "it('options', { timeout: 2 * 1_000 }, () => {});",
        "beforeAll(() => {}, 7_000);",
        "it('budget', { meta: cpuBudget(90_000) }, () => {});",
        "it('plain', () => {});",
      ].join('\n'));
      expect(timeoutOverrides(file, dir).map(({ name, runner, kind, ms }) => ({ name: name || runner, kind, ms }))).toEqual([
        { name: 'trailing', kind: 'clock', ms: 5_000 },
        { name: 'options', kind: 'clock', ms: 2_000 },
        { name: 'beforeAll', kind: 'clock', ms: 7_000 },
        { name: 'budget', kind: 'cpu', ms: 90_000 },
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Specs allowed `promisify(execFile)`, and why. It is the clock's form of `execFileWhileWorking`: its `timeout` ends
 * a process at a wall time a busy machine reaches. An entry is a spec that cannot reach the other one.
 */
const CLOCKED_EXEC_ALLOWED: Record<string, string> = {
  'packages/apack-ears/tests/engine/watch.spec.ts':
    '`@apackdev/ears` imports no other `@apackdev` package, its tests included, and these calls set no timeout to replace.',
};

/** Every `promisify(execFile)` in one file, read from its syntax tree so a string holding the text is not one */
function clockedExecs(absFile: string): number[] {
  const source = ts.createSourceFile(absFile, fs.readFileSync(absFile, 'utf8'), ts.ScriptTarget.Latest, true);
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'promisify'
      && node.arguments.length === 1 && ts.isIdentifier(node.arguments[0]!) && node.arguments[0].text === 'execFile') {
      lines.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lines;
}

describe('a spec starts a process bounded by its progress, not the clock', () => {
  const testFiles = (): string[] => [...new Set(UNIT_SUITES.flatMap((suite) => {
    const tests = path.join(REPO_ROOT, 'packages', suite.dir, 'tests');
    return fs.existsSync(tests) ? repoFiles().filter((file) => file.startsWith(`packages/${suite.dir}/tests/`) && file.endsWith('.ts')) : [];
  }))];

  it('uses execFileWhileWorking rather than promisify(execFile), except where the list says why', () => {
    const files = testFiles();
    expect(files.length, 'no test files derived, so this passes over nothing').toBeGreaterThan(100);
    const found = files.filter((file) => !(file in CLOCKED_EXEC_ALLOWED))
      .flatMap((file) => clockedExecs(path.join(REPO_ROOT, file)).map((line) => `${file}:${line}`));
    expect(found, 'use execFileWhileWorking (@apackdev/host/build/process-progress), whose timeout is CPU').toEqual([]);
  });

  it('lists no exception that no longer calls it', () => {
    expect(Object.keys(CLOCKED_EXEC_ALLOWED).filter((file) => clockedExecs(path.join(REPO_ROOT, file)).length === 0)).toEqual([]);
  });

  // Over a file written here: the call bound to a const and the one made inline are both found, a string is not
  it('finds the call however it is written, and not in a string', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clocked-exec-'));
    try {
      const file = path.join(dir, 'forms.spec.ts');
      fs.writeFileSync(file, [
        'const run = promisify(execFile);',
        "await promisify(execFile)('node', []);",
        "const text = 'promisify(execFile)';",
      ].join('\n'));
      expect(clockedExecs(file)).toEqual([1, 2]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('a timeout written as a sum of its phases', () => {
  const expression = (text: string) => (ts.createSourceFile('x.ts', `(${text})`, ts.ScriptTarget.Latest)
    .statements[0] as ts.ExpressionStatement).expression;

  it('is evaluated exactly, so a composed budget is checked against its size like a literal', () => {
    expect(constantMs(expression('2 * 60_000 + 60_000 + 20_000'))).toBe(200_000);
    expect(constantMs(expression('(180_000 + 120_000) / 2 - 10_000'))).toBe(140_000);
  });

  it('is left unknown once it names a value, which the budget check then requires a reason for', () => {
    expect(constantMs(expression('WATCH_REBUILD_BUDGET_MS + 20_000'))).toBeUndefined();
    expect(constantMs(expression('budgetMsFor("quick")'))).toBeUndefined();
  });
});

/**
 * What a config declares for its size. A vitest config gives each test its size's CPU deadline, `DEADLINE_FACTOR`
 * times the budget, since a test that spends past its budget is reported rather than failed; Playwright's `timeout`
 * is the budget itself, the E2E suite keeping its own model.
 */
const deadlineFor = (file: string, size: Size): number =>
  (file.endsWith('playwright.config.ts') ? 1 : DEADLINE_FACTOR) * SIZE_MS[size];

const isPlaywright = (file: string): boolean => file.endsWith('playwright.config.ts');

/** Whether a config loads the progress guard: in its own setup files, or through the helper it delegates to */
const loadsGuard = (file: string): boolean => {
  const own = fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8');
  const delegate = Object.entries(DELEGATES).find(([helper]) => own.includes(helper));
  const helper = delegate === undefined ? '' : fs.readFileSync(path.join(REPO_ROOT, delegate[1]), 'utf-8');
  return /vitest-progress-guard/.test(own) || /sibling\('vitest-progress-guard'\)/.test(helper);
};

describe('a suite bounds a test by its size, and never by the clock', () => {
  // The population, not a spot check: a config nobody derived is one whose budget nothing holds
  it('finds every test config, so none goes unchecked', () => {
    const found = configs();
    expect(found.length, 'no configs derived, so every case below passes over nothing').toBeGreaterThan(10);
    expect(new Set(found.map(({ size }) => size)), 'every size has a config, or one branch is never taken')
      .toEqual(new Set(Object.keys(SIZE_MS)));
  });

  it.each(configs())('$file declares nothing above its $size deadline', ({ file, size }) => {
    const deadline = deadlineFor(file, size);
    const over = declaredTimeouts(file).filter(({ ms }) => ms > deadline);
    expect(over, `${file} is ${size}, whose deadline is ${deadline}ms`).toEqual([]);
  });

  /**
   * And declares it, rather than leaving the bound to whatever the runner defaults to.
   *
   * Vitest defaults to a 5s clock for a test and 10s for a hook, so a config that declares nothing is running on a
   * number nobody chose, measured on the clock. Equality, not a floor: the budget belongs to the size, so a suite
   * that wants a different one is asking for a different size.
   */
  it.each(configs().filter(({ file }) => !isPlaywright(file)))('$file gives its tests the $size CPU deadline, with the clock off', ({ file, size }) => {
    const declared = new Map(declaredTimeouts(file).map(({ key, ms }) => [key, ms]));
    const expected = new Map([['testTimeout', 0], ['hookTimeout', 0], [CPU_KEY, deadlineFor(file, size)]]);
    const wrong = [...expected].filter(([key, ms]) => declared.get(key) !== ms)
      .map(([key, ms]) => `${key} is ${declared.has(key) ? `${declared.get(key)!}` : 'not declared'}, not ${ms}`);
    expect(wrong, `${file} is ${size}`).toEqual([]);
    expect(loadsGuard(file), `${file} turns the clock off without the progress guard, which leaves a hang unbounded`).toBe(true);
  });

  it.each(configs().filter(({ file }) => isPlaywright(file)))('$file declares its $size deadline', ({ file, size }) => {
    const declared = new Map(declaredTimeouts(file).map(({ key, ms }) => [key, ms]));
    expect(declared.get('timeout'), `${file} is ${size}`).toBe(deadlineFor(file, size));
  });
});

/**
 * Which size a spec's budget comes from.
 *
 * Derived from `INTEGRATION_SUITES`, not from a named package and not from the filename alone. Naming one
 * put the 8 integration specs in `repo-checks` and `publish-checks` under a small budget while they run
 * large — and nothing failed, because neither has a per-test override today and the *configs* were already
 * derived. These cases are the firing case that absence left it without.
 */
describe('a file takes the budget of the target it runs in', () => {
  it('calls every integration half large, whichever package it is in', () => {
    expect(INTEGRATION_SUITES.length, 'no suites derived, so this proves nothing').toBeGreaterThan(1);
    for (const suite of INTEGRATION_SUITES) {
      expect(sizeOf(`packages/${suite.dir}/tests/x.integration.spec.ts`), suite.dir).toBe('large');
    }
  });

  it('leaves the fast half small, which is a different budget', () => {
    for (const suite of INTEGRATION_SUITES) {
      expect(sizeOf(`packages/${suite.dir}/tests/x.spec.ts`), suite.dir).toBe('small');
    }
    expect(SIZE_MS.small, 'and the two budgets really do differ, or none of this matters').not.toBe(SIZE_MS.large);
  });

  it('calls every native half enormous, the budget its cold builds and watcher cycles take', () => {
    expect(NATIVE_SUITES.length, 'no native suites derived, so this proves nothing').toBeGreaterThan(0);
    for (const suite of NATIVE_SUITES) {
      expect(sizeOf(`packages/${suite.dir}/tests/x.native.spec.ts`), suite.dir).toBe('enormous');
      expect(sizeOf(`packages/${suite.dir}/vitest.native.config.ts`), suite.dir).toBe('enormous');
    }
  });

  // A package with no second config runs everything in its fast half, whatever a file is called
  it('does not call a spec large in a package with no integration half', () => {
    const plain = UNIT_SUITES.find((s) => !INTEGRATION_SUITES.some((i) => i.dir === s.dir))!;
    expect(sizeOf(`packages/${plain.dir}/tests/x.integration.spec.ts`)).toBe('small');
  });

  /**
   * And it answers for a config by the config's own existence, which is the other half of the one
   * question: a spec's name is a claim and a config's name is the fact, and that asymmetry is a reason for
   * two branches rather than two functions.
   */
  it('reads a config by which config it is', () => {
    const [withHalf] = INTEGRATION_SUITES;
    expect(sizeOf(`packages/${withHalf!.dir}/vitest.integration.config.ts`)).toBe('large');
    expect(sizeOf(`packages/${withHalf!.dir}/vitest.config.ts`)).toBe('small');
    expect(sizeOf('playwright.config.ts'), 'the E2E suite is its own target').toBe('large');
  });

  /**
   * A file that is neither gets no answer. Every unrecognised path would otherwise fall through to
   * `small`, and since the budget is a ceiling, the confident wrong answer is the permissive one — a
   * caller would be told 15s for something nothing had reasoned about.
   */
  it('refuses a file that belongs to no test target', () => {
    expect(() => sizeOf('docs/goals/README.md')).toThrow(/neither a test config nor a spec/);
    expect(() => sizeOf('scripts/lib/unit-suites.ts')).toThrow(/neither a test config nor a spec/);
  });
});
