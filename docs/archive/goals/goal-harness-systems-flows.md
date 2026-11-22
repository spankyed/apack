```
# Goal: unit-test systems, services and flows with the pack harness

> **Superseded in part** by `goal-inference-ai-sdk-7.md`: model calls go through `services.inference` on AI SDK 7, tests mock it with `mockInference` (`fakeInference`), and the TypeScript floor is 5.7. The `@apackdev/sdk/inference` module, the `model-provider` host module, `fakeModel` and the TypeScript 5.3 floor this doc describes were removed.

Implement docs/archive/goals/goal-harness-systems-flows.md on branch AS/external-test-harness
(or a branch cut from it): Background, Decisions, Phases, Constraints. Read it first.
It builds on goal-pack-test-harness.md (the data-tier harness) and takes up its
Deferred list. Decisions are final: implement them, don't reopen them or stop to ask.
Where a detail isn't specified, pick the conventional option, note it in the final
summary, and keep going. No backward compatibility: change signatures, migrate every
in-repo test, fixture and template in the same change, and fix forward.

Finished when:
- Phases 0–6 are implemented and each meets its "Done when"; every new guard, helper
  or test is mutation-checked.
- A pack's unit tests, from the packed tarballs, send its systems events and assert
  what they emit and write, call its services with others mocked, and run a flow
  through its dependency's brain and steps with a fake model.
  `test:packaged-authoring` proves it against default-setup.
- default-setup's unit suite runs on the harness: in memory, with no `@apackdev/host`
  import, no API `@/` path and no `@/setup/sdk-host-init`.
- The app's behaviour is unchanged: bus routing, pack loading and the pack
  client-ready handshake pass their existing tests, and the full E2E suite passes.
- `npm run typecheck`, `schema:check`, `api:check` (sdk), `packages:build` +
  `packages:check`, and the api, sdk, host, cli, default-setup and renderer unit
  suites pass.
- `npm run test:external-pack`, the monorepo E2E suite, `npm run test:packaged-authoring`
  and the example pack's `apack test --app-root <repo>` pass.
- You give a final summary: phase → done/deferred, evidence, the spike results, and
  the conventional choices you made.

Never:
- push or tag. Commit as you go in logical chunks (conventional messages, no
  Co-Authored-By or session lines). Commit with `git commit -- <paths>` and check
  `git diff --cached` first: something outside the session stages files.
- npm publish, create GitHub releases, or trigger workflows (dry runs only).
- pkill/killall Electron or node; launch the app outside the test env without an
  isolated APACK_USER_DATA_DIR.
- run bare tsc on packages/preload, `npm install` in the example pack, or edit
  version/release metadata.
- change the typed EARS types (packages/apack-sdk/TYPED-EARS.md) to make a call
  site compile.
- call a real model provider or the real `claude`/`codex` CLIs from a unit test.
- loosen a failing assertion instead of investigating.
```

## Background

The pack harness (`@apackdev/testing/harness`, on `@apackdev/sdk/testing`) unit-tests a pack's data code: content, repositories and content hooks against an in-memory EARS, including dependencies' applying behaviour. Systems, services and flows are tested only in E2E, and default-setup's own unit tests run on the API's host init.

- **The harness covers data code only.**
  - `setupPackTests` starts the in-memory EARS and registers dependencies' `build/content-runtime.mjs` and the pack's own content runtime (entity types, repositories, content hooks). It clears the database before each test (`apack-testing/src/harness.ts:67-91`).
  - `@apackdev/sdk/testing` registers only a console `logger` host module (`apack-sdk/src/testing/index.ts:52-58`).
  - The content runtime facet has no systems, services, steps, designations or settings. Those exist only in `#generated/pack-entry`'s `registration`.
- **A system needs an actor registered as `bus`.**
  - `emit()` is pure: it returns an `OUTGOING` event (`sdk/src/helpers/actor-helpers.ts:66-71`), which the system sends to `system.get(bus)` itself.
  - The app's bus (`api/src/systems.ts`) spawns every registered system under its id (`:135-140`). It routes `INCOMING` to `system.get(id)` and `OUTGOING` to `rootEvents` only once connected (`:184-218`).
  - The same machine also runs pack activation and reload, and reads the settings repository on connect (`:112-128`).
  - The only bus test is `api/tests/unit/bus-client-connected.spec.ts`.
- **SDK paths that need host modules the harness doesn't register:**

  | Host module | What needs it | Where |
  |---|---|---|
  | `event-emitter` | `broadcastToSurface`, `sendToSystem`, `sendToBrainSystem` | `sdk/src/services/index.ts:17-59` |
  | `bus-emitter` (via `initRpc()`) | `rootEvents`, used by the browser, code and logs systems and by `reportStepRuntimeError` | `sdk/src/steps/runtime-errors.ts:31` |
  | `pack-registry` | the `services` proxy | `sdk/src/services/index.ts:99-121` |
  | `system-errors`, `version`, `migrations` | `@apackdev/sdk/utils` | |
  | `app-data`, `trace-store` | host services | |

  - `getDesignated` throws for an unregistered designation. Only `registerPack` registers them (`apack-host/src/packs/pack-registration.ts:134-139`).
- **Flows need default-setup's brain and settings systems in one actor system.**
  - `startBrain` sends to `settings` (`default-setup/src/features/brain/be/system.ts:108-165`). Flow tracks send `TNODE_SPAWNED` to `brain` (`flow-system.ts:264` onward).
  - Steps run through `stepRegistry` handlers with the `services` proxy (`extensions/steps/action/runtime.ts:20-92`).
  - The `llm` step calls `@apackdev/sdk/inference` `generateText` (`llm/runtime.ts:72-81`). The model client imports `ai` directly (`extensions/services/model-client/index.ts:16`).
  - Schedules start a real `croner` job (`services/scheduler.ts`).
  - Steps without a runtime handler complete on the next microtask (`completeLater` in `node-handlers/index.ts`). Every default-setup non-trigger step has a handler except `subflow`, which spawns its flow (`spawnsSubflow`).
- **No test runs a system, the brain or a flow.** Tests fake services per file (`codex-handle-revert.spec.ts:3-66`, `handle-fork-stress.spec.ts:43-84`) and the switch step with a fake actor (`brain-switch-node.spec.ts:20-28`). There is no fake model, and no helper that captures emitted events.
- **default-setup's 51 test files run on the API's host init.**
  - `tests/setup.ts` imports `@/setup/sdk-host-init`, which opens real LMDB stores and registers 14 host modules (`api/src/setup/sdk-host-init.ts:20-39`), then registers `pack-entry`'s registration.
  - `vitest.config.ts` resolves `@/` into both default-setup and the API.
  - Groups: 5 FE, 8 services, 7 content actions, 7 flows/brain/steps, 6 repositories/host data, 6 content, 8 type-level, 4 build/CLI.
  - The build/CLI files test CLI and host code: `pack-cli`, `pack-generate`, `pack-protocol`, `monaco-defs-config`.
  - `host-data-services` tests the host's LMDB-backed `appData` and `traceStore`.
  - The content-parity harness uses `@apackdev/host/ears` (`clearMemory`, `getAllEntities`, `query`, `dropAttr`).
- **A dependency's full backend runtime is published.**
  - `dist/runtime/index.cjs` is published by the app for built-ins and cached in `.apack/deps/<id>/`.
  - It's CommonJS, with `@apackdev/sdk/*` and `SHARED_DEPS` external and everything else inlined. default-setup's inlines `ai`, `@ai-sdk/*` and croner.
  - The app loads it with `withHostResolution` and `SDK_BRIDGE` (`api/src/packs/pack-loader.ts:60-89, 234-276`), which point its `require('@apackdev/sdk/…')` at the host's module instances.
  - A plain `require` in a vitest process would load a second SDK instance: split registries and a split EARS store.
- **Packaging.**
  - The harness bundle keeps `@apackdev/sdk`, `vitest` and `tsx` external and inlines `@apackdev/host` (`scripts/bundle-package.ts:35-45, 83-109`). Host code in the harness therefore runs on the pack's SDK.
  - `@apackdev/sdk/testing` is public API: no `any`, TypeScript 5.3, no host imports.
  - `harness-requires-source.ts` must list every harness export (`apack-cli/tests/build/testing-source-entry.spec.ts`).
  - The content runtime load check blocks `ai` and `@ai-sdk/*` (`apack-cli/src/build/content-runtime-check.ts`). Systems and services can't join the apply facet.

## Decisions

Final.

1. **Two tiers, one harness.**
   - `setupPackTests({ contentRuntime })` stays the data tier.
   - `setupPackTests({ contentRuntime, registration })` adds the runtime tier: the pack's own `#generated/pack-entry` registration (systems, services, steps, designations, feature settings) and each dependency's full runtime.
   - Content-only tests stay fast and never load `ai`.
2. **Dependencies' runtimes load through the app's bridge.**
   - `SDK_BRIDGE` and `withHostResolution` move from `api/src/packs/pack-loader.ts` into `@apackdev/host/packs`, taking the SDK module namespaces to bridge as an argument.
   - The API passes its own. The harness, which inlines host code, passes the pack's `@apackdev/sdk` namespaces.
   - An SDK subpath whose optional peer isn't installed is bridged lazily and fails only when used, naming the missing peer.
   - A dependency's registration is applied with host `registerPack`, as in the app. Its `boot` hooks and `contentManifest` don't run, and `setCompiledDir` points at the dependency's cached content.
3. **One bus implementation.**
   - The bus's routing core moves into `@apackdev/host` as `createBusMachine({ onOutgoing })`. The core covers: spawn the registered systems, route `INCOMING` to `system.get(id)` and `OUTGOING` to the sink, the connected state with `CLIENT_CONNECTED`, and the pack client-ready handshake.
   - `api/src/systems.ts` composes pack activation, reload and the settings-backed connect event on top.
   - The harness runs the same core with a recording sink.
4. **A test host in `@apackdev/sdk/testing`.** `startTestRuntime` registers in-memory host modules for everything a system, service or step reaches:
   - `event-emitter` and `bus-emitter` (with `initRpc`), both wired to the test bus;
   - `system-errors`, recorded, and a test fails on one it didn't expect;
   - `version` and `migrations`, as no-ops;
   - `app-data`: reset is `resetTestData`; backup export and import throw, naming them unsupported in tests;
   - `trace-store`, in memory.

   `pack-registry` comes from the harness (host `@apackdev/host/packs`). Nothing exported uses `any`, and it compiles on TypeScript 5.3.
5. **Harness API for systems** (`@apackdev/testing/harness`):
   - `const app = await startApp({ systems })` spawns the named registered systems under the test bus; `'*'` spawns all. A bare feature id maps to the pack's bus id (`<packId>.<featureId>`), as `#generated/bus-ids` does.
   - `app.connect()` sends `CLIENT_CONNECTED`. `app.send(systemId, event)` routes like `trpc.bus.send`.
   - `app.emitted(surfaceId?)` lists the recorded outgoing events. `await app.nextEmit(surfaceId, type)` waits for one.
   - `await app.settle()` drains queued actor work and zero-delay raises.
   - The harness stops the app after each test.
6. **Services.**
   - `services` resolves to the real registered services. Host services (`logger`, `emitter`, `repository`, `appData`, `traceStore`) come from the test host.
   - `mockService(name, impl)` replaces one service for the current test and restores it after. It's typed from the pack's `Services`, and an implementation may give only the methods the test uses.
7. **A model seam, not a mocked `ai`.**
   - `@apackdev/sdk/inference` resolves models through a `model-provider` host module. The app's default builds the AI SDK providers it builds today.
   - default-setup's model client moves onto `@apackdev/sdk/inference` and stops importing `ai`.
   - `@apackdev/sdk/testing` exports `fakeModel(respond)`: scripted text, streams and tool calls, with every prompt recorded.
8. **Flows.**
   - `await app.runFlow(label, { event?, data? })` needs `brain` and `settings`, from the pack or a dependency.
     - It starts the brain if it isn't running and sends `TRIGGER_BRAIN_EVENT` to the flow.
     - It resolves once the triggered track's step TNodes have all completed or failed, and returns them with their outputs.
   - `app.flowTrace(label)` reads those TNodes afterwards.
   - Schedule triggers go through the scheduler service, so `mockService('scheduler', …)` or vitest fake timers drive them.
   - Steps without a runtime handler complete on the next microtask instead of after `setTimeout(100)`. The brain E2E must pass unchanged with it.
9. **default-setup's tests move onto the harness.**
   - `tests/setup.ts` calls `setupPackTests({ contentRuntime, registration })`. `vitest.config.ts` and `tsconfig.test.json` drop the API paths.
   - Tests of host or CLI code move to their package:
     - `host-data-services` → `apack-host/tests`;
     - `pack-cli`, `pack-generate`, `pack-protocol`, `monaco-defs-config` → the package whose code they test.
   - The content-parity harness uses SDK test helpers: `resetTestData`, `untypedQuery`, and new `@apackdev/sdk/testing` `entityIds()` and `dropAttribute()`.
   - Hand-built service fakes become `mockService`. `brain-switch-node` and the flow routing tests (`codex-flow-routing`, `mode-name-routing`) run their flows with `runFlow`.
   - `check:specifiers` rejects `@apackdev/host` and API `@/` imports in default-setup's tests, as it does in pack sources.
10. **Scope.**
    - In: backend systems, services, flows and steps, including dependencies'.
    - Out:
      - FE surfaces, which vitest already covers;
      - the real CLIs, which stay behind `mockService`, with the gated `_hybrid` integration tests unchanged;
      - persistence (LMDB), which stays in API and host tests.

## Phases

### Phase 0 — Spikes (throwaway branch or worktree)

Record the results in a "Spike results" section of this doc before Phase 1.

**A. Dependency runtime in vitest.** In default-setup's vitest process, load `dist/runtime/index.cjs` through a bridge built from the SDK namespaces vitest imported. Record:
1. Whether there's one SDK instance. A repository the runtime registers must be visible through test code's `repository`, and a row it writes must be visible to `query`.
2. Whether there's one xstate. An actor from the runtime's machine must be spawnable under a test-code parent.
3. What happens with an optional peer that isn't installed. Test code must import `@apackdev/sdk/inference` and the runtime must load; the failure must come only on use.

**B. Bus core.** Spawn the fixture pack's `memos` system under a copy of the bus routing core with a recording sink. Record whether `CLIENT_CONNECTED` produces `MEMOS_CONNECTED`, and whether `ADD_MEMO` writes the row and records `MEMO_ADDED`.

If A.1 or A.2 fails, stop and record why in this doc. If B needs more than the routing core, record what and extend Decision 3's core by that.

**Done when:** the spike results are recorded and both spikes pass.

### Spike results (2026-09-14)

Both spikes pass, run from the fixture pack's vitest process (in-memory harness setup, checkout packages resolved from source).

**A. Dependency runtime in vitest.** default-setup's `dist/runtime/index.cjs` loaded with `require` under a `Module._resolveFilename` patch. The patch maps every `@apackdev/sdk` subpath, `xstate` and `zod` to the namespaces the test process imported, through `require.cache` entries.
1. **One SDK instance: yes.** `repository.noteCommands.create` (registered by the runtime through host `registerPack`) wrote a Note that test code read back with `untypedQuery`.
2. **One xstate: yes.** The runtime's `settings` system machine spawned under a test-code parent registered as `bus`. `CLIENT_CONNECTED` made it send `SETTINGS_LOADED` to that parent.
3. **Optional peers: all 24 SDK subpaths imported in the checkout** (`ai` is installed there). The runtime is built with `packages: 'external'` (`dev-build.mjs`), so every npm package it uses must resolve from the test process. Here only `bufferutil` didn't, and a stub that throws on use let the runtime load. In a pack without `ai`, `node-pty`, `playwright`, `croner` and the rest, those resolve to the same throwing stubs.

   Findings that shape the implementation:
   - Bridge `xstate` and `zod` with the SDK. Not bridging them would give the runtime xstate's CJS build next to the test's ESM build.
   - Stub a dependency runtime's unresolvable npm modules. The module stays loadable, and the error names the module when it's used.
   - Call the runtime's `setCompiledDir` with its cached dir.
   - `@apackdev/sdk/inference` must not import `ai` at module scope (Decision 7's seam), so the harness can import it in a pack without `ai`.
   - default-setup's systems need the `version` host module and a `bus` actor as soon as they start.

**B. Bus core.** The fixture's `memos` system, spawned by a machine registered as `bus` that routes `INCOMING` to `system.get(systemId)` and records `OUTGOING`. `CLIENT_CONNECTED` → `MEMOS_CONNECTED`; `INCOMING ADD_MEMO` → a Memo row and `MEMO_ADDED`. Nothing beyond Decision 3's core was needed.

### Phase 1 — Host pieces

- Extract `createBusMachine` into `@apackdev/host`, with `api/src/systems.ts` composing on top. Behaviour stays unchanged.
- Move `SDK_BRIDGE` and `withHostResolution` into `@apackdev/host/packs`, with `api/src/packs/pack-loader.ts` passing its SDK namespaces.
- Add the test host modules to `@apackdev/sdk/testing` (Decision 4), plus `entityIds()` and `dropAttribute()`. Run `api:update`.

**Done when:** `bus-client-connected.spec.ts`, the pack-loader and `sdk-bridge-drift` specs and the E2E suite pass unchanged. A `@apackdev/sdk/testing` spec shows `broadcastToSurface`, `rootEvents` and `reportSystemError` working after `startTestRuntime`.

### Phase 2 — Systems

- `setupPackTests({ registration })`: registers the pack's registration and loads each dependency's cached runtime through the bridge (Decision 2). A missing runtime is an error naming the fix (`apack build`).
- `startApp` with `connect`, `send`, `emitted`, `nextEmit`, `settle`, and a stop after each test.
- Add each new export to `harness-requires-source.ts`.
- The fixture pack gains `tests/unit/memos-system.spec.ts`:
  - connect → `MEMOS_CONNECTED` with the written memos;
  - `ADD_MEMO` → a Memo row and `MEMO_ADDED`.

**Done when:** the fixture's system spec passes in `test:external-pack`. A dependency-runtime spec shows a pack depending on default-setup spawning default-setup's `settings` system and reading its connect event. Both are mutation-checked (a dropped bridge entry, a lost `OUTGOING` route).

### Phase 3 — Services and the model seam

- `mockService` (Decision 6).
- `model-provider` host module and the `@apackdev/sdk/inference` resolution through it. The app registers the current providers.
- default-setup's model client moves onto `@apackdev/sdk/inference`.
- `fakeModel` in `@apackdev/sdk/testing`.
- Proofs:
  - `codex-handle-revert` and `handle-fork-stress` run their actions through `services` with `mockService`, replacing their hand-built fakes;
  - an `llm` step test asserts the prompt `fakeModel` received and the output it returned.

**Done when:** those tests pass and are mutation-checked. No unit test imports `ai` or sets an API key. The app still reaches its providers (the E2E suite and a manual chat check against a copy of user data).

### Phase 4 — Flows

- `runFlow` and `flowTrace` (Decision 8).
- The microtask completion for steps without a runtime handler.
- The scheduler seam.
- Proofs:
  - the fixture pack adds a flow (an event trigger, then an action step that writes a memo) and unit-tests it with `runFlow`, on default-setup's brain and steps loaded as its dependency's runtime;
  - `brain-switch-node`, `codex-flow-routing` and `mode-name-routing` run their flows instead of calling a handler with a fake actor or inspecting DSL.

**Done when:** those tests pass and are mutation-checked (a switch branch taken wrongly, a trigger dropped). The brain E2E and the full E2E suite pass with the microtask completion.

### Phase 5 — Move default-setup's tests

- New `tests/setup.ts`, `vitest.config.ts` and `tsconfig.test.json` (Decision 9).
- Relocate the host and CLI tests.
- Move the content-parity harness onto the SDK test helpers.
- Replace every remaining hand-built service fake with `mockService`.
- Extend `check:specifiers` to default-setup's tests.

**Done when:**
- default-setup's suite passes with no `@apackdev/host` import, no API path and no LMDB directory created.
- The relocated tests pass in their packages.
- The `check:specifiers` guard fails on an added `@apackdev/host/ears` import (mutation).

### Phase 6 — Scaffolding and docs

- `apack init`'s `tests/setup.ts` passes `registration`. `apack add feature` scaffolds a system spec on `startApp`.
- `test:packaged-authoring` adds a system test and a flow test against default-setup from the packed tarballs.
- Docs:
  - the `docs/public-facing` testing page: tiers, `startApp`, `mockService`, `fakeModel`, `runFlow`;
  - `@apackdev/testing` CLAUDE.md;
  - default-setup CLAUDE.md;
  - `goal-pack-test-harness.md`'s Deferred list.

**Done when:** a freshly scaffolded pack's system spec passes, `test:packaged-authoring` passes with the new tests, and the docs describe no host init for pack tests.

## Deferred

- FE surface tests on the harness (surface state machines with the recorded bus as their backend).
- Running the real `claude`/`codex` CLIs in harness tests.
- A persistence-backed tier (LMDB in a temp dir) for packs that test restarts.

## Constraints

- Commit as you go in logical chunks, with conventional messages and no Co-Authored-By or Claude-Session lines. Check `git diff --cached` before each commit and commit with `git commit -- <paths>`. Never push or tag.
- Never publish externally: no `npm publish` (use `npm pack` and `--dry-run`), no real GitHub releases. CI workflows may be written, not triggered.
- Never use broad pkill/killall on Electron or node. E2E runs alongside the user's dev and prod apps in the `apack-test` namespace.
- Don't launch the app outside the test environment without isolating `APACK_USER_DATA_DIR`.
- Never run bare tsc on `packages/preload`. Don't run `npm install` in the example pack. Don't edit monorepo version/release metadata.
- Pack code and pack tests import only `@apackdev/sdk`, `@apackdev/ui` and `@apackdev/testing`; `@apackdev/host` stays host-only. The typed EARS types are change-controlled (`packages/apack-sdk/TYPED-EARS.md`).
- `@apackdev/sdk/testing` and the harness are published: no `any` (`published-sdk-any.spec.ts`), TypeScript 5.3 (`packages/internal-typescript-floor`), `api:update` after export changes.
- The CLI suite requires `npm run packages:build` after SDK source changes. default-setup's runtime (`node packages/default-setup/dev-build.mjs`) must be rebuilt before the API suites and E2E.
- Investigate failing tests before changing assertions; mutation-check every new guard, helper and test.
- No backward compatibility: no shims or fallbacks for the old test setup; migrate every in-repo test and fix forward. No polling or hacky workarounds: `settle`, `nextEmit` and `runFlow` wait on actor and brain events, not on timers.
- External packs are first-class. Keep the in-repo fixture pack, the example pack (`/Users/spankyed/Develop/Projects/apack-external/example-pack`) and `test:packaged-authoring` passing throughout.
