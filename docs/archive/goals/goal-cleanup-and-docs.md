```
# Goal: finish the leftover cleanup, fix the audit's code bugs, and bring the docs in line with the code

Work through docs/goals/goal-cleanup-and-docs.md on branch AS/external-test-harness, in order:
Part 1 (dead manifest fields, feature.config.ts), Part 2 (code bugs), Part 3 (docs). Findings are verified
against the code as of 2026-09-15; re-check each before changing it, since the tree has moved. Where a fix
needs a design choice, pick the option this doc recommends, note it in the final summary, and keep going.

Finished when:
- Every item in Parts 1 and 2 is fixed with a regression test that fails without the fix (mutation-checked),
  or marked out of scope with a reason.
- Every "fails a reader" item in Part 3 is fixed; "missing" items are written or listed as deferred.
- `npm run typecheck`, `schema:check` and `api:check` (sdk, ui), `packages:build` + `packages:check`,
  `npm run facade:check -w @app/default-setup`, and the api, sdk, host, cli, default-setup and renderer unit
  suites pass.
- `npm run build`, the monorepo E2E, `npm run test:external-pack` and `npm run test:packaged-authoring` pass.
- You give a final summary: item → fixed/deferred, with evidence.

Never:
- commit, stage, push or tag unless the user asks in this session. Leave changes for review.
- add backward-compat shims or legacy code paths: change formats directly and migrate in-repo users.
  Data on this machine's production app is handled by packages/api/scripts/db/fix-prod-upgrade.ts only.
- run packages/api/scripts/db/fix-prod-upgrade.ts, or open or modify ~/Library/Application Support/apack*.
- npm publish, create GitHub releases, or trigger workflows.
- pkill/killall Electron or node; run bare tsc on packages/preload; edit version/release metadata.
- loosen a failing assertion instead of investigating.
```

## Context

Earlier work on this branch (uncommitted at the time of writing):
- **Services:** they are explicit `path#export` objects, and generate-entries resolves exports with the TypeScript compiler.
- **Facade:** `apack build` gates each pack's facade types (packages/apack-cli/src/build/facade-gate.ts). default-setup's facade is reviewed in `packages/default-setup/etc/pack-types.api.md`.
- **Slash commands:** they come from every document in the library's `internal/commands` folder (`services.library.commands()`).

The items below are what's left from the reviews and audits of that work.

## Part 1: dead manifest fields and feature.config.ts

### 1. `boot.earlySystem` and `boot.createDefaultSettings`: remove

**State:**
- **The live path:** `features[].earlySystem: true` becomes the generated `boot.earlySystem` machine (`packages/apack-sdk/src/build/generate-entries.ts` ~435-478), and `api/src/setup/backend.ts` starts it before hydration.
- **Default settings:** created by the pack's `onInit` hook (`packages/default-setup/src/features/hooks.ts`), declared through `boot.hooks`.
- **The dead fields:**
  - The manifest schema still accepts `boot.earlySystem` and `boot.createDefaultSettings` (`packages/apack-sdk/src/build/manifest-schema.ts` ~95-96).
  - `apack.schema.json`, `etc/build.api.md` and `docs/public-facing/manifest.md` still describe them.
  - Nothing reads either field.
  - default-setup's `apack.json` still sets `boot.earlySystem`, duplicating the feature flag.

**History:**
- `ec285dab2` (09-08) added `boot.earlySystem` as a copy of the feature flag. No generator ever read it.
- `a36b65760` (09-11) replaced `boot.createDefaultSettings` with `boot.hooks`. It removed the field from the manifest type and the generator, but not from the hand-written JSON schema.
- `ccd8afbc4` (09-12) generated the Zod schema from that JSON, which made both dead fields the contract.

**Latent bug:** "built-in only" is written in the schema descriptions but not enforced. An external pack that sets `features[].earlySystem: true` builds, but its system never starts. At load, `api/src/packs/pack-loader.ts` ~335 drops it with only a warning.

**Do:**
1. Delete both fields from `BootConfigSchema`, and `boot.earlySystem` from `packages/default-setup/apack.json`.
2. Add a schema issue for `!builtIn && features.some(f => f.earlySystem)`.
3. Run `npm run generate:schema -w @apackdev/sdk` and `npm run api:update` in packages/apack-sdk.
4. Update the docs:
   - `docs/public-facing/manifest.md`: drop the rows, and use `hooks` in the example, documenting `onInit` and `onShutdown`.
   - `docs/public-facing/architecture.md` ~57.
   - `packages/api/src/packs/CLAUDE.md` boot order.
   - `packages/default-setup/CLAUDE.md` ~156.
   - `docs/MIGRATIONS.md` ~10.
5. Tests: the removed keys are rejected, and an external `features[].earlySystem` is rejected.

**Risk:** the schema is strict. No in-repo or installed pack uses these keys, and installed packs aren't re-validated at load.

### 2. `feature.config.ts`: remove, the manifest is the only source

**State:**
- **The files:** 14 of them, 12 in default-setup plus `tests/fixtures/external-pack` and `tests/fixtures/bundled-ui-pack`, each `{ name, settings, designation? }`. Nothing imports them.
- **Only reader:** `validateFeatures()` (`packages/apack-sdk/src/build/validate.ts` ~38-85) via `apack validate`. It checks `name` and that the settings file exists, never `designation`, and scans folders instead of `features[]`.
- **Where designations come from:** the manifest. generate-entries ~439-466 and ~553 pass `features[].designation` to systems and surfaces.
- **Stale docs:** `packages/default-setup/CLAUDE.md` still says systems pass `designation` from `feature.config.ts`; that was removed on 09-09.

**History:**
- `3c926d2f6` (09-07): systems imported the file for designation.
- `69099c834` (09-09): moved designation into the manifest.
- `9f04aa9fd`, a minute later: put `defineSystem(id, { designation })` back with no users. It is still in `etc/framework.api.md`.
- `1dee2929d` (09-12): `apack init` stopped writing the file, but `apack add feature` still does.
- `de7a41228` (09-14): removed the last build use.

**Bugs:**
- **Designation ignored:** `apack add feature --designation X` writes X only into `feature.config.ts`, never into `apack.json`, so the designation silently does nothing (`packages/apack-cli/src/commands/add/feature.ts`).
- **Inconsistent precedence:** the generated frontend entry lets the manifest win, but `packages/renderer/src/packs/pack-loader.ts` ~87 lets a surface's own `designation` win.
- **Unchecked id rule:** the designation registry maps role → role (`packages/apack-sdk/src/designations/index.ts` ~8), so a designation only routes correctly when it equals the feature id. Nothing checks that.

**Do:**
1. **Delete the 14 files** and `FeatureConfig` from `packages/apack-sdk/src/build/types.ts` and its index.
2. **Replace `validateFeatures`** with a check over `features[]` in the manifest: each `settings`, `system.entry` and `surface.entry` file exists, and a designation equals its feature id. Update `apack validate`.
3. **`apack add feature`:** stop writing the file, and write `--designation` into `apack.json`. Add a scaffold test.
4. **One designation source:**
   - Remove `designation` from `defineSystem` options and from `SystemSpec`/`SystemEntry` (`framework/define-system.ts`, `system-utils.ts`), then run `api:update`.
   - Make the renderer use the manifest's designation only.
5. **Docs:**
   - `packages/default-setup/CLAUDE.md` (~54, ~65);
   - root `CLAUDE.md`, the systems line;
   - `docs/public-facing/features.md`: the tree, the list, and the "Feature config" section;
   - `docs/PACK-MODULARIZATION-PR.md` ~59;
   - `cli.md`, where `validate` is described.

**Risk:** an external pack scaffolded earlier keeps a stray `feature.config.ts`, and its `import type { FeatureConfig }` stops compiling. The fix is to delete the file (note it in release notes). Removing the `defineSystem` option is a public API break with no known users.

## Part 2: code bugs from the doc audit

### 3. External pack migrations run twice

- `registerExternalPacks` registers each pack's `migrations` (`packages/api/src/packs/pack-loader.ts` ~506), so `getRegisteredMigrations()` (`packages/apack-host/src/packs/pack-registration.ts` ~285) includes them.
- `runMigrations()` (`packages/api/src/setup/migrations/index.ts`) runs them, checked against the app's stored version and `APP_VERSION`.
- `runPackMigrations(externalPacks)` then runs them again, checked against each pack's stored version and manifest version (`backend.ts` ~112-116).

**Fix:**
- Host migrations are the built-in packs' migrations, checked against the app version.
- External packs' migrations run once, checked against their own pack version.
- Make the rule explicit where migrations are collected, not by filtering at the call site. Also document which runner handles what.

**Test:** an external pack with a migration targeting ≤ `APP_VERSION` runs it exactly once across a boot.

### 4. Dependents don't get a dependency's flow helpers

For a pack that depends on default-setup, generate-entries leaves out default-setup's custom helpers (`branch`) and trigger track builders (`schedule`). It also types the other helpers' options as `Record<string, unknown>` (`generate-entries.ts` ~1127-1131, ~1146-1151, ~1167; evidence: `tests/fixtures/external-pack/src/__generated__/flow-helpers.ts`).

**Fix:**
- Generate a dependency's step helpers with the same names and option types the dependency itself gets, from the dependency's published build facet and types.
- `docs/public-facing/content.md`'s flow example must compile in the external-pack fixture.

**Test:** the fixture pack uses `branch` and `schedule` with typed options.

### 5. `db:clearSettings` deletes all settings without confirmation

`packages/api/scripts/db/destroy-settings.ts` destroys every Settings row, and it's exposed as `npm run db:clearSettings`. Its README (`packages/api/scripts/db/cli/README.md` ~94-96, ~213-224) documents `--force`, `--dry-run`, `--label` and `--type`, none of which exist.

**Fix:**
- A dry run by default: list what would be deleted.
- `--force` to delete.
- Fix the README to match.

## Part 3: docs

Fix what would make a reader fail first. Every item is verified against the code, with evidence in parentheses.

### Would make a reader fail

- **Install command:** `apack install github:user/repo` fails (`cli.md`, `getting-started.md` ~106). Any input containing "/" is treated as `owner/repo[@tag]`, so `github:user` becomes the owner (`packages/apack-cli/src/commands/install.ts` ~12, ~34; `apack-host/src/packs/pack-installer.ts` ~265-273).
- **Install location and layout:** `architecture.md` (Install, `pack://`) and `packages/api/src/packs/CLAUDE.md` say packs install to `~/.apack/packs` with a `dist/` layout.
  - Location: `resolveAppContext().userDataDir` (`packs/`, `host-packs/`, `pack-registry.json`).
  - Layout: `apack.json`, `bundle.json`, `runtime/{index.cjs,fe.js,fe.css,content/}`, `build/`, `types/snapshot.json` (`apack-host/src/packs/bundle.ts` ~26-38).
  - Installing is stage → verify → place.
- **Boot order** in `architecture.md` and `packages/api/src/packs/CLAUDE.md` leaves out steps. The real order (`packages/api/src/setup/backend.ts`):
  1. register the host packs system;
  2. `prepareHostDataDirs`;
  3. `forwardSecretsChanges`;
  4. built-in packs load while external packs load and register;
  5. built-in artifacts are published;
  6. `earlySystem` starts;
  7. shutdown hooks are wired;
  8. hydrate;
  9. every pack's `onInit`;
  10. host migrations, then pack migrations;
  11. content;
  12. the bus starts.
- **External pack system ids:** `features.md` ~108/~115 sends to bare ids (`'bookmarks'`). External packs' systems are `<packId>.<featureId>` (`api/src/packs/pack-loader.ts` ~490); point to `busId` from `#generated/bus-ids`.
- **`extensions.md` signatures:**
  - **Step build facet:** it is `compile(node, nodeId, ts, ctx)`, which returns `{ entity, relations }`, plus `validate(step, path, ctx)` and `getLabel(step, index)` (`apack-sdk/src/steps/types.ts` ~60-70).
  - **DSL helper:** a step gets one only with `dsl` (`primaryField` needs an `export interface DSL…Node`; `generate-entries.ts` ~1123, ~1139).
  - **Artifact viewers** receive `artifact: ArtifactItem`, not `data` (`threads/fe/canvas/agent/content-viewer.vue` ~26).
  - **Blocks** receive their props spread out plus `disabled`/`response`, and answer with `@submit`/`@cancel` (`threads/fe/chat/interactions/InteractionContainer.vue`).
  - **`ArtifactFEFacet.icon`** is required.
- **`content.md` settings:** it lists "Settings" as something a pack content. The manifest rejects `content.sources.settings` for non-built-in packs (`manifest-schema.ts` ~223); feature defaults go in `features[].settings`.
- **Root `CLAUDE.md`:**
  - Migrations live in `packages/default-setup/src/migrations` (`PackMigration`); `packages/api/src/setup/migrations` holds only the runner.
  - `npm run test-build` doesn't exist.
  - `packages/default-setup/src/registries/surfaces.ts` doesn't exist; surfaces come from `features[].surface` via the generated FE entry.
  - The bus machine is `createBusMachine` in `packages/apack-host/src/bus`; `api/src/systems.ts` wires it.
  - Repositories are `index.ts`/`queries.ts`/`commands.ts` declared in `features[].repositories`, not `startup/read/create/update`.
- **`packages/api/src/setup/migrations/CLAUDE.md`:** unclear which `index.ts` it means, and `runPackMigrations` isn't described.
- **Stale READMEs:**
  - `packages/default-setup/src/features/brain/be/utils/README.md` describes files that no longer exist.
  - `packages/default-setup/src/features/library/fe/components/search-index/README.md` names components that don't exist, with a wrong model list.
  - `packages/default-setup/tests/unit/_hybrid/README.md` lists specs that aren't there, and a separation plan that's already done.
- **Content `CLAUDE.md` imports:** `packages/default-setup/src/content/CLAUDE.md` gives the wrong import paths:
  - `ActionMeta` and `PromptMeta` come from `@apackdev/sdk/build`;
  - `Services` and `Z` come from `@/__generated__/services`.

  It also links `WRITING-ACTIONS.md`/`WRITING-PROMPTS.md`, which don't exist.
- **`db` CLI README:**
  - It never says every script needs `APACK_ENV` and `APACK_USER_DATA_DIR`.
  - It claims every command runs from the root, but `db:export`/`db:import`/`db:apply`/`db:clearSettings` exist only in `packages/api/package.json`.
  - `db:cli` takes `-e/-s/-o/-f/-v`.
- **Root `README.md`:**
  - scripts that don't exist (`start:no-build`, `compile:*`);
  - a stale project structure;
  - only three of six providers.
- **`.changeset/README.md`:**
  - The fixed group also includes `@apackdev/ui`.
  - Only cli and testing publish `dist/package`; sdk and ui publish their workspace package.

### Missing

- **`cli.md`:**
  - The commands `release [patch|minor|major] [--beta] [--dry-run] [--local] [--skip-tests] [--skip-e2e]`, `release publish`, `init-tests` and `test [--app-root|--app beta]`.
  - The `-d/-b` flags on install/uninstall/list.
  - Build's `--release` and `--skip-fe`, and its checks: facade gate, content runtime load, feature settings, dependency version warning.
  - `apack dev` is a Vite HMR server that installs into dev data, not a watcher.
  - `apack init` creates no feature.
  - Only `add feature`/`service`/`step` run generate-entries.
  - The feature name rule is camelCase.
  - The `fetch-deps` resolution order.
- **`manifest.md`:**
  - feature ids `^[a-z][a-zA-Z0-9]*$`;
  - service/repository keys as identifiers with `path#export` values;
  - the `boot.hooks` exports (`onInit`, `onShutdown`, `content`);
  - the `features[].settings` contract (only `surfaces.<id>` and `surfaces._meta.visibility.<id>`);
  - entity/relKind names that can't redeclare SDK ones;
  - `contentWriters` keys;
  - the `content.formats` name rule;
  - `<dep>:<format>` needs a declared dependency;
  - the sub-fields of `dsl`, `steps.definitions[].dsl` and `partitionPolicy`.
- **`content.md`:**
  - **Undocumented step helpers:** 7 of 13 steps have none documented: `llm`, `query`, `create`, `update`, `transform`, `kill` and `schedule`.
  - **Undocumented options:** action `map`/`params`, fire `scope`/`payload`, subflow `inherit`/`map`, the `listener` trigger.
  - **Unexplained:** `$.event`/`$.steps`/`$.lastStep` mappings, the switch operators, and `FlowConfig` (`root`, `final`, `next`).
  - **Misstated action rules:**
    - `_` prefixes skip only flows;
    - only `@apackdev/sdk/actions` is importable;
    - Node globals only warn;
    - `z`/`flowId` are passed only by the flow action step.
  - **The applier module contract** (`ContentApplierContext` → `ContentCounts`), `contentPolicy`, and include sets.
- **`extensions.md`:**
  - step `runtime.waits`/`spawnsSubflow` and handler result conventions;
  - the trigger facet, and the FE facet fields;
  - `steps.build`;
  - how the backend creates artifacts (`services.artifact.createAndNotify`) and blocks (`services.chat.sendBlockMessage`);
  - `BlockDefinition.be.generateAsideText`;
  - text editor extensions, app extensions (`welcome` slot) and `PackFERegistration` fields;
  - a reference list of default-setup's 16 artifact and 18 block types.
- **`services-and-data.md`:**
  - roles: `grantRole`/`revokeRole`/`getRoles`/`findWithRole`/`EARS.RoleKind`;
  - relation and entity helpers: `createRelation`/`removeRelation`/`destroyEntity`/`exists`/`countEntities`;
  - blueprints (`bp`, `spawn`) and graph helpers (`descendants`, `ancestors`, `topoSort`, `shortestPath`, `wouldCreateCycle`);
  - the rest of `@apackdev/sdk/models`;
  - `logger`/`emitter` members;
  - a correction: TNode rows go to the trace store; they aren't "never persisted".
- **`testing.md`:**
  - a `vitest.config.ts` example (`isolatedDataDir`, `sourceConditions`);
  - `send` before `connect()` throws, and events aren't in `emitted()` until connected;
  - the `nextEmit`/`runFlow` default timeouts, `FlowRun.eventTNodeIds`, exported types, and `takeSystemErrors`;
  - the harness gives every system `CLIENT_CONNECTED` on `connect()`.
- **`packages/apack-testing/CLAUDE.md` and `tests/e2e/CLAUDE.md`:**
  - the file maps are missing `secrets.spec.ts` and `import-pack-content.spec.ts`;
  - app resolution order: `appExecutable`, `appRoot`, `APACK_APP_EXECUTABLE`, `APACK_ROOT`, then auto-detect;
  - the in-memory hosts include `secrets`;
  - `mockInference` includes `relevance`/rerank.
- **`architecture.md`:**
  - data dir and env resolution;
  - pack reload/activation order;
  - host services registration;
  - the secrets store;
  - persistence partitions (`primary`, `volatileBackup`);
  - backups;
  - FE boot: `loadPackFrontend`, `PACK_FRONTEND_LOADED`, `BUS_SUBSCRIBED` → `packClientReady`.
- **Root `CLAUDE.md` scripts:** `test:unit`, `test:all`, `test:external-pack`, `test:packaged-authoring`, `typecheck:host/ui/cli/scripts`, `check:ui-entries`, `generate:schema`/`schema:check`, `facade:check`/`facade:update`.
- **`packages/default-setup/CLAUDE.md`:**
  - Boot hooks: `earlySystem` plus `boot.hooks` `onInit` (`createDefaultSettings`)/`onShutdown` (terminals, schedules, listeners, flow actors) plus the `contentManifest`.
  - `keep_alive` is the step's real type name (the doc says `keep-alive`).
  - `content-runtime.ts` in the generated files list.
- **Packages with no README or CLAUDE.md:**
  - apack-host: secrets, installer/updater/staging, bus composition, data dirs, source resolution;
  - apack-sdk: the build pipeline and `module-exports`, the apply engine, registries;
  - apack-cli: command inventory, facade gate, source vs dist mode;
  - apack-ui: component conventions;
  - api: `core/` layout and routers, tests;
  - main;
  - preload: its IPC surface, and never running bare tsc;
  - renderer: application actor, pack FE loading;
  - internal-typescript-floor.

## Out of scope (tracked separately)

- **Slash commands from packs:**
  - a pack applying `internal/commands/*.md` creates a second `internal` folder, because library folders match by name and content keys are per pack;
  - runtime pack activation doesn't refresh an open chat's command list;
  - declaring commands in the manifest or action metadata.
- **App reset:** move "Reset app"'s manual steps (default settings, applying, migrations) into `services.appData.reset()`, as `docs/goals/goal-package-boundaries.md` plans.
- **Generator regexes:** the few that remain (step node types, the step DSL node lookup, `trackField`, dependency `.d.ts` type names).
- **Known limitations:**
  - replies to one window go to every window;
  - provider `*_BASE_URL` environment variables redirect calls;
  - Mistral/Cohere keys are redacted only under credential field names;
  - old llm nodes keep temperature 0.7;
  - a failed renderer pack-registry query leaves those packs' systems waiting for the next reconnect.
- **User actions:**
  - run `fix-prod-upgrade.ts` on this machine's production data;
  - commit the branch's uncommitted work;
  - decide whether to reword commit `ab9f61eff`'s mismatched message.
