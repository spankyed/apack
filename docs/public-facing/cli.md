# CLI Reference

The `apack` CLI manages the desktop app and packs. Installed-app operations are root commands, app development uses repository npm scripts, and pack operations live under `apack pack`. Bare namespaces display help.

Pack operations cover scaffolding, code generation, building, validation, testing, releasing and installation. It also reads and repairs the app's database (`apack db`).

## Installing

The npm CLI requires Node 22.15+ on the 22.x line, or Node 23.5+. The app-bundled CLI uses the app's included runtime.

- From the app (macOS): **apack → Install 'apack' command in PATH**. It links `/usr/local/bin/apack` (`apack-beta` for apack Beta) to the CLI bundled with the app, which runs on the app's own Node runtime.

npm and Homebrew installation are not yet available. For app development, follow the
[source checkout instructions](../../README.md#develop-apack).

Packs pin `@apackdev/cli` in `devDependencies`. Any `apack` run inside a pack hands off to that pinned version.

## Commands

| Command | Purpose |
|---|---|
| `apack open` | Open the installed production app; `--channel beta` or `--channel preview` selects another installed app |
| `apack install`, `upgrade`, `uninstall` | Manage published production/beta apps |
| `apack status` | Installed app version, running state, and paths; supports `--json` |
| `apack logs` | Recent installed-app logs; `--follow` streams new output |
| `apack doctor` | Read-only installed-app diagnostics; supports `--json` |
| `apack db backup`, `db backup verify` | Create and check restorable database/media backups |
| `apack profiles` | List stored profiles; supports `--json`, `--all`, and `--sizes` |
| `apack pack list`, `pack outdated`, `pack upgrade` | Inspect installed packs, check releases, and upgrade GitHub-installed packs |
| `apack pack dev` | Build, install, and watch a pack in a development host |
| `apack pack drive`, `pack test` | Automate or test a pack in its host |

`--channel` selects an installed/published app channel, `--host` selects a pack host,
and `--profile` selects stored data. Development is a data namespace, not a release channel.
`open --session` and root `drive` are removed. There is no production `--attach` option.
Debugging connections are enabled only for source development launches.
For app contributors working in the apack source monorepo, see the
[repository development guide](../../README.md#development) and [app automation guide](../../drive/README.md).

### App operations and reports

`apack status [--channel production|beta|preview] [--json]` reports the installed app version, paths, and whether its default data profile is in use, without launching it. For running apps on custom profiles, use `apack profiles`.

`apack logs [--channel production|beta|preview] [--follow] [--lines <count>]` reads the installed app’s `main.log` (100 recent lines by default). Following waits for the file and follows rotation; Ctrl-C stops the reader.

`apack db backup --out <new-directory> [--profile <name> | --data-dir <path>]` creates a full backup compatible with `apack db import`. Close the app first. The database, the run history and media are included; installed packs and secrets are excluded. The backup directory is accessible only to its owner. Existing destinations and destinations inside the source data directory are refused.

`apack db backup verify <directory> [--json]` checks that each listed store opens and that the listed media is there, before restoration. It does not open your app data. It checks the backup format and completeness; entity-type compatibility depends on the packs installed when you import. Invalid backups exit nonzero; JSON reports include `valid: false` and the error.

`apack pack outdated [--profile <name>] [--json]` checks GitHub-installed packs for newer releases compatible with the profile’s recorded app version. Beta profiles include prereleases. Local/URL installs and app-shipped packs are reported as unmanaged. A failed check exits nonzero; finding an update alone does not. CLI GitHub installs record their source for subsequent checks; uninstall removes that record.

`apack pack upgrade <id> [--profile <name>]` upgrades a GitHub-installed pack to its newest compatible release. Close the app first. The recorded app version and pack format are required. Checksums, pack identity/version, host compatibility, build format, enabled dependencies, and installed packs that depend on it are checked before replacement. Local/URL installs and app-managed packs are not upgraded by this command. A user-managed fork at an app-default ID can use its recorded GitHub source.

`apack doctor --json` emits one object with `channel`, `healthy`, and individual `checks`. Failed checks remain in the JSON report and the command exits nonzero.

`apack profiles --json [--all] [--sizes]` emits `environments` and `profiles` arrays, including their paths and running state. Temporary profiles require `--all`; numeric byte sizes require `--sizes`. JSON is supported for listings only.

`apack pack list --json [--profile <name>]` emits one object containing the selected profile, packs directory, and installed packs with their identity, version, enabled state, dependencies, and recorded update source. Unreadable manifests or installation records fail explicitly.

Reporting commands emit one JSON object on stdout when `--json` is selected. Errors go to stderr and exit nonzero. Human-readable output remains the default.

### Scaffolding

#### `apack pack init [name]`

Create a new pack from scratch. `name` is the pack id: lowercase letters, digits and hyphens (prompted for when omitted). The directory must not exist.

```bash
apack pack init my-pack
```

Creates no feature (add one with `apack pack add feature`). It writes:

- `apack.json`: one entity type named after the pack, empty `features`, `dependencies` and `permissions`, and `content.sources` with `actions`, `flows` and an `examples` entry using the `examples` content format (`markdown-tree`). No `extensions` section: `apack pack add step|artifact|block` each declare their own entry under it
- `package.json` (depends on `@apackdev/sdk`; pins `@apackdev/cli`, `@apackdev/testing`, `vitest`, `typescript`), `tsconfig.json`, `.gitignore`, `src/env.d.ts`
- `.github/workflows/release.yml`: publishes the GitHub release when `apack pack release` pushes a `v*` tag
- `src/content/actions/`, `src/content/flows/`, `src/content/examples/hello.md`
- `vitest.config.ts`, `tests/setup.ts` (the `@apackdev/testing/harness` setup) and `tests/<name>.spec.ts`

Then runs `generate` and `generate-entries`.

#### `apack pack add <entity> <name> [options]`

Add an entity to an existing pack. Run from inside a pack directory. Names other than a feature's are kebab-case (`^[a-z][a-z0-9-]*$`). Existing files are never overwritten.

| Entity | Command | What it creates |
|---|---|---|
| Feature | `apack pack add feature <name> --description <purpose> [--label <Label>] [--icon <Icon>] [--designation <role>]` | See below |
| Step | `apack pack add step <type> [--trigger]` | `src/extensions/steps/<type>/{build.ts,types.ts,form.vue}` (`types.ts` declares `DSL<Type>Node` and `<Type>Node`); with `--trigger`, `trigger.ts` in place of `build.ts`, holding a `TriggerFacet` rather than a `StepBuildFacet`. Declares one `extensions.steps.<type>` entry with inline `node` labels/defaults, an explicit `types` module, a `build` or `trigger` binding, and inline `fe` presentation with a lazy form target |
| Artifact | `apack pack add artifact <type> [--icon <Icon>]` | `src/extensions/artifacts/viewers/<type>-artifact.vue`; when the manifest declares `artifacts`, adds `{ type, fe: { icon } }` to that register file and the viewer to its `-fe.ts` `componentMap` |
| Block | `apack pack add block <type> [--input]` | `src/extensions/blocks/display/<Type>Block.vue` (or `input/<Type>Input.vue`); updates the `blocks` register file and its `-fe.ts` when the manifest declares `blocks` |
| Action | `apack pack add action <name> [--category <cat>]` | `src/content/actions/<category>/<name>.ts` (category defaults to the pack id) |
| Prompt | `apack pack add prompt <name>` | `src/content/prompts/<name>.ts` |
| Flow | `apack pack add flow <name>` | `src/content/flows/<name>.ts`. Needs a dependency that provides flow steps (e.g. `default-setup`) |
| Command | `apack pack add command <name> [--placeholder <text>] [--document <name>] [--folder <name>]` | A chat slash command: one `**<name>**: <placeholder>` line in a document under the `commands` source. A command is a line rather than a document, so one named with `--document` that already exists gains the line in its field section — several commands take no markdown editing in between. Refuses a name that document already defines, and a document with no field section |
| Document | `apack pack add document <name> [--content <text>] [--section <type>] [--folder <name>] [--tag <tag>]` | A document under the `documents` source. `--content` is the body, written as given — so a caller that already has the text needs no second step, and content holding its own `<!-- section:… -->` markers writes several sections. Without it the body explains the convention instead |
| Service | `apack pack add service <name> [--feature <feature>]` | `src/extensions/services/<name>.ts` in `extensions.services`, or `src/features/<feature>/be/services/<name>.ts` in that feature's `services`. The key is the camelCased name, the value `path#<camelName>Service` |
| Migration | `apack pack add migration [version] [--version <ver>]` | `src/migrations/<version>.ts` exporting `up()`, with a declarative description and function reference under `migrations.pack` (or `migrations.app` with `--app`). Version defaults to the manifest's |

`add feature`, `add service`, `add step`, `add artifact` and `add block` each declare what they add in `apack.json` and then run `generate-entries`, because the manifest entry is the whole declaration and codegen is what carries it into the pack's entries — there is no barrel to edit. `add migration` declares its own entry too. `add action`, `add prompt` and `add flow` only write files, their content being found by the directory `content.sources` already names. `add command` and `add document` are between the two: each writes a markdown document and declares the SDK's `commands` or `documents` source for it when the pack has none, so they need no format and no dependency. `--folder` nests it, which the compiler reads as the collection holding it. In a pack whose dependencies aren't installed yet, `generate-entries` can't read a system's events through `@apackdev/sdk`: the files and `apack.json` are still written, and `npm install` regenerates the entries (the pack's `prepare` script).

**`add feature`.** The name is the feature id: a lowercase letter, then letters and digits (`notes`, `calendarEvents`), because it becomes an identifier in generated code. `--designation`, if given, names the role it plays and may differ from the feature id. It creates:

- `src/features/<name>/be/system.ts`, `be/contract.ts` (the system's contract, which `apack.json` names), `be/types.ts`, `be/repository/index.ts`
- `src/features/<name>/fe/state.ts`, `fe/contract.ts`, `fe/canvas/list.vue`, `fe/settings.vue`
- `tests/features/<name>/be/system.spec.ts` (and `tests/setup.ts` with its devDependencies if the pack has none)

and adds a keyed `features.<name>` entry with its required `description`, explicit `types` pointing at `be/types.ts`, `settings` (including the custom `form` it writes), `system.entry`, `surface` (`state`, `canvas`, `label`, `icon`), empty `services`, and `repositories` `<name>Queries` and `<name>Commands` pointing at `be/repository/index.ts`.

### Code generation

#### `apack pack generate-entries`

Read `apack.json` and generate all files in `src/__generated__/`. Uses input hashing to skip when the manifest and template haven't changed. Pass `--force` to regenerate unconditionally.

#### `apack pack fetch-deps`

Resolve every dependency into `.apack/deps/<id>/`: a resolution record retains the declared spec, exact version, origin and content revision; immutable builds retain the complete verified pack layout. Resolution order:

1. Explicit `file:` dependencies: read directly, with no fallback
2. A selected host's own dependency builds, when `APACK_HOST` or the CLI's resolved host handoff is present
3. The workspace: nearest ancestor first, `packages/<id>` then `<id>`
4. The linked checkout when no host was explicitly selected
5. Installed app packs, then cached builds or GitHub releases as applicable

Every source must satisfy the declared range and pack identity. Current type data can be inspected independently of its executable-format stamp. Executable files require a matching stamp and a verified complete build; type-only data exposes no executable paths. A selected host's unbuilt or
incompatible dependency fails rather than being replaced by another workspace or app. Explicit
`file:` dependencies remain authoritative and are copied into a verified cache build for builds and tests. A cache hit preserves its original provenance; changed GitHub origins cannot reuse another repository’s cached resolution. Publication keeps previously resolved build paths intact. `apack pack build` uses the same resolution rules;
see [Manifest Reference — Dependencies](manifest.md#dependencies).

### Building

#### `apack pack build [--skip-generate] [--skip-fe] [--release]`

A build writes a verified pack layout into a staging directory, then replaces `dist/` only after
all phases succeed. A failed build preserves the previous complete `dist/`. See
[pack builds](pack-builds.md) for the build, archive, installed and native layouts.

The build:

1. Validates `apack.json`, prepares staging, and resolves dependencies.
2. Generates `src/__generated__/` from declarations and dependency snapshots (`--skip-generate` requires unchanged generation inputs and exact recorded output bytes; stale or missing files refuse before bundling). Declared settings schemas/defaults are inline; custom forms are separate declared modules.
3. Enforces pack rules, including the manifest's `checks.allow`, and refuses unresolved dependencies. Warns if generated dependency types differ from the resolved versions.
4. Compiles `content.sources` into `runtime/content/`, validating flows against dependency step build code, and bundles declared content compilers for dependents.
5. Bundles and checks the standalone `types/pack-types.d.ts` facade. Its imports must resolve through `@apackdev/*`, SDK peers or Node built-ins; a committed facade report mismatch produces a warning (`apack pack facade-report`).
6. Bundles flow helpers, step build facets and the content runtime used by dependents. Checks that the content runtime can load in a fresh Node process with the supported SDK dependencies.
7. Builds declared Monaco DSL definitions, the backend runtime, and the frontend unless `--skip-fe`. The frontend entry is `src/pack-entry-fe.ts` (or `.js`) when present, otherwise the generated entry. `--skip-fe` is valid only for packs with no declared frontend bindings: surfaces, designations, reference providers, custom settings forms, steps, artifacts, blocks, text editor extensions or app extensions require the frontend entry. An incomplete build refuses publication and retains the existing `dist/`.
8. Validates the snapshot and generated declaration identities, refuses inputs changed during the build, writes the manifest and integrity receipt, verifies the completed layout, and publishes staging as `dist/`.

The snapshot includes declaration data, entity/relation types, facade declarations, compiled help,
flow helpers and contribution provenance. Explicit `null` entity shapes remain untyped. Build-time
compilers, helpers and content runtime may execute during building; inspecting the completed snapshot
does not execute them. Discovery and executable bindings are separate contracts.

Compiled content has a separate verified `runtime/content/content.json` index. The common build reader
checks its owner, exact compiled source/dataset membership, written policy and required data files;
`apack pack info` uses that captured inventory. An omitted index or data file fails validation even
when an incomplete producer sealed the remaining files successfully.

Bundle and gate failures are reported and exit with code 1. `--release` minifies and drops source maps.
Files under `public/` are copied into the frontend output from the build's captured authored inputs.

Compiler workers inherit Node options from `NODE_OPTIONS`, including ordered `--require` and `--import`
preloads. Node arguments passed directly to the CLI configure its supervisor; custom export conditions
are also forwarded to the worker. Use `NODE_OPTIONS` when configuring compiler execution.
The separate published-content runtime check omits those options so compiler initialization cannot
hide missing runtime dependencies or provide globals that dependent packs will not have.
On macOS, native addon admission checks library dependencies and matching `DYLD_LIBRARY_PATH`
candidates. A library selected outside the captured package or normal OS libraries is refused before
addon initialization; an unused search directory is allowed.
`DYLD_INSERT_LIBRARIES` executes before that module-loading boundary and accepts normal OS libraries.
Load package libraries through captured compiler modules rather than inserting live package paths.
`DYLD_VERSIONED_LIBRARY_PATH` and `DYLD_VERSIONED_FRAMEWORK_PATH` accept only absolute operating-system
directories under `/usr/lib` or `/System/Library`, including their physical targets. Other configured
directories are refused before worker launch, even if their entries might be unused. Unset these
variables and use captured package-relative dependencies for package libraries.
`DYLD_SHARED_CACHE_DIR` selects a single directory and follows the same OS-directory policy. The normal
OS shared cache remains supported; custom caches outside OS library locations are refused before launch.

On Linux, ELF admission checks declared dependencies before addon initialization. Package libraries
must resolve through captured `$ORIGIN` paths; absolute paths back to a source package are refused.
Search uses launch-time loader tokens, RPATH/RUNPATH, `LD_LIBRARY_PATH`, the OS library cache and
default directories. `LD_PRELOAD`, `LD_AUDIT` and system-wide preload entries accept normal OS library
paths only. The installed ELF interpreter supplies its own search metadata; no `readelf` or `ldd`
installation is required. Failure to obtain that metadata is explicit.
The runtime's own linked libraries are checked before launch using the child executable, environment
and working directory. An unused `LD_LIBRARY_PATH` directory is allowed; a selected outside runtime
library is refused before its initialization code can run.

`apack pack build --watch` watches authored inputs throughout the pack, including `apack.json`,
modules outside `src/`, JSON schemas, assets and help. The authored watcher excludes generated,
build, dependency and Git trees. Compiler configuration, resolved TypeScript files and unresolved
lookup candidates are watched separately, including outside the pack; repairing a missing target
can rebuild without another authored edit. Linked authored data is watched through atomic replacement and retargeting; executable
module references still must remain physically inside the pack. It publishes through the same staged
build in a fresh CLI process before requesting development-host reload, so changed flow, step and
compiler modules cannot reuse the previous build's module cache;
invalid edits retain the previous verified build. Saves during a build schedule another run.
`--watch` cannot be combined with other build flags. This builds the complete build and can take
longer than rebundling only the runtime. `apack pack dev` uses this watcher and installs each successful
publication before reloading; Vite continues serving frontend changes.

A build also writes `.apack/reads.json`: the files each bundling phase read, as esbuild, Rollup and Vite report them, keyed by phase and relative to the pack. It is the build's own record of its inputs — what a build system calls a dep file — for a cache or a CI check that wants to know whether what it declared covers what the build touched; the build never reads it back, and a phase that didn't run is absent rather than empty. `APACK_NO_BUILD_READS=1` turns it off, for a read-only tree.

Selected hosts supply their built-in pack dependencies before ambient workspace copies. Incompatible or unbuilt host dependencies fail; explicit manifest `file:` dependencies remain authoritative.

A build resolves the pack's `@apackdev` packages to the `dist` each published package ships — the one layout a pack ever has, whether the packages came from the registry or from a link to an apack checkout. There is nothing to configure, and a pack's own configs set no resolution conditions. `apack pack test` and `apack pack dev` resolve the same way, so a pack's tests run against what its build compiled; against a checkout they first bring that `dist` up to date with the checkout's sources.

#### `apack pack archive [--out <dir>]`

Verify the build-owned `dist/integrity.json` and stage its recorded files into a verified pack (`integrity.json` lists a sha256 per file) and write `<id>-<version>.tgz` and `<id>-<version>.tgz.sha256` to `--out` (default: `.apack/archives`). Run `apack pack build` first (`--release` for publishable output). Verifies sealed output and recorded source/dependency inputs under the build lock, using the selected build’s compiler/options context. Rechecks inputs before publishing the archive; changed inputs refuse without replacing the previous archive. Keep custom output under `.apack/` or outside the pack to avoid introducing generated files into authored inputs.

#### `apack pack dev`

Launch apack with your pack installed and keep it in step with your edits.

It picks an app the way you tell it to — `--host <path>` for a local apack checkout, `--host beta` for a Beta that satisfies your `hostVersion` (a downloaded one if you have it, the newest otherwise) — and **with neither it works one out rather than asking**: the apack checkout your pack is built against, if there is one, else a cached/downloaded compatible Beta. Nothing is remembered, nothing is asked, and it prints which app it chose and which rule chose it.

Deriving the checkout is the right pairing rather than a convenience: a pack whose `@apackdev/*` resolve into a checkout is *compiled against that checkout's packages*, so running it inside a released Beta would pair source-built pack code with a released host. If that checkout is not built, `dev` says so and names `npm run build:default-setup && npm run build:runtime` instead of quietly using a Beta you were not built against.

`apack pack test` deliberately derives nothing — it pins from your `hostVersion` — so a test run means the same thing on a fresh machine as on one you have been developing on.

The environment follows the app: a checkout runs as `development`, and a packaged Beta runs as `beta`, because a packaged build stamps its own channel. Neither touches production data.

**Profiles.** By default `dev` uses the shared development data dir, so every run inherits what the last one left. A profile is a data dir of its own, created on demand:

- `--profile <name>` — that one, created the first time you name it, and kept
- `--fresh` — a new one, whose name is printed so you can come back to it with `--profile`
- `--fresh --rm` — the same, removed when the command exits
- `--profile <name> --rm` — the same for a name you choose. It removes only a profile **this run creates**: one that is already there holds data you kept, so the flag is refused rather than quietly ignored, and `apack profiles rm <name>` is what removes that one
- `--with-secrets` — copy the secrets this environment already holds into the **new** profile, so a throwaway run can use them without you entering anything again. The values are encrypted in the profile's own data dir, and the data key that decrypts them goes in a file beside them rather than the OS credential store, so `rm -rf` removes both; that also means they are protected by file permissions alone, which is the trade every profile makes and which Settings states

A profile is self-contained — its data, packs, logs and secrets are all inside it, and the data key that encrypts its secrets goes in a file beside them rather than into the OS keychain, which is shared by every app of one channel. So `rm -rf` is the whole cleanup, and `apack profiles rm <name>` does it for you. The path is printed, and `apack db --profile <name>` opens its database — by the same name `dev` and `profiles` show, throwaway ones included.

A profile is a data dir and nothing else: the environment, the app's identity and the URL scheme are untouched, so `--host beta` and a local checkout can both run the same profile. **The word is `profile` rather than `instance` because an instance of an app is a running process** — which is what Electron's single-instance lock is about — where this is storage, and a named, disposable data dir that leaves the app's identity alone is what a browser calls a profile.

`dev` first builds the pack, then starts or reuses the app on that data dir and installs the verified
build. Closing `dev` closes the app it started. It then:

- serves the FE entry from a Vite dev server (port 5199, or the next free one) with HMR, recording its port in `pack-dev-servers/<id>.json` in the app's data dir so the app's `pack://` requests go to it. The marker sits outside the installed pack, which stays exactly the verified files, and is removed when `apack pack dev` exits
- on `apack.json` changes, regenerates `src/__generated__/`
- on authored input changes, rebuilds and has the app install the verified pack. A checkout's app installs and starts each build itself. A packaged app (`--host beta`) cannot be asked to, so `dev` copies the build in while the app is stopped: a rebuild that changes the backend restarts the app `dev` started, and one that changes only the frontend leaves it to Vite

Backend builds and Vite use the same captured compiler generation. A compiler refresh starts a ready
replacement server, updates its marker and retires the old server; a failed replacement startup keeps
the incumbent. Each server owns its writable cache. Packs without an FE entry use the same build watcher.
Development configuration changes replace the server with the next successful build; ordinary source
edits continue through HMR.

#### `apack pack drive [script | --eval <body>] [--host <path>] [profile flags]`

Launch apack and drive it from a script: navigate, send events, read state, take screenshots.

**This is mainly for an agent.** It is how a coding agent debugs and develops against the app it is changing — open the thing it just built, click through it, read the state back, screenshot it, and see for itself whether the change worked. A person can use it the same way, and the app's windows are shown so you can watch, but the reason it exists is that an agent has no other way to look at a running app.

**It is not testing, and nothing treats it as testing.** A driving script asserts nothing, nothing gates on it, and no test runner collects it. Scripts live in `drive/`, which `apack pack drive` creates the first time you run it, and which sits outside every test glob by construction rather than by exclusion. `apack pack test` never sees it.

```ts
// drive/notes.ts
import { drive } from '@apackdev/testing';

drive('open notes and look at it', async ({ app, appPage }) => {
  await app.navigate('notes');
  await app.screenshot('notes');
  // appPage is a Playwright Page: click, type, evaluate — whatever you need
});
```

The import is `drive`, not `test`: the same runner under a name that says what the file is. With no script argument every file in `drive/` runs; name one to run just it.

##### One question, many times

A driving script is a closed program. It runs, it ends, and the next question costs another edit and
another app launch. So a question is asked of the app `apack pack dev` is already holding, over the debug port
that app published — one process per question, no session to stand up and nothing to tear down.

```bash
apack pack dev                                   # one terminal: holds the app
apack pack drive --state                         # another: 0.9s
apack pack drive --eval 'return window.appVersion'
apack pack drive --query 'return query(EARS.Entity.Note).count()'
```

With no app running it exits 3 and says so. `--spawn` starts one and keeps it, so a cold checkout costs
one flag on the first question and an attach on every one after.

**Three rules, so a verb is guessable.** A POST is a verb and a GET is a noun; one concept has one field
name, in requests and in responses (`code` is any source the session runs, `surface` names a surface
whichever direction it travels); and every answer is `{ ok, value }`, or `{ ok: false, error }` when the
operation failed — a `4xx` means nothing ran at all.

| verb | method | body | does |
|---|---|---|---|
| `/eval` | POST | `{ code }` | runs the code in the window and returns what it returns |
| `/send` | POST | `{ event, to? }` | sends an event to a system by ref, or to the app's root actor without `to` |
| `/query` | POST | `{ code }` | runs query code against the live database |
| `/transact` | POST | `{ code }` | runs transaction code against the live database |
| `/state` | GET | — | the state value, the active `surface` and the `surfaces` list |
| `/wait` | POST | `{ state }` or `{ surface }`, `{ timeoutMs }` | waits for a dotted state path, or for a surface to arrive |
| `/navigate` | POST | `{ surface }` | opens a surface |
| `/surface` | POST | `{ surface, path? }` | what that surface published, or one dotted path into it |
| `/click` | POST | `{ selector }` | clicks what it matches |
| `/fill` | POST | `{ selector, text }` | types into it |
| `/press` | POST | `{ key, selector? }` | a key, to an element or to the page |
| `/snapshot` | GET | — | the page as an accessibility tree |
| `/logs` | POST | `{ since?, source? }` | the app's own log, after a line you saw and from one source |
| `/settings` | GET | — | host settings snapshot: effective values, status and catalog metadata |
| `/viewport` | GET | — | the size the app is rendering into |
| `/set-viewport` | POST | `{ width, height }` | changes it |
| `/set-setting` | POST | `{ target, path, value }` | writes one setting |
| `/screenshot` | POST | `{ name }` | writes `.apack/drive/screenshots/<name>.png` |
| `/reload` | POST | — | reloads the window and returns once it is connected again |
| `/events` | POST | — | the app's events since you last asked, and how many were dropped |
| `/drops` | POST | — | sends the bus dropped, and clears them |
| `/errors` | POST | — | renderer errors, and clears them |
| `/close` | POST | — | ends the session and shuts the app down |

**`/snapshot` is usually what you want over `/screenshot`.** It answers with the page as text: readable,
diffable, cheap, and it says what a thing *is* rather than where it is. `/screenshot` is for a person
looking at the result afterwards.

**`/settings` answers with the *stored* document**, not the effective one: it is what a write lands in, so
it is what says whether your write landed. The defaults come from the host for app preferences and pack declarations for contributed values.

**A refused write answers `ok: false`, with the reasons.** The settings store checks the whole next
document and refuses what it will not take — an unknown feature ref, an undeclared pack group, a change
while a backup is being imported — and `/set-setting` waits for that answer rather than for the send to be
accepted. It used to resolve on the send, so every refusal read as success.

**`/set-setting` uses an explicit settings owner.** Set `target` to `{"kind":"app"}`,
`{"kind":"feature","featureRef":"default-setup/code"}`, or
`{"kind":"pack","packId":"default-setup","groupId":"assistant"}`. `path` is a dotted string
relative to that owner, such as `personal.name` for app settings or `name` for the assistant group.
The writer validates the value and reports refusals. `/settings` reads the host's current snapshot,
including composed defaults and stored choices, rather than reading the sparse database row directly.

**`/set-viewport` resizes whichever thing the run actually has.** A session whose window is shown — a
person watching `apack pack drive` — has its *window* resized, because a viewport Playwright sets is an
emulation inside the window: the app would draw into one corner and leave the desktop showing through the
rest. A session nobody is watching gets that emulation, which is what makes a suite's layout the same
everywhere. Either way `/viewport` answers with what the layout has, read from the window.

**`/surface` over `/eval`.** A surface's state is what its view is showing, so reading it is the commonest
question there is; doing it through `/eval` means writing the same expression, with the same ref and the
same optional chain, every time.

The three drains are POSTs because each one *clears* what it returns: draining is right for a session open
for an hour, but a GET that answers differently on a retry is a trap.

**A write does not update the UI; `/reload` is how you see it.** A surface's state is what its system
sent it, so a write made outside that system — `/transact`, the database console, `apack db exec` — changes
the database and reaches no view. That is the console being a console rather than a fault, and it is not
staleness that time fixes: navigating between surfaces does not refresh one, because the surface's actor
survives. `/reload` does, because a new connection makes every system send its startup data again.

`window.location.reload()` from `/eval` is not an alternative. The app blocks renderer-initiated
navigation, so it returns having done nothing — which reads exactly like a reload that changed nothing.

**`/wait` rather than re-asking `/state`.** `{"state":"running.connected"}` returns when the app gets
there; `{"surface":"default-setup/notes"}` returns when that surface registers. One of the two, never both.

**Replies come to the session, and each names the request it answers.** Both matter. The session has its
own connection to the app and a name on it, so an answer is addressed here rather than to every window —
a person querying in the Database surface while you drive is no longer mistaken for you. And because three
concurrent `/query` calls would otherwise be indistinguishable, each reply still names its request, so they
may run together and one you stopped waiting for is ignored.

**`/query` and `/transact` reach the live database**, not the files on disk — they go to the running app, so a
write is visible to the next read in the same session. `apack db exec` cannot do that: it refuses while
the app holds the write lock.

**A failed verb answers `200` with `{ "ok": false, "error": ... }`** — the request was fine and the
operation was not, which is the common case while driving. A malformed request, a missing token or an
unknown verb answers `4xx`, because nothing ran.

The app's own output is in `.apack/drive/results/app-0.log` for the whole session, so there is nothing to stream.

##### One question

A script and a session both assume you have more than one question. For the first one — and often the only
one — `--eval`, `--query` and `--state` attach to a development app, ask one thing, print it and exit. Without a session they exit 3; `--spawn` explicitly starts one:

```bash
apack pack drive --eval 'return document.title'
{"value":"Agent X","state":"attached","startedBy":"dev","supervisorPid":12345}
```

The answer is one object with `value`, `state`, `startedBy` and `supervisorPid`, as **one JSON line on stdout and
nothing else there**, so `$(apack pack drive --eval …)` is directly parseable; the app's output goes to stderr
and the exit code is the status. It runs headless, since nothing is watching a single question.

`--eval` takes a function **body**, not an expression, so `return` is required and a body without one
answers no value at all.

**`apack pack drive` requires a pack** and installs it into the isolated app used by a script.

Scripts select an executable with `--host <path>`; pack scripts also accept `--host beta`. Live questions select a source development session with `--profile`. `--host` requires `--spawn`; an existing session must belong to that host. Fresh live questions require `--spawn`. The two modes have different ownership:

- **A question** joins the app `apack pack dev` is holding, over the debug port in that app's session file. It asks of the development data dir unless `--profile <name>` names another, because that is where the app you are working in is.
- **A script** launches its own app and shows its windows, in a fresh data dir thrown away afterwards, so a driving session starts clean and leaves nothing and a script's result does not depend on whatever surface the last one left open. `--profile <name>` is how a session keeps its state for the next one.

Electron allows one app per data dir, which is what makes a question *join* rather than compete — and why a script, which wants an app of its own, gets a dir of its own with it. If a person wants to watch what a script is doing they watch its window; a question is headless, since nothing is watching one question.

### Which app, and how long it lives

| What you run | The app it uses | When it closes |
|---|---|---|
| `apack pack dev` | starts its own | when you stop the command |
| `apack pack drive --eval` (and the other one-shots) | a live one; **fails if there is none** | it was not yours to close |
| the same, with `--spawn` | a live one, else it starts one | **it stays for the next question** — and, on a profile, closes itself after 10 minutes with nothing attached |
| `apack pack drive <script>` | always its own | when the script finishes |
| `apack pack test` | always its own, isolated | when the run finishes |

**A question keeps the app so the next question is cheap; a script closes it so its result does not depend
on what the last one left behind; and a question never starts one unless you asked.** That is the whole
rule. Measured on a checkout: `--spawn` and the first answer together, 3.3s; every question after it, 0.9s.

Only one app can run per data dir, which is why `drive` joins yours rather than competing with it, and why
`--profile <name>` is how you get a second one.

**A one-shot's stdout is one JSON object and nothing else**, so it pipes:

```
{"value":"0.3.14","state":"attached","startedBy":"dev","supervisorPid":75415}
```

`value` is the answer, `state` is `attached` or `spawned`, `startedBy` says whose app answered, and
`supervisorPid` is what ends it. The exit code is the status, and there are three: **0** with a value,
**3** when no app is running, **1** when the verb failed. Those last two are different answers — a miss is
worth retrying with `--spawn` and a failed verb is not — and neither puts anything on stdout, so a pipe
never receives half an answer.

A run that **started** an app says so on stderr and names the two ways to end it: `apack pack dev`, which takes
the directory back, or the `supervisorPid` above. An attach that changed nothing says nothing, because the
fields already said it.

**And nothing is left running forever.** Which of the two applies depends on where the app is, because the
two cases have different answers:

- **On your development data dir** — a `--spawn` with no profile flags — the app stays until you take the
  directory back, which `apack pack dev` and `npm run dev` do for you: they close the one a question started,
  say so, and start yours. So there is nothing to remember, and no timer closes an app you may be watching.
- **On a profile** — `--profile <name>` — nothing reclaims it that way, so the app closes itself after **10
  minutes** with no question attached. Each question resets that, so a session you are working in keeps
  its app; one you walked away from gives the data dir back. It tells you at launch, and says why in its
  log when it goes.

`apack profiles` lists every data dir with a live app, who started it, and the pid that ends it — which is
the answer when a terminal has been scrolled away and you want to know what is still up.

Live questions require `--spawn` for `--fresh`, `--rm`, or `--with-secrets`. Cleanup and secret-copy
flags require a new session and are refused when an existing session would be reused, including
when another caller wins the spawn race. `--with-secrets` refuses an existing profile.

### Validation

#### `apack pack validate [--json]`

Read-only authoring checks. Exit codes are `0` for valid, `1` for invalid and `2` for incomplete
validation (for example, unresolved dependencies prevent codegen checks). An incomplete report names
the skipped checks and never claims the pack is valid. Build and installation remain strict gates.
`--json` prints one report with `status`, `diagnostics` and `skippedChecks`; diagnostics carry a stable
code, severity, manifest path, message and owner/source/suggestion when available. Text output renders
the same report.

Checks:
- Manifest structure validation
- Declared module files: feature types/contracts, systems, surfaces, references and forms; entity shapes; services, repositories, steps, blocks, artifacts, DSL modules, frontend extensions, lifecycle hooks, migrations and content writers/compilers/appliers. Paths stay within the pack, including symlinks. File checks run even when dependencies are unresolved.
- Feature designation ownership: no two features claim the same role
- Static export and contract checks through in-memory codegen when source files and dependencies are available; modules are not activated
- Dependency resolution (a warning when one can't be resolved)
- **What your pack's code may say** — the same rules `apack pack build` refuses on, reported here without building:

| Rule | What it refuses | Switchable? |
|---|---|---|
| `contract-leaves` | a contract that reaches its own machine (`./state.ts`, `./system.ts`), another feature, or generated code beyond `#generated/types` and `#generated/ears`. Codegen reads a contract as a declared type before it writes anything, so a contract whose read positions resolve through the machine collapses to `any` and the build fails for good — and one that resolves anyway ships the machine's whole declaration in your published facade | no |
| `source-resolution` | a `tsconfig.json` or Vitest config of yours that resolves a checkout's `@apackdev` source instead of the published `dist` — esbuild and the pack bundler read `dist` either way, so such a pack typechecks against one thing and ships another | no |
| `own-modules` | a specifier that names no file: `#generated/events` or `#generated/events.js` where the file is `events.ts`, and a relative `./x.js` whose source sibling is `./x.ts`. No runtime resolves an extensionless specifier in ESM, and a pack ships one bundle rather than a module per source | no |
| `pack-own-aliases` | `@/…`, a TypeScript-only `paths` mapping no runtime reads. Name your own modules with `#` subpath imports from your `package.json` | no |
| `internal-package-imports` | an `@apackdev` export named `_x`: it is `@internal`, the app's own, and an app update is free to rename it | no |
| `host-imports` | `@apackdev/host`, which is not installed for a pack | no |
| `elmdb-imports` | `elmdb` or `@apackdev/ears/lmdb`: your data comes through the engine the app installs | no |
| `untyped-sends` | `untypedBroadcastToSurface`, `untypedSendToSystem` — use the typed facades from `#generated/events` | yes |
| `raw-transport` | `_rootEvents`, `trpc.bus`, `@apackdev/sdk/rpc` | yes |
| `backend-console` | `console.*` under `features/*/be/`, `migrations/` or `extensions/` — use `createLogger` from `@apackdev/sdk/logger` | yes |
| `component-sends` | `sendToSurface` from a feature's `.vue`. A component runs in no delivery, so the send carries no `Message.sender` and the surface it reaches cannot answer it — emit to your own surface with `useSurface()` and let its machine send. An extension's component is exempt: it is rendered in no surface scope and by no single surface, so it addresses a surface by ref and `sendToSurface` is that route's send | no |
| `cross-feature-imports` | a module of another feature's `fe/`, and a feature passing its own frontend on (`export … from './fe/state.ts'`). What a feature offers the rest is its surface's contract, read through `#generated/fe` and `#generated/events` | yes |
| `window-storage` | `localStorage` or `sessionStorage` anywhere in a pack — reach your surface's own storage through `surfaceStorage`/`useSurfaceStorage` from `@apackdev/sdk/fe`, which prefixes every name with the surface's ref. A window's storage is one flat namespace, so a hand-written key is one another pack can pick — which is why this one is not switchable: allowing it takes the collision out on somebody else | no |
| `repository-casts` | `repository as unknown as …`, reading a repository through a type its owner never declared. `repository` from `#generated/repository` is already typed with your own repositories and your dependencies' | yes |
| `reserved-event-keys` | a property named `_call`, in `src` or `tests`. That key is the app's: a delivery door writes the call a message answers under it, so a field of yours by that name is overwritten on the way in and read as a correlation on the way out. Ask `answersCall(event, outstanding)` or `settleCall(pending, event)` from `@apackdev/sdk/events` instead of reading it, build an answer in a test with `answerTo` from `@apackdev/sdk/testing`, and rename a field of your own that collides | no |

A rule marked switchable is a development convention a pack may allow in **`apack.json`**:

```json
{ "checks": { "allow": ["backend-console", "untyped-sends"] } }
```

The others report something that breaks — a specifier nothing resolves, an import the bundler refuses, a name
the next app version may rename — so there is nothing to allow, and naming one in `allow` is an error.

Exits with code 1 on errors.

#### `apack pack doctor [--json]`

Read-only source health using the same manifest, target, static export, contract and source-rule checks
as `apack pack validate`. Modules are inspected without activation; generated output is not written.
Dependency details retain the declared spec, exact version, origin, delivery path and content revision. Data availability and executable availability are distinct. Missing generated files produce a reminder to run `apack pack generate-entries`. `--json` emits one validation report with the same dependency inspection frame used for static checks.

Exits 0 when validation is complete and valid, 1 for errors, and 2 when dependency resolution prevents
complete checking. Unchecked work is listed explicitly; incomplete checks are never reported as valid.

#### `apack pack facade-report`

Reports your pack's **facade types** — what packs depending on yours compile against, the same bundle
`apack pack build` writes to `dist/types/pack-types.d.ts` — as a reviewed file at `etc/pack-types.api.md`.

**It needs no build.** It regenerates `src/__generated__/` and bundles the facade itself, so the report is
held against the facade your sources describe now; a `dist` left by an older build is never its subject.
Without `--update` it fails, printing a diff, when the committed report differs; with `--update` it rewrites
the report. Commit the result: the point is that a change to what dependents can see is visible in review
rather than buried in a generated bundle.

After a build, use `--from-build` to compare its verified facade without regeneration or compilation.
It checks sealed output integrity and replays the build's recorded source/dependency inputs; missing,
stale or modified builds fail. This is the root repository's `npm run facade:check` path. The pack-local
script still derives from sources by default. `--skip-generate` instead derives from previously generated
entries and checks their generation stamp. The read-only `--from-build` option cannot be combined
with `--update` or `--skip-generate`.

`apack pack build` warns when your committed report has fallen behind the bundle it just produced. The command
above is what fails, which is why a pack's own CI runs it.

The report is normalised so it moves only when the facade does — imports first and sorted, declarations in
name order, literal unions sorted, and the pack's own path shortened to `.`. That last normalisation matters
for a reason worth knowing: TypeScript prints an inferred union's members in the order it created the member
types, and that order varies between builds, so an unnormalised report would differ from itself.

#### `apack pack info [--json]`

Inspect declared features, entities, steps and services, verified build metadata, compiled content item IDs/descriptions/counts, and dependency provenance. `--json` emits one structured report with the same data as text. Inspection never activates pack modules, downloads dependencies or populates caches.

Build status distinguishes unbuilt, verified, invalid and stale declarations. Compiled content comes from a receipt-checked index; missing or invalid output is unavailable, rather than inferred from source file counts. A verified build proves its output bytes, not that every authored input is unchanged. Dependency details distinguish missing/invalid data from resolved type data whose execution is unavailable.

### Testing

#### `apack pack init-tests`

Scaffold Playwright E2E tests in the pack root: `playwright.config.ts` (tests in `tests/e2e`), `tests/e2e/smoke.spec.ts` (using the first feature with a surface), a `.gitignore` entry for `.apack/`, and `@apackdev/testing` and `@playwright/test` devDependencies. Existing files are kept.

#### `apack pack test [--host <path>] [--prebuilt] [playwright args...]`

Run the pack's Playwright tests in apack. Other arguments go to `playwright test`. The app is, in order:

1. `--host <path|beta>`: an explicit built checkout, `.app` bundle, or downloaded beta
2. `APACK_HOST`: the same selection as an environment default
3. A cached/downloaded beta satisfying the pack's `hostVersion`

Tests always use disposable state and reject profile and secret-copy flags. Contract tests launch no app and reject host flags.

A Beta build is **downloaded once and then reused**: whenever one you already have satisfies the pack's
`hostVersion`, that one runs — so this works offline and asks GitHub nothing. The newest is fetched only when
none of them fits. `apack cache clean` lists what has been downloaded, with sizes, and removes all but the
newest; `--all` removes that one too, which is how you move to a newer Beta.

**`apack pack test` never reads a stored app preference and never asks**, so a test run means the same thing on a fresh machine as on one you have been developing on. Neither command stores a host preference. The fixture builds the pack with the same CLI and installs it into a fresh data dir for each worker, so a run leaves nothing behind either.

`--prebuilt` installs the build already in `dist/` instead of making a new one, for a pipeline that built the
pack in an earlier step. It verifies the sealed output and rechecks the recorded source, linked inputs,
the dependency files the build read, dependency package membership and resolution observations. Timestamp-only touches pass; changed or missing inputs
and damaged output fail with a rebuild instruction. `--prebuilt --release` requires output made with
`apack pack build --release`. The recorded compiler/execution context identifies the selected build;
the Playwright runner's environment is not compared to the compiler's environment. Use this when an
earlier pipeline step owns the build; the test fixture verifies it without rebuilding.

### Distribution

#### `apack pack release [patch|minor|major] [--beta] [--dry-run] [--local] [--skip-tests] [--skip-e2e]`

Cut a release (default `patch`):

1. Preflight: valid manifest with `hostVersion`, dependencies resolve, a clean git tree on the default branch, not behind `origin`, and the tag not already on `origin`
2. Bump `apack.json` and `package.json`. `--beta` follows the app's cycle: `1.2.3` → `1.2.4-beta.0` → `1.2.4-beta.1` → `1.2.4`
3. `apack pack build --release`, `tsc --noEmit`, the `test` script (skip with `--skip-tests`), and `apack pack test` when `playwright.config.ts` exists (skip with `--skip-e2e`)
4. Commit, pack into `.apack/release/`, tag `v<version>` and push

The scaffolded `.github/workflows/release.yml` publishes the GitHub release from the tag. `--local` publishes from this machine instead; it needs `GITHUB_TOKEN` or `GH_TOKEN` and refuses when the workflow exists. `--dry-run` edits no files, runs no git operations and publishes nothing: it builds and verifies the next version's pack under `.apack/release/`.

#### `apack pack release publish [--dir <dir>] [--dry-run]`

Verify the pack in `<dir>` (default `.apack/release`) and create the GitHub release `v<version>` (a prerelease for prerelease versions), uploading `<id>-<version>.tgz`, `.sha256` and `.integrity.json`. The release workflow runs it. Needs `GITHUB_TOKEN` (or `GH_TOKEN`), and `GITHUB_REPOSITORY` or a GitHub `origin` remote.

#### `apack pack install <source> --host <path|beta> [--profile <name>]`

Install a pack into the app's data dir (`<userDataDir>/packs/<id>`). `<source>` is one of:

| Source | Example |
|---|---|
| Local directory (a built pack source or a pack layout) | `../my-pack` |
| Local archive (`.tgz`, `.tar.gz`, `.zip`) | `./my-pack-0.1.0.tgz` |
| URL to a `.tgz`, `.tar.gz` or `.zip` | `https://example.com/my-pack-0.1.0.tgz` |
| GitHub release: `owner/repo`, or `owner/repo@tag` (default: latest) | `user/my-pack@v0.1.0` |

```bash
apack pack install ./my-pack-0.1.0.tgz --host /Applications/apack.app
apack pack install ../my-pack --host /path/to/apack-checkout
apack pack install user/my-pack --host /Applications/apack.app
```

Ordinary install requires `--host` or an associated `APACK_HOST`, `APACK_HOST_ROOT` or
`APACK_HOST_EXECUTABLE`. The source app's advertised default IDs are reserved even before first launch,
when disabled/failed, or after removal. Use `pack replace <id> <source>` to choose your own pack in one
of those slots. Cwd and `--profile` never choose the source app. Selection is offline and does not
activate packs, download a beta, or launch an app. Explicit selection wins over an associated handoff.

A GitHub release needs a `.tgz` asset and the `.sha256` asset published beside it (`apack pack release` writes both); a release without one is refused, since nothing would say the download is that release. A URL install is unverified, and says so. The pack is verified before it's placed, and `hostVersion` is checked against the version the app recorded in that data dir. A source directory must be built: one with neither a `integrity.json` nor a `dist/runtime/index.cjs` beside `dist/types/snapshot.json` is refused, with a note to run `apack pack build` first. Restart the app after installing.

#### `apack pack replace <id> <source> [--profile <name>]`

Deliberately replace the named pack using any source supported by `pack install`. The incoming
manifest must claim that exact ID. The installed build becomes user-managed, so app refreshes
preserve it. An advertised app-default ID or app-managed incumbent refuses ordinary `pack install` and points to this command.
Replacement can also fill an explicitly named missing slot; it preserves stored database overrides.

```bash
apack pack replace default-setup ./my-default-setup
```

#### `apack pack restore <id> --host <path|beta> [--profile <name>]`

Restore a pack from the selected app's shipped builds, re-enable it and resume app-managed updates.
This clears deliberate-removal suppression and preserves stored settings/content overrides.

```bash
apack pack restore default-setup --host /Applications/apack.app
apack pack restore default-setup --host /path/to/apack-checkout --profile my-work
```

`--host` selects the source app; `--profile` independently selects stored state. An associated
`APACK_HOST_ROOT`, `APACK_HOST_EXECUTABLE` or `APACK_HOST` can supply the source when no flag is given.
The current directory does not select a host. An explicit flag wins over an associated handoff.
A checkout needs the pack's build output, not a running app. `--host beta` uses a compatible cached
beta and refuses if none is cached. Restore never downloads or launches an app.

The running app offers the same choices in **Packs**: disable or remove an installed pack, replace it
from its detail view or use **Replace by ID**, and restore an available app default. Replacing chooses
user-managed updates; restoring re-enables the default and resumes app updates. Both keep stored
settings. Host settings remain available when the shipped default is disabled or removed.
App-managed installations show **Update from app** when the verified app source changes, including
a changed build with the same version. Updating preserves disabled state; restoring enables the pack.
User-managed forks receive no app-source update offer.

#### `apack pack uninstall <id> [--profile <name>]`

Remove an installed pack by ID, retaining database settings and recording deliberate removal so boot does not put an app-shipped default back. Use `pack restore` to reinstate the default.

#### `apack pack list [--profile <name>]`

Show installed packs.

`pack install`, `pack replace`, `pack restore`, `pack uninstall` and `pack list` select stored data with `--profile production|development|beta|preview|test`. The default follows the bundled CLI's channel, or production for a standalone CLI. They do not launch an executable. Install and restore separately select source host builds with `--host` or an associated host. Explicit named replacement needs no source-host selection.

Close the app using the selected profile before installing, replacing, restoring, uninstalling, or upgrading packs. These mutations share the app's storage lock with database operations, so concurrent changes are refused. Use `apack pack dev` for live development updates.

### App

#### `apack open [--channel production|beta|preview]`

Open the installed app or bring it to the front. Production is always the default, including
from a beta-bundled CLI. macOS only. No debugging connection is enabled.

#### `apack doctor [--channel production|beta|preview]`

Inspect the installed app's identity, version, executable, data permissions and API listener.
Production is the default. A closed app is normal. Nothing is launched or modified, and no
debugging connection is opened. Failures exit 1. Pack checks are `apack pack doctor`.

#### `apack upgrade [version] [--channel production|beta] [--relaunch] [--force]`

Upgrade the installed app to the indicated version or latest published release. Production
is the default; `--channel beta` selects published prereleases. macOS on Apple Silicon only.

It takes the release's `.zip` and checks it against the `.sha256` published beside it, then expands it with
`ditto` — which keeps the bundle's symlinks, permissions and code signature. Nothing is installed until that
check passes, and the app already in `/Applications` is moved aside rather than deleted, so a failed install
puts it back.

It asks the running app to quit and waits for it to say it has, by the `app.lock` the app removes on
shutdown; a copy that will not quit stops the upgrade rather than being killed, because replacing a bundle
under a live process is the thing being avoided. Nothing here needs a GitHub token — the releases are public
— though `GITHUB_TOKEN`/`GH_TOKEN` is used for the higher API rate limit if one is set.

Already-current is reported rather than reinstalled; `--force` installs anyway, and `--relaunch` opens the
app afterwards.

### Database

`apack db` reads and changes the app's database (EARS on LMDB) from the command line: to look at data, repair it when the app can't start, or move it between machines.

```bash
apack db query "return query(EARS.Entity.Note).count()"
apack db inspect Flow-123 --depth 2
apack db runs                               # the latest flow runs
apack db export --out ./export
apack db import ./apack-backup-2026-09-17 --profile production --force
apack db reset --profile production        # lists what it would delete
```

**Which data.** `--profile production|development|beta|preview|test` selects an app data namespace, `--data-dir <path>` any data dir, such as a copy of the user's, or `--profile <name>` a profile `apack pack dev` made, by the name it printed. Name one of them, not two. `--schema-from <path>` names a pack snapshot for a data dir that publishes none of its own. Without it such a dir still opens to **read**, and the command says which entity types it could not name; a command that **changes** it is refused, because an incomplete schema makes a write land on the wrong rows. A command that only reads takes the production app's data without being told, and a dry run of `import`, `reset` or `clear-settings` counts as reading; **a change (`exec`, `repl --write`, and those three with `--force`) names its data dir**, so the user's own data is never what a forgotten flag hits. Each command prints the data dir it opens (on stderr, so results on stdout stay clean). A flag means that app's own data dir, whatever `APACK_USER_DATA_DIR` is set to in the shell; the variable applies only when nothing names a data dir.

Installed schema sources must be complete verified pack builds, with matching manifest, snapshot,
receipt and directory owner. `--schema-from` accepts a complete snapshot in the current format with a
matching declaration revision; a bare manifest or partial fragment is refused. These reads never load
pack runtimes.

**While the app runs.** The commands open the database files themselves (offline); the app is the database's only writer while it runs. So a change (`exec`, `repl --write`, and `import`, `reset` or `clear-settings` with `--force`) refuses while an apack app runs on the data dir: the API it published is running, or (on macOS and Linux) its single-instance lock is held by a live process. Files left behind by a crash name processes that have exited, so they don't stand in the way. Quit the app first. Reading commands work, with a warning that they miss what the app hasn't written yet, and so do the dry runs: they open the database without writing to it, so they also work against a copy you have no permission to change.

While a command changes the database it holds a lock on the data dir (`db-write.lock`), so a second `apack db` is refused and an apack started meanwhile refuses to open that database instead of overwriting the change. A lock left behind by a command that was killed is ignored once its process is gone.

**The run history.** What each flow run did is not in the database: it is the run history, a store of its own beside it (`run-history`), which `apack db runs` reads. Backups, `import` and `reset` cover it with the database, and the app keeps 30 days of it.

**Writing.** There is no apply command: apack content each pack's data when it starts (and `apack pack dev` re-applies a pack it rebuilds), so start the app rather than content a data dir by hand.

**Installed packs.** Entity types, relation kinds and where each type is stored come from the packs installed in the data dir — every enabled pack in `packs/`, the ones the app ships included, read from its own `apack.json`; no pack code runs. A data dir with no packs installed knows only the names the app itself declares, which is the truth about it rather than a degraded reading of it.

#### `apack db query <code> | --file <path> [-o pretty|json|csv] [--out <file>]`

Run query code with the Database console's read helpers: `query` (with `query.withTrashed` and `query.trashed`), `EARS`, `getRow`, `getAttr`, `getRoles`, `findRelations`, `getSchemaStats`. The code is a function body, as in the console: `return` the result. `EARS.Entity` holds the installed packs' entity types. It runs as a plain function, so it can't use top-level `await`, `import` or `require` — a script (`apack db script`) can.

```bash
apack db query "return query(EARS.Entity.Settings).pickAll()" -o json --out settings.json
apack db query --file ./report.js -o csv
```

#### `apack db exec <code> | --file <path> [-o pretty|json|csv] [--out <file>]` (names its data dir)

Run transaction code with the console's read and write helpers (`create`, `upsert`, `write` and `removeRelation`; `write(id)` sets, links, grants, trashes and destroys an entity, and `removeRelation(relationId)` removes one relation). The code runs as one transaction: if it throws part way, none of its writes are kept, and the failure says so. It is synchronous — `await` doesn't parse, and code returning a promise is refused — since an await would split the transaction. A write that fails to reach the files fails the command.

```bash
apack db exec "write('Note-123').set('title', 'Renamed')"
```

#### `apack db repl [--write]` (`--write` names its data dir)

Run console code a line at a time and print each result: query code, or with `--write` transaction code, whose changes are written on exit. `.exit` or Ctrl+D quits.

#### `apack db script <file> [--read-only] [-o pretty|json|csv] [--out <file>] [-- <script arguments>]` (names its data dir)

Run a script file against the database, for work a one-liner can't do: it imports what it likes and brings its own helpers. JavaScript (`.mjs`, `.js`, `.cjs`) runs as it is; TypeScript is compiled first, to a temp file rather than your own directory, with its relative imports compiled in and its packages resolved from where the script lives, so `import.meta` and every import still point where you'd expect. The file default-exports a function, which is called with the open database and whose result is printed like a query's.

```ts
// notes-report.ts
export default async ({ db, EARS, args, log }) => {
  const notes = db.ears.query(EARS.Entity.Note).ids();
  log(`${notes.length} notes`);
  return notes.map((id) => db.ears.getRow(id));
};
```

```bash
apack db script ./notes-report.ts --profile production -o json --out notes.json
apack db script ./cleanup.ts --profile development -- --older-than 30
```

| It receives | |
|---|---|
| `db` | the open database: `query` (`query`, `create`, `upsert`, `write`), `admin`, `store`, `schema`, `paths`, `userDataDir` |
| `EARS` | the entity types and relation kinds of the packs installed in that data dir |
| `args` | whatever follows `--` |
| `log` | prints a line, like the script's own output |

The database is handed to the script rather than left for it to open: the published CLI carries its own copy of the engine, so a script importing `@apackdev/ears` itself would get a second one, with no data in it. `--read-only` opens the database without writing, so a reporting script can run while apack is open.

#### `apack db inspect [<entity-id> | --type <Entity>] [--depth <n>] [--incoming] [--outgoing]`

Print an entity, its roles and its relations grouped by kind, following them `--depth` levels (default 1); `--incoming` or `--outgoing` shows one direction. `--type` prints the first five entities of a type. With neither, it prints entities and relations per entity type.

#### `apack db runs [--run <id>] [--flow <id>] [--limit <n>] [--json]`

List the flow runs in the run history, newest first (20 unless `--limit` says otherwise): each session's root and every flow it ran, one line each with its id, status, start time, label and the flow it ran. `--flow` lists one flow's runs, and `--json` prints the list as JSON. `--run <id>` prints that run node and everything under it — the events it heard, the steps they ran, each with what it was given and what it returned — as one JSON tree. It opens the run history read-only, so it works while apack runs (with the usual warning) and changes nothing.

#### `apack db export --out <dir> [--type <Entity>...] [--format json|csv]`

Write each entity type's entities, with every attribute, to `<dir>/<Entity>.json` (or `.csv`), and a summary (when it ran, the data dir, the format and the counts) to `<dir>/export.json`. Without `--type`, every type with entities and the relations, to `<dir>/Relation.json` (each `{ id, kind, source, target, info }`; `Relation` is the engine's own name, which no entity type can take), with their count as the summary's `relations`. Roles are in each entity's `role` attribute.

#### `apack db import <backup-dir> [--force] [--skip-unknown]` (names its data dir)

Replace the database and the run history the backup holds, and the media folder when it has one, with a backup made in the Database settings' Backup & Restore. The backup is checked first: it has `metadata.json`, lists the app's main database, that folder is there, and every database it would put in place opens in a storage format this version reads — so a backup this apack can't read is refused before any of your data is replaced. A backup made by a newer apack may also hold stores this one doesn't have; importing it would replace your data with an incomplete copy, so it's refused unless you pass `--skip-unknown`, which imports it without them. If the backup lists a store it holds nothing for, the listing says so and that store comes back empty. Without `--force` it lists the backup, its contents and what it would replace, and changes nothing. The app migrates the data on its next start if the backup is from an earlier version.

#### `apack db reset [--force] [--keep-keys]` (names its data dir)

Delete all of the app's data, as Reset Database in the Database settings does: the database, the run history and the stored secrets. The app creates its default data (settings, written flows, the packs' content) on its next start and shows onboarding. Without `--force` it lists the entities per type and each stored secret it would delete.

No backup holds the secrets — `export` and the Database settings' backups copy the databases and the media folder, never the secrets or the data key that encrypts them — so a deleted secret is entered again in Settings → Secrets. That's why the listing names each one by provider and label (never its value), and why `--keep-keys` leaves them where they are and deletes only the data.

#### `apack db clear-settings [--force]` (names its data dir)

Destroy every Settings row (the user's changes to the default settings); the app recreates the defaults on its next start. Without `--force` it lists each row and the settings it stores.

In the apack repo, `npm run db:query`, `db:exec`, `db:repl`, `db:inspect`, `db:runs`, `db:export`, `db:import`, `db:reset` and `db:clear-settings` run these commands on the development app's data (`-d`): `npm run db:query -- "return query.all().count()"`.

### Cleanup

#### `apack profiles`

Every apack data dir on this machine, and the verbs for the ones you made. Works outside a pack — a
data dir belongs to you rather than to any pack.

```
apack profiles                  what exists
apack profiles --sizes          with a size column
apack profiles --all            include the throwaway dirs `run --fresh --rm` makes
apack profiles new [name]       create one; a name is minted if you don't give one
apack profiles rename <a> <b>   rename one
apack profiles rm <name>...     remove the ones you name
apack profiles rm --leaked      remove the ones a killed run left behind
apack profiles trim [<name>...] reclaim the caches Chromium rebuilds, in any data dir
apack profiles stop <name>      close the app running on one (or --all)
```

Two kinds of directory, listed apart. An **environment** is where an app of that channel keeps its data —
production, beta, development, test — and nothing here removes one; a row says whether an app has it open,
what version last wrote to it, and `(no app data)` when the directory holds only a Chromium profile. A
**profile** is a data dir you can throw away.

**`trim` is how you get the disk back, including from an environment nothing removes.** It deletes seven
directories — `Cache`, `Code Cache`, `GPUCache`, `DawnGraphiteCache`, `DawnWebGPUCache`, `Shared Dictionary`,
`blob_storage` — and nothing else. Your notes, settings, installed packs and the in-app browser's logins are
untouched, so it asks for no confirmation. A dir with an app running on it is skipped, those files being
open. With no names it does every dir there is.

**How much it frees depends on which dir**, which is worth knowing before you run it: a development dir is
mostly cache and a production one mostly is not. Measured 2026-10-10, 1.3GB came back from a 1.6GB
development dir and 13MB from a 1.4GB production one — the difference being the in-app browser's logged-in
sessions and your own media and database, which no command here deletes. For those, `apack db export`
first, then `apack db reset --force` if you mean it.

**`stop` closes the app on a data dir**, by name or `--all`, and waits for the dir to come free. The pid
comes from what the app published about itself rather than from a search for a matching process.

Sizes are behind a flag because taking them means walking every directory: measured, 674ms for a 1.4GB
production dir and 1255ms for a 1.5GB development one. Names and paths come back immediately.

A profile an app is currently running on is never renamed or removed: taking a data dir away from a
running app does not stop it, it makes the app write the directory back.

#### `apack pack clean`

Remove build output: `dist/`, `.apack/`, `src/__generated__/`.

#### `apack cache clean [--all]`

Lists the apack Beta builds `--host beta` downloaded — a few hundred megabytes each, one per
release tested against — and removes all but the newest, which is the one a later run would reuse; `--all`
removes every build. It works outside a pack.

Data dirs are `apack profiles`, below: what exists, and removing the ones you own.

### Desktop app installation

```bash
apack install                       # Latest stable production release
apack install 0.4.0                 # Specific production release (v0.4.0 also works)
apack install --replace             # Explicitly replace an existing app
apack upgrade                       # Update an installed app to the latest stable release
apack upgrade 0.4.0 --force          # Explicit reinstall or downgrade
apack uninstall                     # Remove the app bundle; keep data and settings
apack install --channel beta                    # Latest beta, installed separately
```

These commands manage `/Applications/apack.app` (or `apack Beta.app` with `--channel beta`) on macOS Apple Silicon. App commands default to production even when invoked from the beta app. Pack installation is `apack pack install <source>`; pack removal is `apack pack uninstall <id>`.

Downloads must have a matching published SHA-256 checksum. An incomplete latest release fails rather than silently installing an older version. The downloaded bundle's identity, executable and version are checked before the existing app is asked to quit. Replacement is staged on the destination filesystem and restores the previous bundle if the swap fails. A concurrent app operation is refused. `install` refuses any existing bundle without `--replace`; `upgrade` requires an existing app and skips a same-version or older release unless `--force` is supplied. `--relaunch` opens the installed app after install or upgrade. Uninstall never deletes databases, packs, profiles or settings.

### Inspecting pack declarations

`apack pack info` lists declared features and their systems, services, repositories and reference
identities, plus extension kinds, lifecycle hooks, migrations, entities, relations and content keys.
It reads verified compiled inventory separately and reports unbuilt, stale or invalid output without
activating pack modules. Feature-owned services appear under their feature; pack services appear under
extensions.

`apack pack info --json` returns the complete validated manifest in `declared`, retaining its keyed
maps, ownership, module targets and metadata. It does not replace declarations with a selected list of
names. `build` describes verified output and compiled content; `dependencies` describes inspection of
declared dependencies. Authored declarations and verified output may differ in a stale build, which
is reported explicitly. Neither inspection mode executes pack code or creates user data.
