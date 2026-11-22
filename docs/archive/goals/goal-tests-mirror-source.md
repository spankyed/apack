# Goal: a spec's path is the path of what it covers

> **Done** (`731d1e2d9`..`64ba820c5` on `AS/test-pipeline`). The text below is the plan as written. For
> the rule and the suite as it is now, see
> [`docs/references/test-inventory.md`](../../references/test-inventory.md); the two directories that still
> name no `src/` counterpart, and why that is a property rather than pending work, are in
> `internal-repo-checks/tests/spec-placement.spec.ts`'s `NOT_MIRRORED_YET`.

```
# Goal: a spec's path is the path of what it covers

Implement docs/goals/goal-tests-mirror-source.md on AS/chain-inputs, at or after e75b0e539 — the base its
Background was surveyed at. After goal-test-placement.md, which is archived: this extends its rule one level
down, from which package a spec lives in to where inside it.
Before Phase 1, confirm the base: packages/default-setup/tests/unit holds 76 flat specs plus _hybrid,
migrations, content-parity and helpers; packages/default-setup/tests/integration holds one spec, inside a
second _hybrid. If that is already false, stop and say so — the survey was taken somewhere else.
Read Background, Decisions, Phases and Constraints first. Decisions are final: implement them, don't
reopen them or stop to ask. The Open decision must be settled with the user before Phase 3; if it is still
marked open, stop and ask.
Where a detail isn't specified, pick the conventional option, note it in the final summary, and keep
going. No backward compatibility in code (root `CLAUDE.md`, "Backward compatibility" — it is a standing
rule, not this goal's choice): change signatures, move modules, migrate every in-repo caller, test,
fixture, template and doc in the same change, and fix forward.

Finished when:
- Phases 1–5 are implemented and each meets its "Done when"; every new guard is mutation-checked.
- No directory under any package's `tests/` denotes a level, a cost half, or a history.
- Every directory under `tests/` mirrors one under that package's `src/`, or is `_`-prefixed support, or
  is on a recorded list with a reason and a stale-entry check.
- Every suite's spec count and pass count is unchanged by the moves, shown before and after.
- npm run typecheck; npm run spec-cost:check; the suites this goal touches; npm run chain once at the end.
- A final summary: phase → done/deferred, evidence, and the conventional choices made.
- The doc is in `docs/archive/goals/`, with its status blockquote and an Outcome section, committed.

Commit as you go:
- Commit each phase when its "Done when" holds and the checks are green — not once at the end. A phase is
  one package, so each lands on its own. Conventional message, no Co-Authored-By or session lines,
  `git commit -- <paths>` naming only that phase's files.
- Use `git mv` for every move, so the rename is recorded rather than inferred.
- Check `git diff --cached` first: another agent works in this checkout and stages files.
- Don't push, tag, or open a PR unless the user asks.

Never:
- push, tag or open a PR unless the user asks in this session.
- npm publish, create GitHub releases, or trigger workflows (dry runs only).
- open, copy or modify ~/Library/Application Support/apack* or any real data dir.
- pkill/killall Electron or node; launch the app outside the test env without an isolated
  APACK_USER_DATA_DIR.
- run bare tsc on packages/preload, `npm install` in the example pack, or edit version/release metadata.
- delete, merge, rename or loosen a test. This goal moves files and changes nothing inside them beyond
  imports and the paths in their own comments.
```

## Background (surveyed 2026-09-25 at `e75b0e539`)

[`goal-test-placement.md`](goal-test-placement.md) settled *which package* a spec belongs
in. This settles *where inside it*, and the answer already exists — six of eight packages follow it, and
nobody wrote it down.

| Package | `tests/` top level | Scheme |
|---|---|---|
| `@apackdev/sdk` | build, database-console, env, events, fe, framework, ids, logger, repositories, runtime, content, services, steps, testing, utils | **mirrors `src/`** |
| `@apackdev/host` | build, bus, database, fe, features, logs, migrations, packs, secrets, services | **mirrors `src/`** |
| `@app/renderer` | adapters, boot, runtime, transport, views | **mirrors `src/`** |
| `@apackdev/cli` | app, build, cli, harness, packs, helpers | mostly mirrors (`cli` ↔ `src/commands`) |
| `@apackdev/ears` | contract, lmdb, + 3 flat | partial |
| `@app/internal-repo-checks` | flat (18) | flat, like the `scripts/` it covers |
| **`@app/api`** | **runtime, unit** | **by level** |
| **`@app/default-setup`** | **unit, integration, fixtures** | **by level** |

The two deviations are the two that read as ad-hoc, and one of them was made on 2026-09-25 by the session
that wrote this doc — `api/tests/unit` was split into `unit/` and `runtime/` to get a fast subset, which is
a level split. It is half-redeemed by accident: `tests/runtime/` does mirror `src/runtime/`, where the
composed app lives. `unit/` mirrors nothing.

### What `_hybrid` is, and why it is the clearest case

`default-setup/tests/unit/_hybrid/` holds three specs and a README that says:

> Tests that call default-setup's repositories and backend modules directly, without `startApp`. […] **The
> directory's name is historical: these specs once imported the API's EARS and repository modules too.**

So the name denotes a *level* ("repository-level"), it is nested inside `unit/` which is also a level, it is
named after a coupling that no longer exists, and there is a second `_hybrid/` under `integration/` holding
one file — a directory of one inside a directory of one. Its three specs are about flows, brain and actions.
Saying so places them; nothing else needs to.

### Two mechanisms for one fact

The repo already decided that a level is not a directory concern.
[`goal-test-cleanup.md`](goal-test-cleanup.md)'s Decision 13: *"don't move files between directories:
`tests/build/`, `tests/cli/`, `tests/app/` and `tests/harness/` group by area, and the suffix is
orthogonal."* The cost half rides on the `.integration.spec.ts` filename suffix, decided by measured cost
([`goal-measured-placement.md`](goal-measured-placement.md)), precisely so that directories are free to
carry subject.

`default-setup` has both: `unit/` and `integration/` directories *and* the suffix. Two mechanisms for one
fact is how they drift — and they have, because `tests/integration/` holds exactly one spec whose name also
ends in `.integration.spec.ts`.

### A hierarchy spelled with hyphens

76 of default-setup's specs sit flat under `tests/unit/`, with the tree encoded in their names:
`brain-flow-children`, `brain-flow-runs`, `brain-subflow-fire`, `brain-switch-node`,
`brain-trace-tree-state`, `browser-connected`, `browser-normalize-tabs`, `browser-own-settings`,
`claude-code-approval-response`, `claude-code-args`, `claude-code-ask-user-question`… The source they cover
is already a tree: `src/features/<name>/{be,fe}`.

### The layout is also a published contract

`apack-cli/src/commands/init.ts:135` scaffolds `include: ['tests/unit/**/*.spec.ts']` into every pack a
third party creates with `apack init-tests`. So the built-in pack's layout is not a private matter: change
it and the reference pack stops looking like what the tool generates, unless the scaffold changes with it.
That is the Open decision below.

### What names a path today, and would need moving with it

| Reference | What it names |
|---|---|
| `default-setup/package.json` `content-parity:check` / `:update` | `npm test -- tests/unit/content-parity` |
| `default-setup/vitest.config.ts` | `tests/unit/**`, `tests/integration/**` |
| `default-setup/src/defs/database.ts:4` | `tests/unit/database-console-globals.test.ts`, in a comment |
| `api/vitest.config.ts` | `tests/unit/**`, `tests/runtime/**` |
| `scripts/lib/spec-cost.ts:52` | `_hybrid/claude-code-permission-flow`, in a comment |
| every `etc/spec-cost.json` | keys are spec paths, so each moved suite re-records |

`PLACEMENT_GUARD` in `spec-cost.ts` names `tests/suite-split.spec.ts` in `@app/internal-repo-checks`, which this goal
does not touch.

## Decisions

Final.

1. **A spec's path under `tests/` mirrors the source path it covers, exactly.**
   `src/features/brain/be/trigger-dedupe.ts` → `tests/features/brain/be/trigger-dedupe.spec.ts`. Exact
   rather than collapsed, because exact is checkable and collapsing is a judgement call per file.
2. **A directory never denotes a level, a cost half, or a history.** `unit/`, `integration/`, `_hybrid/` go.
   The cost half is the `.integration.spec.ts` suffix and nothing else (Decision 13, `goal-test-cleanup.md`).
3. **Support directories take a `_` prefix**: `_support/` for helpers and fixtures. The prefix is what tells
   a reader, and the guard, that it is not claiming to mirror anything.
4. **Nothing inside a spec changes but its imports and the paths in its own comments.** No deletion, no
   merge, no rename of a test, no timeout edit. A move that also changes behaviour cannot be reviewed as a
   move, and this goal is large enough to need reviewing as one.
5. **Every move is `git mv`**, and every phase shows the suite's file and test counts before and after. A
   restructure that silently drops a spec is the failure this is most exposed to; `goal-test-placement.md`
   Phase 5 caught nothing precisely because it checked.
6. **A spec that covers several modules mirrors the entry point it drives.** `export-round-trip.spec.ts`
   drives `exportActions` and `exportPrompts`; it goes under the feature whose repository it calls, not into
   a new directory for things that span two.
7. **`@apackdev/ears` and `@apackdev/cli` are in scope only where they already deviate**, and `@app/internal-repo-checks`
   stays flat: its 18 specs cover `scripts/`, which is flat, so flat mirrors it.

## Open decision — **settled 2026-09-25: the scaffold changes with the rule**

`apack init-tests` scaffolds the same layout the built-in pack uses, so the reference pack is what the tool
generates. The CLI's own scaffold specs and the fixture packs move with it. Nothing breaks downstream: no
pack exists outside this repo (root `CLAUDE.md`, *Backward compatibility*).

The reasoning, kept:

**Does `apack init-tests`' scaffold change with it?** `init.ts:135` writes `tests/unit/**/*.spec.ts` into
every pack created by the CLI.

- **Change it**, so a scaffolded pack gets the same rule as the built-in one and the reference pack is what
  the tool generates. Costs: the CLI's own scaffold specs and the fixture packs move with it, and any pack
  built from the old scaffold keeps a layout the docs no longer describe — though no such pack exists
  outside this repo (root `CLAUDE.md`, "Backward compatibility").
- **Leave it**, and record that the built-in pack is organised as a large pack should be while the scaffold
  stays deliberately minimal for a new one with three specs. Costs: two conventions, and the reason lives
  only in a comment.

## Phases

### Phase 1 — the rule, written where it is read

Add the rule to `packages/default-setup/CLAUDE.md` and to `docs/references/test-inventory.md`, and state it
in one line in the root `CLAUDE.md` beside the spec commands. It is currently inferable from six packages
and written in none.

**Done when:** a contributor adding a spec can find where it goes without reading another package.

### Phase 2 — the guard

Extend `internal-repo-checks/tests/spec-placement.spec.ts`: every directory under a package's `tests/` either names
a directory under that package's `src/`, or starts with `_`, or is on a recorded list with a reason and a
stale-entry check. Land it with today's exceptions recorded, so the guard is green before anything moves and
each phase below deletes entries rather than adding them.

Mutation-check it: add `tests/nonsense/` to a package and watch it named.

**Done when:** the guard passes with an exception per deviation, each carrying a reason.

### Phase 3 — `@app/default-setup`

The large one: 76 flat specs plus four directories. Mirror `src/`, which is `features/<name>/{be,fe}`,
`migrations/`, `content/`, `extensions/`, `app-settings/`. `_hybrid`'s three specs go under the features they
cover; `integration/_hybrid`'s one keeps its suffix and goes under `features/code/`; `content-parity` follows
`src/content/`; `helpers` and `fixtures` become `_support/`. Move the `package.json` content-parity scripts, the
vitest config's include, and the comment in `src/defs/database.ts` in the same commit.

**Done when:** 87 files and 720 tests, unchanged; no directory under `tests/` denotes a level; the
`content-parity:check` and `:update` scripts work; `spec-cost:update -- --suite default-setup` recorded.

### Phase 4 — `@app/api`

`tests/runtime/` already mirrors `src/runtime/`. Distribute `tests/unit/`'s five over the source they cover
(`src/boot/`, `src/transport/`, `src/adapters/`), except `source-layout.spec.ts`, whose subject is the
package's own file list and which therefore mirrors nothing — the first honest `_`-prefixed case, or an
exception with its reason.

**Done when:** no `unit/` directory; 15 files and 70 tests, unchanged; re-recorded.

### Phase 5 — `@apackdev/ears` and `@apackdev/cli`

The two partial cases, and the smallest. `@apackdev/ears` has three flat specs beside `contract/` and `lmdb/`;
`@apackdev/cli` has `cli/` where the source is `src/commands/`, plus `harness/`, `packs/` and `helpers/`.
Rename or record each, then delete the matching exceptions Phase 2 left.

**Done when:** Phase 2's exception list holds only entries whose reason is a property of the package rather
than work not yet done.

## Deferred

- **`@app/internal-repo-checks` staying flat** is Decision 7, not a deferral, but it is worth revisiting if that
  package grows past what one directory listing shows at a glance.
- **Colocation**, which `goal-test-placement.md` Phase 5 removed from `default-setup`. Mirroring is the
  middle answer between colocation and a flat pile; if mirroring proves awkward in practice, colocation is
  the alternative to reconsider, with that goal's Open decision recording why it was not chosen then.

## Constraints

- **Counts before and after, every phase.** A restructure's characteristic failure is a spec that stops
  being collected, and a config's `include` is what decides. `npm test -w <pkg>` before and after is the
  check, and the numbers go in the commit message.
- **`git mv`, never delete-and-create**, so the history survives the move.
- **Re-record, never hand-edit, a cost.** Paths are the keys in `etc/spec-cost.json`, so every moved suite
  re-records with `spec-cost:update -- --suite <dir>`, measured with nothing else on the machine.
- **A guard that cannot fail is worse than none.** Break Phase 2's guard on purpose and watch it fail, in a
  copy or a worktree — a mutation in this shared tree has reached the index before.
- **Another agent works in this checkout.** Check `git status` before committing and name paths explicitly.
- **Don't relitigate settled decisions.** Cost-based placement and the `.integration.spec.ts` suffix, the
  two pools, the tier table and its budgets, and which package a spec belongs in
  (`goal-test-placement.md`) are all final.

## Outcome (2026-09-26)

| Phase | Status | Evidence |
|---|---|---|
| 1 — the rule, written where it is read | **done** | `731d1e2d9`. `default-setup/CLAUDE.md` (new `## Tests`), `docs/references/test-inventory.md`, root `CLAUDE.md` beside the spec commands |
| 2 — the guard | **done** | `6af519dd3`. `spec-placement.spec.ts`, landed with nine entries so it was green before anything moved; mutation-checked again at the end (a planted `apack-ears/tests/nonsense/` is named) |
| 3 — `@app/default-setup` | **done** | `811d76e38`, with its 141 renames in `e27338c6d`. 87 files / 720 tests unchanged |
| 4 — `@app/api` | **done** | `ac5b4cd10`. No `unit/`; 15 files / 70 tests unchanged |
| 5 — `@apackdev/ears` and `@apackdev/cli` | **done** | `c9d48ba3a` (9 / 116), `6b6649e65` (38 / 310 and 15 / 187), `64ba820c5` (the scaffold and the fixture pack, 10 / 32) |

Every count is before and after the moves, and none of them changed.

### What the exception list is for now

It began as nine entries, each one work not yet done, and ended as two — and the two are a different kind,
which is recorded on the list itself. `apack-cli/harness` and `apack-cli/packs` name a module of a package
`@apackdev/cli` *depends on* (`@apackdev/testing`'s harness, `@apackdev/host/packs`), which its own `src/` has no
counterpart for and should not grow one. The bar for a new entry is written down beside them: not "this spans
two modules", which Decision 6 already places at the entry point it drives, but "what it covers is another
package's, and this package holds it on purpose".

### The conventional choices, since the plan did not specify them

- **A spec whose subject is the package rather than a module in it sits at `tests/` root**, which mirrors
  `src/` itself. That is eighteen of default-setup's 87 (the typed-EARS tiers, the registries, the event
  channels, the harness, the host's settings as a pack sees them), `api/tests/source-layout.spec.ts` — where
  the renderer's counterpart already sat — and four of the fixture pack's ten. The alternative for
  default-setup's generated-surface specs was `tests/__generated__/`, which reads as generated specs and is
  skipped by `specsUnder`'s walk besides.
- **A filename loses only the leading segments the target directory already spells.** `brain-flow-children`
  under `features/brain/be/` is `flow-children.spec.ts`; `brain-switch-node` under `extensions/steps/switch/`
  keeps its whole name, because `brain` is not what that directory says and dropping it would lose which
  side runs the node.
- **A relative `../../src/` import that the `@/` alias covers became the alias.** Six levels of `../` for
  `features/code/be/services/claude-code` was the worst of them, and the alias makes the next move free.
  `src/content`, `src/defs` and `src/migrations` have no alias, so those stayed relative and were re-expressed.
- **`content-parity:check` now runs `tests/content`**, which is the whole content suite rather than the five golden
  specs — 18 files and 4.1s. There is no directory holding exactly the five any more, and a listed set of
  five filenames is a list that goes stale silently.
- **`tests/e2e/**` is excluded from a pack's vitest include**, in the scaffold and in the fixture pack. It is
  Playwright's, run by `apack test`: a different runner, which is not the level a directory may not denote.
- **`_hybrid/README.md` was deleted** rather than moved. Its subject was the directory, and what it recorded
  beyond that — which spec covers what — is what the paths now say.

### What this did not close

`vitest related` cannot traverse `@app/default-setup` at all: its config loads no Vue plugin, so a graph walk
over `src/` dies on the first `.vue` file it reaches. `npm run spec` never does that walk — a source file
plans a root run, and that package is not a root project — so nothing here depends on it. Worth knowing
before anyone reaches for `related` inside that package, and separate from the reason
[`goal-spec-follows-the-graph.md`](goal-spec-follows-the-graph.md) excludes it, which is that Node conditions
are per process.
