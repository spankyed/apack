> **Done and closed.** Implemented as Phase 1 of
> [`goal-one-action-cache.md`](../goals/goal-one-action-cache.md): `tier` is gone, `needsApp` is on the
> action and `SIZE_MS` on the test target, and the per-tier time report is deleted. One correction the
> work found — `build:app` declares no `needsApp`, because `tier: 3` meant "app-related" and lumped the
> producer in with its consumers. The text below is the plan as written.

# Split the tier

> Done, as Phase 1 of [`goal-one-action-cache.md`](../goals/goal-one-action-cache.md).
> This doc is the evidence and the design; that one records what landed and what was corrected.

## The target

`tier` answers two questions with one field. Replace it with:

- **`needsApp?: true`** on the action — the dependency constraint, one boundary, one consumer.
- **`size`** on the test target — the timeout budget's home, which is Bazel's name for exactly this.

And delete the per-tier time breakdown, which is instrumentation for a goal that shipped.

The test the current primitive fails and this passes: **every value has a consumer that distinguishes it,
and every declared boundary is enforced.**

## Why — four facts from the code

1. **No consumer distinguishes all three values.** `check-test-tiers.ts:49` is `if (tier === 3) continue`,
   which splits `{1,2} | {3}`. `TIER_TIMEOUT_MS` is `{1: 15_000, 2: 60_000, 3: 60_000}`, which splits
   `{1} | {2,3}`. Two binaries, cutting in different places.
2. **The ordering is used nowhere.** Every site is equality or a count — `tier === 3`, `tier < 3` in a
   success message, `tier === t` for a display grouping. Nothing expresses *"a lower tier may not read a
   higher tier's outputs"*, which is the rule the ordering exists for.
3. **Tier 1's definition is false of every tier-1 step.** There are three, and all three declare the built
   `@apackdev` packages and depend on `compile`, which is tier 2:

   | tier | step | needs a higher tier | declares built packages |
   |---|---|---|---|
   | 1 | `typecheck` | `compile` | yes |
   | 1 | `test:unit:host` | `compile` | yes |
   | 1 | `test:unit:pack` | `compile` | yes |

   Not an artifact of over-declaring: `SUITE_READS` documents the real reads in prose — `@apackdev/testing`'s
   bundle, published packages packed and installed, a built `dist` a spec skips without. **Enforce the
   tier-1 definition and tier 1 is empty.** The gradation is not under-enforced, it has no subject.
4. **The budget reaches its subject through a stranger.** `suite-timeouts.spec.ts:37` resolves
   `spec file -> step -> tier -> budget`. The step is in the middle only because that is where `tier` lives.

One thing that came out clean, and it is load-bearing for the design below: **the tier-3 boundary does hold
on the inputs**, not only in the script text. No tier-1 or tier-2 step declares any of the four `*/dist`
app outputs.

## `APP_ENTRY` is source, and that is the second proof against deriving the tag

Three tier-1 and tier-2 steps *look* like they declare app outputs, and what they declare is `APP_ENTRY` —
`packages/dev-mode.js` and `packages/entry-point.mjs` — which are **source files** sitting beside the
constant named for the built app. A derivation of "needs the app" that reaches for the app constants
misclassifies three steps on that alone.

That is the second reason the tag stays declared, beside the first one (`one-action-cache.md` item 18): a
derived tag reclassifies silently where a declared one is refused.

## Axis 1 — `needsApp?: true` on the action

**One boolean, not a map, and not a table.** The first draft of this had a `reads` map mirroring
`SUITE_READS` plus a constraint table shaped like `LAYERS`. That was wrong, and `repo` is the proof.

`SUITE_READS`' three flags — `packages`, `pack`, `repo` — all do one job: add paths to a suite's inputs
(`chain-steps.ts:414`; `repo` additionally gates the fixture `excludes` at `:453`). Every consumer is about
inputs and coverage: `fingerprint-scope.spec.ts`, `chain-inputs.spec.ts`, `suite-reads.spec.ts`. **Nothing
anywhere constrains what a step may read, except the app.** So those three are an *inputs* vocabulary, not
a constraint vocabulary, and `repo` is the clearest case — it adds inputs, creates no edge, and can never
make something app-dependent.

A table of allowances where one row has a consumer is the same error as three tier values with two binary
consumers, committed one layer up. So:

- **`SUITE_READS` is left alone.** It answers a different question and it works.
- The action declares `needsApp?: true`, a named field rather than an entry in a `tags` list. The reasons
  are below, under what not to do; "a string array invites unchecked strings" is **not** one of them, since
  this repo's own rule (a list and its type are one declaration) answers that in a line.
- Checked two ways: declared iff `APP_OUTPUTS` appears in `inputs` (pure data), **and** the existing
  script-text scan, which stays because it catches a reach the inputs do not show.
- The scan is retired later, by `one-action-cache.md` item 17's derived edges. Not before.

**When this becomes a table**: when a second boundary earns a consumer — someone wanting *"no unit suite
may read a pack's `dist`"* enforced. That is the condition to revisit on, and `LAYERS` is the shape to copy
when it holds.

## Axis 2 — `size` on the test target

Bazel's test `size` is precisely a bucket whose purpose is a default timeout. Here it belongs on
`UnitSuite` and the integration/Playwright configs rather than on the step, which deletes the
`spec -> step` hop from the timeout question entirely.

**Two buckets, because two is what has consumers**: 15s for the unit suites, 60s for the integration halves
and Playwright. Bazel has four; importing four here would invent three values nothing distinguishes, which
is the defect being fixed.

**The configs cannot import the budget**, and this shapes the design. `check:specifiers` forbids a vitest
config importing a constant across package layers, which is why the configs hold plain literals today and
`suite-timeouts.spec.ts` checks those literals. So `size` is a declaration in `unit-suites.ts` and the spec
checks config literals against it — the same mechanism as today, with a truthful source.

`@apackdev/testing`'s `definePackTestConfig` keeps its `15_000` literal. It is published, and an external pack
author has no chain, no steps and no suite table, so taking a `size` would push a repo concept into a
pack-facing API for nothing. The repo's check reads the pack suite's `size` instead of its tier to verify
that literal. The only change there is the comment above it, which currently cites
`TIER_TIMEOUT_MS, scripts/lib/chain-steps.ts` — a repo path quoted inside a published package.

## Delete the per-tier time breakdown

The chain's last line is `${byTier}${floor}` (`chain.ts:427`), and `floor` is a measured critical path
computed immediately above it:

```
chain passed in 27s (11 of 13 cached)
t1= 0s  t2= 14s  t3= 0s
critical path 125s (packages:ensure -> compile -> build:app -> test:packaged-authoring)
```

The breakdown's own comment says what it is for — *"the number the goal's phases move"* — and that goal
(`docs/archive/goals/goal-test-tiers.md`) has shipped. The critical path beside it answers what is actually
asked of a run: why lanes did not help, and where the floor is. It is measured, with a recorded correction
for having once been derived from the declared `seconds` (109s reported against 125.8s taken).

Regrouping it under the new tag would give a two-row split of "before and after `build:app`", which is the
sequence the critical path already prints by name. A figure earns its place by sizing a choice; this one
sizes none. One `const` and one interpolation, trivially restored if someone misses it.

## Blast radius

~24 sites across 8 files.

| file | what moves |
|---|---|
| `scripts/lib/chain-steps.ts` | the `Tier` type, `TIER_TIMEOUT_MS`, 13 step declarations |
| `scripts/lib/unit-suites.ts` | `size` arrives here |
| `scripts/check-test-tiers.ts` | branches on `needsApp`; gains the inputs check beside the scan |
| `scripts/chain.ts` | four sites become one — the row prefix, now a marker on app steps |
| `scripts/spec.ts`, `scripts/lib/spec-dry.ts` | the `[tier N]` label |
| `packages/internal-repo-checks/tests/suite-timeouts.spec.ts` | reads `size`, drops the `spec -> step` hop |
| `packages/internal-repo-checks/tests/{chain-graph,chain-output}.spec.ts` | tier assertions |
| `packages/apack-testing/src/vitest.ts` | the comment only |

Plus the tier tables in the root `CLAUDE.md` and `packages/internal-repo-checks/CLAUDE.md`.

## Sequencing

| piece | depends on |
|---|---|
| `size` on the suite | nothing — fully independent of the action-cache programme |
| `needsApp` checked against declared `inputs` | nothing |
| deleting the per-tier breakdown | nothing |
| retiring the script-text scan | `one-action-cache.md` item 17 |

Three of four are available today. That is what makes this a target of its own rather than a sub-item of a
28-part list.

## What not to do

- **Collapse the markers into a Bazel-style `tags` list.** This is the one worth arguing, because Bazel
  really does put all of these in `tags` — `exclusive`, `manual`, `no-cache`, `requires-network` — and
  adopting it would look like coalescing. It is the wrong borrow, for three reasons, and *not* for the one
  an earlier draft of this file gave. That draft said tiers are ordered and tags are not; fact 2 above
  disproves it, since nothing in the repo uses the ordering. The real reasons:

  1. **Bazel's `tags` exists to work around a constraint TypeScript does not have.** Its rule attributes
     are closed — you cannot add a field to `cc_test` — so `tags` is the extension point. A named optional
     field on an interface is checked, discoverable and greppable where a string in a list is none of those.
     Borrowing the workaround without the constraint is cargo cult.
  2. **Half the markers carry reasons, which a tags list structurally cannot.** `neverCachedBecause` and
     `optInBecause` are recorded improvements on Bazel's reason-free `no-cache` and `manual`, and the repo
     has the failure that motivated them: one hardcoded sentence about Electron that was wrong about the
     second step to opt out. Splitting markers across two mechanisms by whether they carry a reason is a
     seam that drifts.
  3. **One reason-free marker is not a vocabulary.** `needsApp` (5 steps) against `neverCachedBecause`
     (2) and `optInBecause` (1). It was two until `one-action-cache.md` decision 4 found that `exclusive`
     derives from two actions declaring the same output, which is a mutex rather than a flag. A tag system
     for one value is the same error as a constraint table with one row.

  **Revisit when the reason-free markers reach four or five.** At that point a closed union —
  `const ACTION_TAGS = [...] as const; type ActionTag = (typeof ACTION_TAGS)[number]` — is worth its
  weight, and it is Bazel's shape with the string problem removed. The principle is the one
  `one-action-cache.md` already applies to Turborepo and Nx: borrow the model and the names, not the tool.
- **Derive the tag.** Item 18, plus the `APP_ENTRY` finding above.
- **Four size buckets.** Two have consumers.
- **A constraint map mirroring `SUITE_READS`.** `repo` is not a constraint, and one boundary is not a table.

## Done when

- No `tier` field, no `Tier` type, no `TIER_TIMEOUT_MS`.
- `check:tiers` fails a step declaring `APP_OUTPUTS` without `needsApp`, and still fails one whose script
  text reaches the app. **Both directions mutation-checked**: add `APP_OUTPUTS` to a tier-1 step's inputs
  and watch it fail; drop `needsApp` from `test:smoke` and watch it fail.
- `suite-timeouts.spec.ts` reads `size` and no longer resolves a step to answer a timeout question; its
  existing both-directions check (a config above its budget, a config tighter than it) still fires.
- The root `CLAUDE.md` tier table is replaced by two true statements, and no table in the repo describes a
  boundary nothing enforces.
