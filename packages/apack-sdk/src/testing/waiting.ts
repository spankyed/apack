// Waiting for something to have happened, without asserting how long it takes.
//
// **The number belongs on the failure path.** A spec that sleeps and then asserts puts a guess about duration
// into every passing run, and when the guess is short the failure reads exactly like the bug it was meant to
// catch — "no answer arrived" — which buys an investigation every time it fires. Awaiting the thing instead
// leaves only a deadline, which never runs when the code works, and so can be generous and identical
// everywhere.
//
// **A wait is driven by the thing it waits for, and names what never happened.** Where an event exists, await
// it — that is `_whenSatisfied` and `_byDeadline`. Where none does, a file lock or another process, polling
// with a deadline is right, and `apack-host/tests/database/write-lock.spec.ts` is that half done properly. A
// bare duration is never the answer.
//
// The shape here is `startApp`'s own `waitForEmitted` (`apack-testing/src/app.ts`) lifted out: a `satisfied()`
// that returns a value or `undefined`, attempted once immediately and again on every event. That one is private
// to the harness's closure, which is the whole reason sixteen sleeps grew up around it — at the point of need a
// sleep was the cheapest thing available.
//
// **Source-only, as `./testing/pack-fixture` and `./testing/serialisation-matrix` are.** The `exports` entry
// names a path under `@apackdev/source` and nothing else, so `publishedManifest` drops it and no pack can resolve
// it. This is repo-internal test support, not something a pack author reaches for.

import { fromNow, processWork, workSignal } from '../progress.ts';

/**
 * How long a waiter gives up after.
 *
 * **Not an expectation.** It never runs when the code works, so it is deliberately generous and the same
 * everywhere: a per-site number would be a guess about duration again, which is the thing these helpers exist
 * to remove. It is long enough that no plausible machine misses it and short enough to beat a test runner's own
 * timeout, so a failure arrives as a sentence rather than as "test timed out".
 */
export const _WAIT_DEADLINE_MS = 2_000;

/** What a deadline says when it fires: the subject, not just the elapsed time */
const timedOut = (describe: string, deadlineMs: number): Error =>
  new Error(`Timed out after ${deadlineMs}ms waiting for ${describe}`);

/**
 * `promise`, with a deadline that fails naming what never happened.
 *
 * For the case where something will tell you once — an `AbortSignal` firing, a deferred a callback resolves.
 * Without it the same test still fails, by the runner's own timeout, saying only that it took too long.
 */
export function _byDeadline<T>(promise: Promise<T>, describe: string, deadlineMs = _WAIT_DEADLINE_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(timedOut(describe, deadlineMs)), deadlineMs);
    const settle = (finish: () => void) => {
      clearTimeout(timer);
      finish();
    };
    promise.then((value) => settle(() => resolve(value)), (error: unknown) => settle(() => reject(error)));
  });
}

/**
 * What `satisfied()` finds, once an event makes it find something; fails naming what never arrived.
 *
 * For the case where events arrive one at a time and the answer is a property of what has arrived so far —
 * "a `MEMO_ADDED` for this connection", "two answers, one per tag". The predicate reads whatever the caller is
 * already accumulating, which is why this takes `subscribe` rather than the events themselves: the helper stays
 * ignorant of their shape.
 *
 * `satisfied()` is attempted before the first event too, so a condition already met does not wait for one that
 * may never come.
 */
export function _whenSatisfied<T>(
  subscribe: (notify: () => void) => () => void,
  satisfied: () => T | undefined,
  describe: string,
  deadlineMs = _WAIT_DEADLINE_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let stop: (() => void) | undefined;
    let settled = false;
    const end = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stop?.();
      finish();
    };
    const attempt = () => {
      const found = satisfied();
      if (found !== undefined) end(() => resolve(found));
    };
    const timer = setTimeout(() => end(() => reject(timedOut(describe, deadlineMs))), deadlineMs);
    stop = subscribe(attempt);
    // A subscription that notified synchronously has already finished this, and `stop` was undefined when it
    // did — so unsubscribe now rather than leaving a listener behind
    if (settled) stop();
    else attempt();
  });
}

/**
 * Polls `check` until it stops throwing, and answers what it returned: `vi.waitFor` with no clock of its own.
 *
 * **For a wait on another process** — a watcher's build, a child's output, a file it writes. How long that takes is
 * the machine's load, so a deadline on the clock fails healthy work on a busy machine. The bound is the vitest
 * progress guard around the test (`@apackdev/testing`'s `vitest-progress-guard.ts`): it fails a test whose process
 * tree does no work for `IDLE_MS`, or spends its CPU budget.
 *
 * **It takes a wait on this process's own state too**, where a clock is defensible but buys nothing: the guard
 * still bounds it, and a condition polled until it holds is never a guess about how long it takes. That is the
 * case a pack's tests have, which is why this one of the waiters is published (`@apackdev/sdk/testing`) while the
 * rest of this module stays the app's: the rule that a deadline must say why applies to every pack, so the tool
 * that satisfies it has to reach one.
 *
 * A poll the guard outlived keeps trying until its file's process exits: it holds no vitest hook to stop on, since
 * this module ships in the SDK, whose manifest does not declare vitest. Its timer is unref'd, so it holds nothing open.
 */
export function settles<T>(check: () => T | Promise<T>, { interval = 50 }: { interval?: number } = {}): Promise<T> {
  return new Promise<T>((resolve) => {
    const attempt = async (): Promise<void> => {
      try { resolve(await check()); } catch { setTimeout(() => { void attempt(); }, interval).unref(); }
    };
    void attempt();
  });
}

/**
 * An `AbortSignal` for work this test runs in its own process tree, which aborts when that tree stops working:
 * `AbortSignal.timeout` with no clock. Its watch's timer is unref'd, so a signal nobody aborts holds nothing open.
 */
export function _workingSignal(): AbortSignal {
  return workSignal({ work: fromNow(processWork(process.pid)) }).signal;
}
