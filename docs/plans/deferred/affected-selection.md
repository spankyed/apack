# Affected-only selection for the CI strict route

Status: deferred by request, 2026-10-21. Designed and approved, not started. Resume when the owner schedules it;
it implements decision 3 of the [validation budget plan](../../archive/plans/validation-feedback-budget.md), whose outcome carries it forward.

## Context

The strict gate (`.github/workflows/strict-chain.yml`) always runs `--all`. It takes 35–42 minutes whatever
the change. [The budget plan](../../archive/plans/validation-feedback-budget.md)'s decision 3 asks for selection by source impact: pin a comparison base, run what
the branch's diff can reach, expand visibly when unsure, and keep exhaustive `--all` for boundaries. The CLI
integration and native specs cannot run on the developer's Mac, so this starts on the CI strict route, as the
user chose. The user also chose spec-level selection inside the pools, with safe fallbacks.

**What to expect (found while designing):**
- **Package source edits still run whole suites.** Most pooled specs read the built packages
  (`bin/apack.mjs` runs `dist`; every integration suite is `packages: true`). No import graph shows which spec
  reads which built file. So an edit to cli, sdk, host, ears, ui or testing source still runs those suites
  whole.
- **The win is skipping work outright.** A renderer, app, `default-setup`, scripts, docs or tests-only edit
  skips pool suites and steps entirely.
- **Narrowing to individual specs happens only for edits inside a suite's own `tests/` tree.**
- **Follow-up:** narrowing package-source edits needs recorded per-spec reads of the built output, the
  `dep-files.ts` "actual reads" pattern.

## Design

**Core rule: a changed file reaches a step or suite exactly when the cache would say it does.** No second
inventory, so selection is as sound as the local chain cache already is.

### 1. Selector: `scripts/lib/affected.ts` (new library, no `main`)
- `compareWith(baseRef, root)`:
  - **Base:** `git rev-parse --verify`, `git merge-base <base> HEAD`, then `head`.
  - **Changed files:** `git diff --name-status -z -M <mergeBase>` (committed, staged and unstaged) plus
    `git ls-files --others --exclude-standard` (untracked).
  - **Renames** count as an add plus a delete of the old path.
  - **Failure** returns `missing`.
- `selectAffected(comparison)` → `Selection`:
  - `{ comparison, everything?: reason, steps: name → {selected, why}, pools: {integration, native} → per suite {whole: why} | {specs: [{file, why}]} }`
- `affectedOnly(only, selection, steps)` drops unselected steps from a job, keeping the upward producer
  closure within the job.
- **Reuses:**
  - `orderedSteps`, `dependsOn`, `suiteInputs`, `SUITE_READS`, `INTEGRATION_SUITES`, `NATIVE_SUITES`
    (`scripts/lib/chain-steps.ts`);
  - `unitFor` (`scripts/lib/chain-stamps.ts`);
  - `reachableFrom`, `spawnSitesIn`, `tsFilesUnder` (`scripts/lib/process-spawns.ts`, `module-graph.ts`);
  - `specFiles`, `halfOfPath` (`scripts/lib/spec-halves.ts`);
  - `IS_SPEC`, `couldBeCovered` (`scripts/lib/spec-plan.ts`; export the latter).
- **One shared predicate:** add `unitReads(unit, rel)` to `packages/apack-host/src/build/packages-built.ts`,
  built from the same pieces as `fingerprintInputs`/`inputFiles`. Those are `covers`, `skipsFingerprint`,
  `excludedBySuffix`, outputs/excludes, and the dot-file and `node_modules` skips. Refactor both to call it,
  so the cache and the selector cannot disagree. Export `consumes` from `chain-steps.ts`.

### 2. Rules (first match wins)
**A. Everything**, with a printed reason, when:
- the base is missing or unresolvable;
- a changed file is in the selector's own declaration closure. Derived:
  `reachableFrom([affected.ts, chain.ts, test-unit-pool.ts, packages-built.ts], [scripts, packages/apack-host/src])`
  covers `chain-steps`, `typecheck-legs`, `unit-suites`, `spec-halves`, `workspace-deps`, `unit-pool`,
  `BUILD_UNITS` and the rest;
- the root `package.json` or `package-lock.json` changed;
- a deleted or renamed-away path that no step reads at head and that isn't prose;
- an unknown git status;
- anything under `.github/workflows/` changed.

**B. Steps** (the app and rest jobs). A step is selected if `unitReads(unitFor(step), file)` holds for some
changed file, or one of its producers is selected. Producers being selected is what covers gitignored generated
inputs. The producers job is unchanged and always runs, so the typecheck legs' build infos stay available.

**C. Pool suites** (integration and native, per half):
- **Tier 1, the gate:** the suite is selected if a changed file satisfies `unitReads` over
  `suiteInputs(suite, half)`, or a producer it consumes is selected.
- **Tier 2, narrowing:** the suite runs **whole** if any reaching file:
  - came through a producer;
  - is outside `packages/<suite>/tests/`;
  - belongs to a `repo: true` suite;
  - is a deleted non-spec file;
  - is not code;
  - is in the config's `setupFiles`/`globalSetup` closure;
  - or is reached by no spec's import closure (`new URL`, files read with `fs`).

  Otherwise it narrows to: specs whose import closure contains a changed file, every spawning spec of that
  half, and added or renamed specs.

### 3. Pool runner
- `scripts/lib/unit-pool.ts`: `POOLS.*.run(stale, workers, files?)` appends spec paths plus
  `--passWithNoTests` (integration and native only).
- `scripts/test-unit-pool.ts`: `--affected=<sha>`.
  - Everything → today's behaviour.
  - No suites → prints "nothing the diff reaches" and exits 0.
  - Otherwise it runs the selected files. It records no stamps, like a shard (`DIAGNOSTIC_RUN_ENV`).
- **Guard:** an unsharded run fails unless every requested file actually ran (`readReportedRun`), since vitest
  path filters are substrings.
- **Shards:** confirm vitest 3.2 accepts `--shard` with fewer files than shards. If it doesn't, slice the
  sorted list in the pool and skip an empty slice.

### 4. Chain
- `scripts/lib/chain-flags.ts`: add the `affected` value. Document it in root `CLAUDE.md`
  (`chain-table.spec.ts` holds that).
- `scripts/chain.ts`: with `--affected <ref>`, compute the selection once and print the header (base and head
  SHAs, changed count, or `EVERYTHING: why`). Then apply `affectedOnly`, print `skip <step> <why>`, and pass
  `--affected=<pinned sha>` to kept pool steps beside `shardArgs`. It composes with `--all`, `--strict` and
  `--job`.
- `--dry --affected <ref>` prints, without running anything: changed files, step run/skip with why, pool suites
  whole or as a spec list, then the existing plan. Locally: `npm run chain -- --dry --affected origin/master`.

### 5. Workflows
- `ci.yml`: add an `affected_base` string input (empty means exhaustive), passed to the strict-chain call.
- `strict-chain.yml`:
  - an `affected_base` input, and `fetch-depth: 0` when it is set;
  - the producers job pins `git merge-base` as job output `base_sha` and writes the `--dry --affected` table to
    `$GITHUB_STEP_SUMMARY` under an "AFFECTED-ONLY, not exhaustive" banner;
  - consumers add `--affected "$BASE_SHA"` and append their own run/skip block to the summary.

## Tests (`packages/internal-repo-checks/tests/`, behavioural)
- **`affected.spec.ts`**, over an injected comparison plus a temp mini repo:
  - **Docs and guides:** docs and `CLAUDE.md` select nothing, but content markdown does select.
  - **Renderer edit:** selects no pool suite, but does select the app steps.
  - **SDK edit:** selects suites whole, via `packages:ensure`.
  - **In the mini repo:**
    - a helper edit selects its importers plus the spawning specs;
    - a setup-file or fixture edit selects the suite whole;
    - deleting a helper selects the suite whole;
    - deleting an unrelated spec forces nothing;
    - a rename selects the new path.
  - **The everything rule over the derived closure:** each closure file triggers it, and a file outside the
    closure doesn't. This shows the derivation isn't empty.
  - **Root files and dead paths:** `package.json`, the lockfile and dead deletions each trigger everything.
  - **Job closure:** a smoke-only change keeps `build:runtime`.
- **`affected-reach.integration.spec.ts`:** for every step and tracked file, `unitReads` equals membership in
  the step's fingerprint walk. This is the equivalence that makes selection as sound as the cache.
- **`affected-git.integration.spec.ts`:** a temp git repo checks committed, staged, unstaged, untracked,
  deleted and renamed statuses, and a missing base. Add it to `subprocess-inventory`'s list.
- **Extend existing specs:** `unit-pool` (the file arguments) and `chain-only` (`affectedOnly`).

## Verification
- **Locally:**
  - `npm run typecheck`, `npm run lint:check`, `npm run check:specifiers`;
  - `npm run spec` for scripts and internal-repo-checks;
  - `npm run chain -- --dry --affected origin/master` on this branch and on hand-made diffs, recording the
    expected tables.
- **CI:** dispatch `ci.yml -f strict_chain=true -f affected_base=<sha>` on throwaway commits:

  | Change | Expected |
  |---|---|
  | Renderer edit | No pool suites; app steps run |
  | CLI `src` edit | CLI, publish and repo suites whole; native whole |
  | Docs-only | Every consumer skips |
  | `scripts/lib` file outside the closure | internal-repo-checks suite whole |
  | `chain-steps.ts` edit | EVERYTHING |
  | CLI `tests/_support` helper edit | Narrowed to its importers plus spawners |
  | Planted failing helper | The affected run fails |

  Then one exhaustive strict run (no base) on the converged commit, as decision 4 requires after selector
  changes.
- **Record** the selections and timings in the [validation budget plan](../../archive/plans/validation-feedback-budget.md).

## Out of scope
- Affected selection as the local `npm run chain` default.
- Spec-level selection in the host and pack pools.
- Skipping the producers job.
- Narrowing package-source edits (needs recorded per-spec reads of the built output).
- Automatic or pull-request triggers.
