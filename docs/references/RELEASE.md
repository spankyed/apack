# Release & Production Build

## Quick Start

```bash
npm run release
```

Validates, bumps version, generates changelog, tags, and pushes — triggering CI to build and publish automatically.

## Release Commands

| Command | Description |
|---------|-------------|
| `npm run release` | Release with patch bump (default) |
| `npm run release:minor` | Release with minor bump |
| `npm run release:major` | Release with major bump |
| `npm run release -- --dry-run` | Preview without making changes |
| `npm run build:production` | Local production build (unsigned) |
| `npm run build:production:signed` | Local build with signing (reads `.env.signing`) |
| `npm run start:packaged` | Launch the built app with logging |
| `npm run diagnostics:packaged` | Collect the selected app’s diagnostics |
| `npm run reset:packaged` | Delete the selected app’s runtime data and logs |
| `npm run verify-signing` | Verify the selected app’s signature, notarization and Gatekeeper assessment |

Packaged-app tools currently support macOS. They default to production and prefer a local build over
`/Applications`. Select beta or preview with `--channel`; use `--app` to select a specific bundle.
An existing bundle must have a matching build manifest before any process is stopped or data removed.

```bash
npm run start:packaged -- --channel preview
npm run diagnostics:packaged -- --channel preview
npm run reset:packaged -- --channel preview
```

Reset deletes the selected channel’s runtime data, logs and preferences; it preserves packaged builds,
collected diagnostics and other channels. `--data-dir <directory>` selects an isolated profile for all
three commands, matching `APACK_USER_DATA_DIR`; its logs are collected from that profile.

## Installing (Unsigned Builds)

Until code signing is configured, downloaded builds will be blocked by macOS Gatekeeper. After opening the DMG and dragging apack to Applications, run:

```bash
xattr -cr /Applications/apack.app
```

Then open the app normally. This only needs to be done once per download.

This step is not needed once the app is signed and notarized (see [Code Signing & Notarization](#code-signing--notarization)).

## How a Release Works

```
1. npm run release          (or: npm run release:minor)
2. Typecheck → version bump → changelog → tag → push
3. GitHub Actions builds, signs, notarizes, publishes
4. Users download from GitHub Releases
```

The release script (`build/release/release.sh`) runs these steps:

1. Checks for a clean git working tree
2. Runs `npm run typecheck` — aborts on failure
3. Bumps the version in `package.json`
4. Generates a changelog entry grouped by commit type
5. Commits, tags, and pushes to origin

Run `npm run chain` before releasing to validate changes, including migration tests. Settings-default changes do not automatically require a migration; stored-data changes are covered by upgrade tests. The release script does not infer migration requirements from changed files.

## Production Build Pipeline

`npm run build:production` runs `build/build.sh` with 7 steps:

| Step | What it does |
|------|-------------|
| 1. Prepare | Selects the production or beta build environment |
| 2. Install | `npm install`, then create a fresh staging directory |
| 3. Compile DSL | `npm run build:default-setup` (skip with `SKIP_DEFAULT_SETUP_BUILD=1`) |
| 4. Build packages | API (tsc + tsup), main/preload (Vite), renderer (Vite); outputs go to the staging directory |
| 5. Native helpers | macOS speech recognition binary |
| 6. Package | electron-builder → `.app`, `.dmg`, `.zip` in `dist/` |
| 7. Verify signing | Validates code signature + notarization (skipped if unsigned) |

**Output:**
- `dist/mac-arm64/apack.app` — app bundle
- `dist/apack-*.dmg` — installer
- `dist/apack-*.zip` — archive

**Notes:**
- ASAR is disabled — API server needs direct filesystem access to `node_modules`
- Of the native modules, only node-pty is rebuilt for Electron's Node (`build/build.sh`); elmdb is N-API, which needs no rebuild
- Target: macOS Apple Silicon (arm64) only
- Requires Node >= 23.0.0 and Xcode Command Line Tools

## Production Debugging

The packaged app writes its main-process and API-child logs through `electron-log`.

**Current production log:**

```bash
tail -f ~/Library/Logs/apack/main.log
```

This log includes:

- Electron main-process startup banners
- API server spawn/readiness messages
- API child stderr, including structured fatal errors
- backend runtime errors forwarded through stderr
- renderer fatal summaries with pointers to the renderer log
- startup IDs and production log file locations

**Renderer crash/error log:**

```bash
tail -f ~/Library/Logs/apack/renderer.log
```

This log includes:

- renderer console messages
- `window.onerror` and `unhandledrejection`
- Vue error-handler failures
- application actor errors
- Electron `webContents` renderer lifecycle events such as `render-process-gone`, `unresponsive`, `preload-error`, and main-frame load failures

Machine-readable sidecars are also written for timeline tooling:

```bash
~/Library/Logs/apack/main.jsonl
~/Library/Logs/apack/renderer.jsonl
```

**App events log:**

```bash
tail -f ~/Library/Logs/apack/app-events.log
```

This is a JSONL sidecar for backend/in-app log events emitted through the app event bus. It survives renderer crashes and is useful when the in-app Logs surface is unavailable.

For a terminal-captured production run, use:

```bash
npm run start:packaged
```

That command writes an additional session log under `diagnostics/production/`, but the installed app's canonical production log remains `~/Library/Logs/apack/main.log`.

To collect a production diagnostics bundle:

```bash
npm run diagnostics:packaged
```

The command creates `diagnostics/production/<timestamp>/` with production logs, recent crash reports, process state, selected app metadata, bundled API hash, and git status.

If the UI disappears or Force Quit does not show the app, check for orphaned API child processes:

```bash
ps -axo pid,ppid,stat,lstart,command | rg 'apack|packages/api/dist/server.js'
```

An orphaned API child looks like `apack .../packages/api/dist/server.js` with parent PID `1`. Kill it before relaunching:

```bash
kill -9 <pid>
```

The app also performs this orphan cleanup automatically before spawning a new packaged API child.

## Versioning & Changelog

Uses [semver](https://semver.org/). The version lives in root `package.json` and is used by electron-builder for release file naming.

- **patch** (0.0.1 → 0.0.2) — bug fixes
- **minor** (0.0.1 → 0.1.0) — new features
- **major** (0.0.1 → 1.0.0) — breaking changes

`CHANGELOG.md` is auto-generated by the release script, grouped by conventional commit prefix (`feat:`, `fix:`, `refactor:`).

## Code Signing & Notarization

Controlled by environment variables. Without them, builds are unsigned (fine for local dev).

| Variable | Purpose |
|----------|---------|
| `APPLE_TEAM_ID` | Apple Developer Team ID (enables signing + notarization) |
| `APPLE_API_KEY_ID` | App Store Connect API Key ID |
| `APPLE_API_ISSUER` | App Store Connect API Issuer UUID |
| `APPLE_API_KEY` | Path to `.p8` private key file |
| `CSC_LINK` | CI only: base64-encoded `.p12` certificate |
| `CSC_KEY_PASSWORD` | CI only: password for the `.p12` file |

For local signed builds, create `.env.signing` (gitignored) from `.env.signing.example`, then run `npm run build:production:signed`.

## CI Workflow

`.github/workflows/build-mac.yml` runs on `macos-14` (Apple Silicon):

- **Triggers**: tag push (`v*`) or manual dispatch
- **Validates**: tag version matches `package.json`
- **Builds**: full 7-step production pipeline
- **Signs + notarizes**: when secrets are configured
- **Publishes**: GitHub Release with release files and auto-generated notes

### GitHub Secrets

| Secret | Value |
|--------|-------|
| `MAC_CERTIFICATE_P12_BASE64` | `base64 -i certificate.p12 \| pbcopy` |
| `MAC_CERTIFICATE_PASSWORD` | Password for the .p12 |
| `APPLE_TEAM_ID` | 10-character team ID |
| `APPLE_API_KEY_ID` | Key ID from App Store Connect |
| `APPLE_API_ISSUER` | Issuer ID from App Store Connect |
| `APPLE_API_KEY` | Contents of the .p8 private key file |

`npm run verify-signing -- --channel beta` uses the same bundle selection as the packaged-app tools.
Pass `--app <bundle.app>` for a specific build. Any failed assessment returns a nonzero exit status;
unsigned preview builds are expected to fail signing verification.
