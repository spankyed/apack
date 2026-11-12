# Five tests that pass only on a quiet machine

Status: **open**, found 2026-11-09 while running the gate for
[goal-one-vt-core](../archive/goals/goal-one-vt-core.md). None of them is in that goal's code; they are
recorded here because a closed goal's evidence is not where someone with a red chain will look.

**The rule they are against is the repository's own:** *a test that passes only on a quiet machine is a
defect*, and *re-running until green is not a fix*. Each of these failed once under the concurrency of a
full `npm run chain` and then passed on its own, which is the shape that rule describes.

## The five

| test | what it asserts | how it failed | on its own |
|---|---|---|---|
| `apack-terminal` `broker::killing_a_session_takes_the_whole_tree_with_it` | a killed session's children are gone | *"the grandchild 55017 outlived the session it belonged to"* | passes in **2.08s**, having taken **9.97s** in the failing run |
| `apack-terminal` `channel::a_saturating_producer_reports_that_it_was_throttled_rather_than_losing_output` | back-pressure is reported rather than output dropped | timed out at **60s** | **47s** and passed in the run before, so it sits on its deadline |
| `@apackdev/sdk` `tests/progress/progress.spec.ts` › *reads a worker thread's own CPU from the first reading* | a busy worker's CPU grows | `expected 105.321 to be greater than 200` | 32 of 32, at a load average of **99** |
| `@app/repo-checks` `tests/bounded-spawn.integration.spec.ts` › *kills the whole group* | a bounded spawn takes its group | *"nothing is proven if the grandchild never started: expected 0 to be greater than 0"* | 13 of 13 |
| `@app/repo-checks` `tests/spec-durations-reporter.integration.spec.ts` › *records a test that spent more CPU than its budget* | an over-budget test is reported | `expected [] to deeply equal [{ name: 'costly', … }]` | 15 of 15, at a load average of **114** |

## Why they are one finding and not five

Every one of them has **timing, scheduling or CPU accounting as its subject**, and every one is measured on
the machine that is simultaneously running the suite measuring it. Three fail because a child process did
not get scheduled soon enough to be observed; two because a CPU reading came in under what the case expects
a busy thing to have spent.

That last pair is the interesting one. This repository deliberately bounds tests by **CPU** rather than the
clock, on the ground that *load inflates a duration and cannot deflate it* — which is true of a duration.
It is not true of a **CPU reading taken over a wall-clock window**: a thread competing for cores
accumulates *less* CPU in the same elapsed time, so the reading moves the other way. Cases that assert a
lower bound on CPU spent are therefore load-sensitive in exactly the direction the CPU-bounding rule does
not protect against.

## Reproducing

Run the suite under load rather than alone — `npm run stress` exists for this and is what the repository
prescribes for proving a timing fix:

```sh
npm run stress -- --runs 10 --busy 8        # the host unit pool, under eight busy cores
```

A fix is not a longer deadline or a larger budget. For the three process cases it is waiting on the child's
own readiness rather than on time having passed; for the two CPU cases it is asserting on something that
does not shrink under contention, or driving the work to a known amount rather than a known interval.

## What was not done

Nothing here was fixed. The goal that found them had no claim on this code, and changing a deadline or a
budget to get a pass is the thing the rule forbids.
