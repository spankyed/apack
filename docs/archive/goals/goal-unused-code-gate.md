> **Done 2026-09-28.** `noUnusedLocals` is written into 14 workspace configs and inherited by the rest, so
> every config that compiles source reports it and every one of them reports zero.
> `unused-code-gate.spec.ts` fails when any of them drops the flag, when a package has TypeScript no config
> compiles, or when its two exception lists stop applying.
>
> Phase 4's lint half landed separately and better: `8549f81a5` pointed the root `oxlint` at `packages/`
> instead of adding `lint:check` to thirteen package.jsons, so one command covers every workspace and a new
> one is covered the day it exists. The cleanup was done in `44486da98`, `d8be2926d` and `a5c795c58`.
>
> See Outcome at the end for what the Background got wrong.

> **Re-verified 2026-09-28, later the same day, and still before the compiler half landed.** Phase 4's lint
> half had landed and the Background's figures no longer held. Read it before the table below it; where it
> looks ahead to what an implementer should do, the Outcome at the end records what was done.
>
> `lint:check` stopped excluding `packages/**` in `8549f81a5`. The root pass reads the whole tree now — 1767
> files, about a tenth of a second — with one exclusion: the CLI's scaffold templates, whose parameter names are
> what a pack author reads, so an unused one there is documentation rather than a finding. **Phase 4's
> requirement that lint cover every workspace with source is therefore met**, and its second half — a guard
> naming any workspace lint does not cover — is moot rather than outstanding: the root pass reaches every
> workspace, so there is no per-workspace script left to be missing. What holds that exclusion in place is
> `lint-scope.spec.ts` instead. Of the two workspaces that declared their own `lint:check`,
> only `@app/renderer` still does, and only because it adds `eslint`: `@app/default-setup`'s ran the same binary
> over the same 792 files the root pass already reads, so it was dropped rather than kept in sync.
>
> **The counts this goal was argued from were cleared in the same stretch** (`d8be2926d`, `44486da98`,
> `a5c795c58`). The 113 correctness findings behind that exclusion are at zero, and so is Phase 4's "51 across
> the ten unlinted packages". Measured with this goal's own `noUnusedLocals`, the four packages its table rests
> on report nothing:
>
> | package | the table below | 2026-09-28 |
> |---|---|---|
> | `@apackdev/host` | 44 | **0** |
> | `@app/api` | 21 | **0** |
> | `@apackdev/sdk` | 10 | **0** |
> | `@apackdev/ears` | 1 | **0** |
>
> **What still justifies the goal is narrower than 2.5×, and structural: the compiler reads files the linter
> cannot parse at all.** Measured while this landed, `oxlint` reported zero on
> `apack-ui/src/design/Autocomplete.vue` while `vue-tsc` reported two unused locals in that same file. An SFC is
> invisible to the linter, not merely under-covered, and no lint configuration closes that — which matters here
> because three of the workspaces are Vue-heavy. It also reports unused *types* (TS6196), which `no-unused-vars`
> does not. **Those two are the case for the gate; the arithmetic above is not.**
>
> Do not expect to reproduce a count: the remainder — a handful of hand-written `.vue` declarations across
> `@apackdev/ui` and `@app/default-setup`, generated code aside — was cleared as the gate went on, which is the
> goal working rather than evidence going missing.
>
> **Two properties to design for, both visible on the first run.** The gate fires on generated code — 13 of
> default-setup's first 18 were under `src/__generated__/`, including the `__contract_check_*` aliases codegen
> emits *in order to be unreferenced* — so either codegen stops emitting them or the directory is excluded, and
> the first is the honest fix. It is the one that landed, and excluding the directory was measured and found
> not to work at all: see the Outcome. And `noUnusedLocals` on its own leaves unused *parameters* to lint and to the `_`
> convention, which is where they are handled today.

> **Written in session** `c9f31de2-e94c-46ea-a2ac-2898390dc27d` (Claude Code, 2026-09-25). Resume it with `claude -r c9f31de2-e94c-46ea-a2ac-2898390dc27d`.

```
# Goal: every workspace is checked for unused code, by the check that already runs

Implement docs/goals/goal-unused-code-gate.md on master, at or after 34da529b7 — the base its
Background was surveyed at.
Before Phase 1, confirm the base: packages/apack-host/tsconfig.json, packages/apack-sdk/tsconfig.json,
packages/default-setup/package.json and packages/renderer/eslint.config.ts exist at HEAD, and the root
package.json's `lint:check` still begins `npm run lint:check -ws --if-present`. If they don't, stop and
say so — the plan was surveyed somewhere else. (A second half was added after the survey and has since been
widened: `&& oxlint . -D correctness --ignore-path .gitignore --ignore-pattern 'packages/**'
--ignore-pattern 'docs/**'` as of `7080ebfe7`, having been `oxlint scripts tests -D correctness` at
`f91b66b49`. It moved a third time at `8549f81a5`, which **removed the `packages/**` exclusion** — so the
lint half of this goal's subject is already covered and Phase 4 is largely done; what is left there is the
guard. Read the script rather than this sentence: it has moved three times since the survey.)
Read Background, Decisions, Phases and Constraints first. Decisions are final: implement them, don't
reopen them or stop to ask. The Open decisions must be settled with the user before Phase 3; if any is
still marked open, stop and ask.
Where a detail isn't specified, pick the conventional option, note it in the final summary, and keep
going. No backward compatibility in code (root `CLAUDE.md`, "Backward compatibility" — it is a standing
rule, not this goal's choice): change signatures, move modules, migrate every in-repo caller, test,
fixture, template and doc in the same change, and fix forward. Stored user data is the exception: it
moves with migrations.

Finished when:
- Phases 1–4 are implemented and each meets its "Done when"; every new guard is mutation-checked.
- `noUnusedLocals` is on for every workspace that typechecks, and no workspace's typecheck reports
  TS6133 or TS6196.
- A guard fails when a workspace's tsconfig omits `noUnusedLocals`, so a new package can't opt out by
  forgetting.
- `npm run lint:check` covers every workspace that has source, or a guard names the ones it does not
  and why (Decision 4).
- npm run typecheck passes; npm run test:unit passes; the suites of every package whose source this
  changed pass.
- A final summary: phase → done/deferred, evidence, and the conventional choices made.
- The doc is in `docs/archive/goals/`, with its status blockquote and an Outcome section, committed.

Commit as you go:
- Commit each phase when its "Done when" holds and the checks are green — not once at the end. A phase
  is landable on its own; a commit is how that stays true. Conventional message, no Co-Authored-By or
  session lines, `git commit -- <paths>` naming only that phase's files.
- Check `git diff --cached` first: something outside the session stages files, and a pathspec commit
  leaves the rest of the index alone.
- Don't push, tag, or open a PR unless the user asks.

Never:
- push, tag or open a PR unless the user asks in this session.
- npm publish, create GitHub releases, or trigger workflows (dry runs only).
- open, copy or modify ~/Library/Application Support/apack* or any real data dir.
- pkill/killall Electron or node; launch the app outside the test env without an isolated
  APACK_USER_DATA_DIR.
- run bare tsc on packages/preload (its tsconfig has no outDir; see packages/preload/CLAUDE.md),
  `npm install` in the example pack, or edit version/release metadata.
- change the typed EARS types' behaviour (packages/apack-sdk/TYPED-EARS.md) to make a call site compile.
- add backward-compat shims or loosen a failing assertion instead of investigating.
- silence a finding with an `_` prefix, an `eslint-disable`, or a `void x` where the right answer is to
  delete the symbol (Decision 3).
- add `noUnusedParameters`: it is a separate, larger change (Deferred).
```

## Background (2026-09-25, at 34da529b7 on master)

An unused import survived in `packages/apack-host/src/secrets/index.ts` — `getDesignated` and
`hasDesignation`, left when `forwardSecretsChanges` stopped resolving a designation — and was found by
reading, not by a check. Asking why turned up two independent gaps.

### Only two workspaces are linted

`packages/default-setup` and `packages/renderer` declare `lint:check`. The other eleven do not:

| has `lint:check` | does not |
|---|---|
| `@app/default-setup`, `@app/renderer` | `@apackdev/host`, `@apackdev/sdk`, `@apackdev/ears`, `@apackdev/cli`, `@apackdev/testing`, `@apackdev/ui`, `@app/api`, `@app/main`, `@app/preload`, `@app/internal-electron-versions`, `@app/internal-typescript-floor` |

The root script is `npm run lint:check -ws --if-present && oxlint scripts tests -D correctness`
(`package.json`), and `--if-present` makes a missing script a pass. `lint:check` is the last step of the
root `typecheck` chain, so the chain reports lint as green while covering two of thirteen workspaces.

The second half arrived later, in `f91b66b49`: the repo's own `scripts/` and `tests/` belong to no
workspace, so no `-ws` fan-out could ever reach them, and eight dead declarations had accumulated there
unnoticed. Both trees are at zero now. It was widened at `7080ebfe7` to lint everything git tracks outside
`packages/**` and `docs/**`, after the narrower form was found reading a pack's build output and a
gitignored scratch spec. That closed a hole this survey did not name. The exclusion itself went at
`8549f81a5`: the root pass reads every workspace now, bar the CLI's scaffold templates, and the 113
findings behind it were cleared in the same stretch. So the sentence this paragraph used to end on — that
the thirteen workspaces are two linted and eleven not — no longer holds, and what this goal removes is not
the lint exclusion but the blind spot underneath it: a linter that cannot parse an SFC at all.

default-setup's script is `oxlint . -D correctness --ignore-path .gitignore`; renderer has
`eslint.config.ts`. There is no lint config at the repo root and none in any unlinted package.

What oxlint reports today in packages nothing lints (`npx oxlint packages/<p>/src`):

| package | findings | of which `no-unused-vars` |
|---|---|---|
| `@apackdev/host` | 30 | 27 |
| `@apackdev/sdk` | 4 | — |
| `@apackdev/ears` | 2 | — |

`-D correctness` reports the same 30 as a bare run, so the flag default-setup uses is not what hides
them: nothing runs at all. The two linted packages report 0, which is what being linted looks like.

### No workspace sets `noUnusedLocals`

No `tsconfig*.json` in the repo sets it, so the compiler never reports an unused import in any
workspace, linted or not. That is the check that already runs on every package, and it is off.

Measured by overriding the flag on each package's existing tsconfig
(`npx tsc -p packages/<p>/tsconfig.json --noUnusedLocals --noEmit`, counting TS6133 and TS6196;
renderer via `vue-tsc -p tsconfig.app.json`):

| package | unused symbols | package | unused symbols |
|---|---|---|---|
| `@apackdev/host` | 32 | `@app/api` | 17 |
| `@apackdev/testing` | 23 | `@app/default-setup` | 14 |
| `@apackdev/cli` | 11 | `@app/main` | 5 |
| `@apackdev/sdk` | 6 | `@apackdev/ears` | 0 |
| `@app/renderer` | 22 | `@app/preload` | 0 |

**110 across nine packages.** The number that matters most for the design: `@app/default-setup` has
**14 under the compiler while oxlint reports 0**. The two checks do not overlap — `no-unused-vars` and
TS6133 disagree about enough cases that lint alone would not have caught this class even in the
packages that run it.

### Why this is worth a goal rather than a fix

The cleanup is 110 findings across nine packages, each needing a judgement — delete the symbol, or use
it because its absence is the bug. That is the shape the `secrets/index.ts` import had: the import was
dead because a behaviour change had orphaned it, and the honest fix was to delete it. Some of the 110
will instead be a symbol something should be using.

## Decisions

Final.

1. **`noUnusedLocals` is the gate, not lint.** It runs in the check every package already has, needs no
   per-package script or config, and catches 14 cases in default-setup that its lint does not. Lint
   coverage is a separate question (Decision 4).

2. **One phase per package, cleaned before the flag goes on.** Turning the flag on repo-wide first would
   leave the typecheck red for the length of the goal, and a red baseline is where unrelated breakage
   hides. Each phase cleans one package and turns the flag on for that package, so the chain is green at
   every commit.

3. **A finding is deleted, not silenced.** No `_` prefix, no `eslint-disable`, no `void x`. Where a
   symbol is unused because something stopped using it, check whether the *caller* is the bug before
   deleting — that is what the import this goal came from turned out to be. Record any case where the
   answer was to use the symbol rather than remove it: those are defects this goal found, and they
   belong in the Outcome.

4. **Lint coverage is this goal's, but second.** Once the compiler gate is on everywhere, add
   `lint:check` to the workspaces that have source, or a guard listing the ones that legitimately have
   none. Doing it after the compiler gate means the remaining lint findings are the ones the compiler
   does not catch, which is the set worth reading.

5. **A guard, so a new package cannot forget.** A spec over the workspace tsconfigs fails when one that
   typechecks omits `noUnusedLocals`. Without it the gate decays the way lint did: silently, one new
   package at a time.

## Open decisions — **settled 2026-09-25**

1. **`noUnusedLocals` is declared in each workspace's tsconfig**, not in a shared base. The configs stay
   standalone, which is how this repo has deliberately kept them; the flag is repeated thirteen times and
   Decision 5's guard is what catches a new package omitting it.
2. **The whole goal is in scope**, Phases 1–4, not only Phase 4's lint widening. Phase 1 reports what
   `@app/internal-electron-versions` and `@app/internal-typescript-floor` contain before either is included.

Confirmed unimplemented at `9e0eb7891`: `noUnusedLocals` appears in **0** tsconfigs and `lint:check` in
**2** of 13 workspaces — exactly the state the Background describes.

The options as surveyed, kept for the reasoning:

1. **Where `noUnusedLocals` is declared.** The workspaces share no base tsconfig today — each
   `packages/*/tsconfig.json` is standalone.
   - **In each workspace's tsconfig.** No new file, and each package's config stays readable on its own;
     the flag is repeated thirteen times and a new package can omit it, which Decision 5's guard is what
     catches. — *open*
   - **In a new shared base the workspaces extend.** Declared once, inherited; but it is a new file
     every package's config depends on, and the repo has deliberately kept them standalone (`tsconfig`
     comments in `packages/apack-ears/tsconfig.json` explain why project references were rejected). — *open*

2. **Whether `@app/internal-electron-versions` and `@app/internal-typescript-floor` are in scope.** Both are tiny and may
   have no source to check; Phase 1 should report what they contain before either is included. — *open*

## Phases

### Phase 1 — The guard, and the packages that are already clean

- Add the spec from Decision 5 over every `packages/*/tsconfig.json`, with the two packages that measure
  0 (`@apackdev/ears`, `@app/preload`) turned on, and every other package listed in the spec as a known
  exemption with its current count.
- Report what `@app/internal-electron-versions` and `@app/internal-typescript-floor` contain (Open decision 2).
- Do not touch `packages/preload` with a bare `tsc`: use `npm run build -w @app/preload`.

**Done when:** `npm run typecheck` passes; the spec passes; the exemption list matches the measured
counts. Mutation: removing `noUnusedLocals` from `@apackdev/ears`'s tsconfig fails the spec, and adding a
package to the exemption list that is already clean fails it too.

### Phase 2 — The small packages

- Clean and enable, in this order: `@apackdev/sdk` (6), `@app/main` (5), `@apackdev/cli` (11).
- Remove each package's entry from the Phase 1 exemption list as it lands.

**Done when:** each package's own typecheck and unit suite pass; the exemption list no longer names
them. `@apackdev/sdk` also needs `npm run api:check` if any removed symbol was exported.

### Phase 3 — The large packages

- Clean and enable: `@app/default-setup` (14), `@app/api` (17), `@app/renderer` (22), `@apackdev/testing`
  (23), `@apackdev/host` (32).
- `@apackdev/testing` is bundled into other packages' test runs, so `npm run packages:build` before the
  suites that read it.
- After Open decision 1 is settled.

**Done when:** `npm run typecheck` and `npm run test:unit` pass; the exemption list is empty; the guard
now asserts every workspace has the flag rather than a list of exceptions.

### Phase 4 — Lint coverage (Decision 4)

- Add `lint:check` to the workspaces with source, matching default-setup's invocation, or a guard naming
  the ones that have none.
- Fix what it then reports, or record it as Deferred with counts if it is another 100-finding cleanup:
  the goal's gate is the compiler, and lint's remaining findings are a separate judgement.

**Done when:** `npm run lint:check` covers every workspace with source and exits 0; a guard fails when a
workspace with source has no lint script.

## Deferred

- **`noUnusedParameters`.** A larger and noisier class (unused `context` in XState actions is the common
  case, and the convention there is an `_` prefix, which Decision 3 forbids for this goal's findings).
  Size it separately.
- **The renderer's eslint config versus oxlint.** Renderer lints with `eslint.config.ts` while
  default-setup uses oxlint; whether they converge is its own question.

## Constraints

- Commit each phase as it finishes, in logical chunks, no attribution lines, `git diff --cached` first;
  pushing, tagging and PRs are on request.
- No publishing, releases or triggered workflows. No real data dirs, no broad pkill.
- No bare `tsc` in `packages/preload`; no `npm install` in the example pack; no version metadata.
- Typed EARS types are change-controlled (`packages/apack-sdk/TYPED-EARS.md`).
- Published packages: no `any` in the pack-facing SDK, the TypeScript floor, `api:update` after export
  changes with `etc/` committed.
- Build order: `packages:build` before the CLI and harness suites; default-setup's runtime before the
  api suites and E2E. Suites don't run concurrently.
- Investigate failing tests; mutation-check new guards.
- External packs are first-class: keep the fixture packs and `test:packaged-authoring` passing.
- Narrow checks during the work (one package's `tsc --noEmit`, one spec file), the full chain once per
  phase at its end — root `CLAUDE.md`, "What to run after a change".


## Outcome

Landed 2026-09-28. Three of the Background's measurements were wrong, and each changed the work.

**The per-package counts were program counts, not ownership counts.** Every workspace compiles its
dependencies' source under `@apackdev/source`, so one unused symbol in `@apackdev/host` was reported by host,
api, testing and renderer alike. 187 raw diagnostics across the 14 configs were **87 unique**, owned by 8
packages. `@app/api`, `@apackdev/testing` and `@app/renderer` owned **none** — every finding their configs
reported lived somewhere else. Phase 2 and 3's ordering by size was therefore ordering by the wrong number;
the order that matters is the dependency layer, because enabling the flag on a consumer before its
dependencies are clean fails that consumer's typecheck on another package's files.

**TS6192 is a fourth unused code** ("All imports in import declaration are unused"), alongside the TS6133 and
TS6196 the Background counted.

**Decision 1's headline evidence did not survive.** "It catches 14 cases in default-setup that its lint does
not" — 13 of those were in gitignored generated code and 11 were `__contract_check_*` aliases that exist *to
be unused*. default-setup's real count was 1.

The corrected evidence for Decision 1 is stronger than the original. Measured the day this landed, with the
lint gate fully green over `packages/`: `oxlint` reads 114 files in `@apackdev/ui` and reports **zero**, where
`vue-tsc --noUnusedLocals` reports **ten**. It does not analyse bindings inside an SFC's script block. 27
findings survived a green lint run — 13 in `.vue` scripts, 13 in generated code, 1 an exhaustiveness binding.

### Defects this found, where the answer was not to delete

`noUnusedLocals` does not count a string template ref (`ref="name"`) as a read, so a binding the template
populates and a composable consumes reads as dead. Two would have broken had they been deleted:

- `ImageLightbox.vue`'s `menuRef` — `useContextMenu` reads `menuRef.value` to dismiss the menu on an outside
  click.
- `notes/fe/canvas.vue`'s `scrollContainerRef` — `useNoteScroll` reads it to save and restore a note's scroll
  position.

Both now bind through a function ref, which is a real read of the binding and identical at runtime. The other
seven refs in that class were genuinely dead: nothing read them, no `defineExpose`, and the template attribute
went with the binding.

### The guard Decision 5 asked for

`packages/internal-repo-checks/tests/unused-code-gate.spec.ts`. It reads **every** tsconfig in the tree, not one per
workspace: `typecheck:be` compiles `packages/api` through three of them, and the first version — which read a
workspace's root config plus whatever a solution config referenced — covered 15 of 25 and would have passed
with `"noUnusedLocals": false` in `api/tsconfig.test.json`. What leaves the population is derived rather than
named: a config whose parsed file list is empty compiles nothing, which is the renderer's solution config and
only that. The three `tsconfig.api-extractor.json` are the one named exemption, because API Extractor reads a
package's built declarations and `api:update` is not where dead code should surface.

The option is read effective rather than literal, through the compiler's own parser, since these configs carry
`//` comments that `JSON.parse` rejects and most of them inherit the flag rather than spelling it. Three
mutation cases hold it to that, each built from what the spec already parses: a dropped flag flips the answer,
a config that only extends inherits `true` while an override wins `false`, and the empty config is excluded for
what it compiles rather than for its name.

### Choices made where the goal left a detail open

- **The generator emits one exported type**, `__ContractChecks`, in place of 11 local `__contract_check_<id>`
  aliases (`apack-sdk/src/build/generate-entries.ts`). An exported declaration is never reported unused and
  the assertion is unchanged; this closes it for every pack rather than for this one. Two dead imports the
  generator emitted unconditionally — `EARS` in the pack entry, `Qualified` in the FE entry — are now emitted
  only where they are used. `facade:check` confirms the exported type does not reach `etc/pack-types.api.md`.
- **`exclude` was rejected on evidence.** `tsc --explainFiles` shows `pack-entry.ts` enters the program three
  ways — the include glob, and imports from `tests/setup.ts` and a spec — so excluding it cancels one of
  three and changes nothing. It would also stop typechecking the file the contract assertions live in.
- **`@app/main` and `@app/preload` gained typecheck legs.** No entry in `TYPECHECK_LEGS` reached either, so
  the flag there would have gated nothing; each package's CLAUDE.md said so deliberately and now says the
  opposite. 16 legs became 18.
- **`const _exhaustive: never = event` became `event satisfies never`** — the same assertion with no binding,
  and no `_` prefix, which Decision 3 forbids.

### Deferred, unchanged

`noUnusedParameters` is still the larger, noisier class and is still not attempted.
