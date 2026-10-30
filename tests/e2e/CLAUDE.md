# E2E Tests

Playwright tests that launch the full Electron app and interact with the XState application state machine. Looking at the app is `drive/`'s job, not this suite's.

## When a test belongs here

**This is not a gate.** It is off `npm run chain`; `npm run chain -- --e2e` includes it when you want it,
and nothing requires it before a merge. It was built to *drive* the app — to look at what you changed, and
to let an agent see what it built — and it spent a while as a chain step without anyone deciding it should
be one. Everything below follows from that.

**Three kinds of test live here, and the directory a spec goes in is the question it answers.** A new one
that fits none of them probably belongs somewhere else.

- **`smoke/` — is it an app at all?** The gate: it launches, connects, has its surfaces, and keeps to its
  own data dir. Its own chain step, and the only part of this suite anything gates on.
- **`ui/` — something you need to see.** Rendered behaviour, which is the founding purpose of the suite.
- **`app-integration/` — something that needs the real process boundary.** A live port, the websocket,
  the CLI against a real data dir, the packaged pack loader. These never assert on the UI at all; they are
  here because an in-memory harness has no port to bind.

A spec that needs a path in the repo resolves it three levels up now (`../../..`), not two — moving these
into folders broke three of them at once, and the suite is what said so.

**Audited against those two halves on 2026-10-08: twelve of the thirteen specs here meet both.** Each
`app-integration/` spec rests on something no harness has — a token-bearing WebSocket, an API process
crashed and restarted, `apack db` against a live data dir, `POST /dev/reload`, `media://`, the bus
dropping sends until a client connects, key strings absent from logs and files — and each `ui/` spec
asserts rendered output, which is the other half: a component reaching for a surface it is not rendered in
(`navigation`), main accepting a ref as a window id (`popout`), a pack's compiled entries reaching the
Settings Help reader (`settings-help`), a panel a surface lends another actually drawing (`fallback-panel`).

**The shape that fails the second half is worth recognising, because it reads like a UI test.** A spec
that sends a surface an event and then asserts *shell state* — which surface is open, what the context holds
— needs no window: the shell's side of that is covered on fakes (`@apackdev/host`'s
`tests/features/application/fe/`) and the pack's side is `setupPackTests` with `startFeTestRuntime`, in
milliseconds. `packages/default-setup/tests/features/browser/fe/open-link.spec.ts` is one written that
way, and being cheap is what lets it assert both branches of the setting it reads rather than the default
alone.

**If it needs neither, it is a harness test.** `setupPackTests` (`@apackdev/testing`) runs a pack's code in
memory in milliseconds; an assertion about state or data that never renders and never crosses a process
boundary pays a full Electron launch for nothing.

**Driving does not belong here at all — it belongs in `drive/`, and it is mainly for you.** Driving is how
an agent debugs and develops against the app: open what you just built, click through it, read the state
back, screenshot it, and find out whether the change worked instead of reasoning about it. A driving
script asserts nothing and nothing gates on it, so `npm run dev:drive` collects it and no test runner does.
A scratch file kept inside `testDir` does not work for this, however it is named and even gitignored: the
suite picks it up anyway. A script graduates into a spec here only when it asserts something a
future change could break **and** it needs the real app. Most driving is neither.

**While working, run the affected spec, not the suite** — `npm run test:e2e -- <spec>`. That was the guidance
before the chain swallowed it, and it is still right: the suite is 21 tests over 14 files on a single
worker, and the one you changed is the one that tells you anything.

## Quick start

```bash
npm run test:e2e                              # All tests
npm run test:e2e -- smoke                    # One directory: smoke, ui, app-integration
npm run test:e2e -- ui/popout                # One file
npm run test:e2e -- -g "renderer error"      # By test name grep
DEBUG_E2E=1 npm run test:e2e                  # Electron process output to terminal
```


## Rules for agents

- **Never kill processes by broad pattern** (`pkill -f Electron`, `pkill -f node`, `killall Electron`, …). The user runs dev and prod apack alongside tests, and a broad kill takes those down. If a test run hangs, stop only the process you started (its PID).
- **E2E runs alongside dev and prod apps.** Tests use the `apack-test` app name and a fresh temp data dir per worker (`$TMPDIR/apack-e2e-*`, via `APACK_USER_DATA_DIR`), so no running app needs to be closed first. Don't claim otherwise — just run the tests.
- **Investigate a failing assertion before changing it.** Find out why it fails (`DEBUG_E2E=1`, `app.getContext()`, probing actor state with `appPage.evaluate`) and fix the cause. Loosening one to go green once removed the only backend check and hid the real cause (docs/archive/issues/postmortem-external-pack-calendar-extraction.md, item 1).
- **The app under test is built, not source.** `npm run test:e2e` does not rebuild it, so a backend edit is not in
  the run until `npm run build:api`. See [Debugging the running app](#debugging-the-running-app), which also
  covers instrumenting a path and getting the output back.
- **Each worker starts from an empty data dir, but tests in a worker share it.** Anything a test creates is visible to later tests in the same run; assert on unique values and clean up what you create. `E2E_KEEP_DATA=1` keeps the dir for inspection.

## How the fixture works

The test infrastructure lives in `@apackdev/testing` (source: `packages/apack-testing/src/index.ts`), and every spec imports it directly — the same line a pack author writes. A local re-export stood in front of it until it was removed: it forwarded three names and added nothing, while putting this suite one indirection away from what `apack pack init-tests` scaffolds.

### Startup lifecycle

When a test worker starts, the fixture runs this sequence:

1. **Resolve the app** — `resolveTestHost()` (when `createTest()` runs, at import) honors the CLI's resolved `APACK_HOST_EXECUTABLE` / `APACK_HOST_ROOT`; explicit fixture options must agree. Standalone fixtures may select `appExecutable` or `appRoot`, then fall back to the checkout enclosing `@apackdev/testing`. Executables must exist; source checkouts must have `packages/entry-point.mjs`, `node_modules/electron`, and main/renderer `dist` outputs.

2. **Pack setup** (only when `PACK_DIR` is set):
   - Read `apack.json` from `PACK_DIR` to get the pack ID and surface IDs
   - Always rebuild the pack with `node <apack bin> build` (the bin is `APACK_CLI`, else the `@apackdev/cli` the pack resolves, else the checkout's)
   - Install it into the worker's temp data dir with the pack installer (stage → verify → place), passing the launched app's version (the checkout's `package.json`, or the packaged app's `Resources/app/package.json`) so a pack whose `hostVersion` excludes it fails to install

3. **Launch Electron** — for a checkout, resolves `electron` from the checkout's `node_modules` (so external packs don't need `electron` installed) and launches `_electron.launch({ executablePath, args: [<appRoot>], cwd: appRoot })`; a packaged app launches its executable with no args. The env is the runner's minus `ELECTRON_RUN_AS_NODE` (inherited from an app-bundled `apack`, it would start Electron as plain Node) and minus the `@apackdev/source` condition in `NODE_OPTIONS`, plus `PLAYWRIGHT_TEST=true` and `APACK_USER_DATA_DIR=<worker dir>` (`src/launch-env.ts`). `PLAYWRIGHT_TEST` selects the `test` environment, a packaged build included; the app runs headless (no window display or splash screen) and crashes on uncaught exceptions.

4. **Find main window** — `findMainWindow()` polls all Electron windows for `window.applicationState` (the XState actor exposed on the renderer's `window`). This distinguishes the main renderer from the splash screen. Timeout: 45s. The viewport is then pinned to 1400×900, since the window's default size differs between dev and production builds of main.

5. **Wait for connected state** — `page.waitForFunction()` checks `applicationState.getSnapshot().value` for `{ running: 'connected' }` or `{ onboarding: ... }` (45s). If onboarding is detected, calls `window.__disableOnboardingUI()` then waits for `running.connected`.

6. **Check the pack's applying** (only when `PACK_DIR` is set) — if the pack's entry in the test data dir's `installed-packs.json` has a `lastError` (its data failed to apply), the fixture fails with it.

7. **Wait for pack surfaces** (only when `PACK_DIR` is set) — For each surface ID from the manifest, waits for it to appear in `applicationState.getSnapshot().context.surfaces`. If the renderer logs `[pack-loader] Failed to load FE entry pack://{packId}/…` for the pack under test, the test fails immediately. That failure, and a surface that never registers, include the captured renderer errors and Electron/API error lines, so `DEBUG_E2E=1` is rarely needed to find the cause.

8. **Provide the `appPage` and `app` fixtures** to the test.

### Teardown

After each test, `pageerror` and `console` listeners are removed to prevent accumulation. After all tests in the worker complete, `electronApp.close()` shuts down the Electron process.

## Fixture API

Three fixtures are provided, each at a different scope:

| Fixture        | Scope  | Description |
|----------------|--------|-------------|
| `electronApp`  | worker | The launched Electron app (shared across tests in a worker) |
| `appPage`      | test   | The main renderer Page (waits for `running.connected`, bypasses onboarding) |
| `app`          | test   | `AppDriver` — high-level API below |

### AppDriver methods

```ts
app.screenshot(name)             // Save a PNG under .apack/drive/screenshots/ when driving,
                                 // or .apack/tests/screenshots/ under `apack pack test`
app.navigate(surfaceId)           // Send SELECT_SURFACE + wait for activeSurface match + 500ms render delay
app.getState()                   // Returns snapshot.value (e.g. { running: 'connected' })
app.getContext()                 // Returns { activeSurfaceId, surfaceIds }
app.sendEvent(event)             // Send any event to applicationState
app.waitForState(check, ms?)     // Wait for dot-separated state path (e.g. 'running.connected')
app.waitForSurface(surfaceId, ms?) // Wait for a surface to appear in the surface list (default 30s)
```

### Direct page access

`appPage` is a standard Playwright `Page`. Use it for DOM queries:

```ts
await appPage.locator('.some-selector').click();
await appPage.waitForSelector('.loaded-indicator');
```

## Surface IDs

Available for `app.navigate()`: `threads` (default), `code`, `notes`, `browser`, `library`, `flows`, `actions`, `prompts`, `brain`, `database`, `logs`, `settings`.

## Writing tests

Import from the local fixtures, not from `@playwright/test`:

```ts
import { test, expect } from '@apackdev/testing';

test('verify my change', async ({ app, appPage }) => {
  await app.navigate('code');
  await expect(appPage.getByTestId('code-canvas')).toBeVisible();
});
```

## Driving the app (`drive/`)

For one-off visual verification, write a script in `drive/` — gitignored apart from its README and
config, and outside every test glob:

```ts
// drive/notes.ts
import { drive } from '@apackdev/testing';

drive('check something', async ({ app, appPage }) => {
  await app.navigate('notes');
  await appPage.locator('.note-item').first().click();
  await app.screenshot('notes-detail');
});
```

```bash
npm run dev:drive                    # everything in drive/, windows shown
npm run dev:drive -- drive/notes.ts  # one script
```

The import is `drive`, not `test`, and that is the point: the same runner under a name that says what the
file is. A pack author gets the same thing from `npm run dev:drive --`, which scaffolds the directory on first use
and takes `--profile <name>` to keep the app's data between sessions.

## Debugging the running app

Use this when a bug only appears in the real app — a hang, a dropped event, something whose cause you
can't settle by reading. Reading twice and guessing twice costs more than one instrumented run: two
separate explanations for one such bug were argued from the source and both were wrong, and a single
`console.error` in the failing path settled it in one cycle
(`fix(packs): list a pack before registering its contributions`, whose message records both wrong answers).

### The app under test is built, not source

This is the thing that wastes a cycle. `npm run test:e2e` runs `packages:ensure` and then Playwright — it does
**not** rebuild the app. Electron launches built output, so an edit to backend source is not in the run
unless you rebuild first:

| You edited | Rebuild with |
|---|---|
| `packages/apack-host/src/**`, `packages/apack-sdk/src/**`, `packages/api/src/**` | `npm run build:api` (bundles them into the API) |
| `packages/renderer/src/**` | `npm run build -w @app/renderer` |
| `packages/main/src/**`, `packages/preload/src/**` | `npm run build -w @app/main`, `-w @app/preload` |
| a built-in pack (`packages/default-setup/**`) | `npm run build:default-setup` |

A first instrumented run that prints nothing usually means this, not that the line wasn't reached.

### Getting output back

`DEBUG_E2E=1` pipes the Electron and API stdout/stderr into the test terminal. `console.error` from the
API process arrives prefixed `[API Server Error]:`, `console.log` as `[API Server]:`.

Pick a unique tag so you can extract the lines whatever else is logging, and print a timestamp — the
app is several processes and the interleaving is what you are usually trying to establish:

```ts
console.error(`[DROPDBG] t=${Date.now()} surface=${surfaceId} keys=[${[...map.keys()].join('|')}]`);
```

```bash
npm run build:api && DEBUG_E2E=1 npm run test:e2e -- tests/e2e/app-integration/surface-sends.spec.ts --grep "restarted pack" \
  2>&1 | grep -oE "\[DROPDBG\] t=[0-9]+ .*" | head -20
```

`--grep "<title substring>"` runs one test, which keeps a cycle at seconds rather than minutes.

Print **state, not just arrival**. "It was dropped" says nothing; the keys of the map it was checked
against, at a timestamp, says which moment the code was in. Instrument both sides of a suspected
window — the thing that moves and the thing that observes it — so the ordering is in the output rather
than in your head.

### Putting it back

Instrumentation is temporary and must not reach a commit. Copy the file to your scratchpad first, and
restore from that copy rather than by hand or with `git checkout`:

```bash
SC=<your scratchpad>
cp packages/apack-host/src/bus/machine.ts "$SC/machine.orig"
# …instrument, build, run, read…
cp "$SC/machine.orig" packages/apack-host/src/bus/machine.ts
git status --porcelain   # confirm nothing of yours is left behind
```

`git checkout -- .` has wiped a session's uncommitted work in this repo. Restore the one file you
touched, never the tree.

### Driving the app, not just watching it

The fixture is an app driver: `app.navigate(surfaceId)`, `app.sendEvent(...)`, `app.getContext()`,
`app.waitForState(...)`, and `appPage.evaluate()` for anything reachable from the renderer. A script in
`drive/` (see above) that navigates to the screen, does the thing and waits is usually a faster reproducer
than the real test you are chasing, and nothing collects it.

For backend endpoints the renderer doesn't call, read the port and token from the page and `fetch`
them from the test — `tests/e2e/app-integration/surface-sends.spec.ts` does this for `POST /dev/reload`.

## Testing external packs

There are two ways to test external packs:

### 1. From the pack's own repo (preferred for pack developers)

Pack developers can write and run E2E tests without the apack repo. The fixture is `@apackdev/testing`. See `packages/apack-testing/CLAUDE.md` for the full guide.

```bash
cd /path/to/my-pack
apack pack init-tests          # scaffold config + sample test, add @apackdev/testing + @playwright/test
npm install
apack pack test                # a Beta matching the pack's hostVersion; --host <path> for a checkout
apack pack test --host beta   # CI: never prompts; --host <path> for a checkout
```

### 2. From this repo (quick iteration)

Set `PACK_DIR` to test an external pack using the monorepo's test runner. No setup needed in the pack — the fixture handles everything:

```bash
# Drive a pack's app instead of testing it
PACK_DIR=/path/to/my-pack npm run dev:drive

# Run against any test file
PACK_DIR=/path/to/my-pack npm run test:e2e -- tests/e2e/smoke
```

#### What happens when `PACK_DIR` is set

1. **Read manifest** — parses `apack.json` from `PACK_DIR` to get the pack ID and surface IDs
2. **Isolated data dir** — creates `$TMPDIR/apack-e2e-*` for the worker
3. **Build**: always runs `apack pack build` in the pack directory (fails the run if the build fails)
4. **Install** — installs the built pack into that data dir through the pack installer; no other packs are present
5. **Launch Electron** — starts the app, which discovers the pack in its packs directory
6. **Check applying** — fails if the pack's installed-packs entry has a `lastError`
7. **Wait for surfaces** — for each surface ID from the manifest, waits up to 30s for it to appear in `applicationState.context.surfaces`. Fails immediately, with the captured errors, if the pack's FE entry fails to load.

The in-repo fixture pack at `tests/packs/external-pack` exercises this whole path from its own directory: `npm run test:external-pack`.

### Finding surface IDs

Surface IDs are the keys of the pack's `apack.json` `features` entries that declare a `surface` (the manifest's `surface` object has no `id` of its own).

## Renderer globals

The renderer exposes on `window`:

- `applicationState` — full XState actor (`.send()`, `.getSnapshot()`, `.system`)
- `__disableOnboardingUI()` — sends `ONBOARDING_COMPLETE` (fixture calls this automatically)

## Environment variables

| Variable | Description |
|----------|-------------|
| `PLAYWRIGHT_TEST=true` | Set automatically by the fixture; crashes on uncaught errors and runs headless (no window display) |
| `DEBUG_E2E=1` | Pipes Electron stdout/stderr to the test terminal |
| *(always)* | The same output is written to `.apack/tests/results/app-<workerIndex>.log`, wiped each run. `DEBUG_E2E=1` is for watching it live; the file is for reading it afterwards |
| `PACK_DIR=/path/to/pack` | Builds the pack, installs it into the worker's isolated data dir, waits for surfaces before tests run |
| `E2E_KEEP_DATA=1` | Keep each worker's temp data dir (path is logged) |
| `APACK_HOST_ROOT=/path/to/apack` | A built apack checkout to launch (auto-detected inside the monorepo) |
| `APACK_HOST_EXECUTABLE=/path/to/exe` | A packaged apack executable to launch (set by `apack pack test --host beta`); cannot be combined with `APACK_HOST_ROOT` |
| `APACK_CLI=/path/to/apack.mjs` | The apack bin that builds `PACK_DIR` (set by `apack pack test`) |
| `APACK_HOST=beta` | Read by `apack pack test` (and `apack pack build`), not the fixture: use the newest matching apack Beta without prompting (CI) |

## Key events for sendEvent()

```ts
{ type: 'SELECT_SURFACE', surface: string }     // Switch active surface (its ref)
{ type: 'OPEN_SURFACE', surface: string, events: object[] }  // What untypedOpenSurface sends: open a surface by ref and hand it events; waits for a pack still loading
{ type: 'NAVIGATE_BACK' }                     // History back
{ type: 'NAVIGATE_FORWARD' }                  // History forward
{ type: 'DEFAULT_TOGGLE', area: 'canvas' }    // Toggle canvas visibility
{ type: 'TOGGLE_INSPECTION_PANEL' }           // Toggle side panel
{ type: 'MAXIMIZE_CHAT' }                     // Maximize chat panel
{ type: 'RESTORE_CHAT' }                      // Restore chat panel size
```

## File map

| File | Purpose |
|------|---------|

**`smoke/` — the gate.** Its own chain step (`test:smoke`); the four cases every other check assumes.

| File | Purpose |
|------|---------|
| `smoke/smoke.spec.ts` | The app launches without crashing, reaches `connected`, has its surfaces, and runs in its own per-worker data dir |

**`app-integration/` — the real process boundary.** A live port, the websocket, the CLI against a real
data dir, the pack loader: things no harness test can reach.

| File | Purpose |
|------|---------|
| `app-integration/api-access.spec.ts` | The API refuses WebSocket connections and `POST /dev/reload` without the run's token (the socket offers it as a subprotocol, not in the URL), takes them with it, and survives a malformed upgrade request |
| `app-integration/api-reconnect.spec.ts` | The window keeps working across an API crash: main restarts it and the client re-establishes its bus subscription, on the same port or the one main reports |
| `app-integration/sqlite-storage.spec.ts` | A real packaged Preview selected as SQLite: both API stores have actual SQLite headers, no LMDB files, and kernel claims held across the Node/Electron process boundary; the installed CI suite requires the witness to execute |
| `app-integration/db-cli.spec.ts` | `apack db` on the running app's data dir (`electronApp`'s `userData`): a query reads it with a stale-data warning, `exec` and `reset` are refused |
| `app-integration/dev-reload.spec.ts` | `POST /dev/reload` of the pack the app ships refreshes the installed copy from what was rebuilt, re-applies the changed content data and resends startup data. The one spec in this suite that has caught a regression: a pack is loaded from the data dir, so without that refresh a rebuild reached the app only by accident, which no harness can see |
| `app-integration/feature-addressing.spec.ts` | A name becoming an address: every path where a feature ref had to resolve and, when it didn't, the app ran on with the click or the setting silently lost |
| `app-integration/import-pack-content.spec.ts` | Settings → Import Pack Content: compiles default-setup's notes and library entries into a compiled content directory, previews it, imports a selection, re-imports in keep-existing mode |
| `app-integration/surface-sends.spec.ts` | Backend sends to surfaces through the bus: the code system's file watcher and terminal output, and the browser system's startup data after a pack reload, reach their surfaces (recorded with `applicationState.system.inspect`) |
| `app-integration/secrets.spec.ts` | Settings → Secrets: adds and selects API keys, and checks the key strings reach no log, stored file or renderer state |

**`ui/` — rendered behaviour.** What a person would see, and what only a real renderer shows.

| File | Purpose |
|------|---------|
| `ui/fallback-panel.spec.ts` | A surface offering its panel for surfaces without one (`fallbackPanel`), and saying itself when it shows: the brain's inspect mode |
| `ui/navigation.spec.ts` | Opens every surface and every surface's settings without a renderer error — a component reaching for a surface it isn't rendered in fails here |
| `ui/entity-reference.spec.ts` | Imports a saved thread message, reloads it, and clicks its rendered reference to open the correct note and content in another feature |
| `ui/popout.spec.ts` | A surface popped out into its own window: main accepts the surface's ref as its id and the popout renders its canvas as part of that surface |
| `ui/settings-help.spec.ts` | Settings Help: bundled pack articles, search, contextual settings navigation and unavailable targets |

| Elsewhere | |
|------|---------|
| `packages/apack-testing/src/index.ts` | The actual fixture source (shared between monorepo and external packs) |
