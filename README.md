# AgentBuddy

AgentBuddy is an Electron desktop app for building and running AI agent workflows. It combines a Vue-based visual workspace with an actor-driven backend, plugin-defined tools, local persistence, and model integrations.

## Features

- **Actor-based runtime**: XState state machines coordinate frontend and backend behavior through a typed event bus.
- **Plugin system**: Plugins can register canvas views, panels, machines, and workflow-specific UI.
- **Model integrations**: Anthropic, OpenAI, and Google providers are wired through the Vercel AI SDK.
- **Local graph store**: The EARS entity-attribute-relation store is backed by LMDB for fast local access.
- **Visual flow editor**: Vue Flow powers drag-and-drop authoring for agent flows.
- **Embedded terminal**: xterm.js and node-pty provide command execution inside the app.
- **Rich text editing**: Tiptap supports prompt and documentation authoring.
- **Desktop packaging**: Electron targets macOS, Windows, and Linux.

## Tech Stack

- Electron
- Vue 3
- XState v5
- tRPC v11
- Tailwind CSS
- Vite
- LMDB
- Monaco Editor
- Vercel AI SDK

## Project Structure

```
packages/
├── api/                  # Backend — Fastify + tRPC server, XState actor systems, LMDB persistence
│   ├── src/
│   │   ├── core/         # Server bootstrap, event bus, tRPC router
│   │   ├── repository/   # EARS graph database layer
│   │   ├── services/     # Shared services (LLM, embeddings, etc.)
│   │   ├── setup/        # Seed data, migrations, initialization
│   │   └── systems/      # Backend actor systems (actions, brain, flows, library, etc.)
│   └── tests/
├── default-setup/        # DSL source + compiler for actions, prompts, flows, library
│   ├── src/
│   │   ├── actions/
│   │   ├── flows/
│   │   ├── library/
│   │   └── prompts/
│   └── build/            # Compiler scripts
├── main/                 # Electron main process
│   └── src/modules/      # Window manager, API server launcher, security, etc.
├── preload/              # IPC bridge (contextBridge APIs)
├── renderer/             # Frontend — Vue 3 + Tailwind CSS
│   └── src/
│       ├── core/         # App shell, router, event bus client
│       ├── plugins/      # Frontend plugin actors (actions, flows, library, etc.)
│       └── setup/        # Plugin registration
└── electron-versions/    # Electron version management
```

## Prerequisites

- Node.js 23 or newer
- npm 10 or newer

## Getting Started

```sh
git clone https://github.com/spankyed/AgentBuddy.git
cd AgentBuddy
npm install
```

The repository uses npm workspaces under `packages/*`. The root scripts coordinate builds, tests, type checking, DSL compilation, database tasks, and Electron development mode.

### Development

```sh
npm start                # Dev mode (skips DSL generation)
npm run start:gen        # Dev mode with DSL generation
npm run start:inspect    # Dev mode with Electron inspection enabled
npm run start:no-build   # Start dev mode without rebuilding first
```

### Video Render OOM

If a Remotion video render that previously worked starts failing with a Node
heap OOM, treat stale Remotion/webpack cache state as the first suspect:

```sh
rm -rf packages/video/node_modules/.cache
```

Then rerun the same render. If it still fails, retry once with a larger heap:

```sh
NODE_OPTIONS=--max-old-space-size=4096 npm run video:render
```

See [`packages/video/README.md`](packages/video/README.md) for the full notes.

### Build

```sh
npm run build            # Build all workspaces
npm run build:be         # Build backend only
npm run build-prod       # Full production build
npm run package:all      # Package for macOS, Windows, and Linux
```

### Test

```sh
npm test                 # Playwright E2E tests
npm run test:unit        # Unit tests
npm run typecheck        # Frontend and backend type checks
```

### DSL Compilation

AgentBuddy stores default setup content as DSL source files and compiles them into generated assets.

```sh
npm run compile          # Compile all DSLs (actions, prompts, flows, library)
npm run compile:actions  # Compile actions only
npm run compile:prompts  # Compile prompts only
npm run compile:flows    # Compile flows only
npm run compile:library  # Compile library content only
```

### Database Tools

```sh
npm run db:cli           # Database CLI
npm run db:exec          # Execute a database CLI command
npm run db:script        # Run a database script
npm run db:reset         # Reset database
```

## Development Notes

- `npm start` sets `SKIP_DEFS_GEN=1`, builds the backend, and launches `packages/dev-mode.js`.
- `npm run start:gen` performs the same startup path without skipping generated definition output.
- Backend build output is produced by `@app/api`; frontend build output is produced by `@app/renderer`.
- Production signing uses `.env.signing`; start from `.env.signing.example` when preparing signed builds.

## License

MIT
