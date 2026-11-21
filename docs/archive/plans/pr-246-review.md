# Review PR #246 before merge

Status: archived 2026-10-21; the review is complete and #246 is merged. Its findings and their repairs are in
[the review evidence](../references/evidence/pr-246-review.md); the budget findings it handed on are owned by the
[validation budget plan](validation-feedback-budget.md). Date: 2026-10-19.
Subject: [#246](https://github.com/spankyed/apack/pull/246), `session/settings-pack-contracts` against
`master` (merge base `d7e77829a`), the delivery of the
[settings and pack contracts goal](../goals/goal-settings-and-pack-contracts.md).

## Outcome

A list of verified defects, each reproduced or argued from the source, ranked by severity, plus a
completeness verdict: does the branch deliver what the goal says it delivers? The review changes no code.
Fixes are separate, follow-up checkpoints.

**A finding is a defect**: wrong behaviour, a broken contract, a lost invariant, a missing case on a path
the PR changed, or a claim in a guide that the code contradicts. Decided behaviour, style and
documentation bookkeeping are not findings.

## Size and what is out of scope

930 commits, 1,298 files, about 97k lines added and 22k removed. Reading the PR commit by commit is not
feasible and not useful: many checkpoints rewrite earlier ones. The unit of review is the **net diff per
area** (`git diff master...HEAD -- <paths>`), and the commit log is used only to explain a hunk.

What the review does not read as code:

| Excluded | Why |
|---|---|
| `docs/references/evidence/` (20k lines), `docs/archive/` | Run logs and closed history. Read them only when a finding needs the evidence a decision rested on |
| `packages/*/etc/*.api.md`, `apack.schema.json`, `etc/pack-types.api.md` | Derived. `api:check`, `schema:check` and `facade:check` compare them with their source, and the review reads the source. The one question for them is whether a public surface change was intended (area 4) |
| `package-lock.json`, `src/__generated__/` | Generated |

## Areas

Measured from the net diff on 2026-10-19. Line counts are added plus removed, source and tests together.

| # | Area | Main paths | Size |
|---|---|---|---|
| 1 | Pack catalog, registration and binding | host `packs/{registry,catalog,declaration-binding,service-binding,extensions}.ts`, `packs/runtime/`, `features/packs/be/`; SDK `framework/` | ~4k src |
| 2 | Discovery, install and shipped packs | host `packs/{layout,installer,discovery,installed,staging}.ts`; CLI `commands/{install,uninstall,restore,…}` | ~2k src |
| 3 | Build integrity and compiler inputs | host `build/{compiler-inputs,pack-build-inputs,package-inputs,pack-inputs}`; CLI `build/` (native libraries ELF/PE, watch, phase cache, compiler installation) | ~6k src, the largest |
| 4 | Manifest schema, codegen and published surface | SDK `build/{manifest-schema,generate-entries,validate,module-targets,snapshot,module-exports}.ts`; default-setup `apack.json`; the `etc/` diffs | ~2k src + 2.1k manifest |
| 5 | Settings | host `features/settings/`, `fe/settings-runtime.ts`; SDK `fe/settings.ts`, `testing/fake-settings.ts`; renderer `views/settings/` | ~2k src |
| 6 | Frontend admission, shell and navigation | host `fe/`, `features/application/fe/`, `features/packs/fe/`; SDK `fe/`; renderer `src/` | ~3.5k src |
| 7 | Service consumption | SDK `services/`, `framework/service-consumption.ts`; host `packs/service-binding.ts`, `services/` | ~1k src |
| 8 | Migrations, backup and app data | host `migrations/`, `backup/`, `services/app-data.ts` | ~0.7k src |
| 9 | default-setup's migration to the new contracts | `packages/default-setup/src` (173 files), `tests/` | ~6.5k |
| 10 | Tooling, CI and tests | `.github/workflows`, `.github/scripts`, `scripts/lib`, `tests/scripts`, `packages/internal-repo-checks` | ~2.5k |

Areas 3 and 9 are big enough to split in two if a single reviewer cannot hold them: area 3 into host
inputs and CLI native compilation, area 9 by feature.

## What each reviewer checks

Every area reviewer gets the area's paths, the package `CLAUDE.md` that owns them, and this list.

1. **Correctness on changed paths.** For each changed function: inputs it now accepts or refuses, error
   and rollback paths, concurrency (two writers, a reload in flight, a window reconnecting), and
   resource lifetime (subscriptions, bindings, leases, temp dirs).
2. **Invariants the guides state.** Each package guide states rules as fact ("refusal preserves the
   incumbent", "inspection writes no user data", "no pack code runs during discovery"). For every
   such rule the PR touches, find the code that enforces it and the case that would fail if it broke.
   A rule with no enforcing code is a finding.
3. **Two copies of one rule.** The PR moved logic between backend and frontend, SDK and host, and source
   and installed readers. Look for logic that now exists twice and disagrees. The known example is
   below: three path readers, two of which descend into arrays.
4. **The repo's contracts.** No compatibility shim, dual-read or alias (root `CLAUDE.md`, "Backward
   compatibility"). Typed EARS types unchanged unless `TYPED-EARS.md`'s checklist was followed. No pack
   source reaching `@apackdev/host` or an `_`-prefixed export.
5. **Tests.** Missing tests for the behaviour the area changed. Tests that mirror the implementation or
   grep source text. Deadlines raised or assertions loosened to get a pass (root `CLAUDE.md`, "Keep
   validation bounded"). Each claim needs the test name and the assertion.

Reviewers work read-only from the diff and the source, and run no suites. When a finding needs to be
reproduced, run one focused spec in a separate worktree (`npm run session:new`), because a mutation in the
shared tree can end up staged. CLI integration and native cases do not run on the daily-use Mac. They go
to the disposable runners.

## Cross-area pass

One more reviewer reads only the seams between areas, which no area reviewer owns:

- catalog (1) and settings (5): disabled or failed owners, catalog change while a settings write is in flight;
- install and replacement (2) and frontend admission (6): a replaced pack's frontend, revision checks,
  retired settings grants;
- build records (3) and discovery (2): an installed build whose receipt, declarations and runtime bytes
  come from different builds;
- service binding (7) and the pack runtime (1): caller retirement, provider generations across reloads.

## Completeness pass

Check the goal's claims against the branch, row by row through its **Final acceptance register**. For each
row, mark it **delivered**, **delivered without evidence**, or **not delivered**, citing code and a test.

The goal document already contradicts itself in three places. Resolve these first:

- The header and `## Outcome (2026-10-19)` say the goal is complete. The register's "Final committed
  tree" row still reads *Outstanding … Archive only after every row is proven*, and the closing
  `## Outcome` section still reads *Pending completion*.
- Several rows (API consumption, build freshness, provenance) defer to "final strict acceptance", which
  the user waived in `2c790624d`. Record which behaviours, if any, only that strict gate ever covered.
  The waiver covered the repeated run, not the coverage.
- The build-freshness row records strict run `39196299955` as *not reaching authoring/runtime/app
  halves*. Confirm that a later accepted run covered those halves on committed source.

Check the public guides the PR edited (`docs/public-facing/`, the templates under
`packages/apack-cli/templates`) against the code. A pack author follows them literally.

## Process

1. **Review.** One reviewer per area, then the cross-area reviewer (see How it runs). Each returns findings as
   `{ file, line, summary, failure_scenario, severity, evidence }`.
2. **Verify.** An independent reviewer tries to refute each finding against the source: the scenario has
   to be reachable, and the cited code has to be the cause. Only confirmed or plausible findings survive.
   Deduplicate across areas.
3. **Completeness.** Done last, by one reviewer reading the goal and the evidence links.
4. **Report.** The output is one ranked list of defects and the completeness table, recorded in
   `docs/archive/references/evidence/pr-246-review.md`. A fix plan is a separate document.

Severity:

| Level | Meaning |
|---|---|
| Blocker | Data loss, a user's work overwritten, a security boundary crossed (pack reaches host-only or secrets), or the app fails to boot |
| High | A stated contract broken on a reachable path. Wrong refusal or acceptance of a pack, settings write or replacement |
| Medium | A defect on an edge path, or a missing test for behaviour the PR changed on a main path |
| Low | Diagnostic or wording wrong, a guide contradicting the code |

## How it runs

Area by area, one reviewer per turn, so the cost stays bounded and the review can stop after any area.
Each area's findings are verified against the source and recorded before the next area starts. Order,
highest consequence first: 8, 2, 1, 5, 7, 6, 3 (host inputs, then CLI build), 4, 9, 10, then the
cross-area pass, then completeness.

## Cost of running it in parallel instead

About 12 agents (10 areas, the cross-area pass, completeness) plus verification. This is an estimate,
not a measurement: each area is 1–6k lines of net diff plus the source around it, so roughly 2–4M tokens
in total. That is more than the repo's default workflow size of under 10 agents, so it needs an explicit
go-ahead. There are two ways to run it:

- a local multi-agent workflow, started by asking for it ("use a workflow") and running this plan as
  written;
- `/code-review ultra 246`, the cloud review, which the user starts and which is billed. It does not run
  the completeness pass, so do that pass on its own afterwards.

## Already known

From reviewing `dc8573b7b` (the settings path-reader consolidation, the newest commit on the branch):

Both are fixed in `9b43b688d`. The window and the fake now follow the store's rule that an array is one
value.

- **Low (area 5).** The window's settings port read paths with its own walker, which descended into
  arrays, while the store's `getIn` (`features/settings/document.ts`) does not. A write at a path through
  an array element is invalid either way. But the store checks the window's `expected` value before it
  validates the write, so the user was told "This setting changed since editing began" instead of what
  is actually wrong with the write. The port now uses `getIn`.
- **Low (area 5).** `fakeSettings` (`packages/apack-sdk/src/testing/fake-settings.ts`) used the same
  array-descending rule for reads, writes and resets. A read through it always addresses an owner, so
  only a write through an array element could show the difference. It now uses `isPlainObject`.
