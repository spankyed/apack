> **Done** (branch `AS/one-action-cache`, commits `9a82b088`..`ac9c3ab4`). Phases 1-4 landed in full;
> Phase 5 landed its guard and not its premise, for reasons in the Outcome. The text below is the plan as
> written.

> **Written in session** `acfdcbe9-f87e-4349-a1e3-a03cdf58065c` (Claude Code, 2026-10-01). Resume it with `claude -r acfdcbe9-f87e-4349-a1e3-a03cdf58065c`.

```
# Goal: one cache key per action, derived from what the action reads and writes

Implement docs/goals/goal-one-action-cache.md on AS/one-action-cache, at or after 16c1b02e6 — the
branch this goal was written on. Its Background was surveyed at 9912fceea, an ancestor; only the three
doc files between them changed, so the survey holds at the branch point.
Before Phase 1, confirm the base: `TIER_TIMEOUT_MS`, `inputsForSuites` and `SUITE_READS` in
scripts/lib/chain-steps.ts, `unitStepName` in scripts/lib/unit-suites.ts, `APP_MARKERS` in
scripts/check-test-tiers.ts, `exclusiveRunning` in scripts/lib/chain-schedule.ts, `TYPECHECK_LEGS` in
scripts/lib/typecheck-legs.ts and `freshnessSweep` in packages/apack-host/src/build/packages-built.ts
all exist at HEAD. If they don't, stop and say so — the plan was surveyed somewhere else.
Read Background, Decisions, Phases and Constraints first, and the two design docs they cite
(docs/plans/one-action-cache.md, docs/plans/tier-split.md). Decisions are final: implement them, don't
reopen them or stop to ask.
Where a detail isn't specified, pick the conventional option, note it in the final summary, and keep
going. No backward compatibility in code (root `CLAUDE.md`, "Backward compatibility" — a standing rule,
not this goal's choice): change signatures, migrate every in-repo caller, test, fixture, template and
doc in the same change, and fix forward. Stored user data is the exception: it moves with migrations.

Finished when:
- Phases 1–5 are implemented and each meets its "Done when"; every new guard is mutation-checked, both
  directions where the phase names two.
- `tier`, `Tier` and `TIER_TIMEOUT_MS` are gone; `needsApp` is on the action and `size` on the suite.
- `ChainStep.needs` and `ChainStep.exclusive` are gone; `dependsOn` and mutual exclusion are derived
  from `outputs`, and a spec asserts the derivation reproduced the recorded table before it was deleted.
- Every action declares its outputs, verification included; an action that cannot is not cached, and a
  guard asserts no action is both uncacheable and stamped.
- `npm run chain` passes, and `npm run chain --dry` reports the same cached/stale verdicts per step as
  it did at the base for an unchanged tree.
- A final summary: phase → done/deferred, evidence, and the conventional choices made.
- The doc is in `docs/archive/goals/`, with its status blockquote and an Outcome section, committed.

Commit as you go:
- Commit each phase when its "Done when" holds and the narrow checks are green — not once at the end.
- Check `git diff --cached` first, then `git commit -- <paths>` naming only that phase's files.
- Conventional message, no Co-Authored-By or session lines.
- Don't push, tag or open a PR unless the user asks.

Never:
- the standing prohibitions in Constraints below: git remotes, publishing, real data dirs, broad
  process kills, bare tsc in preload, the example pack's node_modules, release metadata, typed EARS.
- hand-write a per-leg or per-action input list that a tool already reports (Decision 5).
- keep a declared field "for safety" once its derivation is proven — the proof is the reproduction
  spec, and the field goes in the same phase (Decision 4).
- measure on a loaded machine: `npm run measure` refuses below 70% idle and that refusal stands.
```

## Background (2026-10-01, at `9912fceea` on `master`; the work branch `AS/one-action-cache` starts at `16c1b02e6`, which adds only this doc and two plan docs)

`docs/plans/one-action-cache.md` is the full survey, with every measurement and the reasoning behind
each decision. `docs/plans/tier-split.md` is Phase 1's detailed design. This section is the short form.

**One concept does three jobs.** A chain step (`scripts/lib/chain-steps.ts`) is simultaneously the unit
of caching, of execution and of ordering. Nearly every chain defect the repo has found is downstream of
that, and each was fixed where it surfaced.

What that costs today, measured:

| | |
|---|---|
| `typecheck` | 18 legs under one fingerprint, no per-leg cache, and `scripts/typecheck.ts:33` sets its own lane count to "half the cores, because the chain runs two other lanes beside this step" — two schedulers with no shared budget, a measured 63.4s in-chain against 29.3s alone |
| the integration half | one `vitest run` with no per-suite stamps; `internal-repo-checks` is stale on any source edit and its half is 5.06s of a 48.2s pooled run, so the common case is 1 of 3 suites stale and all 3 running |
| outputs | 6 of 13 steps declare any; the seven that declare none include `typecheck`, both pools and `test:integration` |
| `tier` | three values, two consumers, each using it as a *different* binary — `check-test-tiers.ts:49` splits {1,2}\|{3}, `TIER_TIMEOUT_MS` splits {1}\|{2,3}. The ordering is used nowhere, and all three tier-1 steps read the built packages, which tier 1's own definition forbids |
| `exclusive` | a global mutex (`chain-schedule.ts:73`) standing in for conflicts neither user declares |

**Three fixes already landed** and are not part of this goal: the per-file digest memo
(`980c6d854`), `test:integration` declaring what its suites read (`c5c724b9b`), and the guard that
holds every suite-running step to it (`94b33f22d`).

**The derivation is already proven.** Deriving edges from `outputs` — into `inputs` for data edges,
into `outputs` for mutual exclusion — reproduces all 13 declared `needs` and both `exclusive` flags.
It took three attempts: two were wrong about `excludes` and returned plausible answers (3 of 13, then
11 of 13). That is why Decision 4 keeps the recorded table until a spec proves the derivation against
it.

## Decisions

Final.

1. **An action is a tool invocation.** `typecheck` is 18 actions, not one. Not for caching — per-leg
   caching is worth nothing for 7 of 11 single-package edits, because `typecheck:fe` is both the
   slowest leg (6.2s) and the most depended-on — but because one scheduler must own the lanes.
2. **One cache entry per action.** The per-file digest memo (landed) is what makes action count cheap:
   the cost driver was a 6.64x input overlap, not the number of actions.
3. **No dep file means not cacheable** — Gradle's rule unmodified. A cold run is uncached everywhere,
   which describes a cold run rather than a cost. The stale dep file is the case needing a guard, not
   the missing one (Decision 6).
4. **Every edge derives; nothing hand-declared survives in the graph.** `outputs` into `inputs` gives
   data edges, `outputs` into `outputs` gives mutual exclusion. `needs` becomes a derived `dependsOn`,
   `exclusive` is deleted, and `mustRunAfter` is **not** added — Bazel needs no such field because two
   actions producing one output is an error there. Direction (smoke before e2e, to fail fast) is
   scheduling policy, not a graph edge.
5. **Inputs come from the tool, not from a list.** `.tsbuildinfo`'s `fileNames` for the compiler legs;
   declared only where no tool reports (the git-querying guards, shell steps, `oxlint`).
6. **A dep file is a proxy** in the repo's taxonomy (root `CLAUDE.md`, "Three kinds of recorded
   artifact"), so it carries the self-check `api:stamp` has, not just a comparison.
7. **Incremental, by strangler fig.** Each phase lands with the old declaration still present and a
   spec asserting the new derivation reproduces it, then deletes the old declaration in the same
   phase. At every commit the chain is one system, not two.
8. **`tier` splits into `needsApp` on the action and `size` on the test target**, and the per-tier time
   breakdown is deleted. `tier-split.md` carries the evidence, the blast radius and the done-when.
9. **`seconds` stays in the step table** and borrows `spec-cost.ts`'s band logic rather than its
   storage. Revisit at ~47 actions.
10. **Markers stay named fields, not a Bazel-style `tags` list.** Bazel's `tags` works around closed
    rule attributes, which a TypeScript interface does not have; half the markers here carry reasons a
    tags list cannot hold. Revisit when reason-free markers reach four or five.

## Phases

### Phase 1 — split `tier` into `needsApp` and `size`

Implement `docs/plans/tier-split.md` (Decision 8). It is self-contained and depends on nothing else
here; its own "Done when" is the authority, summarised:

- `size` on `UnitSuite` and the integration/Playwright configs; two buckets, 15s and 60s.
  `suite-timeouts.spec.ts` reads `size` and no longer resolves a step to answer a timeout question.
- `needsApp?: true` on the action. `check-test-tiers.ts` branches on it and gains a check against
  declared `inputs` (`APP_OUTPUTS` present iff `needsApp`), keeping its script-text scan — that scan
  catches a reach the inputs do not show, and Phase 2 is what retires it.
- Delete the `t1=/t2=/t3=` breakdown in `chain.ts`; the measured critical path beside it is the
  better number and is already printed.
- `@apackdev/testing`'s `definePackTestConfig` keeps its `15_000` literal — it is published, and an
  external pack author has no suite table. Only its comment changes.

**Done when:** `tier`, `Tier` and `TIER_TIMEOUT_MS` appear nowhere; `npm run spec -- suite-timeouts
chain-graph chain-output` passes; `npm run check:tiers` passes. Mutation, both directions: adding
`APP_OUTPUTS` to a tier-1 step's inputs fails the new case, and dropping `needsApp` from `test:smoke`
fails it. `npm run chain` at the end.

### Phase 2 — derive the graph, delete `needs` and `exclusive`

After Phase 1 (both touch the step table; see the committing rule).

- Derive `dependsOn` from `outputs` into `inputs`, honouring `excludes`, transitively reduced.
- Derive mutual exclusion from `outputs` into `outputs`.
- **Add the reproduction spec first**, asserting the derivation equals the recorded `needs` and
  `exclusive` for every step, then delete both fields (Decision 7). The spec keeps a recorded copy of
  the old table for exactly one commit; say so in its doc comment and delete it with the fields.
- `chain-schedule.ts` takes derived mutexes in place of `exclusiveRunning`. Direction stays policy:
  `test:smoke` before `test`.
- Retire `check-test-tiers.ts`'s script-text scan in favour of a query over the derived edges, which
  is the fourth piece of `tier-split.md`.
- Rename the 9 reads and two error strings to `dependsOn`; the 13 declarations are deleted, not
  renamed.

**Done when:** `ChainStep` has no `needs` and no `exclusive`; the reproduction spec passed in the
commit before they went and is gone with them; `npm run chain --dry` reports the same per-step
verdicts as at the base for an unchanged tree; `packages:check` still runs without overlapping
`packages:ensure`. Mutation: give two steps an overlapping output and the scheduler must serialise
them; remove one derived edge and `orderedSteps` must change.

### Phase 3 — dep files from `.tsbuildinfo`

- Read `fileNames` from each compiler leg's `.tsbuildinfo` as that action's input set (Decision 5).
- The proxy self-check (Decision 6): the dep file records what was read *last* time, so it needs the
  shape `api-reports.ts` has — a check that fails naming both causes, a missing input and a
  hand-edited record.
- Where no tool reports, declare, and say in a comment why no tool does.

**Done when:** a compiler action's inputs come from its `.tsbuildinfo`; the self-check exists and is
mutation-checked by removing an input from a recorded set; no hand-written per-leg input list exists.

### Phase 4 — typecheck as 18 actions under one scheduler

After Phase 3, which supplies the inputs.

- `TYPECHECK_LEGS` entries become actions in the registry. `scripts/typecheck.ts` stops owning a lane
  count; the chain's scheduler owns all of them (Decision 1).
- Delete the "half the cores" compensation and its comment.

**Done when:** `npm run typecheck` still passes and still reports one leg's output alone on failure;
no module sets a lane count against another's; measured on an idle box, the chain's wall time is no
worse than at the base (`npm run measure`, which refuses below 70% idle).

### Phase 5 — outputs for verification actions, then Gradle's rule

- Every verification action declares an output — a machine-readable result (`--reporter=junit
  --outputFile` or the conventional equivalent; the format is unspecified, pick one and note it).
- Then adopt Decision 3: an action that cannot declare its inputs and outputs is not cached.
- Guard: no action is both uncacheable and stamped.

**Done when:** every action declares outputs; the guard exists and is mutation-checked; `npm run
chain` warm is no slower than at the base — if it is, the phase is not done, because uncaching seven
steps was the risk this phase exists to avoid.

## Outcome (2026-10-01)

Landed on `AS/one-action-cache` in five commits, one per phase plus the snapshot deletion Phase 2 asks
for. The chain is 29 steps where it was 13, every edge derives from what a step reads and writes, and no
step declares an ordering. Phases 1-4 meet their "Done when" as written. **Phase 5 does not, and the half
it fails is the half that turned out to be wrong rather than unfinished** — see Corrections.

### Per phase

| Phase | Status | Evidence |
|---|---|---|
| 1 — split `tier` | done | `tier`, `Tier`, `TIER_TIMEOUT_MS` appear nowhere; `needsApp` on the action, `SIZE_MS` on the suite; `check:tiers` passes with both its questions; mutation-checked both directions |
| 2 — derive the graph | done | `ChainStep.needs` and `.exclusive` gone; `derived-edges.spec.ts` proved the derivation against the recorded table in `821b5daf0` and was deleted in `d5fe5831d`; mutations fire on an overlapping output and on a removed edge |
| 3 — dep files | done | `scripts/lib/dep-files.ts` reads all 14 `tsBuildInfoFile` records; `untrustworthy()` is the proxy self-check with both causes named; mutation-checked by injecting an undeclared read |
| 4 — one scheduler | done | 17 legs are chain steps; `scripts/typecheck.ts` takes every core and the "half the cores" guess is gone; A/B below |
| 5 — outputs, then Gradle's rule | **guard only** | `chain-stamps.spec.ts` lands and is mutation-checked both ways; "every action declares outputs" and the warm-time criterion are not met |

### Conventional choices

- **`size` is derived, not a field.** Two buckets, `small` and `large`, from which config a file is. A
  per-suite `size` would have been a constant — every fast half small, every integration half large — and
  the halves are already cost classes `spec-cost` moves specs between. A *spec's* size still consults
  `INTEGRATION_SUITES`, because a package with no second config runs everything small whatever a file is
  named.
- **`alsoWrites`**, a new field, for a path a step writes that is not a product. `attw --pack` packs a
  tarball inside the tree it checks and removes it; declaring that as an output would take the tree out of
  the step's own key, and the tree is what it checks.
- **A three-character `app` row marker** in place of `t1`/`t2`/`t3`, which moved the three derived column
  constants by one together.
- **Root `exports:check` and `schema:check` scripts**, because the chain runs a step as `npm run <name>`
  and those two existed only as `-w` invocations.
- **`api:stamp` is scoped `repo`.** It runs a repo script, so it reads one, and `scripts/` is not a
  package directory.
- **`fingerprint-scope` and `dep-files` moved to the integration half**, at 2.9s and 5.3s: 29 steps is
  more walking than 13.

### Corrections to the Decisions

**Decision 5 — "inputs come from the tool, not from a list" — is right for a *check* and wrong for a
*key*.** A dep file records what was read last time, so it cannot contain a file that did not exist then;
for `tsc`, a new file matching the include glob changes the result, so a key built on the dep file would
never invalidate for it. Buck2 accepts that unsoundness because it uses dep files for headers, where an
unread new file cannot change the answer. So a leg's inputs derive from its declared `scope`, and the dep
file verifies that scope covers the reads — which is what `dep-files.integration.spec.ts` does, per leg.

**Phase 2's "retire `check-test-tiers.ts`'s text scan in favour of the derived edges" is not possible,
and the phase was wrong to pair them.** A step that launches the app without declaring app inputs has no
derived edge either — the graph is built from declarations, so it cannot see an undeclared read. The scan
catches exactly that case. It goes when something observes reads rather than declaring them, which is
dep files' job and not the graph's. The scan stayed, and `check:tiers` now asks both questions.

**Phase 5's "every action declares outputs" would create the defect this goal removes.** 23 of the 29
steps are verification with nothing to emit. Gradle requires the declaration because its cache *restores*
outputs; this cache only decides whether to run, so a declared output buys exclusion from the step's own
key and conflict detection, neither of which needs a synthesised result file. Writing one per verification
action would be a second record of what the stamp already says. The faithful translation — every action
declares every path it *writes* — is what `alsoWrites` delivered in Phase 2, and the chain's "passed and
is already stale again" report is the runtime detector for a missed one; the `--all` run reported none.
Gradle's rule therefore has no subject here, and **item 7 of `docs/plans/one-action-cache.md` should be
re-read as being about input completeness**, which Phases 3 and 4 built.

**`build:app` does not declare `needsApp`.** `tier: 3` meant "app-related" and lumped the producer in
with its consumers; `needsApp` means "reads the built app", and `build:app` writes it. The new check found
this on its first run.

### Open items

- **The warm chain is 1.0s slower, measured.** 2.5s median of 5 against the base's 1.5s, both at 80% idle
  on 2026-10-01. The cause is the stamp store: 7.8MB across 28 steps, because a stamp records every input
  file's digest and four repo-scoped legs write ~465KB each. The fix is to separate the stale *verdict*
  from the which-file-changed *diagnostic* — the verdict needs one hash, and only a report needs the map.
  That is a change to the stamp format and its `STAMP_VERSION`, which is why it is not in this goal.
- **`check:tiers` still reads script text**, and a marker inside a string literal reads as an invocation:
  one rule's `why` text said `apack test` in prose and refused the step until the sentence was reworded.
  Recorded where the scan is.
- **Item 7 (Gradle's rule) is unadopted**, per the correction above.
- The per-leg scopes are wider than the dep files show for the legs with no dep file — the lint, the
  import rules, the API stamp — because nothing reports their reads.

### Final verification

| | |
|---|---|
| `npm run chain` | passes, 178.3s cold with 17 of 28 cached |
| `npm run chain -- --dry`, unchanged tree | 28 of 28 cacheable steps cached; `packages:ensure` runs, uncached by design |
| `chain --all`, A/B at 84% idle | 171.0s before (169.8-187.8) against **169.8s after (169.6-170.3)** — medians within a second, spread 18s to 0.7s |
| `npm run chain` warm | 2.5s after against 1.5s at the base, both 80% idle — the regression above |
| `npm run typecheck` | passes standalone, reporting per leg |
| `npm run spec` | 2742 passed |
| `@app/internal-repo-checks` | 664 fast, 303 integration |
| `check:tiers` | 25 reach no app, 4 declare they need one |
| `spec-cost:check` | 385 specs, each in the half its cost implies |
| `check:specifiers`, `lint:check` | pass |

## Deferred

- **Remote or shared caching.** Single contributor, CI deliberately off.
- **Adopting Turborepo, Nx, Bazel or Buck2.** Reasoned out under "Explicitly out of scope" in
  `one-action-cache.md`: they give the cheap items free and nothing for the defect class this is about.
- **Filesystem tracing** as an input source.
- **Generalising `suite-reads` beyond suite-running actions** (item 24's remainder).

## Constraints

- Commit each phase as it finishes, in logical chunks, no attribution lines, `git diff --cached`
  first; pushing, tagging and PRs are on request.
- No publishing, releases or triggered workflows.
- No real data dirs, no broad `pkill`, E2E in the `apack-test` namespace.
- Preload: no bare `tsc` (`packages/preload/CLAUDE.md`). No `npm install` in the example pack. No
  edits to version or release metadata.
- Typed EARS types are change-controlled (`packages/apack-sdk/TYPED-EARS.md`).
- Published packages: no `any`, the TypeScript floor, `api:update` after export changes.
- Migrations follow `packages/apack-host/src/migrations/CLAUDE.md`.
- Investigate failing tests; mutation-check new guards rather than trusting a green run.
- Keep the loop narrow: `npm run spec` during the work, the full chain once per phase at its end. The
  root `CLAUDE.md`'s "What to run after a change" says which command covers which change.
- A measurement without its conditions is an assertion. `npm run measure` prints both and refuses
  below 70% idle; that refusal is not to be forced in this goal.
