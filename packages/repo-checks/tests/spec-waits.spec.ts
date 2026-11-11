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
  // Examined: both of this file's sleeps prove a *negative* — that a schedule stopped with its app does not tick
  // into the next test — and a negative cannot be polled for, there being no condition to await. The elapsed time
  // is the subject, which its header says too. Its one clocked wait was on a positive condition and is now a poll
  'packages/default-setup/tests/harness-app-stop.spec.ts > wait':
    'the wait is the assertion: it proves a stopped schedule does not tick, so shortening it removes the check',
  'packages/apack-cli/tests/build/frontend-watch.native.spec.ts > fileEventsDelivered':
    'what the cases assert is that an event changes nothing, and an event that has no effect has nothing to await',
  'packages/apack-cli/tests/build/watch-package-edit.native.spec.ts > publishes one build when a refresh rewrites what the pack builds against':
    'the subject is a second build that must not start, so there is no event to await; load can only cause a false '
    + 'pass here, never a false failure',
  'packages/apack-host/tests/broker/lifetime.spec.ts > keeps a session when its client leaves and an owner holds the broker':
    'the subject is a session that must *not* end, and attach is absent from the broker client, so a second '
    + 'client cannot ask about a session it did not open and there is no event that says "still here". Load '
    + 'can only make this pass falsely, never fail falsely',
  'packages/apack-host/tests/broker/lifetime.spec.ts > reaped':
    'the case it serves closes the only client, so no connection remains for an event to arrive on and the '
    + "OS is the only witness left. Its sibling, where a client is still connected, awaits the broker's own "
    + '`onExit` instead',
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
  'packages/apack-cli/tests/commands/db.integration.spec.ts > writerDuring',
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
      'A spec may not sleep and then assert. Await the thing instead — `settles` from @apackdev/sdk/testing',
      'for a condition to poll (the one a pack can reach too), or `_whenSatisfied`/`_byDeadline` from',
      '@apackdev/sdk/testing/waiting for an event. If the elapsed time really is the subject, add it to',
      'BARE_WAIT_BY_DESIGN with the reason.',
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
  it('has three waits left to examine', () => {
    expect(NOT_CONVERTED_YET).toHaveLength(3);
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
  // Empty, and the three cases below are what keep it honest rather than this table: scoped to the vitest
  // trees, every clock left in them has become a progress bound, and the planted file above is what proves
  // the reader still finds one. An entry is a claim about a named file, so the list going back up is a
  // finding and not paperwork.
};


/**
 * Every test file the clocks are counted over: **the vitest trees, and only those.**
 *
 * The rule's remedy is "drop the timeout, the progress guard bounds the test", and that guard is
 * `@apackdev/testing`'s `vitest-progress-guard`. It runs under vitest. It does not run under Playwright,
 * where a test and a wait are given a clock and nothing else — so in a Playwright suite the remedy is false
 * and `expect.poll(…, { timeout })` is the correct way to write the wait, not a defect to be excused.
 *
 * This walked `tests/` and `drive/` as well, and the cost was not theoretical: a branch bringing a real
 * Playwright suite reported **1005 clocked waits across 175 files** — 471 `expect.poll`, 206
 * `waitForTimeout`, 157 `test.setTimeout`, and Playwright's assertion timeouts — every one of which would
 * have needed a per-file entry saying the same sentence. A list that grows one entry per Playwright file is
 * a list of everything, which is the shape this repo refuses; and the five entries it held for those suites
 * were paperwork rather than findings.
 *
 * **What is worth checking there is a different question with a true premise**: whether a wait outlasts the
 * budget of the test it runs in. `suite-timeouts.spec.ts` asks it, over the `ms` each `Clock` now carries.
 *
 * `drive/` is out for a second reason besides: nothing collects or gates those scripts.
 */
const testFiles = (): string[] =>
  UNIT_SUITES.map((suite) => path.join(REPO_ROOT, 'packages', suite.dir, 'tests'))
    .flatMap((dir) => tsFilesUnder(dir)).filter((file) => !/\/(node_modules|dist|\.apack)\//.test(file));

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
      .filter(([file]) => CLOCK_BY_DESIGN[file] === undefined)
      .flatMap(([, clocks]) => clocks.map((clock) => `${clock.file}:${clock.line}: ${clock.what}`));
    expect(unaccounted, [
      'A wait on another process takes no deadline: the progress guard bounds the test. Drop the timeout, or bound a',
      'child process with execFileWhileWorking. A wait on this process\'s own state may keep one, in CLOCK_BY_DESIGN.',
    ].join(' ')).toEqual([]);
  });


  it('lists nothing by design that no longer holds a clock', () => {
    const byFile = clocksByFile();
    expect(Object.keys(CLOCK_BY_DESIGN).filter((file) => !byFile.has(file))).toEqual([]);
  });

});
