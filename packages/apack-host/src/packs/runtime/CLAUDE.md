# Pack runtime (`@apackdev/host/packs/runtime`)

The pack runtime the app runs: loading built-in and external packs, the SDK bridge, activation and teardown, reload, writing, and the host `packs` system. It works on the registry it's given (`PackRegistry`, `createPackRegistry()` from `../registry.ts`): every function that registers, unregisters or reads packs takes it as its first argument, and the host `packs` system is `createPacksSystem(registry)`. Discovery, the registered packs (`createPackRegistry()`, with the shutdown hooks), the install registry, the installer and the pack layout live one level up in `@apackdev/host/packs` (`packages/apack-host/src/packs/`). That barrel, which the CLI imports, never imports this folder, and neither does `@apackdev/host/bus` (`tests/boundaries.spec.ts`).

The API calls this runtime (`packages/api/src/runtime/index.ts`, `setup/websocket.ts`, `transport/packs.ts`), and so do the db scripts. What only the API has, it reaches through the SDK's bound runtime: logging through `createLogger` (`@apackdev/sdk/logger`) and the app version through `getAppVersion()` (`@apackdev/sdk/env`). Unbound (the CLI), loggers write to the console. Modules here import each other and the rest of host by relative `.ts` path.

## Architecture

### Install locations

All paths come from `resolveAppEnvironment()` (`@apackdev/sdk/env`), under `userDataDir`:

| Path | Contents |
|------|----------|
| `packs/<id>/` | Every installed pack, the ones the app ships included, in the pack layout (`apack.json`, `integrity.json`, `runtime/{index.cjs,fe.js,fe.css,content/}`, `build/`, `types/snapshot.json`; see `apack-host/src/packs/layout.ts`) |
| `installed-packs.json` | Install state and `enabled` flag, for the packs that have a row |

Hidden `.<id>.installing-*` directories hold candidates, `.<id>.previous-*` retain uncommitted incumbents, and `.<id>.retired-*` await cleanup after acceptance. Before discovery, `prepareHostDataDirs` restores interrupted incumbents and their installation decisions, and removes stale candidate/retired directories. Unresolved recovery blocks that pack from loading.

### The packs the app ships

They use the same installed layout and loader as other packs. `installShippedPacks` requires the target
profile's installation record file and runs before installed-pack discovery.

- `readAppPackSources` reads verified built sources and refuses duplicate advertised ids without activation.
- New defaults are app-managed. User-owned copies remain untouched; deliberately removed defaults stay
  absent through `suppressAppInstall`. Disabling keeps files and declarations and changes eligibility.
- App-owned refresh compares the recorded `shippedRevision` with the current source's published-file
  identity. Unchanged sources do not repair edited installed files; ordinary build admission diagnoses them.
- Plain live install refuses advertised default ids even when disabled, absent or failed. Explicit replace
  chooses user ownership; restore selects verified app bytes, enables the pack and resumes app ownership.
  All installed packs can be disabled or removed. The host is native and cannot be installed/removed.
- Filesystem/runtime refusal preserves the incumbent; post-acceptance initialization failures retain accepted
  files and report unavailable runtime. User-data effects are not transactionally rolled back.

### Loading

`loadAppPacks(registry)` in `loader.ts` — one path for every pack:

- **Discovery** — `discoverPacks(packsDir)` plus the `installed-packs.json` rows, minus the disabled.
- **Order** — deterministic pack-id order, with no advertisement/ownership priority. Contribution conflicts name both owners; dependency content order is handled separately by `packContentTargets`.
- **Loading** — `runtime/index.cjs` in the pack's own installed directory, written by its `apack pack build`, required with `withHostResolution()`. The api bundle carries no pack's backend, so this is the path packaged and from source alike.
- Before loading code, `readPackBuild` validates declarations and verifies the complete installed file inventory. Changed/missing/extra files, malformed checksums and symbolic links are refused. The accepted content identity is retained in the pack origin separately from its declaration revision.
- A pack with no built runtime, or one whose load throws, has a **load problem recorded** and the rest load.
- Each loaded module's `setCompiledDir(<pack>/runtime/content)` is called, then `registry.registerPack(mod.registration)`.

### Installed packs

`loadExternalPacks(registry)` validates the full installed destination claim set before any executable import:
1. Reads visible installed directories through `readInstalledPackBuilds()`: validated snapshots, complete asset receipts and directory/manifest owner agreement, or an explicit refusal; no executable imports
2. Prunes records only when their directories are gone (`forgetPacksExcept()`); invalid builds retain user choices and update provenance. Takes enabled directories in pack-id order
3. Loads each enabled pack with `loadSingleExternalPack(registry, dir)`:
   - the verified candidate must preserve unique enabled entity destinations and reference type and category names against the committed catalog, before its runtime can execute; at discovery every competing owner is withheld with a load problem
   - `hostVersion` check (`isHostCompatible`), pack layout format check, warning on an SDK major version mismatch
   - `runtime/index.cjs` through `withHostResolution()`; the registration id must match the manifest. A directory without a `integrity.json` and a `runtime/index.cjs` isn't an installed pack: it's skipped with a warning pointing at `apack pack install` or `apack pack dev`
   - a pack it can't admit or load comes back with a problem, which `loadExternalPacks` records in the registry it's given (`recordLoadProblem`), so the Packs view says why the pack isn't running

`registerExternalPacks(registry, packs)` registers each pack (recording why as the pack's load problem when the registry refuses one), whose features the registry runs at `<packId>/<featureId>` (its appliers, commands and the rest of its registration with it), and returns the packs whose registration succeeded.

## Modules

In this folder (all exported from `index.ts`):

| File | Purpose |
|------|---------|
| `loader.ts` | Built-in and external loading, `registerExternalPacks`, `clearPackRequireCache` |
| `bridge.ts` | The SDK bridge map (`SDK_BRIDGE`: `sdk-modules.ts`), `withHostResolution()`, `getBridgedSdkSpecifiers()` |
|  `sdk-modules.ts` | Generated (`npm run sdk-modules:update -w @apackdev/host`, from `../../build/render-sdk-modules.ts`): a static import of every export of the `SHARED_INSTANCE_PACKAGES` (`@apackdev/sdk`, `@apackdev/ears`) pack runtime code can require, so the app bundle carries them |
| `lifecycle.ts` | `activatePack()` and `teardownPack()` for install, uninstall, enable/disable and update at runtime |
| `reload.ts` | `reloadPackById()` for the API's `POST /dev/reload` (`transport/websocket.ts`): the caller names a pack, and the registry says which directory it was loaded from |
| `dev-install.ts` | `installDevPack()` for the API's `POST /dev/install`: copies the build in a pack's source directory into `packs/<id>/` as the user's own copy and starts it, under the registry's claim on the pack id |
| `packs-system.ts` | Every action claims its pack in the registry (`claimPackOperation`: install on the slug and then the resolved id, the rest on the pack id), and so do the development install and reload, so no two operations on one pack interleave. A reset or backup import claims every pack at once (`claimAllPackOperations`), so it neither starts under a pack operation nor admits one while it runs; a refused operation answers the Packs view with its failure event. The host `packs` XState system: `INSTALL_PACK`, `UNINSTALL_PACK`, `TOGGLE_PACK_ENABLED`, `UPDATE_PACK`, `CHECK_FOR_UPDATES`, `GET_INSTALLED_PACKS`, and publishes its list on `SEND_STATE` like any other system, whatever caused the ask; emits `PACKS_LIST`, `PACK_ACTIVATED`/`PACK_DEACTIVATED` and install/update/uninstall results. It lists accepted catalog declarations and refusal diagnostics, joined to installation records and applied-content offers |
| `activation-outcome.ts` | `activationProblem()`: why a just-installed or updated pack isn't working (failed to load, with the load problem the registry recorded, or the content error recorded on its installed-packs entry) |
| `apply.ts` | `contentRevision` (every file under the pack's `runtime/content`, by name and bytes, media included — **content only**: file times were in here so that reinstalling the version already installed would re-apply, which also made a `touch` re-apply and made every `apack pack dev` backend rebuild re-import every apply, that loop reinstalling. Asking for a pack's data back is `IMPORT_PACK_CONTENT`; a reinstall of a pack whose data failed still reports it, because `recordInstalled` keeps the `lastError` only the applier may clear), and `applyPacks` — **one function for every pack**, whoever ships it. Each pack's hash is recorded as its `AppliedContent.revision` (`appliedContent`, `@apackdev/host/app-state`), which keeps it while the pack is disabled; every applier the pack registered runs; failures are recorded as the installed-packs entry's `lastError`. A pack is applied when its own compiled data changed, or when its last apply failed and a pack it depends on has applied since — `AppState.failedAgainst` holds what the failed attempt faced, so the retry happens when that changes rather than never, and a pack whose data and dependencies are both settled is skipped. Every key the pack declares is applied: there is no policy saying otherwise, because `content.sources` holds only entries that write entities, and what an apply leaves alone it decides from the merge rather than from a list of keys. **This is where the applied content is read and written**: the record of what the last apply wrote per item goes in, and what this one wrote, removed and flagged comes back out (`ApplyRecord`, `@apackdev/sdk/utils`). It is what makes an entity the user destroyed known to be theirs — the apply wrote its key and there is nothing behind it now — and what keeps the user's edit to one field of an item from freezing the rest of it. A pack whose content no longer declares an item has that item removed, unless the user has edited it, in which case it is kept and named. The revision is recorded whether or not the run succeeded, because what it wrote is written either way; a user-requested import (`IMPORT_PACK_CONTENT`) carries a write-only record, so it records what it wrote and reads nothing. What it leaves outstanding it records as an **offer** on the item's entry and logs, one line per kind, with the parts in the log event's meta — only for an entry whose `onUserEdit` is `offer`, since under `theirs` the edit is the user's writing and nothing asks them about it. The Packs view draws them (`InstalledPackSummary.contentOffers`) and the three resolutions are the `packs` system's `RESTORE_CONTENT_ITEM`, `DISMISS_CONTENT_OFFER` and `DELETE_CONTENT_ITEM` |

In `packages/apack-host/src/packs/` (`@apackdev/host/packs`):

| File | Purpose |
|------|---------|
| `discovery.ts` | `readInstalledPackBuilds`, `discoverPacks`, `installedPacks` |
| `registry.ts` | `createPackRegistry()`, the registered packs as an instance: `registerPack`/`replacePack`/`unregisterPack` (the host's own features too, `hostRegistration`), boot hooks, migrations, EARS policy, extensions, shutdown hooks (`registerShutdownHook`, `runShutdownHooks`, `runShutdownHooksForKey`, `removeShutdownHooksForKey`), `getEventValidationMap()` (what `bus.send` accepts, cached until a registration changes), and the lookups the SDK reads once it's bound (`PackRegistryView`). Candidate admission and atomic runtime replacement |
| `extensions.ts`, `backend-extensions.ts` | The stores a registry keeps: definitions by type (one active owner per step wire), designations, content writers, appliers, commands, shutdown hooks |
| `installed.ts` | `installed-packs.json` CRUD |
| `module-bridge.ts` | `withModuleBridge()` |
| `layout.ts` | Pack layout, stage/verify, archives, `packFileHashes`/`stagedFileHashes` |
| `installer.ts` | Install from a directory, archive, URL or GitHub release (stage, verify, place); `installShippedPacks`; uninstall; `checkDependencies` |
| `staging.ts` | Staging dir names, `recoverStagingDirs`, `prepareHostDataDirs` |
| `updater.ts`, `github.ts` | Update checks against GitHub releases |
| `host-info.ts` | Records the app version in the data dir for `apack pack install` |

The API's `transport/packs.ts` serves `packs.loaded` from `getLoadedPackEntries()`.

## Boot sequence (in the API's `runtime/index.ts`)

```
0. initializeLogCapture()          — console calls become log events, each printed once
   openAppStore()                  — (runtime/index.ts) createPackRegistry(), the app's registered packs; open the app's
                                     elmdb database with the packs' schema and the run history's, each with its engine
                                     (openDatabaseStore, openRunHistory: @apackdev/host/database),
                                     bindHost(createHostRuntime({ ..., packs })), which binds the engine
                                     and binds the registry for the SDK's lookups; every step below works on it
1. registerPack(hostRegistration) — the app's own features as the pack `host`: the application and packs systems and surfaces
2. prepareHostDataDirs()           — record host version; recover staging in packs/
3. forwardSecretsChanges()         — settings system hears of API key changes (@apackdev/host/secrets)
4. installShippedPacks()           — install absent shipped ids unless deliberately removed; refresh only
                                     app-owned copies when the shipped source revision changes
5. loadAppPacks()                  — discover + reconcile installed packs + load enabled, shipped ids first;
                                     registerPack() each, with where it was found (PackOrigin)
6. registry.registerShutdownHook() — each pack's onShutdown, keyed by pack id
7. logger.info(bootReading())      — the database's size on disk and the heap: the engine reads the store, so neither grows with the other
8. startPacks(registry)            — start.ts; services.appData.reset() runs it too, after the shutdown hooks:
   onInit hooks                    — all packs (built-in + external)
   runAppMigrations()              — the host's app migrations, then built-in packs', against the app version (@apackdev/host/migrations); if one fails, nothing below runs
   runPackMigrations()             — external packs' migrations, each against its pack version
   applyPacks()                     — every pack's compiled content (hash-checked, in dependency order,
                                     every key each pack content)
9. start the bus actor             — createAppBus(registry) (@apackdev/host/bus) with systemId `HOST.bus`, which spawns every registered system
```

The engine reads the store from the moment it opens, so there is no load step to order packs before: an entity type is checked when a write or a query by type names it, which is after every pack has registered.

## Pack entry contract

A pack's `__generated__/pack-entry.ts` (built-in, and bundled into an external pack's `runtime/index.cjs`) exports a `registration` conforming to `PackRegistration` from `@apackdev/sdk/framework`, and `setCompiledDir(dir)`:

```typescript
export const registration: PackRegistration = {
  id: string;
  features?: Record<string, PackFeature>;  // by feature id: designation?, system?: { machine, receives } (packSystem), surface?: { receives }, services?, settings?
  services?: Record<string, unknown>;
  ears?: PackEARS;           // entities + relKinds
  repositories?: Record<string, unknown>;  // features[].repositories, registered with the app's engine
  lifecycle?: PackLifecycleHooks;      // onInit/onShutdown (lifecycle.onInit / lifecycle.onShutdown)
  migrations?: PackMigration[];
  steps?: StepDefinition[];
  artifacts?: ArtifactDefinition[];
  blocks?: BlockDefinition[];
  content.writers?: Record<string, ContentWriter>;  // apack.json content.writers
  appliers?: ContentApplier[];                     // one per content key (apack.json content.sources), run by importCompiledContent
  commands?: PackCommand[];               // apack.json commands
};
```

Designations come from the manifest's `features[].designation`, which generate-entries puts on the feature, and `registerPack()` maps each role to the feature's ref, `<packId>/<featureId>`, whether it has a system or none. A designation is a role, not a name, and need not equal the feature id: both registries map the role to the id of the system or surface that plays it. `apack pack validate` rejects one role claimed by two features of a pack; across packs `registerPack` throws.

## Collision detection

`registerPack()` in `apack-host/src/packs/registry.ts` checks for collisions before storing a registration:

| What | Checked against | On collision |
|------|----------------|--------------|
| Pack id | Registered packs | Throws |
| EARS entity type values | The SDK's and the host's, and all registered packs' entity values | Throws (blocks registration) |
| EARS relation kind values | The SDK's, and all registered packs' relation values | Throws (blocks registration) |
| Designation roles | All registered packs' roles | Throws (blocks registration) |
| Service keys | Host service names (`logger`, `emitter`, `repository`, `onboarding`, `appData`, `runHistory`, `inference`, `secrets`, `filesystem`, `settings`) and all registered packs' keys | Throws (blocks registration) |
| Repository names | All registered packs' repository names | Throws (blocks registration) |
| Content writers | Another pack's hooks for the entity type | Throws before candidate publication |
| ContentAppliers | Two appliers for one content key in the pack | Throws before candidate publication |
| Commands | Other packs' command names | Throws before candidate publication |
| Feature settings | Common JSON Schema/defaults validation (each declaration owns one feature) | Throws before candidate publication |

Admission checks declarations and ownership, captures contribution addresses, and builds candidate tables
without changing live lookups. It acquires only the candidate's settings binding, then publishes repository
changes and accepted registry state. A refusal retains the incumbent's origin, lookups, captured handles
and subscriptions. Repository publication failure restores attempted entries and retires the provisional
binding. Executable definition objects retain their identity; removal uses captured addresses rather
than re-reading authored getters.

`replacePack` replaces an already accepted runtime through this same admission path. Once committed,
it retires the incumbent binding and returns any cleanup errors as diagnostics; callers never interpret
those errors as candidate refusal or restore a disposed runtime. Ordinary unregister removes accepted
state and disposes its binding even when binding cleanup throws. Reentrant registry changes during
admission/retirement are refused. Command order is retained across replacements and reloads.

Step wires have one active owner; artifact/block definitions follow registration precedence. Runtime
initialization, migrations and content effects are separate from this registry transaction. The focused
checks are `registration.spec.ts`, `replacement.spec.ts`, `registered-lookups.spec.ts` and runtime reload.

## Host resolution for pack runtime code

`withHostResolution(fn)` in `bridge.ts` calls `withModuleBridge()` (`../module-bridge.ts`) with:
- `SDK_BRIDGE` — the loader's own instances (in the app, the API bundle's, which inlines `@apackdev/sdk`, `@apackdev/ears` and `@apackdev/host`) of the shared-instance packages' subpaths (`sdk-modules.ts`, built from each package's exports map minus `APP_UNBRIDGED` and the app-only `@apackdev/ears/lmdb`). They go into the require cache (under a bridge key and the real resolved path) and `Module._resolveFilename` resolves those specifiers to them, so pack code shares the bundle's bound app (its registered packs and EARS engine) instead of loading a separate SDK copy. Pack code never requires `@apackdev/host`, so no host module is bridged.
- `getSharedBeDeps()` (`xstate`, `zod`, and every subpath they export: a bundled dependency may require `zod/v4`) — resolved from `import.meta.url` (the API's `dist/server.js` in the app), since an installed pack has no `node_modules`.
- `bridgedPackages: SHARED_INSTANCE_PACKAGES` — a pack requiring a shared-instance module the map lacks fails with "isn't provided by this apack: rebuild the pack".
- `appOnly: APP_ONLY_EXPORTS` — a pack requiring `@apackdev/ears/lmdb` fails saying only the app loads it (`apack pack build` already rejects the import).

The resolver patch is restored in a `finally`; the bridged cache entries stay, so lazy requires get them too. `tests/packs/runtime/sdk-bridge-drift.spec.ts` guards the list via `getBridgedSdkSpecifiers()` and fails when  `sdk-modules.ts` is stale. The pack test harness calls `withModuleBridge()` with the pack's own SDK.

## Blocked features for external packs


## Runtime lifecycle

The composition supplies `registry.indexesReady` from its owning database. Registration and installer acceptance
remain synchronous; startup, activation, accepted install/update/restore and reload await readiness before onInit,
migrations, apply or actor startup. Await their returned promises and retain operation claims through completion.
Single-pack activation/reload waits for its own entity types, transitive dependency declarations and SDK/host types; unrelated retained index failures do not block it. Boot/reset and whole-store maintenance keep global waits. Scoped waits reject retired/replaced generations and changed relevant runtime/declaration owners instead of silently accepting replacement work. Unrelated registration or catalog cloning does not cancel them.
Failed readiness after acceptance keeps installed files but removes the unavailable runtime and records its problem.
Declaration-only registries have no build work. This wait does not change synchronous EARS read/write semantics.

### Activate and teardown (`lifecycle.ts`)

`activatePack(registry, packId, bus)` — reads the managed `packs/<id>/` build through `loadSingleExternalPack(registry, dir)`, `registerExternalPacks()`, registers `onShutdown`, then starts it as a boot does: `onInit`, `runPackMigrations()`, `applyPacks()` (hash-checked, so enabling a pack whose content didn't change imports nothing), then sends the bus `PACK_CHANGED`, then `ACTIVATE_PACK` with the `<packId>/<featureId>` system ids. Returns `false` when reading, loading, registration or initialization fails, with why recorded as its load problem. Initialization failure runs shutdown cleanup and unregisters provisional contributions; it does not undo arbitrary data effects. The packs system then emits `PACK_ACTIVATED`, or, after install/update, `PACK_INSTALL_FAILED`/`PACK_UPDATE_FAILED` when `activationProblem()` reports one.

`teardownPack(registry, packId, bus)` — sends `TEARDOWN_PACK` for the registered system IDs. The bus waits for actor and subscription cleanup, then queues `SYSTEMS_STOPPED` behind messages already sent. Its completion callback runs shutdown hooks, clears the load problem, unregisters contributions and runtime authority, clears the require cache and sends `PACK_CHANGED` to the surviving systems. Packs with no running systems complete without waiting. It returns a promise that settles once that callback has run, and the packs system keeps its claim on the pack until then, so nothing reinstalls a pack the bus is still taking down. The packs system then emits `PACK_DEACTIVATED`.

`acceptInstalledPack` runs inside the installer's synchronous acceptance callback: clear the candidate module cache, load/check the final-path build and register it (or `replacePack` when an incumbent exists). Refusal clears candidate modules and lets the installer restore the old files without stopping actors or changing install records. The returned starter runs only after filesystem acceptance: retire old shutdown hooks, refresh declarations, initialize/migrate/apply, then restart the union of old and new systems through `RELOAD_PACK` before publishing `PACK_CHANGED`. Initialization failure unregisters the accepted runtime, stops affected actors and reports a load problem; accepted files remain, and arbitrary data effects are not rolled back. New activations use the same startup implementation. Disabled updates replace their build and catalog definitions without starting a runtime. Install reserves the source during download and the resolved pack id before placement; update reserves the pack id throughout download and acceptance.

### Reload (`reload.ts`)

`POST /dev/reload { packId }` (from `apack pack build --watch`; it holds the registry's claim on the pack) calls `reloadPackById(registry, …)` on the app's registry, which re-requires the pack's built runtime from the directory the registry says it came from. Either way:
0. refresh the installed copy only when its update ownership is `app` and the shipped source revision changed. `installShippedPacks` receives the target profile's record file and `only: packId`. User-owned forks and deliberate removals are preserved. The refresh accepts registration inside the filesystem/record rollback boundary; refusal preserves the incumbent. An accepted installation uses its returned starter after publication and returns without registering the same candidate again. Initialization effects remain outside rollback. When no shipped installation is needed, continue the ordinary runtime reload below.
1. clear the pack's require cache and load the fresh runtime (a load failure throws; the running pack is untouched, and a pack that wasn't running has the failure recorded as its load problem)
2. prepare and commit the fresh registration with `replacePack` (or initially register a pack not yet running); refusal leaves the incumbent resources untouched. Successful publication invalidates derived lookup caches and retires the old binding; retirement errors are logged without restoring it
3. run old shutdown hooks and register new `onShutdown`; initialize by refreshing declaration data, running `onInit`, migrations and content apply. A reload can be the first this app has seen of a pack whose files were placed while it ran — it needs no record entry, because the directory is what makes it installed
Initialization and apply errors after the registration swap are logged; actor restart still runs because the old registration has already left.

4. send the bus `RELOAD_PACK` with old and new system ids: it stops each running one, starts those still registered, and sends them `CLIENT_CONNECTED`, then asks them to publish
5. send the bus `PACK_CHANGED`

`PACK_CHANGED { packId }` goes to every running system once a change is complete, and the bus then asks each to publish (`SEND_STATE`) — which is how systems that read what a pack registers or content (the chat's slash commands, the library's documents) send their data again, without any of them handling the fact. It's never sent between unregistering a pack and registering it again: a system reading another pack's services then would find them gone. Settings → Import pack content sends it too.

The app's migrations run only at boot (and in an app reset). An external pack's run whenever it starts: at boot, on activation (install, update, enable) and on reload, each against its own recorded version.

## Client startup data for packs with frontends

`getPacksWithClientLoadedFrontends(registry)` (`../layout.ts`) projects frontend membership from the
receipt retained with each accepted backend runtime. It does not rediscover files on disk. The app bus
(`createAppBus()` in `apack-host/src/bus/app.ts`) skips these packs when broadcasting a connection's
`CLIENT_CONNECTED`, until this window accepts their frontend.

After successful frontend acceptance, the renderer calls `trpc.bus.packClientReady({ packId })`, which
sends the pack's systems `CLIENT_CONNECTED` and asks them to publish. A failed frontend remains unloaded,
including one whose replacement was refused, and may retry on a later load request; it is never announced ready. Reconnection accepts fresh bindings.

## External pack FE entry convention

The `packs.loaded` query reports accepted `feEntry` and `feStyles` receipt members, declaration identity
and build identity. Installed modules and styles use `pack://{packId}/builds/{buildRevision}/…`,
so relative chunks inherit that same revision. The main protocol verifies the requested receipt and exact
file bytes; it never serves a changed file or substitutes a shipped copy. Development source delivery is
explicit and uses its own module graph.

`createPackFrontends` imports a default `PackFERegistration` whose owner and declaration identity must
match the backend. It awaits styles and obtains host-bound settings before registration. Unload or the
loader actor's cancellation invalidates pending work; a late settings grant is disposed before it can
register. Only successful registration reports `PACK_FRONTEND_LOADED`; styles-only packs return null
and do not announce frontend readiness.

External modules contribute through the host's `registerPackFE()`; they do not access the renderer's
registry directly. The SDK exposes its read view. Unregistering rebuilds lookups from the remaining
accepted owners and retires settings bindings; unloading removes styles even if resource cleanup throws.

## Tests

`packages/apack-host/tests/packs/runtime/` runs on the SDK's test host (`test-host.ts`: `startTestRuntime({ appVersion, packs: registry })`, with the `registry` it exports, which the specs pass to the runtime): `loader` (one load path for every pack, the shipped-first order, writing, the installed-packs entries), `lifecycle`, `reload`, `activation-outcome`, `bridge-leaves`, `sdk-bridge-drift` (set `REQUIRE_RUNTIME_ENTRY` to require default-setup's built runtime) and `pack-e2e`. `tests/bus/app-bus.spec.ts` runs `createAppBus(registry)` on the test host; `tests/packs/shutdown-hooks.spec.ts` covers a registry's shutdown hooks. Elsewhere: `packages/api/tests/runtime/bus-client-connected.spec.ts` (the app bus on the API's transport) and `packages/apack-cli/tests/commands/init-install-load.integration.spec.ts` (a scaffolded pack installed and loaded).
