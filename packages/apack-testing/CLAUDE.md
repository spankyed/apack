# @apackdev/testing

Reusable Playwright E2E test fixture for apack, a unit test harness for packs' data code, and vitest helpers for unit tests that use apack's on-disk stores. Extracted from the monorepo's test infrastructure so both the host app and external packs share the same test code.

## Architecture

This module (`packages/apack-testing/src/index.ts`) is the single source of truth for the E2E fixture. It exports:

- **`test`** and **`expect`** — Playwright test objects with three custom fixtures (`electronApp`, `appPage`, `app`) pre-configured. Uses auto-detection to find the apack root.
- **`createTest(options?)`** — Factory function returning `{ test, expect }` with explicit configuration (for when auto-detection isn't enough).
- **`AppDriver`** — TypeScript interface for the `app` fixture's high-level API.

### How the monorepo uses it

The repo's own E2E imports it the same way a pack does:
```ts
import { test, expect } from '@apackdev/testing';
```

Every spec (`tests/e2e/{smoke,app-integration,ui}/*.spec.ts`) imports `@apackdev/testing` directly. `@apackdev/testing` is the `packages/apack-testing` workspace package, and its entries resolve its built bundle under every condition — so the repo's own E2E runs the same fixture a pack does, and `npm test` runs `packages:ensure` first to build it from the checkout's current sources.

### How external packs use it

External packs add `@apackdev/testing` and `@playwright/test` as devDependencies (`apack pack init-tests` does this) and import directly:
```ts
import { test, expect } from '@apackdev/testing';
```

## Playwright configs (`@apackdev/testing/playwright`)

A pack's Playwright configs are calls to a helper, not copies of one — the same answer `definePackTestConfig`
gives for vitest, for the same reason. There were six copies (the repo's own E2E config, the one
`apack pack init-tests` scaffolds, both fixture packs', and the drive layer's pair), and the repo's own had
already drifted to a `use` block giving it screenshots and traces the three packs' lacked. Nobody decided
that; it is what six copies do. `@app/repo-checks`' `playwright-config.spec.ts` is the gate.

`definePackE2EConfig` runs one worker per three cores (`e2eWorkers`): each worker launches its own app on its
own temporary data dir, and the app's single-instance lock is scoped by data dir, so workers do not contend.
A run that pins one data dir (`E2E_DATA_DIR`) gets one worker. Tests in one file stay on one worker and share its
app; tests in different files may run at once, so a file must not depend on state another file left.

One helper per kind of run:

| Helper | For | Overrides |
|---|---|---|
| `definePackE2EConfig` | a pack's suite, run by `apack pack test` | anything Playwright takes; the pack's word is last |
| `defineDriveConfig` | driving scripts, run by `npm run dev:drive -- <script>` | the same |
| `definePerformanceConfig` | manual application qualification under `tests/performance`, one owned app and explicit trials | the same; ordinary runs add no retries, trace or screenshot overhead |

A question attaches to an existing app and needs no runner. Performance qualification launches an owned
app under a separate manual config so ordinary E2E collection does not turn measurements into clock gates.

- **`timeout` in `definePackE2EConfig` has to stay a literal.** `suite-timeouts.spec.ts` reads a config's
  timeouts as text rather than importing one (importing creates a temp data dir), follows the delegation to
  this module and holds the value to the large size budget. It reads **one helper's body**, not the file,
  because a neighbour declaring `timeout: 0` made reading the file whole report the root suite's as 0ms.
- **The helpers take the caller's word last**, because nothing reads their settings back. The rule for which
  settings a helper may lock is **the ones the tool or its own docs read back**, and neither helper has
  any such setting.

## Vitest: isolated data dirs (`@apackdev/testing/vitest`)

`definePackTestConfig` writes Vite/Vitest cache output under `.apack/tests/vite`. Keep runner output
there: creating `node_modules` after a build changes recorded negative dependency lookups and makes a
prebuilt pack correctly refuse freshness validation.

Unit tests that open EARS or the media store need `APACK_ENV` and `APACK_USER_DATA_DIR`. `isolatedDataDir(prefix)` creates a throwaway data dir for the run and returns the vitest settings that use it:

```ts
import { defineConfig } from 'vitest/config';
import { isolatedDataDir } from '@apackdev/testing/vitest';

const dataDir = isolatedDataDir('my-pack-tests-');

export default defineConfig({
  test: {
    env: dataDir.env,                                          // APACK_ENV=test, APACK_USER_DATA_DIR=<run dir>
    globalSetup: dataDir.globalSetup,                          // gives workers the project root; removes the run dir when the run ends
    setupFiles: [...dataDir.setupFiles, './tests/setup.ts'],   // first: each worker uses <run dir>/worker-<n>
  },
});
```

The run's dir is named `<prefix><pid>-XXXXXX`; `isolatedDataDir` first removes dirs with its prefix whose process is gone, left by runs that crashed before their teardown. The per-worker split matters when spec files run in parallel: without it, a spec resetting the media store deletes another worker's files mid-test. The entry uses only Node built-ins (`src/vitest.ts`, `vitest-worker.ts`, `vitest-teardown.ts`), so it loads without the `@apackdev/source` condition. The bundle ships the three as separate entries, since vitest loads the worker and teardown modules by path. The global setup also `provide`s the vitest project's root (`PROJECT_ROOT_KEY`), which the harness `inject`s to find the pack. A pack's config sets no `resolve.conditions`: a pack resolves the `@apackdev` packages' published `dist` whether they came from the registry or a checkout link, so there is nothing to select, and `check:specifiers` fails a pack config that declares the `@apackdev/source` condition. This is the config `apack pack init` scaffolds (`apack-cli/src/commands/init.ts`). default-setup's `vitest.config.ts` uses `isolatedDataDir` and is a pack config too: it also declares no condition, and `npm run typecheck:pack` and `npm run test:external-pack` run `packages:ensure` first so the `dist` it reads is current.

## Keeping a checkout's packages current

A pack loads the `@apackdev` packages' built `dist`, and in a checkout that `dist` is built on demand, so
something has to bring it up to date before a pack's code compiles or runs against it. One rule decides
that — `@apackdev/host/build/packages-built`, the fingerprint-and-stamp freshness check — reached through
several entry points. They are not competing mechanisms. They are two kinds, and each covers a way in
that the others don't. This table is the record, because most of the doors are npm scripts and JSON
carries no comments.

**Fixers** run before the process starts, so they rebuild and carry on.

| # | Door | Covers | Where |
|---|---|---|---|
| 1 | `npm run packages:ensure &&` in a root script | a repo command: `test`, `test:headed`, `test:explorer`, `test:external-pack`, `typecheck`, `typecheck:pack`, `build:default-setup`, `api:update` | root `package.json` |
| 2 | that workspace's `pretest` | `npm test -w @apackdev/cli`, `-w @app/default-setup` and `-w @app/repo-checks` run directly, which no root script wraps | each package's `package.json` |
| 3 | `ensureCheckoutPackages(packRoot)` | `apack pack build`, `apack pack test`, `apack pack dev` — from any directory, for a pack whose packages are a checkout's | `apack-cli/src/build/checkout-packages.ts`, called from `commands/{build,test,run}.ts` |
| 4 | the `Build publishable packages` step | CI, whose typecheck step already built them through `typecheck:pack` | `.github/workflows/ci.yml` |

**Checkers** run inside a process that has already started, where the modules are loaded and rebuilding
mid-run would be wrong. All they can do is fail, and say what to run.

| # | Door | Covers | Where |
|---|---|---|---|
| 5 | `assertCheckoutPackagesFresh()` | a pack author's bare `npx vitest` or `npx playwright test`, with no CLI in front of it | `src/checkout-freshness.ts`, called from `setupPackTests` and the `electronApp` fixture |
| 6 | a throw while the module loads | a spec that reads the built packages run without its `pretest` (`npx vitest`, a watch run): `@app/publish-checks`' specs and `@app/repo-checks`' `published-sdk-peers` | `packagesBuiltOrRefuse()` in `@apackdev/host/build/packages-built`, called from `apack-cli/tests/helpers/published-packages.ts` and the spec |
| 7 | the same throw, in a report generator | `api:check`, which reads the built declarations and is a chain step — so it must not rebuild them, where `api:update` is a command a user runs and carries door 1's prefix | `scripts/api-reports.ts` |
| 8 | the same throw, in a verification step | `packages:check`, which reads the five staged trees and is a chain step, so it must not rebuild them either. Every caller already builds first — the chain orders it after `packages:ensure` through the outputs it declares, and both workflows build in the step before — so what this catches is a by-hand run against a tree the sources have moved past, which the guides already told the reader to build first. A gate that reports the published packages fine about a tree it did not verify is the silent green `ALLOW_UNBUILT`'s comment records | `scripts/packages-check.ts` |

Three things follow.

- **A new entry point needs a fixer in front of it, not another copy of the rule.** Every door above calls
  the same check; what differs is only when it runs and whether it can repair what it finds.
- **A fixer belongs to the command a user runs, not to a function a watch loop calls.** `apack pack dev`
  rebuilds the pack through `build()` on every file change, and the check reads every source of all five
  packages, so `apack pack build` refreshes in `buildCommand` while `build()` stays clean. Both placements
  are pinned by `apack-cli/tests/build/checkout-packages.spec.ts`.
- **A checker must not try to repair, but waiting is not repairing.** Its process has already resolved and
  loaded modules; a rebuild underneath it would leave half of two builds in memory. So doors 5 and 6 both
  **wait** for a build in flight and then re-read (`waitForPackageBuild`), and neither starts one: a build
  removes each stamp before rewriting it, so one running beside a check makes its packages read as unbuilt,
  and a check that runs as a spec file loads runs whenever the scheduler happened to start it. Door 5
  reported that instead of waiting until 2026-10-08, which failed a chain run about the race rather than
  the code — two pool steps each ensure the packages, so one can build while the other's first spec loads.
  What is still named is a holder that outlasted the bound, which is a wedge rather than a queue.

One path is deliberately not in the table twice. `npm run dev` reaches door 3, because its
dev launcher builds the built-in pack with `apack pack build --skip-fe`, and that command ensures —
so the script carries no prefix of its own. For a full app build, run `npm run build:default-setup` before
`npm run build:runtime`; `build:default-setup` ensures the package bundles before building the built-in pack.

For an installed pack there is no checkout above it, every one of these is a no-op, and what npm
delivered is what there is.

### What a running dev app does and doesn't pick up

`npm run dev` leaves two halves of the built-in pack on different clocks, and knowing which is which saves
an afternoon.

**Follows your SDK and UI source, live.** The renderer's Vite config declares the condition
(`resolve.conditions` and its `ssr` twin), so editing `@apackdev/sdk`, `@apackdev/ears` or `@apackdev/ui`
source hot-reloads the browser with no build step. The API's tsup build declares it too
(`esbuildOptions.conditions`), and built-in packs' backends are bundled into the API, so the pack's
running code follows source as well.

**Frozen at the moment the command ran.** Everything `apack pack build` produced for the pack, because a
pack build resolves the packages' `dist`: the compiled content (`*.content.json`), the facade types
(`dist/types/pack-types.d.ts`), the step build and the content runtime (`dist/build/`). `npm run dev` builds
those once, through door 3, and nothing rebuilds them while the app runs.

The one that bites in practice is the facade. `packages/default-setup/tsconfig.json` declares no
condition — it is a pack config — so **your editor type-checks default-setup against the packages'
`dist`**. Change an SDK type and the editor keeps showing the old one until something rebuilds it. Any
command with a door does (`npm run typecheck`, `typecheck:pack`, `build:default-setup`), or `npm run packages:ensure`
on its own. This is the cost single mode trades for: a pack, the built-in one included, compiles against
the layout a pack author has, and in a checkout that layout is only as current as the last build.



## Unit test harness (`@apackdev/testing/harness`)

The shell composes native frontend fixture declarations before registering its surfaces through the real
host admission API. Supply real machines and component stand-ins; string components or casts concealing
incomplete surfaces do not satisfy the frontend contract. The SDK native fixture helper supplies only
module-target placeholders for declaration data, never executable fallbacks in the production registry.

A pack's unit tests run its code without the app: content, repositories and content writers against an in-memory EARS, and with `registration` its systems, services, steps and flows, all including its dependencies' behaviour. The registered packs are the test file's own: `harness.ts` creates a registry (`createPackRegistry()` from `@apackdev/host/packs`) per test file, registers the pack and its dependencies in it with no guard against an earlier registration, binds it for the SDK's lookups and hands it to `startApp` (`setAppPacks`). `apack pack init` scaffolds the setup (`vitest.config.ts` with `isolatedDataDir`, `tests/setup.ts` passing `contentRuntime` and `registration`, an example content test); `apack pack add feature` scaffolds a system test, adding `tests/setup.ts` (and `vitest.config.ts` when vitest has no config, devDependencies) to a pack without it. Published declarations import only published packages (`Message` from `@apackdev/sdk/events`, never `@apackdev/host`). Pack-facing guide: `docs/public-facing/testing.md`.

- **`setupPackTests({ contentRuntime, registration?, appliers?, packDir? })`** — from a vitest setup file. `packDir` defaults to the nearest `apack.json` at or above the injected vitest project root (else the working directory).
  - Starts `@apackdev/sdk/testing`'s runtime (`startTestRuntime`), which creates and binds an EARS engine over a temporary elmdb database (`createEarsEngine`; `resetTestData` before each test binds a fresh one) checking the SDK's, the host's (`AppState`, `@apackdev/host/app-state`), pack's and dependencies' entity types, and the in-memory app it binds (`@apackdev/sdk/src/testing/host.ts`): `testRootEvents` as the bus behind `broadcastToSurface`/`sendToSystem`/`onConnected`/`onIncoming`, loggers and `onLog` (each log event printed to the console), the `SYSTEM_ERROR` events `reportError` sends (recorded for `takeSystemErrors`), version `0.0.0-test`, `appData` (reset, and `hasOnboarded`/`completeOnboarding` over the host's `AppState` row, as in the app), a run history in memory, emptied by `resetTestData`, `secrets` (metadata only, emptied by `resetTestData`), and an `inference` that fails until a test mocks it with `mockInference`.
  - A test that needs a database of its own (tooling, a compiler) creates it with `createEarsEngine` from `@apackdev/ears` and passes it where the API takes one (`exportFlowsToDSL(dir, { engine })`), leaving the bound engine alone.
  - Binds it (`bindHost`) with `packs`: the test file's registry, with the current test's `mockService` mocks over its services (`@apackdev/sdk/testing`'s `testPacks` stand-in sits over it).
  - Data tier (no `registration`): registers each dependency's `build/content-runtime.mjs`, then the pack's own content runtime with its `appliers`, in the registry, each as a registration (entity types, repositories, content writers, appliers).
  - Runtime tier (`registration`): reads each dependency's `.apack/deps/<id>/resolution.json`, verifies its immutable complete build through the shared host cache reader, then loads that build's `runtime/index.cjs` with `src/dependency-runtime.ts`, points it at `runtime/content`, and registers it and the pack's registration (which carries the pack's appliers) in the registry.
  - Before each test it empties the database and media store, and fails a concurrent test that can run alongside another (vitest runs a suite's consecutive concurrent children together; a lone `it.concurrent` passes): the database, mocks and apps are per file.
  - After each test it stops apps, clears mocks, and fails the test on system errors the test didn't take; every step runs even when an earlier one throws.
- **Dependency runtimes load on the pack's SDK.** `withModuleBridge` (`@apackdev/host/packs`, shared with the API's pack loader) maps every export of the shared-instance packages (`@apackdev/sdk`, `@apackdev/ears`: `sharedInstanceSpecifiers` from `@apackdev/host/build/shared-deps`), `xstate` and `zod` to the namespaces the test process imported. A subpath whose optional peer isn't installed maps to a module that throws on use. npm packages the runtime keeps external that the pack doesn't install (default-setup's `node-pty`, `playwright`, …) load as modules that throw on use.
- **`importContent({ keys?, mode? })`** — compiles the chosen content sources (by default every entry naming a format and no pack applier) with `compilePack` (with the registry's steps as its definitions), registering tsx's loader while the SDK's compilers import pack TypeScript (`#generated/*`), and writes them with `importCompiledContent`. Returns the counts of the compiled keys.
- **`startApp({ systems })`** (`src/app.ts`) — the named registered systems under `@apackdev/host/bus`'s `createBusMachine` (the API's bus core), on `testRootEvents`.
  - Members: `connect`, `send`, `emitted`, `nextEmit` (5 s default), `settle`, `runFlow` (10 s default), `flowSteps`, `system`, `watchView`, `viewStats`, `stop`. Bare system ids resolve as given, then as `<packId>.<id>` for the pack under test; an external dependency's systems need their full bus id.
  - `watchView(feature, view, args?)` subscribes to a feature's view as a window's `useView` does, over the test file's view host (`createViewHost` from `@apackdev/host/views`, created by `setAppPacks` on the bound engine, which a test's reset replaces); each call is one subscriber, so two stand in for two windows, and the app's stop ends them. The harness's shell client subscribes to the same host, so a component's `useView` and a spec's `watchView` share watches as two windows would.
  - `connect` sends `CLIENT_CONNECTED` and then `SEND_STATE` to every running system, as the app's bus does: the test bus sets no `clientLoadedPacks`, so no pack waits for `PACK_CLIENT_CONNECTED`. `send` routes whether or not a client connected. `broadcastToSurface` goes through the bus (`OUTGOING`; the bus hears it through `testRootEvents.onSurfaceSend`), delivered only once connected, so `emitted` holds nothing sent before a client connected (`apack-cli/tests/harness/dependency-runtime.integration.spec.ts`).
  - Events for systems (client events, `sendToSystem`, `fire` steps, schedule ticks) reach them from `startApp`, as in the app; only sends to surfaces wait for a client (`connect`, or `CLIENT_CONNECTED` from any app's `connect`, which reaches every running bus). The bus's state (`awaitingClient`, `clientSeen`) is its own.
  - The first app to start (none running) calls every registered pack's `lifecycle.onInit` (the registry's `getLifecycleHooks`, registration order: dependencies first) before its bus starts, as the API does at boot after loading the packs and before starting the systems. A failing `onInit` shuts the packs down again and fails `startApp`.
  - `stop` stops the bus, rejects pending waits with "The test app stopped" (marking in-flight calls handled, so a wait nobody awaits isn't an unhandled rejection), and, once no app runs, calls every registered pack's `lifecycle.onShutdown`, as the API does when it tears a pack down. So each test's apps run between one `onInit` and one `onShutdown`. Stopped actors never reach their own cleanup (default-setup's `killBrain`), so module-level state (cron jobs, ad-hoc brain listeners, the flow actor registry) is cleared there: default-setup's `features/hooks.ts` (whose `onInit` ensures the Settings entity, safe on each test's emptied database).
  - After `stop`, `connect`, `send`, `nextEmit`, `settle` and `runFlow` reject with "The test app stopped" (already handled, so `void app.nextEmit(…)` isn't an unhandled rejection) and `system` throws it; `emitted` and `flowSteps` still read what the app recorded.
  - `settle` waits zero-delay timer turns until xstate's inspection reports no activity.
  - `runFlow` and `flowSteps` drive default-setup's brain (designated `brain`). The brain runs the declared root flow (`root: true`, imported with `importFlows` or written) from `startApp`, and subflows it spawns. `runFlow` never grants the root role or restarts the brain: it sends `TRIGGER_BRAIN_EVENT` (global, as a client does) and waits on the brain's `RUN_NODE_SPAWNED`/`RUN_NODE_UPDATED` reports for the running flow with that label (root or subflow); without an event, it returns the entry tracks that flow ran. The reports are recorded from the bus's inspection, so trace reports from before a client connected are seen, and `runFlow` doesn't connect the app. `runFlow` returns only the tracks its event triggered; tracks started by their `fire` steps need `settle()` and `flowSteps`. Steps whose runtime sets `waits` (keep-alive) count as finished-waiting. Trace node rows are captured as reported, since the brain clears them when it stops. `flowSteps` finds a subflow by its flow's label (the subflow step's `flowRef`). `runFlow`'s timeout covers its sends and settling too.
- **`startShell({ surfaces, defaultSurface?, designations? })`** (`src/shell.ts`) — the host's own shell (`createShellMachine` from `@apackdev/host/fe`, inlined like the rest of the host) with the test pack's surfaces registered in a fresh `createFePackRegistry()`, bound through `startFeTestRuntime` so `openSurface`, `openSurface` and `useShell()` reach it. The SDK reads roles, steps, artifacts and blocks through a bound frontend host whenever one is bound, so the frontend registry it binds answers those from the backend's registered packs first (`backendFirst`), and the pack's systems keep finding the brain and its steps while a shell runs (`default-setup/tests/harness-shell-lookups.spec.ts`). It refuses to start when a frontend host is already bound (`startFeTestRuntime`, or another shell in the test). Surfaces are passed as state machines, since surface modules import `.vue` files. Its `ShellClient` is `testRootEvents`: sends are incoming messages a `startApp` app's bus routes, and outgoing messages reach the surfaces' actors — held from the client's creation until the shell subscribes, because over the in-memory bus a surface asking for its data as it's spawned is answered before the shell's connection listener exists, where a socket would deliver it later. It connects at once (with a `CLIENT_CONNECTED` for the shell), loads no external pack frontends, stores nothing, and records what it would tell the user in `notices`. The harness stops shells after each test (`stopRunningShells`), before apps. Proofs: `tests/packs/external-pack/tests/features/memos/fe/shell.spec.ts` (opening by name with events, `useShell()` reading it, a refused ref, a surface's round trip to its system) and `default-setup/tests/features/logs/fe/link-navigation.spec.ts` (the Logs link opening Settings on the Logs surface, with the app's settings system running).
- **`resetTestData()`** — the SDK's (a fresh engine, the secrets emptied; registrations, repositories among them, stay) plus the media store, which is what a test between tests expects; the harness calls it before each test, and a test rewriting mid-run calls it itself. **`testMediaPath(entityId?)`** names that store, or one row's folder in it, for a test asserting on written media — the paths themselves are the app's (`_getMediaPath`), which is why they live here and not in a pack.
- **`takeSystemErrors()`** — re-exported from `@apackdev/sdk/testing`: return and clear the `SYSTEM_ERROR` events systems reported (`message`, `source`, `stack`, …). A test that leaves one fails with `<source>: <message>`.
- **Exported types:** `PackTestOptions`, `ImportContentOptions`, `ContentRuntime`, `StartShellOptions`, `TestShell`, `TestSurface`, `StartAppOptions`, `TestApp`, `FlowRun` (`eventRunNodeIds`, `steps`), `FlowRunStep`, `RunFlowOptions`, `SurfaceEvent`, `Message`.
- **`importFlows(dsl)`** — compiles flow DSL (steps name the SDK's actions and prompts by label) and imports it through the SDK's `flowRepository`, as the flow applier does; `root: true` declares the root flow the brain starts with. It needs no dependency on default-setup.
- **`registerPack(registration)`, `unregisterPack(packId)`** — another pack in the test file's registry, as the app registers an installed one (its commands, feature settings, appliers, …); default-setup's `library-commands`, `pack-settings-defaults` and `content-parity/edited-flows` specs use it.
- **`getTestSettings()`** — the active test's host settings administration for fixture setup and assertions.
  Use `forPack(id)` to exercise a registered fixture pack's caller policy; ordinary pack code continues to
  use generated settings handles. Host data replacement fixtures use `whileReplacingData` so reads,
  mutation refusal and feature notifications follow the real replacement lifecycle. Throws outside a test.
- **`mockService(name, impl)`** — overlays a service in `services` for the current test; it throws outside a test (`beforeAll`, module scope), where the mock would lapse after the first test.
- **`addTestSecret(provider, label)`** — stores a key's metadata (no value) in the test host's in-memory `services.secrets`, by the host's selection rules; emptied with the rest of the test data.
- **`mockInference(reply, replies?)`** — mocks `services.inference` for the current test with `fakeInference(reply, replies)` (text, agents, and `embedding`, `image`, `speech`, `transcript` and `relevance` replies; `calls` kinds `text`, `embedding`, `image`, `speech`, `transcription`, `reranking`) (`@apackdev/sdk/testing`) and returns the fake, whose `calls` a test asserts.
- **One SDK and engine instance.** The harness imports `@apackdev/sdk` and `@apackdev/ears` externally (the published bundle keeps the shared-instance packages external for this entry and declares them peer dependencies; `scripts/bundle-package.ts` `sharedExternalEntries`) and inlines `@apackdev/host`, so its registrations are the ones the pack's code and dependency runtimes see. `setupPackTests` first checks that the pack's `@apackdev/ears` is the copy its `@apackdev/sdk` loads (`src/shared-ears.ts`, `apack-testing/tests/shared-ears.spec.ts`): with versions that don't match, npm nests another copy under the SDK, the test runtime would install its engine there, and the pack's code would find none; the harness fails naming both copies, or asks to install `@apackdev/ears` when the pack has none. It then calls `assertCheckoutPackagesFresh` (`src/checkout-freshness.ts`), which fails naming `npm run packages:ensure` when this bundle is older than the checkout's sources — a stale bundle would load and silently test the previous `@apackdev/host`, which it inlines. For an installed package there is no checkout above it and the check is a no-op (`apack-testing/tests/checkout-freshness.spec.ts`, and `checkout-packages.spec.ts` for the checkout a pack's packages come from).
- **The content runtime facet** (`src/__generated__/content-runtime.ts`, bundled by `apack pack build` into `dist/build/content-runtime.mjs` with only the shared-instance packages, `@apackdev/sdk` and `@apackdev/ears`, external) holds the pack's entity types, relation kinds, repositories and content writers. Everything it imports must load in a plain Node process: no `@apackdev/host` (rejected at build), no native modules, no optional SDK peers. `apack pack build` checks this for every pack (`apack-cli/src/build/content-runtime-check.ts`).
- **Proofs:**
  - `tests/packs/external-pack` unit-tests its memo content, its memos system, a memo flow on default-setup's brain, its `lifecycle.onInit`/`onShutdown` pair around a test's apps (`boot-hooks.spec.ts`), and the harness's isolation (mocks, waits and calls ended by stop, events for systems before a client connects), run by `test:external-pack`.
  - `default-setup/tests/harness-app-stop.spec.ts`: a real schedule (an action step) ticks while its app runs and stops with it.
  - `apack-cli/tests/harness/harness-setup.integration.spec.ts`: `vitest run --root <pack>` from elsewhere, tests that run concurrently rejected (a lone concurrent test isn't), a second `setupPackTests` in one process (vitest `isolate: false`) rejected naming why, `apack pack add feature` adding the setup to a pack without one.
  - `apack-cli/tests/commands/scaffold-unit-test-setup.spec.ts`: that setup keeps any config vitest loads (`vitest.config.*`, `vite.config.*`), adds `@apackdev/testing` at the pack's `@apackdev/sdk` range (the two release at one version, and `@apackdev/testing` peers on `^<version>`), and names the upgrade for an `@apackdev/testing` without `./harness` or off the SDK range, or a vitest before 3.
  - `test:packaged-authoring` also type-checks the packed declarations with `skipLibCheck: false`, failing unless tsc checked the probe and every error is in other packages' declarations.
  - `apack-cli/tests/harness/dependency-runtime.integration.spec.ts` runs default-setup's systems, and the app's settings beside them, from a dependent pack.
  - `test:packaged-authoring` runs a system test, a service test with structured output and an `llm` flow, with `inference` mocked by `mockInference`, all from the packed tarballs.
  - default-setup's own unit suite runs on the harness.

**What a pack's suite pays for the harness, and where that cost is.** Measured 2026-10-02 on
`@app/default-setup` (95 spec files, 765 tests, load average 6.56): vitest reported `setup 100.69s` against
`tests 14.17s`, 115s of CPU in all. Of that, `setupPackTests` itself is **24-56ms per file** — timing the
call, and then keeping the setup file's imports while skipping it (25.49s against 26.34s over 18 files). So
~97% is the setup file's **module evaluation**, once per file because `isolate: true` gives each file a fresh
module graph, which is the isolation the harness requires: it keeps one registry, database and set of mocks
per file and throws if called twice in a process. Deferring the imports into the call moves that work rather
than removing it, since the call is what uses those modules.
[`goal-unit-suite-cost.md`](../../docs/archive/goals/goal-unit-suite-cost.md) closed on this measurement; the
reason to care is `npm run spec` and a warm chain, never a cold one, whose critical path runs elsewhere.

**Where that ~97% goes, and two ways of removing it that do not work.** Re-measured 2026-10-06 by timing
each import in the setup file separately (one spec file, 1.56s of setup):

| phase | per file |
|---|---|
| evaluating the `@apackdev/testing/harness` bundle | 755ms |
| `pack-entry.ts` — the pack's whole `PackRegistration` | 461ms |
| `content-runtime.ts` | 297ms |
| `setupPackTests()` running | 33ms |

So it is about half the harness bundle and half the pack's own graph, and the two are separate levers. Ruled
out, each by measurement rather than argument:

- **`isolate: false`** is not available: the harness throws on a second `setupPackTests` in a process and the
  message says why. It is a correctness boundary, not a performance knob.
- **Letting Vite prebundle or externalise `@apackdev/testing`** (`server.deps.external`, and the
  `deps.optimizer.ssr` variant) does not help. Whole-suite A/B: `setup` 115.5s against 121.5s, wall 17.4s
  against 18.2s — slightly worse both ways, and the optimizer form fails to build at all on the optional
  peers. The guess behind it was that a workspace symlink is re-evaluated per file where an external dep
  would be cached per worker; whatever the mechanism, the number says no.
- **The per-file checkout assertion is not the cost.** `assertCheckoutPackagesFresh` reads as a likely
  culprit — it fingerprints the build units on every file — and `stalePackageUnits()` measures **20ms**,
  about 2% of a file's setup. (Assumed ~300ms from `packages:ensure`'s warm figure, wrong by 15x.)

**And the condition for caring is the critical path, not the ratio.** 89% overhead is the most alarming
number in the repo and buys nothing: `npm run chain -- --dry --all` prints the path, `test:unit:pack` is not
on it, and halving this saves zero chain wall and about a second of `npm run spec`. Revisit when the step
appears on that path — not when the ratio worsens, which it will as default-setup grows.

The one thing left to measure, if that loop ever matters more: this file imports `@apackdev/sdk/build`
statically for content compilation most spec files never reach (`compilePack`, `resolveContentSources`, `compileFlowDSL`,
at the content helpers), but `readDependencies` reaches the same module on *every* setup through
`_snapshotFormatMismatch` and `_cliFormatMismatchMessage` — two format checks, not compilers. Moving those
two to a leaf module would let the rest load only where a test compiles content. `@apackdev/sdk/build` is 238ms
as a standalone import in a fresh process; what it costs *marginally* inside a worker that has already loaded
the SDK was not measured, and is probably well under that. Measure before moving anything.

## A session over the app something else is holding (`src/engine/`)

`npm run dev:drive -- --eval` asks one question of the app `apack pack dev` is holding, and `attachedSession`
(`engine/index.ts`) is what it asks through. **It is assembled from the same four pieces a launched session
is** — the page, the app helper over it, the session's own connection to the API, and the log — so
`createSession` cannot tell which it was given, which is the property the whole design rests on.

Three modules, and the split is what each one is allowed to know:

- **`session.ts`** — the verbs, over two narrow ports: a `SessionPage` for what needs the window and a
  `SessionApi` for what goes over the bus. Neither touches Playwright's or tRPC's types, so every verb is
  exercised in process against a fake rather than by launching Electron. The two evaluation forms are
  separate methods on purpose: Playwright reads a string as an expression and a function as something to
  serialise, and a string *with* an argument silently drops the argument.
- **`api-client.ts`** — the session's own connection to the app's API, and the reason the bus verbs do not
  travel through the page. Zero dependencies: Node has had a global `WebSocket` since 22. tRPC's frames are
  written by hand, so the version they were read at is recorded in the header and
  `tests/engine/api-client.spec.ts` pins each shape against a real `applyWSSHandler` — the three that are
  one mistake from a hang rather than an error each have a case.
- **`cdp-page.ts`** — the attach. `_electron` has no `connect`, which is where *"whoever launches owns the
  page"* came from; an Electron renderer is Chromium, so `chromium.connectOverCDP` attaches to one started
  with `--remote-debugging-port` and hands back a real `Page`. `playwright-core` is a lazily imported
  optional peer that throws with the install when absent — and `_chromium` takes its loader as a
  **parameter**, because that is the only way the hint has a case: the package resolves in any install that
  can attach at all, so nothing else can make the import fail. `findWindow` takes the target with
  `window.applicationState` and **never `pages()[0]`** — a connected app has more than one, and
  `tests/engine/cdp-page.spec.ts` holds that against a fake presenting several, because the end-to-end
  assertion passes with the predicate replaced by "take the first".

Things worth knowing before changing it:

- **Two capabilities an attached session does not have, and neither is faked.** There is **no window**, so
  `setViewport` sets the emulated viewport rather than moving one somebody is looking at — the right answer
  for a connection that did not open it. And there are **no historical renderer errors**: a listener wired
  on connect sees everything from then on, where the fixture's array goes back to the launch.
- **`/query` and `/transact` go over the bus**, to default-setup's `EXECUTE_QUERY`/`EXECUTE_TRANSACTION`,
  which run against the live engine with every installed pack's entity types. So a write is visible to the
  next read — which `apack db exec` cannot do, since it refuses while the app holds the write lock.
- **A write is visible to the next read and not to the UI, and `/reload` is the difference.** A surface's
  state is what its system sent it, so a write that goes round every system reaches no view. Navigating
  between surfaces does not refresh one — the actor survives — while a new connection does, because the bus
  asks every system to publish (`SEND_STATE`). `/reload` is that connection. It must not be
  `window.location.reload()`: the app blocks renderer-initiated navigation (`BlockNotAllowdOrigins`,
  `packages/main`), so that call returns having done nothing.
- **An answer arrives addressed, and is still matched by the call its ask was sent under.** The session
  claims `host/drive` and stamps `sender` on every bus send, so a system's `reply` comes back on this
  connection rather than to every window — which is what stops a person querying in the Database surface
  from being mistaken for the session. But addressing answers *which connection*, never *which ask*: the
  call is what tells concurrent asks apart. It rides on the envelope (`Message.call` out,
  `Message.answering` back) and never in the event.
- **What the page bridge cannot carry is an uncorrelated answer.** A broadcast answers no call, so an app
  that answers by broadcasting rather than replying cannot be matched however it is delivered — the
  round-trip timeout says so rather than leaving it to be discovered. An app built before `host/drive`
  existed does exactly that, which is what a stale build looks like from here.
- **`/wait` is the fixture's own wait**, so a state is awaited rather than re-requested. Without it the only
  way to wait is to ask `/state` repeatedly, which is the polling this repo avoids.
- **`/set-setting` is a round trip, not a send.** It resolved as soon as the API accepted the send, so a
  write the store refused answered `ok: true` and wrote nothing — and the refusal went to the Settings
  surface, where the session could not see it. The settings system answers its sender now
  (`@apackdev/host`'s `features/settings/be/answer.ts`), so the verb waits for
  `SETTINGS_SAVED`/`SETTINGS_REFUSED` by the id it minted.
- **`/screenshot` refuses a name that is not a name.** It is the one verb whose input becomes a path, and
  `app.screenshot` joins it onto the screenshots directory, so `../../escaped` wrote outside it.
- **`/eval` is total.** `page.evaluate` returns only structured-cloneable values, so the clone is attempted
  in the page and a result that cannot survive it — a state machine, say — comes back described, with its
  keys and the instruction to return `JSON.stringify(...)` instead. The body is a function *body*, so one
  without a `return` answers no value.
- **Two questions at once are ordinary, and the claim is what makes that work.** `host/drive` is claimed
  per connection and a second live claim is *refused*, which is right — two drivers must not receive each
  other's answers. But every claim is now a question's, held about a second, so `_claimDrive` waits out a
  holder for 10s before giving up. Waiting never takes a live claim; it waits for one to end, and a claim
  still held after the window is a driver genuinely running, which the refusal says.
- **A step that fails after the attach closes what is already open** (`_closingOnFailure`). A handle left
  open does not fail, it *hangs*: Node keeps running while one is, so a refused claim printed its reason to
  stderr and the process sat there for ever — measured still running 25s later, which reads as the verb
  hanging rather than as a refusal that was reported.
- **`/drops` and `/errors` read *and clear*.** The fixture throws on any dropped send left after the body,
  which suits a test; a long session would collect every drop and fail at the end over ones already read.
- **`/events` is capped** (`MAX_SEEN_EVENTS`) and reports what it dropped. The in-page inspector sees all of
  the app's traffic, so a buffer nobody drains grows for as long as the session is up.

## Setup for external packs

```bash
cd /path/to/my-pack
apack pack init-tests    # playwright.config.ts + tests/e2e/smoke.spec.ts; adds @apackdev/testing + @playwright/test
npm install
apack pack test          # a Beta matching your hostVersion, or --host <path>
```

No monorepo checkout, `APACK_HOST_ROOT`, symlinks or PATH changes are needed.

## Which app the tests run in

`apack pack test` (source: `packages/apack-cli/src/commands/test.ts`, `src/app/`) resolves the app, in order:

1. `--host <path>` — a local apack checkout (installed and built)
2. `--host beta` — a compatible cached/downloaded apack Beta release (from `spankyed/apack` releases) whose version satisfies the pack's `hostVersion`. The zip is verified against its published `.sha256` and cached per version in the CLI cache dir (`~/Library/Caches/apack-cli/apps/beta/<version>` on macOS). macOS arm64 only.
3. `APACK_HOST=beta` (the env form of `--host beta`, for CI), then `APACK_HOST` — a local checkout
4. A compatible cached/downloaded Beta, as `--host beta` would

**It reads no machine state and never asks**, which is what makes a test run mean the same thing on a
fresh machine as on one you have been developing on. It also derives nothing from where the pack sits,
where `apack pack dev` and `npm run dev:drive --` do (the checkout behind the pack) — holding that is their job.

It then runs the Playwright CLI that the pack's `@apackdev/testing` resolves (never `npx playwright`), so the runner and the fixture share one `@playwright/test`. It passes the fixture:

- `APACK_HOST_ROOT` (checkout) or `APACK_HOST_EXECUTABLE` (packaged app, e.g. `apack Beta.app/Contents/MacOS/apack Beta`)
- `PACK_DIR` — the pack directory
- `APACK_CLI` — its own bin, which the fixture uses to build the pack
- `NODE_OPTIONS` without `--conditions=@apackdev/source`: the runner, the fixture and the app it launches all load the `@apackdev` packages' built `dist`, as a pack does. `apack pack test` first runs the checkout's `packages:ensure` when the pack's packages are a checkout's (`apack-cli/src/build/checkout-packages.ts`), so that `dist` is the checkout's current sources; the Playwright and vitest entries check it again themselves for a run started directly.

Every non-Playwright arg is forwarded (`apack pack test -g "renders"`, `apack pack test smoke`).

## How the fixture finds apack

Importing helpers and registering fixtures does not require a built app. The `electronApp` worker
resolves and validates its host before creating test data or launching; `fixture-registration.spec.ts`
checks both registration without a host and refusal before launch.

The fixture honors the CLI's resolved `APACK_HOST_EXECUTABLE` or `APACK_HOST_ROOT`. Explicit `createTest({ appExecutable })` / `createTest({ appRoot })` options must identify that same host when a handoff is present. Standalone fixtures can select a host through those options, then fall back to the monorepo enclosing `@apackdev/testing` (auto-detected by walking up to `packages/entry-point.mjs`). A checkout is validated first (`packages/entry-point.mjs`, `node_modules/electron`, `packages/main/dist`, `packages/renderer/dist`) so a stale or unbuilt checkout gets a clear list of what's missing.

## Fixture lifecycle

### Worker setup (`electronApp` fixture, shared across tests)

0. **Isolated data dir** — every worker creates a fresh temp dir (`$TMPDIR/apack-e2e-*`) and launches the app with `APACK_USER_DATA_DIR` pointing at it. Nothing leaks between runs, other installed packs never load, and the developer's `apack-test` dir is untouched. The dir is removed after the worker finishes (`E2E_KEEP_DATA=1` keeps it and logs its path). Boot time is unchanged (~1.4–1.9s launch → connected, logged as `[e2e] app connected …`).

1. **Pack build/install** (if `PACK_DIR` is set):
   - Parse `apack.json` from `PACK_DIR` → extract pack `id` and `surfaceIds`
   - Always rebuild the pack with `apack pack build` (a stale `dist/` would otherwise be tested silently), including while `apack pack dev` runs for that pack: its marker means a dev server is up, not that `dist/` is current (N4 in `docs/archive/issues/postmortem-external-pack-calendar-extraction.md`). `PACK_ARCHIVE` skips the build and installs that packed `.tgz` as it is, so a run can exercise the build a release ships (`tests/scripts/test-packaged-authoring.sh` step 8), and is compared against the local build's verified published-file hashes when `dist/` exists; that build's recorded inputs must remain current through installation. Without local `dist/`, the explicitly selected archive is verified and installed without source freshness comparison; `--release` requires a local release build for comparison. Everything else still comes from `PACK_DIR`
   - Install it into the worker's data dir with `installPackFromLocal()` — the same stage → verify → place bundle path users get — passing `hostVersion`: the launched app's version (`src/app-version.ts`: the checkout's `package.json`, or the packaged app's `Resources/app/package.json` / `resources/app/package.json`), so a pack whose manifest `hostVersion` excludes it fails to install
   - `--prebuilt` (`APACK_PACK_PREBUILT`) skips compilation, verifies the sealed output and replays its completed source/dependency observations through `src/prebuilt-pack.ts`. The recorded compiler/execution context belongs to that build, not the Playwright process. `APACK_PACK_RELEASE` additionally requires the recorded `--release` option. Missing output, modified bytes and changed inputs refuse before app startup; timestamps do not establish freshness. `tests/prebuilt-pack.spec.ts` covers these boundaries.
   - It passes no `packFormat`. Whether the app can read a pack's build is the app's to decide, and it decides at boot, naming which side is older; the fixture reports that verdict (step 6) instead of forming its own. It has no way to form one: the app's `host.json` is written at its first boot, after this install, the CLI running the fixture needn't be the app's, and inferring the app's format from a build it ships (a built-in pack's snapshot) refuses good packs whenever that build is the stale one. `packs/runtime/load-messages.spec.ts` pins that a refusal reaches the fixture as a line it matches
   - Build uses `APACK_CLI` (set by `apack pack test`), else the `@apackdev/cli` the pack resolves, else the checkout's; it runs as `node <bin> build`
   - After the app connects, the fixture fails the test if the pack's installed-packs entry has a `lastError` (its data failed to write)

2. **Launch Electron** — for a checkout, resolves `electron` from the checkout's `node_modules` and calls `_electron.launch({ executablePath, args: [appRoot], cwd: appRoot })`; for a packaged app, launches its executable with no args. Packs never need `electron` installed. The env (`src/launch-env.ts`) is the runner's without `ELECTRON_RUN_AS_NODE` (set when the app-bundled `apack` runs on the app's runtime; inherited, it would start Electron as plain Node) and without the `@apackdev/source` condition in `NODE_OPTIONS`, plus `PLAYWRIGHT_TEST=true`, which makes the app use the `test` environment (a packaged beta included), and `APACK_USER_DATA_DIR`.

3. **Debug logging** (if `DEBUG_E2E=1`): pipes Electron's stdout/stderr to the test terminal with `[electron]` prefix
4. **A log file, always**: the same output goes to `app-<workerIndex>.log` in Playwright's `outputDir` —
   `.apack/tests/results/` under `apack pack test`, `.apack/drive/results/` under `npm run dev:drive --`. Playwright wipes that
   directory at the start of every run, so it is always the last run and never an archive. It is what a
   fixture failure now names, in place of asking for a re-run under `DEBUG_E2E`; the app's own
   electron-log files live in the data dir, which an ephemeral drive session deletes on the way out.

### Test setup (`appPage` fixture, per test)

4. **Find main window** — polls Electron windows for `window.applicationState` (the XState actor). Distinguishes the main renderer from the splash screen. 45s timeout. Sets the viewport to 1400×900.

5. **Wait for connected state** — checks `applicationState.getSnapshot().value` for `{ running: 'connected' }` or onboarding state. Bypasses onboarding via `window.__disableOnboardingUI()` if detected.

6. **Pack backend check** (if `PACK_DIR` is set) — waits for the loader's verdict on the pack, read from the app's output. Those lines are a contract, `PACK_LOAD_MESSAGES` in `@apackdev/host/packs`, imported by both the loader that writes them and this fixture, so a reword is a change to both. It is the only signal a backend-only pack leaves: it registers no surface, and the loaded packs the renderer is served leave out packs with no frontend files.
6. **Pack surface waiting** (if `PACK_DIR` is set) — for each surface ID from the manifest, waits for it to appear in `applicationState.getSnapshot().context.surfaces`. A `console.error` listener detects `[pack-loader] Failed to load FE entry pack://<packId>/...` for the pack under test and fails the test immediately with the captured renderer and Electron/API errors, instead of timing out. A surface that never registers also fails with those errors attached.

### Test setup (`app` fixture, per test)

7. **Provide AppDriver** — wraps the page with high-level methods (`navigate`, `screenshot`, `getState`, etc.). Screenshots go to the resolved `screenshotDir`.

### Teardown

- Per-test: `pageerror` and `console` listeners are removed. A test that failed while the app's API restarted under
  it (the API's pid in its `api-port` file differs from the test's start) gets an `api-restarted` annotation and an
  `[e2e]` line naming both pids: the window reconnects and the shell replaces every surface's actor, which resets
  what their components held, so that restart is the cause to read first
  ([reconnect without remount](../../docs/archive/plans/reconnect-without-remount.md)). A test that passed through one is
  left alone
- Per-worker: `electronApp.close()` shuts down Electron. The fixture captures the API pid before close and fails if that child is still alive afterwards; Electron quit must finish API shutdown before fixture-owned data can be cleaned up.
  For a data dir the fixture made, it waits for Electron's `will-quit` (emitted once the API server's
  `before-quit` handler has stopped the API) and then kills Electron rather than waiting for Chromium to write
  a profile it is about to delete: under load those writes held exit past Playwright's 60s worker teardown
  ([the evidence](../../docs/references/evidence/build-input-snapshot-proof.md#electron-exit-hang-in-linked-worktrees-2026-10-25)).
  A dir the caller gave (`E2E_DATA_DIR`) is relaunched on, so its close still waits for the profile.

## API reference

### Fixtures

| Fixture       | Scope  | Description |
|---------------|--------|-------------|
| `electronApp` | worker | Launched Electron app (shared across tests in a worker) |
| `appPage`     | test   | Main renderer Page (waits for `running.connected`, bypasses onboarding) |
| `app`         | test   | `AppDriver` — high-level API |

### AppDriver methods

| Method | Description |
|--------|-------------|
| `screenshot(name)` | Save PNG to screenshots directory as `{name}.png` |
| `navigate(surfaceId)` | Send `SELECT_SURFACE` event, wait for `activeSurface` match, 500ms render delay |
| `getState()` | Returns `snapshot.value` (e.g. `{ running: 'connected' }`) |
| `getContext()` | Returns `{ activeSurfaceId, surfaceIds }` |
| `sendEvent(event)` | Send any event object to `applicationState` |
| `report(name, value)` | Write `.apack/drive/results/{name}.json` and print one `[drive:report] {name} {json}` line, for a driving run whose answer is meant to be read by a program rather than watched. Returns the path |
| `waitForState(check, ms?)` | Wait for dot-separated state path (e.g. `'running.connected'`), default 10s |
| `waitForSurface(surfaceId, ms?)` | Wait for a surface to appear in the surface list, default 30s |

### `createTest(options?)`

Factory for when auto-detection isn't enough:

```ts
import { createTest } from '@apackdev/testing';

const { test, expect } = createTest({
  appRoot: '/custom/path/to/apack',      // select a host for a standalone fixture
  screenshotDir: './my-screenshots',            // override screenshot output directory
});
```

## Screenshots

Screenshot output location depends on context:

| Context | Screenshot directory |
|---------|---------------------|
| `screenshotDir` option passed | The specified directory |
| `E2E_SCREENSHOT_DIR` is set | That directory — how `npm run dev:drive --` keeps its output in `.apack/drive/screenshots/` rather than under `tests/`, since the option cannot reach the `test` a script imports |
| `PACK_DIR` is set | `{PACK_DIR}/.apack/tests/screenshots/` |
| Default | `{cwd}/.apack/tests/screenshots/` |

## Environment variables

| Variable | Description |
|----------|-------------|
| `APACK_HOST_ROOT` | A built apack checkout to launch. Set by `apack pack test` for checkouts; auto-detected inside the monorepo. |
| `APACK_HOST_EXECUTABLE` | A packaged apack executable to launch. Set by `apack pack test --host beta`. |
| `APACK_CLI` | The apack bin that builds the pack. Set by `apack pack test`. |
| `APACK_HOST` | `beta`: `apack pack test` and `apack pack build` use the newest matching apack Beta (CI; the scaffolded release workflow sets it). |
| `PACK_DIR` | Path to an external pack directory. Triggers build/install and surface waiting. |
| `PACK_ARCHIVE` | A packed `<id>-<version>.tgz` to install instead of building `PACK_DIR`, so the run tests what a release ships. When local `dist/` exists, verifies its recorded inputs and requires matching published-file hashes at installation acceptance. Without it, verifies the selected archive independently; `--release` requires local release output for comparison. |
| `E2E_KEEP_DATA` | Set to `1` to keep each worker's temp data dir for debugging. |
| `E2E_DATA_DIR` | A data dir the caller owns and keeps, used instead of the per-worker temp one and never cleaned up. Set by `npm run dev:drive --` for a profile. **`apack pack test` strips it** (`fixtureEnv`), so a pinned run cannot be aimed at a directory by the shell it was started from. |
| `E2E_SCREENSHOT_DIR` | Where `app.screenshot()` writes, ahead of the `PACK_DIR` and cwd fallbacks. Set by `npm run dev:drive --` to `.apack/drive/screenshots/`, and stripped by `apack pack test` for the same reason. |
| `E2E_REPORT_DIR` | Where `app.report()` writes, ahead of the same two fallbacks (`.apack/drive/results/`). Set by this repo's `drive` scripts and stripped by `apack pack test`, for the reason the two above are: the run decides where its output lands, not the shell that started it. |
| `PLAYWRIGHT_TEST` | Set automatically to `'true'` by the fixture. The app resolves the `test` environment (`apack-test` name, lock and data dir), crashes on uncaught errors, and runs headless (suppresses window display and splash screen). |
| `APACK_USER_DATA_DIR` | Optional. Overrides the app's data dir (e.g. an isolated temp dir); read through `@apackdev/sdk/env`. |
| `DEBUG_E2E` | Set to `1` to pipe Electron stdout/stderr to the test terminal. |

## Running tests

```bash
apack pack test                          # a Beta matching the pack's hostVersion
apack pack test --host ~/apack  # a local checkout
apack pack test --host beta               # the newest matching apack Beta
apack pack test -g "renders"             # Playwright args are forwarded
```

From the apack monorepo, run Playwright directly (the app is auto-detected):

```bash
npm run test:e2e                                     # monorepo E2E
PACK_DIR=/path/to/my-pack npm run test:e2e -- tests/e2e/scratch
```

## Key implementation details

- **Electron binary resolution**: for a checkout the fixture uses `createRequire(appRoot + '/package.json')` to resolve `electron` from its `node_modules`; a packaged app is its own executable. Packs don't need `electron` installed.
- **App root validation**: `validateAppRoot()` checks for `packages/entry-point.mjs`, `node_modules/electron`, `packages/main/dist`, and `packages/renderer/dist` before attempting to launch. Missing files produce a clear error listing exactly what's needed, rather than an opaque Electron crash.
- **Data dir alignment**: The fixture installs into `resolveAppEnvironment({ env: 'test', userDataDir: userDataDir }).packsDir` for the worker's temp dir and passes that dir as `APACK_USER_DATA_DIR`. The Electron app launched with `PLAYWRIGHT_TEST=true` infers the `test` environment in `packages/main/src/app-context.ts`, which sets the app name and `userData` from the same resolver (`@apackdev/sdk/env`) and passes `APACK_ENV` / `APACK_USER_DATA_DIR` to the API process, so both sides always agree.
- **Pinned viewport**: the fixture sets the main window viewport to 1400×900. The window's default size depends on whether main was built in dev or production mode, so without this, layout and `toHaveScreenshot` baselines differ between `npm run dev` builds and `npm run build:runtime`/CI.
- **Pack manifest caching**: `getPackManifest()` reads and parses `apack.json` once per process, cached at module scope. Surface IDs are the keys of `features` entries with a `surface` (the manifest's `surface` has no `id`).
- **Dev server marker**: `apack pack dev` writes `{devUserDataDir}/pack-dev-servers/{packId}.json` containing `{ port, pid }` for the dev app's HMR. The E2E fixture ignores it: tests always run a fresh build in an isolated data dir.
- **`pack://` protocol**: Custom Electron protocol (`packages/main/src/modules/pack-protocol/PackProtocol.ts`) that reads the marker through `devServerUrl` (`@apackdev/host/packs/dev-server`) and proxies to the Vite dev server if present, otherwise serves files from disk.


### Shutdown sampling

`DEBUG_E2E=sample` enables the existing lifecycle diagnostics and, on macOS, captures a two-second
native sample if the fixture's own Electron process still has not exited five seconds into teardown.
The sample is written beside its `app-<worker>.log`. It changes no close timeout or test assertion;
normal test runs do not invoke the sampler. This distinguishes a live native shutdown stall from an
application that exited while its driver is waiting for another resource.


## Performance reports (`@apackdev/testing/performance`)

Node-only tooling for owned application qualification: bounded recording schemas, completion integrity,
raw-sample summaries, balanced comparison order, manifest compatibility, source/build/native identity
and Chrome Trace conversion. The manual scenarios live in the application's `tests/performance/` suite;
ordinary unit tests enforce these reporting contracts without launching an app or gating on timings.
