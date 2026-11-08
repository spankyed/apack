# apack

**apack is a programmable desktop workspace for working with and building shared tools.**

Build tools and workflows around your own work, then share them as **packs**. A pack can contain
reusable prompts and actions or add an entire feature with its own interface, services and data.
Most of apack ships in the `default-setup` pack, using the same APIs available to pack authors.

Conversations, documents and automation work with a shared data layer. Write actions, save
parameterized prompts and connect them in the visual flow editor. Flows can call models, run tools,
query and update your data, and respond to events or schedules. Conversations can present interactive
controls and results as plans, diffs, documents and other artifacts.

The included tools cover coding, notes, a document library and web browsing. In a code project, you
can edit and review code, use the terminal, and manage Git changes and pull requests.
You can extend these tools or add your own through packs.

Workspace data is stored locally, with backup and restore support.

## Project status

apack is under active development. The instructions below run the project from source; packaged
downloads are listed in [GitHub Releases](https://github.com/spankyed/apack/releases) when available.
npm and Homebrew installation are not yet available. A published CLI is not required to develop
this repository.

## Develop apack

Run these commands from the root of the **apack source monorepo**. They develop the desktop app
itself; external packs have a separate workflow described below.

Requirements:

- Node.js **24 LTS (24.12.0 or newer)**; the root `package.json` declares the supported majors. The pack compiler needs 24.12.0: older module hooks reject the CommonJS load result its own hooks pass through.
- **npm 11 or newer** and Git.
- Native build tools required by Electron dependencies; see [CLAUDE.md](CLAUDE.md) for repository
  setup and validation guidance, and the [Windows VM guide](docs/references/guides/windows-development-vm.md)
  for the shared Windows development environment.

```sh
git clone https://github.com/spankyed/apack.git
cd apack
npm ci
npm run dev
```

`npm run dev` prepares the shipped pack and backend, starts the renderer development server and
pack watcher, and launches Electron. Frontend edits use hot reload; backend and pack changes rebuild
through the development workflow.

| Command | Purpose |
|---|---|
| `npm run dev` | Develop the app with builds and watchers |
| `npm run dev:inspect` | Start development with Electron's Node debugger |
| `npm run spec` | Run focused checks selected from uncommitted changes |
| `npm run chain` | Run the repository validation chain, reusing valid cached steps |
| `npm run build:default-setup` | Build the shipped pack and required package bundles |
| `npm run build:runtime` | Build the renderer, API, main and preload workspaces |

Some compiler/native checks require an approved disposable environment. Follow the current
[repository validation rules](CLAUDE.md) rather than starting all suites on your daily-use machine.
The [pipeline reference](docs/archive/references/pipeline-commands.md) describes validation commands and flags.

### Build a local preview

```sh
npm run build:preview -- --version 0.4.0
```

This builds unsigned **apack Preview** in `dist/preview`, with a separate app identity and data
location. The version is a local build input; the command does not change release metadata or publish
anything. See [preview builds](docs/references/preview-builds.md) for details.

For automation against existing source builds, use `npm run dev:open` and `npm run dev:drive`.
They do not start the development build/watch workflow. See [drive](drive/README.md) for preparation
and usage. Production packaging and signing are separate from local preview builds.

## Build a pack

A pack is an extension project with its own repository, manifest and tests. Its CLI commands live
under **`apack pack`**; the root monorepo's `npm run dev` is for developing apack itself.

Start with [pack authoring](docs/public-facing/getting-started.md). It covers CLI/package prerequisites,
scaffolding and the `apack pack dev` loop. External development uses the SDK, UI components and testing
helpers. npm/Homebrew availability and downloadable beta hosts are separate distribution prerequisites;
check the guide before assuming those installation paths are available.

- [Manifest](docs/public-facing/manifest.md): declarations, settings, entities and contributions.
- [Features](docs/public-facing/features.md): backend systems and frontend surfaces.
- [Content](docs/public-facing/content.md): actions, prompts, flows and entity rows.
- [Testing](docs/public-facing/testing.md): pack unit tests and app acceptance.
- [CLI reference](docs/public-facing/cli.md): app commands, pack commands and database tools.

## Architecture

apack separates the desktop host from the features it runs:

- **Actor-based coordination.** XState machines manage backend systems, frontend surfaces and flow
  execution. Typed events connect the two sides through a tRPC/WebSocket transport.
- **Declarative pack contracts.** Manifests describe contributions and dependencies; build tooling
  checks module bindings and generates typed access to services and repositories. Built declarations
  support discovery and inspection without executing a pack's modules.
- **Shared data and services.** EARS provides the entity-attribute-relation graph, persisted through
  LMDB. Host services supply common facilities such as inference and filesystem access; packs declare
  the additional services they consume.
- **Extensible presentation.** Vue powers the shell and pack views. Packs contribute frontend surfaces,
  editors, message blocks and artifact viewers. Settings declarations define schemas and defaults,
  while forms remain custom UI.

| Area | Responsibility |
|---|---|
| `packages/main`, `packages/preload` | Desktop lifecycle, windows, protocols and IPC |
| `packages/api`, `packages/renderer` | Backend process/transport and frontend shell |
| `packages/apack-host` | Pack discovery, installation and runtime; host services and settings |
| `packages/default-setup` | Shipped features, extensions and content |
| `packages/apack-sdk`, `packages/apack-ui` | Pack-facing APIs, types, components and editors |
| `packages/apack-cli`, `packages/apack-testing` | Pack tooling, build pipeline and test helpers |
| `packages/apack-ears` | Entity-attribute-relation data engine and LMDB persistence |
| `packages/repo-checks`, `packages/publish-checks` | Repository tooling and package-consumer checks |

See [architecture](docs/public-facing/architecture.md) for pack lifecycle and runtime boundaries.
For the documentation map, start at [docs/README.md](docs/README.md). Contributors should also read
[CLAUDE.md](CLAUDE.md) before changing code or running validation.

## License

[MIT](LICENSE).
