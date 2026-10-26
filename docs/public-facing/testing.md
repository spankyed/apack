# Testing a pack

A pack has two kinds of tests:

- **Unit tests** (`npm test`, vitest) run your pack's code without the app, through `@apackdev/testing/harness`: content and repositories, systems, services and flows, with your dependencies' behaviour.
- **E2E tests** (`apack pack test`, Playwright) run your pack in apack, UI included. See the `@apackdev/testing` fixture (`apack pack init-tests`).

This page covers unit tests.

Pack E2E results and screenshots default to `.apack/tests/`; driving logs, reports and screenshots use
`.apack/drive/`. Keep custom generated output under `.apack/` too: this work directory is excluded from
authored build inputs, so running a test does not invalidate the pack's source identity. Explicit
Playwright output options and screenshot/report overrides still choose their own destinations.

## Setup

`apack pack init` scaffolds `vitest.config.ts` and `tests/setup.ts`:

```typescript
// vitest.config.ts
import { definePackTestConfig } from '@apackdev/testing/vitest';

export default definePackTestConfig();
```

That one call is the whole config. It gives you:

- **A throwaway data dir per run**, one subdir per worker. The harness fails without `APACK_USER_DATA_DIR`,
  and a per-worker split is what stops one spec's reset deleting another worker's files mid-test.
- **`include: ['tests/**/*.spec.ts']`**, because a spec's path mirrors the source it covers, less `tests/e2e/`
  (Playwright's, run by `apack pack test`) and `tests/_support/` (helpers and fixtures, not specs).
- **A stub for your `.vue` files**, so `vitest related` and `--changed` can walk your pack's module graph.
  Without it they stop at the first SFC they reach, which is any pack with a surface. Your specs can import a
  surface module and read everything but the component; rendering one throws and says how to enable it.
- **`globals: true`**, and timeouts that match what a pack's unit tests are allowed.
- **No `resolve.conditions`** — and you should not add any. A pack's tests resolve its `@apackdev` packages
  exactly as `apack pack build` does, to the `dist` each published package ships, which is the one layout a pack
  ever has. There is nothing to select.

What you may pass it:

| Option | For |
|---|---|
| `dataDirPrefix` | naming the run's temp dir, so leftovers say which suite made them |
| `vue: true` | compiling and rendering your components instead of stubbing them. Install `@vitejs/plugin-vue` |
| `surfaces`, `exclude`, `setupFiles` | anything your pack needs on top |

- **Keep vitest's `isolate` on** (the default). The harness keeps one registry, database and set of mocks per
  test file, and `setupPackTests` fails, saying so, when it runs a second time in one process (`isolate: false`).
- **`isolatedDataDir(prefix?)`** is still exported, for a config `definePackTestConfig` cannot express. Keep
  its `env`, `globalSetup` and `setupFiles` if you assemble one by hand, with its setup files before yours.

```typescript
// tests/setup.ts
import { contentRuntime } from '#generated/content-runtime.ts';
import { registration } from '#generated/pack-entry.ts';
import { setupPackTests } from '@apackdev/testing/harness';

await setupPackTests({ contentRuntime, registration });
```

- **What's registered:** your entity types, repositories, content writers and appliers, and, with `registration`, your systems, services, steps and feature settings. Each dependency's full backend runtime (its systems, services and steps, on your pack's `@apackdev/sdk`) is registered too.
- **Without `registration`**, only data code runs: each dependency contributes its content runtime (entity types, repositories, content writers). Pass your appliers (`import { appliers } from '#generated/appliers.ts'`, `setupPackTests({ contentRuntime, appliers })`) for `importContent`; a registration carries its own. These tests start faster and never load a dependency's runtime.
- **The registered packs are the test file's own:** the harness registers your pack and its dependencies in a registry it creates for the file, which the SDK's lookups (`getDesignated`, `stepRegistry`, `services`, …) read. To test how your pack reacts to another pack (its feature settings or appliers), register one with `registerPack({ id, features: { … }, … })` from `@apackdev/testing/harness`, and `unregisterPack(id)` when done.
- **A lookup filled directly:** for what no pack registers (a step type or designation only one test needs), fill `testPacks` from `@apackdev/sdk/testing` (`steps`, `designations`, `artifacts`, `blocks`, `services`, `content.writers`, `appliers`); its entries are found before the registered packs'. Empty it with `testPacks.clear()`.
- **Run `apack pack build` once first**, so dependencies are fetched into `.apack/deps/`.
- **Source tests need current generated entries, not a bundle of the pack itself.** The harness validates
  `apack.json` and checks its declaration identity against the generated registration and content runtime.
  Run `apack pack generate-entries` after declarations change. Dependencies still use their checked cached
  snapshots and compiled runtimes. Declared settings remain available independently of which systems a test starts.
- **The pack is found** at or above the vitest project's root (`--root`, `test.root`, a workspace project's directory), which `isolatedDataDir()`'s `globalSetup` passes to the harness; pass `packDir` to `setupPackTests` to name it yourself.
- **Each test starts from an empty database** (a fresh EARS engine, your repositories still registered; no secrets or media). Apps a test starts stop after it; service mocks last one test. `resetTestData()` does the same mid-test: a fresh engine, the secrets emptied and the media store cleared; registrations stay. `testMediaPath(entityId?)` names the media store (or one row's folder in it) for a test that asserts on written media.
- **The engine is the harness's.** Everything your code reaches through `#generated/ears`, `#generated/repository` and `@apackdev/sdk/ears` acts on the engine the harness bound. Code tested without the harness (a helper over the engine) can create its own with `createEarsEngine` from `@apackdev/ears` and call it directly ([Engine instances](services-and-data.md#engine-instances)). Install `@apackdev/ears` at the version your `@apackdev/sdk` uses: when they differ, npm gives the SDK its own copy, and `setupPackTests` fails naming both.
- **Tests in a file run one at a time.** The database, service mocks and apps are shared by a file's tests, so a test that runs alongside another (`it.concurrent`, `describe.concurrent` or `sequence.concurrent` next to another concurrent test) fails. Spec files still run in parallel, each in its own worker.
- **A system error the test didn't expect fails it.** Take expected ones with `takeSystemErrors()` from `@apackdev/testing/harness`: it returns the `SYSTEM_ERROR` events systems reported with `reportError` (without `step`) since the last call (`message`, `source`, `stack`, …), and clears them. Logs from `createLogger` print to the console and reach `onLog` subscribers, as in the app.
- **A pack scaffolded before the harness** (no `tests/setup.ts`) gets it from `apack pack add feature`, with the system test it scaffolds. A vitest config the pack has (`vitest.config.*` or `vite.config.*`) is kept: add the harness setup to it as the command prints. `@apackdev/testing` is added at your `@apackdev/sdk` range (they're released together); when your `@apackdev/testing` has no harness or your vitest is older than 3, the command prints the `npm install` that upgrades them.

## Content

```typescript
import { importContent } from '@apackdev/testing/harness';
import { query } from '#generated/ears.ts';

it('content notes', async () => {
  expect(await importContent({ keys: ['team-notes'] })).toEqual({ 'team-notes': { created: 1, updated: 0, skipped: 0 } });
  expect(query('Note').pickAll()).toHaveLength(1);
});
```

`importContent({ keys?, mode? })` compiles your content sources (your formats and your dependencies') and writes them. Without `keys` it content every entry naming a format and no `applier`. Name `actions`, `prompts` and `flows` to write those, before running flows.

Generated `ContentRuntime` types come from `@apackdev/sdk/framework`. Data-only setup binds the pack's
content facet (entities, relations, repositories, writers and supplied source appliers), checked against
its manifest. It activates no backend systems or services. Passing the generated backend `registration`
selects backend testing; that binding must match the manifest's complete feature and provided-API list.
Both modes retain settings declarations without opening the Settings page.

## Systems

`startApp` runs registered systems under the same bus the app uses, and plays the client:

```typescript
import { importContent, startApp } from '@apackdev/testing/harness';
import { repository } from '#generated/repository.ts';

it('stores a memo a client adds and sends it back', async () => {
  const app = await startApp({ systems: ['memos'] });
  await app.connect();                                             // CLIENT_CONNECTED then SEND_STATE, as a client connecting
  expect(await app.nextEmit('memos', 'MEMOS_CONNECTED')).toMatchObject({ memos: [] });

  await app.send('memos', { type: 'ADD_MEMO', text: 'hello' });   // as a client's sendToSystem does
  expect(await app.nextEmit('memos', 'MEMO_ADDED')).toMatchObject({ memo: { text: 'hello' } });
  expect(repository.memoQueries.all()).toHaveLength(1);
});
```

| Member | What it does |
|---|---|
| `startApp({ systems })` | Starts the named systems in registration order; `'*'` starts all. A bare id is tried as given, then as your pack's `<packId>/<featureId>`: use your feature ids, a built-in dependency's feature ids (default-setup's `notes`), or an external dependency's full bus id (`<depId>.<featureId>`) |
| `connect()` | Sends `CLIENT_CONNECTED` and then `SEND_STATE`, which reach every running app, as a client connecting does. Every running system gets them (the harness has no client that loads pack frontends later), and sends to frontend surfaces are delivered from then on. Events for systems don't wait for it: client events, and the events systems, steps and schedules send (`sendToSystem`, `fire`, schedule ticks), reach them from `startApp`, as in the app |
| `send(systemId, event)` | Sends a system an event, connected or not |
| `emitted(surfaceId?)` | Events sent to frontend surfaces (`broadcastToSurface`). Both go through the bus, as in the app, so one sent before `connect()` is dropped and never appears here (systems send their startup data once a client connects, so `connect()` first) |
| `nextEmit(surfaceId, type, { timeoutMs? })` | The next such event no earlier call returned, waiting for it (default 5000 ms) |
| `settle()` | Resolves once the systems have no work left |
| `system(systemId)` | A running system's actor |
| `watchView(feature, view, args?)` | Subscribes to one of a feature's [views](services-and-data.md#views) as a window does: `updates` holds what it delivered, `next()` waits for the next one (default 5000 ms), `stop()` unsubscribes. Each call is its own subscriber, so two stand in for two windows; subscribers asking for the same view and arguments share one read, as in the app. A `startShell` shell's `useView` subscribes through the same views |
| `viewStats()` | How many distinct views are running, and how many subscriptions share them |
| `stop()` | Stops the systems and ends the app's view subscriptions; pending and later `connect`, `send`, `nextEmit`, `settle` and `runFlow` calls fail with "The test app stopped", and so does `system`. `emitted` still reads what was sent. Once no app runs, each registered pack's `boot.onShutdown` runs, as when the app stops a pack, so what pack modules keep outside their systems (default-setup's cron jobs and brain listeners) doesn't reach the next test. The harness stops apps after each test |

**Boot hooks run around a test's apps.** The first app a test starts runs each registered pack's `boot.onInit` (your dependencies' first) before its systems start, as the app does at boot, and the last one to stop runs `boot.onShutdown`. A pack that opens something in `onInit` and closes it in `onShutdown` gets that pair for every test that starts an app.

`apack pack add feature` scaffolds a system test like this for each feature.

## Frontend

`startShell` runs the app's own shell with your surfaces registered, so surface code that navigates, reads the shell's
state or sends to its system is tested as the app runs it. Pass each surface's state machine rather than its surface
module: the module imports `.vue` components, which a unit test doesn't load.

```typescript
import { startApp, startShell } from '@apackdev/testing/harness';
import { openSurface } from '#generated/fe.ts';
import memosState from '../../src/features/memos/fe/state.ts';
import notesState from '../../src/features/notes/fe/state.ts';

it('opens memos with an event', async () => {
  const shell = await startShell({ surfaces: { notes: { state: notesState }, memos: { state: memosState } } });
  openSurface('memos', { type: 'MEMOS_CONNECTED', memos: [] });
  expect(shell.opened()).toBe('my-pack/memos');
});

it('reaches its system and hears back', async () => {
  const app = await startApp({ systems: ['memos'] });
  await app.connect();
  const shell = await startShell({ surfaces: { memos: { state: memosState } } });
  shell.surface('memos').send({ type: 'MEMOS.ADD', text: 'hello' });
  await app.settle();
  expect(shell.surface('memos').getSnapshot().context.memos).toHaveLength(1);
});
```

| Member | What it does |
|---|---|
| `startShell({ surfaces, defaultSurface?, designations? })` | Starts the shell with `surfaces` (by feature id: each one's `state`, and anything else of its definition the test needs) registered as your pack's, opens `defaultSurface` (the first listed when unset), and binds the frontend host, so `openSurface`, `openEntity` and `useShell()` reach it. Its client is the harness's bus: what surfaces send reaches a `startApp` app's systems, and what those systems send surfaces reaches your surfaces' actors. It resolves once the shell is connected |
| `opened()` | The ref of the surface open |
| `surface(name)` | A surface's running actor, named as your pack names it |
| `notices` | What the shell told the user went wrong (a surface it couldn't open, say), in order |
| `actor` | The shell's actor |
| `stop()` | Stops the shell and unbinds the frontend host; the harness stops shells after each test |

`startShell()` verifies the built pack once per test-file setup and reuses its captured entity destinations. Missing builds or declarations that differ from the manifest fail explicitly; run `apack pack build` before shell tests.

Start one shell per test, in place of `startFeTestRuntime`: it binds the frontend host itself, and refuses when one is already bound. Your systems' lookups (roles, steps) still see everything your pack registered while it runs. `useShell()` runs in a component's setup or an effect scope (`effectScope().run(() => useShell())` in a test).

## Services

`services` (from `#generated/services`) contains your pack's own services, the SDK baseline, and host/dependency APIs selected by `consumes.services`. `mockService` replaces one for the current test. The inference example requires `host/inference`:

```typescript
import { mockService } from '@apackdev/testing/harness';
import { services, type Services } from '#generated/services.ts';

it('digests a note, with only the inference call it makes mocked', async () => {
  mockService<Services, 'inference'>('inference', { generateText: async () => ({ output: { summary: 'Buy milk' } }) } as never);
  expect(await services.digest.digest('Remember to buy milk')).toEqual({ summary: 'Buy milk' });
});
```

When testing a dependency's internal use of its own service, type its mock with that provider's generated contract, for example `import type { Services as DefaultServices } from '#generated/deps/default-setup'` and `mockService<DefaultServices, 'scheduler'>(...)`. A test double does not grant the consuming pack access to that service.

Give only the members the code under test uses. A mock lasts for the test it's made in: make it in the test or a `beforeEach` (`mockService` fails in `beforeAll` or at the top of a file). Code that imports a service module directly, instead of using `services`, isn't affected. Mock services that reach outside the process (CLIs, the network) in any test that runs code using them.

With `host/secrets` declared in `consumes.services`, `services.secrets` works in unit tests, in memory and emptied before each test: store a key's metadata as Settings → Secrets would with `addTestSecret(provider, label)` from `@apackdev/testing/harness` (the first key for a provider is selected). Keys have no values in tests.

For host settings fixture setup and assertions, `getTestSettings()` from the harness returns the active
test's settings administration. `getOverrides()` inspects explicit stored choices; `getAll()` reads
effective values. Use `forPack(id)` when testing a fixture pack's read/write/reset policy. Pack source
uses generated settings handles. A mocked reset or import that replaces data must run its replacement
inside `getTestSettings().whileReplacingData(...)` to exercise the real notification lifecycle.

## Models

Unit tests never reach a provider: `services.inference` (and so the `llm` step) fails until the test mocks it. `mockInference` does that for one test with a fake that runs the AI SDK's real calls on a scripted model (`fakeInference` from `@apackdev/sdk/testing`; `ai` comes with `@apackdev/sdk` as a peer dependency):

```typescript
import { mockInference } from '@apackdev/testing/harness';

const inference = mockInference('A short summary');          // or (call) => reply, per language model call
// … run code that calls services.inference …
expect(inference.calls[0]).toMatchObject({ kind: 'text', model: 'anthropic:claude-sonnet-4-5', messages: [{ role: 'user', text: 'Summarize this note: …' }] });

// Other kinds of model answer from the second argument; each has a default
mockInference('unused', { embedding: (value) => [value.length, 0], image: pngBytes, speech: mp3Bytes, transcript: 'Buy milk', relevance: (query, document) => String(document).includes(query) ? 1 : 0 });
```

- **A reply** is text, or `{ text?, toolCalls?: [{ toolName, input }] }`. Tool calls run your tools' `execute`, and the AI SDK calls the model again while `stopWhen` allows, so a function reply can answer tool results with text.
- **Structured output:** reply with JSON; `output` (a spec like `{ type: 'object', schema }` or an `Output`) parses it as it would a real model's reply, and rejects what the schema rejects.
- **Agents** (`createAgent`) run on the same language model: each step is a call, answered by `reply`.
- **Other kinds:** `embedding` (each value's vector, default `[value.length, 1, 0]`), `image` (default a 1×1 PNG), `speech` (default a silent MP3 frame), `transcript` (default `'Fake transcript'`) and `relevance` (each document's score for a `rerank` query, from 0 to 1; by default earlier documents rank higher).
- **`calls`** records each model call in order, with its `kind`. Like a real provider's, a call can take several model calls: one per step for text, chunks of 2048 values for `embedMany`, batches of up to 10 images for `generateImage`.
  - `text`: `model`, `instructions`, `messages` (each message's text; tool calls and results as JSON), `tools` and `stream`;
  - `embedding`: `model`, `values`; `image`: `model`, `prompt`, `n` (this batch's), `size`, `aspectRatio`;
  - `speech`: `model`, `text`, `voice`, `instructions`, `speed`; `transcription`: `model`, `mediaType`;
  - `reranking`: `model`, `query`, `documents`, `topN`.

## Flows

Flows run in unit tests as they do in the app. The brain runs the root flow, the one flow marked `root: true`, when the app starts, and every other flow runs as a subflow something spawned: default-setup's `Root Flow` spawns its long-running work modes, each kept alive by `entry([keepAlive()])`. An event reaches every running flow. Your pack or a dependency (default-setup) must provide the brain and settings systems:

```typescript
import { importFlows, mockInference, importContent, startApp } from '@apackdev/testing/harness';
import { entry, keepAlive, subflow } from '#generated/flow-helpers.ts';

it('summarizes a note', async () => {
  await importContent({ keys: ['prompts', 'flows'] });
  // The app's root flow is default-setup's: host your flow the way it hosts long-running flows
  importFlows({ 'Root Flow': { root: true, tracks: [entry([subflow('Notes Summary')], [keepAlive()])] } });
  mockInference('Buy milk');
  const app = await startApp({ systems: ['brain', 'settings'] });

  const run = await app.runFlow('Notes Summary', { event: 'notes.summarize', data: { text: 'Remember to buy milk' } });

  expect(run.steps).toEqual([expect.objectContaining({ label: 'summarize', status: 'completed' })]);
  expect(run.steps[0].result).toMatchObject({ text: 'Buy milk' });
});
```

- **`importFlows(dsl)`** compiles flow DSL and imports it as the flow applier does. Import before `startApp`: the brain starts the root flow when the app starts.
- **`runFlow(label, { event?, data?, timeoutMs? })`** (default timeout 10 000 ms, covering its sends and settling) sends `event` with `data` as its payload, as a client sends an event to the brain, and waits for the flow labelled `label`, which must be running (the root flow or a subflow).
  - It resolves once every track of that flow the event triggered has finished: steps completed or failed, apart from steps that wait by design (keep-alive).
  - Without `event`, it resolves with the entry tracks the flow ran when it started.
  - It returns a `FlowRun`: `eventRunNodeIds`, the run-history nodes of the tracks the event triggered, and `steps`, the steps those tracks ran in start order, each a `FlowRunStep` (`runNodeId`, `label`, `kind` (`step`, or `flow` for a subflow), `status`, `input` (what the step was given: its settings, and under `params` the inputs it resolved from the event and earlier steps, as its run node records them — a long value is a `{ value, _truncated }` marker) and `result`, what the step returned).
  - It never makes a flow the root flow or restarts the brain; it fails naming the running flows when `label` isn't one.
  - The result holds only the tracks `event` triggered. Tracks started by events those tracks send (a `fire` step, a `TRIGGER_BRAIN_EVENT` sent to the brain's role) aren't in it: `await app.settle()`, then read them with `flowSteps`.
  - It doesn't connect the app: flows run, and events from `fire` steps and schedule ticks reach the brain, without a client. Connect only to read what systems send to surfaces (`emitted`, `nextEmit`).
- **`flowSteps(label)`** returns the steps a flow has run so far in the app, the root flow or a subflow, by the flow's label (not the label of the step that runs it). It still reads after `stop()`: rows are kept as the brain last reported them.
- **Without a root flow** the brain doesn't start: it reports that no flow has the root role when flows exist, and stays stopped with no flows at all.
- **Schedule triggers** register through the `scheduler` service. Mock it (`registerSchedule`, `unregisterByPrefix`, `clearAllSchedules`) and call the tick it receives to run the track. Unmocked, real cron jobs run while the app runs and stop when it stops.

## Exports

`@apackdev/testing/harness`:

- **Setup and data:** `setupPackTests` (`PackTestOptions`), `importContent` (`ImportContentOptions`), `importFlows`, `resetTestData`, `testMediaPath`, `ContentRuntime`, and `registerPack`/`unregisterPack` (another pack in the test file's registry).
- **Frontend:** `startShell` (`StartShellOptions`, `TestShell`, `TestSurface`).
- **Apps:** `startApp` and its types `StartAppOptions`, `TestApp`, `FlowRun`, `FlowRunStep`, `RunFlowOptions` and `SurfaceEvent` (what `emitted` and `nextEmit` return: the event exactly as sent) and `Message` (`{ to, event }`, what the test bus carries).
- **Mocks and host state:** `mockService`, `mockInference`, `addTestSecret`, `takeSystemErrors`, `getTestSettings`.

`@apackdev/testing/vitest`: `isolatedDataDir` (`IsolatedDataDir`).

`@apackdev/sdk/testing`, for the two cases the harness doesn't cover:

- **`startFeTestRuntime(options?)` / `stopFeTestRuntime()`** — a frontend host for a test file that exercises surface code, a text editor extension or a DSL type, which read the bound frontend the way a pack's backend reads the bound app. Bind it once per file and unbind at the end; nothing is registered unless the test passes it, so an extension that registers itself on import is one this returns. It has no app shell: code that reaches the shell fails naming `startShell`, which binds a frontend host with the real one.

  ```typescript
  import { startFeTestRuntime } from '@apackdev/sdk/testing';

  const stopFeTestRuntime = startFeTestRuntime();
  afterAll(stopFeTestRuntime);
  ```

- **`registeredContentKeys(packId)`** (`@apackdev/sdk/utils`) — the content keys a registered pack has appliers for, which are the only keys an import of its content can write. Assert against it when a test needs to know that an applier is registered under the key its content source names, rather than inferring it from a `importContent` count.
