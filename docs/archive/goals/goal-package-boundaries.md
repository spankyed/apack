```
# Goal: clean package boundaries — @apackdev/ears, a typed host port, and one owner per concern

Implement docs/goals/goal-package-boundaries.md on a branch cut after
docs/archive/goals/goal-pack-api-organization.md is done (it runs first): Background, Spike results, Decisions, Phases, Constraints. Read it first.
Decisions are final: implement them, don't reopen them or stop to ask. Where a detail isn't
specified, pick the conventional option, note it in the final summary, and keep going. No
backward compatibility in code: change signatures, move modules, migrate every in-repo caller,
test, fixture, template and doc in the same change, and fix forward. Stored user data is the
exception: it moves with app migrations.

Finished when:
- Phases 0–8 are implemented and each meets its "Done when"; every new guard, helper or test is
  mutation-checked.
- `registerHostModule`, `getHostModule`, `hostFn` and `hostValue` no longer exist. The SDK
  reaches the host only through the typed `HostRuntime` bound once per process: the event bus,
  the pack registry view, the app version and the four services packs call (`appData`,
  `traceStore`, `inference`, `secrets`), each implemented in `@apackdev/host/services/`.
- All EARS code (engine, types, persistence, LMDB) lives in `@apackdev/ears`; no EARS or
  persistence code remains in `@apackdev/sdk`, `@apackdev/host` or `packages/api`.
- The engine is an instance: no EARS module holds data at module scope. The app, tests and
  tooling create engines with `createEarsEngine`, packs reach the bound engine's query face, and
  the engine benchmark is within tolerance of its recorded baseline.
- The registered packs are an instance: no SDK or host module holds what packs registered at
  module scope. The composition root creates it and binds its read face, packs still import only
  `@apackdev/sdk` and `@apackdev/ui`, and everything a pack contributes arrives in its registration.
- `packages/api/src` holds only transport (HTTP, WebSocket, tRPC), process boot and
  composition.
- No package reads another package's data through a cast (`BuiltinRepositories`,
  `HostSettingsRepositories`); each entity's repository lives with the package that declares it.
- The typed EARS contract behaves as before: default-setup's typed-EARS specs,
  `facade-typing.spec.ts` (workspace source and published package) and completions pass.
- `npm run typecheck`, `schema:check`, `api:check` (sdk, ui, ears), `packages:build` +
  `packages:check`, and the api, sdk, ears, host, cli, default-setup and renderer unit suites pass.
- `npm run build`, the monorepo E2E suite, `npm run test:external-pack`,
  `npm run test:packaged-authoring` and the example pack's `apack test --app-root <repo>` pass.
- You give a final summary: phase → done/deferred, evidence, and the conventional choices you made.

Never:
- commit, stage, push or tag unless the user asks in this session. When asked, commit in logical
  chunks (conventional messages, no Co-Authored-By or session lines) with `git commit -- <paths>`,
  and check `git diff --cached` first: something outside the session stages files.
- npm publish, create GitHub releases, or trigger workflows (dry runs only).
- pkill/killall Electron or node; launch the app outside the test env without an isolated
  APACK_USER_DATA_DIR.
- run bare tsc on packages/preload, `npm install` in the example pack, or edit version/release
  metadata.
- change the typed EARS types' behaviour (packages/apack-sdk/TYPED-EARS.md) to make a call site
  compile. Moving them is this goal's agreed design change; follow the TYPED-EARS checklist.
- loosen a failing assertion instead of investigating.
```

## Background

Five packages share responsibilities that should each have one home, and the code jumps between them through a string-keyed registry.

- **The host module registry.** `@apackdev/sdk/runtime` (`src/runtime/host.ts`) holds a process-global `Map<string, unknown>`. SDK and host code read it with `getHostModule`/`hostFn`/`hostValue` to reach code in packages they can't import. It has 14 keys:

  | Key | Registered by | Read by | Implemented in | Now (after this goal) |
  |---|---|---|---|---|
  | `attribute-storage`, `hydrate-sharded` | api `setup/sdk-host-init.ts` | `host/src/ears/lmdb.ts` (through `any` Proxies) | `api/src/core/ears`, `api/src/core/persistence` | `openLmdbStore` (`@apackdev/ears/lmdb`), opened by the api's `openAppStore()`; `store.hydrate()` loads into the engine's admin face |
  | `lmdb-query` | api | `host/src/services/trace-store.ts` | `api/src/core/persistence/lmdb/query.ts` | `store.query(partition)` (`LmdbQuery`, `@apackdev/ears/lmdb`), given to `createTraceStore(store)` |
  | `bus-emitter` | api | `sdk/src/runtime/root-events.ts` (`@internal`) | `api/src/core/router/bus-emitter.ts` | `HostRuntime.transport.rootEvents`, which the api supplies from the same file |
  | `secrets-client` | renderer | `sdk/src/fe/secrets-client.ts` (`secretsClient`) | `renderer/src/core/secrets-client.ts` | `bindFeHost({ secrets })` (`renderer/src/core/fe-host.ts`) |
  | `router-events` | api | nothing | `api/src/core/router/events.ts` | gone |
  | `event-transport` | api, renderer, test host | `sdk/src/events/index.ts` | `api/src/core/router/event-transport.ts`, `renderer/src/core/event-transport.ts` | SDK code over `HostRuntime.transport`; in the renderer `bindFeHost({ transport })` |
  | `logger` | api | `sdk/src/logger/logger.ts` (`createLogger`, `onLog`) | `api/src/core/shared/debug/logger.ts` (imports `bus-emitter`) | SDK code over `transport` (console when unbound); the api's `log-capture.ts` prints each log event once |
  | `system-errors` | api | `sdk/src/logger/report-error.ts` | `api/src/core/shared/system-errors.ts` | SDK code: `reportError` emits `SYSTEM_ERROR` on `transport` |
  | `version` | api | `sdk/src/env/index.ts` (`getAppVersion`) | `api/src/version.ts` | `HostRuntime.appVersion` (the api reads the root `package.json`) |
  | `migrations` | api | `sdk/src/utils/index.ts` | `api/src/setup/migrations` | removed from the SDK; `@apackdev/host/migrations` (`runAppMigrations`, `runPackMigrations`), run by the api's boot and `appData.reset()` |
  | `pack-registry` | api, and the test harness | `sdk/src/services/index.ts` | `@apackdev/host/packs` | `HostRuntime.packs`: the registry `createPackRegistry()` returns (the api, the harness per test file, the CLI per build) |
  | `app-data`, `trace-store`, `inference`, `secrets` | api (`registerHostServices`) | `sdk/src/services/*` | `@apackdev/host/services` | `HostRuntime.services`, assembled by `createHostRuntime` |
  | `application` | renderer `src/main.ts` | `sdk/src/fe/navigation.ts` | the renderer's application actor | `bindFeHost({ application })` |

  - Every read is lazy (on first call), so nothing depends on import order.
- **What packs reach the app through, today.** File counts are pack source in default-setup and the fixture pack; "action uses" are occurrences in default-setup's content actions, which get only `params`, `services`, `z` and `flowId`.

  | Pack-facing export | Usage | Reaches the app through | Now |
  |---|---|---|---|
  | `services.repository` | 30 files, 81 action uses | the SDK's repository registry (no host module) | the bound engine's registry (`HostRuntime.ears.repository`, `@apackdev/ears`) |
  | `services.logger`, `createLogger` (with `{ debug }`), `onLog` (`@apackdev/sdk/logger`) | action uses name the logger `action:<label>` (`runActionCode`) | registry key `logger` | SDK code over `HostRuntime.transport` |
  | `services.emitter`, `emit`, `broadcastToSurface`, `sendToSystem` (typed, from `#generated/events`), `sendToBrainSystem`, `onConnected`, `onIncoming` (`@apackdev/sdk/events`) | every pack send; `rootEvents` and `trpc.bus` are rejected in pack sources (`check:specifiers`) | registry key `event-transport` | SDK code over `HostRuntime.transport` (the renderer's `FeTransport` for sends to systems) |
  | `secretsClient` (`@apackdev/sdk/fe`) | the settings surface's Secrets page | registry key `secrets-client` (renderer) | `bindFeHost({ secrets })` |
  | `navigateToSurface` | 21 frontend files | registry key `application` (renderer) | `bindFeHost({ application })` |
  | `useActorSystem` | 82 frontend files | Vue `inject` (no registry) | unchanged |
  | `services.appData`, `services.traceStore`, `services.inference`, `services.secrets` | 2, 1, 2 and 1 files | registry keys `app-data`, `trace-store`, `inference`, `secrets` | `HostRuntime.services` |
  | `reportError` (`@apackdev/sdk/logger`), `getAppVersion` (`@apackdev/sdk/env`), the SDK's migrations runner | step runtimes and systems; 1 file each for the other two | registry keys `system-errors` (without `step`), `version`, `migrations` | `transport`, `HostRuntime.appVersion`; the runner left the SDK (the one pack caller, the reset actor, calls `services.appData.reset()`) |

  `services` holds seven host services (`HostServices`: `logger`, `emitter`, `repository`, `appData`, `traceStore`, `inference`, `secrets`) plus each pack's own. The Monaco action editor's `services` type is the generated `Services` (`default-setup/src/defs/action.ts`), which types `emitter` with the pack's events.
  - The registry dates from the SDK's extraction from api/renderer (`a96073e04`, 2026-08-30: "lazy-loaded proxy wrappers"). The private host package (`2e29d2f91`, 2026-09-13, `goal-sdk-types-architecture.md` Decision 2) made it permanent.
- **EARS is spread over three packages.**
  - The engine is in `sdk/src/ears` (18 files, about 2,000 lines), with its write side in `internals.ts`, exported only under `@apackdev/source`.
  - The partition policy, sharded router and sinks are in `host/src/persistence`.
  - LMDB (environments, adapter, hydrate, query, about 1,030 lines) is in `api/src/core/persistence`. `api/src/core/ears/attribute-storage.ts` opens the environments and calls `setPersistence` as an import side effect.
  - Persistence reaches back and forth between the three: the api imports host's policy; host reaches the api's LMDB through the registry.
- **The api implements app runtime, not just transport.** Besides `server.ts`, `setup/websocket.ts` and `core/router/{trpc,context,bus-router,index}.ts`, it holds:
  - LMDB persistence;
  - event routing (`core/router/event-transport.ts`, `bus-emitter.ts`);
  - system errors, and the logger core with its log capture;
  - the migrations runner;
  - the pack lifecycle (`api/src/packs`: loader, lifecycle, reload, content, packs system, about 1,470 lines), next to host's registry, installer and updater;
  - the backend system composition (`systems.ts`).
- **Data is read by casting another package's repositories.**
  - The SDK declares the flow model (Flow, Node, TNode, Action, Prompt) and Settings (`sdk/src/types/sdk-entities.ts`), but default-setup implements their repositories (`features/flows/be/repository` 724 lines, `settings` 122, `prompts` 93, `actions` 103).
  - The SDK calls them through `sdk/src/ears/builtin-repositories.ts`, `repository as unknown as BuiltinRepositories`, from:
    - the flow applier (`importFromDSL`, `deleteFlow`, `promptQueries.all`)
    - the settings applier (`resetSettings`)
    - boot apply (`contentRevision`)
    - `utils/resolve-cli.ts` (the code surface's `cliPaths`)
    - `steps/runtime-errors.ts` (`brainCommands.updateTNodeResult`)
  - Host reads them through `host/src/settings`, `repository as unknown as HostSettingsRepositories`. That covers app state in `settings.internal`:
    - `hasOnboarded` (`api/src/systems.ts`, `packs/pack-apply.ts`)
    - `version` and `packVersions` (`setup/migrations/index.ts`)
    - `packContentRevisions` (`setup/backend.ts`, `packs/pack-lifecycle.ts`, `packs/pack-reload.ts`)
    - `contentRevision` and `contentStatFingerprint` (`packs/pack-apply.ts`, `sdk/src/content/boot-apply.ts`)
  - **Consequence:** the app's own state lives inside default-setup's Settings row, and `settingsCommands.resetSettings()` (`settings/be/repository/index.ts:116-119`) writes `data: {}`. Resetting settings therefore also erases the onboarding flag, app version, pack versions and content hashes.
  - *Done since:* API keys left EARS for the host's encrypted store (`@apackdev/host/secrets`, several labelled keys per provider with one selected, `services.secrets` for metadata), and CLI path overrides moved to the code surface's settings (`surfaces.code.cliPaths`).
- **One shared instance, listed in eight places.** Packs, dependency runtimes, the app and tests must share one SDK instance. Each of these knows separately which packages must not be duplicated:
  - `apack-cli/src/build/be-bundler.ts:35, 99, 146` (backend bundles) and `:193` (the content runtime bundle);
  - `fe-bundler.ts` (SDK detection);
  - `apack-host/src/build/shared-deps.ts` (FE globals);
  - `api/src/packs/pack-loader.ts:61-83` (the SDK bridge map);
  - `apack-testing/src/dependency-runtime.ts` (the harness bridge);
  - `scripts/bundle-package.ts:57` (inlined packages).

  *Now:* all derive from `SHARED_INSTANCE_PACKAGES` (`@apackdev/host/build/shared-deps`), and `check:specifiers` (`findSharedPackageLists`) fails when one names the packages itself.
- **Related plan.** This goal absorbs `goal-ears-engine-instance.md` (not implemented; now in `docs/archive/goals/`), which makes the engine an explicit instance (`createEarsEngine`, query/admin faces). Its Decisions 1, 2, 4, 5 and 7 and its safety net (contract tests, benchmark) become Decision 9 and Phase 6 here. Two of its decisions are superseded:
  - Decision 3: installation goes through `HostRuntime`, not the registry.
  - Decision 6: the engine lives in `@apackdev/ears`, a new package.

## Spike results (2026-09-14)

Throwaway worktree `spike/ears-package` (from `2b14f142e`, uncommitted, in the session scratchpad; discard with `git worktree remove`). The EARS engine was moved into a new `packages/apack-ears` workspace package, with the SDK rebuilt on top.

**Don't reuse the spike's code; rewrite Phase 1 on the current branch.** Its patch (excluding generated files and API reports) applies without conflict to `fb06e736a`, checked with `git apply --check -3`. But it keeps every engine module re-exported from an SDK file of the same name, which Decision 4 removes, and it has no build or publish configuration. Reusing it would mean undoing half of it.

- **Coupling.** The engine's imports outside `src/ears` were:
  - `types/entities.ts` (16 files)
  - `utils/random-id.ts` (1)
  - `builtin-repositories.ts`, which imports `sdk-entities.ts` and the flow compiler, and stays in the SDK

  In `types/entities.ts`, the `EARS` namespace uses SDK code only for `Entity = SDK_ENTITIES` and `RelKind = { ...SDK_REL_KINDS, Custom }`. The engine itself uses only `EARS.Entity.Relation`.
- **The move.**
  - 18 engine files plus the core `EARS` namespace (with `Entity = { Relation }` and `RelKind = { Custom }`) went to `@apackdev/ears`.
  - The SDK's `EARS` became a namespace of aliases to the engine's types, plus the SDK's entity and relation-kind constants.
  - SDK files re-exported the moved modules.
- **Results:**
  - `typecheck:sdk`, `:host`, `:be`, `:cli` and `:pack` passed.
  - default-setup's unit suite passed 544/544 (2 skipped), including `typed-query-builder`, `branded-entity-id`, `entity-shape-registry` and `sdk-type-safety`.
  - `facade-typing.spec.ts` against workspace source passed 7/7: typechecking and field/entity-name completions under bundler and node16.
- **What it needs to be complete:**
  - The published-package half of `facade-typing.spec.ts` failed with `ERR_MODULE_NOT_FOUND: @apackdev/ears` from the packed SDK. `@apackdev/ears` must be built, packed and installed like `@apackdev/sdk` (Phase 1).
  - The SDK's API reports shrank by about 800 lines: API Extractor doesn't copy declarations re-exported from another package. The engine's surface needs its own reports in `@apackdev/ears` (`api:check`).
  - The renderer typecheck wasn't run: it needs a built API. It's covered by Phase 1's `npm run typecheck`.
- **Not spiked (proved in their phases):**
  - one engine instance when a pack imports `@apackdev/ears` directly;
  - LMDB as `@apackdev/ears/lmdb` in the packaged app;
  - the `HostRuntime` bind in the renderer and harness.

## Decisions

Final.

1. **Layers, imports pointing down only.**
   ```
   @apackdev/ears     engine, EARS types, persistence port, in-memory store      (+ /lmdb: LMDB adapter)
   @apackdev/sdk      pack contract + pack runtime: registries, services contracts, event sends, logging and
                    error reports over the bound event bus, SDK entities and their repositories, HostRuntime port
   @apackdev/host     app runtime: the four services (/services), app state, and the subsystems the app
                    runs (/packs pack lifecycle, /bus, /migrations)
   packages/api     transport (HTTP via node:http, WebSocket, tRPC routers, log stream) + process boot + composition
   packages/renderer  FE composition: binds the FE port
   ```
   - The api keeps transport because host has consumers without a server: the CLI (`@apackdev/host/packs`) and the pack test harness (`@apackdev/host/bus`, `/packs`).
   - host must never import an HTTP server package (`fastify`), tRPC or `ws`. The package boundary enforces that, and a guard test checks it.
2. **`@apackdev/ears` is a standalone engine package.**
   - It contains the engine (queries, transactions, relations, repository registry, typed facades `defineEars`), the core `EARS` namespace, `BaseEntity`/`EntityShapes`/`ShapeOf`/`EntityNameArg`, the persistence port (`PersistenceSink`, partition policy, sharded router) and the in-memory store.
   - It knows no packs and no SDK entity names.
   - It publishes like `@apackdev/sdk`: its workspace `package.json`, source under `@apackdev/source`, `dist` otherwise, API reports, publint and attw, the TypeScript 5.7 floor, and the changesets fixed group.
   - Its engine-state entry (today's `ears/internals`) is published with `@internal` tags, rather than hidden behind the source condition, until Phase 6 replaces it with the engine's admin face.
3. **LMDB is `@apackdev/ears/lmdb`.**
   - It takes the api's `core/persistence` and `core/ears`, host's `persistence` and `ears/lmdb.ts`, and host services' use of `LmdbQuery`.
   - `lmdb` is an optional peer of `@apackdev/ears`, installed by the app. Packs and tests never load it.
   - Opening is explicit: `openLmdbStore({ paths, policy, engine })` returns the store (sinks, hydrate, query, reset, close), and the composition root calls `setPersistence`. There's no import side effect.
   - The partition policy is an argument, built by host from the pack registry.
4. **Packs may import `@apackdev/ears` directly; it's a shared-instance package.**
   - `SHARED_INSTANCE_PACKAGES = ['@apackdev/sdk', '@apackdev/ears']` in `@apackdev/host/build/shared-deps` is the single source for every bundler external list, the host pack loader's bridge (`@apackdev/host/packs/runtime`, Phase 0), the harness bridge and `bundle-package`.
   - Bridge maps are built from each package's exports, not written out by hand.
   - A guard test fails when any of those consumers names a shared package itself.
   - `@apackdev/sdk/ears` exports only what the SDK adds: `EARS` with the SDK's entities and relation kinds, the SDK entity shapes, and the SDK entity repositories.
   - Generated `#generated/ears` imports `defineEars` and core types from `@apackdev/ears`, and SDK names and shapes from `@apackdev/sdk`.
   - The repository registry (`repository`, `registerRepository`) is the engine's. `services.repository` is that registry (`HostServices['repository']` imports its type from `@apackdev/ears`), and generated `#generated/repository` and `repositories.ts` import it from `@apackdev/ears`. A spec checks that a repository registered by a pack is the same object through `#generated/repository`, `services.repository` and a dependency runtime.
   - The typed contract's behaviour (types, completions, typo errors) stays exactly as it is.
5. **One typed port replaces the registry, with only what the SDK can't do itself.**
   ```ts
   // @apackdev/sdk/runtime
   export interface HostRuntime {
     transport: { rootEvents: RootEvents };   // the app's event bus; the api supplies it (was bus-emitter, router-events)
     ears: EarsQuery;                         // the app's engine, query face (Decision 9; until Phase 6, the @apackdev/ears module instance)
     packs: PackRegistryView;                 // the registered packs, read-only: their services, for `services` (was pack-registry); from Phase 7 everything else they registered
     appVersion: string;                      // (was version)
     services: {                              // what packs call through `services` and the app implements
       appData: AppDataService;               // (was app-data)
       traceStore: TraceStore;                // (was trace-store)
       inference: InferenceService;           // (was inference)
       secrets: SecretsService;               // the user's API keys as metadata (was secrets)
     };
   }
   export function bindHost(runtime: HostRuntime): void;       // once per process; rebinding throws unless reset for tests
   export function bindFeHost(runtime: { application: AnyActorRef; secrets: SecretsClient; transport: FeTransport; packs: FePackRegistryView }): void;  // renderer (was application, secrets-client and event-transport); `packs` from Phase 7
   ```
   - An unbound use throws, naming `bindHost` (or `bindFeHost` in the frontend).
   - **What reads the binding:**
     - The SDK's `@internal` `rootEvents` (`@apackdev/sdk/runtime`) is `transport.rootEvents`; packs never use it directly (they send through `@apackdev/sdk/events`), and `initRpc()` is deleted.
     - `secretsClient` reads the frontend port's `secrets` (today the `secrets-client` host module).
     - `navigateToSurface` reads the frontend port's `application`.
     - `services` reads `packs` for pack services and `services` for the app-implemented four. The SDK builds `logger`, `emitter` and `repository` itself (Decision 6).
     - From Phase 7, the SDK's lookups of what packs registered (designations, steps, artifacts, blocks, content hooks and appliers, feature settings defaults, pack commands, and in the frontend surfaces, text editor extensions, app extensions and DSL types) read `packs`.
   - **Bindings:**
     - the api's composition root binds `createHostRuntime(...)` from `@apackdev/host`;
     - `@apackdev/sdk/testing`'s `startTestRuntime` binds an in-memory `HostRuntime`;
     - the harness supplies `packs` (with `mockService` overlays) when it binds.
   - `runtime/host.ts` and its registry are deleted.
6. **Plumbing moves into the SDK; the app implements only four services.** The rule: **bind resources, derive behaviour.** A resource has identity per running app (the event bus, the engine and its data, the pack registry, services doing I/O with user data or keys) and is a `HostRuntime` member. Behaviour is a function over a resource, written once in the SDK for every app, test and tool.
   - **Event sends, logging and error reports are SDK code over `transport`**, not host implementations. They're a few lines each over the event bus today (`api/src/core/router/event-transport.ts`, `core/shared/debug/logger.ts`, `core/shared/system-errors.ts`) and move next to the functions the SDK already exports:
     - `broadcastToSurface`, `sendToSystem`, `sendToBrainSystem`, `onConnected`, `onIncoming` → `@apackdev/sdk/events`. The sends stay on `services.emitter`, which sandboxed actions use;
     - `createLogger`, `onLog` → `@apackdev/sdk/logger`. Bound, it formats and emits log events on `transport`; the api's log capture writes them to the console and streams them to the client, so nothing is logged twice. **Unbound, it writes to the console**: tooling runs SDK and host code without binding a runtime. For example, the CLI installs packs through `@apackdev/host/packs`, whose registry, discovery and updater log.
     - `reportError` → `@apackdev/sdk/logger` (its system-error half, which calls the `system-errors` module today).

     Their registry keys (`event-transport`, `logger`, `system-errors`) go away with no replacement. `bus-emitter` stays in the api as the `transport` it supplies, including its app event log file (`APACK_LOG_DIR`).
   - **Only transport-bound functions throw unbound.** `broadcastToSurface`, `sendToSystem`, `sendToBrainSystem`, `onConnected`, `onIncoming`, `onLog`, `reportError` and the four app services throw, naming `bindHost`. `createLogger` falls back to the console. `getAppVersion()` throws.
   - **The app version** is `HostRuntime.appVersion`; `getAppVersion()` reads it.
   - **Migrations leave the SDK.** `runMigrations` is removed from `@apackdev/sdk/utils`. The only pack caller is default-setup's reset actor (`settings/be/system.ts`), which today runs the app's reset itself: `appData.reset()`, `createDefaultSettings()`, `contentData(...)`, `runMigrations()`. `services.appData.reset()` does all of it in host (wipe stores, run every pack's boot hooks and boot apply, run app migrations), and the actor only calls `reset()`.
   - **`services` keeps its seven host services, of two kinds:**
     - `logger`, `emitter` and `repository` are implemented by the SDK: `logger` and `emitter` over `transport`, and `repository` from the bound engine (`runtime.ears.repository`, Decision 9);
     - `appData`, `traceStore`, `inference` and `secrets` are implemented by the app and bound through `HostRuntime.services`.

     `HostServices` and the reserved service names (`HOST_SERVICE_NAMES`) keep all seven. The app-implemented four follow one rule:

     | What | Where |
     |---|---|
     | Contract (types only) | `@apackdev/sdk/services/<name>.ts` (`app-data`, `trace-store`, `inference`, `secrets`) |
     | Implementation | `@apackdev/host/services/<name>.ts`, same names |
     | Test double | `@apackdev/sdk/testing`: the in-memory `HostRuntime` (`fakeInference` for inference, `addTestSecret` for secrets) |

     `@apackdev/host/services/index.ts` exports `createHostRuntime({ store, engine, transport, appVersion, packs })`, the only place the runtime is assembled. The SDK's contract files contain types only, and `@apackdev/sdk/services/index.ts` reads the services from the bound runtime.
   - **Host-only code stays in host and isn't reachable from the SDK:**
     - app state, `@apackdev/host/app-state` (Decision 7);
     - `@apackdev/host/migrations`: app migrations and their runner, moved from `api/src/setup/migrations` with its CLAUDE.md. Host runs them at boot and in `appData.reset()`.
     - `@apackdev/host/packs/runtime`: loader, lifecycle, reload, content, packs system and activation outcome, moved from `api/src/packs` (Phase 0). The `@apackdev/host/packs` barrel, which the CLI imports, never imports it;
     - `@apackdev/host/bus`, plus the backend system composition from `api/src/systems.ts` as `createAppBus()` (Phase 0).
   - **The api keeps** `server.ts`, `setup/websocket.ts`, `setup/config.ts`, `core/router/{trpc,context,bus-router,packs-router,secrets-router,index}.ts` (tRPC procedures delegating to host), `core/router/bus-emitter.ts` (the `transport` it supplies), log capture to the console and client, and `setup/backend.ts`, which shrinks to composition.
7. **Each entity's repository lives with the package that declares it.**
   - **Flow model** (the SDK's): `@apackdev/sdk` owns the flow, node, edge and TNode repositories and the action and prompt repositories:
     - flows: create, update, delete, the root flow role, `reindexHandles`, `importFromDSL`, `rootFlow`, `flowNodes`, `flowEdges`, `node`, `getNodeActionId`
     - TNodes: `updateTNodeResult`
     - actions and prompts: `all`, `byId`, `byLabel`, and create, update, delete

     default-setup keeps its UI projections (`connectedData`, `extendedData`, action and prompt export) on top of them. `builtin-repositories.ts` is deleted.
   - **Secrets** — *done:* API keys aren't an entity. The host owns them in an encrypted store (`@apackdev/host/secrets`), with several labelled keys per provider and one selected, and packs see metadata through `services.secrets`. The `Secret` entity, the secrets partition and `general.secrets` are gone.
   - **App state:** a new entity `AppState` (one row) holds `hasOnboarded`, `version`, `packVersions`, `packContentRevisions`, and the boot apply's hashes and stat fingerprints per built-in pack (`contentRevisions`, `contentStatFingerprints`). Host declares it (registered with the engine next to the SDK's entities), and `@apackdev/host/app-state` owns its reads and writes. The SDK and packs never read it; `hasOnboarded` reaches the renderer in the `CLIENT_CONNECTED` event, as today. Resetting settings no longer touches it.
   - **Settings** (UI settings: general, surfaces): it's default-setup's data. default-setup declares the `Settings` entity and owns the settings content format and applier; the SDK stops declaring and applying it. `packSettingsRegistry` (pack feature defaults) stays in `@apackdev/sdk/framework`; Phase 7 moves the defaults it holds into the registered packs instance, and its reads stay there.
   - **CLI paths:** `resolve-cli` (resolving and the `cliPaths` override) moves to default-setup's code feature, which owns the CLI integrations. *Done:* the override already lives in that feature's surface settings (`surfaces.code.cliPaths`).
   - **Migrations:** an app migration targeting the next release moves stored data, following `migrations/CLAUDE.md`:
     - `settings.internal` → `AppState`
     - (*done:* `general.secrets.cliPaths` → the code surface's settings; `general.secrets` dropped)

     It's idempotent and has a spec on a copy of old-shaped data.
8. **Renames and naming.**
   - Services use the same file names in both packages (Decision 6).
   - Host-only modules are named by concern (`app-state`, `migrations`, `packs`, `bus`).
   - `packages/api` keeps its name.
9. **The engine is an instance** (from `goal-ears-engine-instance.md`).
   - `createEarsEngine({ persistence?, isEntityType })` in `@apackdev/ears` returns an engine that owns all its stores, indexes and caches. No EARS module keeps data at module scope. Constructor arguments replace `initEARSRuntime` and `setPersistence`; the default persistence is the no-op sink.
   - **Two faces; holding the engine is the capability.**
     - `engine.query`: `query`, `create`/`write`, the query helpers, the repository registry and the read APIs packs use.
     - `engine.admin`: bulk load and hydration, clearing, direct attribute and relation writes, `edgeStore`, `relationIndex` and the entity-type checker.

     `createEarsEngine` is published. Calling it gives a new, empty engine and no access to the app's data.
   - **Installation.** `@apackdev/ears` keeps a reference to the installed query face (`installEngine(query)`), not data. Its free functions (`query`, `create`/`write`, `find*`, `repository`, `defineEars` facades) resolve it. `bindHost` installs `runtime.ears`. Tooling and tests install their own. Using the engine with none installed throws, naming the fix. There's no implicit default engine.
   - **Only the creator holds `admin`:**
     - the api's composition root: hydration through `@apackdev/ears/lmdb`, and `appData`'s reset, backup and restore through `createHostRuntime`;
     - the CLI flow compiler and decompiler: a private engine per compile;
     - `@apackdev/sdk/testing`: `startTestRuntime` creates and installs an engine, and `resetTestData()` replaces it with a fresh one.
   - `@apackdev/ears/internals` and every `clearMemory`/`initEARSRuntime` call are deleted.
   - The trust model is unchanged: packs run in-process. This defines the contract and correctness, not a security boundary.
   - Pack-facing signatures, the generated facades and the typed EARS contract's behaviour don't change.

## Phases

### Phase 0 — The pack runtime moves into host
Phase 4's pack slice (Decision 6). It may land before Phase 1: it reads what only the api has through the host module registry the rest of host already uses, so Phase 3 converts those reads along with every other.

**Today.**
- `packages/api/src/packs` holds `pack-loader.ts` (444 lines), `packs-system.ts` (381), `pack-apply.ts` (192), `pack-reload.ts` (168), `pack-lifecycle.ts` (113), `pack-api.ts` (67) and `activation-outcome.ts` (13). Only `pack-api.ts`'s `packsRouter` is transport.
- **Imports only the api has:**
  - `@/version` and `@/core/shared/debug/logger`, both already reachable as `getAppVersion()` (`@apackdev/sdk/utils`) and `createLogger` (`@apackdev/sdk/logger`);
  - `@/core/ears/attribute-storage` (`invalidatePartitionPolicy`), which host reaches through `@apackdev/host/ears` (`src/ears/lmdb.ts`) for its neighbours;
  - `@/systems`;
  - `virtual:built-in-pack-loaders`, which the api's `tsup.config.ts` generates inside the api bundle only.
- **A cycle:** `systems.ts` imports `getPacksWithClientLoadedFrontends` from `pack-api.ts`, while lifecycle and reload import `invalidateEventValidationMap` from `systems.ts`. The bus composition moves in this phase too.
- **The bridge:** `SDK_BRIDGE` binds 22 specifiers to the loader's own module instances. The api bundle inlines `@apackdev/sdk` and `@apackdev/host`, so in host they are still the app's instances. `withHostResolution` resolves host-provided packages from `import.meta.url`, which inside the bundle is still the api's `dist/server.js`.

**Steps.**
- **Seams first, in the api:**
  - `@apackdev/host/ears` gains `invalidatePartitionPolicy()`, delegating like its neighbours.
  - Logging goes through `@apackdev/sdk/logger` and the version through `getAppVersion()`; log sources (`pack-loader`, `pack-reload`, `pack-content`, `packs`) stay the same.
- **The bundled loaders are a parameter:** `loadBuiltInPacks(dir, { runtimeEntry, bundledLoaders })`.
  - `setup/backend.ts` passes `() => import('virtual:built-in-pack-loaders').then(m => m.default)`.
  - `tsup.config.ts` resolves the generated module from `src/setup`, and `env.d.ts` keeps its declaration.
  - `runtimeEntry: 'never'`, and `'prefer'` falling back, throw without it, naming the option. `'only'` (the db scripts) doesn't need it.
- **The event validation map has one owner:**
  - host pack registration keeps the cache (`getEventValidationMap()`, over `buildRegisteredEventValidationMap()`) and clears it in `registerPack`, `unregisterPack` and `registerHostSystem`;
  - `invalidateEventValidationMap` and its calls are deleted;
  - `bus-router.ts` reads the map from host.
- **`pack-api.ts` splits:** its loaded-packs state (`setLoadedPacks`, `updateLoadedPack`, `removeLoadedPack`, `getPacksWithClientLoadedFrontends`, the registry entries) goes to host, and `packsRouter` becomes `core/router/packs-router.ts`, keeping its procedure name and `PackBundleEntry[]` output.
- **Move the modules** with `git mv` to `packages/apack-host/src/packs/runtime/`, exported as `@apackdev/host/packs/runtime`:

  | From `api/src/packs/` | To `apack-host/src/packs/runtime/` |
  |---|---|
  | `pack-loader.ts`: loading, `LoadedPack`, `registerExternalPacks`, `clearPackRequireCache` | `loader.ts` |
  | `pack-loader.ts`: `SDK_BRIDGE`, `withHostResolution`, `getBridgedSdkSpecifiers` | `bridge.ts` (Phase 4 rebuilds its map from `SHARED_INSTANCE_PACKAGES`) |
  | `pack-lifecycle.ts`, `pack-reload.ts`, `pack-apply.ts` | `lifecycle.ts`, `reload.ts`, `apply.ts` |
  | `pack-api.ts` state | `loaded-packs.ts` |
  | `packs-system.ts`, `activation-outcome.ts` | same names |
  | `CLAUDE.md` | `CLAUDE.md`, rewritten for its new home |

  Inside host, modules import each other by relative `.ts` path. `SDK_BRIDGE` keeps its `@apackdev/host/*` keys as the specifiers pack code requires.
- **The bus composition:** `@apackdev/host/bus` gains `createAppBus()`. It is today's `backendSystem`:
  - `createBusMachine` wired to the api's `rootEvents` (`core/router/bus-emitter.ts`);
  - `clientLoadedPacks` from `loaded-packs.ts`;
  - the `CLIENT_CONNECTED` application event from `@apackdev/host/settings`, whose type moves next to it.

  `@apackdev/host/bus` never imports `packs/runtime/loader`. `setup/backend.ts` calls `createAppBus()`; `systems.ts` is deleted, and its type exports move to `core/router/events.ts`.
- **Shutdown hooks move with it:** `registerShutdownHook`, `runShutdownHooks`, `runShutdownHooksForKey` and `removeShutdownHooksForKey` leave `@apackdev/sdk/utils` for `@apackdev/host/packs/runtime`. Only the app calls them; packs declare `boot.onShutdown`.
- **Callers:** `setup/backend.ts`, `setup/websocket.ts`, `setup/migrations/index.ts`, `core/router/index.ts`, `core/router/bus-router.ts`, `core/router/events.ts`, `scripts/db/database.ts` and `scripts/db/apply.ts` import from host. `scripts/check-import-specifiers.ts` drops `@/packs` from its api alias comment.
- **Specs:**
  - These move to `packages/apack-host/tests/packs/runtime/`, without their `virtual:built-in-pack-loaders` and `@/core/ears/attribute-storage` mocks (register a fake `attribute-storage` host module where the partition policy needs stubbing):
    - `pack-loader.spec.ts`
    - `pack-reload.spec.ts`
    - `pack-bridge-leaves.spec.ts`
    - `sdk-bridge-drift.spec.ts`
    - `tests/integration/pack-e2e.spec.ts`
    - `pack-lifecycle.spec.ts`, except its CLI case
  - `pack-lifecycle.spec.ts`'s case that runs the CLI's `init` moves to `packages/apack-cli/tests/cli/`, since host tests don't depend on the CLI.
  - `bus-client-connected.spec.ts` stays in the api: it tests the bus wired to the api's transport.
- **Guards** (`packages/apack-host/tests/boundaries.spec.ts`), each mutation-checked:
  - no host source imports `fastify`, `@trpc/*`, `ws` or `virtual:*` (the Phase 4 transport guard, added here);
  - `src/packs/index.ts` and `src/bus/**` don't import `src/packs/runtime/**`, directly or through another module;
  - no host source imports `@apackdev/host/*`;
  - `packages/api/src/packs` doesn't exist.
- **Docs:**
  - `packages/apack-host/CLAUDE.md`, `packages/api/CLAUDE.md` and `packages/renderer/CLAUDE.md`;
  - root `CLAUDE.md` (the `@apackdev/host/packs` bullet gains `/packs/runtime`);
  - `docs/public-facing/architecture.md` (`withHostResolution`'s path, pack loading and reload).

**Watch.**
- **Module identity in the bridge:** if `sdk-bridge-drift`, `pack-bridge-leaves`, `test:external-pack` or `test:packaged-authoring` fails after the move, compare the bridged module objects with the api's before editing the list.
- **The CLI bundle:** a `./runtime` import from the barrel pulls the loader and its 22 imports into `@apackdev/cli`. The guard catches it, and `packages:check` covers the packed result.
- **Dev reload:** `tests/e2e/dev-reload.spec.ts` exercises the reload, the bundled loaders and the bus restart together. Run it after each step.

**Done when:**
- `packages/api/src/packs` and `packages/api/src/systems.ts` don't exist, and nothing imports `@/packs` or `@/systems`.
- A spec shows registering and unregistering a pack changes the event validation map with no manual invalidation, and fails when `registerPack`'s invalidation is removed.
- A host spec starts `createAppBus()` with the SDK test host bound and shows a connecting client reaching a registered system while a loaded pack with frontend code waits for `PACK_CLIENT_CONNECTED`. It fails when `clientLoadedPacks` returns nothing.
- `loadBuiltInPacks` with `runtimeEntry: 'never'` and no `bundledLoaders` throws, naming the option.
- The moved specs pass in `npm test -w @apackdev/host`, and the CLI's pack commands and the harness run without a server.
- `npm run db:cli` runs against a temp `APACK_USER_DATA_DIR`.
- `npm run build`, the full E2E suite (including `dev-reload.spec.ts`), `npm run test:external-pack`, `npm run test:packaged-authoring` and the full check list pass.

### Phase 1 — `@apackdev/ears` and the shared-instance list
- Create `packages/apack-ears` (Decision 2) with the engine, the core `EARS` namespace and the entity typing helpers.
- The SDK's `EARS` aliases the engine's types and adds `SDK_ENTITIES`/`SDK_REL_KINDS` (the spike's shape).
- Delete the SDK's `src/ears` engine files. `@apackdev/sdk/ears` exports only the SDK's additions (Decision 4), and `@apackdev/sdk/ears/internals` is removed; its users import `@apackdev/ears/internals`.
- Regenerate `#generated/ears` from `generate-entries` with the new imports, and update default-setup, the fixture pack and the scaffold.
- Add `SHARED_INSTANCE_PACKAGES` and derive every consumer listed in Background from it, with the guard test.
- Build and publish configuration: `packages:build`, `packages:check`, API reports for `@apackdev/ears`, `published-*` specs cover `@apackdev/ears`, changesets fixed group, `internal-typescript-floor`.
- Follow the TYPED-EARS checklist (type tests, mutation checks, completions, report review).
- **Dependency direction guard:** `check:specifiers` gains rules that fail on an upward import, and each package's `package.json` declares only the allowed `@apackdev` dependencies:
  - `@apackdev/ears` imports no `@apackdev/*` package;
  - `@apackdev/sdk` imports only `@apackdev/ears`;
  - `@apackdev/host` imports only `@apackdev/sdk` and `@apackdev/ears`, never `packages/api`.

**Done when:**
- Default-setup's typed-EARS specs and `facade-typing.spec.ts` pass against workspace source and the published packages, with completions unchanged.
- The SDK and `@apackdev/ears` API reports together cover the previous surface; review the diff.
- A fixture-pack unit test and its E2E write through `@apackdev/ears` imported directly and read the row back through `@apackdev/sdk`, in the harness and in the app, proving one instance.
- Mutation: removing `@apackdev/ears` from `SHARED_INSTANCE_PACKAGES` fails that test and the guard.
- Mutations: an `@apackdev/host` import planted in `@apackdev/sdk`, an `@apackdev/sdk` import planted in `@apackdev/ears`, and an api import planted in `@apackdev/host` each fail `check:specifiers`.

### Phase 2 — `@apackdev/ears/lmdb`
- Move LMDB and persistence into `@apackdev/ears/lmdb` (Decision 3), and replace `attribute-storage.ts`'s import side effect with `openLmdbStore`, called by the api's composition root.
- Host services (`app-data`, `trace-store`) take the store as an argument.
- Delete `host/src/ears`, `host/src/persistence`, `api/src/core/ears`, `api/src/core/persistence`, and the registry keys `attribute-storage`, `hydrate-sharded` and `lmdb-query`.

**Done when:**
- The persistence and host data specs pass on `@apackdev/ears/lmdb`.
- `npm run build`, E2E and a packaged-build smoke of `electron-builder --dir` boot with data persisted across a restart.
- Nothing under `@apackdev/host` or `packages/api` imports `lmdb`.
- Mutation: skipping `setPersistence` in composition fails a restart-persistence spec.

### Phase 3 — The `HostRuntime` port and SDK plumbing
- Replace the organization goal's interim `event-transport` host module with `HostRuntime.transport` (backend), and the renderer's `secrets-client` host module with `bindFeHost`'s `secrets` (frontend).
- **The one behaviour change in this goal:** `broadcastToSurface` and `services.emitter.broadcastToSurface` send `OUTGOING` through the bus actor, so every backend-to-frontend send is dropped until a client connects, as `emit` inside systems already is. E2E covers the code and browser systems' early sends (terminal output, file watchers), and a harness spec shows a send before `connect()` doesn't reach the client.
- Add `HostRuntime`, `bindHost` and `bindFeHost` (Decision 5).
- Move event sends, logging and error reports into the SDK over `transport` (Decision 6), with their specs. `getAppVersion()` reads `appVersion`.
- Convert the remaining SDK readers to the bound runtime: `rootEvents` (`runtime/root-events.ts`), `secretsClient` (`fe/secrets-client.ts`), `services`, and `navigateToSurface` (`fe/navigation.ts`). Delete `initRpc()` and the renderer's `secrets-client` host module registration.
- The api binds `createHostRuntime`, and the renderer binds the frontend port with its `application` actor and secrets client (`renderer/src/core/secrets-client.ts`).
- `startTestRuntime` binds the in-memory runtime (its test bus as `transport`), and the harness binds with its `packs`.
  - The test host prints log events from its bus to the console, as its console logger does today.
  - It records `SYSTEM_ERROR` events from its bus for `takeSystemErrors()`, which now returns those events (`message`, `source`, `stack`, …) instead of `reportError`'s input. The harness's unexpected-error failure message and every in-repo caller follow.
- The renderer binds the frontend port where it registers `application` today (`main.ts:122`), before it loads pack frontends (`main.ts:163`).
- Delete `runtime/host.ts` (`registerHostModule`, `getHostModule`, `hostFn`, `hostValue`), `HOST_SERVICE_MODULES`/`registerHostServices`, and `api/src/core/router/event-transport.ts` (and the renderer's), `core/shared/system-errors.ts` and `core/shared/debug/logger.ts`. Run `api:update`.

**Done when:**
- No `registerHostModule`/`getHostModule` exists anywhere, and a guard test fails if one is added.
- `bindHost` twice throws.
- An unbound `services.inference` call throws naming `bindHost`.
- `HostRuntime` compiles only when complete.
- An SDK spec shows `broadcastToSurface`, `sendToBrainSystem`, `onIncoming`, `reportError` and `createLogger` reaching a bound test bus, and the api's log capture logging each log event once.
- A default-setup spec runs a content action that uses `services.emitter`, `services.logger` and `services.repository` on the action step, and checks the event it emitted, the log event and the row it wrote.
- The logs system receives log events through `onLog` on the bound runtime (`logs-system.spec.ts`).
- The SDK's frontend client works with the host module gone: the settings surface's Secrets E2E, and a renderer spec that `secretsClient` reaches the bound client.
- All unit suites, E2E, `test:external-pack` and `test:packaged-authoring` pass.
- A spec shows `createLogger` writing to the console with nothing bound, and a CLI command that logs through `@apackdev/host/packs` runs.
- A harness spec shows a system error reported by a system fails the test unless taken, with the error's message in the failure.
- Mutations fail tests: a `HostRuntime` member left out of the api's binding; the harness binding without `packs`; the test host not recording `SYSTEM_ERROR` events.

### Phase 4 — App runtime out of the api
- Move the migrations runner and app migrations into `@apackdev/host/migrations` (Decision 6). The pack lifecycle and the backend system composition moved in Phase 0.
- `appData.reset()` runs the full reset (stores, pack boot hooks and boot apply, migrations). default-setup's reset actor only calls it, and `runMigrations` is removed from `@apackdev/sdk/utils`.
- `createHostRuntime` assembles the runtime. The api's tRPC procedures delegate to host.
- Move each moved module's specs with it.
- `bridge-drift`: the host pack loader (`packs/runtime/bridge.ts`) builds its bridge from `SHARED_INSTANCE_PACKAGES`.

**Done when:**
- `@apackdev/host/services` holds exactly `app-data`, `trace-store`, `inference`, `secrets` and `index`, and a guard spec compares the directory to `HostRuntime['services']`'s keys.
- `packages/api/src` contains only `server.ts`, `setup/{websocket,config,backend}.ts`, `core/router/{trpc,context,bus-router,bus-emitter,events,packs-router,secrets-router,index}.ts`, log capture and `types`, and a guard spec lists the allowed files.
- Phase 0's transport guard on `@apackdev/host` still passes.
- A spec shows `appData.reset()` leaves an onboarded app with default settings, written flows and migrations applied.
- The CLI's pack commands and the harness still run without a server.
- The full check list passes.

### Phase 5 — Data ownership
- SDK repositories for the flow model, actions and prompts (Decision 7). default-setup's projections move onto them, and `builtin-repositories.ts` is deleted.
- The `AppState` entity and `@apackdev/host/app-state`. Every `settings.internal` read and write moves there, including SDK boot apply's `contentRevision`, which moves to host.
- The `Settings` entity, settings content format and applier move to default-setup. Follow the TYPED-EARS checklist for `sdk-entities.ts`.
- `resolve-cli` and the CLI path override move to default-setup's code feature.
- App migration for stored data (Decision 7), with an idempotence spec on old-shaped data.

**Done when:**
- `repository as unknown as` appears nowhere in `packages/*/src`, and a guard fails if it's added.
- `packages/default-setup/tests/unit/settings-reset-app-state.spec.ts` is unskipped and rewritten against `AppState`. It's committed skipped today: it fails on the current code (resetting settings erases `hasOnboarded`, `packVersions` and `packContentRevisions`).
- The migration spec moves old-shaped data and a second run changes nothing.
- The app boots onboarded against a copy of pre-migration user data, with an isolated data dir.
- The full check list passes.

### Phase 6 — The engine as an instance
- **Safety net first**, against today's module-level engine in `@apackdev/ears`:
  - Contract tests in `packages/apack-ears/tests/`, black-box against the public API:
    - `create`, `write` and `destroy`, with the ids and fields returned;
    - relations (link, unlink, `linksTo`, `relatedTo`, `linkSymmetric`, cycle detection) and roles (grant, revoke, `withRole`);
    - query builder terminals and ordering, blueprints and `spawn`, repository registration;
    - the exact order and payload of persistence-sink calls for a sequence of writes;
    - hydration through bulk load, followed by queries.
  - A Vitest benchmark (`packages/apack-ears/bench/ears.bench.ts`): hydrate 50k entities, 200k attributes and 100k relations, then time `query` by type with a `where` and `pickAll`, relation traversal, and batches of 1,000 `create`s. Record the baseline in this doc. The tolerance is +10% median per case; investigate anything beyond it.

    **Baseline** (2026-09-16, module-level engine, `npm run bench -w @apackdev/ears`, Apple silicon, Node 23.11; each figure is the median of the case's per-run medians over 3 runs):

    | Case | Baseline (module engine) | After (engine instance) | Change |
    |---|---|---|---|
    | bulk load 50k entities, 200k attributes, 100k relations | 189.3 ms | 187.3 ms | −1% |
    | `query('Task').where('status', …).pickAll()` | 39.9 ms | 38.8 ms | −3% |
    | relation traversal (a project's tasks, then their assignees) | 20.8 ms | 21.7 ms | +4% |
    | batch of 1,000 `create`s | 3.40 ms | 3.33 ms | −2% |

    The "after" column is the same benchmark on `createEarsEngine`'s faces (same machine, 3 runs), within the +10% tolerance.

    **Query fixes** (2026-09-16, after the goal): an id content checks the entity-by-type index instead of scanning every entity, a chained step skips that check unless an entity left the engine since the query was built, and `where(k, v)` filters only the query's ids. Two cases were added for the paths the benchmark missed. "Before" is one run of the old code; "After" is the median of the per-run means over 3 runs (the review fixes included), and is the baseline from here on, with the same +10% tolerance:

    | Case | Before (1 run) | After (median of 3) |
    |---|---|---|
    | bulk load 50k entities, 200k attributes, 100k relations | 237 ms | 196.6 ms (unchanged code) |
    | `query('Task').where('status', …).pickAll()` | 47.3 ms | 19.5 ms |
    | 1,000 `query.ids(id)` lookups | 1,021 ms | 0.22 ms |
    | `query('Task')` with 3 chained steps (`ofType`, `orderBy`, `limit`) | 66.0 ms | 26.6 ms |
    | relation traversal (a project's tasks, then their assignees) | 22.2 ms | 0.0026 ms |
    | batch of 1,000 `create`s | 3.58 ms | 3.70 ms (unchanged code) |

    The chained-steps case measured 24.0 ms in a single run of the fix; 3 runs of the fix before the stale-id check was added also give a median of 26.6 ms, so the check costs nothing when nothing was destroyed.

    **Value index** (2026-10-23, after the goal; Apple silicon, Node 23.11, the median of 3 runs' means, both engines run on the same machine within the same hour): the engine's lazy multikey value index answers `where(k, v)` and `withRole` on a start from types, and short codes skip a taken number through it. Three cases were added (a unique-value lookup, `withRole`, short codes), and the hydration gives 1 entity in 100 a role and 1 in 1,000 a short code. "Before" is the engine one commit earlier (`ce5b6d350e`). This is the baseline from here on, with the same +10% tolerance:

    | Case | Before | After |
    |---|---|---|
    | bulk load 50k entities, 200k attributes, 100k relations | 168.7 ms | 172.5 ms |
    | `query('Task').where('status', …).pickAll()` | 20.3 ms | 16.1 ms |
    | 1,000 `where` lookups by a unique value | 6,693 ms | 0.78 ms |
    | 100 `withRole` lookups | 618 ms | 11.9 ms |
    | 1,000 `query.ids(id)` lookups | 0.20 ms | 0.21 ms |
    | `query('Task')` with 3 chained steps | 27.6 ms | 24.7 ms |
    | relation traversal | 0.0027 ms | 0.0027 ms |
    | 1,000 short codes | 1,416 ms | 0.26 ms |
    | batch of 1,000 `create`s | 3.91 ms | 4.29 ms |
    | `transact`: 1,000 `create`s as one unit | 5.34 ms | 6.31 ms |

    The two write cases are over the tolerance, and investigated: the benchmark's write cases run after its query cases, so every `create` also keeps the indexes those built, `title`'s among them — a value per entity, which is what indexing a unique field costs. With the unique-value case left out, so that `title` is never indexed, they measure 4.10 ms (+5%) and 5.80 ms (+9%). An index is built for a kind only once something queries it by value, and the index keeps a value held once as its id rather than a set of one.
- **Factory underneath, same behaviour:** convert each engine module to a factory closing over its state and compose `createEarsEngine` from them, keeping a temporary installed default so no caller changes. Pass cross-module dependencies (persistence, entity-type checker, relation index) through the factory.
- **The app owns the instance:** the api's composition root creates the engine with the LMDB sinks and policy, keeps `admin` for hydration and `createHostRuntime`, and binds `query` as `HostRuntime.ears`. `appData`, `traceStore` and `@apackdev/ears/lmdb` take `admin`. The api's `scripts/db/*` and default-setup's database feature and tests move off imported write functions onto `admin`.
- **Tooling and tests go explicit:** the CLI flow compiler and decompiler use a private engine per compile. SDK and ears tests and default-setup tests stop calling `clearMemory`/`initEARSRuntime` and get fresh engines. Run the default-setup, SDK and ears suites with file parallelism enabled, and keep it where it holds.
- **Remove the default:** delete the temporary default engine and `@apackdev/ears/internals`, add the unbound-use error test, and run `api:update`.

**Done when:**
- Contract tests pass on the singleton before the refactor and on the instance after it, and fail under targeted mutations (a dropped index update, a skipped sink call).
- A guard test finds no top-level `new Map`/`new Set`/`let` state in `@apackdev/ears` engine modules.
- The benchmark is within tolerance of the recorded baseline.
- No production code or test imports engine write functions outside `admin`; no test calls `clearMemory` or `initEARSRuntime`.
- `query`/`create`/`write` with no engine installed throw the documented error.
- A spec runs two engines in one process without sharing data, and a CLI compile leaves the installed engine untouched.
- Default-setup's typed-EARS specs, `facade-typing.spec.ts` and completions are unchanged; pack-facing API reports change only by the added `createEarsEngine`/engine types.
- The full check list passes.

### Phase 7 — Registered packs as an instance
Phase 6 gives each app its own engine. This phase does the same for the other thing an app owns: the packs it registered, and everything they contributed. After it, no module keeps per-app state at module scope, which completes Decision 1's "one owner per concern".

**Today.** What packs registered is held in module-level globals, one copy per process:
- **Host:** `packs/pack-registration.ts` (the registrations, host systems, the entity-type and services caches, and Phase 0's event validation map cache), the shutdown hooks Phase 0 moved into host, `fe/pack-store.ts` (surfaces, the default surface, each pack's contributions) and `fe/app-extensions.ts`.
- **SDK lookups host fills at registration:**
  - `designations/index.ts`
  - `steps/registry.ts`, `artifacts/registry.ts`, `blocks/registry.ts`
  - `content/hooks.ts`
  - `framework/pack-settings.ts`, `framework/pack-commands.ts`
  - `fe/text-editor-extensions.ts`
- **SDK lookups pack code fills when it's imported:** generated `appliers.ts` calls `registerApplier` (`utils/apply.ts`), and generated `dsl-register-fe.ts` calls `registerDslType` (`fe/dsl-types.ts`).
- **SDK build tooling fills the same step, artifact and block lookups** while it compiles (`build/manifest-bridge.ts`, used by `build/content-compiler.ts`).

A copy of what host decided can disagree with host. That is how designations resolved external packs' roles to the wrong system id.

**Rules for this phase.**
- **Packs don't change what they import.** They call the same SDK functions with the same names and signatures (`getDesignated`, `hasDesignation`, `stepRegistry.get`, `getPackSettingsDefaults`, `services.x`, …). Those functions read the bound `packs` (Decision 5). No pack source or pack test imports `@apackdev/host`, and `check:specifiers` keeps enforcing it.
- **The SDK defines the shape; host implements it.** `PackRegistryView` and `FePackRegistryView` (`@apackdev/sdk/runtime`) are read-only interfaces. Host's `createPackRegistry()` (`@apackdev/host/packs`) and `createFePackRegistry()` (`@apackdev/host/fe`) return objects that own the data and hold the only write methods: register and unregister, with today's collision checks and rollback. The SDK keeps no write functions for them.
- **Only the programs that assemble an app create one:**
  - the api's composition root, which passes it to `createHostRuntime`;
  - the renderer, which passes the frontend one to `bindFeHost`;
  - the harness, one per test file, holding the pack and its dependencies;
  - the CLI, a private one per build.

  Packs never create or import one.
- **Contexts without an app use an SDK stand-in, never host's.** `@apackdev/sdk/testing`'s `startTestRuntime` binds a plain in-memory view that its tests fill directly. default-setup's `features/flows/fe/canvas/__tests__/layout-utils.test.ts`, which writes `stepRegistry` directly today, moves onto it. The build tooling (`manifest-bridge.ts`, `content-compiler.ts`) takes the step, artifact and block definitions it compiles with as arguments, the way Phase 6 gives the flow compiler a private engine.
- **No registration on import.** Everything a pack contributes arrives in its registration objects. `generate-entries` puts appliers in `PackRegistration.appliers` and DSL types in `PackFERegistration.dslTypes`, and the generated modules stop calling `registerApplier` and `registerDslType`. Repositories are the engine's (Decision 4), handled in Phase 6.
- **Not a goal:** binding two apps at once. Binding stays once per process (Decision 5), as Phase 6 has one installed engine: two registries can exist side by side without sharing data, and the bound one answers the SDK's lookups. This isn't a security boundary either; packs still run in-process.

**Steps.**
- **Safety net first**, against today's globals:
  - specs for each lookup, through the functions packs call: registering, unregistering, collisions with rollback, designations resolving to the system that plays the role, and feature settings defaults and commands appearing and disappearing with their pack;
  - the host registration and frontend store specs from the designation fixes, kept as they are.
- **Host objects underneath, same behaviour:**
  - turn `pack-registration.ts`, the shutdown hooks and the event validation map cache into `createPackRegistry()`;
  - turn `fe/pack-store.ts` and `fe/app-extensions.ts` into `createFePackRegistry()`;
  - fold each SDK lookup's data into them.

  Keep a temporary installed default so no caller changes yet.
- **The port carries it:** extend `PackRegistryView` and `FePackRegistryView` with the lookups listed under Decision 5, and point the SDK functions at the bound view. Delete the SDK modules' own maps and write functions: `registerDesignations`, the lookups' `register`/`unregister` methods, `registerApplier`, `registerDslType` and `textEditorExtensionsRegistry`'s writes.
- **Registration carries everything:** `generate-entries` writes `appliers` and `dslTypes` into the registrations, and host registers them. Rebuild default-setup, the fixture packs and the example pack.
- **Composition roots create and bind:**
  - the api and the renderer;
  - the harness, which registers the pack and its dependencies into the registry it creates. It no longer needs the `getPackContributions` guards (`apack-testing/src/harness.ts`) that skip a pack already in the process-wide registry;
  - the CLI per build.

  Phase 0's pack runtime (`@apackdev/host/packs/runtime`) takes the registry it works on as an argument.
- **Remove the default:** delete the temporary default registries, and add the unbound-use error test.

**Done when:**
- The safety-net specs pass on the globals before the change and on the instance after it, and fail under targeted mutations (a dropped collision check, a lookup reading a stale copy).
- A guard finds no top-level `new Map`, `new Set`, array or `let` state in the SDK registry modules and host's `packs/pack-registration.ts`, `fe/pack-store.ts` and `fe/app-extensions.ts`, and fails when one is added back.
- Reading a lookup with nothing bound throws, naming `bindHost` (or `bindFeHost` in the frontend).
- A spec creates two registries in one process with different packs, and neither sees the other's designations, steps, services or settings defaults.
- The harness registers into the registry it creates, with no guard against an earlier registration. A CLI build leaves the bound registry untouched.
- No generated pack module registers anything when imported, and a spec imports default-setup's generated entries without registering a applier or DSL type.
- Pack-facing API reports change only by the deleted write functions and the new `appliers` and `dslTypes` registration fields, and `check:specifiers` still finds no `@apackdev/host` import in pack sources or pack tests.
- `npm run test:external-pack`, `npm run test:packaged-authoring` (packs rebuilt with the new generator), the full E2E suite (including `dev-reload.spec.ts`) and the full check list pass.

### Phase 8 — Docs
- Root `CLAUDE.md`: the SDK packages section, layers, `@apackdev/ears`, `HostRuntime`, data layer and migrations location.
- `packages/apack-sdk/TYPED-EARS.md`: where the types live now.
- `packages/default-setup/CLAUDE.md` and `packages/apack-testing/CLAUDE.md`.
- `docs/public-facing` (services and data, testing, getting started: `@apackdev/ears` for packs).
- A note at the top of `goal-ears-engine-instance.md` that this goal absorbed it (Decision 9, Phase 6).
- `docs/public-facing/services-and-data.md`: `createEarsEngine` for pack unit tests and tooling.
- Root `CLAUDE.md` states Decision 6 (the four services, SDK plumbing over the event bus, host-only modules) where the SDK packages section lists host services today.
- Phase 7:
  - root `CLAUDE.md` and `packages/apack-sdk/CLAUDE.md` describe the registered packs as an instance created by the composition root and read through `packs`;
  - `packages/apack-host/CLAUDE.md` covers `createPackRegistry()` and `createFePackRegistry()`;
  - `docs/public-facing` says a pack contributes only through its registration (appliers and DSL types included) and names no registry to write to.

**Done when:** no doc, template or CLAUDE.md mentions `registerHostModule`, `getHostModule`, `runMigrations`, `@apackdev/sdk/ears/internals`, `@apackdev/ears/internals`, `clearMemory`, `initEARSRuntime`, `api/src/core/persistence`, `BuiltinRepositories`, `settings.internal`, `registerDesignations`, `registerApplier` or `registerDslType`.

## Outcome (2026-09-16)

All nine phases are implemented on `AS/package-boundaries`. Each phase ran the full check list at its end; the final run after Phase 8 is recorded under "Final verification". The example pack's steps fail only where noted there.

### Per phase

| Phase | Status | Evidence |
|---|---|---|
| 0 — pack runtime into host | done | `api/src/packs` and `systems.ts` gone; `@apackdev/host/packs/runtime`, `createAppBus()`; `apack-host/tests/boundaries.spec.ts` (transport, barrel and bus clear of the runtime, no self-imports, no `api/src/packs`); event validation map owned by the registry (`event-validation-map.spec.ts`); `app-bus.spec.ts`; `db:cli` on a temp data dir |
| 1 — `@apackdev/ears` | done | `packages/apack-ears` (0.1.0, fixed release group, API reports, publint/attw, TS 5.7 floor); `SHARED_INSTANCE_PACKAGES` with generated `shared-modules.ts`; `findSharedPackageLists`, `findUpwardImports`; fixture shared-engine spec and E2E prove one instance |
| 2 — `@apackdev/ears/lmdb` | done | `openLmdbStore`; host/api EARS and persistence dirs deleted; `findLmdbImports`; `restart-persistence.spec.ts` (mutation: skipping the sink fails it); packaged `electron-builder --dir` smoke persisted a note across a restart |
| 3 — `HostRuntime` | done | `runtime/host.ts` deleted, `no-host-modules.spec.ts`; `bindHost`/`bindFeHost`; sends, logging and error reports over `transport`; `broadcastToSurface` through the bus (E2E `surface-sends.spec.ts`, harness spec); `takeSystemErrors` returns `SYSTEM_ERROR` events |
| 4 — app runtime out of the api | done | `@apackdev/host/migrations` (with its CLAUDE.md, `runner.spec.ts`); `createHostRuntime`; `receiveClientEvent`, `secretsSnapshot`, `forwardSecretsChanges`; `source-layout.spec.ts` lists the api's files; `boundaries.spec.ts` compares `src/services` to `HostRuntime['services']`; `app-reset.spec.ts` |
| 5 — data ownership | done | SDK `flowRepository`, `tnodeRepository`, `actionRepository`, `promptRepository`; `builtin-repositories.ts` deleted; `@apackdev/host/app-state` and the host 0.4.0 app migration (`app-state-0.4.0.spec.ts`, run twice); Settings, its content format and applier in default-setup; `resolve-cli` in the code feature; `findRepositoryCasts`; `settings-reset-app-state.spec.ts` unskipped; the built api booted onboarded on old-shaped data in a temp dir |
| 6 — engine instance | done | `createEarsEngine` (query/admin faces), `installEngine`; contract suite (32 + 4 persistence specs) passed before and after; `no-module-state.spec.ts`, `no-engine-state-access.spec.ts`, `installed-engine.spec.ts` (unbound errors, two engines); benchmark within tolerance (table above) |
| 7 — registered packs instance | done | `createPackRegistry()`, `createFePackRegistry()`; SDK lookups read the bound `PackRegistryView`/`FePackRegistryView`; appliers and `dslTypes` in the registrations; `registered-lookups` (16), `fe-registered-lookups`, `registry-state`, `two-registries`, harness-registry, build-registry and generated-entries-import specs |
| 8 — docs | done | root, ears (new), sdk, host, cli, testing, default-setup, api, ui CLAUDE.md files, `TYPED-EARS.md`, `docs/public-facing`, `README.md`; the engine-instance and pack-api goals moved to `docs/archive/goals/` with a note at the top; `apack-host/tests/removed-names-in-docs.spec.ts` |

Every new guard, helper and spec was mutation-checked in its phase (each phase's report lists the mutations and their failing specs).

### Conventional choices

- **Phase 0:** `loaded-packs.ts` stays in `packs/runtime/`, the one runtime module the bus guard allows; `@apackdev/host` is `sideEffects: false`; `PackBundleEntry` lives in `packs/bundle.ts`; `createAppBus()` reads the SDK-bound `rootEvents` (which gained `onPackClientConnected`); `bundledLoaders` is required for `never`, and for `prefer` when it falls back.
- **Phase 1:** the SDK depends on `@apackdev/ears` (not a peer); `@internal` tags sit on declarations; the loader's bridge is a generated, checked-in module (`APP_UNBRIDGED` = actions, testing); pack frontends don't share `@apackdev/ears`; `sharedInstanceExports` falls back to the SDK's copy of `@apackdev/ears`. Completion of `entityType` in a bare `BaseEntity` literal now suggests only `Relation` (the engine knows no SDK names); pack-typed completions are unchanged.
- **Phase 2:** the persistence port is public in the `@apackdev/ears` root; `@apackdev/ears/lmdb` isn't bridged (`APP_ONLY_EXPORTS`); the partition policy follows registration by itself; the store has no close-on-exit hook; error counters are per adapter.
- **Phase 3:** `startTestRuntime` binds `packs`/`appVersion` on its first call; every log event is printed once (step and system errors included); the renderer's failed sends log under `fe-host`. Behaviour notes: sends to surfaces are dropped until a client connects; CLI install lines are prefixed `[pack-installer]`.
- **Phase 4:** composition lives in `setup/backend.ts` (`openAppStore()`); the app version comes from the root `package.json`; `createHostRuntime` takes no `userDataDir` (nothing needed it); `packClientReady` and subscriptions stay in the router (transport); the reset spec lives in the api, which has the composition and the built runtime; `release.sh` points at default-setup's migrations. Behaviour note: Reset Database now leaves the written app data (boot apply, root flow), not an empty database.
- **Phase 5:** SDK repositories are plain exports of `@apackdev/sdk/ears`, not engine-registry entries; onboarding reaches packs as `appData.hasOnboarded()`/`completeOnboarding()`; settings are a default-setup content format (`content.sources` entries may be `{ path, format, applier }`); `AppState` keeps boot-content hashes and stat fingerprints per built-in pack, and the old single hash is filed under each; `lastInteractionTimestamp` was dropped; data with no version runs the host migrations, then counts as new.
- **Phase 6:** repositories arrive in `PackRegistration.repositories` and `registerPack` registers them with the installed engine (no import-time registration); the LMDB store takes an engine getter; `EarsAdmin` includes `getAttr` and `repositories()`; `installEngine(undefined)` uninstalls and returns the previous engine; the ears, sdk and default-setup suites run with file parallelism. The contract suite pins three existing quirks (a removed relation's id stays in the type index; `leaves()` without a type counts relation rows; granting a role twice).
- **Phase 7:** shared lookups read the frontend binding when bound, else the backend's; the view's method names are `designation`, `step(s)`, `artifact(s)`, `block(s)`, `contentWriters`, `appliers`, `settingsDefaults`, `onSettingsDefaultsChanged`, `commands` (plus `surfaces`, `defaultSurface`, `textEditor`, `appExtension`, `dslTypes` in the frontend); `testPacks` is the SDK stand-in; the harness exports `registerPack`/`unregisterPack`; the CLI registers a build's loaded definitions as one registration in a private registry; step, artifact and block type collisions still merge or replace; thread teardown moved into default-setup; module state that isn't a registration (the loader's built-in list, `loaded-packs.ts`, the packs system's built-in list) stays; the api exports its registry as the live binding `appPacks`.
- **Phase 8:** the host's app migrations runner is named `runAppMigrations` (was `runMigrations`), so no doc names the SDK export this goal removed; finished and superseded goal docs moved to `docs/archive/goals/`; the removed-names guard lives in the host suite (it runs in `npm run test:unit` with no build step).

### Corrections to the Decisions

These edits in the Decisions above fix statements that didn't match what was built:
- Decision 1 and "Finished when": the api's server is `node:http`, not Fastify; host's transport guard checks `fastify`, `@trpc/*` and `ws` imports.
- Decision 3: `openLmdbStore` also takes `engine` (a getter for the admin face it hydrates into).
- Decision 5: `bindFeHost` also takes `transport` (the renderer's sends to backend systems).
- Decision 6: `createHostRuntime({ store, engine, transport, appVersion, packs })`; there's no `userDataDir`.
- Decision 7: `AppState` keeps the boot apply's hashes and stat fingerprints per built-in pack (`contentRevisions`, `contentStatFingerprints`).

### Open items

- Resolved after the goal: Electron main serves and stores media in the folder the API's `_getMediaPath()` uses; `apack add migration` scaffolds a `PackMigration`; the loader's bridge no longer maps `@apackdev/host/packs` and `/backup`.
- Review fixes after the goal: a beta runs its release's migrations (again on each new beta) and a development build runs every pending migration, so the host's 0.4.0 app-state move reaches them; a failed migration stops the rest, records no version and skips the packs' migrations and content, so nothing deletes the old state; pack repositories are collision-checked and removed with their pack; reset shuts packs down and starts them the way boot does (`startPacks`); backup import runs the migrations; `flowRepository.updateNode` keeps a node's link on a partial update; the LMDB store no longer writes back an entity destroyed in the same tick, and moves a relation it didn't see written; kept query builders drop destroyed ids; `apack build` and the bridges refuse `@apackdev/ears/lmdb` in packs; pack tests fail when the pack's `@apackdev/ears` isn't the SDK's copy; `unbindHost`/`boundHost` moved to the source-only `@apackdev/sdk/runtime/internals`; the renderer binds its host before creating the application actor.

### Final verification

Run sequentially on 2026-09-16 after Phase 8:

- `npm run typecheck`, `schema:check`, `api:check` (sdk, ui, ears), `packages:build` + `packages:check`, `npm run compile`, `facade:check`: pass.
- Unit suites: api 66, default-setup 670 (2 skipped), host 302, ears 93, sdk 352, cli 424, renderer 27: pass.
- `npm run build`, E2E (11, including `dev-reload.spec.ts`), `npm run test:external-pack`, `npm run test:packaged-authoring`: pass.
- Grep proofs: no `registerHostModule`/`getHostModule`/`hostFn`/`hostValue` in code (only the guard naming them); no `lmdb` import in `@apackdev/sdk`, `@apackdev/host` or `packages/api`; `sdk/src/ears` holds only the SDK entities' repositories; `host/src/{ears,persistence}`, `api/src/core/{ears,persistence}`, `api/src/packs` and `api/src/systems.ts` don't exist; no `repository as unknown as` in any package source.
- Benchmark (`npm run bench -w @apackdev/ears`, median of per-run medians over 5 runs, with another app using a full core; an earlier 3-run set under heavier load had traversal at +14%, and nothing in Phase 8 touched engine code):

  | Case | Baseline | Final | Change |
  |---|---|---|---|
  | bulk load | 189.3 ms | 200.8 ms | +6% |
  | `query` where + `pickAll` | 39.9 ms | 40.8 ms | +2% |
  | relation traversal | 20.8 ms | 21.3 ms | +3% |
  | 1,000 `create`s | 3.40 ms | 3.41 ms | +0% |

- Example pack: `apack build` fails with `ERR_MODULE_NOT_FOUND: @apackdev/ears` from its content runtime bundle. Its `node_modules` has no `@apackdev/ears` link, and `npm install` there is the user's to run (its `package.json` declares the `file:` dependency). Its `tsc`, unit tests and `apack test` weren't reached; they passed through Phase 0 (8/8), before `@apackdev/ears` existed.

**After the goal:** `@apackdev/sdk/ears` was renamed `@apackdev/sdk/repositories` and holds only the SDK entities' repositories; the SDK's `EARS` and entity shapes, which it re-exported, come from `@apackdev/sdk/types` and the root. `@apackdev/sdk/ears` in the text above names the module before that change.

## Deferred

- Unbundling the SDK:
  - the build toolchain (compilers, manifest, `generate-entries`) moves to `@apackdev/cli` or an `@apackdev/build` package;
  - the in-memory test host moves to `@apackdev/testing`.
- Renaming `packages/api` to reflect its transport role.
- Removing the typed EARS `NoInferType` workaround now that the floor is TypeScript 5.7 (a TYPED-EARS change).

## Constraints

- Commit, stage, push or tag only when the user asks in the session. When asked, commit in logical chunks with conventional messages and no Co-Authored-By or Claude-Session lines; check `git diff --cached` first and commit with `git commit -- <paths>`.
- Never publish externally: no `npm publish` (use `npm pack` and `--dry-run`), no real GitHub releases. CI workflows may be written, not triggered.
- Never use broad pkill/killall on Electron or node. E2E runs alongside the user's dev and prod apps in the `apack-test` namespace.
- Don't launch the app outside the test environment without isolating `APACK_USER_DATA_DIR`. Manual boots use a copy of user data.
- Never run bare tsc on `packages/preload`. Don't run `npm install` in the example pack. Don't edit monorepo version/release metadata; `@apackdev/ears` joins the fixed release group at the group's current version.
- Typed EARS types are change-controlled (`packages/apack-sdk/TYPED-EARS.md`). This goal moves them but must not change their behaviour: run its type tests, completions check and mutation checks, and review the API report diffs.
- Migrations follow `migrations/CLAUDE.md` (next release target, idempotent guards, registered in order).
- `@apackdev/sdk`, `@apackdev/ears`, `@apackdev/ui` and `@apackdev/testing` are published: no `any` in pack-facing exports, TypeScript 5.7, `api:update` after export changes.
- The CLI suite requires `npm run packages:build` after SDK or ears source changes. default-setup's runtime (`npm run build -w @app/default-setup`) must be rebuilt before the api suites and E2E.
- Investigate failing tests before changing assertions; mutation-check every new guard, helper and test.
- External packs are first-class. Keep the in-repo fixture pack, the example pack (`/Users/spankyed/Develop/Projects/apack-external/example-pack`) and `test:packaged-authoring` passing throughout.
