# Pipeline commands: what each flag was measured against

The root `CLAUDE.md` has each command's purpose and its flag *names* — enough to use it. This holds the
rest: what a flag replaced, what was measured to choose it, and which cheaper thing was tried and did not
work. Read it when you are about to change one of these commands, or when a flag's behaviour surprises you.

Each pool uses the aggregate deadline declared by its owning chain step. Complete compiler/runtime
integration uses `acceptance`; ordinary unit pools retain `suite`. The strict workflow's envelope also
includes preparation and app checks. Individual test, operation, event and cleanup limits remain
independent. [Timeout classes](../../../scripts/lib/step-budgets.ts) own the allowances; diagnostic batch
cutoffs do not change them or establish a normal acceptance result.

It is here rather than there because the guide is loaded into every session and this is consulted when
someone reaches for a flag. Moving it was not a judgement that it stopped mattering: 1,095 lines of guide
was 75% two sections, and a lesson's rule belongs in the guide while its evidence belongs here.

## `npm run chain`

```bash
npm run chain            # Before a merge: every check in dependency order, cold 158s and warm 0.9s. Each
                         # step is cached on the inputs it declares (scripts/lib/chain-steps.ts), so a doc
                         # edit runs nothing and a one-package edit runs that package's suite; the E2E
                         # suite is opt-in (`--e2e`) rather than a gate, with its reason on the step: it
                         # was built to be driven, and taking it off the chain took a doc edit from 26s to
                         # 0.9s. It runs api:check and packages:check, both of which regenerate what they
                         # compare: neither has a cheaper proxy, and api:check's stopped being cheaper than
                         # the thing it stood for.
                         # **A run keeps every step's output** (scripts/lib/chain-evidence.ts), which is
                         # what makes the printing a convenience rather than the only copy — this is where
                         # the instruction never to pipe a backgrounded run used to be, a procedure
                         # standing in for the mechanism.
                         # Afterwards it names a step that passed and is already stale again, with the
                         # inputs that differ and whether each moved while the step ran (an ordering to
                         # fix) or since. What each passing step cost joins a machine-local window
                         # (scripts/lib/step-durations.ts) that `--dry` and a failure report read.
                         #   --dry     the plan and why each step is or is not cached, running nothing —
                         #             and **what bounds it**: the critical path over recent runs here,
                         #             which is the answer to "which step is worth making faster". A step
                         #             off that path runs inside the shadow of the ones on it, so its own
                         #             duration is not a saving. `--dry --all` gives the cold chain's path,
                         #             since `--all` plans every step; no second flag, the composition
                         #             already means it
                         #   --all     every step regardless of its stamp, forcing those that keep a cache
                         #             of their own
                         #   --cores N how much of the machine to spend. **This machine's cores by default**,
                         #             and the only limit there is: a step declares what it takes
                         #             (`POOL_WIDTH`, scripts/lib/core-budget.ts) and admission is the sum,
                         #             so the eighteen single-threaded `tsc` legs run wide while the two
                         #             nine-worker vitest pools do not pile on each other. It replaced
                         #             `--lanes N`, which metered both as one unit each: measured
                         #             2026-10-02, interleaved `--all` pairs on ten cores, three lanes is a
                         #             median 202.8s and a ten-core budget 169.4s with half the spread.
                         #             `--cores 1` is serial, which is what `--lanes 1` was for. It caps
                         #             what to spend of *this* box rather than describing a box of N: the
                         #             declared widths stay machine-sized. Vitest pools additionally cap
                         #             their actual workers at N, including minimum-worker overrides;
                         #             both cache layers record the actual worker configuration. A value
                         #             above the box does not raise an individual pool's configured width
                         #   --e2e     run the E2E suite with the chain, ordered after test:smoke
```

## `npm run measure and measure:loop`

```bash
npm run measure -- "<cmd>"  # Times a command on a quiet machine and prints a number you can quote:
                         # `48.2s median of 5 (45.0s-49.3s), 92% idle, 2026-09-30`. A number without its
                         # conditions is an assertion; with them it is a citation, and the difference is
                         # three commit messages in goal-integration-pool that had to be corrected.
                         #   --runs N          how many (5)
                         #   --against "<B>"   an A/B, **interleaved**, reported as the median of the pairs.
                         #                     Blocked arms let a drifting box in: measured, that turned
                         #                     49.1s->48.2s into a reported 71s->46.1s.
                         #                     Prints **cores busy per arm**, which a lone measurement does
                         #                     not get: between two arms it is what says the treatment landed
                         #                     (`coresBusy` has the case). Nothing warns when the two agree —
                         #                     most null results are real, so a gate on that would be wrong
                         #                     more often than right. Reading it is the method's, below
                         #   --trials N        how often does it *fail*? The rate and its 95% upper bound —
                         #                     0 of 5 bounds it at 45%, 0 of 20 at 14%. Failures group by a
                         #                     normalised signature: it groups, it does not classify
                         #   --busy N          N CPU burners, so contention is induced rather than waited
                         #                     for. Implies --force and says so in the conditions
                         #   --idle PERCENT    lower the floor    --force  measure anyway
                         # It refuses below IDLE_FLOOR (70%), and that is the only floor now — it was the
                         # looser of two while a command wrote measurements into a committed table, and
                         # nothing writes one. Read from os.cpus() rather than load average,
                         # which lags — measured, loadavg 3.20 on a box that was 78.7% idle. **Idle is
                         # sampled between runs, never during one**: a reading taken while the command runs
                         # measures the command, and a quiet box reads 0% while a suite uses it.
                         # Prints, never records — a timings file would be a sample, and the deleted
                         # spec-cost.json is what that costs (see the sample section above)
                         #
                         # **A null A/B is unfalsifiable until the independent variable is shown to have
                         # moved**, and the instrument cannot do that half for you: `measure` takes the
                         # command as an opaque string, so it never knows what configuration you meant to
                         # change. Three habits, in the order they pay:
                         #   - **Read the config before guessing at the knob.** The first failed attempt at
                         #     capping `test:integration`'s pool passed `--maxWorkers`, which
                         #     `vitest.integration.config.ts`'s own comment says `poolOptions.maxThreads`
                         #     overrides. The answer was on screen and the run was wasted anyway; no readout
                         #     prevents that one
                         #   - **Run the positive control first.** Set the knob to the value that *must*
                         #     change the answer and confirm it does, before trusting any null. Measured
                         #     2026-10-04, that run — the pool genuinely capped, 42.5s to 82.5s — arrived
                         #     third, after two nulls that had been read as "the pool does not scale"
                         #   - **Prefer the direct signal to the proxy.** Cores busy is the fallback that
                         #     covers most cases; where the thing under test reports its own state (vitest
                         #     names its worker count, a cache its hits), read that instead. A -1% delta
                         #     should read as "the knob did nothing", and only a second signal says which

npm run measure:loop -- "<cmd>"  # Not how long a command took, but how long each process it started went
                         # without turning its event loop, against the 60s window birpc gives a call and
                         # vitest hardcodes. Per process, worst block first:
                         #   worker  apack-cli/tests/…/types-bundler-determinism…  10.0s  6.0x slower  100%
                         # Headroom rather than the block alone, which reads as fine until it is not: 38s
                         # against 60s is one busy afternoon from failing. `elu` says *why* a process was
                         # quiet — 4% was waiting, 99% was working, and only the second can be shortened.
                         # It answers what `[vitest-worker]: Timeout calling` does not, which is which side
                         # failed; see the test:integration entry above for the mechanism and the fix
```

## `npm run spec, spec:dry and spec:full`

```bash
npm run spec             # The specs your uncommitted changes affect, wherever they live.
                         # **Three exit codes**: 1 a spec failed; 2 the name was wide enough to be a
                         # search, so the paths were listed rather than run; 3 the target exists and no
                         # spec covers it, so nothing ran and nothing passed. 3 is the one worth knowing:
                         # `vitest related` exits 0 when the graph reaches no spec, so a green run and a
                         # run that did nothing were the same answer until it existed. Only a route that
                         # promised coverage earns it — a whole-suite run, a `-t` matching no case and a
                         # doc target all report zero correctly and exit 0
npm run spec:dry [...]   # What the plan would run, and what the last run on this machine measured it at,
                         # running nothing. Takes every argument spec does; ~1.6s whatever comes back, since
                         # it is the project configs loading rather than a graph being walked. It prints
                         # **file time summed across workers, never a wall estimate** — the ratio between
                         # the two was 1.55:1 and 2.18:1 on one target three days apart — and when that run
                         # was, since that is how stale the answer is.
                         # **There is no record behind this and nothing to re-record.** It reads a cache the
                         # unit pools write (`node_modules/.cache/apack-spec-durations`, keyed by suite and
                         # half), so nothing is committed, nothing can describe another machine, and a spec
                         # no run here has measured is named rather than counted free. A fresh clone prices
                         # nothing and says so. It replaced `spec-cost.json`, which held a millisecond per
                         # spec in git and needed a window, a band and two idle floors to be comparable at
                         # all. The ordinary `npm run spec` collects nothing.
                         # **That cache keeps a window too, and the difference from the deleted one is what
                         # it is for**: ten runs per suite and half (`KEPT_RUNS`), uncommitted, feeding one
                         # `(was Xs over N runs)` column on five lines the pools already print. The old
                         # window *decided* a spec's half, and because that decision was impossible it
                         # needed hysteresis, a band, a tie rule, a machine field and two idle floors to be
                         # comparable. Nothing compares this one against an edge, so there is no threshold
                         # to get wrong — which is also why the output is bounded to a list that was already
                         # bounded rather than to whatever crossed a line
npm run spec:full [...]  # The same, plus the two answers the module graph cannot give: the pack suites a
                         # rebuilt dist would reach, and the integration halves behind a second config.
                         # Costs a build when one is stale (14s), the pack suite (18s) and the pooled
                         # integration run (47s), and adds nothing where neither depends on your change.
                         # `--full` is the one argument spec.ts consumes, and only in first position,
                         # which is what keeps "everything from the first - is vitest's" exact
npm run spec -- <target> # You don't say what the target is; it works that out:
                         #   a source file  -> every spec that imports it, transitively, in ANY package
                         #   a spec path    -> that spec        a directory -> every spec under it
                         #   part of a name -> every spec whose path contains it — how you run one while
                         #                     working: `npm run spec -- chain-schedule` is 1.7s
                         #   a pack's src/content/** or one of its build inputs (apack.json, package.json,
                         #                     tsconfig.json) -> the walk, plus the specs that read what
                         #                     building it produces. Named by default, run by spec:full
                         # A source file runs one vitest over every host project, because that is the
                         # honest answer to "what could this break". The cost is the blast radius: a
                         # renderer module 1 spec, the api's runtime 13, apack-sdk's entity types 104.
                         # **A pack suite is not in that answer.** It resolves the published dist while
                         # the host projects resolve source, so no import edge runs from your edit to the
                         # spec that covers it — that edge runs through a build. The command says so when
                         # it is true, derived from the declared dependencies (workspace-deps.ts) and
                         # including the transitive ones; repo-checks' spec-plan.spec.ts partitions which
                         # packages those are, so a new edge fails a check instead of dating a sentence.
                         # A pack's own source runs `related` inside that pack, since no root project
                         # imports a pack's backend or frontend: 1-3 files in 2-6s against the whole
                         # suite's 87 and 18s.
                         # **Nor is an integration half**, for a duller reason: it is a second config and
                         # the root projects exclude its specs. 22 modules in @apackdev/cli are imported
                         # directly by one. Named the same way, run by spec:full.
                         # Anything from the first `-` goes to vitest untouched, so `-t "a case"`,
                         # `--bail 1` and `--changed HEAD~1` work. The routing is data
                         # (scripts/lib/spec-plan.ts), asserted by repo-checks' spec-plan.spec.ts.
                         # Where a spec belongs: its path under tests/ mirrors the source it covers, no
                         # directory names a level or a cost half, and support dirs take a _ prefix
                         # (docs/references/test-inventory.md; repo-checks' spec-placement.spec.ts)
```

## Test commands

- `npm test` builds the default pack and app runtime, then runs all unit tests, all integration tests, app E2E, external-pack checks and packaged-authoring checks. It stops at the first failure and does not use test-result caches.
- `npm run test:e2e -- <filter>` runs app E2E against existing app builds. The full suite already includes smoke tests.
- `npm run chain` validates changed inputs with caching, builds, static checks and selected tests. `--e2e` adds the full app E2E suite.
- `npm run spec -- <target>` runs focused tests during development.

`npm test` does not accept filters; use the appropriate suite command instead. Workspace `npm test -w <workspace>` commands keep their existing behavior.

## Command notes

What the root guide's command list said about each command beyond its one line: the measurements behind
it and the traps it records.

### `npm run dev`

```text
Prepare the pack, then run dev mode with hot reload and drive support
The pack's backend watcher rebuilds its runtime on source changes;
Vite serves frontend source. Use build:default-setup for all pack output.
```

### `npm run typecheck`

```text
Every check below, plus check:specifiers — its legs run at once
(scripts/typecheck.ts, legs in scripts/lib/typecheck-legs.ts): 18.0s wall
(median of 3, 17.5-18.3s, 79% idle, 2026-10-08).
**It answers for every recorded file**: beside the legs it borrows the two
whose checks are chain steps (api:check, facade:check — RECORDED_FILE_CHECKS), taking
each step's own timeout class and core width rather than restating
them. Borrowed, not moved: as legs they would need five hand-written fields each
and would drop inputs that decide what a report says.
**Two ordered prerequisites, then the rest at once.** `packages:ensure` builds what
the jobs read; `generate:entries` regenerates the pack's barrel, which
typecheck:pack compiles and two repo-scope legs walk — so it is ordered rather than
concurrent, and facade:check runs with `--skip-generate` and writes nothing. Those
two are the only jobs that write. `-- --cores 1` runs everything one at a time, to
test that claim or to read a confusing failure. A failure prints that job's output
alone, and several can fail in one run where the old `&&` chain stopped at the first
```

### `npm run spec`

```text
The specs your uncommitted changes affect, wherever they live.
**Three exit codes**: 1 a spec failed; 2 the name was wide enough to be a search,
so the paths were listed rather than run; 3 the target exists and no spec covers
it, so nothing ran and nothing passed. 3 matters because `vitest related` exits 0
when the graph reaches no spec.
```

### `npm run spec:dry [...]`

```text
What the plan would run and what the last run here measured it at, running
nothing (~1.6s). File time summed across workers, never a wall estimate, with
the date it was measured; a spec no run here has seen is named, not counted free.
Nothing is committed and nothing can describe another machine.
```

### `npm run spec -- <target>`

```text
You don't say what the target is; it works that out:
  a source file  -> every spec that imports it, transitively, in ANY package
  a spec path    -> that spec        a directory -> every spec under it
  part of a name -> every spec whose path contains it
  a pack's src/content/** or a build input -> the walk, plus the specs that read
                    what building it produces (named here, run by spec:full)
Anything from the first `-` goes to vitest untouched, so `-t "a case"`,
`--bail 1` and `--changed HEAD~1` work. The routing is data
(scripts/lib/spec-plan.ts), asserted by repo-checks' spec-plan.spec.ts.
Where a spec belongs: its path under tests/ mirrors the source it covers
(docs/references/test-inventory.md; repo-checks' spec-placement.spec.ts).
**A pack suite and an integration half are not in a plain run's answer** — one
resolves the published dist, the other is a second config the root projects
exclude. docs/archive/references/pipeline-commands.md has the blast-radius figures.
```

### `npm run chain`

```text
Before a merge: every check in dependency order, cold 158s and warm 0.9s.
Each step is cached on the inputs it declares (scripts/lib/chain-steps.ts), so a
doc edit runs nothing and a one-package edit runs that package's suite. The E2E
suite is opt-in rather than a gate.
**Every step that ran leaves its output** in this run's own directory, named on
the last line (node_modules/.cache/apack-chain/runs/<started>Z-<pid>/). So piping a
run is harmless and the output is still answerable after the terminal has gone.
Beside each `<step>.log` of what it said, a **failed** step's `<step>.files/`
holds what it wrote (`evidence`, scripts/lib/chain-steps.ts), copied in before the
next run's runner clears its output directory — which is how an app's own log
survives.
The newest `KEEP_RUNS` of them are kept, the writer pruning the rest, and a
cached run writes no directory at all, having run nothing.
**One run per checkout**, held by a lock beside the stamps
(node_modules/.cache/apack-chain/chain.lock): two runs share those stamps, so
each would cache results the other took against a different tree, and `cached`
would mean "some run with these inputs passed". A second run names the first and
exits 1; `--dry` is exempt, reading the tree and writing nothing.
Afterwards it names a step that passed and is already stale again. What each
passing step cost joins a machine-local window (scripts/lib/step-durations.ts),
which `--dry` and a failure report read; nothing is committed.
`npm run chain -- --help` lists its flags. Read `--dry`'s critical path and what
each step on it could buy before sizing an optimisation: a step off the path buys
nothing, and one on it is capped by the second-longest route.
docs/archive/references/pipeline-commands.md: what each flag replaced and what was
measured to choose it.
```

### `npm run test:unit`

```text
Vitest, as two pools: the host suites as one root run under the
@apackdev/source condition, and the pack suite on its own resolving the published
dist. Serial, measured — a second lane buys 3% for 87% more work.
The list is scripts/lib/unit-suites.ts, which the chain reads too
```

### `npm run test:native`

```text
The native half (*.native.spec.ts): native compiler runtime and live-watcher specs,
one vitest run over vitest.native.config.ts, beside integration rather than in it.
One file at a time (two compiler-heavy files starve each other), at the `enormous`
size: 300s a case (`SIZE_MS`), since each composes cold captures and builds
```

### `npm run test:integration`

```text
The expensive half of every suite that has one (@apackdev/cli, @app/repo-checks,
@app/publish-checks), as **one vitest run** over vitest.integration.config.ts's
projects rather than three `npm -w` invocations in series: measured 2026-09-29,
48.2s pooled against 71s. Which packages those are is derived from the configs
each has (INTEGRATION_SUITES); the root config's project list is checked rather
than derived, because check:specifiers reads these files as text.
**It is the third pool**, not a fourth kind of thing: the same runner as the two
unit pools (scripts/test-unit-pool.ts, over POOLS in scripts/lib/unit-pool.ts),
so it runs only the projects whose inputs moved — a repo-checks edit is 6s of its
44s. A pool is a resolution and a half; this one shares the host resolution and
differs in the half, which is why its stamps are keyed (dir, half). One key for
both would skip the expensive half on the fast half's record, which is the hole
that keying it this way exists to close
It runs at half the cores, and that is faster than all of them — 48.2s capped
against 52.4s uncapped, since nine workers each running ts.createProgram and
apack pack build put the box at a load of 25-32.
**The birpc timeout the cap was written against is a worker blocking its own
event loop**, not a main thread too busy to answer: measured 2026-09-30, the
main process sits at 6% event-loop utilisation with a worst block of 74ms,
quiet and loaded alike. A worker runs each case synchronously and `await` on a
resolved promise drains microtasks without turning the loop, so a file of
synchronous cases is **one** block however many `it`s it holds — against
birpc's hardcoded 60s window (DEFAULT_TIMEOUT = 6e4, which vitest exposes no
knob for; vitest-dev/vitest#4497, #6479, #8164). Every test passes and the run
exits 1.
The fix is to turn the loop: `afterEach(() => new Promise(r => setImmediate(r)))`
caps a file's *cases* at the longest of them. Every integration and native spec
gets it from its config's setup file (`tests/_support/turn-event-loop.ts`), since
any all-synchronous file can breach the window on a slow runner.
`npm run measure:loop` found the first such files — measured 2026-10-06,
`published-sdk-any` was the half's worst block at 13.6s over eight ~200ms cases
and `published-exports` 9.1s over four. Neither was slow; each was a sum being
reported as a block, which is the shape to look for.
**The hook is not a cap on the file**: those two came down to 9.6s and 5.6s, not
to one case, because a synchronous `beforeAll` is its own block — theirs packs
three tarballs through execFileSync. The half's worst block went 13.6s to 11.6s
and its headroom 4.4x to 5.2x. What is left is a setup to make cheaper, and a
single long case the hook can never help: `types-bundler-determinism` is one
test of ~11.6s and is the floor on this headroom now.
**Do not try to split that one.** It is a single `it` that builds the facade
twice — once from the workspace, once from the packed tarballs — and compares
them, so the comparison needs both in one scope: two cases would share a
`beforeAll`, which is its own block and shrinks nothing (watched on
`published-sdk-any`, 13.6s to 9.6s and no further), and two files would need one
to write a hash for the other, which is the cross-file state a determinism test
must not have. The levers are making the two builds faster or leaving it.
**The margin is the thing to watch, not the duration**: it breaches at 5.2x
against a worst observed load inflation of 3.29x, so the trigger is the block
passing ~18s (60s / 3.29), where that load would breach. `measure:loop` is how
you find out; nothing watches it for you.
To reproduce on demand rather than wait for it:
  npm run measure -- --trials 3 --busy 12 "npx vitest run --config vitest.integration.config.ts"
```

### `npm run test:unit:pack`

```text
(--project per stale project, one process). Each is a chain step; per-package
staleness lives inside them, so a one-package edit still runs one project.
They cannot be one pool: Node conditions are per process, and vitest shares its
worker pool across projects. Each runs packages:ensure first, since npm pretest
does not fire under a root run, and then prunes the pool stamps no pool would
write — the key gained its half on 2026-10-01 and left a dead file per suite
```

### `npm run api:update`

```text
Dev: regenerate etc/<entry>.api.md (and etc/<entry>.component.md for UI components),
Both read an @apackdev dependency's built declarations: npm run packages:build first
All three take 6.9s (median of 5, 2026-10-05), run at once by scripts/api-check.ts
rather than in the series npm's `-w a -w b -w c` gives; 12s in that series, and 48s
before one API Extractor compiler state was shared across a package's entries.
A chain step, so a merge runs it and an unchanged tree pays nothing for it
```

### `npm run measure -- "<cmd>"`

```text
Times a command on a quiet machine and prints a number you can quote:
`48.2s median of 5 (45.0s-49.3s), 92% idle, 2026-09-30`. A number without its
conditions is an assertion; with them it is a citation.
  --runs N          how many (5)
  --against "<B>"   an A/B, interleaved, reported as the median of the pairs,
                    with cores busy per arm
  --trials N        how often does it *fail*? The rate and its 95% upper bound
  --busy N          N CPU burners, so contention is induced rather than waited for
  --idle PERCENT    lower the floor    --force  measure anyway
Refuses below 70% idle, or 80% for a command that records; idle is sampled
between runs, never during one. Prints, never records — a timings file would be
a sample, and the deleted spec-cost.json is what that costs.
**A null A/B is unfalsifiable until the independent variable is shown to have
moved**, and this cannot do that half for you: read the config before guessing
at the knob, run the positive control first, and prefer the thing's own report
(vitest names its worker count) to the cores-busy proxy.
```

### `npm run measure:loop -- "<cmd>"`

```text
Not how long a command took, but how long each process it started went
without turning its event loop, against the 60s window birpc gives a call and
vitest hardcodes. Per process, worst block first, with the headroom rather than
the block alone — 38s against 60s is one busy afternoon from failing. `elu` says
whether a quiet process was waiting or working.
docs/archive/references/pipeline-commands.md has the measured habits behind both.
```

### `npm run check:idle`

```text
Is this machine quiet enough to measure on — `82% idle — quiet enough to
measure on`, exit 1 below `IDLE_FLOOR`. One floor, because every command that
asks it prints its reading and records nothing. `measure` and `measure:loop`
refuse on the same floor before they run anything, so asking first saves a
five-run A/B: `npm run check:idle && npm run measure -- "<cmd>"`.
**It answers "is it worth starting", not "will this be clean"**: a reading is of
this instant, and a long command is its own load — a chain run reads 83% before
ending under the floor. Not a chain step, and must not become one, since the
chain would then gate on its own load
```

### `npm run check:specifiers`

```text
Every import rule, over the whole repo (2.5s, one parse and one tree walk). Takes paths to
run only the per-file rules over them (0.9s over one feature), and says which
whole-tree rules it skipped; --rule <id> runs one, --list prints them all
```

### `npm run specifiers:fix`

```text
Rewrites the specifiers whose repair the rules compute — an own-module specifier
that names no file, a relative .js whose source sibling exists — and reports the
rest. --dry prints without writing. Verifies each span before splicing and refuses
a whole file when the disk and the reader disagree
```

### `npm run lint:check`

```text
Reports; run by npm run typecheck, so it is in the chain. The whole tree is at
zero and the whole pass is about a tenth of a second.
**Only `correctness` is enabled**, in every invocation — so a rule outside that
category is read nowhere in this repo, and an inline disable naming one
suppresses nothing wherever it sits. `no-console` is the one to know: it is a
`restriction` rule, and `console` in a pack's backend is the `backend-console`
pack rule's job, not oxlint's. The scaffold's templates are the one exclusion,
since an unused parameter there is documentation for a pack author. The few
inline disables elsewhere each say why
```

### `npm run packages:check`

```text
publint + arethetypeswrong over a tarball packed from each of the five published
trees — the tarball npm ships, rather than the directory it is derived from, and
one tarball per tree so the two tools cannot read different bytes of it. It
refuses a tree the sources have moved past rather than checking it, so
`after packages:build` is enforced rather than advised — door 8 in
packages/apack-testing/CLAUDE.md.
A chain step, for the opposite reason to the proxy `api:check` does without —
see "packages:check is a chain step" above
```

### `npm run check:repro`

```text
**A diagnostic instrument, not a gate**, and nothing runs it on a schedule by
design: everything it compares is a chain input, so the chain's freshness sweep
already reports a step that went stale again. What this adds is asking per file
in one run — the sweep fired on PACK_OUTPUTS for days and the diagnosis blamed
esbuild and one file, where this found three and the cause (tsc's union
ordering). Builds everything twice from one input and compares 1295 built files
(54.7s measured 2026-09-28). Run it after bumping a bundler (esbuild, vite,
tsup, tsx), which is when the answer can change, or before cutting a release.
Three outputs are known-irreproducible and reported rather than failed
(KNOWN_IRREPRODUCIBLE, scripts/lib/repro.ts). They are races, so a run where one
agrees is not evidence it is fixed — which is why a stale entry is reported here
and failed everywhere else. docs/archive/goals/goal-reproducible-builds.md has
the measurements
```
