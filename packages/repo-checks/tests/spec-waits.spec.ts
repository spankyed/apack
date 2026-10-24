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
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { population } from '@apackdev/sdk/testing';
import { UNIT_SUITES } from '../../../scripts/lib/unit-suites.ts';
import { bareWaitKey, bareWaits, specFilesUnder, type BareWait } from '../../../scripts/lib/test-timeouts.ts';

/**
 * Waits whose subject genuinely is elapsed time, and why each one is.
 *
 * An entry is a claim that nothing observable would do — that the test is about a duration passing, or about
 * something *not* happening for a while. Four shapes qualify and no fifth has turned up: a delay inside a
 * handler, which is the production shape under test rather than the test waiting; a cycle that has to be
 * allowed to pass; a poll of something with no event to offer; and a race whose timer *is* the answer.
 */
const BARE_WAIT_BY_DESIGN: Record<string, string> = {
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
  "packages/apack-ears/tests/lmdb/store.spec.ts > updates a relation in place, keeping when it was stored",
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
  it('has five waits left to examine', () => {
    expect(NOT_CONVERTED_YET).toHaveLength(5);
  });
});
