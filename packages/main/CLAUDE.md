# @app/main

The Electron main process. It decides the app environment, spawns the API server as a child process, owns every window, registers the custom protocols and answers the renderer's IPC calls. It holds no app logic: pack systems run in the API process (`packages/api`), surfaces in the renderer. The root `CLAUDE.md` covers environment inference in brief, and `docs/public-facing/architecture.md` covers the data dir layout and the `pack://` protocol from a pack author's side.

## Entry

`packages/entry-point.mjs` (the app's `main`) imports `./main/dist/index.js` and calls `initApp({ renderer, preload })` (`src/index.ts`, typed by `src/AppInitConfig.ts`). Main never imports `@app/renderer` or `@app/preload` itself; the entry point passes their locations:

- `renderer`: `new URL(VITE_DEV_SERVER_URL)` when `MODE=development` and that variable is set (`npm run dev`), else `{ path: renderer/dist/index.html }`.
- `preload`: `preload/dist/exposed.mjs`.

The entry point also installs crash handling: `showAndExit` on uncaught errors in development, Playwright and CI, and `electron-log`'s `errorHandler` otherwise (EPIPE ignored). It still starts after the app context exists: `entry-point.mjs` imports `initApp` statically, and evaluating that bundle runs `logger.ts`, which asks for the context.

## Module runner

`initApp` runs `initAppEnvironment()`, `initializeMainLogCapture()` and a `disable-features` Chromium switch (it stops the macOS Apple Music permission prompt), then chains modules on `createModuleRunner()` (`src/ModuleRunner.ts`):

- A module implements `AppModule.enable({ app })` (`src/AppModule.ts`, `src/MainModuleScope.ts`).
- `init(module)` calls `enable` right away, in registration order. A returned promise is chained, and `await moduleRunner` waits for all of them. Async modules run concurrently from their first `await` (usually `app.whenReady()`), so whatever must happen before `ready`, like `protocol.registerSchemesAsPrivileged`, has to run synchronously in `enable`.
- `createApiServer()` and `createSplashScreen()` are created before the chain and passed to the window manager as well.

Modules, in order (`src/modules/`):

| Factory | File | Does |
|---|---|---|
| `disallowMultipleAppInstance` | `SingleInstanceApp.ts` | `requestSingleInstanceLock()`, **scoped by the data dir**, so dev, beta, test and production run side by side — they have different ones — and two apps on one dir cannot; exits if the lock is taken |
| `createProtocolHandler` | `ProtocolHandler.ts` | Registers the app as handler for `urlScheme` (`apack`, or `apack-beta`); `open-url` / `second-instance` URLs go to the first window as `protocol-action` `{ action: hostname, params }` |
| `hardwareAccelerationMode` | `HardwareAccelerationModule.ts` | Currently `{ enable: true }`, so a no-op |
| `createMediaProtocol` | `media-protocol/` | `media://` and `local-file://` (see Protocols) |
| `createPackProtocol` | `pack-protocol/` | `pack://` (see Protocols) |
| `splashScreen` | `splash-screen/` | Frameless 400×400 splash, shown on `ready-to-show` with the version; fades out on `close()` |
| `apiServer` | `api-server/` | Spawns and supervises the API (see API server) |
| `createPerformanceModule` | `performance/` | Dev/test renderer metrics and profiles; calling-window leases, debugger ownership, navigation/destruction cleanup |
| `createSpeechRecognition` | `speech-recognition/` | `speech:*` IPC; spawns the native helper (`native/speech/…`) on first `speech:start` |
| `createWindowManagerModule` | `window-manager/` | Main and popout windows, most IPC handlers (see Windows) |
| `terminateAppOnLastWindowClose` | `ApplicationTerminatorOnLastWindowClose.ts` | Quits on `window-all-closed` except on macOS |
| `createBrowserModule` | `browser/` | The browser surface's tabs: `WebContentsView`s in the `persist:browser` session, driven by `browser:*` IPC (`BrowserTabManager.ts`) |
| `createMacOSAppMenu` | `MacOSAppMenu.ts` | macOS menu: Cmd+Q hides, Cmd+Shift+Q quits; packaged builds add "Install 'apack' command in PATH" (`cli-command.ts`, symlinks `Resources/cli/apack` into `/usr/local/bin`, `apack-beta` for beta, via `osascript` on EACCES) |
| `allowInternalOrigins` | `BlockNotAllowdOrigins.ts` | Blocks `will-navigate` to origins other than the dev server's |
| `allowExternalUrls` | `ExternalUrls.ts` | `setWindowOpenHandler` always denies, and sends the URL to the system browser through `shell-access.ts` (see Shell access) |

`allowInternalOrigins` is populated only when `renderer` is a URL (dev server); from a file build the set is empty, so a window navigates nowhere. The last two skip `persist:browser` web contents. `AutoUpdater` is commented out in `src/index.ts`.

## Shell access (`src/modules/shell-access.ts`)

What this process hands to the OS on a window's word: a URL for the user's browser, a file for its default app. A
window renders what the user wrote, what a model answered and what a pack's frontend built, so a request arriving here
is untrusted whoever asked, and the two rules live in one module rather than at each call
([Electron security #14](https://www.electronjs.org/docs/latest/tutorial/security#14-do-not-use-openexternal-with-untrusted-content)).

- `externalUrlProblem(url)` / `openExternalUrl(url)`: the URL must parse, its scheme must be `http:` or `https:`
  (`http:` stays, because the terminal links what a dev server prints), and it may carry no credentials —
  `https://apple.com@evil.example` is a link to evil.example that reads as one to apple.com. Both doors go through it:
  the `shell:openExternal` IPC and `setWindowOpenHandler` (`ExternalUrls.ts`), which still opens no window.
- `openablePathProblem(path)` / `openFilePath(path)`: the file must exist, and its extension must not be one the
  system runs rather than opens (`.app`, `.command`, `.exe`, `.msi`, `.vbs`, …). Behind the `shell:openPath` IPC and
  the temp file `shell:openImageExternal` writes.
- A refusal is logged with the URL's origin and path (never its query, which may carry a token) or the file's path,
  in every environment, and nothing is opened. `shell:showItemInFolder` reveals rather than opens, so it takes the
  path as given.
- There is no list of approved sites: the app opens links the user wrote, in notes, chats, terminals and packs' UIs,
  so a list would either block what people open or grow until it approves everything. `tests/shell-access.spec.ts`
  covers both rules, with the app's own links among the accepted ones.

## App context (`src/app-environment.ts`)

`initAppEnvironment()` runs first and is the only place the environment is decided:

- `_inferElectronAppEnv` (`@apackdev/sdk/env`) gets `PLAYWRIGHT_TEST === 'true'`, `app.isPackaged`, the channel read from packaged `build-manifest.json`, and `process.env.APACK_ENV`. `build/build-metadata.ts` creates a fresh staging build and one manifest; main and API read that manifest at runtime. Packaging checks file hashes before signing, so no baked-version comparison is needed. See `docs/references/preview-builds.md`.
- `resolveAppEnvironment({ env })` gives the app name, data dir, `packsDir`, `urlScheme`, …. It then calls `app.setName` and `app.setPath('userData')` (so Electron's own storage and the single-instance lock follow the **data dir**), and writes `APACK_ENV` / `APACK_USER_DATA_DIR` to `process.env`, which the API child inherits.
- Everything else reads it with `getAppEnvironment()`, which throws if called first. Don't read `app.getPath('userData')`, `NODE_ENV` or `PLAYWRIGHT_TEST` to choose paths.

## API server (`src/modules/api-server/`)

- `ApiServer` creates the API token for this app run (`apiToken`, 32 random bytes). The API process gets it as `APACK_API_TOKEN` (`getEnvironment`), the app's windows through the synchronous `api:token` IPC their preload sends. The in-app browser's tabs have no preload, so web pages never see it.
- `ApiServer.enable` registers IPC (`api:token`, `api:get-status`, `api:open-log-file`, `app:reload`, `app:relaunch`) and starts the server on `app.whenReady()`.
- `startApiServer` SIGKILLs orphaned API processes (`ps`, macOS/Linux: same `dist/server.js` path, `apack` in the command, parent pid 1), then spawns it:
  - `getApiPaths()`: `<appPath>/packages/api` from source, `<resources>/app/packages/api` packaged (no ASAR).
  - `getNodeExecutable()`: `node` from source; packaged, Electron itself with `ELECTRON_RUN_AS_NODE=1`.
  - `getExecutionArgs()`: from source `--conditions=@apackdev/source dist/server.js`, so packs' `@apackdev/*` imports resolve to workspace source.
  - `getEnvironment()`: `API_PORT`, `APACK_API_TOKEN` (the run's API token), `NODE_ENV`, `SHIPPED_PACKS_DIR` (`packages/`), `APACK_STARTUP_ID`, `APACK_LOG_DIR`, `APACK_ENV`, `APACK_USER_DATA_DIR`; packaged builds append Homebrew, `/usr/local/bin` and nvm dirs to `PATH`.
  - Port: `getPort({ port: preferredPort })` (3001 first, then the last port that worked) after `clearLockedPorts()`, so a restart keeps the renderer's URL when it can.
- `ProcessManager` (`process-manager.ts`) pipes stdout/stderr to the log. The server counts as ready at the first stdout line containing `WebSocket Server listening` with `ws://localhost:<port>`. Stderr lines starting with `{"__fatal":` are collected and broadcast as `api:fatal`.
- On exit it broadcasts `api:stopped` (`{ error, restarting }`) and restarts after 2 s, up to 3 attempts (`API_CONFIG` in `config.ts`); the count resets once a launch has run for 5 s. After the last attempt it broadcasts `api:error` and rejects `waitForReady()`.
- `broadcastEvent` sends `api:starting`, `api:started` (`{ port, startupId }`), `api:restarting`, `api:log` (dev only) and the events above to every window. The renderer reconnects its tRPC client on `api:started` (see `packages/renderer/CLAUDE.md`).
- **`reloadApiServer()` is the one public way to replace the API, and it is deliberately not the path above.** It is `ProcessManager.stop()` — awaitable, where `kill()` is not — then `startApiServer()`. Two properties it has to keep: it **waits for the exit**, because the departing process holds the port the next one prefers and the database it is about to open; and it **never reaches `handleProcessExit`**, because `stop()` removes the handlers before signalling. That second one is not tidiness — every exit there costs one of three restart attempts, forgiven only 5 s after a launch, so a handful of quick edits would land on `api:stopped { restarting: false }`, the shell's terminal `error` state, and main refusing to start the API again. Calls coalesce, and the next readiness carries `reloaded: true` so the window resubscribes at once instead of waiting out its client's backoff.
- **`dev-reloader.ts` is what calls it**: a module that watches `dist/server.js` and reloads when it moves, armed only when the build is `development` **and** the launcher said so (`APACK_DEV_RELOAD`, set by `npm run dev`). Both halves are deliberate — `development` alone is true of `apack pack dev` and of a bare `electron .`, and the variable alone must not arm a packaged or `test` app. It is the only file watcher in main. `packages/api/CLAUDE.md` has the loop and its measured cost.
- Shutdown: `before-quit` cancels termination while awaiting `ProcessManager.stop()`; repeated quit requests join that wait. On actual API exit it resumes `app.quit()`. SIGTERM escalates to SIGKILL after 5 s; failure to observe exit rejects and leaves quit cancelled with a diagnostic. Relaunch and startup-error quit use this same boundary. The application terminator handles last-window closure off macOS.
- `logger.ts` mirrors `console.*` into electron-log and writes `main.jsonl`, `renderer.jsonl`, `renderer.log` and `app-events.log` beside the main log. Those four go through `appendCappedLine` (`@apackdev/host/logs`), which rotates each at 10 MB: electron-log's own `maxSize` covers only `main.log`, and without a cap of their own they grew for as long as the app was ever run. All of them, electron-log included, are configured from `getAppEnvironment().logsDir` — importing this module is what decides the context, so the module graph puts that before any log write.

## Windows (`src/modules/window-manager/`)

- `WindowManager.enable` waits for `apiServer.waitForReady()` (60 s). On failure it shows a Relaunch/Quit dialog and exits.
- `restoreOrCreateWindow` creates the main window (title `apack-Main`, the key `isMainWindow` matches on) and waits for the renderer's `renderer:ready` IPC (15 s timeout) before showing it and closing the splash. `second-instance` and macOS `activate` restore or recreate it.
- Windows get `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`, the preload script, and `additionalArguments` `--api-port=<port>` and `--startup-id=<id>`, which the preload reads. The port is read when the window is created; later moves reach the renderer through `api:started`.
- `surface:popout` opens one popout per surface id (`apack-Popout-<id>`), loading the renderer with `?popout=surface&surfaceId=…&title=…`; Cmd/Ctrl+W closes it.
- Size: 1400×900 in a dev build, 1920×1200 otherwise (`constants.ts`, `import.meta.env.DEV`).
- Under Playwright, windows are never shown or focused unless `PLAYWRIGHT_VISIBLE=1`; the same check guards the splash and protocol handler.
- `attachRendererDiagnostics` logs console messages, crashes, hangs, load and preload failures to the renderer log. `getWindowIcon()` (`helpers.ts`) uses `build/resources/icon-dev.png` from source.
- The window manager also registers window controls, dialogs, file reads, `shell:*`, `media:*`, `zoom:changed` and `renderer-log:write`. The channel list is in `packages/preload/CLAUDE.md`.

## Protocols

- **`pack://<packId>/builds/<revision>/<path>`** (`pack-protocol/PackProtocol.ts`), privileged `secure` + `supportFetchAPI`:
  - The owner is a pack ID and the revision is the accepted receipt identity. Relative module imports, styles and fonts retain that revision in their URL base.
  - Serves only the installed copy. The receipt must still match the requested revision, and the exact returned bytes must match its listed checksum. Missing/changed files and symlinks fail; there is no shipped or development fallback.
  - Development is separate: the API advertises a live local Vite base URL only in the development environment. The renderer imports that source graph directly; monorepo source frontends use the renderer's Vite graph. Neither is an installed asset request.
- **`media://<entityId>/<file>`** (`media-protocol/`) serves `getMediaBasePath()/<entityId>/<file>`, which `media:upload` writes to (PNG/JPEG/GIF/WebP, 10 MB max). That is the folder the SDK's `_getMediaPath()` gives the API (`media-protocol/paths.ts`): `<data dir>/apack/media`. Branching on `app.isPackaged` here would put the layout rule in both main and the API, where a mismatch serves every image a 404.
- **`local-file://?path=<abs>`** serves any existing local file for video playback. It uses the deprecated `registerFileProtocol` and no `stream` privilege on purpose: `stream: true` breaks seeking (Electron #38749).

## Build and dev

- `vite build` (`vite.config.js`) produces a single SSR ES bundle `dist/index.js`. `@apackdev/sdk` and `@apackdev/host` are bundled in (`ssr.noExternal`), because packaged builds strip `.ts`. They resolve under `@apackdev/source`. Splash assets and `resources/logo.svg` are copied to `dist/assets`.
- `npm run dev` (`packages/dev-mode.js`) starts the renderer dev server, builds the API, then builds preload and main in watch mode with the `@app/renderer-watch-server-provider` surface. Main's `handleHotReload` restarts Electron after each rebuild (`ELECTRON_INSPECT=true`, via `npm run dev:inspect`, adds `--inspect`).
- `npm run typecheck -w @app/main` runs `tsc --noEmit`. Root `npm run typecheck` runs it as `typecheck:main`.

## Tests

`npm test -w @app/main` (vitest, `tests/**/*.spec.ts`), in the root `test:unit` chain. `tests/electron-stub.ts` stands in for Electron's `app` and records what a module asked it to do; `vitest.config.ts` aliases `electron` to it. A test must take the stub from the same fresh registry as the module under test (`load()` in `tests/app-environment.spec.ts`), because `vi.resetModules()` gives the module a new one.
