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
| `npm run unrelease -- [version] [--dry-run]` | Undo a release: its GitHub releases, its tags and its commit |
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

A release's macOS app is signed and notarized (its workflow refuses to publish one that isn't). A macOS build that
isn't, such as a local preview or a dispatch without signing secrets, is blocked by Gatekeeper. After opening the DMG
and dragging apack to Applications, run:

```bash
xattr -cr /Applications/apack.app
```

Then open the app normally. This only needs to be done once per download.

The Windows installer is unsigned, so Windows SmartScreen warns before running it ("More info", then "Run anyway").
Signing it waits on a decision: see the [Windows code signing plan](../plans/deferred/windows-code-signing.md).

On Linux, the release holds an AppImage and a deb for x64. They need glibc 2.28 or later: Ubuntu 20.04, Debian 10,
Fedora 29, RHEL 8 and newer (see [CI Workflow](#ci-workflow)). Install the deb with
`sudo apt install ./apack-<version>-linux-amd64.deb`, or make `apack-<version>-linux-x86_64.AppImage` executable
(`chmod +x`) and run it; an AppImage needs FUSE 2 (`libfuse2t64` on Ubuntu 24.04).

Each channel installs as its own package beside the others: the deb's package is `apack`, `apack-beta` or
`apack-preview`, and the app is started as `apack-desktop`, `apack-beta-desktop` or `apack-preview-desktop`, so the
`apack` command stays the command line tool's. The deb installs electron-builder's AppArmor profile for the app.
The AppImage has none, and Ubuntu 24.04 restricts the unprivileged user namespaces Chromium's sandbox uses, so there it
may not start until run with `--no-sandbox` (not yet tried on a desktop, 2026-11-19).

## How a Release Works

```
1. npm run release          (or: npm run release:minor)
2. Typecheck → version bump → changelog → tag → push
3. GitHub Actions builds, signs, notarizes, publishes
4. Users download from GitHub Releases
```

The release script (`build/release/release.sh`) runs these steps:

1. Checks for a clean git working tree, on `master`, at the commit `origin/master` is at
2. Runs `npm run typecheck` — aborts on failure
3. Bumps the version in `package.json`, and refuses a version whose tag exists
4. Generates a changelog entry grouped by commit type
5. Commits, tags, and pushes to origin

The commit and its tags reach origin in one atomic push (`git push --atomic`): all of them land or none does, so CI
never builds a tag whose commit isn't on `master`. A release that fails after its commit is made, as when origin
rejects the push, takes the commit and its tags back and leaves the checkout as it was.

A production release with no beta before it is two tags on the release commit: `v<version>`, and the companion
`v<version>-beta.0` (`build/release/beta-tag.sh`), which CI builds as apack Beta and publishes as a prerelease.
`npm run unrelease` (`build/release/unrelease.sh`) undoes the two together, whichever is named, from `master` at
origin's commit, as a release is cut: it reverts the release commit, pushes the revert and both tags' deletion to
origin together, then deletes both GitHub releases and the local tags. A revert that conflicts, a push origin rejects,
or tags or releases it can't read stop it with the release as it was. With no version it undoes the newest release
commit in the branch's history that still has its tag. A `v<version>-beta.0` on another commit is an earlier beta
release and is left alone. `packages/internal-repo-checks/tests/release-scripts.test.sh` runs both scripts against a scratch
repository and origin.

Run `npm run chain` before releasing to validate changes, including migration tests. Settings-default changes do not automatically require a migration; stored-data changes are covered by upgrade tests. The release script does not infer migration requirements from changed files.

## Production Build Pipeline

`npm run build:production` runs `build/build.sh` with 7 steps:

| Step | What it does |
|------|-------------|
| 1. Prepare | Selects the production or beta build environment |
| 2. Install | `npm install` (skipped when `APACK_DEPENDENCIES_INSTALLED` is set, as the release workflows do after their own `npm ci`), then create a fresh staging directory |
| 3. Compile DSL | `npm run build:default-setup` (skip with `SKIP_DEFAULT_SETUP_BUILD=1`) |
| 4. Build packages | API (tsc + tsup), main/preload (Vite), renderer (Vite); outputs go to the staging directory |
| 5. Native helpers | macOS speech recognition binary (macOS only) |
| 6. Package | electron-builder → on macOS `.app`, `.dmg`, `.zip`; on Windows `.exe`; on Linux `.AppImage`, `.deb`; each with its SBOM, in `dist/` |
| 7. Verify signing | Validates code signature + notarization (skipped if unsigned) |

**Output on macOS:**
- `dist/mac-arm64/apack.app` — app bundle
- `dist/apack-*.dmg` — installer
- `dist/apack-*.zip` — archive

On Windows, `dist/apack-*.exe`; on Linux, `dist/apack-*.AppImage` and `dist/apack-*.deb`, unpacked in
`dist/linux-unpacked`. Each platform's `dist/apack-*.cdx.json` is its SBOM.

**Notes:**
- ASAR is disabled — API server needs direct filesystem access to `node_modules`
- No native module is rebuilt for Electron's Node: elmdb and `@napi-rs/keyring` are N-API, and the terminal's native half is the `apack-terminal` broker, a binary of its own rather than an addon
- Targets: macOS Apple Silicon (arm64) on a Mac, Windows x64 on Windows, and Linux x64 (AppImage and deb) on Linux;
  each platform's CI workflow builds its own
- Requires the Node version `package.json`'s `engines` names (^24.12.0 on 2026-11-19), and on macOS the Xcode
  Command Line Tools

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

`CHANGELOG.md` is auto-generated by the release script, grouped by conventional commit prefix (`feat:`, `fix:`, `refactor:`): one `# Changelog` header, then an entry per release, newest first.

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

`.github/workflows/build-mac.yml` runs on `macos-26` (Apple Silicon):

- **Triggers**: tag push (`v*`) or manual dispatch. A dispatch takes a `channel`, which is read for a branch alone: a
  tag names its own channel (`-beta` in it or not). The version is always `package.json`'s, which a tag must match
- **Validates**: tag version matches `package.json`
- **Installs**: `npm ci`, in a step of its own that holds no signing secret, since it runs every dependency's install
  script
- **Builds**: the production pipeline, without its install
- **Signs + notarizes**: when secrets are configured; on a tag, every signing secret must be set and `codesign`,
  `stapler` and `spctl` must pass, or the release isn't published
- **Checksums**: a `<file>.sha256` beside each download (the `.dmg` and `.zip`; the `.exe`; the `.AppImage` and
  `.deb`), in `shasum`'s form, which the CLI's `downloadVerified` reads
- **Publishes**: the GitHub Release, with release files and auto-generated notes, from a second job

Each workflow is two jobs. The build job's token reads the repository and nothing more, and the signing secrets reach
only its build step, as environment variables. It keeps the release files as the run's artifact. The `release` job is
the one whose token writes: it downloads that artifact and runs `gh`, and no code from the checkout or its dependencies.

`.github/workflows/build-windows.yml` (`windows-latest`) and `.github/workflows/build-linux.yml` (`ubuntu-24.04`) run
the same pipeline on the same triggers, unsigned, and upload their release files to the tag's release. build-mac.yml's
`draft` job makes that release, as a draft, when the tag is pushed, and nothing else makes one: the Windows and Linux
release jobs wait for it and upload, and build-mac.yml publishes it once the macOS files are on it, so a published
release always holds the files `apack install` and `upgrade` read. A tag whose macOS build fails leaves its release a
draft. A dispatch from a branch builds without publishing (one on a tag uploads, as the tag's
run would): its `release` job reads the files the build kept and stops. Every run keeps what it built as the run's
artifact, for the repository's artifact retention (2 days, on 2026-11-19).

The Linux release's glibc floor is the newest glibc any binary the app ships needs: 2.28, which the terminal broker
apack-terminal publishes and elmdb's binding, built by the release in manylinux_2_28, are each built against. It is
`LINUX_GLIBC_FLOOR` in `electron-builder.mjs`, which the deb states to apt as `libc6 (>= 2.28)`. The workflow reads the
floor back from the built deb, and `build/prod/glibc-floor.sh` reads every ELF file in the packaged app: it fails on one
needing a newer glibc, on one linking glibc whose symbols it couldn't read, and on a floor that isn't the newest need, so
the floor stated here can't drift from the binaries. The runner's own glibc is 2.39, so the packaged app's smoke check
runs there and not at the floor; nothing has run the app on a 2.28 system.

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
