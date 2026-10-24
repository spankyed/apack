# Architecture

This chapter covers how packs work under the hood: loading, dependency sharing, generated files, and the build pipeline. You don't need this to write a pack, but it helps when debugging or doing advanced work.

## App environment and data directory

Every process resolves its environment and data paths through `resolveAppEnvironment()` (`@apackdev/sdk/env`).

- **Environment:** `production`, `beta`, `development` or `test`. The Electron main process decides it once: Playwright runs are `test`, packaged builds use the channel stamped at build time, and source runs use `APACK_ENV` or default to `development`. It passes `APACK_ENV` and `APACK_USER_DATA_DIR` to the API process. A process that gets neither, and isn't given `{ env }`, throws; nothing falls back to production.
- **Data directory:** `APACK_USER_DATA_DIR` if set, otherwise the platform's app data dir for the environment's app name (`apack`, `apack-beta`, `apack-dev`, `apack-test`). On macOS that is `~/Library/Application Support/<appName>`.

| Path under the data dir | Contents |
|---|---|
| `packs/` | Installed packs, one directory per pack id — every pack, the ones the app ships included |
| `installed-packs.json` | Installed packs' install state and their `enabled` state |
| `ears-db/` | The LMDB database the engine's data is kept in |
| `run-history/` | The run history: every flow run's record, kept 30 days |
| `secrets.json` | API keys: metadata plain, values encrypted |
| `media/` | Media assets |
| `api-port` | The API's port (development only) |
| `api-token` | The token the API requires, for local tools (development only, readable only by you) |

CLI commands pass `{ env }` explicitly: `apack pack install`/`apack pack uninstall`/`apack pack list` target production unless given `--profile development` (development) or `--profile beta` (beta).

## Layers

The app is built from packages whose imports point down only (`npm run check:specifiers` fails on an upward import):

| Package | Holds | Imports |
|---|---|---|
| `@apackdev/ears` | The EARS engine (`createEarsEngine`), its types, the persistence port; `@apackdev/ears/lmdb`, the LMDB store | No `@apackdev/*` package |
| `@apackdev/sdk` | The pack contract and pack runtime: the lookups of what packs registered, service contracts, event sends, logging and error reports over the bound bus, the SDK entities and their repositories, the `HostRuntime` port | `@apackdev/ears` |
| `@apackdev/host` (private) | The app runtime: the five app services (`/services`), the app's own state (`/app-state`), the registered packs and pack runtime (`/packs`, `/packs/runtime`), the bus (`/bus`), migrations (`/migrations`), API keys (`/secrets`) | `@apackdev/sdk`, `@apackdev/ears` |
| `packages/api` | Transport (`node:http`, `ws`, tRPC routers, the log stream), process boot and composition | All of the above |
| `packages/renderer` | The frontend composition: binds the frontend port | |

Packs import `@apackdev/sdk`, `@apackdev/ears` and `@apackdev/ui`, never `@apackdev/host`. What an app owns is an instance its composition root creates and binds: the engine, the registered packs (`createPackRegistry()`, and in the renderer `createFePackRegistry()`) and the host services. No SDK, EARS or host module keeps them at module scope.

## Pack loading lifecycle

### Install

`apack pack install` (or the Packs view) installs into the data dir's `packs/<id>/`. An installed pack has the pack layout, the same layout as `apack pack build`'s `dist/` and the release archive:

```
<id>/
  apack.json          # The pack's manifest, as written
  integrity.json          # Format version, versions, provenance, sha256 of every file
  runtime/
    index.cjs          # Backend: exports `registration` and `setCompiledDir`
    fe.js              # Frontend entry
    fe.css             # Extracted styles
    content/             # Compiled content
  build/               # Build-time code dependents load (step build facets, content runtime)
  types/
    snapshot.json      # Types, manifest, SDK version, flow helpers for dependents' codegen
```

Installing is stage, verify, place:

1. **Stage:** a built pack source is copied into a temporary staging directory (`runtime/`, `build/`, `types/` from `dist/`, without source maps), carrying the verified producer manifest and expected file hashes; staging does not re-sign arbitrary copied bytes. An archive — `.tgz` or `.zip` — is checked against its sha256 before anything is unpacked. A GitHub install takes that checksum from the release's `<archive>.sha256` asset and refuses a release that publishes none; a URL install has one only if the caller passes it, and warns when it doesn't. Downloads carry a two-minute timeout, so a stalled one fails instead of hanging the install.
2. **Verify:** the pack's format version must match the host's, and the files on disk must be exactly the ones `integrity.json` lists, with matching checksums.
3. **Place:** the staged pack is copied into a hidden `.<id>.installing-<pid>-…` dir in `packs/`, the current copy (if any) is renamed aside to `.<id>.previous-…`, the new copy is renamed into place, and the previous one is removed. At boot, `prepareHostDataDirs` restores a pack whose install crashed between those renames, unless the pack was uninstalled since, and removes stale staging dirs (a dir whose process is gone, or which predates the boot).

The source directory must be built first: installing a directory with neither a `integrity.json` nor a `dist/runtime/index.cjs` beside `dist/types/snapshot.json` fails and asks you to run `apack pack build`. A directory in `packs/` that isn't a pack layout is skipped at boot with a warning.

### Backend boot

`setupBackend()` in `packages/api/src/setup/backend.ts` runs, in order. The API holds only transport, process boot and this composition: the app runtime it calls lives in `@apackdev/host` (pack loading, lifecycle, reload and writing in `@apackdev/host/packs/runtime`, the migrations runners in `@apackdev/host/migrations`, the bus in `@apackdev/host/bus`).

0. Opens the app's data and binds the app (`openAppStore()`): it creates the app's registered packs (`createPackRegistry()` from `@apackdev/host/packs`), which the SDK's lookups read once bound, and the rest of the steps register into it.
1. Registers the host `packs` system.
2. `prepareHostDataDirs`: records the app version in the data dir (for `apack pack install`) and recovers staging dirs in `packs/`.
3. `forwardSecretsChanges` (`@apackdev/host/secrets`): every system that takes `SECRETS_CHANGED` hears that API key changes, never their values.
4. Installs the packs the app ships into `packs/<id>`, each being a directory under `SHIPPED_PACKS_DIR` that holds an `apack.json`. Missing defaults are installed unless deliberately suppressed. Existing user-managed replacements are preserved; explicitly app-managed copies refresh when the shipped source revision changes. This is before loading, not beside it: a pack is loaded from `packs/`, so it has to be there to be found.
5. Loads packs — one path for all of them, the ones the app ships included. Discovered in `packs/` and reconciled with `installed-packs.json` (new packs added enabled, missing ones removed), the shipped ones ordered first so a pack depending on one finds it registered. For each enabled pack: `hostVersion` check, pack layout format check, a warning on an SDK major version mismatch, and `runtime/index.cjs` loaded from its own installed directory through the module bridge. A pack with no built runtime, or one whose load throws, has a load problem recorded and the rest load. Each pack's systems register as `<packId>/<featureId>`, and the registry's `registerPack()` stores each registration (see [Collision detection](#collision-detection)). A pack contributes only through its registration: nothing registers when its modules are imported.
7. Wires each pack's `onShutdown` hook, keyed by pack id.
8. Hydrates the app's engine from LMDB. Every pack's entity types are registered by now, so the engine knows them all.
9. Runs every pack's `onInit`.
10. Runs app migrations (`runAppMigrations`: the host's own, then the built-in packs', against the app version), then external pack migrations (`runPackMigrations`, each against its own pack version).
11. Content: each built-in pack's declarative `content.sources`, then external packs' compiled content, skipped when a pack's content revision hasn't changed.
12. Starts the bus actor (`createAppBus(registry)` from `@apackdev/host/bus`), which spawns every registered system.

### Frontend boot

Every pack's frontend is loaded at runtime, the ones the app ships included. A dev server serves a local pack's from its source instead (`virtual:dev-pack-frontends`), which is what lets a component edit patch in place:

1. Each time this window's bus subscription is established, the application actor queries the loaded packs (`trpc.packs.loaded`), which lists each loaded external pack's `feEntry` and `feStyles` — the pack's `runtime/fe.js` and `runtime/fe.css`, when it has them. It loads only the packs it hasn't loaded yet, so a query that fails leaves them to the next connection and a pack is never loaded twice.
2. For each external pack, the shell loads its frontend (`createPackFrontends(io, packs).load` in `@apackdev/host/fe`, over the window's `importModule` and stylesheet I/O):
   - loads `pack://<id>/builds/<revision>/runtime/fe.css` as a `<link>` when the pack has styles;
   - imports `pack://<id>/builds/<revision>/runtime/fe.js` and registers its default export, a `PackFERegistration`, in the renderer's frontend registry (`createFePackRegistry()` from `@apackdev/host/fe`, bound with `bindFeHost`);
   - returns the surfaces it exports, `[]` when the load failed, or `null` for a pack without frontend code.
3. When it returns surfaces (even none), the shell handles `PACK_FRONTEND_LOADED`, which spawns the surfaces whose ids aren't taken and calls `trpc.bus.packClientReady({ packId })`.
4. `packClientReady` sends the pack's systems `CLIENT_CONNECTED` and asks them to publish, so they send their startup data once the surface actors exist.

A connection's own `CLIENT_CONNECTED` skips the systems of external packs with frontend code (the bus asks `getPacksWithClientLoadedFrontends()`). When the renderer's bus subscription (re)connects, `BUS_SUBSCRIBED` calls `packClientReady` again for every pack whose frontend it loaded. Systems of packs without frontend code are told and asked directly.

### Activation, teardown and reload

The `packs` system handles install, uninstall, enable/disable and update from the Packs view:

- **Activate** (after install or update, or on enable): reads the pack's manifest, loads and registers it, registers `onShutdown`, runs `onInit`, then the pack's pending migrations and its content (skipped when its compiled content are unchanged), sends the bus `PACK_CHANGED` so running systems refresh what they read from packs, then `ACTIVATE_PACK` to spawn its systems. The renderer hears `PACK_ACTIVATED` and asks the application actor to load the frontends it hasn't, the new pack's included. The bus asks a pack's systems to publish right away only for a pack without frontend code; otherwise it waits for `packClientReady`. An install or update that activated but failed to apply reports the content error.
- **Teardown** (before uninstall or update, or on disable): runs the pack's shutdown hooks, unregisters it (registration keeps the event types `bus.send` accepts current), clears its modules from the require cache, and sends the bus `TEARDOWN_PACK` to stop its systems. The renderer hears `PACK_DEACTIVATED`, unregisters the pack's FE extensions, removes its stylesheets and unloads its surfaces.
- **Reload** (development, `POST /dev/reload` on the API from `apack pack dev` or a built-in pack's watch build; a development or test app takes it only with the API token, handled by `reloadPackById` in `@apackdev/host/packs/runtime`, which asks the registry which directory the pack came from): loads and registers the rebuilt runtime before shutting the running one down. If the fresh runtime fails to load or register, the running pack is re-registered and stays as it was. Otherwise the old shutdown hooks run, the new `onShutdown` registers, `onInit` runs, external packs run their pending migrations and re-apply, and the bus `RELOAD_PACK` stops the old and new system ids and starts those still registered, then sends them `CLIENT_CONNECTED` and asks them to publish; `PACK_CHANGED` and its ask follow for every running system. Teardown (disable, uninstall) sends it too, after stopping the pack's systems.

An external pack's migrations run at boot, on activation and on reload, each against the pack's own version; the app's run at boot and after a reset or backup import.

## Entry contracts

### Backend entry (`PackRegistration`)

Your `__generated__/pack-entry.ts` exports a registration object (`@apackdev/sdk/framework`):

```typescript
export const registration: PackRegistration = {
  id: string;
  features?: Record<string, PackFeature>;  // by feature id: { designation?, system?: { machine, receives, early? }, surface?: { receives }, services?, settings? }
  services?: Record<string, unknown>;
  ears?: PackEARS;                 // entities, relKinds
  lifecycle?: PackLifecycleHooks;            // onInit/onShutdown (lifecycle.onInit / lifecycle.onShutdown)
  migrations?: PackMigration[];    // { target, description, up }
  repositories?: Record<string, unknown>;  // features.<id>.repositories, registered with the app's engine
  steps?: StepDefinition[];
  artifacts?: ArtifactDefinition[];
  blocks?: BlockDefinition[];
  content.writers?: Record<string, ContentWriter>;  // apack.json `content.writers`, keyed by entity type
  appliers?: ContentApplier[];              // one per content.sources key, which applying the pack's compiled content runs
};
```

The app runs each feature at `<packId>/<featureId>`. Its declared contract supplies system inputs and outputs and surface inboxes; the build writes those event names into static snapshot data and generates matching runtime bindings. Explicit `system.events.incoming` entries add routing names. Shared SDK lifecycle events remain implicit. Discovery reads the catalog without activating the pack; the bus uses the captured contracts of endpoints that actually bound. A machine's private handlers do not add public inbox entries.

The runtime bundle also exports `setCompiledDir(dir)`, which the host calls with the directory of the pack's compiled content.

The native host frontend registers the `reference` document node from `@apackdev/ui` before external
pack frontends load. Its declaration is part of the common native catalog. Parsing saved references
therefore does not require default-setup; that pack owns only its suggestion extension and popup UI.

### Frontend entry (`PackFERegistration`)

Your generated frontend entry exports its declaration revision and executable bindings:

```typescript
export default {
  id: string;
  declarationRevision: string;
  features?: Record<string, {
    surface?: SurfaceDefinition;
    designation?: string;
    default?: true;
    settingsForm?: Component;
    references?: ReferenceBindings;
  }>;
  settingsForms?: Record<string, Component>;
  steps?: StepDefinition[];
  textEditor?: Record<string, TextEditorExtensions>;
  appExtensions?: Record<string, Component>;
  artifacts?: ArtifactDefinition[];
  blocks?: BlockDefinition[];
} satisfies PackFERegistration;
```

Both entry files are generated by `apack pack build`. The host admits installed frontend bindings against
its accepted backend declarations and revision. Native host composition supplies its own declarative
contract. Serving a frontend through a development server changes delivery, not declaration authority.
Pack code contributes through its registration; it cannot write the host's registry directly.

Frontend preparation captures metadata and slot membership before checking or binding settings. It keeps
actual machines, components and callbacks intact. Refused or stale candidates preserve accepted lookups;
provisional settings resources are retired. Catalog declarations have a separate lifetime from active code.
`getStepFrontendBindings()` from `@apackdev/sdk/fe` exposes active step bindings with the accepted owner,
declaration and host-issued revisions. Runtime/build revisions identify the accepted backend; source
delivery is a separate concern. Native bindings have no installed build stamp.

Native content declares `content.writers` and `content.sources.<key> = { applier: "path.ts" }`.
Writers must belong to entities declared by that native pack, under a feature or `data.entities`.
These references describe composition bindings; discovery never imports them. Native appliers run
through `importCompiledContent` with an explicitly supplied compiled-content directory. Native
composition does not declare source paths/formats or datasets to compile, and automatic application
continues to target installed builds. Both native and built backend bindings must match declared writer
and applier names before receiving runtime authority.

Native composition may also declare the same `migrations.app` and `migrations.pack` maps as authored
packs. App-line changes use the app version. Pack-line changes require the native owner's `version`;
it is never inferred from the app version. Checked migration targets, descriptions and callbacks are
captured at admission. Native and installed owners share migration targeting and dependency ordering,
while discovery reads only declaration data. No installed directory or manifest is invented for native
migrations.

### Collision detection

The host refuses conflicting active ownership before publishing registry lookups:

| What | Checked against |
|---|---|
| Pack id | Registered packs |
| Entity types, relation kinds | Other owners; SDK-owned declarations are refused |
| Step wire types | Other active pack owners; facets from different packs do not merge |
| Service keys | Other packs' keys and the host's services |
| Designations | Other packs' roles |
| Reference identities | Other declaring features, naming both owners |
| Tiptap extension names | Other groups, naming both owners |
| Content writers | Other packs' writers for the same entity type |
| Content appliers | Other appliers for the same content key in the pack |
| Commands | Other packs' command names |

Artifacts, blocks, app-extension slots and DSL keys retain registration-order precedence; removing an
owner reveals contributions from earlier owners. Settings use pack/group or fully qualified feature identities. Writes and resets obey declared dependency
access and opt-in owner restrictions. Registry publication is separate from runtime activation: preserving
an accepted lookup view does not undo arbitrary effects of executable pack code.

## The `pack://` protocol

The installed asset protocol binds every request to an accepted build:

```
pack://<packId>/builds/<buildRevision>/<filePath>
```

The main process verifies the requested build and file receipt under that pack's installed directory.
Traversal and requests without a build revision are refused. A development frontend uses the explicit
source delivery supplied by the host; it does not change installed protocol identity or declaration
checks. The renderer uses revision URLs for built frontend entries, styles and assets.

## Host dependency sharing

### Frontend: an import map

Packs share runtime dependencies with the host, which is critical for correctness — modules with internal state (Vue's reactivity system, XState's actor registry, the SDK's bound frontend host, which its lookups read) must be singletons. The sharing is done by **resolution**: a pack's bundle keeps the bare specifier, and the document's import map resolves it to the host's module.

**Host side (Vite):** each shared module is an entry of the renderer's build, and the plugin injects an import map naming them ahead of the app's own script:

```html
<script type="importmap">
{ "imports": {
  "vue": "./assets/shared-vue-CwIGn1C6.js",
  "@apackdev/sdk/fe": "./assets/shared-apack-sdk-fe-DY7mM_D0.js",
  "@tiptap/pm/model": "./assets/shared-prosemirror-model-YOzlPTVh.js"
} }
</script>
```

In a dev server the targets are the URLs Vite serves those modules at instead (`/node_modules/.vite/deps/vue.js?v=…`, or `/@fs/…` for a workspace package), so the same mechanism covers both.

**Pack side (Vite):** `packExternalsPlugin` leaves every shared specifier **external**, so the pack's bundle emits it untouched:

```javascript
// import { ref } from 'vue'  stays exactly that in dist/runtime/fe.js
import { ref } from 'vue';
```

Because the pack imports the real module rather than a copy of its names, what it gets is a live binding, and an import of a name this apack does not have fails when the module links — naming the export — instead of arriving as `undefined`.

#### Shared third-party deps

`vue`, `xstate`, `@xstate/vue`, `@tiptap/core`, `@tiptap/vue-3`, `@tiptap/starter-kit`, `reka-ui`, `lucide-vue-next`, `@vue-flow/core`, and every subpath of `@tiptap/pm` and `@tiptap/vue-3`

#### Shared SDK modules

`@apackdev/sdk/fe`, `@apackdev/sdk/runtime`, `@apackdev/sdk/steps`, `@apackdev/sdk/artifacts`, `@apackdev/sdk/blocks`, `@apackdev/sdk/designations`, `@apackdev/sdk/events` (`sdkEvents`), `@apackdev/sdk/helpers`, and every `@apackdev/ui` export

#### Deep subpath imports

Only registered barrel subpaths are externalized. Other SDK modules resolve and bundle: the file is compiled into your pack's `fe.js`. The FE build fails if a bundled SDK module needs the app's binding (`bindHost`/`bindFeHost` in `@apackdev/sdk/runtime`), since a bundled copy has nothing bound.

#### `@apackdev/ui`

Components, editors and UI composables (`@apackdev/ui/design/button`, `@apackdev/ui/components/tiptap/TiptapEditor`, `@apackdev/ui/composables/useDebounce`) come from the separate `@apackdev/ui` package. Add it to your pack's dependencies when your UI uses them; backend-only packs don't install it or its editor libraries. The package ships compiled JS with declarations, so component props typecheck with plain `tsc`.

At runtime your pack uses the app's copy: `apack pack build` turns `@apackdev/ui` imports into references to the modules the app exposes, the same way it handles the shared SDK modules. Your `fe.js` stays small, and stateful modules (the Monaco configuration, editor extensions) have one instance across the app. `@apackdev/ui` changes follow semver, and your pack's `hostVersion` states which apps it runs in.

To ship your own copy instead, set `build.bundleUi` in `apack.json`. All of `@apackdev/ui` is then bundled into `fe.js`, so the pack never mixes its copy with the app's.

### Backend: the module bridge

The API bundles its own copy of `@apackdev/sdk`, `@apackdev/ears` and `@apackdev/host`. Pack runtime code loaded from disk would otherwise get separate instances, with no app bound: no registered packs to look up and no installed EARS engine. `@apackdev/sdk` and `@apackdev/ears` are the shared-instance packages (`SHARED_INSTANCE_PACKAGES` in `@apackdev/host/build/shared-deps`): the bundler externals, this bridge and the test harness's all derive from that one list.

`withHostResolution(fn)` (`packages/apack-host/src/packs/runtime/bridge.ts`) runs a `require()` of pack code through `withModuleBridge()` (`@apackdev/host/packs`), which:

- puts the loader's instances (the API bundle's, in the app) of the bridged `@apackdev/sdk`, `@apackdev/ears` modules (every backend export of the shared-instance packages, except `@apackdev/ears/lmdb`, which only the app loads) in the require cache, and patches `Module._resolveFilename` so those specifiers resolve to them;
- resolves the shared backend packages (`xstate`, `zod`) from the API, since an installed pack has no `node_modules`;
- restores the resolver afterwards. The bridged modules stay cached, so requires the pack makes later get them too.

The pack test harness uses the same bridge with the pack's own SDK instance.

## Host services

The SDK reaches the running app through one typed port, `HostRuntime` (`@apackdev/sdk/runtime`),
bound once per process with `bindHost`. It supplies the event transport, EARS engine, registered packs,
app version and host service implementations. `createHostRuntime(...)` in `@apackdev/host/services`
assembles it; `setupBackend()` in `packages/api/src/runtime/index.ts` opens and binds the app store.
Packs receive their accepted service selection rather than this internal port: logger, emitter,
repository and caller-bound settings are implicit; onboarding, app data, run history, inference,
secrets and filesystem require `consumes.services` declarations. Onboarding is separate from app data.
Reset clears stored data and keys, then runs `onInit`, app-line migrations, pack-line migrations and
content application in dependency order, as startup does. Failed app-line migrations stop later stages.

Sends, logging and error reports are SDK code over the bound bus: `sendToSystem` emits an incoming event, `broadcastToSurface` (and `services.emitter.broadcastToSurface`) goes through the bus actor, which drops it until a client connects, like a system's `emit`, and `createLogger` emits log events, which the API prints once and streams to the logs surface (with nothing bound, as in the CLI, a logger writes to the console). In the renderer, `bindFeHost` binds the application actor, the secrets client behind `secretsClient` (the Settings → Secrets procedures) and a transport that sends to systems over the API client. Using the port with nothing bound throws, naming `bindHost` or `bindFeHost`.

A pack can't register a service under a host service's name.

## Secrets store

The user's API keys live in `@apackdev/host/secrets`, which is host-only and not part of `HostRuntime`.

- `secrets.json` holds each key's metadata in plain text and its value encrypted with AES-256-GCM.
- The data key is kept in a `KeyVault`: the OS credential store (`@napi-rs/keyring`), or a `secrets.key` file in the test environment, in development with `APACK_SECRETS_VAULT=file`, or after the user allows unprotected storage.
- Values enter only through the API's `secrets.*` tRPC procedures, never the event bus. Inference reads a provider's selected key with `secretsStore.keyFor(provider)`.
- Packs see metadata only, through `services.secrets` (list, select, rename, delete).

## Persistence

The app keeps two LMDB stores, both opened from `@apackdev/ears/lmdb`; `lmdb` is an optional peer of `@apackdev/ears` that only the app installs, so packs and pack tests never load it:

| Store | Directory | Holds | In memory |
|---|---|---|---|
| The database (`openLmdbStore({ path, engine })`) | `ears-db/` | Every entity and relation | Yes: hydrated into the engine at boot, and the store's sink is the engine's persistence |
| The run history (`openRecordStore`) | `run-history/` | Every flow run's record: each node a run made, with what it was given and returned | No: `services.runHistory` reads and writes it directly |

A flow run is not an entity: the engine never holds one, so a run's record is never undone by a unit (`transact`) that throws and never waits on one. As the run history opens it marks what the last session left running as `stopped`, and removes every session that ended more than 30 days ago, with everything it ran.

## Backups

`@apackdev/host/backup`, reached by packs through `services.appData` (`@apackdev/host/services/app-data.ts`):

- **Export** (`exportBackup(targetPath, name?, databases?)`): copies the chosen stores (`lmdb`, the database, and `runHistory`; default `lmdb`) into `<targetPath>/<name>` (default `apack-backup-<timestamp>`), with a `metadata.json` and, when `lmdb` is included, `media/`.
- **Import** (`importBackup(path)`): requires `metadata.json`; restores only databases the app has. It copies the current stores aside, puts the backup's in their place, each in one transaction with the store open throughout, replaces the media and reloads memory; a restored run history's running nodes are marked `stopped`. On failure the previous stores are put back the same way and reloaded.
- **Reset** (`reset()`): empties the database and the run history, each in one transaction, and the engine's memory with them, clears the stored API keys, then runs `onInit`, app-line migrations, pack-line migrations and content application in dependency order, leaving the app as a fresh boot does.

## Generated files

`generate-entries` reads `apack.json` and produces modules and metadata in `src/__generated__/`, including files per dependency. Builds regenerate these when their declared inputs change; never edit them. The main outputs are listed below; some exist only when their contribution is declared.

| File | Contents |
|---|---|
| `pack-entry.ts` | BE registration: systems, services, repositories, steps, artifacts, blocks, EARS, lifecycle hooks, migrations, content writers, appliers, commands, features |
| `pack-entry-fe.ts` | FE registration: surfaces keyed by feature (the host registers each at its address), the default surface and designations by feature, step/artifact/block FE, settings forms, tiptap and app extensions. DSL definitions are discoverable snapshot data |
| `ears.ts` | Typed EARS namespace (Entity, RelKind constants + types), `PackShapes`, and the typed `query`/`find*`/`newId` facade |
| `ref.ts` | `ref(name)`: the ref (`<packId>/<featureId>`) a name in this pack's code stands for, its own features by id and any other by ref, bound to the pack so its code never passes its own pack id |
| `fe.ts` | `openSurface(name, event?)`, taking the names pack code writes, and the `SurfaceName` type, which lists exactly those names (the pack's own surfaces by feature id, its dependencies' by `<packId>/<featureId>`). Only packs with surfaces get it |
| `system-specs.ts` | Type-only: `specs`, the events each system receives and sends, keyed by feature id, read from its entry's spec. `events.ts` imports it; only packs with systems get it |
| `events.ts` | `SendableSurfaceEvents` (surface ID -> the events it receives: its own feature's system's, plus the inbox that surface's `Contract` declares), `PackSystemEvents`, and the typed `broadcastToSurface` (backend, every window), `sendToSurface` (renderer, this window) and `sendToSystem` |
| `types.ts` | Type barrel: each feature's `types` and step node types |
| `entity-destinations.json` / `event-contracts.json` | Build-checked entity destinations and event contracts, readable without executing pack modules |
| `settings.ts` / `settings-fe.ts` | Typed, owner-bound settings handles and frontend settings binding |
| `paths.ts` | `getDataDirPath(name)` for a directory in this pack's data namespace |
| `runtime-services.ts` | Shared runtime service binding used by the generated facade and registration |
| `services.ts` | Service aggregation: imports each service object its manifest entry names (`"path#exportName"`), exports `Services`/`Z`/`EntityId` and the host-selected `services` facade and `servicesForAction(label)` factory. `Services` types `services.emitter` as `PackEmitter`, with this pack's surface and system events |
| `repository.ts` | `repository`, typed with the repositories declared in `features.<id>.repositories` and dependencies' |
| `repositories.ts` | This pack's repositories by name, which `pack-entry.ts` puts in the registration (the app holds them with the pack's other contributions) |
| `pack-types.ts` | The facade types `apack pack build` bundles into `dist/types/pack-types.d.ts` for dependents |
| `deps/<id>.d.ts` | Each dependency's facade types, from its snapshot. Its header names the version (`// <id>@<version> facade types`); `apack pack build` warns when the dependency it builds with is another version |
| `deps/<id>.flow-helpers.js`, `.d.ts` | Each dependency's flow helpers module and declarations, from its snapshot |
| `references.ts` | Executable reference provider and icon bindings; identities and presentation metadata remain discoverable catalog data |
| `appliers.ts` | `appliers`, one per content key, which `pack-entry.ts` puts in the registration, and the compiled data path accessors (`setCompiledDir`, `getCompiledDir`) |
| `content-runtime.ts` | The pack's content runtime (entity types, relation kinds, repositories, content writers). The pack's tests import it; `apack pack build` bundles it into `dist/build/content-runtime.mjs` for dependents' tests |
| `flow-helpers.ts` | Typed DSL helpers for each step definition, with dependencies' |
| `step-types.ts` | Re-exports DSL/compiled node types from step definitions |

## FE build pipeline

The FE bundler uses Vite with `@vitejs/plugin-vue`:

- **Format:** ESM
- **Target:** es2022
- **Sourcemaps:** on, off with `--release`
- **Minification:** off, on with `--release`
- **Entry:** `src/pack-entry-fe.ts` (or `.js`) if present, otherwise `src/__generated__/pack-entry-fe.ts`
- **Output:** `dist/runtime/fe.js` + `dist/runtime/fe.css`
- `--skip-fe` skips it for packs without declared frontend bindings; a pack that declares them cannot publish a build without `runtime/fe.js`.

Pack builds run frontend compilation through the same captured file and namespace reads as earlier
phases. Final checks refuse publication when inputs no longer match the captured view, preserving the
accepted output.

Vue SFCs (`.vue` files) are compiled automatically — no extra build step needed.

## External pack constraints

| Capability | Available? | Reason |
|---|---|---|
| Systems, surfaces | Yes | Core feature mechanism |
| Content (actions, prompts, flows) | Yes | Hash-checked per pack |
| Steps, artifacts, blocks | Yes | Extension points |
| Services | Yes | Stateless modules |
| EARS entities/relations | Yes | With collision detection |
| Migrations | Yes | Explicit pack/app version lines, run during startup |
| Settings and references | Yes | Feature settings/references and pack-wide settings use the same declarations as shipped packs; app preferences belong to the host |

## Build-time dependency resolution

`apack pack generate-entries`, `apack pack validate`, `apack pack build` and `apack pack fetch-deps` resolve each dependency in `apack.json` to its build output: `types/snapshot.json`, plus `build/` and `runtime/index.cjs` with its compiled content when it ships them (dependents' tests load the runtime). Sources, in order:

A selected host supplies its own packs before workspace lookup. An incompatible or unbuilt dependency belonging to that host fails; it never falls through to another app. Explicit `file:` dependencies override this selection. Without a host dependency, lookup continues in this order:

1. **`file:` path** — the given directory (relative to the pack root or absolute), in any layout. Not cached. A missing snapshot is an error.
2. **Workspace** — `../<id>`, `../../packages/<id>`, `../../<id>`.
3. **The app the pack is built against** — the built-in packs of a named app (`APACK_HOST`, `APACK_HOST_ROOT`) or of the apack checkout behind the pack.
4. **Installed apps** — `packs/<id>` in each environment's data dir (production, beta, development, test), which is where every pack that app has is installed, the ones it ships included.
5. **Cache** — `.apack/deps/<id>/`, used only when no source on this machine matches and the cached version satisfies the range. `fetch-deps` skips it.
6. **GitHub releases** — for `github:owner/repo [range]` values: the newest release matching the range, whose `<id>-<version>.tgz` is downloaded with its `.sha256`, checksum-checked, extracted and verified.
7. **Registry** — a stub for future `api.apack.dev` resolution. Currently a no-op.

Sources 2–4 must satisfy the declared semver range. Dependency type inspection validates the current
snapshot data contract and checks the facade exports codegen actually consumes. Recorded snapshot/SDK
stamps remain diagnostic context; absent or differing snapshot stamps do not invent a matching stamp
or authorize executable code. Cache entries retain that context. Only a matching snapshot format can
expose dependency build/runtime files. Type-only builds can proceed without those files; content
compilation and the test runtime refuse incompatible dependency execution before importing it.
A dependency found on this machine or on GitHub is cached under `.apack/deps/<id>/`
(`snapshot.json`, `facades/`, and eligible `build/`/`runtime/` files).

A `PackSnapshot` contains `format` (the snapshot format the writing CLI used), `types` (entity and relKind maps), `facades` (dependent-facing `.d.ts` contents, including the bundled `pack-types` facade), `entityDestinations` (entity wire name to local destination feature, compiled from surface `Contract.opens`), `manifest`, `sdkVersion`, `provenance` (which pack in its tree declares each name) and `flowHelpers` (the pack's bundled flow helpers module and declarations). Runtime/install readers use `PackSnapshot` with an exact execution stamp. Type-data readers use `PackDependencySnapshot`, retaining an optional recorded stamp and validating the same current fields; they do not read or convert another grammar.

Surface catalog entries project compiled destination claims as `opens`; unbuilt authoring previews do
not claim compiled destinations. Enabled native/installed claims must be unique per entity type, while
disabled claims remain visible. Native composition supplies `entityDestinations` as data and its accepted
frontend retains those claims; installed frontend eligibility uses the matching sealed build revision.
Catalog candidate validation runs before executable imports, enablement persistence and publication.

The common host/window catalog also exposes artifact and block declarations, including their owner,
origin, enablement and available declaration/build revisions. Artifact icons, block input kinds and
module references remain data when a pack is disabled or its implementation is unavailable. Reading
these declarations imports no viewer or backend module; executable registrations have a separate lifetime.


Step discovery reads `PackCatalogView.steps()`, whose entries carry the declaring pack, wire type,
origin and available declaration/build identity. Disabled installed and unbuilt source declarations remain
visible; executable component/layout readiness is separate. Active packs cannot share a step wire.
Native host composition uses the same step declaration grammar. Step defaults and presentation data
are captured at admission, so changing an authored object later does not mutate the accepted binding.

### Pack view failures

A failing pack canvas, panel, chat view or custom settings form shows an error in its own pane, with
its owner named. Other panes and host settings remain available. Retry remounts the current accepted
frontend; an unloaded or superseded version cannot be revived. A replacement resets its own failed
view, including when it reuses the same component. Settings declarations, defaults and saved values
remain intact; general settings and its JSON editor remain available after a custom form fails.
Contained errors are recorded with their pack and area without becoming window-fatal errors. The
native shell and settings runtime retain their host error handling. This contains Vue component
failures; it does not isolate arbitrary JavaScript or change pack permissions.
