# Application E2E tests

Read [the test placement guide](../README.md) for ownership and commands. This suite contains real
Electron checks: `smoke/` is the app gate, `ui/` checks rendered behavior, and `app-integration/` checks
real process boundaries. The latter two are opt-in, not ordinary chain gates. One-off driving belongs
in `drive/`.

Run the affected spec with `npm run test:e2e -- ui/<spec>` or
`npm run test:e2e -- app-integration/<spec>`. Tests use the built app; rebuild the affected output first.

- Never kill processes by broad pattern; stop only a process owned by the current run.
- Tests use isolated profiles and run alongside developer apps. Do not close those apps.
- Investigate failed assertions before changing them; retain logs and failure artifacts.
- Tests in a worker share data. Use unique values and clean up created records.
- Import the fixture directly from `@apackdev/testing`, without a local re-export.

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
