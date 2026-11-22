> **Done and closed.** Implemented by [`goal-one-action-cache.md`](../goals/goal-one-action-cache.md),
> whose Outcome records what landed and the three places this plan was wrong: a dep file is sound as a
> check and not as a key, retiring the text scan cannot be paired with the derived edges, and item 7
> (Gradle's rule) has no subject in a cache that decides whether to run rather than restoring outputs.
> The follow-up is [`observed-inputs.md`](observed-inputs.md), itself now done. The text below is the plan as
> written.

# One action cache

## Status (2026-10-01)

| | |
|---|---|
| landed | item 0 (`980c6d854`), item 24 (`94b33f22d`), symptom 3 (`c5c724b9b`), the `cache: false` collapse (`4a10594ae`) |
| decided | all five decisions, all four measurements, both unverified claims — see the last three sections |
| next, unblocked | the `tier` split (`tier-split.md`); three of its four pieces need nothing from this list |
| open | nothing to decide; what remains is building items 2-6 of the order below |
| executed by | [`goal-one-action-cache.md`](../goals/goal-one-action-cache.md), now archived — items 0, 17, 18 and the `tier` split landed; its Outcome records what was corrected, including why item 7 has no subject here |

## Problem

One concept — **a chain step** — does three jobs that want different granularities: it is the unit of
caching, the unit of execution, and the unit of ordering. Nearly every chain defect this repo has found is
downstream of that, and each has so far been fixed where it surfaced rather than where it came from.

Four symptoms, all the same cause:

- **Two caches over one body of work.** The chain caches per step; `test-unit-pool.ts` caches per suite.
  `chain-inputs.spec.ts` carries a case — *"a pool step and its projects cache on the same inputs"* — whose
  only job is to police two caches agreeing. The root `CLAUDE.md` states the rule being broken, about
  `packages:ensure`: *"Two caches over one body of work is the bug, not the cost."*
- **`typecheck` is 18 heterogeneous legs under one fingerprint.** 32.6s of declared CPU, no per-leg
  caching anywhere in `scripts/typecheck.ts`. A change to `@apackdev/ears` runs `vue-tsc` over the renderer.
- **The integration half has no per-suite cache**, because it is not pooled. Pooling was an *execution*
  decision (process economy, `docs/archive/plans/test-unit-scheduling.md`) and caching came along as a
  passenger. `test:integration` is a raw `vitest run` whose step inputs are `workspace(dir)`, not
  `suiteInputs(dir)` — which is an under-declaration rather than a naming detail. Measured 2026-10-01, the
  files `suiteInputs` reaches that the step does not declare: 386 for `@apackdev/cli`, 1944 for
  `@app/internal-repo-checks`, 275 for `@app/internal-publish-checks`. The two pool steps *derive* their inputs
  (`[...new Set(suites.flatMap(suiteInputs))]`); `test:integration` is a literal entry in the step table,
  which is the whole reason it drifted.
- **Scheduling changes cache identity.** A spec's measured cost picks its half, the half picks the step,
  and the step carries the inputs — so making a spec slower can change what it watches. This is not
  theoretical: `suite-reads.spec.ts` measured 2.5s against a 2.5s edge, and the half it would have been
  moved into declares no repo-wide tree. The gate written to watch for this was nearly relocated into
  blindness by its own runtime.

And four escape hatches that exist because the model has no way to say what an action produces:
`neverCachedBecause`, `forceArgs`, `excludes`, and `exclusive` — the last of which is a hand-set mutex
standing in for an output overlap nobody declared.

### One symptom was fixed ahead of the rest, and what it left behind

Symptom 3 is closed (`c5c724b9b`). `test:integration` built its inputs by hand where the pool steps
derived theirs; both now go through one `inputsForSuites`, and the undeclared count went from 386 / 1944 /
275 files to zero.

Two things it left that do generalise.

**Nothing guards it.** Putting the old shape back and running everything — 642 fast tests and 290
integration tests — passes. `suite-reads.spec.ts` compares each suite's specs against `suiteInputs`, the
key the *pool* uses; for the unit half the step's key is derived from that same function so checking one
checks both, and for the integration half the step's key was written separately with nothing comparing the
two. The check verified the inner layer while the outer one was wrong. That is item 24, built in
`94b33f22d`: restoring the old shape now fails one case and names the files.

**It was not a correctness hole only by accident.** `check:specifiers` is also a `typecheck` leg, so the
import rules fired on every chain run while the specs that test those rules sat behind a cached step. A
second check covering the same ground is not a design; it is the reason a real gap stayed invisible.

## Prior art, and the names to use

This repo has independently built most of the local half of a content-addressed build system, and built it
well — but under its own names, which is why none of its answers can be looked up and why the gaps are
hard to see. **The first thing this work should do is adopt the standard vocabulary**, because the names
carry semantics that encode failures other people already hit. Writing a second bespoke system with new
nouns would be motion, not progress.

| here | standard name | prior art |
|---|---|---|
| chain step / `BuildUnit` | **action** | Bazel, Buck2, Gradle (task), Nx, Turborepo, Ninja (edge) |
| `fingerprintUnit` | **action key** | Bazel: inputs + command line + environment — the same triple |
| the stamp store | **action cache** | Bazel, Gradle build cache, Nx computation cache |
| the unit pool | **persistent workers** | Bazel workers, Gradle daemons |
| *(absent)* | **dep file** | Buck2 `dep_files`, Ninja `depfile`, `gcc -MD`, Gradle incremental compile |
| *(absent)* | **hermeticity** | Bazel/Buck2 sandboxing: an undeclared read fails rather than caching wrong |
| `tier`, the constraint half | **tag + dependency constraint** | Nx `tags`/`depConstraints`, Bazel `visibility`, ArchUnit, dependency-cruiser |
| `tier`, the timeout half | **test size** | Bazel's test `size`, a bucket whose purpose is a default timeout |
| `inputs` / `outputs` | *already standard* | the shared vocabulary of Bazel, Gradle, Nx and Turborepo |
| `excludes` | *already standard* | a negative input pattern: Bazel `glob(exclude=)`, Gradle `exclude(…)`, Nx/Turborepo `!` in `inputs` |
| `exclusive` | *standard name, wrong shape here* | Bazel's test tag `exclusive` — but Bazel derives most conflict safety from its output graph, which is where this one belongs (item 4) |
| `neverCachedBecause` | *already standard* | Gradle `@DisableCachingByDefault(because = …)`, `@UntrackedTask(because = …)` |
| `optInBecause` | *better than standard* | Bazel's `manual` tag, which carries no reason; this one requires a sentence and has a case enforcing it |
| `needs` | **`dependsOn`** | the one CI word in a build-system table — see below |

**Tiers are not bespoke, and the repo already implements the standard construct — twice.**
`findUpwardImports(LAYERS)` (`{ name, dir, allowed, forbidden }`) enforces the package layering over the
real import graph, AST-based. `check-test-tiers.ts` enforces the tier rule over steps by scanning their
scripts as text, and says so in its own comment. Same construct, two mechanisms, and only the second is
weak — not because tags are the wrong model but because there is no action graph to query, so the checker
has nothing to resolve against. One thing *not* to coalesce toward: the JS test pyramid
(unit/integration/e2e) is descriptive naming enforced by nothing, where these tiers are an enforced
dependency constraint. Taking the standard name there would lose the standard mechanism.

**Most of the vocabulary is already right, which is the thing to know before renaming anything.** Six of
the fields above are the industry terms already, one of them (`optInBecause`) is a strict improvement on
the standard, and `tier` is the standard construct — though under a name and an arity that do not survive
scrutiny, which `tier-split.md` works out. "Adopt the standard vocabulary" therefore means one rename, not
a sweep.

**Where the standard is not worth adopting, and why that is not special pleading.** Bazel keeps
`exclusive`, `manual` and `no-cache` in one `tags` list, which this repo keeps as named fields, two of them
carrying reasons Bazel's cannot. That looks like declining the standard; it is declining an *encoding*
whose reason does not apply here — Bazel's rule attributes are closed, so `tags` is its extension point,
and a TypeScript interface has no such constraint. Same principle as the Turborepo and Nx entry under
out-of-scope: borrow the model and the names, not the tool. `tier-split.md` has the full argument and the
condition under which a closed `ActionTag` union becomes worth it.

**The one rename is `needs` → `dependsOn`.** `needs` is CI vocabulary (GitHub Actions, GitLab CI);
`dependsOn` is build-system vocabulary (Gradle, Nx, Turborepo; Bazel spells it `deps`). Every other field
in the step table is build-system-shaped and this one reads as a pipeline.

**But decision 4 makes it less of a rename than it looks.** The field is derived, so its 12 declarations
are *deleted* rather than renamed; what is renamed is the 9 reads
(`chain-schedule.ts:72`, `chain-steps.ts:158/174/185`, `step-timing.ts:22`, four in specs) and two error
strings, which then point at a derived `dependsOn`. The naming argument and the derivation agree on the
answer and should not be counted twice as work.

What the repo has and lacks, against that model:

| property | here |
|---|---|
| action graph with declared dependencies | yes — steps and `needs` |
| content-addressed input hashing | yes — `fingerprintUnit` |
| local action cache | yes — stamps |
| persistent workers | yes — the pool |
| per-action output declaration | partial — `outputs` exists, means "exclude from my own key" |
| dep files | **no** |
| hermeticity, or any check in its place | **no** — and all three undeclared-input defects behind this doc live here |
| remote cache | no, deliberately |

## Current state (2026-10-01, at `8431bd850` on `master`)

| | where | shape |
|---|---|---|
| chain steps | `scripts/lib/chain-steps.ts` | 13, hand-declared `inputs`/`outputs`/`needs`/`tier` |
| step fingerprint | `fingerprintUnit`, `@apackdev/host/build/packages-built` | sha256 over declared inputs minus outputs/excludes |
| per-suite cache | `poolUnitFor`, `scripts/lib/unit-pool.ts:35` | `suiteInputs(suite)`, **keyed by directory** — "a suite has one stamp whichever pool runs it" |
| typecheck legs | `scripts/lib/typecheck-legs.ts` | 18 legs, **no cache**, and its own lane count set against the chain's |
| integration half | `package.json` | `vitest run --config …`, **no per-suite stamps** — the inputs are `inputsForSuites` now, the inner cache is not |
| suite inputs | `suiteInputs`, `chain-steps.ts` | ROOT + runner + workspace parts + `workspaceDeps` + 3 flags; every suite-running step's key is the union (`inputsForSuites`) |
| per-file digests | `freshnessSweep`, `packages-built.ts` | listings, buffers and digests memoised, and the chain's dispatch decisions share one sweep — the 6.64x overlap is read and hashed once per run rather than once per step |

The critical path is 109-119s and is `packages:ensure → compile → build:app → test:packaged-authoring`,
which no part of this list touches — so none of it moves the cold run, and all of it moves the warm one.

## The parts list

### A. The action model

0. **One digest per file, memoised across actions — landed, `980c6d854`.** `freshnessSweep` shared
   directory listings and file buffers between units and re-hashed the bytes. Measured over the 13 steps
   before it: a 6.64x overlap, 283.8 MB hashed against 57.3 MB distinct, 680ms against 108ms, inside a
   680ms warm sweep. An action's key is now a hash over a list of file-hashes — Bazel's and Buck2's Merkle
   shape, and the thing that makes action count stop mattering.

   **It paid nothing until the dispatch path shared a sweep**, which is worth knowing before trusting a
   measurement of a primitive. The memo lives inside `freshnessSweep`, and the chain's dispatch decisions
   read per step — so `--dry` and the post-run report got the 680ms-to-108ms, and a warm run, which is the
   number anyone feels, got none of it. Measured 2026-10-01 at 28 steps: 1715ms read per step against 189ms
   shared, where parsing all 28 stamps is 3ms. Sharing the dispatch reads (`115582524`) is what collected
   it — a warm chain went 2.5s to **0.9s**, under the 1.5s it cost at 13 steps.
1. **An action.** One (tool, scope) pair: `tsc -p packages/apack-host`, `vitest --project @apackdev/ears`,
   `oxlint .`, `apack build @app/default-setup`. **47 where there are 13 steps**, counted rather than
   estimated — see the last section.

   **It replaces two types, not one.** `BuildUnit` is `{ inputs, excludes, outputs }` and `ChainStep` is
   those three plus seven more, with `unitFor(step)` converting one to the other on every call — the
   fingerprint protocol's shape and the scheduler's shape, kept apart by a function. One concept, so one
   type, and the conversion goes. That is a merge rather than a rename, which is why it is sequenced
   behind the action registry rather than available now.
2. **An action registry derived from the tree**, not listed: one action per tsconfig, per vitest project,
   per build unit. A new package gets its actions by existing, the way `PACKAGE_DIRS` already works from
   the root `workspaces` field.
3. **An action key** = hash of (input contents, command line, the environment that affects the result) —
   Bazel's definition, unchanged. Command identity is handled today by the bluntest available means:
   `ROOT` (`chain-steps.ts`) puts `package.json` in *every* step's inputs, so editing any npm script
   invalidates the whole chain, and `typecheck` declares `scripts/`, which is where its legs' flags live.
   Correct, and the reason a one-word change to an unrelated script costs a full run. Hashing the command
   an action actually runs is what lets `package.json` come *out* of the inputs.
4. **Every action declares outputs, verification included.** Bazel caches a test by treating its result as
   an artifact: the action writes a status, and caching the test is caching that output like any other.
   Gradle is the same and more concrete — its `Test` task is cacheable *because* it declares
   `binaryResultsDirectory` and its reports as outputs. That removes the need for a "producing vs
   verifying" distinction — I had proposed one, and the standard model does not need it. It also gives
   `neverCachedBecause` somewhere to go: an action whose result cannot be represented as an output is
   simply not cacheable, which is item 7.

   **This is a prerequisite, not a nicety, and the measurement says so.** Counted 2026-10-01: 6 of 13 steps
   declare any output at all. The seven that declare none are `packages:check`, `typecheck`,
   `test:unit:host`, `test:unit:pack`, `test:integration`, `test:external-pack:app` and
   `test:packaged-authoring` — which includes every step this whole programme is about. Nothing in the repo
   writes a machine-readable result today: no `outputFile` or `reporters` in any vitest or playwright
   config. The one step that does produce an artifact already declares it (`test`, `outputs:
   ['tests/results']`), so the shape exists; what is missing is a result artifact for the verification
   steps, which is cheap (`--reporter=junit --outputFile`) but is real work.

   **It buys concurrency safety too, which is the half I first missed.** Two actions whose outputs overlap
   must not run concurrently — one rule, needing no declaration beyond honest `outputs`. In Bazel it is an
   *error* for two actions to produce the same output, so concurrency safety is a property of the output
   graph rather than a flag anyone sets; Gradle does the weaker version, detecting overlapping outputs and
   declining to cache them. Here it dissolves `exclusive` and the `mustRunAfter` that decision 4 nearly
   gained — see that decision, and item 15.

   **`packages:check` is the worked example of the gap.** It declares zero outputs while `attw --pack`
   writes a tarball inside the tree it checks and `stagePublishTree` removes and recreates that tree. That
   undeclared write is why it carries `exclusive` by hand; declare it and the conflict with
   `packages:ensure`, which writes `packages/*/publish`, derives.

### B. Where inputs come from

5. **Dep files**, where the tool reports what it read. Both sources already exist here: `.tsbuildinfo`
   (every workspace tsconfig writes one; `fileNames` is the read set) and `--listFiles` (already relied on
   by `tests/scripts/test-packaged-authoring.sh:332`); `reachableFrom` (`scripts/lib/module-graph.ts:61`)
   for the module graph.
6. **Derived from the tree** — workspace layout, manifests (`workspaceDeps` reads both dependency maps).
7. **Undeclared means uncacheable, not wrong.** This is Gradle's rule and it is strictly better than the
   "safe default" I first proposed: an action that cannot fully declare its inputs and outputs is simply
   not cached. Under-declaration then costs speed, never correctness. **This repo's failure mode — declare
   partially, cache anyway, be silently wrong — is the one Gradle designed out of existence**, and the
   three undeclared-input defects found while writing this doc were exactly it. It is the single most valuable item on this list **and it
   cannot land before item 4**: applied to the table as it stands, it uncaches seven of thirteen steps,
   `typecheck`, both pools and `test:integration` among them, and takes the warm chain from 0.9s to running
   all of them. Sections A and B present these as independent entries and they are one sequenced change —
   4 then 7, and 7 is worth nothing on its own.
8. **Declared**, for actions that can meet item 7 but whose reads no tool reports: runtime reads (the
   git-querying guards, `SUITE_READS.repo`), shell steps, `oxlint`, anything spawning a non-node tool.
9. **A dep file is a proxy, in this repo's own taxonomy** (root `CLAUDE.md`, "Three kinds of recorded
   artifact") — it records what was read last time and can go stale from an input nobody listed. It needs
   the self-check `api:stamp` has, not just a comparison. This is also the known unsoundness of dep files
   generally, which is why Bazel pairs them with sandboxing and Gradle pairs them with item 7.
10. **Verification that declarations cover reads**, generalised from `suite-reads.spec.ts`. This is the
    affordable stand-in for hermeticity, and should be described as that rather than as a check of its own.

### C. The action cache

11. **One store, one format, one entry per action.** Today: chain stamps, pool stamps, package-build
    stamps, `.tsbuildinfo`, `.inputs-hash`, `spec-cost.json`.
12. **The key must not contain the execution plan.** No batch, lane, pool, half or step in it. Symptom 4
    is exactly this rule being broken. Symptom 3 was the same shape and has been fixed another way — by
    one function feeding both layers — which is a repair rather than the rule, and the rule is what stops
    the next one.
13. **A key that distinguishes two runs of one scope.** The pool key is the directory, which is correct
    while a suite runs in exactly one pool and wrong the moment it has two halves. Becomes (scope, action).

### D. Execution, separated

14. **Workers.** Group stale actions into as few processes as the tools allow. This is what the pool
    already does well and should keep doing, under the name the rest of the industry uses for it.
15. **Scheduling policy** — lanes, worker caps, and ordering preferences such as running `test:smoke`
    before `test` to fail fast. Policy, not identity.

    **`exclusive` is not in this list, and that is the correction.** It reads as policy and it is a
    derived fact: `chain-schedule.ts:73` makes it a *global* mutex, so an exclusive step blocks everything
    rather than what it conflicts with, and neither of its two users states its real conflict —
    `packages:check` through an undeclared output (item 4), `packages:ensure` as a proxy for "nothing may
    build packages concurrently", which the derived edges already enforce because seven steps read its
    outputs. Both become output overlap, checked rather than asserted. What stays policy is the
    *direction*: a mutex does not care which runs first, and failing fast does.
16. **A worker reports what it ran**, so only those actions are stamped. The pool already does this and the
    reason is recorded: a `--project` filter matching nothing must not stamp a pass.

### E. The action graph

17. **Edges derived from artifacts** — an action reading `packages/*/dist` depends on the action writing
    it. `needs` is hand-declared beside `inputs` that already imply it, and `chain-inputs` has yet another
    case policing their agreement. **Measured: outputs-into-inputs reproduces 12 of the 13 declared edges,
    and outputs-into-outputs reproduces the thirteenth** — `test` and `test:smoke` both write
    `tests/results`, which is a mutex rather than a dependency. So the whole table derives from two
    questions over the same two fields, and no hand-declared *edge* survives (decision 4). The constraint
    in item 18 is a different subject and stays declared.
18. **The app constraint stays declared; the edges it is checked against become derived.** An earlier
    draft had it *derived* — an action needs the app iff it reads app outputs — and that is wrong, because
    it deletes the check. A declared constraint is a statement of intent: *this action must not need the
    app*. Derive it and an action that gains an app dependency is silently reclassified rather than
    refused, which is exactly the drift the four failed cheap-chain attempts recorded. `APP_ENTRY` is the
    second proof: `packages/dev-mode.js` and `packages/entry-point.mjs` are *source* sitting beside the
    built-app constant, so a derivation reaching for those constants misclassifies three steps.

    The shape to copy is `LAYERS`, where the layer is declared and the import graph is derived: keep the
    constraint on the action, and replace `check-test-tiers.ts`'s text scan with a query over the derived
    edges from item 17. That keeps the gate and removes the only weak part of it.

    **The field carrying it is the wrong shape, which is a separate target.** `tier` answers two questions
    — this constraint and a test's timeout budget — and no consumer distinguishes all three of its values.
    `docs/plans/tier-split.md` has the evidence and the target: `needsApp` on the action, `size` on the
    test target, and `tier` gone. Three of its four pieces need nothing from this list; only retiring the
    text scan waits on item 17.
19. **Cycle and ordering validation**, which the graph gets for free and the current table checks by hand.

### F. Observability

20. **Per-action "why did this run"** — the four stamp states `unit-pool.ts` already distinguishes.
21. **The freshness sweep**, per action rather than per step.
22. **Cost records per action.** `spec-cost.json` generalises; its hysteresis, drift band and contention
    refusal are hard-won and must survive (`scripts/lib/spec-cost.ts`). **It is not the only sample.**
    `ChainStep.seconds` is the other — a hand-recorded measurement with its own asymmetric band (reported
    past double on every run, under half only at `--all`), which is hysteresis built a second time. One of
    the two lives in a JSON file with a `:check`/`:update` pair and the other in the step table with
    neither. CLAUDE.md's "`spec-cost.json` is the only one" is scoped to recorded-artifact *files* and is
    not wrong, but the parallel is the point.

    **Settled: share the band logic, not the storage.** `seconds` stays in the step table. It has 13
    entries read by whoever opens the step they describe, against `spec-cost.json`'s 382 read only by a
    tool, and its check already runs on every chain run — which is stronger than a `:check` script someone
    has to invoke, not weaker. What the two should share is the hysteresis, the drift band and the
    contention refusal, which live in `spec-cost.ts` and are the part that was hard to get right. **Revisit
    at ~47 actions**: a hand-recorded number per action stops being something a reader scans, and at that
    point it is a file like the other one.
23. **Near-edge reporting**, which only stays meaningful once cost stops deciding coverage.

### G. Guards the new model needs

24. Every action's declared inputs cover what it reads (generalise `suite-reads`) — item 10. **The outer
    layer is done** (`94b33f22d`): `suite-reads` compared a suite's specs against the *pool's* key only, so
    a step whose inputs were written rather than derived drifted unseen, which is how symptom 3 survived
    the check written to find that defect class. It now also asserts that the step running a suite declares
    what that suite reads. What remains of this item is the generalisation to every action, not just the
    suite-running ones.
25. No two caches over one body of work — assertable once there is one store.
26. An action's key is independent of its worker. Mutation: run the same action in two batches, keys match.
27. The dep-file proxy has a self-check (item 9).
28. An action that cannot declare its outputs is not cached (item 7) — the guard is that no action is both
    uncacheable and stamped.

## What already exists and must be reused, not rebuilt

| piece | where | why it matters |
|---|---|---|
| `fingerprintUnit` / `BuildUnit` | `@apackdev/host/build/packages-built` | the hashing, the exclusion rules, `STAMP_VERSION` |
| `poolUnitFor` + stamp states | `scripts/lib/unit-pool.ts` | per-scope caching already works; this is the model to generalise |
| `reachableFrom` | `scripts/lib/module-graph.ts:61` | AST-based on purpose — regexes invented 61 imports that do not exist |
| `workspaceDeps` / `PACKAGE_DIRS` | `scripts/lib/workspace-deps.ts`, `import-populations.ts` | derived populations, already refusing to be empty |
| `spec-cost`'s band machinery | `scripts/lib/spec-cost.ts` | hysteresis, `DRIFT_SHARE`, contention refusal, `CONTENTION_RATIO_MAX` |
| `chain-output` | `scripts/lib/chain-output.ts` | column composition and the stale-again report |
| the exception-list pattern | 25 instances, 23 guarded | how a declaration that cannot be derived is kept honest |

## Decisions, settled 2026-10-01

Each was computed where it could be. The measurements behind them are in the next section.

**1. An action is a tool invocation, so `typecheck` is eighteen — and not for caching.** Per-leg caching
was measured and is worth nothing for most edits: approximating each leg's inputs as its package plus its
transitive workspace deps, 7 of 11 single-package edits leave `typecheck:fe` stale, and at 6.2s it is both
the slowest leg and the most depended-on. The four that do not (cli, testing, default-setup, main) save
6-8s. The real reason is in `scripts/typecheck.ts:33` — *"How many legs run at once: half the cores,
**because the chain runs two other lanes beside this step**"* — a hardcoded compensation for a scheduler it
cannot observe, costing a measured 63.4s in-chain "because the other two lanes saturate the cores it was
not using". That is two schedulers with no shared budget, the problem `test-unit-scheduling.md` removed for
the unit suites and left here.

**2. One cache entry per action, after the per-file digest is memoised.** Measured over today's 13 steps:
24 618 file-slots over 3 706 distinct files, a **6.64x overlap**; 283.8 MB hashed where 57.3 MB is
distinct; 680ms to hash every slot against 108ms to hash each once, inside a `chain --dry` that takes
680ms. `freshnessSweep` already memoises directory listings and file *buffers* but not *digests*, so a
third of the warm chain is re-hashing bytes it has already hashed. **The cost driver is overlap, not action
count**: content-address per file and an action key becomes a hash over a list of file-hashes, which is
Bazel's and Buck2's Merkle shape. Then 47 actions cost about what 13 cost. This is item 0.

**3. No dep file means not cacheable, which is Gradle's rule unmodified.** A cold run is uncached
everywhere, and that describes a cold run rather than a cost. The case needing a guard is the *stale* dep
file, not the missing one — which is item 9, and this decision is why it is not optional.

**4. Every edge derives. Nothing hand-declared survives here.** Two questions over the same two fields:

- **outputs into inputs** — a consumer reading a producer's output. Honouring `excludes` and transitively
  reduced, this reproduces **12 of the 13** declared `needs` exactly.
- **outputs into outputs** — two actions writing the same path, which is a mutex. This reproduces the
  thirteenth: `test` declares `['build:app', 'test:smoke']` where only `build:app` is a data edge, and
  `test` and `test:smoke` both declare `tests/results`.

**An earlier version of this decision stopped after the first question** and concluded 12 of 13, keeping a
declared `mustRunAfter` for the remainder — Gradle's split, which looked like the right borrow. It was the
wrong answer to an unasked question. Bazel needs no such field because it makes two actions producing one
output an *error*: conflict safety is a property of the output graph, never a flag. So **`mustRunAfter` is
not added, and `exclusive` is removed** (item 15), both replaced by output overlap.

A mutex has no direction. Running `test:smoke` before `test` to fail fast is a scheduling preference and
belongs in policy (item 15), not in the graph.

This settles the `needs` -> `dependsOn` rename above: it happens, because the field stops being
hand-written.

**A caveat worth more than the result.** Two earlier attempts at that derivation were wrong — one ignored
`excludes`, one dropped a whole input because a descendant was excluded — and both produced plausible
answers (3 of 13, then 11 of 13). A derivation reproducing 3 and one reproducing 12 look identical from
outside. **So the migration keeps the declared table and asserts the derivation reproduces it before
deleting it**; that comparison is the only thing that caught either bug.

**5. Incremental, by strangler fig.** A parallel implementation that must agree with the old one is a third
cache during the migration, which is the defect class this list exists to remove. Incremental was the risky
option only while "does the new model reproduce the old one" was unanswered, and decision 4 answers it for
the hardest part. Each piece lands with the old declaration still present and a check asserting the new
derivation reproduces it, then the old declaration goes — so **at every commit the chain is one system, not
two**.

Order, by what unblocks what and what pays immediately:

1. ~~Per-file digest memoisation~~ — **done**, `980c6d854`
2. The `tier` split (`tier-split.md`) — independent of all of this, and the next thing to build
3. Derived `dependsOn` and derived mutexes, with the reproduction check; `exclusive` deleted
4. Dep files from `.tsbuildinfo`, with the proxy self-check
5. Typecheck as 18 actions under one scheduler
6. Outputs for verification actions (item 4), then Gradle's rule (item 7)

## Measured, 2026-10-01

All four are answered. Three structural changes proposed while writing this doc had measured to roughly
nothing, which is why these came before the decisions above rather than after.

- **Per-leg typecheck caching: worth nothing for most edits.** 7 of 11 single-package edits leave
  `typecheck:fe` stale, and it is the 6.2s critical leg. The other four save 6-8s. Decision 1.
- **Per-suite staleness in the integration half: the largest warm-chain win on this list.** `internal-repo-checks`
  declares `repo: true` and is stale on any source edit; `apack-cli` and `internal-publish-checks` are stale only
  within their own dependency closures, so the common case is **1 of 3 suites stale**. Measured:
  internal-repo-checks' integration half is **5.06s** against the pooled run's 48.2s. Inner per-suite caching takes
  the common case from 48s to about 5s, and the pool pattern already exists for the unit suites.
- **Action-key overhead at ~47 actions: not an action-count problem.** It is a 6.64x overlap problem that
  exists today, at 13. Decision 2.
- **What item 7 makes uncacheable: seven of thirteen steps**, including `typecheck`, both pools and
  `test:integration`. Hence items 4 and 7 are one sequenced change.

## Explicitly out of scope

- **Adopting Turborepo, Nx, Bazel or Buck2.** Turborepo/Nx would give items 1, 3 and 11 free plus remote
  caching, and give nothing for 5, 10 or 24 — undeclared reads still cache silently, which is the defect
  class this is about. It would also replace heavily-reasoned machinery with a config format, losing the
  reasoning, for a remote-cache win that serves a CI which is deliberately off. Bazel/Buck2 are correct by
  construction via sandboxing and would fight vitest, vite and electron-builder for months. **Borrow the
  model and the names; do not adopt the tool.**
- **Filesystem tracing.** A syscall trace cannot tell "read because it matters" from "stat'd during module
  resolution", and the tools already report what they read.
- **Remote or shared caching.** Single contributor, CI off.

## Checked, 2026-10-01

Both claims that stood here have been computed.

- **"~40 actions is the right order of magnitude" — confirmed at 47.** 18 typecheck legs + 12 unit suites +
  3 integration halves + 5 build units + 9 remaining steps. Counted rather than estimated; nothing in this
  list changes.
- **"Deriving `needs` from artifacts reproduces today's ordering exactly" — true, at 13 of 13**, once the
  derivation asks both questions: outputs into inputs for data edges (12), outputs into outputs for mutual
  exclusion (the 13th). It took three attempts. The first two were wrong about `excludes` and returned
  plausible answers; the third was right about data edges and **stopped there**, concluding 12 of 13 and
  proposing a `mustRunAfter` field for the remainder. Asking the second question removed the field and
  `exclusive` with it. This was the most valuable item on the list twice over — checking it changed the
  design, and re-checking it changed the design again.
