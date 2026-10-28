# @app/api

The backend process: a `node:http` + `ws` server exposing a tRPC router over WebSocket and the root event bus, the process boot, and the composition that opens the app's elmdb databases (`@apackdev/ears/lmdb`) for the EARS engines and binds the app. It holds nothing else: behaviour (systems, repositories, flows) lives in packs (`packages/default-setup`), and app runtime in `@apackdev/host`, including the pack runtime (`@apackdev/host/packs/runtime`: loading, lifecycle, reload, applying), the app bus (`createAppBus(registry)`, `@apackdev/host/bus`), the migrations runners (`@apackdev/host/migrations`) and the host services (`createHostRuntime()`, `@apackdev/host/services`); this package wires them together and serves them. `tests/source-layout.spec.ts` lists the files `src/` may hold. Environment variables and the manual boot command are in the root `CLAUDE.md` (App environment).

The isolated SQLite candidate uses the host's `APACK_STORAGE_FORMAT` profile guard. Startup awaits index
readiness initially and after pack registration, before lifecycle/migrations; this does not qualify live
install/reload readiness. Keep `@apackdev/ears/sqlite` external in the API bundle so its native/vector/WASM
assets retain package-relative ownership. `tests/runtime/sqlite-bundle.spec.ts` executes that actual boundary;
profile tests cover persistence and partial-open cleanup. Node boot evidence does not certify Electron ABI.

## Layout

`src/` is one folder per job this package does, and `packages/renderer/src` is the same four plus `views/`, so a
concept found in one is looked for in the same place in the other (`tests/source-layout.spec.ts` says so on
both sides):

| Folder | What belongs there | The renderer's counterpart |
|---|---|---|
| `boot/` | what runs before the app exists: fatal-error handling, the process's config | `boot/` |
| `runtime/` | this process's resources (the store, the engine, the registry) and binding the app | `runtime/` |
| `transport/` | the wire to the renderer: the tRPC routers, the root event emitter, the ws server | `transport/` (the client) |
| `adapters/` | this process's implementations of what host code is given — today the console | `adapters/` |

`server.ts` and `types.ts` sit at the root. There is no `core/`, `shared/`, `lib/` or `utils/`: a folder
named for a layer rather than a job takes whatever nobody placed, and the guard rejects one. Anything that isn't
transport, boot or composition belongs in `@apackdev/host`, which the same guard is there to keep true.

## Source map (`src/`)

| Path | Purpose |
|------|---------|
| `server.ts` | Entry. Loads `dotenv`, calls `installFatalErrorHandling()` (`boot/errors.ts`), then runs `setupBackend()` and `createWebSocketServer()`. Any failure is written to stderr as a `{"__fatal": true, message, stack, source}` JSON line and the process exits 1 |
| `types.ts` | The `types` entry (`dist/types.d.ts`): `AppRouter`, `EARS`, `BaseEntity`, pack content preview types |
| `transport/` | tRPC, the root event emitter and the ws server (below) |
| `adapters/logging.ts` | Log output (below) |
| `runtime/index.ts` | The composition: `openAppStore()`, which creates the app's registered packs, opens the store and binds the app (below), `setupBackend()`, the exported `appPacks` (the app's registry, which `transport/bus.ts` and `transport/websocket.ts` work on) and `backendActor` (`createAppBus(appPacks)`, with systemId `bus` from `@apackdev/host/bus`), and `logErrors(actor)` (an actor error observer that reports a fatal system error with `reportError` and writes a `__fatal` line). Packaged runs read their version from the same `build-manifest.json` main uses, whose path main passes as `APACK_APP_MANIFEST`; source runs use root `package.json` |
| `transport/websocket.ts` | `createWebSocketServer()` (below) |
| `boot/config.ts` | `SERVER_CONFIG.port` (`API_PORT`, default 3001), `WS_CONFIG` (accepts every connection) |

## tRPC and the root event emitter (`src/transport/`)

- `trpc.ts` — `router` and `procedure` from `initTRPC`; `context.ts` — `createRpcContext()` returns `{ client, closed }`:
  an id minted per WebSocket connection, and the signal that fires when that connection ends. The adapter calls it
  once per socket, so the id identifies the connection rather than the call, and it is never read from the wire —
  which is what makes it a return address a sender cannot forge. `closed` is the adapter's per-connection abort
  signal (it fires from `client.once('close')`), and is how anything holding per-connection state gives it back.
- `index.ts` — `appRouter = router({ entities, bus, packs, secrets, settings, views })`; `AppRouter` is its type.
- `packs.ts` (`packs.*`) — `loaded` reports accepted executable runtimes for frontend reconciliation.
  `catalog` streams the existing common declaration catalog, including disabled/activation-failed packs,
  without loading their modules. Each frame carries a backend-run ID and committed catalog revision;
  subscription teardown releases its catalog listener. Discovery and execution/readiness are separate.
- `bus.ts` (`bus.*`):
  - `send` (mutation) — `receiveClientEvent(appPacks, { ...input, client: ctx.client })` (`@apackdev/host/bus`), which checks `systemId` and `type` against the app's registered systems (a `*` entry accepts any type), logs the event through the `app-events` logger (arrays over 5 items summarized) and emits it on the bound root event bus. Its `UnknownClientEventError` becomes `BAD_REQUEST`.
  - `packClientReady({ packId })` — logs it and calls `rootEvents.emitPackClientConnected`, which the bus turns into `PACK_CLIENT_CONNECTED`.
  - `claim({ as })` — takes a name on this connection for something no pack registered, so a system can be told to
    answer *it*: an agent driving the app claims `host/drive`. The name is checked against the ref grammar, a name
    another live connection holds is refused with `CONFLICT` rather than taken over, and the claim is released when
    **the connection** ends (`ctx.closed`) — so it lives exactly as long as its socket and a reconnect always finds
    it free. Not when the subscription tears down, which was the first attempt and is wrong both ways: it took a
    name from a client that had merely stopped subscribing, and it left one held forever by a client that claimed
    without ever subscribing, so the next session was refused with nothing its user could close
    (`tests/transport/claim.spec.ts`).
  - `sub` (subscription) — streams `rootEvents.onOutgoing` and calls `emitConnected()` for each new subscription
    (the bus's `CLIENT_CONNECTED`). It filters on the connection: a message whose `client` is absent goes to every
    subscription, and one that names a connection goes only to that one. The filter is here rather than in the
    renderer, so a window never receives a message that was not for it (`tests/transport/sub-scope.spec.ts`).
- `views.ts` (`views.*`) — `watch({ ref, view, args? })` (subscription): one window's subscription to one view, delegating to `appViews` (`createViewHost`, `@apackdev/host/views`, created in `openAppStore()` over the app's engine and registry). It lasts as long as the subscription, and the adapter ends every subscription on a socket that closes, so nothing watches for a window going away (`tests/transport/views.spec.ts`, over a real adapter).
- `secrets.ts` (`secrets.*`) — `list` (query), `add`, `replaceValue`, `select`, `rename`, `delete`, `allowUnprotected`. Each calls `secretsStore` (`@apackdev/host/secrets`) directly, never the bus, and returns `secretsSnapshot()` (metadata and status, no values). `provider` is validated against `providerLabels` plus `custom`. The boot calls host's `forwardSecretsChanges()`, which sends the `settings` designation `SECRETS_CHANGED` on every store change, once that system is registered.
- `encoder.ts` — what the ws adapter serialises with (`experimental_encoder`), in place of its default bare
  `JSON.stringify`. Only two values make that throw — a `BigInt` anywhere, and a circular structure — and it throws
  from the loop that drains a subscription rather than from the send, so the throw ended the subscription and with
  it that window's whole event stream. A replacer renders BigInts as digits on the fast path; a cycle falls back to
  a copy with the loop cut, reported once. It never throws (`tests/transport/encoder.spec.ts`, which asserts
  through a real adapter so that a tRPC bump dropping the option fails rather than silently restoring the bug).
- `emitter.ts` — `rootEvents`, the single `RootEventEmitter` (it implements the SDK's `RootEvents`, and is the `transport` the app binds): `emitLog`/`onLog`, `emitConnected`/`onConnected`, `emitPackClientConnected`/`onPackClientConnected`, `emitIncoming`/`onIncoming`, `emitSurfaceSend`/`onSurfaceSend` (sends to surfaces from outside a system, which `createAppBus()` routes through the bus actor), `emitOutgoing`/`onOutgoing` (what the clients receive). `emitLog` also appends the event to `$APACK_LOG_DIR/app-events.log` (skipped when unset; write errors are swallowed).

Packs reach these modules only through the bound `HostRuntime` (`@apackdev/sdk/events` and `@apackdev/sdk/logger` send, log and report errors over `transport.rootEvents`), not by import.

## Binding the app and the store (`openAppStore()` in `runtime/index.ts`)

Importing `runtime/index.ts` opens and binds nothing. `openAppStore()` creates the app's registered packs (`createPackRegistry()` from `@apackdev/host/packs`, exported as `appPacks`; every later boot step registers into it) and opens the app's data with `openDatabaseStore({ path, schema: packs })` (`@apackdev/host/database`, the composition `apack db` opens a data dir with too): the elmdb database at `_getLmdbPath()`, held to the schema the registry declares, and the app's engine on it, and the run history's with `openRunHistory(_getRunHistoryPath())`, then `bindHost(createHostRuntime({ database, runHistory, engine, transport: { rootEvents }, appVersion: APP_VERSION, packs }))` (`@apackdev/host/services`, the only place the runtime is assembled; `APP_VERSION` is the root `package.json`'s version), and `printLogEvents()`. `bindHost` runs once per process: a spec that opens the database twice calls `unbindHost()` (`@apackdev/sdk/runtime/internals`) in between (`restart-persistence.spec.ts`). `bindHost` binds the engine, without `admin`, for `@apackdev/sdk/ears`'s operations; the composition keeps `admin` (host services); the SDK's registries of what packs registered read the bound registry. It returns `{ database, runHistory, engine, packs }`; the engine reads the database from then on, so there is nothing to load once the packs are registered. `setupBackend()` calls it first, and so do `scripts/db/database.ts` and the specs that touch stores. `APACK_ENV` and `APACK_USER_DATA_DIR` must be set before the call. This package keeps `elmdb` as a dependency so the packaged app ships it (tsup leaves it external), but no code here imports `elmdb` (`check:specifiers`).

## Boot (`runtime/index.ts`)

`setupBackend()` first calls `initializeLogCapture()` and `openAppStore()`, then, outside Electron's runtime, `assertSourceResolution()` (a checkout must resolve workspace `@apackdev/*` source, not `dist`). The rest of the order (host `packs` system, `prepareHostDataDirs`, `forwardSecretsChanges` (`@apackdev/host/secrets`), pack loading, early logs system, shutdown hooks, the boot reading (the database's size on disk and the heap), `onInit`, migrations (`runAppMigrations`/`runPackMigrations` from `@apackdev/host/migrations`), content, bus actor) is listed step by step in [the pack runtime's CLAUDE.md](../apack-host/src/packs/runtime/CLAUDE.md#boot-sequence-in-the-apis-setupbackendts). Actor errors go to `logErrors('Logs')` / `logErrors('Backend')`.

## WebSocket server (`transport/websocket.ts`)

- One `http` server on `SERVER_CONFIG.port` carries the `ws` server with `applyWSSHandler({ router: appRouter, createContext: createRpcContext })`. It listens on loopback only (`API_HOST` from `@apackdev/sdk/utils/pure`, `127.0.0.1`): nothing on the network reaches it. Every client takes the address from there too (the renderer's tRPC client, `apack pack dev`, `apack pack build --watch`, the E2E tests).
- Every client needs the API token (`apiToken()` in `boot/config.ts`: `APACK_API_TOKEN`, which Electron main creates per app run, or, for an API started by hand without it, a random one the API makes up and keeps; `apiTokenIsOwn()`). A WebSocket connection offers it as a subprotocol, `apack-token.<token>` next to `apack` (`acceptsConnection` reads `Sec-WebSocket-Protocol`; the server answers `apack`, `API_PROTOCOL`, never echoing the token). It stays out of the URL, which browsers print when a connection fails and the app logs, and the check parses no URL, so a malformed request can't throw; the HTTP endpoints take it in `API_TOKEN_HEADER` (`@apackdev/sdk/utils/pure`). Tokens compare in constant time (`isApiToken`). A web page, the in-app browser's included, can't learn it, so it can't call the API (`tests/transport/dev-reload-access.spec.ts`, `tests/e2e/app-integration/api-access.spec.ts`).
- Once listening it logs `✅ WebSocket Server listening on ws://localhost:<port> ...`. Electron main detects readiness and the port by matching this line (`packages/main/src/modules/api-server/process-manager.ts`); the code marks it "do not remove or modify".
- Every run writes its port and process id to `resolveAppEnvironment().apiPortFile` (`<userDataDir>/api-port`, `{ port, pid }`), so a local tool finds this API and can tell an app is running on the data dir, and tells a file a crashed run left behind from a live one (`readApiEndpoint` in `@apackdev/sdk/env`, which `findRunningApp` and `apack pack dev` read; the port alone opens nothing, since every call needs the token). The token goes to `apiTokenFile` (`api-token`) only where a local tool may use it: `NODE_ENV=development` (`apack pack dev` and `apack pack build --watch` read both files), or an API that made up its own token, which also logs where it is (`apack-cli/src/commands/dev.ts`). `publishApiFiles` writes both through a new file created with mode `0600` and renamed into place, so only the user reads them whatever the data dir allows and an existing file's permissions never carry over. Both are removed on exit.
- `setupBackend()` refuses to boot while a tool holds the data dir's database write lock (`assertNoDatabaseWriter`, `@apackdev/host/database`): `apack db` holds it while it changes the database, so the app never starts on data that is about to change under it (`tests/runtime/db-write-lock.spec.ts`).
- `POST /dev/reload { packId }` calls `reloadPackById` (`@apackdev/host/packs/runtime`), which asks the registry which directory that pack was loaded from rather than taking the caller's word for it, and first refreshes the installed copy of a pack the app ships from `SHIPPED_PACKS_DIR` so a rebuild in the checkout is what gets loaded. `POST /dev/install { root }` calls `installDevPack`, which copies the build in a pack's source directory into the app and starts it — `apack pack dev`'s install, done by the app so that nothing else it does to the pack loads a half-copied build. Both hold the registry's claim on the pack (`claimPackOperation`), shared with the Packs view's install, toggle and update. `devRequestRefusal` answers 403 unless the app is a development or test build and the request carries the API token; 400 without `packId` or an absolute `root`, 409 for a reload while another operation holds the pack, 500 with the error message on any other failure (a dev install the claim refuses among them). Every other HTTP request gets 404.
- Shutdown: `process.on('exit')` runs `appPacks.runShutdownHooks()`. `POST /dev/reload` reloads a pack in `appPacks`. `SIGTERM` stops `backendActor`, broadcasts a tRPC reconnect notification, closes the servers and exits 0. Off Windows, a 2 s unref'd interval sends itself `SIGTERM` when the parent process is gone.

## How Electron starts it

`packages/main/src/modules/api-server/` (`ApiServer.ts`, `config.ts`) spawns `dist/server.js` with `cwd` = `packages/api`:

- From source: `node --conditions=@apackdev/source dist/server.js`. Packaged: Electron's executable (`process.execPath`) with `ELECTRON_RUN_AS_NODE=1` and the full path.
- Env (`getEnvironment`): `NODE_ENV` (`development` / `production`), `API_PORT` (from `get-port`, preferring the previous port), `APACK_STARTUP_ID`, `APACK_LOG_DIR` (main's log dir), `SHIPPED_PACKS_DIR` (`packages/`, or `resources/app/packages` packaged: the packs the app installs at first boot), `APACK_ENV`, `APACK_USER_DATA_DIR`.
- `process-manager.ts` parses stderr lines starting with `{"__fatal":` to report the crash.

Builds: `npm run dev` (root) runs `build:api:dev` → this package's `build:dev` (tsup, ESM `server.js` only, no tsc/dts/minify; the dev launcher builds default-setup first). `npm run build` runs `tsc --noEmit`, then tsup with ESM + CJS, `types.ts` declarations and minification. tsup bundles workspace packages from source (`@apackdev/source` + `module` conditions), stubs `.vue` imports. **It carries no pack's backend**: every pack's runtime is loaded from its own `dist/runtime/index.cjs` at boot.

## Logging and redaction (`src/adapters/logging.ts`)

Loggers and error reports are SDK code (`@apackdev/sdk/logger`): a bound `createLogger` redacts its entry and emits it as a log event on `rootEvents` (meta through a circular-safe copy, an `error` entry with a stack from `meta.error` or the call site); `reportError` without `step` emits a log event and a `SYSTEM_ERROR` to the `application` surface (redacted, with a user-safe message for `RepositoryError` NOT_FOUND). This file is the API's output of them:

- `printLogEvents()` prints every log event on `rootEvents` to the original console once (`[source] message meta`; `info` through `console.log`). `openAppStore()` starts it, so the db scripts print what they log too.
- `initializeLogCapture()` also replaces `console.log/debug/info/warn/error`: args are formatted with `util.formatWithOptions` (no colors), redacted and emitted as log events (`log` maps to `info`), which the printer prints. Nothing is printed twice (`log-capture.spec.ts`). `restoreConsole()` undoes the replacement; `originalConsole` holds the originals.
- The logs system (default-setup's `features/logs/be/system.ts`) subscribes with `onLog` (`@apackdev/sdk/logger`), which is why the app bus (`createAppBus(registry)`) doesn't route incoming events addressed to it.

## Type contract

`@app/api` exposes `src/types.ts` to TypeScript under the workspace `@apackdev/source` condition.
Other consumers use compiled `dist/types.d.ts`. Runtime resolution uses the compiled server entry.
API code, tests and scripts use file-relative imports, so source contracts need no consumer-specific
alias mapping or API build before the renderer can typecheck them.

## Tests

- `vitest.config.ts` `include` is `tests/**/*.spec.ts`, and a spec's path under `tests/` mirrors the source it
  covers: `transport/`, `adapters/`, `runtime/`, and `source-layout.spec.ts` at the root, whose subject is `src/`
  itself. `tests/integration/` holds none today (the pack load pipeline spec moved to `@apackdev/host`).
- Run: `npm test -w @app/api` (`vitest run`), `npm run test:watch -w @app/api`, a single file with `npm test -w @app/api -- secrets`. Root `npm run test:unit` runs this package first, then default-setup and `@apackdev/host`.
- Config: `globals: true`, `environment: 'node'`, `testTimeout: 15_000`, `@apackdev/source` plus Vite's server conditions (without `module`) for `resolve` and `ssr.resolve`, `.env` loaded with dotenv. There's no global env or data dir setup: specs that touch stores set `APACK_ENV=test` and `APACK_USER_DATA_DIR` to an `fs.mkdtempSync` dir, then call `openAppStore()` from `src/runtime/index.ts` (see `secrets.spec.ts`). `app-reset.spec.ts` and `packaged-boot.spec.ts` load the built-in packs' built runtimes, so run `npm run build:default-setup` first.
- Coverage by file: the files `src/` may hold (`source-layout`), the app bus's `CLIENT_CONNECTED` handling and `broadcastToSurface` dropped until a client connects, on this package's transport (`bus-client-connected`), the bound app's members (`bound-runtime`), each log event printed once (`log-capture`), data committed by one run read by the next through `openAppStore()` (`restart-persistence`), host data services, an app reset on the built-in packs leaving default settings, written flows and the app version (`app-reset`), current-format backup restore preserving preferences and onboarding completion (`host-data-services`), secrets procedures and redaction, the API's boot and `openAppDatabase` reading a data dir as the same entities, relations and roles (`app-database-parity`), the boot over the real shipped packs, each loaded from the built runtime in the directory it ships in, which is where an installed pack once took a shipped pack's role (`packaged-boot`) — and one spec for code outside this package (`claude-code-permission-shape`, a standalone Zod mirror of the Claude Code CLI's permission response). `app-reset` also shows the reset empties the app's state (`AppState`: onboarding and version).
- Typecheck: root `npm run typecheck:api` runs three projects here — `tsc -p .` (`src`), `tsc -p tsconfig.test.json`
  (`src` and `tests`, with `vitest/globals` so `describe`/`it`/`expect` are ambient in specs and nowhere else) and
  `tsc -p tsconfig.scripts.json` (`scripts/`). Leaving the specs out of a project lets them drift unseen: a call carrying an argument the
  callee dropped, a `Message` collected into a `Record<string, unknown>` array, a cast through types that no
  longer overlap — none of which a run can catch, since extra arguments and structural mismatches are invisible
  at runtime. A compile-time assertion about this package's own boundary
  can therefore live with it: the `Required<Omit<Message, 'client'>>` sample in `tests/transport/bus-send-sender.spec.ts` stops
  compiling when the message envelope grows a field.

## Scripts (`package.json`)

- `build`, `build:dev`, `start` (`with-source.mjs node dist/server.js`; needs the env vars from the root `CLAUDE.md`), `dev:serve` (`tsx --watch src/server.ts`), `dev:types` (`tsc --noEmit --watch`), `test`, `test:watch`.
- No database scripts: `apack db` (`packages/apack-cli/src/commands/db`, `docs/public-facing/cli.md`) reads and changes a data dir's database, and the root `db:*` scripts run it on the development data. `scripts/db/database.ts` opens a data dir's database through `openAppStore()`, the way the API boots it, for a one-off that needs to run pack code; there is no one-off today. The last was deleted with the apply fingerprints it reimplemented by hand, which is the failure mode to watch for in one: a script holding its own copy of a subsystem goes stale in silence while reading as though it still works.

## Gotchas

- `openAppStore()` (called by `setupBackend()`, and on import of `scripts/db/database.ts`) opens both databases and binds the app (once per process). Set the env first, and close the app before pointing anything that writes at its data dir; `apack db`'s reads open it read-only beside a running app.
- The engine's specs on elmdb live in `@apackdev/ears` (`tests/engine/`); the database's own are elmdb's.
- Every run — the tsup bundle, `dev:serve`, `scripts/db`, the specs — loads each pack from its built `dist/runtime/index.cjs`, so `npm run build:default-setup` is a prerequisite for all of them alike.
- Pack runtime specs (loading, lifecycle, reload, the bridge), the migrations runners' and `receiveClientEvent`'s live in `@apackdev/host` (`tests/packs/runtime/`, `tests/migrations/`, `tests/bus/`), not here.
- New code that isn't transport, boot or composition goes in `@apackdev/host`; `source-layout.spec.ts` fails on any other file under `src/`.
- Don't change the "WebSocket Server listening" log line or the `__fatal` stderr format without updating `packages/main/src/modules/api-server/process-manager.ts`.
- Secret values enter only through `secrets.*`; don't route them over `bus.send` (it logs every incoming event) or put them in events.
- Build before `start`: Electron runs `dist/server.js`, not source. `npm run dev` builds it once to get Electron off the ground and then **watches** (`build:dev:watch`), so an edit to `src/`, `@apackdev/host/src` or `@apackdev/sdk/src` rebuilds the bundle in ~100ms and main restarts the API child alone — the window stays up and resubscribes. Measured 2026-10-10: ~95ms to rebuild, 545ms for the API to come back ready. **In-memory state does not survive it** (running flows, the brain's actors); this is a restart, not HMR. Pack code still reloads in place through `POST /dev/reload`. The watch paths live in that script and not in `tsup.config.ts`, for the reason the config records: tsup watches a directory rather than the module graph, and a `--watch` flag overrides a config `watch` instead of merging with it.
