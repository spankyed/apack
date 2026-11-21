> **Archived** (2026-09-28, the day it was written). It is a dated capture rather than a maintained
> reference: nothing checks it, and the chain's output moves — the `--dry` block here was already wrong
> within a day, because a stale step stopped printing a sentence and started naming the file. It was
> re-captured once, at `79e3fe1e8`; it will drift again. For the current form, run the thing —
> `npm run chain -- --dry` for the plan, and the reproduction steps at the end for the stale report.

# What `npm run chain` prints

Every block below is a verbatim capture, piped into this file from real runs on 2026-09-28. Nothing is
typed by hand. The `--dry` block is from `79e3fe1e8`; the rest from `a06509364`, and unchanged since.

**It is a snapshot, and nothing checks it stays true.** No step declares `docs/`, so editing the chain's
output will not fail anything here. Treat a difference between this file and your terminal as this file
being old. The two things that *are* checked are the columns (`internal-repo-checks/tests/chain-output.spec.ts`)
and the report's line shapes (the `staleLines` cases in the same file).

## `npm run chain --dry`

The plan, running nothing: which steps would run, and why each would or would not. Captured with one real
edit outstanding — a line added to `packages/apack-sdk/src/index.ts` and reverted — so the causes below are
the ones the chain actually derived, not an illustration.

```

    run t2 packages:ensure             never cached: what it guarantees is recorded in stamps of its
                                       own, which this fingerprint cannot see; its check is ~0.3s
                                       warm, so a cache on top only adds a record that can disagree
 cached t2 packages:check
 cached t2 compile
 cached t2 test:external-pack:contract
    run t1 typecheck                   changed packages/apack-sdk/src/index.ts
    run t1 test:unit:host              changed packages/apack-sdk/src/index.ts
    run t1 test:unit:pack              changed packages/apack-sdk/src/index.ts
 cached t2 test:integration
 cached t3 build:app
 cached t3 test:external-pack:app
    run t3 test                        never cached: it drives real Electron, and a flaky pass
                                       cached green hides an intermittent failure
 cached t3 test:packaged-authoring
```

`t1`/`t2`/`t3` is the tier — what the step is allowed to read. A reason too long for its row wraps to
the column it started at, rather than to column 0 where it would read as another step's line.

A stale step names what moved rather than saying `its inputs changed since the last successful run`, which
is the only verdict a healthy step can have and so told a reader nothing. One file and a count, because the
row has no lines beneath it to spend and a cold tree makes every step stale.

`--dry` is also the one place a never-cached step's full argument is printed, because that is the question
being asked. A run points at the comment instead; see below.

## `npm run chain`

```

     ok t2 packages:ensure               0.3s  never cached — scripts/lib/chain-steps.ts:419
 cached t2 packages:check
 cached t2 compile
 cached t2 test:external-pack:contract
 cached t1 test:unit:pack
     ok t1 test:unit:host                8.7s  its inputs changed since the last successful run
                                         1.5s  a test does not quietly buy itself more time than it…
                                         0.9s  the chain reads every source file > has no tracked c…
                                         0.8s  the chain reads every source file > lists no excepti…
                                         0.7s  a test does not quietly buy itself more time than it…
                                         0.7s  the generated modules a contract is behind > is the…
 cached t3 build:app
 cached t3 test:external-pack:app
     ok t1 typecheck                    23.2s  its inputs changed since the last successful run
 cached t3 test:packaged-authoring
     ok t3 test                         32.7s  never cached — scripts/lib/chain-steps.ts:520
     ok t2 test:integration             62.0s  its inputs changed since the last successful run
                                        11.0s  facade bundle determinism (needs dist: npm run packa…
                                         9.2s  apack init → add feature → build → tsc → pack > add…
                                         5.0s  a pack's unit tests on the harness > find the pack f…
                                         4.8s  apack init → add feature → build → tsc → pack > add…
                                         4.0s  apack add feature in a pack without the unit test s…

1 step passed, then its inputs changed — it will not be cached next run
  typecheck  tests/fixtures/probe-tmp.txt  added while it ran
             · tests/e2e/dev-reload.spec.ts — touched during the run, not changed
  Declare what writes there in that step's `outputs`, or stop declaring the tree as an input.

chain passed in 63.3s (7 of 12 cached) with 3 lanes
t1= 31.8s  t2= 62.3s  t3= 32.7s
```

Reading it, top to bottom:

- **Rows arrive in the order the scheduler reached them**, not in table order, because three run at
  once. A cached step keeps its own line where it was skipped, dimmed — the order is information.
- **A never-cached step points at its declaration** (`chain-steps.ts:419`) rather than repeating the
  same paragraph every run. The comment above that line is the argument; `--dry` prints it in full.
- **The indented times under a step are its slowest tests**, so whoever profiles that suite next has
  them without instrumenting anything. They sit in the step's own time column.
- **Only a failing step's output is printed.** Everything else is buffered and dropped, so a failure
  is not buried under six passing suites.

### "N steps passed, then their inputs changed"

A step that passed and is *already* stale again had something move under it. That is a real defect
class — a step writing under a tree it also declares, or one step writing under a tree another
declares — and the E2E suite writing into `tests/screenshots` once cost 34s of every warm chain while
looking fine.

Each line under a step is a file whose **bytes** differ from what that step's own stamp recorded,
with what happened to it and when. The path is at full brightness because it is the thing to act on.

The header claims no cause, because there is not one cause: a concurrent write is the defect worth
finding, but an edit you made after the step finished, or a step gaining a declared path, lands here
too. Which it was is the `when` on each line.

The `·` line is not one of them. That file was written during the run and its bytes came out the same
— an E2E test that edits a compiled content and puts it back, a deterministic build — so its mtime moved
and its fingerprint did not. It is named rather than counted, because the name is the whole of what the
note has to say: it exists to stop you chasing that file, and it cannot do that without telling you
which file. The capture above is exactly that: `dev-reload.spec.ts` rewrites a compiled content by design.

An empty diff with a stale verdict means the *declared* set moved — a step gaining or losing a
watched path is stale before any byte changes — and the line says so instead of listing no files.

### The two reports that print only when they have something to say

Neither appears in the capture above, because that run had nothing to report for either. These two
lines are captures from a different run the same day — the wording of neither is touched by anything
above.

```
1 step cost something other than chain-steps.ts says — re-measure, or record:
  test:external-pack:contract seconds: 57 -> 25

critical path 45s (test:external-pack:contract -> test:external-pack:app)
```

- **`N step cost something other than chain-steps.ts says`** is not a failure. `seconds` feeds the
  kill budget and the critical path, so a number a run has contradicted is worth more than a note
  nobody re-reads. In the lines above, 57s was recorded with the fixture packs cold, and the run that
  printed this had them warm.
- **`critical path`** is the floor: the longest dependency chain, which no number of lanes can beat.

## What is dimmed

A pipe loses colour, so everything above looks equally bright. On a terminal these recede:

| | |
|---|---|
| every `cached` row | it did nothing; what ran is what the run is about |
| the slow-test lines under a step | context, not a result |
| the qualifier after each path in the report (`added while it ran`) | the path is what you act on |
| the `·` note, and the trailing `Declare what writes there…` advice | one is explicitly not a cause, the other is the same sentence every run |

## Reproducing the stale report

It only prints for a step that **ran** and is stale again afterwards, so the tree has to be stale
before the run and written into during it. Running the chain on a clean tree will never show it.

```bash
npm run chain -- --dry          # check typecheck says `run`; if it says `cached`, touch something it reads
npm run chain &                 # then, while it is running:
echo probe > tests/fixtures/probe-tmp.txt
wait
rm -f tests/fixtures/probe-tmp.txt
```

`tests/fixtures` is declared by `typecheck` and by `test:external-pack:contract`, so whichever of them
ran will name the probe. The capture above has one of them cached, so only `typecheck` reports.
