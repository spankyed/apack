# Getting Started

A **pack** is a self-contained extension for apack. It can contribute backend systems, frontend surfaces, flow steps, content (actions, prompts, flows), artifact viewers, message blocks, services, and data migrations. Packs are declared via an `apack.json` manifest and compiled into a distributable archive.

## Prerequisites

- A compatible apack host and CLI. The standalone CLI supports Node 22.15+ on the 22.x line,
  or Node 23.5+; the app-bundled CLI uses its included runtime.
- npm 11 or later, to install a new pack's dependencies: npm 10 crashes on them.
- When using a packaged macOS app: **apack → Install 'apack' command in PATH** installs the bundled
  command (apack Beta installs `apack-beta`). This requires an actual available app build.

npm and Homebrew installation are not yet available.
For development of apack itself, use the [source checkout instructions](../../README.md#develop-apack).
The pack-authoring commands below assume their CLI and package prerequisites are available.
Beta-download examples also require a compatible published Beta; `--host <checkout>` selects an
explicit local host for workflows that support it.

Whichever `apack` you run, inside a pack it hands off to the `@apackdev/cli` version the pack pins in its `devDependencies`, so every pack builds with the CLI it was written against.

## Packages

| Package | What it is |
|---|---|
| `@apackdev/sdk` | Pack-facing API and types (`@apackdev/sdk/fe`, `/steps`, `/events`, …). A dependency of every pack. Libraries shared with the host (vue, xstate, zod) and the AI SDK (`ai` 7, whose types `services.inference` uses) are peer dependencies, and so is TypeScript (5.7 or later). |
| `@apackdev/ears` | The EARS data engine and its types: what the generated `#generated/ears` and `#generated/repository` build on (`EarsError`; `createEarsEngine` for tests and tooling). The untyped operations over the app's engine — `untypedQuery`, `untypedWrite`, `findRelations`, `wouldCreateCycle` — are `@apackdev/sdk/ears`, and `RepositoryError`, which a repository throws, is `@apackdev/sdk/repositories`. The app shares one instance with every pack, as it does `@apackdev/sdk`. A dependency of every pack. |
| `@apackdev/ui` | Vue components, tiptap and Monaco editors and UI composables (`@apackdev/ui/design/button`, `@apackdev/ui/components/tiptap/TiptapEditor`). Add it when your pack's UI uses them; it brings the editor libraries, so backend-only packs leave it out. Packs use the app's copy at runtime (see `build.bundleUi` in the manifest docs). |
| `@apackdev/cli` | The `apack` command and build toolchain. A devDependency of every pack. |
| `@apackdev/testing` | Pack tests: `@apackdev/testing/harness` runs a pack's content, systems, services and flows in unit tests without the app, `@apackdev/testing/vitest` configures Vitest for it (`isolatedDataDir`), and `@apackdev/testing` is the Playwright fixture for E2E tests in the app (`@playwright/test` is a peer). |

These packages are versioned together.

## Create a pack

```bash
apack pack init my-pack
cd my-pack
npm install
apack pack add feature notes --label Notes
apack pack build
```

`apack pack init` creates no feature; `apack pack add feature` adds one (a feature id is a lowercase letter followed by letters and digits, like `notes` or `calendarEvents`). This scaffolds:

```
my-pack/
  apack.json              # Pack manifest — the single source of truth
  package.json             # depends on @apackdev/sdk and @apackdev/ears, pins @apackdev/cli and @apackdev/testing
  tsconfig.json
  vitest.config.ts         # unit tests: an isolated data dir per run, the harness setup
  .gitignore
  .github/workflows/
    release.yml            # Publishes a GitHub release when `apack pack release` pushes a tag
  src/
    env.d.ts
    features/
      notes/                # added by `apack pack add feature notes`: be/, fe/ and inline settings
    extensions/             # added by `apack pack add step|artifact|block`: one directory each,
                            # declared in apack.json's `extensions` — there is no barrel
    content/
      actions/
      flows/
      examples/             # markdown rows of the pack's entity type (the `examples` content format)
    __generated__/          # Auto-generated from manifest — never edit
  .apack/
    generated/              # EARS types from deps
    deps/                   # Cached dependency snapshots and step build code
  tests/
    setup.ts                # starts the unit test harness
    unit/
      my-pack.spec.ts       # content the examples entry and reads the rows back
      notes-system.spec.ts  # added with the feature: its system under the app's bus
```

The scaffold has no dependencies, so it builds as generated. To use another pack's entity types or flow steps (for example `keepAlive` from the built-in `default-setup` pack), add it to `dependencies` in `apack.json`. `apack pack build` resolves each dependency from an explicit `file:` path, then the selected host for packs it provides (a checkout or downloaded beta; `APACK_HOST=beta` in CI), then the workspace, linked checkout, an installed apack app, the `.apack/deps` cache, or a GitHub release, in that order. The resolved version must satisfy the range you declare, and your flows are validated with the dependency's real step code. The scaffolded release workflow runs on macOS with `APACK_HOST=beta`, so built-in dependencies resolve in CI.

## The dev loop

```bash
apack pack dev
```

This launches apack with your pack installed and keeps it in step with your edits: frontend changes hot-reload through Vite HMR, `apack.json` changes regenerate `src/__generated__/`, and backend `.ts` changes rebuild, reinstall and reload the pack's backend in the running app.

It works out which app to use rather than asking: the apack checkout your pack is built against if there is one, else a cached/downloaded Beta build your `hostVersion` accepts. `--host <path>` and `--host beta` name one outright, and it always says which it chose and why. A source app already using that data dir is reused only after its session verifies the selected checkout. Packaged hosts require an unused profile because their running app identity cannot be verified.

`apack pack build` validates declarations, generates entries, resolves dependencies, compiles content
and bundles the runtime and dependent-facing types. Settings definitions are inline in `apack.json`;
forms remain custom components. The build checks its output before publishing `dist/`, preserving the
previous build on failure. See [the build command](cli.md#building) for its gates and
[pack builds](pack-builds.md) for the files it produces and installs.

## Build and distribute

```bash
# Compile the pack
apack pack build

# Pack into a verified .tgz archive (integrity.json lists a sha256 per file)
apack pack archive
# Creates my-pack-0.1.0.tgz and my-pack-0.1.0.tgz.sha256

# Install into apack
apack pack install ./my-pack-0.1.0.tgz
```

You can also install directly from a built pack directory, a `.zip` or `.tar.gz` archive, a URL to an archive, or a GitHub release:

```bash
apack pack install ../my-pack          # local directory
apack pack install my-pack.zip         # zip archive
apack pack install user/repo           # latest GitHub release (user/repo@v0.1.0 for a tag)
```

`apack pack install` targets the production app; add `--profile development` for the development data dir or `--profile beta` for apack Beta.

After installing, **restart the app** for the pack to load.

To release a version, run `apack pack release [patch|minor|major] [--beta]`: it checks the repo, bumps the version, builds, typechecks, runs the unit and E2E tests, commits, tags and pushes; the scaffolded workflow publishes the GitHub release. `--dry-run` builds and verifies the pack without bumping, committing or publishing anything, `--local` publishes from your machine instead of CI, and `--skip-tests`/`--skip-e2e` skip the unit or E2E tests.

## Unit tests

```bash
npm test
```

Unit tests run your pack without the app, through `@apackdev/testing/harness`: content and repositories against an in-memory database, systems under the app's bus, services with others mocked, and flows on the brain with `services.inference` mocked, including your dependencies' behaviour. The scaffold wires it up in `vitest.config.ts` and `tests/setup.ts`; run `apack pack build` once first, so dependencies are fetched. See [Testing](testing.md).

## E2E tests

```bash
apack pack init-tests
npm install
apack pack test --host beta      # or --host ../apack for a local checkout
```

`apack pack init-tests` adds `playwright.config.ts` and a smoke test in `tests/e2e/`. `apack pack test` builds the pack, installs it into a throwaway data dir and runs the tests in the app: a checkout (`--host`, or `APACK_HOST`), or a cached/downloaded apack Beta satisfying your `hostVersion` (`--host beta`, or `APACK_HOST=beta` in CI). With neither, it uses a compatible Beta: `apack pack test` never reads a stored app preference and never asks, so a test run means the same thing on any machine. See [Testing](testing.md).

## Verify it works

After restarting, your pack's feature should appear in the sidebar. Run `apack pack list` to see all installed packs.

## Useful commands

```bash
apack pack info       # Show pack summary (features, steps, content, etc.)
apack pack validate   # Check manifest and file references
apack pack doctor     # Run health checks
apack pack clean      # Remove dist/, .apack/, __generated__/
```

## Key concepts

- **Manifest (`apack.json`)** — declares everything: features, steps, services, content, entities. See [Manifest Reference](manifest.md).
- **Generated files (`__generated__/`)** — auto-generated from the manifest. Never edit these. The build regenerates them when their declared inputs change. `pack-entry.ts` and `pack-entry-fe.ts` supply executable bindings for systems, services, repositories, steps and views. The sealed build snapshot supplies discoverable declarations, including DSL definitions, without activating those bindings. Modules never register contributions as an import side effect.
- **Host dependencies** — packs share `vue`, `xstate`, tiptap, `lucide-vue-next` and other libraries, the SDK modules and `@apackdev/ui` with the host app. The build pipeline leaves those imports external and the app's document carries an import map naming its own copy of each, so your pack gets the app's instance.
- **Content** — actions, prompts, flows and entity rows are compiled at build time and written when the pack loads. See [Content](content.md) for what action code may import.
- **`pack://` protocol** — the host loads your pack's FE bundle at runtime via `pack://<id>/builds/<revision>/runtime/fe.js`. This is handled automatically.

## Constraints

- External packs declare feature preferences in `features.<id>.settings`, pack preferences in `extensions.settings`, and references in `features.<id>.references`. Host preferences belong to the host; see [settings declarations](manifest.md#feature-settings).
- Entity types, relation kinds and service keys must be unique across all installed packs, or the pack fails to load. Service keys also can't be the host's (`logger`, `emitter`, `repository`, `settings`, `onboarding`, `appData`, `runHistory`, `inference`, `secrets`, `filesystem`).
- The app must be restarted after installing or uninstalling a pack.

## Next steps

- [Manifest Reference](manifest.md) — every field in `apack.json`
- [Features](features.md) — building systems and surfaces
- [Content](content.md) — writing actions, prompts, and flows
- [Extensions](extensions.md) — steps, artifacts, and blocks
