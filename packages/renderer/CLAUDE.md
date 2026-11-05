# @app/renderer

The Vue 3 app every apack window runs. It hosts surfaces; it doesn't implement them. Built-in surfaces come from `packages/default-setup` (compiled in), and external packs' surfaces load at runtime from `pack://`. The renderer owns the window: the tRPC client, the shared-dependency globals packs import through, the layout and Packs views, and the composition that ties them to the host's machines. What decides anything — the app shell, the Packs surface's machine, pack-frontend loading, the install a deep link asks for — is `@apackdev/host/fe`, as the app runtime behind the API is `@apackdev/host`. What this package renders is a feature's frontend half, which is a **surface**; `plugin` is reserved for a ProseMirror `Plugin` or a bundler plugin, and `packages/repo-checks/tests/surface-vocabulary.spec.ts` is the rule. The root `CLAUDE.md` covers the model; `docs/public-facing/architecture.md` ("Frontend boot", "Host dependency sharing") covers pack loading from a pack author's side, and `packages/apack-host/src/packs/runtime/CLAUDE.md` covers the backend half.

## Layout

`src/` is one folder per job this package does, and `packages/api/src` is the same five minus the last, so a concept
found in one is looked for in the same place in the other (`tests/source-layout.spec.ts` says so on both sides):

| Folder | What belongs there | The API's counterpart |
|---|---|---|
| `boot/` | what runs before the app exists: error reporting, the window's environment | `boot/` |
| `runtime/` | this window's resources and the frontend port binding | `runtime/` |
| `transport/` | the wire to the API: the tRPC client, the `ShellClient`, the secrets client | `transport/` (the routers) |
| `adapters/` | this window's implementations of ports the host defines (`ShellStorage`, `ShellNotify`, `PackFrontendIO`) | `adapters/` |
| `views/` | Vue: the app's roots, the layout, the Packs and Settings views | — the API renders nothing |

`main.ts`, `types.ts` and the ambient declarations sit at the root. There is no `core/`, `shared/`, `lib/` or
`utils/`: a folder named for a layer rather than a job takes whatever nobody placed, and the guard rejects one.

Tests live in `tests/`, mirroring `src/`, as in every other package.

## Boot (`src/main.ts`)

Its static imports are evaluated first, `virtual:host-shared-modules` among them — which has no runtime effect and is imported for the two side effects of its modules being in this window's graph (see the Vite section). The body then runs with a top-level `await`, in this order:

1. `installGlobalErrorHandling()` (`src/boot/errors.ts`): the Monaco error filter, then this window's `window.error` / `unhandledrejection` reporters (`electronAPI.rendererLog.write`, `fatal: true`). One call, because the filter only works when it is registered first. Reads `?popout=surface&surfaceId=…` (set by main's `surface:popout`).
2. Sets `window.appVersion` (`__APP_VERSION__`, the root `package.json` version) and runs `runWindowStorageMigrations(localStorage, __APP_VERSION__)` (`@apackdev/host/fe`), which moves what this window keeps in its storage forward before the shell reads those keys. The migrations are the host's (`src/fe/window-storage/`); the window only says where its storage is and which version it is.
3. The host's own frontend: `fePacks.registerPackFE(hostFrontend)`, without a pack id, so it can't be unregistered. **No pack's frontend is registered here** — every one, the app's own included, is loaded by the shell once the bus says which packs are running. `fePacks` (`src/runtime/packs.ts`) is this window's registered pack frontends, `createFePackRegistry()` from `@apackdev/host/fe`: the pack loader registers each pack's in it, `App.vue` reads the `welcome` app extension from it, and the SDK's frontend registries (steps, designations, text editor extensions, DSL types) read it once bound.
4. Creates the app shell, `createAppShell()` (`src/runtime/shell.ts`), with `systemId: 'host/application'` (its machine id stays `application`, which its `#application.…` targets name) and input `{ initialSurfaceId, ownsLastActiveSurface: !popout }` (a main window opens on the surface last open and records the one it opens; a popout does neither). It starts with the surfaces registered in `fePacks` and the default a pack claims. It is exported as `applicationState`.
5. Binds the SDK's frontend port, `bindRendererHost(applicationState)` (`src/runtime/index.ts`: `bindFeHost({ application, secrets, client: feClient, packs: fePacks })`), then starts the actor, so the binding is in place before any surface runs or any external pack frontend loads:
   - `application` backs `@apackdev/sdk/fe`'s `untypedOpenSurface` and its neighbours;
   - `secrets` is `src/transport/secrets.ts`, the API's secrets procedures behind `secretsClient` (the only ones pack frontends call directly);
   - `settings` is `src/runtime/settings.ts`, the `SettingsPort` behind `@apackdev/sdk/fe`'s settings composables. It reads the running Settings view's actor, found by the `settings` role rather than by name, so what a feature reads of its own settings doesn't name the view that draws them;
   - `client` is `feClient` (`src/transport/client.ts`), the window's one client to the API: the `ShellClient` from `@apackdev/host/fe`. Its `send` is how `@apackdev/sdk/events`' `sendToSystem` sends here, over `bus.send`, reporting a rejected send to the console, the app's log (`fe-client` source) and a toast, without the payload. The shell (`createAppShell()`) subscribes through it, and reads the loaded packs and asks for packs' startup data through it; it follows the API across a restart on a new port (Electron's API status). Views do not call `trpc.bus` or `trpc.packs`. `runtime/catalog.ts` owns the independent `packs.catalog` declaration subscription; the shell client starts/stops its connection lifetime without gating pack activation on it. Surface sends and subscriptions throw (no backend app is bound in the renderer).
6. Sets the globals:
   - `window.applicationState` is the actor. The E2E fixture (`@apackdev/testing`) finds the main window by it and drives it.
   - `window.__disableOnboardingUI()` sends `ONBOARDING_COMPLETE`.
   - `window.__sendToSystem` is `untypedSendToSystem`, for the E2E suite: a send to a backend system is otherwise only reachable over the API's tRPC WebSocket, which is a client to stand up rather than a call to make.
7. Subscribes to `protocolAction`: `apack://install?pack=…&sourceKind=…` → `installFromProtocol` (`@apackdev/host/fe`), which reads the parameters and sends `INSTALL_PACK` to the `packs` system.
8. Mounts `views/App.vue`, sets a Vue `errorHandler`, then calls `electronAPI.rendererReady()`, which tells main to show the window.

`App.vue` renders `SurfacePopoutApp.vue` (one surface, `PopoutTitlebar`) for popouts, else `WebApp.vue` (toolbar, canvas and chat areas, inspection panel), plus the `welcome` app extension while the actor has the `welcome` tag, and an overlay while it has `connecting`. `index.html` defines `window.__showErrorPage(title, detail)`, the static error page, whose buttons call `electronAPI.apiStatus.reload/relaunch/openLogFile`.

## Vite (`vite.config.ts`)

- **`devPackFrontendsPlugin(command === 'serve')`**, over `discoverDevPackFrontends` (`@apackdev/host/build/discover`):
  - `virtual:dev-pack-frontends` exports `{ [packId]: () => import('<abs path to pack-entry-fe.ts>') }` for each local pack whose codegen wrote that file — the packs under `packages/`, plus any directory `APACK_DEV_PACK_DIRS` names. **Serving a pack's frontend from source is the whole of what the dev server adds, and the only reason a `.vue` edit patches the component**: the pack's modules are in this graph, so Vite has an accepting importer to stop the update at. The map is empty for `vite build`, where each pack's frontend is fetched over `pack://` from the bundle its own `apack pack build` wrote. It grants no manifest shipping privilege — a pack is in it because its source is on this disk.
  - `@/…` resolves into `renderer/src/`, whoever imports it — the renderer's own alias and nothing else's (`tsconfig.app.json` maps it the same way). A pack names its own modules with `#` subpath imports, which Node, Vite and esbuild resolve from the pack's own `package.json` without this hook, so the alias is not per-importer and no other bundler config implements it; `check:specifiers`' `pack-own-aliases` refuses a `@/` in pack code, which would resolve for `tsc` and for nothing else.
- **`hostSharedModulesPlugin`** is how a pack gets *this app's* Vue, XState and SDK instance (with the
  frontend host it binds): **by resolution**, not through a global. `sharedFeModules()`
  (`@apackdev/host/build/shared-deps`) maps every specifier a pack may leave external to the module the host
  loads for it — the shared deps, `getSdkFeModules()`, and every `@apackdev/ui` export. The surface then:
  - serves each distinct module. In `vite build` each is an extra `rollupOptions.input` entry with
    `preserveEntrySignatures: 'exports-only'`; **only when building**, because naming `input` also makes the
    dev server crawl those entries for dependency discovery in place of `index.html`, and a bare specifier
    is not something it can crawl.
  - injects `<script type="importmap">` ahead of the app's script (`transformIndexHtml`, `head-prepend`), so
    it is parsed before any module resolves against it. A popout loads this same document and inherits it.
  - `virtual:host-shared-modules` imports them for development discovery only; production returns an empty module and serves the separately emitted import-map entries on demand. It is in the graph for
    two reasons: in **dev** it is what the map is read from — transforming it hands back the URLs Vite serves
    each module at, which cannot be derived (measured 2026-10-08, this app's deps carried four different
    `?v=` hashes at once, and a URL differing by one is a second copy of the module) — and it is how the dep
    optimizer hears of the ProseMirror subpaths, which nothing else imports.

  The pack FE bundler leaves those same specifiers external. The two cannot drift because
  `sharedFeModules()` is *derived* from the three lists the bundler checks against rather than written
  beside them — and `fe-bundler-externals.spec.ts` asks the question directly, that every specifier a
  bundle leaves bare is one this map names.
- **Resolution:** conditions include `@apackdev/source`. The API's router type comes from `@app/api` (a type-only import, a dev dependency).
- `base: './'` (loaded from `file://` in builds), `modulePreload: false`, and a long `optimizeDeps.include` list (Monaco, xterm, tiptap, vidstack, …) for the dev server.
- `tsconfig.app.json` includes `../apack-sdk/src/fe/**/*` (the `Window.electronAPI` declaration, see `packages/preload/CLAUDE.md`) and maps `@/*` → `src/*`.

## tRPC client (`src/transport/index.ts`)

- Connects a `wsLink` to `ws://${API_HOST}:<electronAPI.apiPort>` (port default 3001) with `ApiSocket`, which offers the subprotocols `apack` and `apack-token.<electronAPI.apiToken>`; the API refuses connections without the token. The token isn't in the URL, which the browser prints on a failed connection. `AppRouter` is a type-only import from `@app/api`.
- `trpc` is a `Proxy` over the current connection, so importers keep one binding across reconnects.
- `reconnectApiClient(port)` closes the socket and reconnects only when the port changed, returning whether it did. A restart on the same port keeps the socket; the ws client reconnects on its own.

## App shell (`src/runtime/shell.ts`)

The shell's machine is the host's: `createShellMachine` in `@apackdev/host/fe` (`packages/apack-host/src/fe/shell/`, described in `packages/apack-host/CLAUDE.md`). This file only composes it with the window's I/O, as `createAppShell()`:

| Option | The renderer's |
|---|---|
| `packs` | `fePacks` (`src/runtime/packs.ts`): the surfaces the shell starts with, and its default |
| `client` | `feClient` (`src/transport/client.ts`): the bus subscription, sends, the loaded packs, `packClientReady`, and the connection's description for the error page (Electron's `apiStatus`) |
| `packFrontends` | `createPackFrontends(packFrontendIO, fePacks)` (`@apackdev/host/fe`), over this window's `import()` and stylesheets (`src/adapters/pack-frontends.ts`) |
| `storage` | `windowStorage` (`src/adapters/storage.ts`): `localStorage`, under `apack-panel-sizes` |
| `notify` | `windowNotify` (`src/adapters/notify.ts`), over `globalToast` (`src/adapters/toast.ts`, which queues until `WebApp` registers the toast component) and `window.__showErrorPage` |
| `target` | `window`, which the hotkey and mouse listeners attach to |

It re-exports nothing: `WebApp.vue` takes `neighbourOf` from `@apackdev/host/fe`. Saved panel sizes that aren't JSON fall back to the defaults rather than failing the window's shell (`tests/runtime/shell.spec.ts`).

## External pack frontends

The shell owns loading (see the host doc), and the rules are the host's too (`@apackdev/host/fe`, `fe/packs/frontends.ts`):
a pack's file URLs, what counts as a registration, and what unloading undoes. This window supplies the two things only
a browser can do, as `PackFrontendIO` (`src/adapters/pack-frontends.ts`):

- `importModule(url)` is the dynamic `import()` of `pack://<id>/<feEntry>`.
- `styles.add(packId, href)` adds a `<link data-pack-id>` once per href and resolves when it has loaded or failed;
  `styles.remove(packId)` takes that pack's stylesheets out.

On `PACK_DEACTIVATED` the Packs machine tells the shell `PACK_SURFACES_UNLOADED`, and the shell unloads the pack's
frontend and drops its surfaces — it loads them, so it takes them out.

## Packs view (`src/views/packs/`)

The Packs tab's components, and the one module that composes them: `surface.ts` pairs the host's `packsMachine`
(`@apackdev/host/fe`) with the view (`index.vue`, the list, and `PackDetail.vue`) and registers it as the `host` pack's frontend.
Nothing here decides anything about packs: what would is the host's, and `tests/source-layout.spec.ts` keeps the
view and its one composition module the only things here. `surface.ts` is where `hostFrontend` lives, so the Settings
view registers there too.

## Settings view (`src/views/settings/`)

The Settings tab, laid out as the Packs view is: the canvas, its three tabs (General, Surfaces, Help) and the General
components, over the host's `createSettingsMachine` (`@apackdev/host/fe`). The settings themselves are the app's
(`packages/apack-host/src/features/settings/`) — this is only what draws them. Two sections a pack contributes,
`general` and `assistant`, are default-setup's content; the components read them as data and the host stores them
opaquely. `feature-settings.ts` reads a slice by name from settings in hand, `save.ts` is the composable the forms
use for a change and whether the store stored it, and the Surfaces tab renders each surface's own `settings` component
in a `SurfaceScope` for that surface, so a form's `useSurface()` reaches the surface it configures.

## Tests and checks

- `npm test -w @app/renderer` runs vitest in jsdom over `tests/` (`vitest.config.ts` merges `vite.config.ts`), and `npm run spec -- <name>` runs one of them. Root `npm run test:unit` runs the suite too, as CI does.
  - `tests/source-layout.spec.ts` keeps each folder to its job; `tests/views/packs/pack-detail.spec.ts` covers the Packs detail component.
  - The shell's specs, the Packs machine's and the pack-frontend loader's live with them, in `packages/apack-host/tests/fe/`.
- `npm run typecheck:renderer` (root) runs `vue-tsc --app`. `npm run build -w @app/renderer` type-checks and runs `vite build` in parallel. `lint:check` runs oxlint and then eslint; `lint:fix` runs both with `--fix`. The bare-named one is the safe one, so nothing rewrites the tree unless you asked it to.


## Local editor assets

The renderer provides a window-owned asynchronous Monaco resource with `provideMonacoRuntime`
(`@apackdev/ui/components/monaco-config`) before mounting Vue. The first editor consumer imports
`src/boot/monaco.ts`, which configures the shared Vue editor loader and Vite-built
editor/JSON/CSS/HTML/TypeScript workers. Concurrent consumers share loading; editor components
wait for it before mounting their Monaco child. No editor or worker CDN request is needed.
Vite gives Monaco its own vendor chunk so recoverable cancellation can be attributed to its origin
frame; application errors called through Monaco still reach the fatal error reporter. The external
settings JSON test blocks non-local HTTP and exercises real schema completion, validation and saving.
