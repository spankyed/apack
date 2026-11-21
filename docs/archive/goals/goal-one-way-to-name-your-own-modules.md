# Goal: one way for a pack to name its own modules

> **Done** (`bb996d9cb`..`01fb228bd` on `AS/alias-simplification`). The text below is the plan as written;
> Phase 1's claim that it needed no config change was wrong and the Outcome says how. For the convention
> now, see `packages/default-setup/CLAUDE.md`; for what refuses a new `@/`, `findPackOwnAliases` in
> `scripts/check-import-specifiers.ts`.

```
# Goal: one way for a pack to name its own modules

Implement docs/goals/goal-one-way-to-name-your-own-modules.md on AS/test-pipeline, at or after 0ce94ab27 —
the base its Background was surveyed and spiked at.
Before Phase 1, confirm the base: `grep -rho "from '@/" packages/default-setup/src | wc -l` reports 667,
and `packages/default-setup/tsconfig.json` maps both `@/__generated__/*` and `#generated/*` to
`./src/__generated__/*`. If either is already false, stop and say so — the survey was taken somewhere else.
Read Background, Decisions, Phases and Constraints first. Decisions are final: implement them, don't
reopen them or stop to ask. The two Open decisions must be settled with the user before Phase 2; if either
is still marked open, stop and ask.
Where a detail isn't specified, pick the conventional option, note it in the final summary, and keep
going. No backward compatibility in code (root `CLAUDE.md`, "Backward compatibility" — it is a standing
rule, not this goal's choice): change signatures, move modules, migrate every in-repo caller, test,
fixture, template and doc in the same change, and fix forward.

Finished when:
- Phases 1–5 are implemented and each meets its "Done when"; every new guard is mutation-checked.
- No `@/` specifier remains in any pack's source or tests, and a check refuses a new one.
- One mechanism resolves a pack's own module names, and the configs that each re-implemented it are gone.
- Every suite's spec count and pass count is unchanged, shown before and after.
- npm run typecheck; npm run spec-cost:check; npm test -w @app/default-setup; npm run build; npm test;
  npm run test:external-pack; npm run test:packaged-authoring; npm run chain once at the end.
- A final summary: phase → done/deferred, evidence, and the conventional choices made.
- The doc is in `docs/archive/goals/`, with its status blockquote and an Outcome section, committed.

Commit as you go:
- Commit each phase when its "Done when" holds and the checks are green — not once at the end.
  Conventional message, no Co-Authored-By or session lines, `git commit -- <paths>` naming only that
  phase's files.
- Rewrite imports with a script, and keep the script in the commit message rather than the tree: 824
  edits reviewed as a diff need the rule that produced them stated.
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
- change `moduleResolution` from `bundler`, in any pack or in the scaffold. The spikes below rest on it.
```

## Background (surveyed 2026-09-26 at `0ce94ab27`)

A pack has two ways to name its own modules, and they are not equivalent.

**`#generated/*` is a Node standard.** The package declares it in its own `package.json`:

```json
"imports": { "#generated/*": "./src/__generated__/*" }
```

Node resolves it. So do Vite and esbuild, with no configuration, because it is part of the module
specification. It is scoped to the declaring package by construction: a `#` name means nothing outside it.

**`@/features/*` is a TypeScript-only invention.** `compilerOptions.paths` tells `tsc` what a name means and
no runtime reads it, so every tool that compiles that code has to be taught the same rule again. Worse, `@/`
here is not a static alias but a *per-importer* rule — `packages/renderer/vite.config.ts:20` says so:

> `@/` — scoped to the importer's pack (or `renderer/src/` for renderer files)

Which is why it cannot be an alias map and needs a resolver surface everywhere.

### Four implementations of one idea

| Where | How |
|---|---|
| `packages/renderer/vite.config.ts:49` | a Rollup `resolveId` hook that finds the importer's pack |
| `packages/api/tsup.config.ts:79` | an esbuild plugin, `resolve-at-aliases`, doing the same thing again |
| `packages/default-setup/vitest.config.ts` | `vite-tsconfig-paths` |
| `apack-cli/src/build/tsconfig-aliases.ts` + `makeAliasPlugin` | reads the pack's tsconfig itself |

That is the direct cause of a day's worth of defects: the fourth had two copies that disagreed, each having
missed a fix the other received (`c9033ebd7`), and the FE/BE asymmetry and the `vite-tsconfig-paths`
`loose: true` question both exist only because `@/` must be re-taught per tool.

### The usage is lopsided, and the built-in pack is the outlier

| | `@/` | `#…` |
|---|---|---|
| `packages/default-setup` | **667** src, 157 tests | 5 |
| `tests/fixtures/external-pack` | **0** | 10 |
| `tests/fixtures/bundled-ui-pack` | 0 | 0 |

Every pack but the built-in one already uses the standard. And default-setup declares **both names for one
directory** — `@/__generated__/*` and `#generated/*` both map to `./src/__generated__/*`, with
`package.json` `imports` already declaring the second, so it works natively today.

By prefix, and this is the shape of the work:

| | src | tests | |
|---|---|---|---|
| `@/__generated__` | 461 | 86 | **a rename to a name that already exists and already resolves** |
| `@/features` | 185 | 54 | needs a new `imports` entry |
| `@/extensions` | 7 | 17 | |
| `@/app-settings` | 14 | 0 | |

**547 of the 824 are `@/__generated__` → `#generated`.** That part removes the two-names-for-one-place
duplication and needs no new declaration anywhere.

### What the spikes measured, 2026-09-26

Each in an isolated fixture: an app whose graph reaches a *linked package's source* which itself uses `#`.

| Tool | `#feat/thing.js` | `#feat/thing` (extensionless) |
|---|---|---|
| Vite 7.0.6 | ✅ | ✅ |
| esbuild 0.25.12 | ✅ | ❌ `Could not resolve` — it names the file and refuses the path |
| `tsc`, `moduleResolution: bundler`, **with** the tsconfig `paths` mirror | ✅ | ✅ |
| `tsc`, `moduleResolution: bundler`, **without** the mirror | — | ❌ `TS2307` |

Three things follow, and none of them was obvious:

1. **Vite needs nothing.** It applied the pack's own `imports` from inside another package's build graph,
   extensionless included. So the renderer's hook, default-setup's `vite-tsconfig-paths` and the CLI's FE
   bundler all need no replacement.
2. **esbuild needs the extension supplied**, as Node's resolver does. So the api's surface is *replaced* by a
   smaller one rather than deleted — and that code already exists, correct and specced, as
   `resolveWithExtensions` in `apack-cli/src/build/subpath-imports.ts` (`0ce94ab27`).
3. **The tsconfig `paths` mirror is not redundant.** Under `bundler` resolution `tsc` will not resolve `#`
   from `package.json` `imports` alone; the scaffold's comment at `init.ts:73` says exactly this and is
   right. Two declarations of one mapping stay, in every pack, by necessity.

## Decisions

Final.

1. **`#` subpath imports are the one way a pack names its own modules.** `@/` goes from every pack's source
   and tests. It is a TypeScript-only mechanism that four bundler configs re-implement, and the standard one
   gives the same per-importer scoping for free because Node resolves `#` against the importing file's
   nearest `package.json`.
2. **`@/__generated__` becomes `#generated`, which already exists.** One name per file. This is its own phase
   because it is 547 of the 824 edits, needs no new declaration, and is provably safe on its own.
3. **The tsconfig `paths` mirror stays**, in default-setup and in the scaffold, because `tsc` under `bundler`
   requires it (spiked). A pack therefore declares each mapping twice, and the scaffold's comment explaining
   why is kept and pointed at from `default-setup/CLAUDE.md`.
4. **`resolveWithExtensions` moves to `@apackdev/host/build/`**, because `packages/api` does not depend on
   `@apackdev/cli` and both depend on host, and it needs only `node:fs` and `node:path` — no new dependency
   anywhere. The api's `resolve-at-aliases` surface is replaced by a `#`-extension surface over it, and the
   CLI's BE bundler calls the same function.

   **Skip the move if [`goal-pack-imports-name-the-file.md`](goal-pack-imports-name-the-file.md) is also
   planned.** That goal has pack code write its extensions, after which nothing needs the function at all and
   it is deleted rather than moved — measured, `.ts` and `.js` specifiers resolve in `tsc`, Vite and esbuild
   alike, and only the extensionless form has to be taught. Move it only if this goal runs alone.
5. **A check refuses a new `@/`** in a pack's source or tests (`check:specifiers`). Without it this reverts
   one import at a time, and 824 edits are not something to do twice.
6. **Nothing about the scaffold's layout changes.** A scaffolded pack already uses `#generated` and nothing
   else; that it needs no edit is the evidence this goal is moving *toward* what the tool generates.

## Open decisions — **settled 2026-09-26**

1. **One `imports` entry per top-level directory**: `#features/*`, `#extensions/*`, `#app-settings/*`, beside
   the `#generated/*` that already exists. It matches the entry that was already there, keeps specifiers
   short, and makes a new top-level directory a deliberate two-line addition. The catch-all `#src/*` was the
   alternative — one line that never needs editing — and it costs four characters on every import and would
   have left `#generated` inconsistent unless that folded in too, re-renaming the 550 Phase 1 had just moved.

2. **Drop the CLI's tsconfig-alias reader.** `#` becomes the only supported way a pack names its own modules,
   and `apack-cli/src/build/tsconfig-aliases.ts`, `makeAliasPlugin` and the spec's seven cases go with it —
   about ninety lines. Keeping them would keep a mechanism nothing in the repo exercises, which is exactly how
   its two copies drifted apart unnoticed until 2026-09-26. The cost is real and accepted: a pack that
   declares `compilerOptions.paths` of its own gets no bundler support for it.

## Phases

### Phase 1 — `@/__generated__` becomes `#generated`

The 547 mechanical edits, src and tests, with a script whose rule goes in the commit message. Drop
`@/__generated__/*` from `packages/default-setup/tsconfig.json`; `#generated/*` and its `imports` entry are
already there. No config changes: `#generated` already resolves in every tool.

**Done when:** no `@/__generated__` remains; `npm run typecheck`, `npm test -w @app/default-setup` (87 files,
720 tests), `npm run build` and `npm test` pass unchanged.

### Phase 2 — the other three prefixes

Add the `imports` entries the settled Open decision 1 names, mirrored in `paths`, and rewrite the remaining
277 edits. `packages/default-setup/CLAUDE.md` states the one convention and why the mapping is declared twice.

**Done when:** no `@/` remains in `packages/default-setup`; the same five commands pass unchanged.

### Phase 3 — the configs that re-implemented it

> One line here is shared with [`goal-pack-test-config.md`](goal-pack-test-config.md), which
> has run: `packages/default-setup/vitest.config.ts` is a `definePackTestConfig()` call that passes
> `tsconfigPaths` beside it, with a comment naming this goal as what removes that. So this phase deletes one
> line and its import from that file, not a surface from a config it assembles. Nothing else overlaps — the two
> goals' phases name no other file in common.

Delete the `@/` branch from `packages/renderer/vite.config.ts`, and `vite-tsconfig-paths` from
`packages/default-setup/vitest.config.ts` (with its devDependency). Move `resolveWithExtensions` to
`@apackdev/host/build/`, replace `packages/api/tsup.config.ts`'s `resolve-at-aliases` with a `#`-extension
surface over it, and point the CLI's BE bundler at the same function. Act on Open decision 2 for the CLI's
alias reader.

**Done when:** `npm run build`, `npm test`, `npm run test:external-pack` and `npm run test:packaged-authoring`
pass; no config resolves `@/`; `grep -rn "@/" packages/*/vite.config.ts packages/*/tsup.config.ts` is empty.

### Phase 4 — the guard

`check:specifiers` refuses a `@/` specifier in a pack's source or tests, naming `#` and the pack's own
`imports` as the fix. Mutation: reintroduce one `@/features` import and watch it named.

**Done when:** the check passes, has been made to fail, and `npm run typecheck` is green.

### Phase 5 — the numbers

Record what came out: the four mechanisms reduced to one, the lines deleted, and whether any build got
measurably faster or slower (a resolver hook per import is not free, but neither is it obviously
significant — measure `npm run build:app` before and after rather than claiming either way).

**Done when:** the Outcome carries before-and-after figures rather than an assertion.

## Deferred

- **`@<pack-id>/*`**, the renderer's other namespace alias into each pack's `src/`. It is cross-package, so
  `#` cannot express it — a `#` name is private to its own package, which is the property that makes it
  safe. Whatever replaces it is a different question about how one pack reaches another, and pack code
  already goes through generated facades rather than paths.
- **`moduleResolution: nodenext` and extensioned specifiers**, which would make pack source resolvable by
  Node with no bundler help at all and remove even the esbuild extension surface. It is a larger change (it
  moves the scaffold too, and `tsc` then *requires* the `.js` form, spiked above), and it is orthogonal:
  this goal is about having one mechanism, that one is about which regime it runs under.

## Constraints

- **Rewrite with a script, review the rule.** 824 edits cannot be reviewed line by line; what can be
  reviewed is the substitution that produced them and the counts before and after. Put the script in the
  commit message.
- **Counts before and after, every phase.** `npm test -w @app/default-setup` is 87 files and 720 tests today.
- **Do not change `moduleResolution`.** Every spike above assumed `bundler`, which both default-setup and the
  scaffold declare. Changing it invalidates the measurements this plan rests on.
- **`.vue` files count.** 667 includes specifiers inside SFC `<script>` blocks; a rewrite that only walks
  `.ts` leaves the pack half-migrated and typechecking green, because `tsc` does not read SFCs (`vue-tsc`
  does).
- **Another agent works in this checkout.** Check `git status` before committing and name paths explicitly.

## Outcome (2026-09-26)

| Phase | Status | Evidence |
|---|---|---|
| 1 — `@/__generated__` becomes `#generated` | **done** | `bb996d9cb`. 550 specifiers in 345 files; the duplicate tsconfig mapping dropped |
| 2 — the other three prefixes | **done** | `ffb5d233c`. 282 in 159 files; `#features/*`, `#extensions/*`, `#app-settings/*` in `imports` with the `paths` mirror |
| 3 — the configs that re-implemented it | **done** | `242024eac`. Four mechanisms to none |
| 4 — the guard | **done** | `01fb228bd`. `findPackOwnAliases`, three mutations |
| 5 — the numbers | **done** | below |

**832 specifiers across 416 files**, and every suite's counts unchanged throughout: default-setup 87 files /
720 tests, `@apackdev/cli` 37 / 305 and 15 / 187, `@apackdev/host` 77 / 697, internal-repo-checks 17 / 227, the fixture
pack 10 / 32, E2E 21, `test:packaged-authoring` green.

### What went, and what replaced it

Four implementations of one idea became zero, because the idea itself was removed rather than centralised:

- `packages/renderer/vite.config.ts` — the `@/` branch keeps the renderer's own and loses the per-importer
  pack lookup. That lookup was the reason none of this could be a static alias.
- `packages/api/tsup.config.ts` — `resolve-at-aliases` keeps the API's own `@/` and loses its pack branch.
- `packages/default-setup/vitest.config.ts` — `vite-tsconfig-paths` gone; the config is one call and nothing
  else, Vite resolving `#` from the pack's own `package.json` unaided.
- `apack-cli/src/build/tsconfig-aliases.ts` (55 lines), `makeAliasPlugin` and the spec's 7 cases (78 lines)
  — deleted per Open decision 2.

What a pack needs instead is `#` from its own `package.json` `imports`, plus one small thing esbuild will not
do: supply the extension. That lives in `@apackdev/host/build/subpath-imports`, shared by `apack build`'s
backend bundle and the API's, because `packages/api` does not depend on `@apackdev/cli` and both depend on host.

### Corrections to the Decisions

- **Phase 1's "No config changes: `#generated` already resolves in every tool" was false**, and `npm run
  build` said so: the API's tsup could not resolve `#generated/services`. esbuild finds the mapping and then
  refuses the path, needing the extension — which this goal's own spike table already recorded. What hid it is
  that the five `#generated` imports the pack already had were all under `src/content/flows/`, which
  `apack build` compiles and the API never sees, so the claim rested on files that could not have tested it.
  Decision 4 moved forward from Phase 3 into Phase 1 as a result; **if a phase's premise is "no config
  change", name the evidence for it, because five files in the wrong directory looked like evidence.**
- **Decision 4's move became a deletion in part.** It said `resolveWithExtensions` moves to host so the API
  and CLI can share it, which happened — and the *alias* reader beside it was deleted rather than moved, per
  Open decision 2.

### The numbers, and one I could not honestly get

`npm run build:app` is **24.2s, 24.4s, 24.2s** over three runs after the change. The deleted hooks were
per-import `resolveId`/`onResolve` callbacks, and their cost is below the noise of a 24s build.

**A valid "before" was not cheaply obtainable, and the attempt is worth recording.** Restoring the two
configs while the code uses `#` gives a build that *fails* — 292 errors — so the 24.5s it took is a
measurement of nothing; a worktree at the old commit resolves `@apackdev/*` back through the shared
`node_modules` to this checkout's migrated source, so that is no better. The configs and the specifiers are
now coupled, which is the point of the change and also what makes them hard to time apart. Reporting the
failed run as a "before" would have been the easy error.

### The conventional choices

- **`#` names mirror the directory** — `#features/*` for `src/features/*` and so on, so a specifier reads as
  a path. `#src/*` was the rejected alternative (Open decision 1).
- **The rewrite matched `['\"]` and not `'`.** The first Phase 2 run matched single quotes only and missed one
  double-quoted import; `typecheck` caught it. Two stale prose paths naming a `@/services/…` that was never a
  mapping went with it.
- **`fe-bundler-tailwind`'s unreadable-tsconfig case was rewritten a third time**, having pinned the mechanism
  each time: first the line-comment stripping, then the warning, now neither. What survives is the property —
  Vite parses the pack's tsconfig itself and refuses it — which depends on nothing this repo wrote.
- **`etc/pack-types.api.md` was re-recorded twice**, a doc comment reaching the bundled facade types both
  times. `facade:check` is deliberately not a chain step, so it is the only thing that notices.

### What this leaves for the next goal

[`goal-pack-imports-name-the-file.md`](goal-pack-imports-name-the-file.md) is now the one thing
between the repo and needing no resolver at all: with extensions written, esbuild needs no help and
`@apackdev/host/build/subpath-imports` can be deleted too. Its spike table and this goal's are the same
measurements.
