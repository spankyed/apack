# Goal: one rule set, one reader, one census

> **Done** (`1b2bc6761`..`437bdf35d` on `AS/alias-simplification`). The text below is the plan as written; four
> things it did not foresee are in the Outcome, the largest being that `.d.ts` and `.md` templates cannot reach
> the packaged app at all. For the rules now, see `packages/apack-cli/src/build/pack-rules.ts` and
> `docs/public-facing/cli.md` § Validation; for the scaffold's templates,
> `packages/apack-cli/src/templates.ts`.

> **Written in session** `1d53eb9c-d886-49f8-bc5a-90793d43315e` (Claude Code, 2026-09-26). Resume it with `claude -r 1d53eb9c-d886-49f8-bc5a-90793d43315e`.

```
# Goal: one rule set, one reader, one census

Implement docs/goals/goal-one-rule-set.md on AS/alias-simplification, at or after ed84beced — the base
its Background was surveyed at.
Before Phase 1, confirm the base: scripts/check-import-specifiers.ts has 19 CHECKS entries,
packages/apack-cli/src/build/pack-sources.ts exists, packages/apack-cli/src/commands/add/templates.ts
still holds the scaffold's template literals, and scripts/lib/step-timing.ts exports driftedSteps with
two parameters. If any of those is false, stop and say so — the plan was surveyed somewhere else.
Read Background, Decisions, Phases and Constraints first. Decisions are final: implement them, don't
reopen them or stop to ask.
Where a detail isn't specified, pick the conventional option, note it in the final summary, and keep
going. No backward compatibility in code (root `CLAUDE.md`, "Backward compatibility" — it is a standing
rule, not this goal's choice): change signatures, move modules, migrate every in-repo caller, test,
fixture, template and doc in the same change, and fix forward. Stored user data is the exception: it
moves with migrations.

Finished when:
- Phases 1–6 are implemented and each meets its "Done when"; every new guard, helper or test is
  mutation-checked.
- The scaffold's pack code is files under packages/apack-cli/templates/, and CLI_TEMPLATE_SOURCES,
  CLI_COMMAND_SOURCES, templateCode, templateProblems, findInFiles' isTemplateSource branch and
  findUnlistedPackTemplates are gone.
- One reader parses each file once: the instrumented parse count is under 2,000, down from 9,698 over
  1,608 files, and a spec asserts no file is read twice.
- The pack-code rules are one implementation each, run by `apack validate`, `apack build` and
  `apack test` for every pack, with the switchable ones silenced by `apack.checks.json`.
- `scripts/check-import-specifiers.ts` runs every rule (no exit inside the loop), takes paths and
  --rule and --list, and its scopes come from scripts/lib/repo-census.ts rather than six constants.
- `npm run chain` prints no drift advisory on an incremental run, and still reports one under --all.
- npm run typecheck; npm run check:specifiers; npm run compile; npm run build; npm test;
  npm run test:external-pack; npm run test:packaged-authoring; npm run test:integration;
  npm run spec-cost:check; npm run chain once at the end.
- A final summary: phase → done/deferred, evidence, and the conventional choices made.
- The doc is in `docs/archive/goals/`, with its status blockquote and an Outcome section, committed.

Commit as you go:
- Commit each phase when its "Done when" holds and the checks are green — not once at the end. Phase 2
  is seven commits, one per step, each ending with the byte-identity diff. Conventional message, no
  Co-Authored-By or session lines, `git commit -- <paths>` naming only that step's files.
- Check `git diff --cached` first: something outside the session stages files.
- Don't push, tag, or open a PR unless the user asks.

Never:
- push, tag or open a PR unless the user asks in this session.
- npm publish, create GitHub releases, or trigger workflows (dry runs only).
- open, copy or modify ~/Library/Application Support/apack* or any real data dir.
- pkill/killall Electron or node; launch the app outside the test env without an isolated
  APACK_USER_DATA_DIR.
- run bare tsc on packages/preload (build it with npm run build -w @app/preload), npm install in the
  example pack, or edit version/release metadata.
- delete or loosen a test to make a number move. A template that cannot be made byte-identical stays
  in code instead.
```

## Background (2026-09-26, at `ed84beced` on `AS/alias-simplification`)

`goal-pack-imports-name-the-file.md` landed, a review of it found five defects, and fixing those left four
loose ends. They are symptoms of one thing: `scripts/check-import-specifiers.ts` is ~1,140 lines holding 19
rules, each with its own hand-listed scope and its own file walk.

Measured on this checkout:

| | |
|---|---|
| `npm run check:specifiers` | 4.4s, and **9,698 parses over 1,608 distinct files** — six parses per file (instrumented `parse()` with a counter) |
| scope constants | `CHECKED_DIRS` (:14), `PACK_SOURCE_DIRS` (:112), `PACK_TEST_DIRS` (:302), `PACK_SRC_ROOTS` (:611), `CLI_TEMPLATE_SOURCES` (:109), `CLI_COMMAND_SOURCES` (:413) — 17 references |
| scaffold templates | **561 lines of pack code inside template literals**, across 10 files under `packages/apack-cli/src/commands/` |
| rules an external pack gets | **2 of 19** (`internal-imports-gate.ts`, `own-module-specifiers-gate.ts`) |
| `findJsSpecifiers`' scope | 5 of 15 packages; pointed at every package's `src`/`tests`/`scripts` it reports **87 findings — 85 in `packages/main`, 2 in `packages/preload`**, and zero elsewhere |

The four loose ends, and what each rests on:

1. **The chain nags.** `driftedSteps` (`scripts/lib/step-timing.ts:56`) compares a step's measured time against
   its declared `seconds`, but `test:unit:host` and `test:unit:pack` run only their stale projects
   (`scripts/test-unit-pool.ts:35`), so an incremental run is under half the declared number and the advisory
   fires nearly every time. The number cannot simply be lowered: `test-unit-pool.ts:60` passes
   `POOL_SECONDS[kind]` to `budgetFor` for the pool's own inner vitest spawn, and `chain.ts` uses it for the
   step's kill deadline at 4×.
2. **Two walks with different skip policies.** `sourceFiles` in the script (:27) skips nothing — not
   `node_modules`, not `dist`; `packages/apack-cli/src/build/pack-sources.ts:23` skips `node_modules` and
   takes a `skip` predicate; `walkTree` (:924, inside `findMissingSourceConditions`) skips `SKIPPED_DIRS` and
   is the only walk that follows symlinks safely.
3. **Two CLI files police what no other CLI source does.** `PACK_SOURCE_DIRS` (:112) folds in
   `CLI_TEMPLATE_SOURCES`, so `findJsSpecifiers` covers `packages/apack-cli/src/commands/add` and `init.ts`
   and no other file in that package.
4. **One offence, two rules.** A relative `.js` in pack code is reported by both `findJsSpecifiers` and
   `findExtensionlessOwnModules`; only the first shows, because the runner `process.exit(1)`s inside its loop
   (:1416-1425).

What the scaffold's code-in-strings costs: `CLI_TEMPLATE_SOURCES`, `templateCode()` (:148, which blanks `${…}`
in place so positions survive), the `isTemplateSource` branch of `findInFiles` (:170,177), `templateProblems()`
(:392, an extension-only check because there is no pack to resolve against), the `!/_$/.test(text)` exception
for a specifier ending in a substitution, and `findUnlistedPackTemplates` (:425) — a rule whose only job is to
check that a two-entry list is complete.

Facts that constrain the design:

- `@apackdev/host` declares neither `typescript` nor `vue`; `packages/api` imports host, so the Vue compiler must
  not enter the backend's tree. `@apackdev/cli` has both as hard dependencies and is `private` with no `exports`
  map. `@apackdev/sdk` has `vue` as a peer and `typescript` as an optional one, but its published `./build`
  declarations are typechecked standalone by `packages/internal-publish-checks`.
- A repo script importing a package's internals by relative path is already the pattern:
  `scripts/build-ui-package.ts:18` imports `../packages/apack-ui/scripts/exports.ts`, and
  `scripts/tsconfig.json` sets `allowImportingTsExtensions`. `findPackageScriptImports` governs a *package's*
  `scripts/`, not the repo's.
- `packages/main` bundles: `vite.config.js` uses `build.lib` with one `src/index.ts` entry and `dist/` holds
  one `index.js`. It is `moduleResolution: NodeNext` **with** `allowImportingTsExtensions: true` — the same
  combination `@apackdev/ears`, `/sdk`, `/host` and `/ui` use while naming `.ts`. `packages/preload` is NodeNext
  with `noEmit: true` and without that flag.
- `electron-builder.mjs`'s `files` array excludes `'!**/*.md'` (:125) and `'!**/*.ts'` (:130), so a `.ts` or
  `.md` file inside `packages/apack-cli/dist/package/` is stripped from the packaged app — the CLI the app
  installs through `bin/app-launcher.sh`. Nothing tests that path.
- `scripts/bundle-package.ts`'s `copy` is `fs.copyFileSync` on single files (:194-198, throws `EISDIR` on a
  directory), and `assertPublishedPathsExist` (:73-81) checks each entry exists — which is true of an empty
  directory.
- `scripts/lib/spec-cost.ts:117` walks a package for `*.spec.ts` with `IGNORED = ['node_modules','dist','etc','coverage']`.
- The fixture packs (`tests/fixtures/external-pack`, `tests/fixtures/bundled-ui-pack`) are **not** npm
  workspaces (root `workspaces` is `["packages/*"]`), so `npm run lint:check -ws` cannot reach them — but
  `tests/scripts/test-external-pack-contract.sh:21` runs `apack validate` on each.
- oxlint 1.8.0 supports config `overrides` (per-path `files` globs), has `no-console` in the `restriction`
  category (not enabled by `-D correctness`), hosts **no** custom rule from the CLI (no `--js-surfaces`, no
  `jsPlugins` schema key) and has **no `no-restricted-syntax`**. eslint runs only over `packages/renderer`.
- `packages/internal-repo-checks/tests/import-specifiers.integration.spec.ts` is 1,282 lines and 217 tests: one
  `describe` per rule, each case writing a temp tree and calling the rule with explicit `dirs`/`root`, plus the
  `FIRES` table (:446) keyed by each rule function's `.name` and the two `describe('CHECKS')` cases (:552).
  `import-specifiers-script.integration.spec.ts` runs the script through a symlink and asserts its success line.

## Decisions

Final.

1. **Pack-code rules are one implementation each, in `packages/apack-cli/src/build/pack-rules.ts`**, run by
   `apack validate`, `apack build` and `apack test` for every pack, and by `check:specifiers` for this
   repo's. `internal-imports-gate.ts` is deleted: its rule and the script's `internalImport` are the same rule
   written twice.
2. **The reader stays in `@apackdev/cli`** (`src/build/pack-sources.ts`) and the repo script imports it by
   relative path. Not host (no `typescript`/`vue`, and the API imports it), not the SDK (pack sources import
   it, and its published declarations are typechecked standalone).
3. **A pack rule is switchable only when a violation has no runtime effect.** Not switchable:
   `own-modules`, `js-specifiers`, `pack-own-aliases`, `internal-package-imports`, `host-imports`,
   `lmdb-imports`, `contract-leaves`, `pack-source-condition`. Switchable: `untyped-sends`, `raw-transport`,
   `backend-console`, `cross-feature-imports`.
4. **The opt-out is `apack.checks.json`** at the pack root — `{ "allow": ["backend-console"] }` — read at
   build time and never by the app, so `apack.json` stays what the app loads. An unknown name, or a rule that
   is not switchable, is an error listing the switchable set. `ManifestSchema` is untouched.
5. **Scope is derived.** `scripts/lib/repo-census.ts` derives packages from the root `workspaces`, packs from
   any directory holding `apack.json`, and each pack's `src`/`tests` — replacing the six scope constants and
   three more copies of the packages derivation (`workspace-deps.ts`, `chain-steps.ts:167`,
   `packageSourceDirs()`). `packages/apack-host/src` and `templates/pack` are two declared additions to
   `packSrcRoots`, each with its reason, since neither has a manifest.
6. **The scaffold's pack code becomes files** under `packages/apack-cli/templates/pack/`, mirroring a
   scaffolded pack so relative specifiers resolve against real siblings. Placeholders are `__UPPER_SNAKE__`
   (no `$`, `{` or `}`, so every real `${…}` survives unescaped; a legal identifier, so a template still
   parses). A placeholder never occupies a statement slot — multi-statement variation is a two-file split.
7. **What stays in code**: `MANIFEST_TEMPLATE` and `PACKAGE_JSON_TEMPLATE` (objects with computed keys and
   runtime version ranges), `PACK_TSCONFIG`/`TSCONFIG_TEMPLATE` (imported as an object by
   `tests/_support/pack-builds.ts`), `GITIGNORE_TEMPLATE` (a nested `.gitignore` is read by npm as ignore
   rules), `EXAMPLE_CONTENT_TEMPLATE` (`.md` is stripped from the packaged app), and the register-entry
   fragments, which edit an existing file rather than rendering one.
8. **The runner collects every rule** instead of exiting inside its loop, and gains paths, `--rule` and
   `--list`. A per-file run names the whole-tree rules it skipped. The success line stays byte-identical.
9. **`findJsSpecifiers`' population widens to every package with no exemptions**, and the 87 findings in
   `packages/main` and `packages/preload` are migrated: they are unmigrated, not legitimate, since both bundle
   and `main` already sets `allowImportingTsExtensions`.
10. **`driftedSteps` skips a step that declares `forceArgs` unless the run forced it.** `forceArgs` already
    means "this step keeps a cache of its own"; `seconds` keeps meaning full-work cost, because two kill
    deadlines are sized from it.
11. **`no-console` moves to the pack rule set, not to the linter**, because the linter cannot reach a fixture
    pack or an external one. An `.oxlintrc.json` for editor feedback is deferred, not landed: it would be a
    second enforcement point for one rule.
12. **`findRepositoryCasts` stays in the script**, with its reason and the condition to revisit in its doc
    comment: oxlint 1.8 hosts no custom rule and has no `no-restricted-syntax`, and eslint does not run where
    the rule applies.

## Phases

Phase 1 is independent and goes first because it removes a daily annoyance. Phase 2 goes before 3 and 4
because it deletes machinery they would otherwise carry. Phase 5 needs Phase 3's positions.

### Phase 1 — the chain stops nagging

- `scripts/lib/step-timing.ts`: `driftedSteps(steps, measuredMs, forced = false)` skips a step declaring
  `forceArgs` unless `forced` (Decision 10), with a comment naming what would break the inference.
- `scripts/chain.ts:253`: pass `all`.
- `scripts/lib/chain-steps.ts`: comments only — what `seconds` means for a step that can do partial work, and
  that `POOL_SECONDS` is measured under `--all`. `packages:ensure` keeps reporting on a cold run, deliberately.
- `scripts/test-unit-pool.ts`: delete the stray trailing `// probe`.
- `CLAUDE.md:262-263,270`: one clause each.

**Done when:** four new `step-timing.spec.ts` cases pass (pooled step silent unforced; reported forced;
reported when it overran under `--all`; an ordinary step still reported unforced); `npm run chain` twice prints
no advisory on the second run (grep the string, don't eyeball); applying a drift in an ordinary step's
`seconds`, and in `POOL_SECONDS` under `--all`, each reports — and `POOL_SECONDS` written without `--all` stays
silent. Revert the content.

### Phase 2 — the scaffold's templates become files (seven steps, seven commits)

Decisions 6 and 7. Each step ends with the byte-identity diff below.

1. **Mechanism only, two templates** (`src/env.d.ts`, `tests/setup.ts` — both population directories must
   exist, because `findJsSpecifiers` throws on a listed directory that is missing): `src/templates.ts` with
   `templatesRoot()` / `templateFiles()` / `renderTemplate()`; the population additions; `templates/pack` into
   `findMissingSourceConditions`' `scan.packs`; `bundle-package.ts`'s recursive copy and directory-expanding
   assertion; `electron-builder.mjs`'s include after the exclusions; `spec-cost.ts`'s `IGNORED`; the
   completeness spec.
2. Zero-placeholder templates, including `vitest.config.ts` with `pack-test-config.spec.ts` repointed.
3. Single-value templates: prompt, flow, action, service, migration ×2, block ×2, artifact, `form.vue`,
   `list.vue`. Add the missing output assertions for `add action`, `add prompt` and `add flow`.
4. `add/feature.ts` — the 188-line bulk, with one `featureValues(name)` helper for the computed values.
5. `add/step.ts`'s `BUILD` and siblings — the nested-literal case.
6. `init.ts`'s remainder: `EXAMPLE_TEST`, `release.yml`, `smoke.spec.ts` ×2.
7. Delete the machinery: `CLI_TEMPLATE_SOURCES`, `CLI_COMMAND_SOURCES`, `templateCode`, `findInFiles`'
   `isTemplateSource` branch and `templates` parameter, `templateProblems` and
   `findExtensionlessOwnModules`' `templates` parameter, `findUnlistedPackTemplates` with its `CHECKS` row,
   `FIRES` entry and `describe`, the CLI-template exclusions in `findPackBackendConsole` (:290) and
   `repoPacks` (:328), and `writeTemplateSource` with its three call sites. Rename
   `add/templates.ts` → `add/write.ts` (9 import sites).

**Done when:** `apack init` + every `add` command, driven from the CLI into a fresh directory, is
byte-identical to a golden tree captured at `ed84beced` (`diff -r -x __generated__ -x .apack -x node_modules`,
empty output) at **every** step; `npm test -w @apackdev/cli` and its integration half pass;
`npm run test:packaged-authoring` and `npm run test:external-pack` pass; a `--dir` electron package lists
`Resources/app/packages/apack-cli/dist/package/templates/`; the completeness spec fails when a template file
is unreferenced and when a `renderTemplate` literal names a missing file.

### Phase 3 — one reader, and the pack rule set

Decisions 1, 2, 3, 4.

- `pack-sources.ts` gains `SourceView` / `readSource` / `readSources` / `resetSourceCache`, with
  `start`/`end` inside the quotes and a `.vue` block's `offset`; every existing signature keeps working.
- `pack-rules.ts` holds the twelve pack rules; `internal-imports-gate.ts` is deleted;
  `own-module-specifiers-gate.ts` delegates.
- `loadPackChecks(packDir)` reads `apack.checks.json`; `apack validate`, `build` and `test` run the set.
- `docs/public-facing/cli.md` § Validation documents the rules and the file.

**Done when:** `npm run typecheck`; a fixture pack with `apack.checks.json` allowing a switchable rule
builds, and one naming a non-switchable rule fails with a message listing the switchable set;
`npm run test:external-pack:contract` and `npm run compile` pass; a spec asserts
`block.content[i] === fileText[offset + i]` for a `.vue` with two script blocks, and that every specifier's
`start`/`end` slice the specifier out of the file on disk.

### Phase 4 — census, populations, one pass, per-file flag

Decisions 5, 8, 9.

- `scripts/lib/repo-census.ts`, with `walkTree` and its constants promoted out of
  `findMissingSourceConditions` verbatim; `workspace-deps.ts` and `chain-steps.ts:167` re-derived from it.
- Rule descriptors with `population`/`scope`/`pack`, one module per rule; every `findX(dirs, root)` export
  kept as an adapter so the existing cases need no edit; findings become structured.
- The one-pass runner, collect-all, and the flags.
- `findJsSpecifiers`' population widens; the 87 specifiers in `packages/main` and `packages/preload` are
  migrated by script and `allowImportingTsExtensions: true` is added to `packages/preload/tsconfig.json`.
- `FIRES` migrates to census trees, and the disjointness assertion lands: every rule fires on its example and
  **no other rule claims that offence**. `js-specifiers` narrows off pack code, so `own-modules` owns
  `.js`-in-a-pack.

**Done when:** `npm run check:specifiers` passes; the instrumented parse count is under 2,000 and a spec
asserts each census file is read once; `npm run test:integration -w @app/internal-repo-checks` passes;
`npm run build` and `npm test` pass with `main` and `preload` migrated; a per-file run names the whole-tree
rules it skipped, and a path outside the census is an error; `--list` shows no blank field.

### Phase 5 — `specifiers:fix`

- `scripts/lib/specifier-fixes.ts` (`spliceFile`, `applyFixes`) and `scripts/fix-specifiers.ts`, wired as
  `npm run specifiers:fix` with `--dry`.
- Fixes only findings carrying `named`. Verify the span before splicing, refuse the whole file on a mismatch
  or an overlap, splice right-to-left, never open a file with no fixable finding.

**Done when:** over a fixture pack with one offending file per fixable rule, two unfixable findings and three
clean files: the checker afterwards reports only the unfixable ones, the set of files whose bytes changed
equals the set that had a fixable finding, and a second run writes nothing; `specifiers:fix --dry` over the
real repo exits 0 with nothing to fix. Mutation: perturbing the splice offsets fails the content assertion.

### Phase 6 — `backend-console` moves, the cast rule stays

Decisions 11 and 12.

- `findPackBackendConsole` and its two path regexes move onto the pack rule (Phase 3's `backend-console`),
  and the script's rule, its `FIRES` entry and its `describe` are deleted — after its four firing shapes and
  eleven allowed shapes are transcribed into `pack-rules.spec.ts`.
- `findRepositoryCasts` gains the doc comment recording why it stays and what would change that.
- `CLAUDE.md:428` moves from `check:specifiers` to the pack rule set.

**Done when:** `pack-rules.spec.ts` covers all fifteen transcribed shapes; running the old rule and the new
one over the repo reports the same files (an empty diff, quoted in the commit message) before the old one is
deleted; `npm run test:external-pack:contract` passes.

## Deferred

- **An `.oxlintrc.json` for `no-console`** (Decision 11) — editor feedback for `default-setup`, at the cost of
  ~30 repeated globs, a root `lint:packs` leg, a coverage spec and a second enforcement point. Ask for it if
  the editor gap bites.
- ~~**`findCrossFeatureImports` and `findContractLeafImports` reading the AST** instead of text.~~ **Both done**
  (2026-09-27): the premise was wrong twice — neither needed byte offsets from a text scan (the reader's specifiers
  carry `start`/`end`, which is what the door-span correlation uses), and the closure walk needed only a line, while
  `findContractLeafImports` never took `view.code` from the reader at all, it called `fs.readFileSync`. Each port
  came with the false positives the regex had: a commented-out import and one inside a template literal.
- **`moduleResolution: nodenext` for packs** — recorded as deferred in
  `docs/archive/goals/goal-pack-imports-name-the-file.md` and unchanged by this goal.

## Constraints

- Commit each phase (and each of Phase 2's seven steps) as it finishes, `git diff --cached` first, paths named
  explicitly, no attribution lines. Pushing, tagging and PRs are on request only.
- No publishing, releases or triggered workflows; dry runs only.
- No real data dirs; no broad `pkill`; E2E through `npm test` so the isolated data dir applies.
- `packages/preload`: never bare `tsc` (its tsconfig has no `outDir`); build it with
  `npm run build -w @app/preload`.
- No version or release metadata.
- Don't delete or loosen a test to make a number move. A template that cannot be made byte-identical stays in
  code, and the plan says so.
- Mutation-check every new guard, and record the mutation in the commit message.
- External packs are first-class: the fixture packs, `test:external-pack` and `test:packaged-authoring` stay
  green, and `test:packaged-authoring` is the only check that exercises the published CLI layout.
- A new spec file in `@app/internal-repo-checks` needs `npm run spec-cost:update` **and** a row in that package's
  `CLAUDE.md` table; a new spec anywhere needs `spec-cost:update` for its suite.
- `packages/internal-repo-checks` should declare `vue` as a devDependency rather than relying on hoisting, since
  nothing checks its dependencies.

## Outcome (2026-09-26)

| Phase | Status | Evidence |
|---|---|---|
| 1 — the chain stops nagging | **done** | `240c78cc3`. `driftedSteps` skips a step that keeps its own cache unless `--all` forced it; four cases, one mutation; two chain runs silent, a written drift still reported |
| 2 — templates become files | **done** | `c4ea43aec`, `226819ac4`, `753833c29`, `9d00f67ed`, `eaf89af1f`, `2725f14ad`, `0ca955577`. 34 template files; the golden scaffold diff empty at every step; 176 lines of extraction machinery and one rule deleted |
| 3 — one reader, one rule set | **done** | `65021e770`, `2e51b133f`. `readSource` with positions; nine pack rules in `build/pack-rules.ts`; `internal-imports-gate.ts` deleted; `apack.checks.json` |
| 4 — census, one pass, per-file flag | **done** | `6c8eee988`, `1c40e6dca`, `a3e3be850`. **1,735 parses over 1,735 files, 2.67s — from 9,698 parses and 4.4s**; pack dirs derived from where a manifest is; `<paths…>`, `--rule`, `--list`; collect-all |
| 5 — `specifiers:fix` | **done** | `6c8eee988`. Its first subject was real: the 87 specifiers the widened rule found |
| 6 — `backend-console` moves, the cast rule stays | **done** | `437bdf35d`, and the rule itself in Phase 3 |

**Counts**: `@apackdev/cli` 350 tests (was 305 + 21 in the integration half), `@app/internal-repo-checks` 239,
`@app/default-setup` 720 unchanged, the fixture pack 32 unchanged, E2E 21 unchanged, `npm run chain` green in
183s. 15 commits.

### Corrections to the Decisions

- **Decision 6 said `.ts` and `.vue` templates are files. Two file types cannot be.** `electron-builder.mjs`
  strips every `.d.ts` from the packaged app whatever its `files` array says — measured on a `--dir` build:
  zero remain in `app.asar` — and excludes `'!**/*.md'` outright. So `env.d.ts` and the example content row stay
  strings in `init.ts`, with the reason recorded there and in `src/templates.ts`, and a spec refuses a `.d.ts`
  template. Without the `--dir` build in Phase 2's step 1 this would have shipped: `apack init` from the CLI
  the app installs would have scaffolded a pack with no `env.d.ts`, and no test covers that path.
- **Decision 3 listed `js-specifiers` as a pack rule; it is not one.** Both it and `own-modules` report a
  relative `.js`, and `own-modules` gives the better message because it resolves the specifier and names the
  file to write. Worse, `packages/default-setup` is a package *and* a pack, so with both rules covering it the
  offence was reported twice and — until the runner stopped exiting on the first failure — only once printed.
  `CHECKED_DIRS` now excludes any pack's own code, and a spec asserts the two populations stay disjoint.
- **Decision 9 expected the 87 specifiers to need a script; `specifiers:fix` did it**, which is the phase the
  plan said had no subject. The order in the plan (C then D) was wrong for that reason: D shipped first and
  earned its keep immediately.
- **The renderer's strictness caught a real mistake during Phase 2.** Passing a feature's whole value map to
  `be/system.ts`, which names no `__PASCAL__`, failed the render rather than ignoring the extra — so each call
  site passes exactly what its template uses.
- **`add action`, `add prompt` and `add flow` had no test that read their output**, only their exit code. Each
  has one now; the flow case writes the generated `flow-helpers.ts` the command reads to decide whether the
  pack has steps.
- **One `renderTemplate` may have two callers.** `steps/register.ts` is written by `apack init` and again by
  `apack add step` when a pack has no step list, so the completeness spec asserts every template is rendered
  *somewhere* rather than exactly once.

### Found after archiving (2026-09-26, 2026-09-27)

Three defects in what the phases shipped, each found by checking rather than by a failure.

- **The script's walk never skipped `node_modules` or `dist`**, while the CLI's did — so the one reader the
  goal was about was reading two trees it had no business in. One walker now skips both (`f2156fd70`).
- **Three rules reported one import three times.** `import { _rootEvents } from '@apackdev/host/bus'` breaks
  `host-imports`, `internal-package-imports` and `raw-transport`, and a pack author deleting one line was told
  three times in three blocks. A finding now carries the span of the code it is about, and one overlapping a
  span an earlier rule claimed stands down; `PACK_RULES`' order *is* that precedence. Overlap rather than
  containment, because the spans nest both ways — `host-imports` reports the specifier, `internal-package-imports`
  the import around it — so containment would let the wider span win regardless of the declared order. Spans
  rather than lines, because two real offences do share a line (`cf2f12f35`).
- **Decision 4's paste-able `allow` line was not paste-able.** The failure printed
  `add "checks": { "allow": [...] }`, and `loadPackChecks` reads `allow` at the top level and knows no `checks`
  key — so following the advice allowed nothing and the rule kept firing. It now prints the file's whole
  contents, and the spec pastes the printed line into `apack.checks.json` rather than matching its text, which
  is what stops the reader and the advice drifting apart again.

### Open items — closed 2026-09-27, and what closing them corrected

**Both rules moved.** `cross-feature-imports` and `contract-leaves` are in `PACK_RULES`, so an external pack is
held to them (`ca1b4ecbb`, `32c7b03dc`). How many rules a pack is held to is `PACK_RULES` and not a number
written here — the bullet this replaces said "nine of twelve" for a day after the third of three had shipped,
which is what a count in prose does. A rule now states in code whether the CLI owns it (`packRule`) or why its
subject is this repo (`repoOnly`), the two being a union so that one saying neither, or both, does not compile —
and the second is itself an answer with a kind rather than prose, so "a pack cannot commit this" and "a pack can
and nothing checks" are told apart by the reader instead of by whoever reads the sentence. This section can no
longer be the only place that knows.

- **Item 12 was wrong, and what it got wrong was the question.** It asked where a *syntactic* rule belongs —
  oxlint hosts no custom rule, eslint does not run over `packages/*/src` — and answered "the script", which is
  true of the mechanism and says nothing about who is held to it. Writing down what each repo-only rule costs an
  external pack (`4d178809a`) asked the other question and `findRepositoryCasts` was the only rule with an
  answer: `packages/*/src` includes `default-setup`, so this repo held its own packs to it and external packs
  were free of it, with `tests/fixtures/external-pack` writing the offence unseen. It is `repository-casts` now,
  switchable, and the exception is the generated facade, which is this cast by design. The linter question the
  item recorded is still open and still not the reason.

- **`cross-feature-imports`' stated blocker was real and was cleared.** It was 71 lines of which 33 were the
  rule, the rest the script's last regex pair; porting it to the shared reader (`9ea3558ef`) removed them, and
  the rule moved with `publishedEntryPoints` and `doorSpans` into `apack-cli/src/build/pack-features.ts`.
  Switchable, as this predicted.
- **`contract-leaves` had no demonstrated consequence, and now it has two.** The earlier note was right that
  two mutations built clean and wrong to conclude the rule could not fire: both left the contract's type
  expression independent of the machine, which is the case a *declared* type is robust to. Five shapes measured
  on a copy of the fixture, each from a cold tree: `state`, `context` and `incoming` derived from the machine
  build with exit 0, as does an `inbox` naming a plain union the machine module declares — nothing reads those
  positions, or they resolve. An `inbox` or an `outgoing` written as `Extract<EventFromLogic<typeof machine>, …>`
  is **refused every time**: that resolution passes through `defineSystem<Contract>()` and so back through the
  contract, collapses to `any`, and codegen refuses an `any` where it reads. It never comes right, because the
  throw means the generated module it wanted is never written. The accepting shapes carry the other harm, which
  `54d09d539` measured: the machine's whole declaration and `import * as xstate` land in the published
  `dist/types/pack-types.d.ts`, +41 lines, and travel into every dependent. Not switchable, on the first of those.
  The cost half of the rule (`generate-entries.ts:433`) stayed unmeasurable: 867-897ms across all five shapes on
  a two-feature pack, which is noise.

**A correction to this document's own account of the migration.** A later summary of `f877ea673` said it "moved
seven rule bodies" and left seven dead declarations. It moved **two** — `untyped-sends` and `pack-own-aliases`;
the other five were already delegating — and the dead declarations predated it. They accumulated because the
repo's `scripts/` was linted by nothing: two of fifteen workspaces have a lint script, and `npm run lint:check
-ws --if-present` reaches only those. `f91b66b49` closes `scripts/` and `tests/` with `oxlint … -D correctness`
and leaves 111 findings measured in nine package trees, led by `apack-host` at 49.

**What the migration is finding-preserving on, which nothing had checked.** Running the pre-collapse
implementations against the delegations over each rule's own offending fixture agrees 7/7, and an independent
reimplementation from the same plan agrees 7/7 too. That second pass is also what found the ninth dead
declaration (`EVENT_SENDS`), by linting the file.

The third, the pack half of the source-condition check, **shipped on 2026-09-27** and is why this list is
  two rules rather than three. It is worth recording what it cost against what the plan assumed, because the
  140-line figure that made it look like a phase of its own was the *repo's* rule: 39 of those lines walk
  Vite/Vitest config expressions, which exist because the repo's own configs may compute or spread
  `conditions`. A pack needed none of that. `source-resolution`
  (`apack-cli/src/build/pack-resolution.ts`) asks `ts.resolveModuleName` where the pack's own compiler lands
  and tests whether the answer is under `src/` — about ten lines of resolution, which catches an `extends`
  chain and a `paths` entry as well as `customConditions`, and names the file it resolved. Beside it, the
  published manifests became derived (`stagePublishTree`), so a pack installed from the registry that enables
  the condition now resolves `dist` and the trap only survives for a pack linked to a checkout.

  It found a real defect on its first run: every test pack in `apack-cli/tests/_support/pack-builds.ts` had
  been typechecking against workspace `src/` while `apack build` bundled it from `dist`, because esbuild has
  no notion of the condition. That was the one place in the repo where a pack compiled unlike every pack
  author's, and a rule written for external packs is what found it.

  The rule reads the pack's Vitest and Vite configs too, for the condition as a string literal, because nothing
  resolves `resolve.conditions` until the run — by which time the pack's suite has passed against source. So
  the split with the repo's `findMissingSourceConditions` is by *population*, not by subject: that one holds the
  repo's own configs to declaring the condition, this one holds a pack's to declaring nothing.
- **The disjointness sweep covers the pack-code rules only.** A rule that reads the whole tree cannot be
  pointed at a fixture, so two such rules could still claim one offence; the `findJsSpecifiers` pair is
  asserted directly instead, as a property of the populations.
- **The `.oxlintrc.json` for editor feedback** (Decision 11) was deferred as planned, and stays deferred.
