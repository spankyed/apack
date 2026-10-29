# @apackdev/cli

The `apack` app and pack CLI: scaffold, generate, build, test, pack, release and install packs. Built-in packs (`packages/default-setup`, `npm run build:default-setup`) and external packs go through the same commands. User-facing reference: `docs/public-facing/cli.md` (flags, build output layout, dependency sources). This file is the contributor map. Paths below are relative to `packages/apack-cli`.

Installed-pack mutations share `withPackMutation`, the selected profile's storage lock. `pack replace`
checks the explicit target id and chooses user-managed updates; plain install requires an explicit/associated offline host and refuses its advertised defaults
(including invalid advertisements) or an app-managed incumbent. Named replacement needs no host selection. `pack restore` reads the selected host packages without activation/download, restores the
named shipped build, re-enables it and resumes app updates. Its `--host` source selection is independent
of `--profile` storage. Both preserve database overrides. See `commands/pack-{install,replace,restore}.ts`.

## Layout

```
bin/apack.mjs         entry: project hand-off, then source or dist mode
bin/source-hooks.mjs   Node resolve hooks for source mode
bin/app-launcher.sh    `apack` inside the packaged app (runs the bundle on Electron as Node)
src/index.ts           process entry and error handling
src/command-tree.ts    nested command registry, routing, and help (lazy imports)
src/utils.ts           findPackRoot, readManifest, parseStorageProfile, parseAppChannel, sdkVersion, cliBin, cliVersion
src/commands/          one module per command; add/ holds one module per `apack pack add` entity
src/build/             bundlers and build-time gates, read by every command that builds, checks or
                       launches a pack
src/app/               which apack a command runs against, and the throwaway data dirs it runs in
tests/                 vitest specs (see Tests)
```

A command module exports `async (args: string[]) => void`; `src/command-tree.ts` maps the command path to it and prints `err.message` with exit code 1 on a throw. Add a command by adding the module, a `COMMANDS` entry with its description and usage.

## Commands

Desktop app `install [version]`, `upgrade [version]` and `uninstall` share `app/app-command.ts` (strict flags, production default) and `app/installed-app.ts` (release selection, checksum download, bundle validation, graceful quit and staged replacement). `install --replace` authorizes replacement; `upgrade --force` permits reinstall or downgrade. Pack operations are `pack install` and `pack uninstall`; `pack archive` creates an archive; bare `pack` displays help.

| Command | Source | Notes |
|---|---|---|
| `status`, `logs`, `doctor` | `commands/status.ts`, `logs.ts`, `doctor.ts` | Installed-app reporting by `--channel`; status and doctor support `--json`, logs supports `--follow` |
| `pack outdated`, `pack upgrade <id>` | `commands/pack-outdated.ts`, `pack-upgrade.ts` | Explicit profile paths; `app/pack-updates.ts` shares read-only GitHub release checks. `app/pack-mutation.ts` locks install/uninstall/upgrade while the app is closed; upgrade validates the selected pack and both dependency directions before replacement |
| `db backup`, `db backup verify` | `commands/db/backup.ts`, `backup-verify.ts` | Full offline snapshot and standalone verification in the app’s backup format |
| `db rebuild [--force]` | `commands/db/rebuild.ts` | SQLite candidate derived-index recovery through the host storage descriptor; dry run by default, offline managed-writer exclusion and readiness before success |
| `db recover` | `commands/db/recover.ts` | Explicit named-profile inspection and resumable incumbent restoration; host backup owns the restore plan, profile lock, live-app refusal and forensic retention |
| `pack init [name]` | `commands/init.ts` | Writes `apack.json`, `package.json`, `tsconfig.json`, `.github/workflows/release.yml` (`RELEASE_WORKFLOW_TEMPLATE`), a markdown content format example, then runs `generate-entries`. `scaffoldUnitTestSetup()` (also used by `add feature`) writes `vitest.config.ts`, `tests/setup.ts` and devDependencies |
| `pack add <entity>` | `commands/add.ts` → `commands/add/*.ts` | Entities: `feature`, `step`, `artifact`, `block`, `action`, `prompt`, `flow`, `service`, `migration`, `command`, `document`. `add command` and `add document` share `add/content-document.ts`, which finds the pack's source for the SDK's `commands` or `documents` key (declaring it when the pack has none) and writes the markdown; what differs is the key and the body. `add command` is the one scaffold that appends to a file already there — a command is a `**name**: placeholder` line, so it joins the named document's field section rather than making a document per command, and refuses a duplicate name or a document without that section. Shared helpers in `add/write.ts` (naming, file/flag helpers), `add/manifest.ts` (declaration edits), and `src/manifest-writer.ts` (schema-ordered serialization used by init/add/release). `add feature` takes a `--designation` role (it need not be the feature name) and regenerates entries |
| `pack generate-entries [--force]` | `commands/generate-entries.ts` | `generatePackFiles` (`@apackdev/sdk/build`) into `src/__generated__/`. Keeps compiler-specific cache metadata in `.apack/generate-entries.json`, outside generated module outputs. Skips when its input hash matches **and every recorded output has the same bytes** — `{ hash, files: { path: sha256 } }`, the missing-output check first, as `unitStaleReason` (`@apackdev/host/build/packages-built`) does. Recording only the hash would let a deleted generated file go unnoticed, reporting "inputs unchanged, skipping" over a tree it had not made. The list is *recorded* rather than fixed because the output set follows the manifest: a pack with no surfaces never writes `fe.ts`, and a hard-coded expectation would call it stale forever. Inputs hashed: module sources throughout the pack, captured manifest data, dependency snapshots, the SDK implementation and the CLI generation implementation. Build and facade-report `--skip-generate` use the same input/output check and refuse stale files; builds recheck before publication. Generated entries, build output and dependency working trees are excluded. Deletes generated files it no longer emits; `warnStaleDepTypes` flags `deps/<id>.d.ts` from another version |
| `pack fetch-deps` | `commands/fetch-deps.ts` | Resolution chain: `file:` path; else selected host for dependencies it provides (fail if incompatible/unbuilt); else workspace (`packages/<id>` or `<id>` in the nearest directory above the pack) → the app configured for `apack pack test` → installed apps (`resolveFromMachine`); else the `.apack/deps` cache; else GitHub releases (registry lookup is a stub). `resolveDepFiles` is what `build` uses |
| `pack build [--skip-generate] [--skip-fe] [--release] [--watch]` | `commands/build.ts` | See Build pipeline. `--watch` uses `build/build-process.ts` to run a fresh CLI build on every authored-input change, then asks the development API to reload after verified publication. Linked packages are checked before spawning, and flow/step/compiler imports cannot reuse the previous build's module cache. Build and watch share authored-input exclusions; compiler configuration and fresh TypeScript resolution probes add outside-file, missing-target and physical-link subscriptions. The current frontend compiler reports resource files and content directories over private worker IPC, independently of diagnostic records; failed builds retain repair subscriptions. Unchanged notifications skip publication; changes outside src/, manifests, JSON schemas, assets and help are included. Mid-build edits coalesce into another run; failures retain the accepted build. Watch cannot combine with other build flags. `npm run dev` waits for its first verified publication |
| `pack archive [--out <dir>]` | `commands/archive.ts` | `pack buildPackArchive()`: `stagePack` into `.apack/staged/<id>`, `verifyPack`, `createPackArchive` (all `@apackdev/host/packs`). Records `gitProvenance()` with credentials stripped from the remote. Defaults to `.apack/archives`; verifies completed inputs under the build lock and rechecks before publishing. The default pack uses the same path |
| `pack release [...]`, `release publish` | `commands/release.ts` | `runRelease`: `nextReleaseVersion` → `preflight` → write version → `verify` (`build --release`, `tsc`, `npm test`, `test`) → commit → pack into `.apack/release` → tag → push. `publishRelease` uses Octokit. The shell `Runner` and the Octokit client can be injected (tested in `tests/commands/release.integration.spec.ts`) |
| `pack facade-report [--update]` | `commands/facade-report.ts` | The reviewed report of the pack's facade types (`etc/pack-types.api.md`), normalised so it moves only with the facade. Defaults to source derivation: codegen, then `bundlePackTypes` into a temporary directory. Explicit `--from-build` reads the verified snapshot facade after common input-record freshness checks, without regenerating shared entries; the root chain uses this path. Missing, changed or stale builds refuse. Fails with a diff when the committed report is stale; `--update` rewrites it |
| `pack validate`, `pack doctor` | `commands/validate.ts`, `pack-doctor.ts` | Shared read-only manifest/file, static export/contract and source-rule checks; exits 0 for valid, 1 for errors, 2 for incomplete dependency checks. Doctor also reminds about absent generated output |
| `pack install <source> --host <path|beta> [--profile <name>]` | `commands/pack-install.ts` | `detectSourceKind` → `installPackFromLocal` / `installPack`, checking the pack's `hostVersion` and build format against what `readHostCompatibility(userDataDir)` says the data dir's app is. CLI installs record their source in the selected profile; uninstall retains a deliberate-removal marker. An explicit reinstall clears that marker and enables the pack; ordinary updates preserve enablement. Bare names go to `resolveFromRemoteRegistry`, which always throws (not implemented) |
| `pack uninstall <id>`, `pack list` | `commands/pack-uninstall.ts`, `commands/list.ts` | Stored profile from `parseStorageProfile`: production by default |
| `pack dev [--host <path> \| --host beta] [--profile <name> [--rm] \| --fresh [--rm]] [--with-secrets]` | `commands/dev.ts`, `src/app/` | `resolvePackHost` with development policy (derived, never remembered), then build, then launch that app unless a verified source session from the selected checkout is already on its data dir — an app this command started is one it closes. The environment follows the app: a checkout is `development`, a packaged build stamps its own channel (`hostEnvironment`). Then the install, and **who copies the files depends on the host, because an app may load a pack while its files are being replaced**. A checkout's running app is asked to (`installPackInApp`, `POST /dev/install` to its API, port from `apiPortFile`), and copies and starts the build under the registry's claim on the pack, so no install, toggle or reload in the Packs view overlaps it; each rebuild does the same. A packaged app takes no development request, so `installToApp` (checked against that app's `readHostCompatibility`, as `install` is) copies the build before the launch, and a rebuild whose backend moved (`backendRevision`: the receipt minus the frontend Vite serves) closes the app this command started, copies the build and starts it again — an app this command did not start is refused already. Then a Vite dev server (port 5199, `strictPort: false`) with `packExternalsPlugin`; writes the `pack-dev-servers` marker (`writeDevServerMarker`). Without an FE entry: `watchRebuildFallback`. **A profile** (`src/app/profiles.ts`) is a data dir and nothing else — `appName` and runtime environment are untouched, so `--host beta` works, and a profile is bound to no kind of app: a checkout and a packaged build keep their stores in the same place inside it, so a dir is a dir. `dev` threads one `AppPlace` (`{env, userDataDir?}`) through every `resolveAppEnvironment` and sets `APACK_USER_DATA_DIR` plus `APACK_SECRETS_VAULT=file` in the launch env, **only when a profile was named**: setting the first unconditionally would move a plain run's logs into the data dir and override the caller's own variable. **What the session holds is one owner** (`src/app/dev-hold.ts`), taken before the build rather than after the dev server, because that is when Ctrl-C actually arrives. It releases in two phases, and which phase a resource is in is the point: `releaseNow` is everything a synchronous `exit` handler can do — the records before the things they describe, then the server, then the app — and `release` is every other way a session ends, which waits for the app to have gone before removing a throwaway data dir from under its open files. `tests/app/dev-hold.spec.ts` is where that order is written down. **A spawned app on a profile closes itself when nothing attaches** (`reapsWhenIdle`, `IDLE_REAP_MS`): `startedBy: 'drive'` **and** a profile, because the development dir is `mayReclaim`'s and a person's app is nobody's to close on a timer. Each question bumps the session file's mtime (`touchSession`) and the wait is that deadline re-derived rather than an interval, so an idle app wakes the timer once. `--with-secrets` (`src/app/profile-secrets.ts`) copies the environment's stored secrets into a **newly created** profile by carrying its data key across rather than re-encrypting, into the profile's own file vault — so `rm -rf` still removes them and the keychain gains nothing. It addresses that store through `@apackdev/host/secrets`' `dataKeyAccount`/`dataKeyFile` rather than respelling either convention, and names the credential store's service with `resolveAppEnvironment({ env }).appName` — the accessor the app's own store reads, so no second copy of `APP_NAMES` exists to drift (deriving it from `basename(appDataDirFor(env))` instead would assume `platformDataDir` puts the app name last) |
| `npm run dev:drive -- [script \| --eval <body>]` | `commands/drive.ts`, `src/app/drive-attach.ts` | **Mainly an agent's tool.** Two halves. **A question** — `--eval <body>`, `--query <code>`, `--state` — is asked of the app `npm run dev:open --` is holding, over the debug port in its session file (`@apackdev/host/dev-session`): `attachableApp` reads it, `askAttached` attaches and asks, and stdout carries one JSON object (`value`, `state`, `startedBy`, `supervisorPid`) with the exit code as the status — 0, 3 for no app, 1 for a failed verb. With no app it refuses rather than launching one, naming `--spawn`, which runs the repository app-session entry point **detached** (`spawnDevApp`) and keeps it; `--fresh` implies it. **`askTarget` answers both halves of "which data dir" at once** — the dir to wait on and the flags that make `dev` open it — because they were two functions that disagreed about `--fresh`, which either attached to the development dir ignoring the flag or waited out the two-minute deadline at a path nothing writes. `--fresh` is resolved to a *name* here, since a question must know the dir before the app exists; `dev`'s `openProfile` creates it, which is also what keeps `--with-secrets` meaningful and keeps an `--rm` dir out of `.ephemeral/<pid>-…`, where the pid would be this process's and the app outlives it. `profiles.spec.ts` holds the agreement as a round trip through the parser `dev` uses. `@apackdev/testing` is resolved at runtime from the pack, never imported — it is a devDependency and `bundle-package.ts` would refuse the bundle. **A script** still goes through the Playwright runner: `playwright test --config drive/playwright.config.ts` through `fixtureEnv` plus `PLAYWRIGHT_VISIBLE=1` (shown, so a person can watch) and `E2E_DATA_DIR` for a profile, launching its own app. A question attaches and a program gets a dir, which is a decision rather than a leftover: a script whose result depends on whatever surface was left open has undeclared inputs. Scaffolds `drive/` on first use (config, README, a `*` gitignore with the two tracked files negated); a config that has stopped calling `defineDriveConfig` is reported once with the two lines that replace it (`DriveScaffold.keptStale`). **The repository drive entry point always drives the app itself; `pack drive` requires a pack** (`driveTarget`), which is what lets this repo's `drive*` npm scripts be thin calls to this command: `PACK_DIR` is unset so the fixture builds and installs nothing, and `fixtureEnv` keeps the `@apackdev/source` condition, since the subject is the checkout's own source |
| `pack init-tests` | `commands/init-tests.ts` | Both halves. Playwright: `playwright.config.ts`, `tests/e2e/smoke.spec.ts`, `.gitignore` entries, `@apackdev/testing` (`^cliVersion()`) + `@playwright/test`. Contract: `scaffoldUnitTestSetup()` (`vitest.config.ts`, `tests/setup.ts`, devDependencies) unless `tests/setup.ts` is already there |
| `pack test [--host <path> \| --host beta]`, `test --contract` | `commands/test.ts`, `src/app/` | Needs `playwright.config.ts`. Runs the pack's Playwright CLI with `fixtureEnv()`. Details in `packages/apack-testing/CLAUDE.md`. `--contract` runs the pack's vitest instead and starts no app — the checks that read compiled output, generated types and the harness; it is a no-op with a message in a pack with no vitest config, and `tests/scripts/test-external-pack-contract.sh` runs the fixtures through it |
| `open [--channel <name>]` | `commands/open.ts` | Open the installed app without debugging; no pack inferred from cwd |
| `db <command>` | `commands/db/` | The app's database, offline, through `@apackdev/host/database` (`openAppDatabase`, `findRunningApp`): `query`/`exec`/`repl` (`code.ts`, `repl.ts`: `@apackdev/sdk/database-console`'s runners, with `EARS` from the installed packs' manifests **and the entity types the data turned out to hold** (`consoleScope`, the SDK's `consoleEars`), as the app's console builds it from its registered packs (`installedEars`); declared wins on a collision, so an observed type only ever adds a name that stood for nothing, and `relKinds` is not widened because `RELATES_TO` is `'relates_to'` and the data holds only the value. `undeclaredEntityTypes` reports the rest on stderr with a row count each — which is the half `InstalledSchema.degraded` cannot cover, its condition being that no pack was read at all), `runs` (`runs.ts`: the run history's flow runs, newest first, or one run's tree as JSON with `--run`, read from its own store read-only, with no database opened), `script` (`script.ts`: a file whose default export is called with the open database, since the published CLI's own engine copy isn't the one a script would open; TypeScript is bundled to a temp file with its packages resolved to absolute paths from the script's directory, so nothing is written where the script lives and `import.meta` still points at it), `inspect`, `export`, and `import`/`reset`/`clear-settings` (`destructive.ts`: without `--force` they list the change and open the database read-only, so a dry run works while an app runs and against files it may not write; `reset` names each stored secret it deletes by provider and label, since no backup holds them, and `--keep-keys` deletes only the data (the flag predates the store being described as secrets rather than keys)). `target.ts`: `-d`/`-b`/`--production`/`--data-dir`/`--profile` (one of them; an empty value for either of the last two is an error, and a command that writes must name its data dir). `--profile <name>` takes the name `dev` and `clean` print, resolved through `listProfiles` so an throwaway one — a level down, under `.ephemeral/` — answers to its printed name, and a name matching none lists what there is. It carries no environment and needs none: once a data dir is named, `env` reaches only `resolveAppEnvironment`, whose every path here is joined onto that dir, which is why it is exclusive with the app flags rather than combining with them, `--schema-from <path>` (packs naming the entity types a data dir publishes none of — a snapshot file, a pack directory, or a directory of them, so one flag covers every pack in an app, a checkout or a published `host-packs` — a read degrades and warns, since a name the schema lacks is one the console and the engine refuse, and a **write is refused**, since it would stop part way on the first type the schema lacks; the path is resolved whether or not it is needed, so a typo is an error rather than a flag that did nothing), prints the target on stderr, refuses writes while an app runs on it, warns reads, and holds the data dir's write lock for a change (`holdDatabaseWriteLock`). A flag resolves to that app's own data dir (`appDataDirFor`, `@apackdev/sdk/env`), so `APACK_USER_DATA_DIR` can't redirect a named target; with no flag the variable still applies, which is how the root `db:*` scripts and the specs read a temp data dir. `withDatabase` closes the database after a command, reporting a failed close without ever hiding what the command hit first. `elmdb` is a dependency (the version `vendor/elmdb` links), external in the bundle. Spec: `tests/commands/db.integration.spec.ts` |
| `profiles` | `commands/profiles.ts` | Every data dir on the machine, and the verbs over them: `new`, `rename`, `rm [--leaked]` for a profile, plus `trim` and `stop` for any data dir. **`trim` is where a data dir's size goes**: it removes the seven caches Chromium rebuilds (`REGENERABLE_DIRS`), takes no `--force` because nothing it removes is the user's, and skips a dir an app is running on, those files being open. Measured 2026-10-10, it freed 1.3GB of a 1.6GB development dir and 13MB of a 1.4GB production one — the difference being 666MB of `Partitions`, the in-app browser's logins, which is why the exclusions are the design rather than a precaution. **`stop` ends the app on a data dir**, taking the pid from a record and never a search: a session's `supervisorPid` first, since that holder's teardown closes the app *and* cleans up after it, else the app lock's. It exists because the listing already names the pid, and a command that names a pid and leaves you to `kill` it stops one step short. Both resolve a name through one lookup over builds and profiles, which works only because a profile may not be named after a build. **"Is anything using this dir" is one predicate** (`dataDirInUse`), which the listing, `trim`, `stop`, `rename` and `rm` all ask, because it is one question: Electron allows one app per data dir. It reads two records — the API's port file, and Chromium's own `SingletonLock`. The second is only ever an addition, being another product's private format, POSIX-only and failing open, which is why `findRunningApp` refuses it for the database question where a wrong "no app" lets a tool write under a running one. It is there because an app with no port file is still an app, its API not up yet or a record removed. Two groups, listed apart because they are different things — an **environment** per `APP_ENVS` (`appDataDirFor`), which nothing here removes, and the **profiles** from `listProfiles`. An environment row says whether an app has it open, the version `host.json` recorded, and `(no app data)` when the dir holds only a browser profile, which is what tells a data dir from something Electron left: measured 2026-10-02, `development` held 1.5GB of profile and no app dir at all. **Sizes are opt-in** (`--sizes`): `dirBytes` over the real dirs is 674ms for production's 1.4GB and 1255ms for development's 1.5GB, so a listing whose job is names and paths does not pay ~2s of walking; `list` takes its `resolve` and `bytes` as parameters so a spec can answer for a temp tree and watch that the default walks nothing. `new <name>` **refuses** a name that exists where `openProfile` would open it — that call is for `run --profile x`, where reuse is the point. It replaced `clean --profiles`, so there is one door to removing a data dir |
| `pack info`, `pack doctor`, `pack clean` | `commands/info.ts`, `pack-doctor.ts`, `clean.ts` | Pack summary, manifest/source checks with failing exit status, and removal of generated/build output |
| `doctor [--channel <name>]` | `commands/doctor.ts` | Read-only production/beta bundle, data, and API-listener checks; shared bundle validation with app installation |
| `cache clean [--all]` | `commands/cache-clean.ts` | Reclaim downloaded beta builds, keeping the newest unless --all; tests use temporary caches |

`src/app/pack-host.ts` owns executable selection. `--host` / `APACK_HOST` always mean a checkout or `.app` path; `--host beta` / `APACK_HOST=beta` mean a downloaded pack-authoring host. Command flags take precedence over environment selectors. Conflicting selectors are refused.

- `resolveRepositoryHost`: validate the repository entry point’s own checkout; no selector or release fallback.
- `resolvePackHost` with development policy: explicit host, linked checkout, then compatible cached/downloaded beta.
- `resolvePackHost` with test policy: explicit host or compatible cached/downloaded beta; no implicit checkout derivation.
- `configuredHostPackagesDir`: dependency lookup reads packages without requiring runnable app outputs. Packaged paths point to their exact bundle, rather than another cached release.

Packaged channels come from `build-manifest.json`, never a release tag or executable name. `developmentHostEnv` refuses production bundles for live pack development and requires profiles for other packaged hosts. Only source development launches publish debugging sessions. Release verification uses `pack test` and isolated test data.

`dev-hold.ts` owns session teardown. Every shutdown caller awaits one cleanup promise: records and servers go first, then the owned app, then the disposable profile. `profiles.ts` resolves printed names across regular and temporary storage; reopening a temporary profile does not claim cleanup ownership. `beta-app.ts` owns verified downloads and caching, and `playwright.ts` resolves the runner.

## Build pipeline (`commands/build.ts`)

Public builds, release verification and development builds use `build/build-process.ts`.
`createPackBuilder(root)` owns one compiler copy and serializes fresh worker processes. Before reuse it
refreshes linked packages and verifies both the selected compiler's current inputs and its copied bytes.
The selected runtime executable is copied into that same owner and used for both backend and Vite
workers. `compiler-runtime.ts` inventories runtime bytes, executable modes, links and directory
membership; Electron includes its adjacent frameworks (or distribution directory outside macOS).
Copied runtime bytes are verified before admission and included in compiler identity and reuse checks.
Runtime selector observations feed the existing compiler watcher separately from copied bytes: selected
Windows OS policy files and missing context candidates must remain subscribed without being copied.
`compiler-runtime-pe.spec.ts` covers that boundary with inert metadata; the existing Windows application
context integration case verifies actual selector observations and preserved native admission.
Clone-capable runtime copies are still verified against the bytes read for identity. External linked
runtime libraries and other-platform acceptance remain B1 work; the runtime version map alone does not
close those requirements. A changed compiler/runtime or damaged copy is replaced.
`runPackBuild` closes this scope after a single build;
a watcher retains it until close. Closing aborts active work, drains the worker and input observers,
then releases the installation.

`pack dev` retains that builder across its initial build and watcher. `serveFrontend` runs the existing
`packDevServerConfig` in `frontend-worker`, from the same captured compiler, with live authored sources
and a private writable Vite/temp workspace. A ready replacement publishes its marker before the old
frontend is retired; worker closure and its POSIX group precede compiler disposal. The watcher accepts
the session's build operation and owns only its subscriptions; the session closes the shared builder.
Pack/npm and shared SDK/UI metadata, module inventory and entry selection also identify the frontend
configuration. Changes replace its generation after a successful build; ordinary source edits keep
Vite's live graph. Metadata lookup reuses `findPackageDirectory`, avoiding Node's cached link resolution.
The compiler watcher also fingerprints/subscribes to the selected distributable compiler graph,
runtime inventory and configured esbuild override, including an absent override. These probes run
before pack discovery so broken configuration retains tooling repair subscriptions. Existing physical
link guards, signatures and coalescing handle those events; no pack edit is needed to trigger refresh.

The parent holds the pack build lock through worker closure and publication. Workers only prepare and
seal a candidate, report its authored-input hash and sealed revision, drain diagnostics, and exit.
The parent waits for process closure, verifies the exact sealed output and authored hash, then replaces
dist. POSIX workers own a process group: inherited subprocesses must be terminal before publication.
Both build and Vite workers launch through `spawnCompilerWorker`. Windows uses the captured
`bin/compiler-windows.ps1`: create the worker suspended, assign its private kill-on-close Job Object,
then resume it with inherited Node IPC/stdio. Pass the requested Node environment in memory to
`CreateProcessW`; PowerShell startup must not change compiler inputs or persist environment values. Normal completion terminates remaining descendants and
waits for an empty job before the launcher exits; parent loss or forced launcher termination closes the
job handle. Keep launcher/configuration temp files inside the existing worker workspace. Frontend
readiness reports the actual Vite worker PID, independently of the platform lifetime owner.
Cancellation permits two seconds for worker SIGTERM cleanup before forced termination; loss of parent
IPC stops the owned group, and that listener stays active through final diagnostics. Exit-handler writes therefore cannot silently change an accepted candidate; aborts and refusals
clean staging while preserving the incumbent. This handoff is not the complete source/compiler input
receipt and must not authorize passive source freshness.

`withBuildSignals` owns public one-shot/watch cancellation before startup and restores the original
signal exit after cleanup. Development supplies its own build-lifetime signal and hands initial-build
and watcher-startup promises to its hold before awaiting them; profile removal and exit wait for both.
Release verification uses the same build owner and reports its existing recovery state before
interrupted exit. Its synchronous test runners and later publishing phases keep their own signal behavior.

`build/compiler-installation.ts` copies bytes supplied by the host's normalized package-input graph,
preserves physical module/link resolution and executable bits, verifies the copy and makes its inputs
read-only. **The copy lives in a machine-wide store, one entry per input** (`compilerStoreRoot`:
`<cliDirs cache>/compilers`, `APACK_COMPILER_STORE` overrides it), keyed by the source graph, the runtime's
contents and the esbuild selection. Every build and process with the same inputs reuses that entry, verified
exactly as a fresh capture is, so the runtime and compiler executables keep one path and macOS assesses them
once rather than per build. A damaged entry is captured again under a cross-process lock. Each holder marks its
entry in use (`<entry>.users/<pid>-…`) until it disposes the installation, and a capture that adds an entry prunes
the store to the `COMPILER_STORE_ENTRIES` most recently used, never removing one a live process holds; a checkout
makes a new entry on every compiler rebuild, so an unbounded store grew by a runtime copy per edit.
`apack cache clean` removes every entry not in use. Specs capture into a per-run,
per-worker store (`tests/_support/compiler-store*.ts`). Its private metadata records the compiler fingerprint, captured package directories and
source-path mappings. Workers require this metadata to belong to their actual CLI; they keep the
selected compiler rather than hand off to the project again. Module identity, diagnostic reads and
frontend subscriptions use source origins. Initial execution context also includes the inherited
environment digest from `compiler-environment.ts`, captured before user initialization. Raw environment
maps are not recorded; private transport/temp/cache fields are excluded and owned paths use source
origins. NODE_OPTIONS keeps its separate ordered-options contract. The same environment digest
participates in frontend configuration and watcher signatures, including custom content/VITE keys.
This is conservative: an included variable changes identity even if a particular compiler ignores it.
Glob selection stays in TypeScript, but its serialized facts use the existing filesystem read scope:
complete authored membership covers the source root, while outside/dependency enumeration records
native directory/metadata observations. Native replay uses the same authored-output exclusions; it
requires no TypeScript execution or second glob implementation. Local captured glob results and final
live compiler-side validation remain in place.
Pack and outside-module inputs are rechecked before publication; the already captured compiler fingerprint is reused within its immutable lifetime.

Windows loader metadata is read by `bin/compiler-pe-process.ps1`, shipped with the captured CLI.
It reuses the helper Job Object before optional C# compilation. The inspector reads actual loaded
modules and native PATH; a worker's private or replaced `process.env` is not the OS loader state.
Do not reintroduce `process.report.getReport()` for Windows queries: concurrent worker reports
reproduce heap corruption. Only the immutable ntdll directory is cached; policy, modules and PATH stay
live. See the [report-reader evidence](../../docs/references/evidence/build-input-snapshot-proof.md#windows-process-metadata-reader-without-diagnostic-reports--2026-10-18).

The runtime capture declares `runtimeDirectory`; the shared launcher uses it for linked-library
admission before native constructors can run. On macOS, Electron includes the complete Contents
directory: its signature binds Info.plist and sealed resources as well as the executable/frameworks.
Use Electron’s `original-fs` throughout runtime/installation ownership, including cleanup, so ASAR
files stay physical archives. Compiler-source reads retain their existing filesystem behavior.
Keep relative framework link text verbatim and include it in runtime identity; resolving to the same
file does not preserve the signature seal. `compiler-runtime-copy.spec.ts` exercises the real copier
with inert runtime bytes, so it can verify this locally without executing a copied runtime. The optional CI input `compiler_macos_signing=true` prepares a private Electron copy with
our Developer ID certificate and the exact app entitlements, then runs only its captured-runtime probe
unless another filter is supplied. Signing and keychain cleanup happen on the disposable runner; no
notarization, release workflow, installed-app change or signing exception is involved.
Resolve executable-relative paths against the selected child runtime and relative searches
against its cwd, preserving main-image selection and signing permissions.

Configured `ESBUILD_BINARY_PATH` executables belong to that installation too. Relative overrides resolve
against the worker checkout; the worker receives the private copy. Missing overrides keep esbuild's
package fallback. The installation's `isCurrent` checks selection, original/captured bytes and package
graphs before reuse; the copied executable lives and is reclaimed with its store entry.

`bin/apack.mjs` selects `build-worker` only with its private worker handoff and parent IPC channel.
It calls `stopReads()` before loading the worker bundle, ending preload filesystem interception while
keeping the captured view and native admission alive. `disposeLocal()` ends both; these are distinct phases.
That entry checks the compiler inputs before importing `build()`, avoiding recursive command dispatch;
it ships beside `cli.js`. Internal compiler tests call `build()` in-process; process-boundary tests
exercise the real bootstrap and runner.

Read trees beneath `APACK_BUILD_INPUTS_DIRECTORY` retain their files until the parent settles the
compiler process and removes the workspace. Disposing a frame closes its API and bookkeeping; it
cannot unlink DLLs still mapped by the worker. Standalone trees own their own deletion, and are named after
their process (`apack-inputs-<pid>-…`) so the next standalone tree removes any whose process died before disposing it.

The macOS native-library regression compiles a small addon with `clang` and the selected Node
installation's `include/node` headers. These are developer test requirements, not CLI runtime
dependencies. It verifies package-relative loading from captured bytes and refuses direct/transitive
absolute-library escapes before addon initialization. The binary reader is dependency-free; it does not
run `otool` or require developer tools at CLI runtime. The approved native support boundary is in
`docs/references/adr/native-compiler-input-boundary.md`; startup/thread/Vite and other-platform closure
remain separate from this module-reader checkpoint.

Use `splitCompilerModulePath` for tsx filename scope queries; the `?` in a Windows device prefix
is part of the path. Use `relativeCompilerPath` for compiler ownership comparisons and `compilerSourcePath` for source
projection. Node passes extended Windows filenames to native loading; both sides of a comparison must
use the same spelling. The common file view uses `resolveCompilerPath` for drive-root identity; see
[Windows copy-path evidence](../../docs/references/evidence/build-input-snapshot-proof.md#windows-native-copy-path-identity-2026-10-17).

Retained Vite uses the same early bootstrap and native admission as backend builds, with a lazy view
that copies selected images rather than the authored package. Vue sources remain live for HMR.
Backend and frontend frames share checked per-thread native reports within their input workspace.
Reuse requires the exact source module and intact captured-file observations; loaded DLL names alone
do not establish ownership. Content-compiler resolution and native loading delegate to this same
startup owner; standalone in-process compilation retains direct admission. The inert
`compiler-native-inputs.spec.ts` checks owner refusal propagation and standalone enforcement. Before reusing a frontend generation, its builder checks native inputs
across the main thread, loader and owned workers. The check is cancellable, and retirement settles the process owner before removing
its private read trees. Live watch subscription delivery and broader platform admission remain tracked
in the owning goal; native input checks alone do not establish those guarantees.

`@apackdev/host/build/compiler-inputs` owns metadata, bytes, physical bindings and directory/glob results
for one compiler frame. Its `createPackCompilerInputView` captures authored bytes, declared npm dependency
membership and the files resolvers read directly (`package.json`, `tsconfig*.json`, `jsconfig.json`), and
missing lookups, before user preloads. Other dependency bytes become inputs when a compiler first reads them, so
a dependency file nothing reads is not an input (`readPackageInputs` with `dependencyContents: 'resolution'`;
compiler installations still capture whole packages). Configuration, Vue extraction and the
compiler host reuse that inventory and view. Repeated queries
reuse captured data; a final check refuses changed bytes, missing targets, link changes or membership.
Origin mappings and returned arrays cannot mutate its fingerprint. Root membership uses the shared
pack-input walker. A captured pack root uses the same source projection as its files for fingerprints
and discovered-package ordering; reads and validation still use its owned physical files.
`captureCompilationInputs` retains the scan's validator, rechecking its read-set plus
package/tool/options inputs without reconstructing the TypeScript program. It is scoped to one build.
Authored files and package-graph callback bytes seed the same owned view. After codegen,
`captureGenerated()` admits its completed bindings separately from authored membership. All five native
bundle paths, including flow helpers, consume copied bytes from that view through esbuild's `onLoad`;
callers cannot mutate the owned buffers. Native resolution still uses the original namespace. This
owns native module bytes.

Declaration bundles (facade, flow helpers and DSLs) materialize that view into one lazy
`compiler-read-tree.ts` tree per build. Captured bytes, package links, positive/missing queries and
executable file modes define it; source origins remain the record of reads. The input directories are
read-only and verified before publication. A separate writable directory holds derived declaration
configuration. Compiler option projection lives in `compiler-configuration.ts`, not in the filesystem.
Declaration programs capture a nearest parent config when no explicit pack config exists; native
per-file config discovery keeps its existing semantics. Normal cleanup precedes publication and also
runs on failures. Each public worker's parent owns its workspace and removes abandoned read-only trees
after child close without following aliases. Startup/preload, content and frontend reads now share
captured input ownership. External native-library/platform lifetime acceptance, expected emitted/copied
output completeness and passive-consumer policies remain in the discovery goal; the completed record
alone does not close those requirements.

1. `parseManifest`; then `buildStagingDir` (`.apack/build/`), where every phase below writes. `dist/` is
   left alone until the end, when the staged tree is renamed over it (`replaceDir`), so a reader finds the previous
   build whole or this one whole — every reader of a pack's output reads a missing output as *not built*,
   and clearing `dist` first published ~20s in which that was the answer. A build that throws anywhere
   removes the staged tree and leaves the previous build in place.
2. Unless `--skip-generate`: `resolveDeps` → `generateEntries`. `@apackdev/host/build/pack-inputs` supplies the shared authored-file scope; facade/DSL cache keys include generated entries and all asset extensions. The build captures authored inputs before reading the manifest and refuses publication if their content identity changed by completion.
3. Feature schemas and explicit defaults are validated by the common compiler during manifest decoding; no settings modules execute.
4. Dependencies' `steps.build.mjs` and manifests feed `buildPackConfigFromManifest`. `compilePack` loads step definitions, flow modules and custom content compilers through the same `createCompilerModuleLoader` scope: Node resolves against owned paths while tsx transforms captured ESM bytes under logical source URLs, preserving import.meta paths. A private loader below tsx supplies those bytes using the same storage projection as the input tree. CommonJS retains per-tree filenames for cache isolation; its metadata projection remains unfinished. Scope disposal awaits tsx unregistration before input cleanup. `bundlePackContentCompilers` then builds the declared `content.formats[].compiler` exports for dependents.
5. Facade types: `bundlePackTypes` (`build/types-bundler.ts`, rollup-plugin-dts) → `dist/types/pack-types.d.ts`, then the facade gate (below), then a **warning** when a committed `etc/pack-types.api.md` no longer matches the bundle in hand (`build/facade-report.ts`; nothing when the pack has no report). Then `bundlePackFlowHelpers` (`build/flow-helpers-bundler.ts`); the snapshot is written last, once every step succeeded.
6. `bundlePackStepBuild` (`src/__generated__/steps-build.ts`, which codegen writes from the manifest's `steps`), `bundlePackContentRuntime` + `checkContentRuntimeLoads`, `bundleDslDefs` (`build/dsl-defs.ts`, manifest `dsl`).
7. `bundlePackRuntime` → `dist/runtime/index.cjs`, then `bundlePackFE` (`build/fe-bundler.ts`, Vite library build) for `findFEEntry()` unless `--skip-fe`. Every pack, whoever ships it: the app loads a backend runtime and fetches a frontend bundle from the pack's own directory.

A failing bundle or gate is reported and the build continues, so every failure shows; the build then throws before writing the snapshot (built-in packs after step 6, external packs after step 8), so a failed build never leaves a snapshot advertising its output. **The snapshot, canonical manifest and producer-owned `integrity.json` are written into the staged tree before the rename**, in that order: the snapshot advertises what the build produced, so the tree it describes is what becomes `dist`. Build reuse verifies the previous receipt first; corrupted output is rebuilt rather than reused and re-sealed. Staging verifies the receipt and copied bytes, retaining the previous stage on failure. `bundleDslDefs` writes directly into staged `defs/`; the frontend bundle resolves generated
`dist/defs/... ?raw` imports against that staged directory. Frontends compile on every build; external
styles/assets and compiler-driven inputs are resolved by Vite rather than an incomplete reuse key.
The development server reads published `dist/defs` after the completed build. No DSL phase writes
into live output before publication, and a missing staged definition never falls back to the old copy. The apply-compiler bundle fails the build immediately. `PACK_LAYOUT` (`@apackdev/host/packs`) names the shared layout paths.

`dist/build-inputs.json` records completed source/dependency observations, package graph scope, the
selected compiler/runtime digest, initial execution-context digest and normalized build flags. It is
written after loader/thread settlement and final input validation, then sealed with the output by the
existing integrity receipt. Raw environment values and private compiler paths are not persisted.
Compiler-installation facts stay under the installation identity; source facts replay against originals
without importing compiler or pack code. Comparing another command's ambient environment is not replay.

`build/build-outputs.ts` retains expected writer bytes until final sealing. Frontend expectations come
from Vite's actual emitted graph and the existing public-file walk, including CSS, lazy/worker files,
maps and copied public files. Final validation refuses missing/changed expected output before creating
the receipt. Ordered emissions may replace public placeholders. This is an in-memory producer check,
not another published manifest. `compilePack.recordOutput` feeds compiled JSON, the content index and
regular media into the same check. Native bundles report their emitted bytes after source-map rewriting; facade/helper/DSL declarations
report their final rendered text. Reused phase files must match the prior verified receipt before
copying and retain the same final-byte expectations. Snapshot, cache and completed input metadata also
join the check. Flow-helper module text stays covered by the snapshot that actually carries it.

Private phase stamps live in `dist/phase-cache.json`, published with that completed record and output.
Cache reads verify the receipt and current source/dependency inputs before considering phase keys.
A reused phase retains its prior observations for final validation and the next completed record;
skipping its execution cannot erase its external inputs. A refused replacement keeps the incumbent
pair. Installation/archive staging omits both root build-only files. Missing, damaged or stale records
cause a cold rebuild. Archive/test/drive freshness policy migration remains owned by B5 in the goal.

- **`build/be-bundler.ts`**: `bundlePackSource` is the shared esbuild setup (captured pack tsconfig, path aliases, `package.json` `imports`, `rejectHostImportsPlugin`, which fails an import of `@apackdev/host` or of an export only the app loads (`APP_ONLY_EXPORTS`, `@apackdev/ears/lmdb`; `tests/build/host-import-guard.spec.ts`), `stubFrontendAssetsPlugin`). `HOST_EXTERNALS` = `SHARED_DEPS` + the `SHARED_INSTANCE_PACKAGES` (`@apackdev/sdk`, `@apackdev/ears`) and their subpaths (`sharedInstanceExternals()`). The content runtime keeps only the shared-instance packages external.
- **`build/build-reads.ts`**: bundler-observed inputs by phase in `.apack/reads.json` (esbuild inputs, Rollup watch files and Vite watch files). Bundlers receive `RecordReads`; `BUILD_PHASES` defines `BuildPhase`. The build carries rows for reused phases, and chain checks (`scripts/lib/build-reads.ts`, `repo-checks`' `dep-files.integration.spec.ts`) compare observed inputs with declared coverage. Rows describe a validated candidate; placement failure can leave them ahead of accepted output. They do not authorize reuse or source freshness. `APACK_NO_BUILD_READS=1` disables this optional diagnostic record.
- **`build/content-runtime-check.ts`**: loads `dist/build/content-runtime.mjs` in a fresh Node process with the SDK's optional peers blocked by a resolve hook, as a dependent's harness would load it. It omits compiler `NODE_OPTIONS`: initialization hooks must not supply globals or loaders that hide an unusable published runtime.
- **`build/fe-bundler.ts`**: `packExternalsPlugin` leaves host-shared imports (`getSharedFeDeps`, `getSdkFeModules`, and every `@apackdev/ui` export from `getUiFeModules` unless `build.bundleUi`) **external**, so the bundle emits the bare specifier and the app's document resolves it through its import map to the host's module. `keepExternalsBarePlugin` holds the same for `apack pack dev`'s dev server, where `vite:import-analysis` would otherwise rewrite an external to `/@id/<specifier>` — a URL only that server could answer, and it has nothing to answer with. It fails the build when an inlined SDK module reaches the SDK's host bindings (`runtime/host-runtime`, `runtime/fe-host`: an inlined copy has no app bound) and rejects `@apackdev/host`. Tailwind: the pack's `tailwind.config.{ts,js}` or a generated one over `src/**`, plus `@apackdev/ui`'s files with `build.bundleUi`; `tailwindInjectPlugin` prepends `@tailwind utilities` to the entry. `opaqueVendorPlugin` resolves each `build.opaqueDeps` package with rollup's `moduleSideEffects: 'no-treeshake'`, so a prebuilt dependency is included as published rather than walked — the include pass is most of this phase's cost and removes almost nothing from such a module (`tests/build/fe-bundler-opaque-deps.integration.spec.ts`; the measurement is in the surface's header).

## Facade gate

`facadeProblems(packDir, bundleFile)` in `build/facade-gate.ts` checks `dist/types/pack-types.d.ts` before it goes into the snapshot's `defs`. Dependents compile it with `skipLibCheck`, where these problems would silently become `any`:

- the bundle type-checks on its own (the pack's tsconfig, `skipLibCheck: false`, and no `customConditions`: a pack compiles against the packages' published `dist`); only diagnostics inside the bundle count;
- no relative or absolute imports;
- imports only `@apackdev/*`, `@apackdev/sdk`'s `peerDependencies` (as the pack resolves the SDK) and Node built-ins;
- no `@apackdev/*` import that installed dependents can't resolve: a `private` package (`@apackdev/host`) or an export only under `@apackdev/source` (`unpublishedReason`);
- every import resolves to declarations.

Each problem names the facade exports that reach it (`exportsReaching`). Specs: `tests/build/facade-gate.integration.spec.ts`, `facade-gate-system-contract.integration.spec.ts` (the contract's events reach the facade however the entry is declared), `facade-typing.integration.spec.ts`, `types-bundler-determinism.integration.spec.ts`.

The committed report is separate: `apack pack facade-report [--update]` (`commands/facade-report.ts`), which `packages/default-setup`'s `facade:check` / `facade:update` scripts invoke. It **re-takes the facade rather than reading one** — `generateEntries`, then the same `bundlePackTypes` the build runs, into a temp directory — normalizes it (sorted imports, declarations in name order, literal unions (including explicit `undefined`, preserving commented unions) sorted via `build/declaration-text.ts`, the pack's path shortened) and compares it with `etc/pack-types.api.md`. So it needs no build, and a `dist` built from older sources is not something it can mistake for the subject; a changed facade needs `facade:update`. Comparison applies the same union normalization to committed reports. The text and the comparison are `build/facade-report.ts`, shared with `build` so the two cannot word or normalise one report differently. It is a CLI command rather than a repo script because the two cannot reach each other: a repo script and a package's `src/` have no shared home, which would strand the normalisation it shares with the bundler in a third package.

## Source vs dist mode (`bin/apack.mjs`)

1. **Hand-off.** `projectCli()` resolves `@apackdev/cli` from the cwd. If that is a different install (by realpath), the bin imports that project's `bin/apack.mjs`, so a global, Homebrew or app-bundled `apack` runs the version the pack pins (`tests/commands/handoff.spec.ts`).
2. **tsx** is registered either way (`tsx/esm/api`): packs' TypeScript is loaded at build time.
3. **Dist mode**: `../dist/cli.js` exists, which is true only in the published layout (`dist/package/bin` next to `dist/package/dist/cli.js`). The bundle is imported.
4. **Source mode** (a checkout, where `packages/apack-cli/dist/cli.js` never exists): `module.register` installs `bin/source-hooks.mjs` with the checkout root. For `@apackdev/*` specifiers the hook retries with the `@apackdev/source` condition and keeps the result only when it lands in the checkout outside `node_modules`. Packs linked to the checkout get workspace source; installed copies keep their `dist`. `assertSourceResolution` (`@apackdev/host/build/source-resolution`) then fails if the checkout's SDK/UI would still resolve to `dist`. Then `../src/index.ts` is imported.

The hooks apply only to this process, and only to the CLI's own code: a pack is compiled and run against the packages' `dist` either way. Child processes the CLI starts for pack code get the condition stripped, not added (`fixtureEnv` for the Playwright runner, `checkContentRuntimeLoads`, the fixture's `launchEnv` for the app), so an `apack` invoked from a repo command doesn't leak it into them. The CLI's own `tsconfig.json` and `vitest.config.ts` set the condition, as every host config does. `bin/app-launcher.sh` runs `Resources/app/packages/apack-cli/dist/package/bin/apack.mjs` with `ELECTRON_RUN_AS_NODE=1` (`tests/commands/app-launcher.spec.ts`).

## Bundling (`scripts/bundle-package.ts`)

`npm run build:package -w @apackdev/cli` (part of `npm run packages:build`) writes `dist/package/`:

- esbuild bundles the `cli` entry (`src/index.ts`, ESM, node22, code splitting) with the shared-instance packages (`@apackdev/sdk`, `@apackdev/ears`) and the private `@apackdev/host` **inlined from source**; `@apackdev/testing/harness` keeps them external as peers. Every other package stays external and becomes a dependency at the workspace range. A `require` banner lets bundled CommonJS work.
- `bin/apack.mjs` is copied. The generated `package.json` pins each shared-instance package the CLI declares as a dependency to its workspace version (`@apackdev/sdk`; `@apackdev/ears` isn't declared, so it's only inlined) and drops `@apackdev/host`. A package with entries that keep the shared-instance packages external (`@apackdev/testing/harness`) declares them as peers at `^version` instead.
- No declarations (`attw` skips the CLI in `packages:check`; `publint` checks `dist/package`). `scripts/publish-packages.ts` publishes from `dist/package`.

Because host code is inlined, `@apackdev/host` imports are fine in `src/`. The CLI's scaffold templates (`src/commands/add`, `src/commands/init.ts`) are pack code and must not use it: `npm run check:specifiers` enforces that.

## Tests

Three suites, split by what a spec costs and needs:

- **`npm test -w @apackdev/cli`** — the fast half (`tests/**/*.spec.ts`, `vitest.config.ts`). The
  per-change loop.
- **`npm run test:integration -w @apackdev/cli`** — the expensive half (`tests/**/*.integration.spec.ts`,
  `vitest.integration.config.ts`, which caps worker threads because many of these specs spawn compilers of
  their own).
- **The native half** (`tests/**/*.native.spec.ts`, `vitest.native.config.ts`, run by the root
  `npm run test:native`) — specs that execute a captured native compiler runtime or hold live filesystem
  watchers: the compiler native/ELF/PE library specs, `build-worker`, the `watch-*` specs and the watcher
  cases of the frontend and package-input specs. Its own run so the gate can schedule it beside integration.
  It runs one file at a time, and a case gets a 300s budget (the `enormous` size), failed at twice it, since each composes cold captures,
  builds and watcher cycles; a case needing longer still declares a reviewed per-test budget.
  A native case whose subject is not the compiler installation shares one per file
  (`tests/_support/shared-compiler.ts`, passed to `createPackBuilder` as `captureCompiler`); a case about
  capture, the captured runtime, an esbuild override or an installation's removal captures its own.

On a Mac the native config refuses before importing specs (`compilerTestsRunHere`,
`@apackdev/host/build/compiler-test-host`) and runs in the Linux test container instead: `npm run chain` routes
it there, and `npm run test:linux -- <command>` runs a targeted one. A GitHub-hosted runner runs it directly.
The integration half runs directly everywhere: its builds reuse the shared compiler store, so macOS assesses
each runtime and compiler executable once. Live filesystem-watcher cases live in `*.native.spec.ts`; mocked watcher-error and cancellation
tests stay in the fast half. The guard does not restrict normal CLI use or development builds. The macOS-only
native cases (Electron's framework copy, signed Mach-O) still need `compiler_macos=true`.

`startPackBuildWatcher().done` reports terminal subscription failures after owned cleanup; `close()`
drains disposal. Both the public watch command and dev session await `done`. Syntax/build/reload errors
remain recoverable on a later edit; a broken subscription cancels the operation with its input path and
cause. Frontend replacement retains retiring subscriptions until asynchronous disposal settles.

Integration and native specs start processes asynchronously: `promisify(execFile)` with a timeout for one
short process, `runCommand` (`tests/_support/run-command.ts`) for the CLI or a nested vitest, which bounds each
command, stops its process group and names it when it fails. `check:specifiers` refuses a synchronous spawn there.

Real watcher integration edits use `tests/_support/watch-builds.ts`: wait at most 20s for a rebuild
request, bound its compiler operation at 60s, then retain the original 20s notification/output checks.
Initial capture keeps its 120s bound and cleanup has its own 20s bound. `rebuildAfter` does not replace assertions; preflight refusals
before a builder is invoked keep their direct notification check. Compose case budgets from these
phases; do not time the whole compilation as a missing-event wait.

**How many specs each half holds and what they cost is a command, not a line here**:
`npm run spec:dry -- packages/apack-cli/tests` answers both halves and prints the date it measured them.
A count written out here drifts with nothing to catch it, and re-counting only makes the next drift
smaller. That is what the root guide means by *"a count the `--list` flag derives does not"* earn its place.

**A spec changed halves on 2026-10-06, the first in this repo to do so on the slow report's evidence.**
`fe-bundler-proxy-exports` was the fast half's costliest at 3.07s and calls `vite.build` directly, which is
what the rule above means by spawning a compiler; a multi-threaded bundler in a nine-worker pool is what
this half's cap exists for. Its two siblings build as well and stayed — 1.5s and 1.3s, needing neither the
budget nor the cap — and `run-install` at 3.05s stayed because it spawns nothing at all, which is the
distinction the rule is about rather than the duration. The spec's header records it.

**Specs about the repo's own tooling are not here.** Fifteen of them were, and none was about the CLI: they
moved to `@app/repo-checks`, which is where a spec that reads `scripts/` belongs and where `npm run spec`
can reach one from a change to what it checks. `repo-check-boundary.spec.ts` there keeps them from coming
back.

**Which half a spec is in is a decision, declared by its filename**, and nothing re-derives it. What the
integration half buys is a 60s per-test budget instead of 15s (each failed only at twice it, `DEADLINE_FACTOR`), a worker pool capped at half the cores, and
separation from the per-change loop — so what belongs there is a spec that needs one of those, which in this
package means the ones that spawn compilers.

Deciding it by measured cost instead would need a recorded millisecond per spec, a window of readings, a
band, two idle floors and a machine identity — and it cannot work, because the quantity is not one number: a
spec in this package reads 2.8s in the fast pool and 0.64s in the integration pool, 4.37x apart against any
band narrow enough to be useful, so each half's reading demands a move the other takes back. Root `CLAUDE.md`'s
sample section has what the apparatus cost and what to read before adding another.

Slowness is visible rather than adjudicated: vitest prints any test over its 300ms threshold under its
file, the chain prints each step's five slowest tests, and the pool that runs this suite ranks its five
slowest *files* per half. If this package's fast half stops being worth running in a loop, that is what
shows it. A spec that is slow for a reason says so in its header (`// @slow: <reason>`), and the pool fails
the step if that stops being true — which is safe to gate on because load can only inflate a duration.

The `*.integration.spec.ts` suffix is orthogonal to the folders below, which group by area. It is a
decision rather than a mechanism, so renaming a spec is how it changes half.

The root `test:unit` runs the fast half last, being the slowest of the unit suites; CI and the pre-merge
chain run both halves (`.github/workflows/ci.yml`), after `packages:build`. The `published-*` specs read what `packages:build` wrote, so the suite's `pretest` (`scripts/ensure-packages-built.ts`, the command over `@apackdev/host/build/packages-built`) runs that build itself when anything it read has changed, and skips it otherwise. Freshness is a success stamp, not a timestamp: each build unit records a content fingerprint of its inputs (its own sources, `@apackdev/host`, the bundler script, the manifests and tsconfigs) under `node_modules/.cache/apack-packages-build/`, written only when the build returns, so an interrupted or failed build reads as not built rather than as fresh. A run that bypasses `pretest` (`npx vitest` directly) still refuses to test stale output, naming the workspace and why.

- `tests/build/`: bundlers and gates (`facade-*`, `content-runtime-*`, `dsl-defs`, `fe-bundler-*`, `host-import-guard`, `build-output-swap`, `feature-settings`, `step-collisions`, `build-registry`), how a pack's own paths are read and the checks on what a build produces here (`package-freshness`, `sweep-forget`, `checkout-packages`, `verify-node-modules`). The specs whose subject is the *published* packages are `@app/publish-checks`; `@apackdev/ui`'s own exports map and import side effects are its own suite's.
- `tests/commands/`: commands run end to end or through their exports: scaffold, `add`, pack, release, install `hostVersion`, a scaffolded pack installed and loaded by the host pack loader (`init-install-load`), dev install, hand-off, source hooks, app launcher,
  and what the shell may still decide about a pinned run (`fixture-env-reach`: the variables the Playwright fixture reads, derived
  from its own module graph, each one either decided by `fixtureEnv` or allow-listed with its reason).
- `tests/app/`: app target resolution, beta download (`ensureBetaApp`: macOS arm64 only), Playwright resolution, app version.
- `tests/harness/`: `@apackdev/testing/harness` from a scaffolded pack (`harness-setup`) and a dependent pack running default-setup's runtime (`dependency-runtime`, skipped until default-setup is built).
- `tests/commands/installed-app-deps.spec.ts`: resolving a pack's declared dependency from an installed app, which is the packs installed in that app's data dir.

A spec's path under `tests/` mirrors the source it covers, as it does in every package
([`test-inventory.md`](../../docs/references/test-inventory.md)); `commands/`, `build/` and `app/` are
`src/`'s own folders. `harness/` and `packs/` are the two that name a *dependency's* module instead —
`@apackdev/testing`'s harness and `@apackdev/host/packs` — which this package holds because it is where a
pack's whole toolchain is driven from, and `repo-checks/tests/spec-placement.spec.ts` records both with
that reason. `_support/` is the prefix that says a directory claims to mirror nothing.
- The packing fixture moved to `@app/publish-checks` and is imported from here as that package: `facade-typing`, `fe-bundler-host-registry`, `types-bundler-determinism` and `package-freshness` use it to build a consumer, which is the fixture rather than the subject. `tests/_support/pack-builds.ts` stays.
- `facade-typing` is **two specs over one suite**: `_support/facade-packs.ts` holds the packs, the consumer sources, the compiler helpers and the cases, and each spec calls `facadeSuite` for one dependency layout — workspace source, or the npm-packed packages. Split because it was the integration half's floor at 44.1s against a 60s birpc window, on the one axis that does not pay its fixture twice; that module's header has the before-and-after, including the pool wall that did **not** move.

### How a pack's own module paths are resolved

**One mechanism: `#` subpath imports from the pack's own `package.json`.** Native esbuild phases reuse the resolved compiler configuration captured by the build input view;
`esbuildTsconfig` projects its supported options and inherited alias targets without inventing a
`baseUrl`. Standalone bundler calls resolve their own configuration. This owns explicit configuration,
not all source reads or implicit ancestor-config discovery. There is no custom alias resolver:
`tsconfig-aliases.ts` and `makeAliasPlugin` were deleted with the `@/` aliases they served
([`goal-one-way-to-name-your-own-modules.md`](../../docs/archive/goals/goal-one-way-to-name-your-own-modules.md)),
because four separate bundler configs each had to re-implement a mapping no runtime reads. What follows is
what the audit of 2026-09-26 cost to establish, so it needn't be established again.

- **Nothing here resolves a pack's `#` imports any more.** A specifier names the file that is there
  ([`goal-pack-imports-name-the-file.md`](../../docs/archive/goals/goal-pack-imports-name-the-file.md)), and
  esbuild and Vite both resolve the pack's mapping themselves once it does — measured by deleting the two
  surfaces that used to supply the suffix and rebuilding: `apack pack build` over both fixture packs and
  default-setup green, and the API's tsup build byte for byte the same. What supplying the extension cost to
  establish is recorded in that goal's Outcome; what is left is `@apackdev/host/build/subpath-imports`, which
  reads `package.json` `imports` for the check below and resolves nothing.
- **`pack-resolution.ts`** asks where the pack's own compiler resolves the `@apackdev` packages, and refuses a
  pack that lands on a checkout's `src/`. It resolves rather than reading config (`ts.resolveModuleName` against
  the pack's own parsed options), because the routes to source are several — `customConditions`, an `extends`
  chain, a `paths` entry — and the message can then name the file it landed on. What makes it worth a rule:
  esbuild has no notion of `customConditions` (the string is absent from its binary) and the FE bundler names
  Vite's conditions outright, so a pack that enables it typechecks against source while shipping bundles built
  from `dist` — green locally, and wrong after publishing. `assertSourceResolution`
  (`@apackdev/host/build/source-resolution`) is the same question with the opposite expectation, asked of a host
  process; it lives in host and this cannot, because this needs `typescript` and `packages/api` imports host.
- **`own-module-specifiers-gate.ts`** refuses a specifier that names no file — extensionless, or the `.js` a
  pack never emits — through `@apackdev/host/build/own-module-specifiers`, the same rule
  `scripts/check-import-specifiers.ts` applies to the packs in this checkout. The rule is shared; the reading
  is not, because each caller already parses a pack's sources for other rules.
- **`pack-sources.ts` is that reading, once**: the files, an SFC's `<script>` blocks, and every specifier in
  them, from a syntax tree. `pack-rules.ts` reads every pack rule off it, and so does the repo's own script. A regex over the text was tried and is
  the reason this is a parser: a regex literal holding an unbalanced quote made a commented-out import look
  real and failed a build naming a comment, and three module-path forms (`vi.mock`, `require.resolve`,
  `import x = require(…)`) went unread.
- **The FE bundler reads neither `imports` nor supplies extensions, on purpose**: Vite resolves them
  natively. The evidence is `tests/packs/external-pack`, whose `features/memos/fe/state.ts` value-imports
  `#generated/events.ts` and whose FE bundle and Playwright suite pass.
- **A conditional target keeps the pack's own key order**, taking the first of `node`, `import`, `require`,
  `default` — Node's rule, not an imposed preference. `apack pack init` writes `"type": "module"`, so `import` is
  the condition a pack's entries are likeliest to carry. A *pattern* is matched the other way round, longest
  first, which is also Node's rule: key order named the wrong file for a pack declaring both `#gen/*` and
  `#gen/deep/*`.

An unreadable `package.json` is reported rather than passed over in silence, because the failure that
follows — "can't resolve `#generated/…`" — names neither the file nor the cause.

End-to-end coverage outside this package: `npm run test:external-pack` (`tests/packs`) and `npm run test:packaged-authoring` (packed tarballs, outside the monorepo).

App-only launch and automation are repository operations, not public CLI commands. Root npm scripts
call `scripts/app-dev.mjs` through source resolution; the app-only launch help and entry point live there,
not under CLI command modules; detached app spawning calls that same entry point
in the selected checkout. Pack spawning continues to call `apack pack dev`. Shared session lifecycle
and automation implementation remain in this package so both callers use the same ownership rules.

Dependency resolution caches complete verified builds by content revision under
`.apack/deps/<id>/builds/<revision>/`. A separately published `resolution.json` retains spec,
version and structured origin. CLI and harness use the shared host cache reader; snapshot-only type
data never exposes executable paths. Explicit `file:` builds also cache coherent producer bytes,
while read-only inspection writes nothing. Previously resolved paths remain valid after publication.

`build/dependency-inspection.ts` captures one read-only dependency frame for validation and doctor
presentation. `pack info --json` uses the same resolver and reads compiled content through the
verified build receipt, not source file counts. Missing, invalid and stale declarations remain explicit.
