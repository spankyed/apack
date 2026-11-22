# Goal: a pack's import names the file that is there

> **Done** (`8f9ad78d7`..`b91745f78` on `AS/alias-simplification`). The text below is the plan as written;
> Phase 2's "801 extensionless specifiers" counted the `#` ones only, and the relative half — 736 more —
> was found by Phase 5's guard and done then. The Outcome says so. For the convention now, see
> `packages/default-setup/CLAUDE.md`; for what refuses a specifier that names no file,
> `findExtensionlessOwnModules` in `scripts/check-import-specifiers.ts` and
> `@apackdev/host/build/own-module-specifiers`, which `apack build` runs for every other pack.

> **Written in session** `1d53eb9c-d886-49f8-bc5a-90793d43315e` (Claude Code, 2026-09-26). Resume it with `claude -r 1d53eb9c-d886-49f8-bc5a-90793d43315e`.

```
# Goal: a pack's import names the file that is there

Implement docs/goals/goal-pack-imports-name-the-file.md on AS/test-pipeline, after
goal-one-way-to-name-your-own-modules.md — see "Order" below, which explains why that one goes first and
what changes here if it has not run.
Before Phase 1, confirm the base: pack code holds 776 extensionless own-module specifiers in
packages/default-setup and 25 in tests/fixtures/external-pack, and 234 + 41 `.js` specifiers in their
`src/__generated__/`. If those are already false, stop and say so — the survey was taken somewhere else.
Read Background, Decisions, Phases and Constraints first. Decisions are final: implement them, don't
reopen them or stop to ask. The Open decision must be settled with the user before Phase 3; if it is still
marked open, stop and ask.
Where a detail isn't specified, pick the conventional option, note it in the final summary, and keep
going. No backward compatibility in code (root `CLAUDE.md`, "Backward compatibility" — it is a standing
rule, not this goal's choice): change signatures, move modules, migrate every in-repo caller, test,
fixture, template and doc in the same change, and fix forward.

Finished when:
- Phases 1–5 are implemented and each meets its "Done when"; every new guard is mutation-checked.
- Every specifier in pack code that names one of the pack's own modules ends in the extension that module
  actually has, and a check refuses one that does not.
- One convention covers hand-written pack code, generated pack code and the scaffold, where there were
  three.
- Every suite's spec count and pass count is unchanged, shown before and after.
- npm run typecheck; npm run spec-cost:check; npm test -w @app/default-setup; npm run compile;
  npm run build; npm test; npm run test:external-pack; npm run test:packaged-authoring;
  npm run chain once at the end.
- A final summary: phase → done/deferred, evidence, and the conventional choices made.
- The doc is in `docs/archive/goals/`, with its status blockquote and an Outcome section, committed.

Commit as you go:
- Commit each phase when its "Done when" holds and the checks are green — not once at the end.
  Conventional message, no Co-Authored-By or session lines, `git commit -- <paths>` naming only that
  phase's files.
- Rewrite specifiers with a script and put the script in the commit message: 800 edits are reviewed by
  the rule that produced them, not line by line.
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
- remove `allowImportingTsExtensions` from a pack tsconfig or the scaffold's. This whole goal rests on it,
  and it is already set in both.
```

## Background (surveyed 2026-09-26 at `15f6ff4c2`)

A specifier in pack code can name its target three ways, and **this repo uses all three at once**:

| Convention | Where | Evidence |
|---|---|---|
| names the `.ts` source | `@apackdev/ears`, `/sdk`, `/host`, `/ui`, `/testing` | root `CLAUDE.md:441`; `check:specifiers` **rejects** a relative `.js` there (`findJsSpecifiers`) |
| names `.js` | generated pack code | 234 specifiers in `default-setup/src/__generated__`, 41 in the fixture's — `from '../features/threads/be/repository/index.js'`, pointing at `.ts` files |
| names nothing | hand-written pack code | 776 in `default-setup`, 25 in `tests/fixtures/external-pack` |

So the repo forbids in its own packages exactly what it generates into its packs, and hand-written pack code
does a third thing. None of that was decided; it accumulated.

### What each form costs, measured

Spiked 2026-09-26 in isolated fixtures — an app whose graph reaches a linked package's source that uses a
`#` subpath import, plus `tsc` over the package itself:

| Form | `tsc` (`bundler`) | Vite 7.0.6 | esbuild 0.25.12 |
|---|---|---|---|
| `#feat/thing` | ✅ *only with the tsconfig `paths` mirror* | ✅ | ❌ `Could not resolve` |
| `#feat/thing.js` | ✅ | ✅ | ✅ |
| `#feat/thing.ts` | ✅ | ✅ | ✅ |

**Extensionless is the only form a tool has to be taught**, and esbuild is the tool. That teaching is
`resolveWithExtensions` in `apack-cli/src/build/subpath-imports.ts` — which is also where four defects were
found and fixed on 2026-09-26 (`0ce94ab27`), all of them in code whose only job is guessing a suffix the
author could have written.

`.ts` and `.js` are equivalent to every tool. What separates them is that **`.ts` is the file that is
there.** `.js` names a file that does not exist and works because `tsc`, Vite and esbuild each perform a
`.js` → `.ts` substitution; it is the right form for code emitted as individual JavaScript files, which is
why generated code chose it, and a pack is never emitted that way — it ships as `dist/runtime/index.cjs` and
`dist/runtime/fe.js`.

### The premise is already in place

`allowImportingTsExtensions: true` is set in `packages/default-setup/tsconfig.json` **and** in the scaffold
(`apack-cli/src/commands/init.ts`, `PACK_TSCONFIG`), where its comment reads: *"A pack typechecks the
@apackdev packages' published declarations … Their declarations name .ts files."* The reason is recorded; only
the pack's own imports have not followed it.

## Order

**Run [`goal-one-way-to-name-your-own-modules.md`](goal-one-way-to-name-your-own-modules.md) first.** That one
changes a specifier's *prefix* (`@/features/x` → `#features/x`, four resolver mechanisms down to one); this
one changes its *suffix*. They touch overlapping sets of specifiers, so each is one script pass and the order
is not load-bearing — but the suffix rule and its guard are much simpler to state against one prefix than two.

Two things depend on that goal having run:

- **`resolveWithExtensions` need not move to `@apackdev/host/build/`.** That goal's Decision 4 moves it so
  `packages/api` and `@apackdev/cli` can share it. If this goal runs after, nothing needs it at all and it is
  deleted instead — so if both are planned, skip the move and delete it here.
- **`packages/api`'s `resolve-at-aliases` surface** is deleted by that goal, not this one.

If this goal runs *first* instead, nothing breaks; it simply deletes nothing, because the `@/` resolvers
resolve extensionlessly and `resolveWithExtensions` still serves them.

## Decisions

Final.

1. **A specifier names the file that is there: `.ts` for a TypeScript module, `.vue` for an SFC.** Not `.js`,
   which names a file that does not exist, and not nothing, which makes a tool guess.
2. **One convention across all three populations** — hand-written pack code, generated pack code, and the
   scaffold's templates. Three conventions in one repo is the finding this goal exists for; replacing three
   with two would not be worth 800 edits.
3. **`generate-entries` emits `.ts`.** Its spec pins the emitted form in several places
   (`apack-sdk/tests/build/generate-entries.spec.ts:97`, `:297`, `:325`, `:427`), which is the right
   coupling: those expectations move with the change rather than being loosened.
4. **The check is the existing one, widened.** `check:specifiers` already has `findJsSpecifiers`, which
   rejects a relative `.js` specifier that names a TypeScript module in the `@apackdev` packages. Pack sources
   join its scope, and a companion refuses an *extensionless* own-module specifier. One mechanism, one place.
5. **The extension-supplying machinery goes when nothing needs it.** `resolveWithExtensions` and the
   subpath surface's suffix-guessing exist only for extensionless specifiers. Deleting them is the point of
   the exercise, not a side effect — code whose only job is guessing what the author could have said.

## Open decision — settle before Phase 3

**Does a *third-party* pack have to write extensions too?**

Phase 3 widens `check:specifiers` over the packs in this repo, and `apack build` is what a pack outside it
runs.

- **Require it, and have `apack build` say so.** One convention for every pack, the machinery goes, and a
  pack author gets a clear message naming the suffix instead of a resolution error. Costs: a pack author who
  copies an extensionless import from anywhere else in the JavaScript world hits it, and `apack build`
  grows a diagnostic it did not need.
- **Allow it, and keep the suffix-guessing for external packs only.** Kindest to an author's habits. Costs:
  the machinery stays, the built-in pack is checked by a rule external packs are not, and the reason lives
  only in a comment — which is how the two copies of the tsconfig reader drifted unnoticed.

Nothing about breaking anyone bears on this: no pack exists outside this repo (root `CLAUDE.md`, *Backward
compatibility*). It is a question about the surface we want to support.

## Phases

### Phase 1 — a spike, because one population is not covered by the measurements

`vue-tsc` checks default-setup's SFCs, and the table above measured `tsc`. Confirm that `vue-tsc` accepts a
`.ts` specifier inside a `<script setup>` block, and that the renderer's Vite build resolves one from an SFC
in a pack it compiles. Both should hold — same compiler options, same resolver — but "should" is not a
measurement, and 800 edits are a poor way to find out.

**Done when:** the two results are recorded in this doc. If either fails, stop: the goal needs rethinking for
SFCs and that is worth knowing before Phase 2, not during it.

**Both hold, measured 2026-09-26 on the real tree rather than a fixture** — one specifier inside
`packages/default-setup/src/features/database/fe/settings.vue` changed to `from '#generated/types.ts'`, then
reverted:

| Check | Result |
|---|---|
| `vue-tsc` over a `.ts` specifier in `<script setup>` | ✅ `npm run typecheck:pack` passed |
| the renderer's Vite build and the API's esbuild, resolving it from a pack's SFC | ✅ `npm run build:app` exit 0, no errors |

A standalone fixture (`package.json` `imports`, `moduleResolution: bundler`, `allowImportingTsExtensions`, an
SFC importing `#feat/thing.ts`) agreed. So nothing about SFCs needs rethinking, and Phase 2's rewrite must
include them — which the Constraints already say, since `tsc` does not read an SFC and `vue-tsc` does.

### Phase 2 — hand-written pack code

The 801 extensionless specifiers, in `packages/default-setup` (src and tests) and `tests/fixtures/*`, take the
extension of the file they name. A script, with its rule in the commit message. `.vue` targets already carry
theirs.

**Done when:** no extensionless own-module specifier remains in pack code; `npm run typecheck`,
`npm test -w @app/default-setup` (87 files, 720 tests), `npm run compile`, `npm run build`, `npm test` and
`npm run test:external-pack` pass unchanged.

### Phase 3 — generated pack code and the scaffold

`generate-entries` emits `.ts`; its spec's pinned strings move with it. The scaffold's templates
(`init.ts`, `add/feature.ts`, `add/step.ts` and the rest) write extensions. Act on the Open decision for what
`apack build` does about an external pack.

**Done when:** `npm run compile` regenerates with `.ts` throughout; `npm run test:packaged-authoring` passes,
which is the one check that authors a pack from the templates outside the monorepo.

### Phase 4 — delete the guessing

`resolveWithExtensions` and the subpath surface's suffix search go, along with `subpath-imports.spec.ts`'s
cases for them (the `readSubpathImports` half stays — reading `package.json` `imports` is still needed).

**Done when:** `npm run test:external-pack` and `npm run test:packaged-authoring` pass with the machinery
gone, and the deleted line count is recorded.

### Phase 5 — the guard

`findJsSpecifiers`' scope gains the pack sources, and a companion check refuses an extensionless own-module
specifier, naming the file it should have named. Mutation: drop one extension and watch it named; change one
to `.js` and watch that named too.

**Done when:** both checks pass, both have been made to fail, and `npm run chain` is green.

## Deferred

- **`moduleResolution: nodenext`.** With extensions everywhere, a pack's source becomes resolvable by Node
  with no bundler at all, and `nodenext` is what would make `tsc` agree with that. It is a separate question
  about which regime a pack runs under, it moves the scaffold, and `nodenext` *requires* the `.js` form
  (spiked: `.ts` is rejected there) — so it would reverse Decision 1. Worth revisiting only if a pack ever
  needs to run unbundled.
- **`@apackdev/*` packages' own specifiers**, which already name `.ts` and are already checked. Nothing to do.

## Constraints

- **Rewrite with a script; review the rule.** 800 edits cannot be read line by line. The reviewable artefacts
  are the substitution, the before-and-after counts, and the suites.
- **Counts before and after, every phase.** `npm test -w @app/default-setup` is 87 files and 720 tests today.
- **`.vue` files count, in both directions.** Specifiers inside SFC `<script>` blocks need rewriting, and
  `tsc` does not read SFCs — `vue-tsc` does. A rewrite that walks only `.ts` leaves the pack half-migrated
  with a green `typecheck`.
- **Generated files are regenerated, never hand-edited.** The 275 `.js` specifiers under `src/__generated__/`
  change by changing `generate-entries` and running `npm run compile`. A script that rewrites them in place
  is undone by the next build and hides whether the codegen was actually fixed.
- **Don't touch `allowImportingTsExtensions`**, in a pack tsconfig or the scaffold's. It is set in both, and
  every measurement here assumed it.
- **Another agent works in this checkout.** Check `git status` before committing and name paths explicitly.

## Outcome (2026-09-26)

| Phase | Status | Evidence |
|---|---|---|
| 1 — the SFC spike | **done** | `8f9ad78d7`. `vue-tsc` and the renderer's Vite build both take a `.ts` specifier from an SFC, measured on the real tree |
| 2 — hand-written pack code | **done** | `5a2011b48` (801 `#` specifiers, 437 files) and `6f01bdbf6` (736 relative ones: 716 by script in 364 files, 6 by hand, 14 in the CLI's templates) |
| 3 — generated code and the scaffold | **done** | `f590c1b29`. `toImportPath` and the facades' own imports emit `.ts`; the scaffold writes it; `apack build` refuses a specifier that names no file |
| 4 — delete the guessing | **done** | `94164fc69`. 160 lines deleted against 78 added |
| 5 — the guard | **done** | `b91745f78`. `findJsSpecifiers` over the packs, `findExtensionlessOwnModules` beside it, four mutations; `e349447c5` for the fixture packs it found |

**1,537 specifiers across some 600 files.** Counts: default-setup 87 files / 720 tests unchanged, the fixture
pack 10 / 32 unchanged, E2E 21 unchanged, `test:packaged-authoring` and `test:external-pack` green,
`npm run chain` green. Three suites grew, all of them checks this goal added: `@apackdev/host` 77 / 697 to
78 / 706 (`own-module-specifiers.spec.ts`), internal-repo-checks' `import-specifiers` to 192 cases (the two rules that
had none, and this one), and `@apackdev/cli`'s integration half from 1 failed / 167 passed / 20 skipped to 188
passed — the skips were everything downstream of a fixture pack that had stopped building, which is how the
last four failures of this goal were found.

### The Open decision, settled

**Every pack writes the extension, and `apack build` says so** (option one). A pack outside this checkout
gets `'#generated/events' names no file — write '#generated/events.ts'` instead of esbuild's resolution
error, and the machinery that used to guess is gone rather than kept for external packs alone.

### Corrections to the Decisions

- **Decision 5 said the machinery goes "when nothing needs it"; nothing did, including the two bundler
  surfaces.** The plan expected to delete `resolveWithExtensions` and keep the surfaces that called it. With
  every specifier naming a file, esbuild and Vite resolve a pack's `imports` map themselves: removing both
  surfaces left `apack build` over the fixture pack and default-setup green, its 32 tests passing, and the
  API's tsup build writing 52 of 53 files byte for byte identical (`server.cjs` is not reproducible between
  two runs of the *same* config, and matched on a second pair). The file search survives, unexported, inside
  the diagnostic — its job is no longer to resolve but to name the file the author meant, which is why `.vue`
  joined its list: Vite's default extensions leave `.vue` out, so an extensionless SFC import resolved nowhere.
- **Phase 2's survey counted one form of specifier.** "776 + 25 extensionless" were the `#` ones; 725
  relative extensionless specifiers remained after Phase 2 reported no extensionless specifier left, and
  `./contract` names one of the pack's own modules exactly as `#generated/events` does. Phase 5's guard is
  what found them, which is the argument for writing the guard against the rule rather than against the
  survey.
- **The rewrite script's own rule was wrong for six specifiers**, and the guard caught that too:
  `path.extname('./0.4.0')` is `.15`, so the migrations named after versions looked like they had
  extensions. A check that resolves against the file system does not make that mistake.
- **Every fixture pack in the CLI's integration specs was a pack too**, so the new gate held it to the rule
  and four specs failed on `'./system.contract.js'` and `'#generated/ears.js'` — files those fixtures never
  write. The unit half could not see it: those specs run the real build over a real tree, which is what the
  gate reads, and 20 further tests had been skipping behind them.
- **The CLI's templates wrote extensionless imports into every scaffolded pack.** Once `apack build`
  refused them, `apack init` + `apack add feature` + build was broken — caught by
  `test:packaged-authoring`, which is the check that authors a pack the way an author would. `apack add`'s
  integration spec now holds everything it scaffolds to the rule against real files, and a step's register
  import became `./<type>/index.ts`, a directory's index rather than a file.
- **Two rules in `CHECKS` had no test at all.** The table's doc comment promised every rule has a case that
  proves it bites, above a test nobody had written: the spec imported `CHECKS` and never read it.
  `findPackOwnAliases` (added the day before) and `findPackageScriptImports` were the two, and both have a
  case now.

### Follow-up (a review of this goal's own changes, same day)

A principal-engineer review of these commits found five defects and they are fixed in
`3b3aae75a`..`3d295ba5b`, which is why the modules no longer look quite like the description above:

- **The rule module had grown a reader** — a regex per form and a hand-written comment stripper — and the
  stripper was not a lexer: a regex literal holding an unbalanced quote made a commented-out import read as
  real, so `apack build` could fail a pack naming a comment. The rule (`ownModuleProblems`) is now given
  the specifiers its callers found, and both callers already parsed a pack's sources — `apack build`'s
  neighbour gate had ts and `vue/compiler-sfc` two lines from the call.
- **The relative half had no test**: deleting that branch left every suite in the repo green. Its spec runs
  every case over both forms from one table now.
- **The guides still taught the old form** — 30 fences that `apack build` refuses, pasted into packs — and
  those are fixed. A spec over the guides' fences was added and then removed at the user's request: docs are
  not tested here.
- **Overlapping `#` patterns named the wrong file**: Node takes the longest match, key order took the first.
- **Scope**: a pack authored in JavaScript, a `.json` target, a pack's tests (`apack test` checks those now)
  and a new CLI command writing pack code were each outside the rule, silently.

### What is left of the guessing

Nothing resolves an extensionless own-module specifier any more. One place still looks for a file: the
diagnostic, so that it can name the one the author meant. Deferred as written: `moduleResolution: nodenext`,
which would reverse Decision 1, and the `@apackdev` packages' own specifiers, which already name `.ts`. Not
deferred but noted: `packages/apack-cli/src` is not in scope for this rule — it is bundled, is not a pack,
and names its own modules extensionlessly throughout.
