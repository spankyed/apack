# Goal: a pack's test config is a call, not a copy

> **Done** (`c0f7b49de`..`edd6ab382` on `AS/alias-simplification`). The text below is the plan as written,
> with its Decision 2 and its Open decision already corrected before implementation (`73ea2deab`). For what
> a pack's config is now, see `docs/public-facing/testing.md`; for the rule that keeps it that way,
> `internal-repo-checks/tests/pack-test-config.spec.ts`.

```
# Goal: a pack's test config is a call, not a copy

Implement docs/goals/goal-pack-test-config.md on AS/test-pipeline, at or after 232f85e78 — the base its
Background was surveyed at.
Before Phase 1, confirm the base: `cd packages/default-setup && npx vitest related --run
src/features/notes/be/system.ts` fails with "Install @vitejs/plugin-vue", and packages/default-setup,
tests/fixtures/external-pack and apack-cli's VITEST_CONFIG_TEMPLATE hold three different vitest configs.
If either is already false, stop and say so — the survey was taken somewhere else.
Read Background, Decisions, Phases and Constraints first. Decisions are final: implement them, don't
reopen them or stop to ask. Its one Open decision was settled on 2026-09-26 and the section records what
settled it; there is nothing to ask before starting.
Where a detail isn't specified, pick the conventional option, note it in the final summary, and keep
going. No backward compatibility in code (root `CLAUDE.md`, "Backward compatibility" — it is a standing
rule, not this goal's choice): change signatures, move modules, migrate every in-repo caller, test,
fixture, template and doc in the same change, and fix forward.

Finished when:
- Phases 1–4 are implemented and each meets its "Done when"; every new guard is mutation-checked.
- One function defines a pack's vitest config, and packages/default-setup, every fixture pack and the
  `apack init` template call it rather than restating it.
- `npx vitest related` and `--changed` work inside a pack — through the `.vue` stub, with no pack config
  holding alias handling of its own — and `npm run spec -- <pack source>` runs the specs that cover it rather
  than that pack's whole suite. The before and after are measured and recorded.
- npm run typecheck; npm run api:update committed if a published entry moved; npm run test:external-pack;
  npm run test:packaged-authoring; npm run chain once at the end.
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
- declare the `@apackdev/source` condition in a pack's config: `check:specifiers` refuses it, and the reason
  is the whole point of the two pools.
```

## Background (surveyed 2026-09-26 at `232f85e78`)

`@apackdev/testing/vitest` exports one thing, `isolatedDataDir()`. Everything else a pack's vitest config needs
is copied, and the three copies have already drifted:

| | surfaces | `globals` | timeouts | `fileParallelism` | `exclude` |
|---|---|---|---|---|---|
| `packages/default-setup/vitest.config.ts` | `tsconfigPaths` | ✓ | 15s / 15s | ✓ | `_support/**` |
| `tests/fixtures/external-pack/vitest.config.ts` | — | **✗** | — | — | `tests/e2e/**` |
| `apack-cli`'s `VITEST_CONFIG_TEMPLATE` (`init.ts:125`) | — | ✓ | — | — | `tests/e2e/**` |

The fixture pack runs without `globals` while the scaffold sets it. Nobody decided that; it is what three
copies do.

### No pack's test config can load the pack's own frontend

`apack add feature` writes `fe/surface.ts` importing `canvas/list.vue`. No pack's vitest config has
`@vitejs/plugin-vue`, so the first spec that reaches a surface module fails with *"Install @vitejs/plugin-vue
to handle .vue files"* — in the pack author's own repo, about a file the CLI generated for them.

Nothing in the repo hits it today only because no pack spec imports a surface module. `vitest related` does,
because it walks the whole graph from the changed file:

```
$ cd packages/default-setup && npx vitest related --run src/features/notes/be/system.ts
Error: Failed to parse source for import analysis because the content contains invalid JS syntax.
Install @vitejs/plugin-vue to handle .vue files.
```

### The answer is not the real surface, and this repo already says so twice

Adding `@vitejs/plugin-vue` works, and it drags a second problem in with it — the pack's `@/` aliases are not
applied inside an SFC, so `form.vue`'s own imports then fail to resolve. Chasing that led to
`vite-tsconfig-paths`' `loose: true` and to sharing the FE bundler's tsconfig reader. **Both were solving a
problem that does not need to exist**, and the repo had already answered this question twice elsewhere:

- `apack init`'s `env.d.ts` declares `*.vue` as a generic component, because *"Plain `tsc` can't read .vue
  files"* — and adds that checking *inside* an SFC needs the real tool, `vue-tsc`.
- `apack build` stubs `.vue` and `.css` to empty modules for the **backend** bundle
  (`be-bundler.ts`, `stubFrontendAssetsPlugin`): *"The backend runtime never renders them."*

Stubbing `.vue` in the test config is the third instance of that pattern, not an invention. And it makes the
alias problem vanish rather than solving it: a stubbed SFC is never parsed, so nothing inside one is resolved.

Measured 2026-09-26 with a three-line stub surface and **default-setup's existing config otherwise untouched**
— no Vue plugin, no `loose: true`, `tsconfigPaths` exactly as it is:

| Changed source | Before | After |
|---|---|---|
| `features/brain/be/flow-system.ts` | parse error | **3 specs, 2.8s** |
| `extensions/steps/llm/runtime.ts` | parse error | runs |
| `features/{code,brain}/fe/surface.ts` | parse error | "no test files" — correct, nothing imports them |
| the whole suite | 87 files / 720 tests | **87 / 720, unchanged** |

Against **18s** for the whole suite, which is what `npm run spec -- <pack source>` runs today
([`goal-spec-follows-the-graph.md`](goal-spec-follows-the-graph.md)'s Outcome records why it
runs anything at all: it used to run nothing and exit 0).

### Almost nothing renders, so almost nothing needs the real surface

**Exactly one spec in this repo mounts a Vue component** (`docs/references/test-inventory.md` lists it as a
coverage gap), and no pack spec imports a `.vue` at all — which is precisely why `npm test` passes in
default-setup while `vitest related` dies. What every pack needs is a module graph that resolves. What almost
no pack needs is rendering. That asymmetry is what makes the stub the default and the surface opt-in.

## Decisions

Final.

1. **One function defines a pack's vitest config**, exported from `@apackdev/testing/vitest` beside
   `isolatedDataDir`. That package is already every pack's test-time dependency and already owns the data-dir
   half of the config; the rest belongs with it. A pack's config becomes a call plus whatever that pack adds.
2. **It stubs `.vue` to a generic component, and holds no alias handling at all.** The stub is what makes a
   pack's graph walk, following `env.d.ts` and `stubFrontendAssetsPlugin`; and because a stubbed SFC is never
   parsed, nothing inside one needs resolving, so the helper needs neither the pack's aliases nor
   `vite-tsconfig-paths`' `loose: true`. Measured: default-setup's existing config walks the graph with the
   stub and no other change. **The stub throws on mount**, naming `vue: true` as the fix, so a component test
   cannot silently assert against an empty component.
3. **`vue: true` opts into `@vitejs/plugin-vue`, as an optional peer of `@apackdev/testing`.** Peer because a
   vite plugin must match the vite instance vitest brings, and `vitest` is already a peer for that reason; a
   direct dependency invites two vites and a surface bound to the wrong one. Optional because a pack that
   renders nothing needs nothing, and `peerDependenciesMeta` is how that is said. The helper imports it
   dynamically and, when it is missing, throws one sentence naming the install — rather than vitest's
   "Install @vitejs/plugin-vue" surfacing from inside a config file the author did not write. The scaffold
   adds it to no one.
4. **It declares no `@apackdev/source` condition, ever.** A pack resolves the published `dist` because that is
   the one layout a pack author has, `check:specifiers` refuses a pack config that declares the condition, and
   this helper must not become the place that quietly does it. The two pools (`UnitSuite.kind`) depend on it.
5. **The built-in pack, every fixture pack and the `apack init` template all call it.** A reference pack that
   does not look like what the tool generates is how the three copies happened; nothing that can call it keeps
   a copy.
6. **`npm run spec` narrows a pack source file once the graph walks.** `ownSuiteFor` in
   `scripts/lib/spec-plan.ts` plans the pack's whole suite today with a comment pointing here; Phase 3 turns
   that into `related` inside the pack — measured 3 specs in 2.8s against the whole suite's 18s — and keeps
   `packages:ensure` in front of it for the same reason a root run does.
7. **A guard, because this is a copy-paste failure by nature.** A check that every pack's vitest config calls
   the helper — the built-in pack, the fixture packs, and the CLI's template as text — so the fourth copy
   fails rather than drifts.

## Open decision — **settled 2026-09-26: no package on the default path**

It asked how a pack author gets `@vitejs/plugin-vue` and `vite-tsconfig-paths` at their own install, with
three options. It has no subject any more: **the default path needs neither.** `vite-tsconfig-paths` was only
ever needed for the alias problem a stubbed SFC does not have, and `@vitejs/plugin-vue` is now opt-in.

What settled it, in order: a scaffolded pack's only alias is `#generated/*`, declared in `package.json`
`imports` and resolved natively by Node, Vite and esbuild — the tsconfig `paths` copy exists only so `tsc`
agrees. Only default-setup needs alias resolution at all, having chosen `@/features/*`. And stubbing `.vue`
means no alias inside an SFC is ever resolved, so the question stops being asked.

So Decision 3 stands where three options were: an **optional peer** for `vue: true`, nothing for anyone else,
and the scaffold unchanged. The reasoning, kept, because "why not simply depend on it" will be asked again:

- **A dependency of `@apackdev/testing`** would give a pack author working frontend specs from one install, and
  it breaks that package's own pattern — `vitest` and `@playwright/test` are peers precisely because a test
  framework must be the consumer's single copy, and a surface *of* vite has the same constraint.
- **A plain peer** would have every pack declare a package most of them never load.
- **Detected by whether the package resolves** would hide a broken install behind a silently different config,
  which is the failure this goal exists to remove. Detecting on the *pack's own content* — does it have SFCs —
  is a different thing and is what the error in Decision 3 does.

## Phases

### Phase 1 — the function, and the built-in pack calls it

Add `definePackTestConfig` to `@apackdev/testing/vitest`: the `.vue` stub, `globals`, the include/exclude
(`tests/**/*.spec.ts`, less `tests/e2e/**` and any `_support/**`), the tier-1 timeouts and the data-dir
wiring. No alias handling — Decision 2. `packages/default-setup/vitest.config.ts` becomes a call plus its own
`_support` exclusion and, until
[`goal-one-way-to-name-your-own-modules.md`](goal-one-way-to-name-your-own-modules.md) removes its `@/`
imports, its own `tsconfigPaths`. `npm run api:update` if the entry's surface moved, committed.

**Done when:** `npx vitest related --run src/features/notes/be/system.ts` inside `packages/default-setup`
reports the covering specs rather than an error; `npm test -w @app/default-setup` is 87 files and 720 tests,
unchanged; and default-setup's config states nothing the helper already says.

### Phase 2 — the fixture packs and the scaffold

`tests/fixtures/*/vitest.config.ts` and `apack-cli`'s `VITEST_CONFIG_TEMPLATE` call it too. The CLI's scaffold
specs and `docs/public-facing/testing.md` show the call.

**Done when:** `npm run test:external-pack` and `npm run test:packaged-authoring` pass with their counts
unchanged (10 files / 32 tests for `external-pack`'s vitest half), and no pack config in the repo restates
what the helper holds.

### Phase 3 — `spec` narrows inside a pack

Turn `ownSuiteFor`'s whole-suite run into `related` inside that pack, `packages:ensure` in front. Measure and
record the same files as the Background table, before (18s) and after.

**Done when:** `npm run spec -- packages/default-setup/src/features/brain/be/flow-system.ts` runs 3 files in
about 3s, `spec-plan.spec.ts` asserts the plan, and the comment in `spec-plan.ts` pointing at this goal is
replaced by what the code now does.

**Measured 2026-09-26**, `npm run spec -- packages/default-setup/<file>`, against the whole suite's 87 files
and 18s:

| Changed source | Files | Wall |
|---|---|---|
| `features/brain/be/flow-system.ts` | 3 | 6s |
| `extensions/steps/llm/runtime.ts` | 3 | 3s |
| `content/actions/claude-code/_helpers/auto-approve.ts` | 3 | 3s |
| `features/threads/be/system.ts` | 1 | 2s |

The first is the slowest only because it paid for `packages:ensure`'s stat pass first; the rest are the steady
state.

### Phase 4 — the guard

A check that every pack vitest config in the repo calls `definePackTestConfig`, and that the CLI's template
does as text. Mutation-check it by restating `globals` in one config by hand.

**Done when:** the guard passes, has been made to fail, and `npm run chain` is green.

## Deferred

- **Sharing the FE bundler's tsconfig reader with the test config**, and `vite-tsconfig-paths`' `loose: true`.
  Both were in this goal's Decision 2 as ways to resolve a pack's aliases inside an SFC. Neither is needed:
  a stubbed SFC is never parsed. Recorded because the reasoning that led to them is sound and will recur — it
  is only the premise, that the test config must read SFCs, that is wrong.

- **Making a pack suite resolve workspace source** so no seam exists. Rejected rather than deferred: the pack
  suite exists to check that a pack works against the `dist` a pack author installs, `packages:check` and
  `test:packaged-authoring` defend that boundary, and dissolving it would make the largest suite test
  something nobody ships.
- **A pack's Playwright config**, which has the same copy-paste shape (`apack init-tests` scaffolds one).
  Worth the same treatment, and a separate change: it runs a different runner against a built app.

## Constraints

- **Counts before and after, every suite this touches.** A config change's characteristic failure is a spec
  that stops being collected, and `include`/`exclude` is exactly what this moves.
- **Measure on an idle machine, and say what you measured on.** The 2.6s figures above were taken with the
  surface added by hand and reverted; re-take them on the real implementation.
- **`@apackdev/testing` resolves its built bundle for everyone**, the repo's own E2E included
  (`packages/apack-testing/CLAUDE.md`), so a change here needs that bundle rebuilt before any pack suite
  sees it — `npm run packages:ensure` does it, and every entry point that triggers it is listed in that file.
- **Don't relitigate settled decisions.** The two pools and why they cannot be one, a pack resolving `dist`,
  and where a spec lives are final.

## Outcome (2026-09-26)

| Phase | Status | Evidence |
|---|---|---|
| 1 — the function, and the built-in pack calls it | **done** | `c0f7b49de`. `related --run src/features/notes/be/system.ts` is 1 spec where it was `Install @vitejs/plugin-vue`; 87 files / 720 tests unchanged |
| 2 — the fixture packs and the scaffold | **done** | `0bf5ec9ea`. `apack init` writes 4 lines where it wrote 18; external-pack 10 / 32 and 12 + 1 Playwright; `@apackdev/cli` 39 / 329 and 15 / 187; `test:packaged-authoring` green |
| 3 — `spec` narrows inside a pack | **done** | `1fc522ed9`. 1–3 files in 2–6s against the whole suite's 87 and 18s |
| 4 — the guard | **done** | `edd6ab382`. Three mutations, each caught |

`npx vitest related` and `--changed` both work inside a pack now, which is what the whole thing turned on. No
API report covers `@apackdev/testing`, so there was nothing to regenerate.

### What the plan did not anticipate

- **A guard had to follow the budget into the helper.** `suite-timeouts.spec.ts` reads every vitest config as
  *text* — deliberately, because importing one creates a temp data dir — and requires each to declare its
  tier's timeouts. The moment default-setup's config became a call, the property read as absent. It now reads
  the helper's source too when a config delegates to it, helper first so a pack overriding a key still wins.
  Two mutations pin it. This is the general shape to expect from consolidating anything: a check that reads
  configs as data has to learn where the data moved.
- **One CLI case had to change rather than move.** `harness-setup`'s isolate-off test string-replaced
  `test: { include:` in the config text. It now writes a config that spreads the helper's result and overrides
  two keys — which is both what a pack would do and the only way to override anything the helper decides, so
  the case proves composition as well as the failure it was written for.

### The conventional choices

- **The helper excludes `tests/e2e/**` and `tests/_support/**` by default**, so no pack passes `exclude` at
  all. The plan had default-setup keeping its own `_support` exclusion; making it a default meant one less
  thing in every config, and the fixture pack's `e2e` exclusion disappeared for free.
- **`isolatedDataDir` stays exported**, for a config the helper cannot express, and the docs say so.
- **The guard's rule is "declares no `test` block"** rather than an enumeration of the keys the helper owns.
  Blunter, and it fails on any escape rather than on a list someone has to keep current — with an exception
  list that then records *which* pack escaped and why.
- **The two CLI harness fixtures' inline configs moved too.** `harness-setup`'s was marked *"As `apack init`
  scaffolds it"*, a claim that goes stale the moment the scaffold changes, which is the drift this goal is
  about.

### A lesson worth the line

**Both halves of the Phase 4 guard were fooled by prose on their first mutation run.** The scaffolded template
*mentions* `definePackTestConfig()` in the comment explaining it, so a template that had reverted to
`defineConfig({ test: … })` still passed a `toContain` check; and `test:` written mid-line — exactly what
spreading the helper's result looks like — was missed by a pattern anchored to the line start. Both now strip
comments and match a call rather than a mention.

That is twice in one day that a first-draft guard passed its own mutation for the wrong reason (the other was
`doc-links`, which matched only `./`-prefixed links and so could not see the sibling links archiving
produces). The mutation check is not a formality on a guard that reads text: **a text check tends to pass for
the wrong reason, and the mutation is the only thing that says so.**
