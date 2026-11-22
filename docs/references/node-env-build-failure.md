# NODE_ENV=production Breaks Dev Builds

## Symptom

`npm run dev` / `npm run build:server` fails with missing type declaration errors:

```
error TS7016: Could not find a declaration file for module 'fs-extra'.
error TS7016: Could not find a declaration file for module 'ws'.
```

## Cause

`NODE_ENV=production` is set in your shell. This makes `npm install` skip all `devDependencies` (including `@types/*`, `typescript`, `tsup`, `tsc-alias`).

Common triggers:
- A previous shell command or tool set `NODE_ENV=production` and it persisted in the session

## Fix

```bash
# Check current value
echo $NODE_ENV

# Option 1: Override for the current command
NODE_ENV=development npm install

# Option 2: Unset for the session
unset NODE_ENV
npm install

# Option 3: Open a fresh terminal
```

Then rebuild:
```bash
npm run build:server
```

## Mitigations

- **Production build** (`build/build.sh`): Forces `NODE_ENV=development` for `npm install`, so prod builds always get devDependencies needed to compile
- **Terminal service**: Unsets `NODE_ENV` in spawned terminals so the Electron host's production mode doesn't leak into user shells
- **Preinstall warning**: Root `package.json` prints a warning if `NODE_ENV=production` is detected during `npm install`

If `NODE_ENV=production` keeps appearing in your shell, check your shell profile (`~/.zshrc`, `~/.bashrc`) for any `export NODE_ENV=production` lines.

## Why the prod build installs devDependencies

The prod build needs devDependencies (`typescript`, `@types/*`, `tsup`, `tsc-alias`, `vite`, etc.) to **compile** source code into JS. The build pipeline is:

1. `npm install` — installs everything (including devDeps needed to compile)
2. `tsc` + `tsup` — compiles TS → JS (needs devDeps)
3. `vite build` — bundles main/preload/renderer (needs devDeps)
4. `electron-builder` — packages only the compiled output + production `node_modules`

DevDependencies are needed during steps 1-3 but are **not shipped** in the final app. `electron-builder`'s `files` config controls what gets packaged, and it already excludes `@types`, `.bin`, and other dev files. So devDeps exist on disk during the build but never end up in the DMG.
