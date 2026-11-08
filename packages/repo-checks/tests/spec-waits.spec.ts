// A spec may wait for something to have happened. It may not assert how long that takes.
//
// A sleep puts a guess about duration into every passing run, and when the guess is short the failure reads
// exactly like the bug it was meant to catch — "no answer arrived" — which buys an investigation every time it
// fires. `@apackdev/sdk/testing/waiting` is the alternative and its header carries the rule: a wait is driven by
// the thing it waits for and names what never happened. An event where there is one; a poll where there is none,
// as `apack-host/tests/database/write-lock.spec.ts` does for a file lock. A bare duration is never the answer.
//
// This exists because sixteen of them grew up on one branch, not through carelessness: the only event-driven
// waiter was private to the test harness, so at the point of need a sleep was the cheapest thing available.
// Making the right thing the cheapest thing is what the shared waiter did; this is what stops the count going
// back up.
//
// **Two things the mechanism gets right that a text scan cannot**, both measured on this repo. A third of the
// textual matches for a delayed `setTimeout` are inside string literals — subprocess bodies, an `actionFn`, a
// script the CLI runs — and all nine are correctly ignored here. And a `setTimeout` that calls `reject` is a
// kill deadline, which is the thing being promoted, so only a timer reaching the promise's own `resolve`
// counts. `scripts/lib/test-timeouts.ts` has both rules, and the module's header records the regex attempts
// that failed in both directions before it read the tree.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { population } from '@apackdev/sdk/testing';
import { UNIT_SUITES } from '../../../scripts/lib/unit-suites.ts';
import { bareWaitKey, bareWaits, clockedDeadlines, specFilesUnder, type BareWait, type Clock } from '../../../scripts/lib/test-timeouts.ts';
import { tsFilesUnder } from '../../../scripts/lib/process-spawns.ts';

/**
 * Waits whose subject genuinely is elapsed time, and why each one is.
 *
 * An entry is a claim that nothing observable would do — that the test is about a duration passing, or about
 * something *not* happening for a while. Four shapes qualify and no fifth has turned up: a delay inside a
 * handler, which is the production shape under test rather than the test waiting; a cycle that has to be
 * allowed to pass; a poll of something with no event to offer; and a race whose timer *is* the answer.
 */
const BARE_WAIT_BY_DESIGN: Record<string, string> = {
  'packages/apack-cli/tests/build/frontend-watch.native.spec.ts > fileEventsDelivered':
    'what the cases assert is that an event changes nothing, and an event that has no effect has nothing to await',
  'packages/apack-cli/tests/build/watch-package-edit.native.spec.ts > publishes one build when a refresh rewrites what the pack builds against':
    'the subject is a second build that must not start, so there is no event to await; load can only cause a false '
    + 'pass here, never a false failure',
  'packages/apack-host/tests/bus/reply.spec.ts > after':
    "a delay inside the handler under test — a backend system's work is I/O, so it awaits before it answers, "
    + 'which is what makes the delivery scope load-bearing. The cases await the answer',
  'packages/apack-host/tests/bus/delivery-is-synchronous.spec.ts > onATimer':
    'the timer *is* the subject: what the case asserts is that a send made from one carries no sender, '
    + 'because the delivery it was scheduled in has ended. Awaiting an event instead would remove the only '
    + 'thing being tested',
  'packages/apack-testing/tests/engine/api-client.spec.ts > after':
    'the keep-alive case has to let several ping/terminate windows come and go while the client sits idle: the '
    + 'elapsed time is the assertion, not a proxy for an event',
  'packages/apack-host/tests/database/write-lock.spec.ts > waitFor':
    'polls a file lock, which has no event to subscribe to, and already deadlines naming what it waited for — '
    + 'the poll half of the rule, done properly',
  'packages/repo-checks/tests/decision-mutations.spec.ts > MUTATIONS':
    'a race sentinel: the timer resolves "hung", so the duration is the definition of hung rather than a guess '
    + 'at how long something takes',
};

/**
 * Waits that predate this check and have not been looked at.
 *
 * Named for what it is, as `spec-placement.spec.ts`'s `NOT_MIRRORED_YET` is. Writing a reason for a spec
 * nobody has examined would be inheriting a justification, which is worse than admitting the backlog — so
 * these carry none, the count is reported below, and an entry graduates to `BARE_WAIT_BY_DESIGN` or to an
 * awaited event when somebody reads it.
 */
const NOT_CONVERTED_YET: readonly string[] = [
  'packages/default-setup/tests/harness-app-stop.spec.ts > wait',
  'packages/apack-cli/tests/commands/db.integration.spec.ts > writerDuring',
  'packages/repo-checks/tests/bounded-spawn.integration.spec.ts > kills the whole group, not the process it started',
  'packages/repo-checks/tests/chain-schedule.spec.ts > done',
];

/** Every spec file the unit suites hold — the population a finding can come from */
const specs = (): string[] =>
  UNIT_SUITES.flatMap((suite) => specFilesUnder(path.join(REPO_ROOT, 'packages', suite.dir, 'tests')));

/** Every bare wait in them */
const waits = (): BareWait[] => specs().flatMap((file) => bareWaits(file, REPO_ROOT));

const accounted = new Set([...Object.keys(BARE_WAIT_BY_DESIGN), ...NOT_CONVERTED_YET]);

describe('a spec waits for the thing it waits for', () => {
  // The population, not a spot check: a check that walked no files reports nothing and looks the same as a pass
  it('reads every spec the unit suites hold', () => {
    population('spec files', specs(), { atLeast: 300 });
  });

  it('has no bare wait that nothing accounts for', () => {
    const unaccounted = waits()
      .filter((wait) => !accounted.has(bareWaitKey(wait)))
      .map((wait) => `${wait.file}:${wait.line} > ${wait.name}`);

    expect(unaccounted, [
      'A spec may not sleep and then assert. Await the thing instead —',
      '`_whenSatisfied` or `_byDeadline` from @apackdev/sdk/testing/waiting — or, if the elapsed time really is',
      'the subject, add it to BARE_WAIT_BY_DESIGN with the reason.',
    ].join(' ')).toEqual([]);
  });

  // A list is honest only while each entry is still real; a converted wait should leave its row behind
  it('lists nothing whose wait has gone', () => {
    const live = new Set(waits().map(bareWaitKey));
    expect([...accounted].filter((key) => !live.has(key)), 'drop these: the wait they name is no longer there')
      .toEqual([]);
  });

  /**
   * The backlog is reported rather than hidden, so it going down is visible and going up is not free.
   *
   * Asserted as an exact number for the same reason `spec-cost`'s records are: a count that drifts upward
   * without anyone noticing is how a list of deliberate exceptions becomes a list of everything.
   */
  it('has four waits left to examine', () => {
    expect(NOT_CONVERTED_YET).toHaveLength(4);
  });
});

/**
 * Test files that hold a clocked deadline on purpose, with why.
 *
 * A wait on another process has no deadline of its own: the vitest progress guard bounds the whole test by its
 * progress, and a clock inside it fails healthy work on a busy machine. What qualifies is a wait on this process's
 * own state, where nothing outside it is slowed by load and a quick failure beats the guard's stall window.
 */
const CLOCK_BY_DESIGN: Record<string, string> = {
  'packages/apack-ears/tests/engine/rank-index.spec.ts':
    'waits on an index building in this process, so load slows the wait and the work alike',
  'packages/default-setup/tests/harness-app-stop.spec.ts':
    "waits on the in-process test app's timer flow ticking, which runs on this process's own event loop",
};

/**
 * Test files whose clocked deadlines predate the check, and how many each holds.
 *
 * Exact in both directions, as `NOT_CONVERTED_YET` above is: converting one means lowering its count, and a new one
 * is refused. They wait to become waits on the thing itself, bounded by the progress guard.
 */
const CLOCKS_NOT_CONVERTED_YET: Record<string, number> = {
  'packages/apack-cli/tests/_support/watch-builds.ts': 3,
  'packages/apack-cli/tests/build/build-worker.native.spec.ts': 11,
  'packages/apack-cli/tests/build/compiler-elf-libraries.native.spec.ts': 1,
  'packages/apack-cli/tests/build/compiler-installation.native.spec.ts': 2,
  'packages/apack-cli/tests/build/compiler-native-libraries.native.spec.ts': 1,
  'packages/apack-cli/tests/build/compiler-native-vite.native.spec.ts': 10,
  'packages/apack-cli/tests/build/compiler-pe-libraries.native.spec.ts': 7,
  'packages/apack-cli/tests/build/compiler-watch.native.spec.ts': 1,
  'packages/apack-cli/tests/build/compiler-worker-inputs.spec.ts': 2,
  'packages/apack-cli/tests/build/fe-bundler-dev-server.native.spec.ts': 2,
  'packages/apack-cli/tests/build/frontend-generation.native.spec.ts': 2,
  'packages/apack-cli/tests/build/frontend-globs.native.spec.ts': 2,
  'packages/apack-cli/tests/build/frontend-resources-watch.native.spec.ts': 6,
  'packages/apack-cli/tests/build/frontend-watch.native.spec.ts': 11,
  'packages/apack-cli/tests/build/frontend-workers.native.spec.ts': 4,
  'packages/apack-cli/tests/build/input-subscriptions.native.spec.ts': 2,
  'packages/apack-cli/tests/build/pack-builder.native.spec.ts': 4,
  'packages/apack-cli/tests/build/package-inputs-watch.native.spec.ts': 1,
  'packages/apack-cli/tests/build/watch-external-types.native.spec.ts': 3,
  'packages/apack-cli/tests/build/watch-module-freshness.native.spec.ts': 3,
  'packages/apack-cli/tests/build/watch-package-edit.native.spec.ts': 1,
  'packages/apack-cli/tests/build/watch-publication.native.spec.ts': 7,
  'packages/apack-cli/tests/build/watch-worker-inputs.native.spec.ts': 2,
  'packages/apack-cli/tests/commands/db.integration.spec.ts': 1,
  'packages/apack-cli/tests/commands/dev-build.integration.spec.ts': 2,
  'packages/apack-cli/tests/commands/install-host-version.spec.ts': 1,
  'packages/apack-host/tests/build/compiler-inputs.spec.ts': 1,
  'packages/apack-host/tests/build/pack-build-inputs.spec.ts': 1,
  'packages/api/tests/transport/context.spec.ts': 2,
  'packages/api/tests/transport/views.spec.ts': 1,
  'packages/repo-checks/tests/performance-scenario-view.spec.ts': 1,
  'packages/repo-checks/tests/typecheck-legs.spec.ts': 1,
  'tests/acceptance/pack-dev/test-pack-dev.ts': 5,
  'tests/e2e/app-integration/api-reconnect.spec.ts': 2,
  'tests/e2e/app-integration/attach-parity.spec.ts': 1,
  'tests/e2e/app-integration/db-cli.spec.ts': 1,
  'tests/e2e/app-integration/db-write-through-boot.spec.ts': 2,
  'tests/e2e/app-integration/db-writes-beside-app.spec.ts': 5,
  'tests/e2e/app-integration/dev-reload.spec.ts': 1,
  'tests/e2e/app-integration/feature-addressing.spec.ts': 1,
  'tests/e2e/app-integration/import-pack-content.spec.ts': 1,
  'tests/e2e/app-integration/settings-recovery.spec.ts': 1,
  'tests/e2e/app-integration/surface-sends.spec.ts': 6,
  'tests/e2e/ui/conversation-paging.spec.ts': 1,
  'tests/e2e/ui/popout.spec.ts': 1,
  'tests/packs/bundled-ui-pack/tests/e2e/scribbles.spec.ts': 1,
  'tests/packs/external-pack/tests/e2e/_support/pack-frontend.ts': 2,
  'tests/packs/external-pack/tests/e2e/default-pack-fork.spec.ts': 2,
  'tests/packs/external-pack/tests/e2e/dev-reload.spec.ts': 1,
  'tests/packs/external-pack/tests/e2e/memos.spec.ts': 6,
  'tests/packs/external-pack/tests/e2e/open-while-loading.spec.ts': 2,
  'tests/packs/external-pack/tests/e2e/settings-ownership.spec.ts': 4,
  'tests/packs/external-pack/tests/e2e/step-palette.spec.ts': 1,
  'tests/packs/external-pack/tests/e2e/step-services.spec.ts': 1,
};

/** Every test file the clocks are counted over: the unit suites' trees, support modules included, the E2E and pack suites and `drive/` */
const testFiles = (): string[] => [
  ...UNIT_SUITES.map((suite) => path.join(REPO_ROOT, 'packages', suite.dir, 'tests')),
  path.join(REPO_ROOT, 'tests'),
  path.join(REPO_ROOT, 'drive'),
].flatMap((dir) => tsFilesUnder(dir)).filter((file) => !/\/(node_modules|dist|\.apack)\//.test(file));

const clocksByFile = (): Map<string, Clock[]> => {
  const byFile = new Map<string, Clock[]>();
  for (const file of testFiles()) {
    const found = clockedDeadlines(file, REPO_ROOT);
    if (found.length > 0) byFile.set(found[0]!.file, found);
  }
  return byFile;
};

describe('a test is bounded by its progress, not a clock', () => {
  it('reads a clock where it is one, and not where the same word is data, a handle or a switch', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clocked-deadlines-'));
    try {
      const file = path.join(dir, 'case.spec.ts');
      fs.writeFileSync(file, [
        "import { execFile, spawnSync } from 'node:child_process';",
        "import { promisify } from 'node:util';",
        "import { execFileWhileWorking } from '@apackdev/sdk/progress';",
        'const run = promisify(execFile);',
        // clocks
        'await vi.waitFor(check, { timeout: 20_000 });',
        'await expect.poll(read, 5_000);',
        "spawnSync('git', [], { timeout: 1_000 });",
        "await run('ps', [], { timeout: 2_000 });",
        'AbortSignal.timeout(500);',
        'test.setTimeout(180_000);',
        'await page.waitForTimeout(300);',
        "await expect(page.locator('x')).toBeVisible({ timeout: 10_000 });",
        // not clocks: CPU, a switch, data, a handle, and the runner's own (another check's subject)
        "await execFileWhileWorking('ps', [], { timeout: 5_000 });",
        'await vi.waitFor(check, { timeout: 0 });',
        'expect(options).toEqual({ timeout: 5_000 });',
        'pending.set(id, { timeout: setTimeout(fail, 5_000) });',
        "it.skip('slow', { timeout: 9_000 }, () => {});",
      ].join('\n'));
      expect(clockedDeadlines(file, dir).map((clock) => clock.what)).toEqual([
        'vi.waitFor', 'expect.poll', 'spawnSync', 'run', 'AbortSignal.timeout', 'test.setTimeout', 'page.waitForTimeout',
        'toBeVisible',
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads the test trees', () => {
    population('test files', testFiles(), { atLeast: 600 });
  });

  it('has no clocked deadline that neither list accounts for', () => {
    const unaccounted = [...clocksByFile()]
      .filter(([file]) => CLOCK_BY_DESIGN[file] === undefined && CLOCKS_NOT_CONVERTED_YET[file] === undefined)
      .flatMap(([, clocks]) => clocks.map((clock) => `${clock.file}:${clock.line}: ${clock.what}`));
    expect(unaccounted, [
      'A wait on another process takes no deadline: the progress guard bounds the test. Drop the timeout, or bound a',
      'child process with execFileWhileWorking. A wait on this process\'s own state may keep one, in CLOCK_BY_DESIGN.',
    ].join(' ')).toEqual([]);
  });

  it('counts each listed file exactly, so converting one lowers its count and adding one is refused', () => {
    const byFile = clocksByFile();
    const moved = Object.entries(CLOCKS_NOT_CONVERTED_YET)
      .filter(([file, count]) => (byFile.get(file)?.length ?? 0) !== count)
      .map(([file, count]) => `${file}: listed ${count}, holds ${byFile.get(file)?.length ?? 0}`);
    expect(moved).toEqual([]);
  });

  it('lists nothing by design that no longer holds a clock', () => {
    const byFile = clocksByFile();
    expect(Object.keys(CLOCK_BY_DESIGN).filter((file) => !byFile.has(file))).toEqual([]);
  });

  it('has 147 clocks in 54 files left to convert', () => {
    const counts = Object.values(CLOCKS_NOT_CONVERTED_YET);
    expect([counts.reduce((sum, count) => sum + count, 0), counts.length]).toEqual([147, 54]);
  });
});
