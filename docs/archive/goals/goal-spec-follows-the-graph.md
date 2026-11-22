# Goal: `npm run spec` runs every spec that covers what you changed

> **Done** (`0074e26dd`..`232f85e78` on `AS/test-pipeline`). The text below is the plan as written; two of
> its Decisions were corrected afterwards and one Deferred item was closed, both under the Outcome. For
> what the command does now, see the root `CLAUDE.md` beside the spec commands, and
> `internal-repo-checks/tests/spec-plan.spec.ts` for the routing itself.

```
# Goal: npm run spec runs every spec that covers what you changed

Implement docs/goals/goal-spec-follows-the-graph.md on AS/chain-inputs, at or after 8acdf6c69 — the base
its Background was surveyed at.
Before Phase 1, confirm the base: `npm run spec -- packages/apack-sdk/src/types/sdk-entities.ts` reports
one package, and the root vitest.config.ts lists eleven projects. If either is already false, stop and say
so — the survey was taken somewhere else.
Read Background, Decisions, Phases and Constraints first. Decisions are final: implement them, don't
reopen them or stop to ask.
Where a detail isn't specified, pick the conventional option, note it in the final summary, and keep
going. No backward compatibility in code (root `CLAUDE.md`, "Backward compatibility" — it is a standing
rule, not this goal's choice): change signatures, move modules, migrate every in-repo caller, test,
fixture, template and doc in the same change, and fix forward.

Finished when:
- Phases 1–4 are implemented and each meets its "Done when"; every new guard or helper is
  mutation-checked.
- Editing a package's source runs every spec that covers it, in whatever package it lives, and the
  routing is a pure function a spec can assert against.
- The cost is measured and recorded: a shallow edit, a deep one, and what each was before.
- npm run typecheck; npm run spec-cost:check; npm test -w @app/internal-repo-checks; npm run chain once at the end.
- A final summary: phase → done/deferred, evidence, and the conventional choices made.
- The doc is in `docs/archive/goals/`, with its status blockquote and an Outcome section, committed.

Commit as you go:
- Commit each phase when its "Done when" holds and the checks are green — not once at the end.
  Conventional message, no Co-Authored-By or session lines, `git commit -- <paths>` naming only that
  phase's files.
- Check `git diff --cached` first: another agent works in this checkout and stages files.
- Don't push, tag, or open a PR unless the user asks.

Never:
- push, tag or open a PR unless the user asks in this session.
- npm publish, create GitHub releases, or trigger workflows (dry runs only).
- open, copy or modify ~/Library/Application Support/apack* or any real data dir.
- pkill/killall Electron or node; launch the app outside the test env without an isolated
  APACK_USER_DATA_DIR.
- run bare tsc on packages/preload, `npm install` in the example pack, or edit version/release metadata.
- delete or loosen a test to make a number move.
```

## Background (surveyed 2026-09-26 at `8acdf6c69`)

`npm run spec` answers *"what could my change break?"* by asking which package a file belongs to and running
that package's specs. `scripts/spec.ts`'s own header says it runs **"the narrowest set of specs that could
fail"**. For a file only its own package tests, that is right. For everything else it is **confidently
wrong**: it reports a green run of specs that do not cover the change.

| Edited package | Specs covering it live in | Packages `npm run spec` runs |
|---|---|---|
| `@apackdev/ears` | 8 packages | **1** |
| `@apackdev/sdk` | 7 | **1** |
| `@apackdev/host` | 6 | **1** |
| `@apackdev/ui` | 6 | **1** |
| `@apackdev/testing` | 4 | **1** |
| `@app/internal-publish-checks`, `@apackdev/cli`, `@app/api` | 2 each | **1** |

**29 cross-package edges the command does not follow.** Editing the EARS engine — the module every pack's
data goes through — runs one suite of the eight that cover it.

### The chain already disagrees with it

`suiteInputs` (`scripts/lib/chain-steps.ts`) includes `workspaceDeps(dir).flatMap(dependencySource)`, so a
dependency's `src` is an input to every dependent's suite: the chain re-runs `@apackdev/host`'s projects when
`@apackdev/sdk`'s source moves. Two mechanisms in one repo hold different beliefs about what covers what, and
the cheap one — the one run per change — holds the wrong one.

### The fix is already in the tree, unused

The root `vitest.config.ts` lists eleven projects, and vitest resolves `related` against the module graph
across all of them **in one process**. Measured 2026-09-26 from the repo root, on a machine at load ~10 of 10 cores:

```
$ npx vitest related --run packages/apack-sdk/src/types/sdk-entities.ts
  Test Files  104 passed (104)
       Tests  1022 passed (1022)
  28.0s
```

So there is no per-package startup tax to design around, and no need to compute a dependency graph by hand:
**vitest's graph is better than the declared one**, because it is the actual import graph and it is
transitive. A first draft of this goal costed a per-package fan-out at 0.83s × N and proposed deriving
candidates from `workspaceDeps`. Both were unnecessary; the measurement retired them.

**What 28s buys is not overhead — it is 104 spec files that genuinely cover that type.** The cost is
proportional to blast radius, which is the right shape: a type every pack's data flows through should cost
more to verify than a component nothing imports. A shallow edit stays a 1–3s loop because little covers it.

### One thing `related` cannot reach, by construction

`@app/default-setup` is not in the root projects and cannot be: it resolves the published `dist` while the
host projects resolve source, and Node conditions are per process (`UnitSuite.kind`). So `related` on a
workspace source path finds nothing there — measured, 1.5s and zero matches for the same file — because
that suite never imports the source at all. A change to `@apackdev/sdk` reaches it through the rebuilt `dist`,
which is what `SUITE_READS` and `packages:ensure` express in the chain and what a module graph cannot see.

That is a limit of the mechanism, not a gap to close here. It is stated in the command's output rather than
papered over (Decision 5).

## Decisions

Final.

1. **Vitest's module graph is the authority.** One root `vitest related` for a file under `packages/*/src`,
   not a loop over packages and not a graph computed from manifests. It is the actual import graph, it is
   transitive, and it is one process.
2. **The default is the correct answer.** `npm run spec -- <source file>` runs every spec that covers it.
   A fast wrong answer is not a faster command; it is a broken one, and a default people reach for by habit
   is the one that has to be right.
3. **No narrowing flag.** A first draft added `--here` to run only the edited file's own package, and it
   was solving a solved problem: while iterating you run the spec you are working on — `npm run spec --
   chain-schedule` finds it by name in 1.7s — and the wide answer is for when you are done, which is what
   the root `CLAUDE.md` already advises. It would also be the first flag `spec.ts` itself consumes, and
   that script splits arguments at the first `-` and passes the rest to vitest verbatim *precisely* so it
   need not know which flags take a value. A convenience is not worth eroding that.
4. **`packages:ensure` runs once before a root run.** Today `spec` delegates to each package's `test`
   script, so npm's `pretest` fires; a root invocation bypasses that, and without it the run tests whatever
   `dist` is on disk. `scripts/test-unit-pool.ts` solves this the same way and for the same reason.
5. **The pack suite's absence is reported, not hidden.** When a root run finishes for a source file, the
   command says that `@app/default-setup` tests against the built packages and is not in this answer. A
   limit a user can see is a limit; a silent one is a bug.
6. **Routing is a pure function.** Phase 1 factors "what does this target run" into something returning a
   plan — the commands and directories — so a spec asserts the routing without running anything. Today it
   is inline in a loop over targets and cannot be tested.

## Phases

### Phase 1 — a routing plan, and the root run behind it

Factor the target handling in `scripts/spec.ts` into a pure function: target → the runs to make. A file
under `packages/*/src` plans one root `vitest related` preceded by `packages:ensure`; a spec path, a
directory and a name-match keep today's per-package plan; `scripts/` and the configs keep their explicit
route to `@app/internal-repo-checks`.

**Done when:** `npm run spec -- packages/apack-sdk/src/types/sdk-entities.ts` runs 104 files rather than
the specs of one package, and the plan for every target shape is asserted by a spec in `@app/internal-repo-checks`
that runs nothing.

### Phase 2 — the change set follows the same path

With no arguments the command runs `--changed` per package. `--changed` resolves the module graph the same
way `related` does, so the same root run answers it in one process. Keep the per-package path for a change
set that touches only one package's tests, where a root run would be slower than what it replaces.

**Done when:** an uncommitted edit to `@apackdev/sdk/src` runs the dependents' specs, and a change confined to
one package's `tests/` still runs only that package.

### Phase 3 — the numbers

Measure and record, idle: a shallow edit (`@app/renderer`, nothing depends on it),
a mid one (`@app/api`), and a deep one (`@apackdev/sdk/src/types/sdk-entities.ts`) — before and after.
Update the root `CLAUDE.md`'s description of the command, which currently promises "the specs your
uncommitted changes affect, in every package they touch" and does not deliver it.

**Done when:** the three measurements are recorded, and the docs describe what the command does — including
that naming a spec is how you narrow, since that is the answer people will want on first meeting the wide
default.

### Phase 4 — the guard

A spec in `@app/internal-repo-checks` over the routing function from Phase 1: a package source file plans a root
run, a spec path plans its own package, and a `scripts/` path plans `@app/internal-repo-checks`. It asserts the plan, so it costs nothing and cannot drift from the implementation.

Mutation-check it by making the source-file case plan one package again and watching it named.

**Done when:** the guard passes, has been made to fail, and `npm run chain` is green.

## Deferred

- **Reaching `@app/default-setup` from a source edit.** It tests the published `dist` by design, so no
  module graph can connect the two. The chain expresses it through `SUITE_READS` and rebuilt outputs.
  Closing it in `spec` would mean rebuilding the packages and running a second pool — which is most of
  `npm run test:unit`, and that command already exists.
- **The E2E and fixture-pack suites**, for the same reason: they read the built app, not the source.

## Constraints

- **Measure on an idle machine, and record what you measured on.** The figures above were *not*: they were
  taken 2026-09-26 at load ~10 on a 10-core machine, so they are upper bounds. Re-take them quiet before
  treating any of them as a budget. The counts beside them — 104 files, 4 against 3 — are not affected. The first draft of this goal was costed on a model that one
  command disproved; prefer the command.
- **A guard that cannot fail is worse than none.** Break Phase 4's guard on purpose and watch it fail, in a
  copy or a worktree — a mutation in this shared tree has reached the index before.
- **Another agent works in this checkout.** Check `git status` before committing and name paths explicitly.
- **Don't relitigate settled decisions.** Which package a spec lives in
  ([`goal-test-placement.md`](goal-test-placement.md)), cost-based placement, and the two
  pools and why they cannot be one (`UnitSuite.kind`) are final. This goal changes which specs a command
  runs, and nothing about where a spec belongs.

## Outcome (2026-09-26)

| Phase | Status | Evidence |
|---|---|---|
| 1 — a routing plan, and the root run behind it | **done** | `0074e26dd`. `scripts/lib/spec-plan.ts`; `sdk-entities.ts` runs 104 files where it ran one package's |
| 2 — the change set follows the same path | **done** | `0074e26dd`. One root `--changed`, with a per-package run kept for a non-root package |
| 3 — the numbers | **done** | `a4215dd9b`, which also recorded that they were taken under load and are upper bounds |
| 4 — the guard | **done** | `spec-plan.spec.ts`, mutation-checked; 33 cases by the time the corrections below landed |

### Corrections to the Decisions

- **Decision 5 was too broad, and the broad form was worse than nothing.** It said the pack suite's absence
  is reported when a root run finishes for a source file, and that is what shipped: the note was set on
  *every* root run. `@app/default-setup` depends on five of the twelve packages, so `npm run spec --
  packages/renderer/src/main.ts` printed "not covered: @app/default-setup" about a package the pack has never
  depended on. The corrected rule is that the note is derived — from `workspaceDeps`, the function the chain
  keys its cache on — and prints only when a pack suite is genuinely out of reach. *A limit a user can see is
  a limit* still holds; a limit printed when it does not apply is wallpaper.
- **Decision 2 held, and it is what settled where the pack-source fix belongs.** "The default is the correct
  answer" is why a pack's own source file plans that pack's suite with no flag, rather than being rescued by
  `--full`: a flag that fixes a wrong default leaves the default wrong. The same decision's cost argument did
  *not* extend to the cross-seam direction, which costs a build rather than more specs, so that stayed opt-in.

### A Deferred item, closed — and the estimate that kept it deferred

Deferred said: *"Closing it in `spec` would mean rebuilding the packages and running a second pool — which is
most of `npm run test:unit`, and that command already exists."*

Measured 2026-09-26: `packages:build` forced is **14s** and `test:unit:pack` forced is **18s**, so the whole
of it is **33s** on a shallow `@apackdev/sdk` edit — against `test:unit`'s two full pools. `npm run spec:full`
closes it, and the pack pool re-reads its own stamp, so the 18s is only paid when something it reads moved.

That is the second time in this repo a proposal was argued at length and settled by one command; the first
was this goal's own per-package fan-out, costed at 0.83s × N and retired by a single `related` run. The
standing lesson is in the root `CLAUDE.md`: *measure before you optimise, and before you accept someone
else's measurement* — including your own prose.

### What the graph still cannot see, recorded rather than deferred again

- **A content source change does not reach the goldens.** `related` on
  `src/content/actions/claude-code/handle-fork.ts` finds the spec that imports it and not `content-parity.spec.ts`,
  which reads `dist/*.content.json`. `src` → `apack build` → compiled content → golden is a build edge, like the
  `dist` seam this goal closed, and nothing routes it.
- **`apack.json` → codegen → specs** is the same shape: a manifest change regenerates `src/__generated__/`,
  which specs do import, so a *regenerated* tree is covered — but editing the manifest alone reaches nothing
  until codegen runs.
- **`vitest related` cannot walk a pack's own sources at all**, its config loading no Vue plugin and
  `vite-tsconfig-paths` not applying the pack's aliases inside a `.vue` file. That is why a pack source file
  runs its pack's whole suite (18s) rather than the 1–3 specs that cover it (2.6s, measured with the surface
  and `loose: true` added by hand). [`goal-pack-test-config.md`](goal-pack-test-config.md) closes
  it for every pack rather than only the built-in one.
