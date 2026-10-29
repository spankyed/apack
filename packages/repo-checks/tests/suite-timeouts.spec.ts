// Timeouts are per size, not per package. A unit suite with `testTimeout: 120_000` does not catch a hang,
// it reports one as a slow pass — which is how a load-induced stall once reached a chain summary as two
// unexplained errors instead of a timeout.
//
// The budget lives with `SIZE_MS` and the configs keep plain literals, deliberately: a vitest config
// importing a constant across package layers is the thing `check:specifiers` exists to prevent. So the
// literals are checked here — that every vitest config declares its size's deadline (`DEADLINE_FACTOR` times
// the budget: a test that passes past its budget is reported, not failed) and that no config or single test
// moves above the size's own limit. Both directions, because a budget tighter than the size is not a safe default: it
// turns contention into a failure where the size had headroom, which is what it did.
//
// Both halves matter, and only the first was checked at first. A config states the policy; a third argument
// to `it()` escapes it for one test, and reading configs alone saw fifteen overrides of 60s to 240s sitting
// in small suites whose budget is 15s.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { INTEGRATION_SUITES, NATIVE_SUITES } from '../../../scripts/lib/chain-steps.ts';
import { DEADLINE_FACTOR, SIZE_MS, UNIT_SUITES, type Size } from '../../../scripts/lib/unit-suites.ts';
import ts from 'typescript';
import { constantMs, overrideKey, sizeOf, specFilesUnder, timeoutOverrides, type TimeoutOverride } from '../../../scripts/lib/test-timeouts.ts';
import { repoFiles } from './_support/repo-files.ts';

/**
 * Tests allowed to override their size's budget, and why.
 *
 * An entry is a claim that one test genuinely needs longer than its size gives — not that the default was
 * once 5s and nobody revisited it, which is what the other overrides turned out to be. The check below
 * fails on an entry whose override has gone, so the list shrinks when the reason does.
 */
const TIMEOUT_EXCEPTIONS: Record<string, string> = {
  'packages/default-setup/tests/features/code/be/services/claude-code/native-app-owner.spec.ts > compiled app owns native approval, idle scheduling and the next host input':
    'Explicit opt-in native probe: waits for a one-shot cron scheduled 95 seconds ahead, then verifies autonomous completion and a second host input. The private driver bounds the owned process; ordinary suites skip this case.',
  'packages/default-setup/tests/content/actions/claude-code/reset-chat-native.spec.ts > persists costs and session identity across native clear through compiled Chat':
    'Explicit opt-in native probe: starts the pinned process and verifies three compiled app turns across session reset. Its 20-second abort bounds the native process; ordinary suites skip this case.',
  'packages/apack-cli/tests/commands/default-pack-archive.integration.spec.ts > beforeAll':
    'The real shipped-pack archive replays all captured inputs twice, stages and compresses output; its former combined case exceeded 60s in 39468282848 (67.9s). Give preparation the existing fork producer archive-operation allowance (180s); extraction/integrity assertions and cleanup retain their separate ordinary deadlines.',
  'packages/apack-cli/tests/commands/scaffold.integration.spec.ts > beforeAll':
    'Real CLI initialization has its own 60s operation bound; the setup hook additionally allows 20s for cancellation and awaited shutdown.',
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
  'packages/apack-cli/tests/build/pack-builder.spec.ts > cancels a frontend input check before retiring its compiler and workspace':
    'An initial build and frontend start (the fast half\'s 15s), then up to 15s for the cancelled build to reach its frontend input check through a fresh worker, which the two-core Windows runner did not do within the 1s default wait (39655076999). Every retirement and cleanup assertion remains.',
  'packages/apack-cli/tests/build/compiler-installation.spec.ts > owns a relative external esbuild executable and detects changed selection and bytes':
    'Two full compiler captures (the selected override, then its changed bytes), each copying the runtime: about 7s apiece on the two-core Windows runner, 17.5s for the case in 39650866318. Each capture gets the fast half\'s 15s and the captured esbuild run 5s; every selection, byte and isolation assertion remains.',
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
  "packages/apack-cli/tests/build/dependency-graph.integration.spec.ts > beforeAll":
    "The dependency diamond setup builds four real packs in dependency order before the five assertions.",
  "packages/apack-cli/tests/_support/facade-packs.ts > beforeAll":
    "Shared facade setup materializes its package layout, scaffolds a step and builds dependency plus consumer before running type/completion assertions.",
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
  }
  return out;
}

describe('a test does not quietly buy itself more time than its size allows', () => {
  it('declares no timeout above its size budget, except where the list says why', () => {
    const over = overrides()
      .filter((override) => override.budget === undefined || override.ms === undefined || override.ms > override.budget)
      .filter((override) => !(overrideKey(override) in TIMEOUT_EXCEPTIONS))
      .map((override) => `${override.file}:${override.line} ${override.runner} sets ${override.ms === undefined ? 'a timeout this cannot evaluate' : `${override.ms / 1000}s`}; `
        + (override.budget === undefined ? 'shared helper deadlines require explicit review'
          : `a ${override.size} target allows ${override.budget / 1000}s`));
    expect(over, 'remove it, or add it to TIMEOUT_EXCEPTIONS with the reason it needs longer').toEqual([]);
  });

  // A list of exceptions is honest only while each one is still an exception: an override that has gone, or
  // that now fits its size's budget, excuses nothing
  it('lists no exception whose override has gone or fits its budget', () => {
    const live = new Set(overrides()
      .filter((override) => override.budget === undefined || override.ms === undefined || override.ms > override.budget)
      .map(overrideKey));
    expect(Object.keys(TIMEOUT_EXCEPTIONS).filter((key) => !live.has(key)), 'drop these from TIMEOUT_EXCEPTIONS').toEqual([]);
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
    expect(constantMs(expression('timeoutMsFor("quick")'))).toBeUndefined();
  });
});

/**
 * What a config declares for its size. A vitest config declares the deadline, `DEADLINE_FACTOR` times the budget,
 * since a test that passes past its budget is reported rather than failed; Playwright's `timeout` is the budget
 * itself, the E2E suite keeping its own model.
 */
const deadlineFor = (file: string, size: Size): number =>
  (file.endsWith('playwright.config.ts') ? 1 : DEADLINE_FACTOR) * SIZE_MS[size];

describe('a suite times a test out at its size deadline', () => {
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
   * And declares it, rather than leaving the budget to whatever the runner defaults to.
   *
   * A ceiling was only half the rule, and the missing half is the one that bit. Vitest defaults to 5s for a
   * test and 10s for a hook — both *tighter* than a small target's 15s — so a config that declares nothing
   * is not safely inside its size, it is running on a third number nobody chose. Under the chain's three
   * lanes a 5.8s typecheck in `@apackdev/sdk` crossed the 5s default and was reported as a hang, in a suite
   * allowed 15s; the next in line was a 4.1s lock test in `@apackdev/host` at 82% of the same default. Five
   * of the thirteen configs were in that state, which is also why the three-lane default is safer than it
   * was: `CLAUDE.md` credits these budgets with removing the 5s cap, and they had only reached eight configs.
   *
   * Equality, not a floor: the budget belongs to the size, so a suite that wants a different one is asking
   * for a different size.
   */
  const REQUIRED = (file: string): string[] => (file.endsWith('playwright.config.ts') ? ['timeout'] : ['testTimeout', 'hookTimeout']);

  it.each(configs())('$file declares its $size deadline', ({ file, size }) => {
    const deadline = deadlineFor(file, size);
    const declared = new Map(declaredTimeouts(file).map(({ key, ms }) => [key, ms]));
    const wrong = REQUIRED(file)
      .filter((key) => declared.get(key) !== deadline)
      .map((key) => `${key} is ${declared.has(key) ? `${declared.get(key)!}ms` : 'not declared, so the runner default applies'}`);
    expect(wrong, `${file} is ${size}, so it must declare ${deadline}ms`).toEqual([]);
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
