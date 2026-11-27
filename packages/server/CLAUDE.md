# @app/server

The backend process: an `@apackdev/link` + `muxTransport` server riding Electron `MessagePort` window channels and an optional user-private local tool socket, the root event bus, the process boot, and the composition that opens the app's elmdb databases (`@elmdb/ears/database`) for the EARS engines and binds the app. It holds nothing else: behaviour (systems, repositories, flows) lives in packs (`packages/default-setup`), and app runtime in `@apackdev/host`, including the pack runtime (`@apackdev/host/packs/runtime`: loading, lifecycle, reload, applying), the app bus (`createAppBus(registry)`, `@apackdev/host/bus`), the migrations runners (`@apackdev/host/migrations`) and the host services (`createHostRuntime()`, `@apackdev/host/services`); this package wires them together and serves them. `tests/source-layout.spec.ts` lists the files `src/` may hold. Environment variables and the manual boot command are in the root `CLAUDE.md` (App environment).

## Layout

`src/` is one folder per job this package does, and `packages/renderer/src` is the same four plus `views/`, so a
concept found in one is looked for in the same place in the other (`tests/source-layout.spec.ts` says so on
both sides):

| Folder | What belongs there | The renderer's counterpart |
|---|---|---|
| `boot/` | what runs before the app exists: env loading, fatal-error handling, process lifecycle bridge | `boot/` |
| `runtime/` | this process's resources (the store, the engine, the registry) and binding the app | `runtime/` |
| `transport/` | the wire to windows and local tools: `@apackdev/link` bus, Control RPC, tool socket server, root event emitter | `transport/` (the client) |
| `adapters/` | this process's implementations of what host code is given — today the console | `adapters/` |

`server.ts` and `types.ts` sit at the root. There is no `core/`, `shared/`, `lib/` or `utils/`: a folder
named for a layer rather than a job takes whatever nobody placed, and the guard rejects one. Anything that isn't
transport, boot or composition belongs in `@apackdev/host`, which the same guard is there to keep true.

## Source map (`src/`)

| Path | Purpose |
|------|---------|
| `server.ts` | Entry. Loads `.env` via `boot/env.ts` (`process.loadEnvFile()`), calls `installFatalErrorHandling()` (`boot/errors.ts`) and `installShutdownBridge()` (`boot/lifecycle.ts`, so a quit or dev reload arriving mid-boot exits cleanly before publishing transport), then runs `setupBackend()` and `startHostTransport()`. Any failure is written to stderr as a `{"__fatal": true, message, stack, source}` JSON line and the process exits 1 |
| `types.ts` | The `types` entry (`dist/types.d.ts`): `EARS`, `BaseEntity`, pack content preview types |
| `transport/` | `@apackdev/link` bus, Control RPC, tool socket & window port server, root event emitter, encoder, pack snapshots, diagnostics (below) |
| `adapters/logging.ts` | Log output (below) |
| `runtime/index.ts` | The composition: `openAppStore()`, which creates the app's registered packs, opens the store and binds the app (below), `setupBackend()`, the exported `appPacks` (the app's registry) and `backendActor` (`createAppBus(appPacks)`, with systemId `bus` from `@apackdev/host/bus`), and `logErrors(actor)` (an actor error observer that reports a fatal system error with `reportError` and writes a `__fatal` line). Packaged runs read their version from the same `build-manifest.json` main uses, whose path main passes as `APACK_APP_MANIFEST`; source runs use root `package.json` |
| `runtime/startup-performance.ts` | Captures backend startup performance spans until the renderer or diagnostics reads them |
| `transport/link-bus.ts` | `createLinkBus()`: `@apackdev/link` acceptor handling `bus.send`, direct asks, `views` `follow` subscriptions, outgoing event fan-out scoped by `client`, and participant claims (`host/drive`, `host/e2e`) released on disconnect |
| `transport/control-rpc.ts` | `createHostControlServer()` and `createHostPerformanceControl()`: off-bus Control RPC dispatcher (`secrets.*`, `settings.*`, `packs.*`, `performance.*`, `dev.reload`, `dev.install`) riding `@apackdev/host/transport/mux` |
| `transport/tool-server.ts` | `startHostTransport()`: writes `<appDir>/api-runtime.json` (`0600`), starts the local tool socket server in `development`/`test`/`APACK_TOOL_SOCKET=1`, attaches authenticated tool sockets and Electron `MessagePortMain` window ports to `createHostControlServer` and `createLinkBus`, and wires `registerWindowGoneHandler` for atomic per-window teardown |
| `transport/packs.ts` | `getLoadedPacks()` and `getPackCatalogFrame()`: loaded runtime snapshots and committed declaration catalog frames |
| `transport/diagnostics.ts` | Diagnostic tracing hooks for bus/view transport |
| `transport/encoder.ts` | Safe serialization helpers for BigInts and circular references |
| `transport/emitter.ts` | `rootEvents`, the single `RootEventEmitter` implementing SDK `RootEvents` |
| `boot/lifecycle.ts` | Structural `process.parentPort` bridge (zero `electron` dependency): early-boot shutdown listener (`SIGTERM`, `{ type: 'shutdown' }` on `parentPort`, Node IPC `disconnect`), `registerGracefulShutdown`, `registerPowerState`, `registerWindowPortHandler`, `registerWindowGoneHandler`, and `notifyServerReady(socket?)` (`{ type: 'ready', socket? }`) |

## Transport and the root event emitter (`src/transport/`)

- `tool-server.ts` — `startHostTransport()` mints a unique `connectionId` per attached window `MessagePort` (handed over by Electron main via `registerWindowPortHandler`) or authenticated local tool socket, and multiplexes each connection with `muxTransport` into two lanes:
  - `mux.link` → `createLinkBus()` (`link-bus.ts`): `@apackdev/link` session carrying bus sends, asks, outgoing broadcasts/replies, and view `follow` streams. `client` is stamped from the server-minted `connectionId` and never read from the wire, so it is a return address no client can forge.
  - `mux.control` → `createHostControlServer()` (`control-rpc.ts`): off-bus Host Control RPC methods (`secrets.*`, `settings.*`, `packs.*`, `performance.*`, `dev.reload`, `dev.install`).
- `link-bus.ts`:
  - `bus.send` — delegates to `receiveClientEvent(appPacks, { ...input, client: connectionId })` (`@apackdev/host/bus`), which checks `to` and `type` against the app's registered systems (a `*` entry accepts any type), logs the event's type, target and sender through the `app-events` logger — never its payload — and emits it on the bound root event bus.
  - Outgoing stream — subscribes to `rootEvents.onOutgoing` and filters on `client`: a message with no `client` goes to every connected client, and one naming a `client` goes only to that connection, so a window never receives a message that was not for it.
  - `views` (`follow`) — delegates to `appViews` (`createViewHost`, `@apackdev/host/views`, created in `openAppStore()` over the app's engine and registry). Subscriptions are torn down automatically when the link or window closes.
  - Participant claims — a connection may claim a ref (such as `host/drive` or `host/e2e`) so a system can answer it; claims are released atomically when the connection closes.
- `control-rpc.ts`:
  - `packs.loaded` / `packs.catalog` — reports accepted executable runtimes for frontend reconciliation and streams the common declaration catalog (including disabled/activation-failed packs) without loading their modules. Each frame carries a backend-run ID and committed catalog revision.
  - `packs.clientReady` — logs readiness and calls `rootEvents.emitPackClientConnected`, which the bus turns into `PACK_CLIENT_CONNECTED`.
  - `secrets.*` — `list`, `add`, `replaceValue`, `select`, `rename`, `delete`, `allowUnprotected`. Each calls `secretsStore` (`@apackdev/host/secrets`) directly, never the bus, and returns `secretsSnapshot()` (metadata and status, no values). `forwardSecretsChanges()` notifies systems that declare `SECRETS_CHANGED` without values.
  - `dev.reload` / `dev.install` — exposed only in `development` and `test` environments; both hold the registry's pack claim (`claimPackOperation`) and delegate to `reloadPackById` / `installDevPack`.
- `encoder.ts` — safe JSON/value encoding that handles `BigInt`s and breaks circular structures without throwing.
- `emitter.ts` — `rootEvents`, the single `RootEventEmitter` (it implements the SDK's `RootEvents`, and is the `transport` the app binds): `emitLog`/`onLog`, `emitConnected`/`onConnected`, `emitPackClientConnected`/`onPackClientConnected`, `emitIncoming`/`onIncoming`, `emitSurfaceSend`/`onSurfaceSend` (sends to surfaces from outside a system, which `createAppBus()` routes through the bus actor), `emitOutgoing`/`onOutgoing` (what the clients receive). `emitLog` also appends the event to `$APACK_LOG_DIR/app-events.log` (skipped when unset; write errors are swallowed).

Packs reach these modules only through the bound `HostRuntime` (`@apackdev/sdk/events` and `@apackdev/sdk/logger` send, log and report errors over `transport.rootEvents`), not by import.

## Binding the app and the store (`openAppStore()` in `runtime/index.ts`)

Importing `runtime/index.ts` opens and binds nothing. `openAppStore()` creates the app's registered packs (`createPackRegistry()` from `@apackdev/host/packs`, exported as `appPacks`; every later boot step registers into it) and opens the app's data with `openDatabaseStore({ path, schema: packs })` (`@apackdev/host/database`, the composition `apack db` opens a data dir with too): the elmdb database at `_getLmdbPath()`, held to the schema the registry declares, and the app's engine on it, and the run history's with `openRunHistory(_getRunHistoryPath())`, then `bindHost(createHostRuntime({ database, runHistory, engine, transport: { rootEvents }, appVersion: APP_VERSION, packs }))` (`@apackdev/host/services`, the only place the runtime is assembled; `APP_VERSION` is the root `package.json`'s version), and `printLogEvents()`. `bindHost` runs once per process: a spec that opens the database twice calls `unbindHost()` (`@apackdev/sdk/runtime/internals`) in between (`restart-persistence.spec.ts`). `bindHost` binds the engine, without `admin`, for `@apackdev/sdk/ears`'s operations; the composition keeps `admin` (host services); the SDK's registries of what packs registered read the bound registry. It returns `{ database, runHistory, engine, packs }`; the engine reads the database from then on, so there is nothing to load once the packs are registered. `setupBackend()` calls it first, and so do `scripts/db/database.ts` and the specs that touch stores. `APACK_ENV` and `APACK_USER_DATA_DIR` must be set before the call. This package keeps `elmdb` and `@elmdb/ears` as dependencies so the packaged app ships them (tsup leaves both external, so the host and the SDK it inlines share the one EARS installed beside the binding), but no code here imports `elmdb` (`check:specifiers`). It declares `msgpackr-extract`, EARS' `msgpackr`'s optional native codec, as an optional dependency of its own: electron-builder's collector leaves a linked package's dependencies' optional dependencies out, which `build/prod/verify-node-modules.mjs` refuses, and a direct declaration is what puts it in the packaged app.

## Boot (`runtime/index.ts`)

`setupBackend()` first calls `initializeLogCapture()` and `openAppStore()`, then, outside Electron's runtime, `assertSourceResolution()` (a checkout must resolve workspace `@apackdev/*` source, not `dist`). The rest of the order (host `packs` system, `prepareHostDataDirs`, `forwardSecretsChanges` (`@apackdev/host/secrets`), pack loading, early logs system, shutdown hooks, the boot reading (the database's size on disk and the heap), `onInit`, migrations (`runAppMigrations`/`runPackMigrations` from `@apackdev/host/migrations`), content, bus actor) is listed step by step in [the pack runtime's CLAUDE.md](../apack-host/src/packs/runtime/CLAUDE.md#boot-sequence-in-the-apis-setupbackendts). Actor errors go to `logErrors('Logs')` / `logErrors('Backend')`.

## Host transport (`transport/tool-server.ts`)

- **No TCP port is opened.** Electron windows connect over direct `MessagePort` channels brokered by Electron main (`registerWindowPortHandler` / `registerWindowGoneHandler`).
- Every run writes `<userDataDir>/api-runtime.json` (`0600`) with `{ pid }` (and, when the local tool socket is enabled, `{ pid, socket, token }`) via `writeApiRuntimeFile` (`@apackdev/host/transport/tool-socket`) so local tools can tell an app is running on the data dir and connect cleanly. The file and socket are removed on exit.
- In `development`, `test`, or when `APACK_TOOL_SOCKET=1`, `startToolSocketServer` binds a user-private Unix domain socket (or Windows named pipe) authenticated with a per-run random token (`tests/transport/tool-server.spec.ts`). In production, no tool socket is opened unless `APACK_TOOL_SOCKET=1` is set.
- Once ready, `server.ts` logs `✅ API Server ready` (plus the tool socket path when enabled) and calls `notifyServerReady(hostTransport.socket)` (`{ type: 'ready', socket? }` over Electron's `process.parentPort`).
- `setupBackend()` refuses to boot while a tool holds the data dir's database write lock (`assertNoDatabaseWriter`, `@apackdev/host/database`): `apack db` holds it while it changes the database, so the app never starts on data that is about to change under it (`tests/runtime/db-write-lock.spec.ts`).
- Shutdown: `process.on('exit')` disposes `hostTransport` (closing sockets and removing `api-runtime.json`), runs `appPacks.runShutdownHooks()`, and closes `elmdb` and `runHistory`. Graceful shutdown (`boot/lifecycle.ts`, wired from the top of `server.ts` to `SIGTERM`, `{ type: 'shutdown' }` on Electron's `process.parentPort`, and `process.on('disconnect')` on plain Node IPC) aborts cleanly after `setupBackend()` if shutdown arrived mid-boot, or disposes `hostTransport`, stops `backendActor`, and exits 0. If the Electron main browser process dies unexpectedly, Chromium's `UtilityProcessHost` tears down the utility process automatically.

## How Electron starts it

`packages/main/src/modules/api-server/` (`ApiServer.ts`, `config.ts`) forks `dist/server.js` via Electron `utilityProcess.fork` with `cwd` = `packages/server`:

- Runs on Electron's built-in Node 24 in both source and packaged runs (`ELECTRON_RUN_AS_NODE` is not set). From source, `getEnvironment()` appends `--conditions=@apackdev/source --enable-source-maps` to `NODE_OPTIONS` (Electron's `utilityProcess.fork` ignores `--conditions` in `execArgv`), and `ELECTRON_INSPECT=true` adds `--inspect=127.0.0.1:0` to `execArgv`.
- Env (`getEnvironment`): `NODE_ENV` (`development` / `production`), `APACK_STARTUP_ID`, `APACK_LOG_DIR` (main's log dir), `SHIPPED_PACKS_DIR` (`packages/`, or `resources/app/packages` packaged: the packs the app installs at first boot), `APACK_ENV`, `APACK_USER_DATA_DIR`.
- `process-manager.ts` line-buffers stderr so `{"__fatal":` JSON lines split across chunks are reassembled before reporting the crash.

Builds: `npm run dev` (root) runs `build:server:dev` → this package's `build:dev` (tsup, ESM `server.js` only, no tsc/dts/minify; the dev launcher builds default-setup first). `npm run build` runs `tsc --noEmit`, then tsup with ESM + CJS, `types.ts` declarations and minification. tsup bundles workspace packages from source (`@apackdev/source` + `module` conditions), stubs `.vue` imports. **It carries no pack's backend**: every pack's runtime is loaded from its own `dist/runtime/index.cjs` at boot.

## Logging and redaction (`src/adapters/logging.ts`)

Loggers and error reports are SDK code (`@apackdev/sdk/logger`): a bound `createLogger` redacts its entry and emits it as a log event on `rootEvents` (meta through a circular-safe copy, an `error` entry with a stack from `meta.error` or the call site); `reportError` without `step` emits a log event and a `SYSTEM_ERROR` to the `application` surface (redacted, with a user-safe message for `RepositoryError` NOT_FOUND). This file is the server's output of them:

- `printLogEvents()` prints every log event on `rootEvents` to the original console once (`[source] message meta`; `info` through `console.log`). `openAppStore()` starts it, so the db scripts print what they log too.
- `initializeLogCapture()` also replaces `console.log/debug/info/warn/error`: args are formatted with `util.formatWithOptions` (no colors), redacted and emitted as log events (`log` maps to `info`), which the printer prints. Nothing is printed twice (`log-capture.spec.ts`). `restoreConsole()` undoes the replacement; `originalConsole` holds the originals.
- The logs system (default-setup's `features/logs/be/system.ts`) subscribes with `onLog` (`@apackdev/sdk/logger`), which is why the app bus (`createAppBus(registry)`) doesn't route incoming events addressed to it.

## Type contract

`@app/server` exposes `src/types.ts` to TypeScript under the workspace `@apackdev/source` condition.
Other consumers use compiled `dist/types.d.ts`. Runtime resolution uses the compiled server entry.
Server code, tests and scripts use file-relative imports, so source contracts need no consumer-specific
alias mapping or server build before other workspaces can typecheck them.

## Tests

- `vitest.config.ts` `include` is `tests/**/*.spec.ts`, and a spec's path under `tests/` mirrors the source it
  covers: `boot/`, `transport/`, `adapters/`, `runtime/`, and `source-layout.spec.ts` at the root, whose subject is `src/`
  itself. `tests/integration/` holds none today (the pack load pipeline spec moved to `@apackdev/host`).
- Run: `npm test -w @app/server` (`vitest run`), `npm run test:watch -w @app/server`, a single file with `npm test -w @app/server -- secrets`. Root `npm run test:unit` runs this package first, then default-setup and `@apackdev/host`.
- Config: `globals: true`, `environment: 'node'`, `testTimeout: 15_000`, `@apackdev/source` plus Vite's server conditions (without `module`) for `resolve` and `ssr.resolve`, `.env` loaded with `process.loadEnvFile()`. There's no global env or data dir setup: specs that touch stores set `APACK_ENV=test` and `APACK_USER_DATA_DIR` to an `fs.mkdtempSync` dir, then call `openAppStore()` from `src/runtime/index.ts` (see `secrets.spec.ts`). `app-reset.spec.ts` and `packaged-boot.spec.ts` load the built-in packs' built runtimes, so run `npm run build:default-setup` first.
- Coverage by file: the files `src/` may hold (`source-layout`), transport (`control-rpc`, `link-bus`, `tool-server`, `emitter`, `encoder`, `view-diagnostics`), process lifecycle (`boot/lifecycle`), the app bus's `CLIENT_CONNECTED` handling and `broadcast` dropped until a client connects (`bus-client-connected`), the bound app's members (`bound-runtime`), each log event printed once (`log-capture`), data committed by one run read by the next through `openAppStore()` (`restart-persistence`), host data services, an app reset on the built-in packs leaving default settings, written flows and the app version (`app-reset`), current-format backup restore preserving preferences and onboarding completion (`host-data-services`), secrets procedures and redaction (`secrets`), settings recovery (`settings-recovery`), the boot and `openAppDatabase` reading a data dir as the same entities, relations and roles (`app-database-parity`), and the boot over the real shipped packs (`packaged-boot`).
- Typecheck: root `npm run typecheck:server` runs three projects here — `tsc -p .` (`src`), `tsc -p tsconfig.test.json`
  (`src` and `tests`, with `vitest/globals` so `describe`/`it`/`expect` are ambient in specs and nowhere else) and
  `tsc -p tsconfig.scripts.json` (`scripts/`).

## Scripts (`package.json`)

- `build`, `build:dev`, `start` (`with-source.mjs node dist/server.js`; needs the env vars from the root `CLAUDE.md`), `dev:serve` (`tsx --watch src/server.ts`), `dev:types` (`tsc --noEmit --watch`), `test`, `test:watch`.
- No database scripts: `apack db` (`packages/apack-cli/src/commands/db`, `docs/public-facing/cli.md`) reads and changes a data dir's database, and the root `db:*` scripts run it on the development data. `scripts/db/database.ts` opens a data dir's database through `openAppStore()`, the way the server boots it, for a one-off that needs to run pack code; there is no one-off today. The last was deleted with the apply fingerprints it reimplemented by hand, which is the failure mode to watch for in one: a script holding its own copy of a subsystem goes stale in silence while reading as though it still works.

## Gotchas

- `openAppStore()` (called by `setupBackend()`, and on import of `scripts/db/database.ts`) opens both databases and binds the app (once per process). Set the env first, and close the app before pointing anything that writes at its data dir; `apack db`'s reads open it read-only beside a running app.
- The engine's specs on elmdb live in `@elmdb/ears` (`tests/engine/`); the database's own are elmdb's.
- Every run — the tsup bundle, `dev:serve`, `scripts/db`, the specs — loads each pack from its built `dist/runtime/index.cjs`, so `npm run build:default-setup` is a prerequisite for all of them alike.
- Pack runtime specs (loading, lifecycle, reload, the bridge), the migrations runners' and `receiveClientEvent`'s live in `@apackdev/host` (`tests/packs/runtime/`, `tests/migrations/`, `tests/bus/`), not here.
- New code that isn't transport, boot or composition goes in `@apackdev/host`; `source-layout.spec.ts` fails on any other file under `src/`.
- Don't change the `✅ API Server ready` log line or the `__fatal` stderr format without updating `packages/main/src/modules/api-server/process-manager.ts`.
- Secret values enter only through `secrets.*` Control RPC; don't route them over `bus.send` (it logs every incoming event) or put them in events.
- Build before `start`: Electron runs `dist/server.js`, not source. `npm run dev` builds it once to get Electron off the ground and then **watches** (`build:dev:watch`), so an edit to `src/`, `@apackdev/host/src` or `@apackdev/sdk/src` rebuilds the bundle in ~100ms and main restarts the API child alone — the window stays up and attaches to a fresh `MessagePort` generation. Measured 2026-10-10: ~95ms to rebuild, 545ms for the API to come back ready. **In-memory state does not survive it** (running flows, the brain's actors); this is a restart, not HMR. Pack code still reloads in place through the `dev.reload` Control RPC over the local tool socket. The watch paths live in that script and not in `tsup.config.ts`, for the reason the config records: tsup watches a directory rather than the module graph, and a `--watch` flag overrides a config `watch` instead of merging with it.
