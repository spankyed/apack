# Test inventory

Historical inventory and package-level placement rules. The current repository layout and commands
are in the [test placement guide](../../tests/README.md).

> **Not kept current — revisit it before you rely on it, and before starting work from it.** It said it was,
> and the counts below drifted anyway: on 2026-10-02 this page read 369 specs over twelve suites where the
> record held 389, with four suites out by 4 to 8 each. The rules about *where a spec belongs* are the live
> half and are what the CLAUDE.md files cite; the figures are a snapshot of 2026-09-25, surveyed through
> `goal-test-placement.md` Phase 2.
>
> **The numbers are not owned here, so count them rather than reading them off this page.** They were
> derived by `spec-cost:check -- --list` from a per-package record until 2026-10-05; both are gone, and a
> suite's spec files are now what a run of it prints. A copy on this page is a second record of one fact,
> which is the thing that rotted. Test counts are absent on purpose — they move on every commit, and
> nothing decides anything from them.

## Scale

**A snapshot of 2026-09-25, known stale** — a run of a suite is the live answer. What the shape is for: twelve package suites, a handful of fixture-pack specs, the E2E suite, and the root's own
`tests/scripts` shell checks. As surveyed, 369 spec files, 339 of them in the package suites.

| Suite | Specs | Fast half | Expensive half | Total |
|---|---|---|---|---|
| `@app/default-setup` | 87 | 16.0s | — | 16.0s |
| `@apackdev/host` | 76 | 18.7s | — | 18.7s |
| `@apackdev/sdk` | 56 | 15.1s | — | 15.1s |
| `@apackdev/cli` | 53 | 13.5s | 157.2s | **170.8s** |
| `@app/repo-checks` | 18 | 2.9s | 9.8s | 12.7s |
| `@app/api` | 15 | 5.6s | — | 5.6s |
| `@apackdev/ears` | 9 | 2.4s | — | 2.4s |
| `@app/renderer` | 8 | 0.1s | — | 0.1s |
| `@app/publish-checks` | 8 | 0.0s | 28.0s | 28.1s |
| `@apackdev/testing` | 4 | 0.1s | — | 0.1s |
| `@app/main` | 3 | 0.2s | — | 0.2s |
| `@apackdev/ui` | 2 | 0.1s | — | 0.1s |
| | **339** | | | **269.8s** |

One of default-setup's is recorded as skipped rather than costed (every test in it skips — it needs a real
`claude` binary — so it has no cost to place), which is why the recorded counts are one ahead of the
measured ones.

`@apackdev/cli` is still 63% of the file time, and now legitimately: the eight specs whose subject was the
published packages are `@app/publish-checks`, so its record can be read as a CLI number. It has moved
190.8s → 200.8s → 170.8s across recordings that removed twelve specs; the middle figure was a contended
measurement, which is the kind of noise the deleted cost record needed a band to absorb.

`packages/preload` has source but neither specs nor a `test` script; `@app/electron-versions` and
`@app/typescript-floor` hold no source. Every other package has a suite —
`@apackdev/testing` and `@apackdev/ui` gained theirs in `goal-test-placement.md` Phase 2, having had none.

## Where a spec lives

**A spec's path under `tests/` mirrors the source path it covers.** `src/features/brain/be/trigger-dedupe.ts`
is covered by `tests/features/brain/be/trigger-dedupe.spec.ts`. Exactly, rather than collapsed, because
exact is checkable and collapsing is a judgement call per file — `repo-checks/tests/spec-placement.spec.ts`
fails a directory under `tests/` that names no directory under `src/`.

Three consequences worth stating, because each was once decided the other way:

- **A directory never denotes a level, a cost half, or a history.** No `unit/`, no `integration/`, no
  `_hybrid/`. Which half a spec runs in is the `.integration.spec.ts` suffix and nothing else, decided by
  measured cost; two mechanisms for one fact is how they drift apart.
- **Support directories carry a `_` prefix** — `_support/` for helpers and fixtures. The prefix is what
  tells a reader, and the guard, that it is not claiming to mirror anything.
- **A spec covering several modules mirrors the entry point it drives**, not a new directory for things
  that span two.

No package colocates. `@app/default-setup` had six specs under `src/` with an include whose comment read
*"without this they are silently never run"*; they moved and the include went with them.
`scripts/lib/spec-halves.ts`' `specFiles` still walks `src/` on purpose — nothing includes it now, so a
colocated spec would never run, and the walk is what makes it show up in `spec:dry`'s listing rather than
vanishing twice over.

Three suites have an expensive half: `@apackdev/cli`, `@app/repo-checks` and `@app/publish-checks`, each with
a `vitest.integration.config.ts` over `tests/**/*.integration.spec.ts`. What a spec gets there is a 60s
per-test budget instead of 15s, a worker pool capped at half the cores, and separation from the per-change
loop.

**Which half a spec is in is a decision, declared by its filename**, and nothing re-derives it. It was
decided by measured cost against fixed edges until 2026-10-05 — a record per spec, a window of readings, a
band, two idle floors and a machine identity, all to stabilise a number that turned out not to be one
number: a spec reads 2.8s in the fast pool and 0.64s in the integration pool, so each half's reading demanded
a move the other took back. [`scripts/lib/spec-halves.ts`](../../scripts/lib/spec-halves.ts) is what
survived, and it measures nothing. Slowness is visible instead of adjudicated: vitest prints any test over
its 300ms threshold under its file, the chain prints each step's five slowest tests, and each unit pool
ranks its five slowest *files* per half from the run that just measured them
([`scripts/lib/spec-durations.ts`](../../scripts/lib/spec-durations.ts)). A spec whose header carries
`// @slow: <reason>` is held to still being in its half's slow tail — the one direction load cannot
fabricate, since it inflates a duration and never shortens one — and the same cache is what
`npm run spec:dry` prices a plan from, per machine and uncommitted.

## Categories

Seven kinds are actually distinguishable in the tree. The tier is what a check may read
(root `CLAUDE.md`, *What a test may read*), and `npm run check:tiers` enforces it.

| Category | Where | Tier | Reads |
|---|---|---|---|
| **Package unit** | most of every `tests/` | 1 | its own package's source, the in-memory runtime, fakes |
| **Contract over build output** | `apack-cli/tests/build/`, `default-setup/tests/content/` | 2 | the built `@apackdev` packages, a pack's `dist` |
| **Command / process** | `apack-cli/tests/commands/`, `tests/harness/` | 2 | runs real builds, installs and child processes |
| **Repo tooling** | `@app/repo-checks` | 1–2 | the chain table, the cost records, `scripts/` |
| **App runtime** | `api/tests/runtime/` | 1 | boots the composed runtime over a temp data dir |
| **Fixture pack** | `tests/packs/*` | 2 and 3 | a pack built and tested as a third party would |
| **E2E** | `tests/e2e/` | 3 | the built app, real Electron |

## Verdict classes

From the 2026-09-19 survey, which swept the first four. They remain the vocabulary for judging a test.

| Verdict | Meaning |
|---|---|
| `KEEP` | guards a regression path nothing else covers |
| `TRIM` | guards behaviour, also pins incidental detail |
| `MERGE` | overlaps another test; fold them |
| `MOVE` | right assertion, wrong level or package |
| `DELETE` | cannot fail meaningfully, or something cheaper fails first |

`KEEP`/`TRIM`/`MERGE`/`DELETE` were acted on by
[`goal-test-cleanup.md`](../archive/goals/goal-test-cleanup.md), whose Decisions 1–10 are the standing
criteria — in particular **Decision 10: a duplicate that names the level it adds is not a duplicate.**

`MOVE` is the class that accumulates on its own. The other four are written wrong once; a misplaced spec is
written *correctly* and then left behind when the code moves. That is why the tree records the repo's
history rather than its structure. `default-setup/tests/unit/_hybrid/README.md` said so outright — *"The
directory's name is historical: these specs once imported the API's EARS and repository modules too"* — until
`goal-tests-mirror-source.md` moved its three specs under the features they cover and the directory went.

### Mechanical signals

Cheap greps that flag a candidate. None is a verdict on its own — they narrow reading.

| Signal | What it catches |
|---|---|
| `msg-pinned` | an assertion on a string literal of 45+ chars: a whole message, not the part a user acts on |
| `count-pinned` | `toHaveBeenCalledTimes(n)` / `toHaveLength(n)`: a count that is not the behaviour |
| `no-product-import` | the spec references no product module at all |
| `tests-fixture` | asserts something about an allowlist, fixture or the spec's own scanner |
| `dupe-title` | the same test title in more than one file |
| `type-only` | `typeof x === 'function'`: the type system's job |

Measured 2026-09-25 across 367 spec files: `count-pinned` 218, `msg-pinned` 32, `tests-fixture` 9,
`type-only` 5 — 97 files carry at least one. Those are candidates, not verdicts; the last sweep read them.

**`dupe-title` over-reports, and by a lot.** It compares `it(` titles without the `describe` above them, so a
property asserted of three different things reads as three copies. All three pairs it flagged in 2026-09-19
turned out to satisfy Decision 10 already, because the describe is what names the level:
`getEventValidationMap` / `getSurfaceEventValidationMap`, `secrets store` /
`secret rules`, `the command store` / `registerPack commands`. Read a `dupe-title` hit with its describe
before believing it.

Provenance (`git blame` on the `it(` line) answers *what was this for* when intent is unclear. It is **not**
a filter: measured across 2,211 tests, the share carrying a signal was flat by commit type — `fix(` 16%,
`feat(` 16%, `refactor(` 14%, `test(` 11%.

**Last scanned** 2026-09-25 over the four specs added since the sweep (`launch-env`, `repo-check-boundary`,
`spec-placement`, `unit-pool`). None carries a signal.

## Known misplacements

Open at this survey. [`goal-test-placement.md`](../archive/goals/goal-test-placement.md) acts on these;
[`goal-published-package-checks.md`](../archive/goals/goal-published-package-checks.md) is the largest, split out
because its subject belongs to no single package.

| # | What | Size |
|---|---|---|
| 1 | ~~`@apackdev/testing` and `@apackdev/ui` have no suite~~ — **resolved** in Phase 2: both have one, four specs and one describe moved to them, and `npm run spec` reaches their source instead of crashing | done |
| 2 | ~~`@app/api`'s only test directory is `unit/`~~ — **resolved** in Phase 4: split on measured cost into `unit/` (5 specs, 4–22ms) and `runtime/` (10, 100–1120ms); the cheap five run alone in 2.1s | done |
| 3 | ~~`secrets.spec.ts` mocks host's vault by relative path~~ — **resolved** in Phase 4: `@apackdev/host` publishes `./secrets/vault`, so it is a specifier. The mock stays: host's own suite covers the vault, this covers what a renderer learns, and Decision 10's sentence now says so | done |
| 4 | `@apackdev/ui` has 33 recorded component contracts and no behavioural test; exactly one spec in the repo mounts a Vue component | coverage gap |
| 5 | ~~`@app/default-setup` is the only package with colocated specs~~ — **resolved** in Phase 5: the six moved under `tests/`, the `src/**` include and the `__tests__/` variant are gone | done |
| 6 | ~~twelve specs in `@apackdev/cli` are about the published `@apackdev` packages~~ — **resolved**: eight moved to `@app/publish-checks` with the packing fixture, one to `@apackdev/ui`; `package-freshness`, `checkout-packages` and `verify-node-modules` stay, their subjects being host's stamp rule, a CLI command and the packaging script | done |

`pack-protocol.spec.ts` was a seventh, resolved in Phase 6: it sat in `@apackdev/host` while `PackProtocol.ts`
lives in `@app/main`, and both its describes asserted against copies declared in the test. It moved, and its
MIME map now reads the product's export rather than its own copy — removing `.woff2` from `PackProtocol.ts`
fails it, where before nothing in the product could. Its path-traversal describe still rebuilds
`path.join(…) + path.sep` and checks Node's `path`; making that real needs the handler's prefix check
extracted as an export, which is a product change and stays deferred.

## Guards that hold placement

A guard is what makes a rule survive the next refactor; prose does not. These fail when a placement rule
breaks, and all of them live in `@app/repo-checks`:

- **`repo-check-boundary.spec.ts`** — a spec whose subject is a repo script lives in `@app/repo-checks`, and
  that package holds nothing else.
- **`suite-split.spec.ts`** — every spec is recorded and in the half its cost implies.
- **`suite-timeouts.spec.ts`** — no config or test buys itself more time than its tier allows.
- **`chain-inputs.spec.ts`** — the chain reads every tracked source file, and a pool step and its projects
  cache on the same inputs.

Two more are planned by `goal-test-placement.md` Phase 3: *a package with a `src/` has a suite*, and *no
spec imports another package's `src/` by relative path*.

## Running them

The commands, their shapes and what each costs are in the root [`CLAUDE.md`](../../CLAUDE.md) under
*Commands*. The short version: `npm run spec` while working, `npm run chain` before a merge.
