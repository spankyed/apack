# What each of these rules cost to learn

The root `CLAUDE.md` carries these rules in their imperative form with one citation each — enough to follow
and enough to recognise when you are about to break one. This holds the full account: what was measured,
what was tried first, how many copies there were, and which commit closed it.

Read it when a rule's one-line citation is not enough to tell you whether your case is the same case, or
when you are about to argue that a rule does not apply here.

## Validation loops

On 2026-10-16 the settings/discovery compiler checkpoint had spent over four hours in testing without
a source commit. Broad strict runs repeatedly found failures; focused fixes were followed by another
broad run rather than a defined investigation and checkpoint decision. Concrete defects were found,
including late public-watch signal ownership, but that did not justify the repeated diagnostic scope.
Changing test budgets and investigating infrastructure also accumulated inside the unfinished checkpoint.

The correction is a bounded sequence: define the checkpoint claim, converge focused checks, run the
required broad gate, then investigate any failure from its evidence with a targeted reproducer. A further
broad run must close a named coverage gap or the converged gate. An unexplained recurring failure calls
for a blocker report and a diagnostic decision, not another broad run. Keep one current goal handoff;
preserve historical evidence without treating each dated note as a fresh work instruction. Required
gates remain required, and their failures must not be disguised by isolated passes.

Things that waste the most time, in order:

- **Running anything at all after a comment, a doc or a CLAUDE.md edit.** Nothing means nothing: not
  `typecheck`, not the package's suite, not "just to be safe". Prose cannot break a build, and no step
  declares `docs/` among its inputs, so the chain agrees — `npm run chain -- --dry` after a doc edit reports
  every step cached. A `CLAUDE.md` is free wherever it sits, which took a change: five of them live inside
  a declared `src/` or `tests/` tree rather than at a package root, so a sentence of prose used to re-run
  up to four steps, `build:default-setup` among them. `fingerprintUnit` skips them by name now, and repo-checks'
  *"prose costs nothing"* holds the claim this paragraph makes. The two exceptions are a spec that asserts the text and a code fence someone will
  copy: check that one command. This is first on the list because it is the one most often ignored, and a
  full `typecheck` is 11s against a doc edit's 0s.
- **Optimising a step that is not on the critical path.** The chain admits steps in parallel, so the only
  durations that add up are the ones along its longest chain of dependencies — `npm run chain -- --dry --all`
  prints it, and as of 2026-10-06 it is **157s: `packages:ensure` -> `build:default-setup` -> `build:runtime` ->
  `test:packaged-authoring`**, which matches the 158.3s cold run above. Nothing else is a saving.
  `test:unit:pack` is the worked example and the warning: it is **89% setup overhead** — 115s of module
  evaluation against 13s of tests, the most alarming ratio in the repo — and it is off the path, so halving
  it buys zero chain wall and about a second of `npm run spec`. The diagnosis and the three dead ends are in
  `packages/apack-testing/CLAUDE.md`; what makes it worth revisiting is appearing on that path, not the
  ratio getting worse. **Read the path before measuring a ratio**, which is the mistake this bullet is made
  of: two sessions went into that pool's overhead before anyone asked whether it was on the path.
- **Running `npm run build:runtime` to test a change no build output depends on.** The renderer and API build
  from source; a CLI or SDK change does not need them rebuilt to be tested.
- **Running an E2E suite to find a bug you have a stack trace for.** A minified frame with a line and
  column is a solved problem: build once with `sourcemap: true` in the renderer's Vite config, decode
  the mapping, read the source. Do that before you grep, not after.
- **Re-running the full chain after a fix to a thing the chain already covered.** If the CLI suite
  caught it, the CLI suite proves the fix.
- **Reading the source twice to explain a bug the running app would show you.** A hang or a dropped
  event in the real app is worth one instrumented E2E run — a `console.error` in the failing path,
  `npm run build:api`, `DEBUG_E2E=1 npm run test:e2e -- <spec> --grep "<title>"` — and the run you already did wrote
  the app's whole output to `tests/results/app-<workerIndex>.log`, so read that before re-running. Two carefully argued
  explanations have been wrong where one such run was decisive. `tests/e2e/CLAUDE.md` has the method,
  including what to rebuild first and how to put the instrumentation back.
- **Reading a chain step's `cached` as "the thing it guarantees is true".** It means only that the step's
  declared inputs have not moved. `packages:ensure` used to be cached that way, and what it guarantees —
  that the built packages are current — is recorded in `node_modules/.cache/apack-packages-build`, which
  its fingerprint cannot see and `fingerprintUnit` excludes from the content hash by design. Measured
  2026-09-26: with those stamps cleared and `dist` still present, the step reported `cached` while
  `packagesBuiltOrRefuse()` refused, so every step reading the built packages failed at collection (five
  files, thirty-three tests skipped). It carries a `neverCachedBecause` now — 0.3s warm, against a second record of one
  fact that can disagree with the first. Two caches over one body of work is the bug, not the cost.
  **The three pool steps keep two on purpose, and the reason is that theirs cannot disagree.** A pool step's
  inputs are `inputsForSuites`, the union of the same `suiteInputs` each project inside it is keyed on, so a
  cached step cannot hide a stale project — where `packages:ensure` guaranteed something its fingerprint
  could not see. What the two layers buy is granularity: a one-package edit runs that package's project
  rather than the pool. What they cost was measured 2026-10-06 — median of 3 on a box another process was
  using, so each figure is an upper bound and the proportions are what the conclusion rests on — and a
  fresh host pool step is 0.90s, of which
  **0.38s is `tsx` starting, 0.30s is the nested `packages:ensure` spawn and ~0.22s is the prune and the
  sweep over 2,372 files**. So the re-read of what the chain just hashed is the smallest of the three and
  0.6-1% of a step doing real work. Collapsing to one layer was priced too: uncaching the pool steps puts
  three ~0.9s steps on a 0.7s floor and fixes nothing, since the pool would still trust its own stamps.
  What they *could* disagree about is who established the pass, and that is closed separately —
  `CHAIN_RUN_ENV` in `scripts/lib/unit-pool.ts`, which keeps a pass under the chain apart from one
  established alone.
- **Running suites concurrently *before the packages are built*.** The hazard is the build itself, not
  the suites: `ensurePackagesBuilt()` returns before taking the lock when nothing is stale
  (`apack-host/src/build/packages-built.ts`), and only `stampedBuild` locks. So two suites that both
  find a stale package race each other's build and fail about the race rather than the code — which is
  what a background `test:unit` against a foreground `test:external-pack` used to do. Run
  `npm run packages:ensure` once first and every later call is a stat and a return, which is what makes
  a parallel chain safe; the 18 calls a serial chain makes are each paying that stat for nothing.

Rules that pay for themselves:

- **Measure before you optimise, and before you accept someone else's measurement.** Two proposals in
  this repo were rejected by one command each, and both had been argued for at length first.
- **Attribute a concurrent pipeline's cost with a CPU profile, not by timing its stages.** Rollup drives
  `transform` concurrently, so wrapping each Vite plugin hook and summing the wall clock of its calls
  reported **120s of hooks inside an 11.5s build** — a tenfold double-count that still read as a table with
  a plausible winner, `vite:vue:transform` at 1049% of the phase. The instrument for a single-threaded
  pipeline is `node --cpu-prof` with self time aggregated per package, which put the pack frontend bundle's
  **12.8s of CPU** at **6.1s inside rollup's tree-shaking walk** (`includeCallArguments`, `include`,
  `includePath` and the two path trackers), 1.6s GC, 0.7s tailwind and **0.3s compiling every SFC** — so
  the stage the first table blamed held a twentieth of the cost, and both intuitive optimisations ("make
  Vue faster", "cache the SFC transforms") were aimed at it. Subtract two profiles to isolate one phase
  (`apack pack build` against `--skip-fe`), and read what the subtraction attributes rather than trusting it:
  it charged the frontend phase 0.75s of `spawnSync` that was `packages:ensure` running in both arms.

  **What the profile bought was a rejection, which is the usual return on one.** `treeshake: false` for the
  non-release build measured **22.2s to 18.2s, -19%, for 443 KB more output** on 8.5 MB — paired A/B, median
  of 3, 75% idle, 2026-10-08, with the size change as the positive control that the knob had turned. It is
  reverted, because `fe-bundler-host-registry.integration.spec.ts`' *"drops the generated EARS facade from
  FE code that only uses the EARS constants"* fails under it, and that case generalises: every pack's
  `#generated/ears` pairs the constants with a `/*#__PURE__*/ defineEars()` call, so without the shake a
  frontend importing one constant carries that call into the renderer and **runs** it. Off is a divergence
  in what executes between a dev build and a release rather than only in what ships, and the dev build is
  what that spec and the E2E suite cover. The first comment written for the change claimed the opposite —
  that retaining code cannot crash what a release would not — which is wrong in the one way that matters:
  retained code runs.

  **Pre-bundling the vendor dependency is the other 3.0s, and it is spiked rather than built.**
  `build.opaqueDeps` stops rollup *walking* elkjs; it still parses and emits 3.3MB of it every build.
  Taking it out of the graph entirely — resolve the specifier to `{ external: true }` with a relative id,
  convert the UMD bundle to ESM once with esbuild (0.35s, cacheable on the dependency's content hash) and
  `emitFile` it beside the chunk — measured **20.8s to 17.8s, -14%**, paired A/B, median of 3, 71% idle,
  2026-10-08. The output is a real layout: a 3.32MB ESM asset and `import("./elk.prebuilt.js")` in the
  entry chunk, which resolves next to it over `pack://`. With the shipped `opaqueDeps` that is 23.3s to
  17.8s, **-24% of the original**.
  **It is not built because the machinery carries a risk nothing here would catch.** The conversion
  becomes ours: esbuild turning a UMD bundle into ESM is a semantic transformation, and if it is wrong
  elkjs fails at first layout — which no check runs, the chain never opening a flow canvas. Against that,
  `opaqueDeps` only ever *retains* code, so it cannot break what it is applied to. The cache, the asset
  and the specifier rewrite are the cheap part; being answerable for a vendor bundle's semantics is not.
  Revisit when the phase skip below has landed and this still matters, or when a second prebuilt
  dependency makes the mechanism pay for itself twice.
  **Pre-converting while still bundling is the worst of the three, and it took two measurements to say
  why.** The first read +20% against the shipped arm, and it was confounded: the spike's resolver returned
  before `opaqueVendorPlugin` could, so that arm silently lost `no-treeshake` too — two plugins matching
  one specifier, both `enforce: 'pre'`, and rollup calls only the first to return. Measured again with both
  arms in the same regime (the spike returning `moduleSideEffects: 'no-treeshake'` itself), handing rollup
  the pre-converted ESM is **-1.0s and -1.1s, about -5%**, consistent over 3 and 5 interleaved pairs; the
  output is the same size to within 662 bytes either way, because the CommonJS interop was expanding the
  UMD to the same thing. So the whole of that +20% was the lost shake, and the format is a small saving
  rather than a cost — the decomposition first written here, +2.6s of shake plus +1.4s for a bigger input,
  was wrong in the second term's sign.
  **What that buys is a sharper conclusion, not a candidate.** It needs the same conversion, so it carries
  the same risk, for a third of what externalising gives: whoever takes on being answerable for a vendor
  bundle's semantics should take the -3.0s and not the -1.0s. The lesson about the arms is the reusable
  half — the byte count tells the two regimes apart (8,511,670 shaken against 8,549,845 opaque), it had
  already caught one dead surface in this same spike, and it was not run on this arm.

  **Skipping the phase is not the other lever.** `apack pack build` records what each phase read, and that
  record's own header says it is *"never a cache key"* — it is a dep file, so it can be stale about a read
  nobody has made yet. The chain already caches `build:default-setup` on declared inputs, so an unchanged tree never
  pays the 11.3s in the first place, and the gate would only serve a hand-run build. What is left is making
  the two builds cheaper, or leaving it.
- **A mutation check is worth more than a re-run.** Breaking the thing on purpose and watching the
  right test fail proves more than running the whole suite again.
- **A check that reports nothing may have looked at nothing**, and a green run cannot tell you which. This
  repo has shipped both kinds: a step that skipped every test and returned green, a cached stamp for work
  that was stale, an extractor that found no paths in the one manifest it was written for, a probe naming a
  file that does not exist. A rule table already has the answer — *"a rule with no firing case is a gate
  nothing has watched fail"* — and an ad-hoc check needs the same thing and rarely has it. Two habits, both
  cheaper than the review that catches it otherwise. **Derive the subject from the declaration that defines
  it, and assert it is not empty** — in that order, because the first is the half that keeps failing. A walk
  of the tree cannot name something fictional, but it can miss an edge, and then it is a hand-written list
  that looks derived: seven places listed `packages/` where the root `workspaces` field decides what a
  workspace is, and a lint check expanded each `npm run` once and never saw the `-ws` fan-out. Neither was
  empty, so an emptiness guard says nothing about either. **Where the input is data — a pattern list, a manifest, a
  rule table — mutate it in the test**: drop the thing under test from a copy, assert the answer flips, and the
  check proves it can fail on every run for microseconds. `repo-checks/tests/packaged-app-files.spec.ts` is the
  worked example; its two mutation cases corrected two wrong beliefs about the patterns they check on the first
  run, before the commit.
- **A result that is partial says so, and there are four shapes for that — copy one rather than invent a
  fifth.** The rule above is about a check that looked at nothing; this is about one that looked at *some* of
  it and has to report the gap. Picking the right shape is picking what the caller can do about it:
  **refuse**, where the evidence is missing and running on anyway is worthless (`packagesBuiltOrRefuse`,
  `@apackdev/host/build/packages-built`, with an `APACK_ALLOW_UNBUILT` hatch — it exists because thirteen spec
  files, nine of them a whole package, reported green having checked nothing); **a distinct exit code**, where
  "nothing covered this" and "everything covering it passed" are different answers a script has to tell apart
  (`npm run spec`'s 3); **a named bucket beside the total**, where some of the input was unpriceable and only
  part of it is anyone's to fix (`pricedSpecs`' `unpriced`, `scripts/lib/spec-dry.ts`, which names the specs
  no run on this machine has measured rather than summing them as free); and **a
  clause on the success line**, where the work happened but one claim in the sentence did not hold
  (the chain's own `(N of M cached)`, and `spec-cost:check`'s *"placement unchecked for 1 of 12"* before it
  was deleted). A skipped test takes its reason in the name instead, so a run that covers less says why
  rather than quietly reporting fewer cases. What none of them is: silent.
- **A check that cannot fail today is a gate or an assertion, and they want opposite things.** A gate's
  subject is input, which can be wrong, so it needs a firing case — the rule above. An assertion's subject is
  the program's own construction, and being unreachable is the point: no input reaches it, so no case can, and
  writing one means faking a state the program cannot be in. What it needs instead is a comment naming the
  *edit* that would make it fire, because that edit is what you mutate to watch it. The worked example was
  `spec-cost`'s `plans.length === 0`, deleted with that command: its argument parser refused the inputs that
  could empty the list, so it read as dead code and was filed as a defect on exactly that reasoning — but
  appending `.filter(() => false)` to the chain that built the list left every spec passing while the command
  reported "every record is current" over no work at all. Judging one as the other costs a round trip at
  best and deletes the only thing standing under a future edit at worst.
- **A list and its type are one declaration.** Write the list and derive the type from it
  (`const XS = [...] as const; type X = (typeof XS)[number]`), or the other way round where the type is the
  definition — never both by hand. Four pairs in this repo were written twice, and each had a different failure:
  `PackRuleKey` beside `PACK_RULES` made adding a pack rule two edits; `APP_ENVS: readonly AppEnv[]` accepted a
  list missing an environment, which its one consumer would have rejected at startup as invalid; `ALL_COLORS` and
  `TabGroupColor` had already drifted into different orders, and a colour in the union but not the list is one the
  picker never offers. Deriving turns each of those into a compile error at the site that would have broken. The
  cost is that the widened form has to be exported separately when consumers read optional members — which is a
  line, and it is written where it is done.

- **A cache needs a key that cannot go stale, or a scope in which it cannot — and a reset hatch is neither.**
  Three adjacent modules answer this differently and the reasons are worth knowing.
  `publishedEntryPoints` (`apack-cli/src/build/pack-features.ts`) keys on its manifest's path, mtime **and**
  size, "so there is no cache to remember to clear" — the size because a filesystem with 1-second granularity
  reads a rewrite inside one tick as unchanged. `readSource` (`pack-sources.ts`) is keyed by path alone behind
  a `resetSourceCache()`, and a hatch is a thing to forget: two specs call it, the repo's largest spec did not
  and worked around the stale reads by building a pack directory per cell, which made that test quadratic in
  its own data until `7c4b8aacc`. `packDirs` (`scripts/lib/import-populations.ts`) can be keyed neither way —
  a directory's mtime moves when its own entries do, not when something three levels down changes — so it is
  memoised **only for this repo's root**, where nothing adds a pack mid-process and no test can reach it,
  because every test builds under `mkdtemp`. That is a scope standing in for a key, and it took
  `check:specifiers` from 4.6s to 2.5s and 103 286 `readdirSync` calls to 5 366.
  So: content-key where the input is a file, scope where it is a tree, and if you reach for a hatch anyway,
  give it a case that fails when it is forgotten — which is the one thing the hatch here never had.

- **A comment is for whoever opens the file cold, not for whoever reads the diff.** What changed, how many
  copies there used to be, what you measured to decide, why some other value would be worse — that is
  commit-message material, and the commit message is where someone looks when they ask why. The test: will
  this sentence still be true, and still worth reading, a year from now, to a reader who never saw the
  change? "Three modules did X" needs rewriting the first time a fourth one does, and usually goes stale
  before it lands. "This replaces the default rather than capping it" does not. Keep what the code cannot
  say: why a non-obvious choice was made, what breaks if you undo it, and the condition that would make a
  recorded tradeoff worth revisiting.

- **A comment justifying something by a past failure must name what prevents that failure now.** If it is
  this code, say how it fails; if it is something else, name the file; if it is nothing, say nothing checks
  it. `packages-built.ts`'s *"correct by luck rather than by construction"* and `dep-files.integration`'s
  *"which a reads-are-declared check cannot notice by construction — that failure is caught by the phase
  set"* are the shape. The failure mode is inheriting the justification from a plan: `packFixture` was
  documented as what stops a fixture too thin for a rule to fire, which is a real defect that
  `import-specifiers.integration` had already closed five days earlier by asserting each rule fires. A
  repo-wide rule mandating the fixture was then built on that premise and deleted (`487a8c115`). "X is the
  whole point" cannot be checked; "Y fails when Z" can.

## A stall that was a disk

On 2026-11-11 `test:native` failed four local runs of five in the Linux test container, each time on a
different case and each time with the same sentence: *stalled: its worker's process tree used no CPU for
120s*. Nothing in that sentence says what the tree was waiting for, and reading the cases found nothing,
because the cases were not at fault.

**What a stall could not say.** A process waiting on a disk, a file event that never arrived and a child that
hung all spend no CPU and write nothing. The report now carries what tells them apart: the waits the test had
not met, in the words the test gave them (`settles` records its last failure, `unmetWaits`); what its event
loop held open; and each process of the tree with its state and, on Linux, where each of its threads sleeps
in the kernel (`describeTree`).

**What it said the first time it was asked.** The only process in the tree was the test's own worker, asleep
in `btrfs_…`, with no wait of its own unmet: blocked in the filesystem. The container's disk is an image on an
external drive (`docs/references/guides/docker-storage.md`), and the native cases write each captured
compiler to it — unwritten data rose to 380–660 MB and fell to nothing about once a minute through a run.
While the filesystem takes a flush that size, whatever touches it waits: three read-only `docker exec`
probes of the container took 30, 43 and 63 s where the rest took under one, and a one-byte durable write on
that disk takes 1–2 s at rest and took 13 s behind 1.5 GB of unwritten data.

**The rule had been a clock after all.** *No CPU and no output for 120 s* is a measure of the tree only while
the machine answers it. So a watch asks, after every reading that found no work, whether the tree is waiting
on storage (`storageHold`: a process in the uninterruptible state, or a thread asleep in a function of a
filesystem that lives on a disk or of the layer that queues writes to one) and does not count the interval
if it is. Held to `STORAGE_ALLOWANCE_FACTOR` idle windows between two pieces of work, because a disk that
never answers is a run that never ends. Asked of a child writing 1.2 GB in the container, it found the child
held in 33 of 92 looks; asked while the child only slept, in none of 79.

**What it did not fix.** The next run allowed 44 s of storage waits and failed anyway, on a watcher case that
ran 43 minutes, spent 22 of them on CPU, printed nothing and then went idle with 1,767 file watches open
and nothing of its own unmet. That is a second failure, which the old sentence had reported as the same one.

**The second failure, once it could be read.** It came again under a busy machine with the sampler on
(`APACK_STALL_PROFILE=1`): `watch-package-edit`, 197 s, reported stalled with its worker at 3:40 of CPU in
3:40. Of that CPU 82% was file reads under one call, the watcher's `refreshInputs` reading and hashing the
whole compiler package on the test's own thread (`readCompilerWatchTools`) — seconds on a fast disk, minutes
on that one, and the 43 minutes of the earlier case. Two things, then. The work is real and slow there, and is
left as it is. And the guard called it a stall: a watch in the same process reads on a timer, synchronous work
holds the timer off, and the first reading it took — after the work — was taken as a baseline, so a test that
had spent every minute on CPU had by its account done nothing since the watch began. A reading that counts
from its watch's start is now measured against nothing done at the start (`countsFromWatch`).

## A signature that read every byte on every pass

The pack watcher signs the package trees its builds read — the compiler package, and the pack's whole dependency
graph — to decide whether a pass has anything to build. It read every file of both to do it: the compiler package
twice at a watcher's start, and the dependency graph twice per build with nothing kept between passes. For the
built-in pack that is 12,371 and 36,199 files, about 650 MB. In the Linux test container that read is what a
watcher case spent minutes in ([a stall that was a disk](#a-stall-that-was-a-disk)).

The reader now keeps each file's digest under what the filesystem says of it (size, both timestamps, inode) and
reads a file again only when one of them moved (`createPackageDigestCache`, `@apackdev/host/build/package-inputs`).
The signature is still the content hash, value for value, which is what separates this from signing by timestamps:
a file rewritten with the same bytes is unchanged, as it was. The trade the chain's fingerprint declined at 2.5 MB
(`fingerprintInputs`, `packages-built.ts`) is taken here at 650 MB, and only for the watcher: a build takes its own
bytes.

Measured 2026-11-11 on the Mac (10 cores, load 9), an unchanged tree read a second time:

    the compiler package                    read whole 1.11s | digests kept 0.30s
    the built-in pack's declared dependencies   read whole 4.46s | digests kept 0.71s

A watcher's first reading is still whole, taken before its first pass without holding the event loop (`warm`: 55ms
at most between turns of it). What remains of a later pass, 7.7s end to end at that load, is mostly the
module-input reading (4.4s), which this did not touch. A CPU profile of that reading puts under 5% of it in
TypeScript's parser and about 45% in filesystem calls, 21% of the whole in the `realpath` the compiler file view
took of every input to prove nothing was replaced. Most of those were for names that do not exist, a compiler's
failed lookups, each a thrown error and a second resolution of the parent. The view now lists a directory once and
answers its plain and its missing names from the listing (`physicalWatchPathListed`), resolving only links and
other spellings the long way: that `realpath` fell from 17.7% of the reading's samples to 5.1%, against 2% more in
listings. Those are shares of one profile each, taken at a load of 40, not a timing. The kept digests
hold 16 MB.

## A stamp directory has one writer

**The rule.** A cache of "this passed against these inputs" is only sound while one process writes it. Two
writers make `cached` mean *"some run with these inputs passed"* rather than *"this tree passed"*, and
nothing downstream can tell the difference.

There are four such directories under `node_modules/.cache`, and as of 2026-10-07 two are guarded:

| directory | written by | guarded by |
|---|---|---|
| `apack-packages-build` | `packages:ensure`, `packages:build` | `withBuildLock` (`@apackdev/host/build/packages-built`) |
| `apack-chain` | `npm run chain` | `holdChainLock` (`scripts/lib/chain-lock.ts`) |
| `apack-unit-pool` | `test:unit:host`, `test:unit:pack`, `test:integration` | `holdPoolLock` (`scripts/lib/unit-pool.ts`), **per pool** |
| `apack-spec-durations` | `npm run spec`, the pools' reporter | nothing, deliberately — see below |

**The unit is the entries, and the directory is only usually the right proxy for them.** The pool stamps are
locked per *pool*, not per directory, because a stamp's name carries its pool's half and provenance — so two
pools write disjoint files, and `prunePoolStamps` derives what is live from *every* pool's keys, so one pool's
prune cannot take another's. Two runs of the **same** pool is the case that collides. `unit-pool.spec.ts`
asserts that partition rather than assuming it, since it is what licenses the narrower lock.

**`apack-spec-durations` is not locked, and should not be.** It holds a ten-run window of measured file
durations, which informs one column of a report and gates nothing. A lost write loses a data point. Locking
it would be apparatus around a sample, and `spec-cost.json` — 1,884 lines of band, window, tie rule, machine
field and two idle floors, to place a spec in one of two config files — is what that costs. If something ever
*decides* on those numbers, that is the moment to revisit, and the decision is the thing to question first.

**The fix for an unguarded one is three lines**, and it is the same three: `holdExclusiveLock` from
`@apackdev/host/exclusive-lock` with a lock file beside the stamps, a refusal naming the holder, and a release
the mechanism already does for you on `exit` and on four interrupts. `scripts/lib/chain-lock.ts` is the
worked example and is 90 lines including its prose. **Do not write a fourth lock**: that module's header is
explicit that the mechanism is shared and only the policy — the file's name, the refusal's words — belongs to
the caller.

**Two traps, both paid for once already.**

The lock file must not end in `.json`. `pruneStamps` (`scripts/chain.ts`) removes every `.json` in the stamp
directory that is not a live step's stamp, so a lock named that way is deleted by the *next* run while the
first still holds it, and both then run — the exact failure the lock exists to prevent, arrived at through
the lock. `chain-lock.spec.ts` asserts the name against `pruneStamps`' own predicate rather than against the
string, because a case pinning `'chain.lock'` passes while the coupling rots.

A spec for one of these cannot take the real lock. `repo-checks` runs inside `test:integration`, which the
chain runs, so a case taking `CHAIN_LOCK` is refused by the run that is running it. Take a `file` parameter
defaulting to the real path — `withBuildLock(label, run, file = LOCK_FILE)` and `runningPackageBuild(file =
LOCK_FILE)` already do — and assert the real path's *properties* separately.

**What this cost to learn.** Four chain runs on 2026-10-07 produced three failures, none attributable to
code, while two sessions worked in one checkout. Each guard reported truthfully and none could name the
writer: `PackagesWentStale` said *"something rebuilt or edited them"*, the classifier said *"contention or a
flake, not the code"* having removed a variable it never identified, and the freshness sweep filed a step
whose inputs moved mid-run as a step that will not be cached next time — a caching note over a correctness
fact, printed after both runs had spent the time. Two hypotheses were investigated and disproven first (tsc
union ordering; a codegen skip ignoring its own generator), and two fixes were proposed that already existed.
The lesson is not that a guard was missing. It is that these guards assume one writer, and say nothing useful
when that assumption is the thing that broke.

**What closed it, and the shape all three took.** Each report held the fact it needed one frame up and printed
a guess instead, so each now names what it has and says what it could not rule out:

- **`PackagesWentStale` names the writer.** `waitForPackageBuild` already returned the holder it waited for and
  `ensurePackagesBuilt` discarded it — and that return is the *only* evidence in the ordinary case, because by
  the time staleness is read the writer has finished, which is what let the run past the wait. So reading the
  lock at that moment, which this doc used to suggest, answers for almost nothing. `packageWriter` has three
  arms: the build this run waited for; a lock still on disk, with whether its holder is alive, which covers a
  crash, a wedge and a writer arriving after the wait; and neither, which means something that does not take
  the lock did it.
- **A step whose inputs moved *while it ran* says its result is void**, and `--strict` fails the run on it.
  Only that reading of `whenChanged` counts: a change *after* the step is the ordinary cache miss, and two of
  the four readings cannot be placed at all. Proven on a live run where five steps were stale and exactly one
  was voided.
- **The classifier claims no cause.** It names the steps `ScheduleResult.peers` recorded beside the failing one
  — what happened, rather than the admission limit, which was the recorded reason it used to guess — and says
  it cannot choose between one of those, a writer outside the chain, and the step being nondeterministic.

**The one thing none of them can close** is a writer that records nothing: an editor, a tool that takes no
lock, another session. All three now say that in the arm where it is the answer, which is the difference
between a report a reader can act on and one they learn to skip.


## From the root guide

The root `CLAUDE.md` states each rule briefly; this is the evidence and the worked examples it points here
for, kept as it was written.

### What a change costs the chain

**`npm run chain` costs what you changed.** Each step declares what it reads
(`scripts/lib/chain-steps.ts`), is fingerprinted over exactly that, and is skipped when nothing under it
moved — so working out which suite covers your edit is the graph's job, not yours and not a table here. Run
the chain and it runs the subset; it does not need you to have guessed right.

Measured with `npm run measure`, 2026-10-04, each a median of three real runs rather than a sum of the
parts — so each figure carries its conditions and the table can be re-derived rather than trusted:

| What you changed | What the chain runs | Cost |
|---|---|---|
| nothing tracked | nothing | **0.9s** |
| a doc, a comment, a CLAUDE.md | nothing but that — no step declares `docs/`, and a fingerprint skips every `CLAUDE.md` | **0.9s** |
| one package's source (the renderer) | nine of thirty-one steps: `test:unit:host` (only the renderer's project), `test:integration`, the typecheck legs whose scope reaches it, `lint:check`, `check:specifiers`, `check:tiers` and `build:runtime` | **38.6s** |
| nothing is cached (a cold tree) | every gated step — 30 of the 31, `test:e2e` being opt-in — on a ten-core budget (`--all`, 2026-10-07) | **185.8s** |

**The one-package row is the one worth reading twice**, because the obvious reasoning about it is wrong.
`build:runtime` rewrites `packages/*/dist`, which looks like it moves what every app-dependent step reads — and
on that reasoning editing a package the app is built from would cost four times editing one it is not. It
does not. `build:runtime` runs, and `test:smoke`, `test:packaged-authoring` and `test:external-pack:app` stay
**cached** through it: their keys are over the built app's *content*, and a rebuild from unchanged input
produces the same bytes, so nothing they read has moved. That rests entirely on the build being
reproducible, which is the largest single saving in this table and the one nothing else would notice losing —
`npm run check:repro` is the instrument that keeps it true.

So the shape to carry is that an edit costs the steps whose *inputs* moved, and a step that only consumes a
deterministic build is not one of them. Re-derive it with `npm run chain -- --dry`, which names the ten and
the reason beside each.

`npm run chain -- --dry` prints that plan without running it, and says why each step is or is not cached —
which is the way to find out why something you expected to be skipped is not.

**The inner loop is still `npm run spec`**, and it is still much cheaper than a chain run: with no
arguments it runs the specs your uncommitted changes affect, in every package they touch; with a source
file it runs the specs that import it. One spec file is 1-3s and a package's `tsc --noEmit` is 3s, against
the 38.6s a chain run costs after a one-package edit — **not** against the chain's floor, which is 0.9s and so
cheaper than either. What `spec` saves is not the cost of starting the chain but the cost of what your change
made stale. Use it while you are working, and the chain when you are done. A change to
`scripts/` or to a vitest config counts too: it routes to `@app/repo-checks`, the package holding the
specs that check the repo's own tooling.

**Two answers `spec` cannot get from the module graph**, and it names both rather than passing a run that
skipped them. A *pack suite* resolves the published `dist` while the host projects resolve source, so the
edge to its specs runs only through a build — the same reason editing `@apackdev/sdk` can be green under
`spec` and red under `chain`, which declares that dependency (`scripts/lib/workspace-deps.ts`). An
*integration half* is a second vitest config whose specs the root projects `exclude`, and nothing has to
be built to reach it. `npm run spec:full` runs both. The pack seam is also why a pack's own source runs
that pack's whole suite rather than a root `related` — nothing in the root projects imports it.

**Two more edges run through a build, and they are inside one pack.** A pack's `src/content/**` compiles to
`dist/*.content.json`, which `tests/content/` reads against its goldens; its **build inputs** — `apack.json`,
which drives codegen into `src/__generated__/`, `package.json`, whose `imports` map is how those generated
specifiers resolve and whose `prepare` runs the codegen, and `tsconfig.json`, which the build compiles with —
are what every spec in the pack goes through. Both are `src -> apack pack build -> output -> spec`, so a
*regenerated* tree is covered while editing what generates it reaches nothing. `npm run spec`
names those specs beside whatever the walk did find, and `npm run spec:full` builds the pack and runs them.
The routes are derived from the pack's own layout (`scripts/lib/spec-plan.ts`'s `packBuildEdge`), and
repo-checks' `spec-plan.spec.ts` partitions the packs under `packages/`, so a second pack cannot arrive
unrouted. Before them a content item source was told *"No spec covers …"*, which its goldens refute.

Three things the chain cannot work out for you, because they rewrite files you commit:

- **a public export of `@apackdev/ears`, `/sdk` or `/ui`** — `npm run api:update`, and commit `etc/`.
  `typecheck` fails until you do. **Read the regenerated diff before committing it, and that is the whole
  of the review** — every line should be the edit you just made, and one that is not is what these records
  exist to show you. That holds for all four: regenerating is the ordinary next step after a deliberate
  change, while regenerating a diff you cannot account for is how a surface change comes to look reviewed.
- **default-setup's facade** — the types a dependent pack compiles against, bundled by `apack pack build` into
  `dist/types/pack-types.d.ts` and recorded in `etc/pack-types.api.md`. Run
  `npm run facade:update -w @app/default-setup` and commit the report. **`typecheck` fails until you do**, as
  it does for all four recorded files: `exports:check` and `schema:check` are legs, and `api:check` and
  `facade:check` are chain steps the runner borrows (`RECORDED_FILE_CHECKS`, `scripts/lib/typecheck-jobs.ts`), so
  one command answers for every one of them. It did not until 2026-10-08, and a green typecheck over a stale
  report is what that cost.
  The root chain check uses `facade-report --from-build`: verify sealed output, replay the common
  build-input record, then compare the published facade without regenerating shared files. It runs
  after `build:default-setup`. Source edits, missing output or modified receipts refuse.
  The pack-local command still derives from source without needing a build. `npm run typecheck`
  uses that command with `--skip-generate` after regenerating once ahead of its pool.
- **a pack's content source (`src/content/`)** — when only `contentHash`/`rowSha256` moved, re-record
  deliberately with `npm run content-parity:update -w @app/default-setup`, and never edit a hash by hand.
  Re-recording rewrites a test expectation, not user data; what reaches users is the new `contentHash`.
  `packages/default-setup/tests/content/CLAUDE.md` has the rule for what a golden records.

The chain is the normal repository gate. **Automatic CI is disabled, on purpose:**
`.github/workflows/ci.yml` has its `push` and `pull_request` triggers commented out while this is a
single-contributor repo. Do not report their absence as a failure or enable them. Manual platform and
strict-chain dispatches remain available and are used where the execution boundary below or an active
goal requires them; cite actual results, not an assumption that all CI runs or never runs.

**And when it does: CI may fail a check, never a clock.** A runner is smaller and noisier than any
developer's box, so anything gating on wall-clock there manufactures flakes that read as code failures.
Two things keep that true and are worth knowing before changing them: every kill deadline is a declared
class rather than a multiple of a measurement (`scripts/lib/step-timeouts.ts`), and what a step costs is a
reading of the machine it ran on, never a committed figure. CI already does the right thing where it has its own bound —
`ci.yml`'s `timeout-minutes` is a round number nobody measured — and it is the chain that was the outlier.
**Do not gate any of this on `process.env.CI`**: a CI-gated refusal in this repo never fires, and the one
that was cost thirteen spec files a silent green (`@apackdev/host/build/packages-built`, on `ALLOW_UNBUILT`).
The condition is the machine, which is a fact a run can check.

### Things that waste the most time: the evidence

- **Running anything at all after a doc or a CLAUDE.md edit.** Nothing means nothing: not
  `typecheck`, not the package's suite, not "just to be safe". No step declares `docs/` and `fingerprintUnit`
  skips every `CLAUDE.md`, so `npm run chain -- --dry` reports every step cached. A full `typecheck` is 11s
  against a doc edit's 0s, and repo-checks' *"prose costs nothing"* holds this claim. The two exceptions are
  a spec that asserts the text and a code fence someone will copy.
  **A comment inside a source file is not one of these.** A fingerprint is over the file's content, so a
  comment moves it like any other edit and every step that reads that file runs. The spec above is about
  markdown and does not reach this half, so `npm run chain -- --dry` is what answers it.
- **Sizing an optimisation from a duration.** Three errors, and `npm run chain -- --dry --all` prints the
  answer to the first two. A step **off** the critical path contributes nothing, because the chain admits
  steps in parallel: `test:unit:pack` is the worked warning — **89% setup overhead**, the most alarming
  ratio in the repo, off the path, so halving it buys zero. A step **on** it is capped by the second-longest
  route, so a long step on a dense graph is worth little — `test:packaged-authoring:author` is 95s of a 118s
  path and buys 19s, because another route sits at 99s. Three proposals in one day were sized by reading a
  duration and all three were bounded by a path nobody had computed. And in the other direction, moving a
  step off the path need not shorten the run, because a cold chain is core-bound; what it shortens is
  whatever was waiting behind it. **Read the path and the saving before measuring a ratio.**
- **Running `npm run build:runtime` to test a change no build output depends on.** The renderer and API build from
  source; a CLI or SDK change does not need them rebuilt to be tested.
- **Running an E2E suite to find a bug you have a stack trace for.** Build once with `sourcemap: true`,
  decode the mapping, read the source. Do that before you grep, not after.
- **Re-running the full chain after a fix to a thing the chain already covered.** If the CLI suite caught
  it, the CLI suite proves the fix.
- **Reading the source twice to explain a bug the running app would show you.** One instrumented E2E run is
  decisive where two carefully argued explanations were wrong, and the run you already did wrote the app's
  output to `tests/results/app-<workerIndex>.log`. `tests/e2e/CLAUDE.md` has the method.
- **Reading a chain step's `cached` as "the thing it guarantees is true".** It means only that the step's
  declared inputs have not moved. `packages:ensure` guarantees something its own fingerprint cannot see, so
  it carries a `neverCachedBecause`; the three pool steps keep two layers on purpose, because a pool step's
  inputs are the union of its projects' and so cannot disagree.
- **Running suites concurrently *before the packages are built*.** Two suites that both find a stale package
  race each other's build and fail about the race rather than the code. Run `npm run packages:ensure` once
  first and every later call is a stat and a return.

### Rules that pay for themselves: the evidence

- **Measure before you optimise, and before you accept someone else's measurement.** Two proposals here were
  rejected by one command each, both having been argued for at length first.
- **Measure the build that ships, not source run through a dev loader.** On 2026-10-23 a read through the EARS
  query builder (`query.ids(id).pickOne([f])`) measured 7.7µs under `tsx` against 49ns for `getAttr`, and an
  optimisation was planned to close the gap. A CPU profile put 84% of the time in esbuild's `__name` helper:
  `tsx` compiles with `keepNames`, so every closure a query builder creates gets a `defineProperty` on each
  query. The published `dist` (tsc) and the app's API bundle (tsup) carry none, and the same read there is
  321ns — the planned work was sized 24x too large and was dropped. The script was the same both times; only
  the import changed, from `src/index.ts` to `dist/index.js`.
- **Attribute a concurrent pipeline's cost with a CPU profile, not by timing its stages.** Wall clock
  summed per stage double-counts everything that overlaps, and the result reads as a table with a plausible
  winner rather than as an error: the pack frontend bundle's surface hooks totalled 120s inside an 11.5s
  build, and the stage that table blamed held a twentieth of the cost. `node --cpu-prof` with self time per
  package is the instrument, and two profiles subtracted isolate one phase.
- **A mutation check is worth more than a re-run.** Breaking the thing on purpose and watching the right
  test fail proves more than running the whole suite again.
- **But a mutation check does not redeem a test that mirrors the code.** A case asserting the
  implementation's shape — send X, expect the single line X's handler contains — fails when that line is
  edited, so the mutation fires and proves nothing: it fired because the test restates the line, not because
  behaviour moved. Ask instead whether the code could be **correct but different**; a case that every
  behaviour-preserving rewrite fails encodes the code, and its failure says no more than the diff.
  **A pure re-route needs no new spec** — the typecheck holds the wiring — and *not* finding a behavioural
  claim is the signal to stop rather than to manufacture one. Reaching for one anyway produces this and its
  sibling, a `toContain` over source text, which is a lint rule in a spec's clothing: that belongs in
  `check:specifiers`, this repo's home for call-site rules, or nowhere.
- **A check that reports nothing may have looked at nothing**, and a green run cannot tell you which. Derive
  the subject from the declaration that defines it, and assert it is not empty — in that order, because the
  first is the half that keeps failing. Where the input is data, **mutate it in the test**: drop the thing
  under test from a copy and assert the answer flips.
- **A result that is partial says so, and there are four shapes — copy one rather than invent a fifth.**
  **Refuse** where the evidence is missing (`packagesBuiltOrRefuse`); **a distinct exit code** where "nothing
  covered this" and "everything passed" are different answers (`npm run spec`'s 3); **a named bucket beside
  the total** where only part of the input is anyone's to fix (`pricedSpecs`' `unpriced`); **a clause on the
  success line** where one claim in the sentence did not hold (the chain's `(N of M cached)`). What none of
  them is: silent.
- **A check that cannot fail today is a gate or an assertion, and they want opposite things.** A gate's
  subject is input, so it needs a firing case. An assertion's subject is the program's own construction, so
  being unreachable is the point — what it needs instead is a comment naming the *edit* that would make it
  fire, because that edit is what you mutate to watch it.
- **A list and its type are one declaration.** Write the list and derive the type from it
  (`const XS = [...] as const; type X = (typeof XS)[number]`), or the other way round — never both by hand.
  Four pairs here were written twice and each had a different failure.
- **A stamp directory has one writer, and a lock beside the stamps is what makes that true.** Two writers
  make a cached result mean "some run with these inputs passed" rather than "this tree passed", and nothing
  downstream can tell. `holdExclusiveLock` (`@apackdev/host/exclusive-lock`) is the mechanism for all of them —
  `holdChainLock` (`scripts/lib/chain-lock.ts`) is the worked example, and the lock file must not end in
  `.json` or `pruneStamps` deletes a live run's. Two of the four are guarded;
  [`archive/references/pipeline-lessons.md`](pipeline-lessons.md) names the other two and what the fix is.
- **A cache needs a key that cannot go stale, or a scope in which it cannot — and a reset hatch is neither.**
  Content-key where the input is a file (path, mtime **and** size), scope where it is a tree. If you reach
  for a hatch anyway, give it a case that fails when it is forgotten.
- **A comment is for whoever opens the file cold, not for whoever reads the diff.** What changed, how many
  copies there used to be, what you measured — that is commit-message material. The test: will this sentence
  still be true, and worth reading, a year from now, to someone who never saw the change?
  **No comment reads as a changelog, and this governs a guide's prose as much as a `//` comment.** Write the
  state of the thing, never its edit history: `it was X until <date>`, `renamed from`, `previously called`,
  `this used to be` and `we changed this to` do not belong in the tree. Keep the lesson and drop the history
  that carried it — a trap is stated as a trap (`two clauses keeping it equal to the inputs cannot fail`), not
  as a story about when it was removed. The git log is where the edit lives, and it is one command away.
- **A comment justifying something by a past failure must name what prevents that failure now.** If it is
  this code, say how it fails; if it is something else, name the file; if it is nothing, say nothing checks
  it. "X is the whole point" cannot be checked; "Y fails when Z" can.
- **Keep readings; do not decide with them.** A record that informs a *column* needs no hysteresis, no band,
  no tie rule, no machine field and no idle floor, because there is no threshold for a reading to be wrong
  about — `spec-durations.ts`' ten-run window is that shape, uncommitted and machine-local, and it costs
  nothing to be right. The moment a reading is compared against an edge it needs every one of those, and the
  edge is usually the thing that could have been declared instead: two subsystems here grew the full
  apparatus and both were deleted, their decisions replaced by a filename and a hand-written number.
  **Before building one, ask what the reading decides and whether that could simply be stated.**
- **Load inflates a duration and cannot deflate it**, so the two directions are not equally safe to act on.
  Measured 1.27x median, 2.03x p90, 3.29x at worst: a busy box can hide a stale claim and cannot invent one.
  So *measured faster than declared* is a fact about the code and is safe to gate anywhere — the `@slow:`
  marker gate is the worked example — while *measured slower* may be a fact about the machine and is only
  ever a report. Gating that direction is what cost the deleted subsystem its window, its band and its two
  idle floors. **The asymmetry holds for a thing's own time and not for a bar derived from it**, which is
  the correction [`archive/references/recorded-files.md`](recorded-files.md) records: a
  quantile moves with the load that moves the files under it.

[`docs/archive/references/pipeline-lessons.md`](pipeline-lessons.md) has what each of these cost to
learn — the measurements, what was tried first, and the commit that closed it.

### What a test may read

**A step says what it reads, and whether it needs the built app follows from that.** `needsApp`
(`scripts/lib/chain-steps.ts`) is derived: a step needs the app when it declares one of `build:runtime`'s
outputs among its inputs. So there is no second record to disagree with the graph, and the ordering comes
from those same two fields whatever anyone writes. Declaring it instead would need two `check:tiers` clauses
to keep it equal to the inputs, and clauses like that cannot fail — which is what redundancy looks like
rather than what protection looks like.

The rule it holds: a step that does not need the app must not reach one, because the moment it does it has
to run after `build:runtime`, its real inputs become the whole repo, and it can no longer be cached or
reordered. Four attempts at a cheaper chain each failed on exactly that, because nothing recorded it. A
check that genuinely needs the app declares it — that is an answer, not a failure, and the fix is never to
delete the check.

**`npm run check:tiers` asks the one question the inputs cannot answer.** It follows each step's npm
script as text and looks for the ways this repo launches the app, because a step can launch it while
declaring none of its outputs. Being a scan is the safe direction for that half: a wrong scan reports a
false finding, where a wrong cache key is silent. It goes when the action graph can answer "does this
transitively depend on `build:runtime`" (`docs/archive/plans/one-action-cache.md`, item 18; the follow-up is
`docs/archive/plans/observed-inputs.md`, now closed).

**`build:runtime` does not satisfy it.** It writes the app rather than reading one, and the rule is about
reading. That distinction is why this replaced a three-valued `tier`, which lumped the producer in
with its consumers: `docs/archive/plans/tier-split.md` has the evidence, and the budget half of `tier` is now
`SIZE_MS` in `scripts/lib/unit-suites.ts`.

`test:external-pack` is split at that boundary: `:contract` validates, builds and typechecks each fixture
pack and runs its harness specs with no app. `:fork` builds and archives the shipped-pack fork as a separate
producer. `:app` consumes both outputs and runs Playwright after `build:runtime`. Separate scripts keep
app launches out of the producers: the scan reads scripts as text, including branches never taken.

`test:packaged-authoring` is split the same way: `:author` authors, builds, tests and releases a pack with
no app, `:app` runs that archive against one. They hand over a work dir through `tests/authoring-handoff`,
the author half's declared output and the app half's input, so the edge derives like any other — and that
dir stays **outside** the checkout, or a pack built inside it resolves `@apackdev/*` by walking up to the
workspace `node_modules`, which is the thing the check exists to disprove.
[`goal-test-tiers.md`](../goals/goal-test-tiers.md) has the rest, and what each of the four attempts at a
cheaper chain measured — written when the declaration was a tier.

### Figures in prose

**A figure earns its place by sizing a choice, and one a record owns is named rather than copied.** Two
different failures: a figure that informs no decision is weight, and a copy of something `chain-steps.ts`
already knows drifts with nothing to catch it. "One spec file is 1-3s against the 38.6s a
one-package edit costs the chain" earns its place; a count the `--list` flag derives does not.
**Name the floor, never quote it.** A sentence like that one, written against "the chain's 27s floor" and
then copied to two other places, goes on arguing from a number thirty times too large the moment per-step
caching moves the floor to 0.9s — and no check holds any of the three. The figure that earns its place is the
one sizing the choice in front of you; the one a record owns gets named so there is a single thing to
re-measure.

**A third failure, which is neither of those: a measurement a decision cites.** `@app/publish-checks`' guide
kept a spec in the fast half *"on the strength of its five `npm pack --dry-run` calls costing ~1.5s"*, and
it measured 3.74s — 2.5x out, with a placement decision resting on it. Such a figure cannot be derived and
cannot be dropped, so it takes the third option, which is already this repo's convention for a measurement:
**it carries its date and its conditions.** `npm run measure`'s output is the format — *"a number without
its conditions is an assertion; with them it is a citation"* — and a number quoted in prose is under the
same rule as one printed by a command.

**Nothing holds prose to code, and that is deliberate**: a spec pinning a guide's figure forces a doc edit
for every code edit. Point at the record or the command that derives the figure instead. Three drifts were found by review on 2026-10-06 (a spec count 9 short, the
~1.5s above, and a "closest left" another step had overtaken); review is what catches the third kind, because
a causal claim is an argument and no check holds an argument.

**Script names say whether they write.** Three shapes, and the second word tells them apart:

- `<name>:check` / `<name>:update` — something recorded that can go stale, and the two halves
  carry the *same* noun: `api:*`, `facade:*`, `schema:*`, `exports:*`, `content-parity:*`. `check` and
  `update` are reserved as suffixes, so a name ending in `update` is the only kind that rewrites a file
  you would commit.
- `<action>:<scope>` — an action over part of the repo: `typecheck:renderer`, `test:unit`, `build:api`. The
  second word is a place, and nothing here writes a tracked file.
- `<action>:<variant>` — a variant of one action: `build:dev`, `test:watch`, `lint:fix`.

The point is that the name is derivable: knowing a recorded file tells you both its scripts, without a grep.
Put a new recorded file in the first shape and give it both halves, even when one half is trivial —
a recorded file with only an update is one nothing will notice has gone stale.

### E2E: what earns a place in the suite

**Driving the app now has its own place: `drive/`, run with `npm run dev:drive` (a pack author gets
`npm run dev:drive --`).** That is where an agent debugs and develops against the app — open what you just built,
click through it, read the state back, screenshot it. Scripts there import `drive` rather than `test`,
nothing collects them, and nothing gates on them. **One question needs no script at all**: `npm run dev:eval`
and its neighbours ask the app `npm run dev` is holding, over its debug port — one JSON object on stdout,
0.9s. With no app running they exit 3 and say so; `--spawn` starts one and keeps it for the next question.
`docs/public-facing/cli.md` has the verbs.

**One directory here is a gate: `tests/e2e/smoke/`**, as its own chain step (`test:smoke`, 6s). Its four
cases are the ones every other check silently assumes — the app launches without crashing, reaches `connected`, has
its surfaces, and runs in its own data dir. Taking the suite off the chain took that with it, which is the
one thing worth paying for.

**The rest is not a regression suite, and is not in `npm run chain`.** It was built to watch the app while
writing a feature, and it became a chain step while the reasoning around it drifted into caching policy —
a question you only ask of a gate. What earns a place here is a test that asserts something a future
change could break **and** needs the real process boundary; everything else is either a harness test or a
driving script (`drive/`).

**One spec here has earned it, and what it caught is the argument for that rule rather than against the
gate.** `app-integration/dev-reload.spec.ts` found that a rebuilt pack the app ships reloaded the copy
installed *before* the edit — so every pack edit in dev appeared not to take effect, and `POST /dev/reload`
answered 200. The chain, `test:smoke` and every unit suite passed straight through it, because the fact it
rests on is a built pack in a real data dir reloaded over a real port, which no harness has. That is
exactly the two-part test above, met; the ones that do not meet it are still the reason this is not a gate.
**So the question to ask of a spec here is which of the two halves it has**, and `npm run chain -- --e2e`
is how you run the suite when a change is in that territory.
`npm run chain -- --e2e` runs it with the chain when you want it — ordered after `test:smoke`, since both
drive Playwright at `tests/results` — and `npm run test:e2e` runs it alone.
