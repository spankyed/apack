# Runtime assets and declared inputs — 2026-10-28

Source **5e20fb5956cb0543d8934f34232d088d108818b1**, pinned app/native 98386b36a1 / 6ab2f69.
Disposable Linux arm64, 2 CPUs / 6 GiB, apack-linux-test:74d4b8cfe839. No native builds,
captured runtimes or target trees copied to the daily Mac. Only logs, scripts and hashes leave Linux.

## Packaging changes and proof

The API declares the external EARS SQLite package as a runtime dependency. Its root/lmdb shared engine
entries stay bundled; SQLite stays external to retain native/vector/WASM package-relative ownership.
The actual API tsup fixture now exercises writes, FTS, regex/WASM and vectors. Removing root bundling fails
plain Node source syntax; forcing SQLite inlining fails native-loader resolution. Restored cases pass.

The new SQLite block is extracted verbatim from build/prod/smoke-native.mjs and executed against normal
built workspace packages under Node **23.11.1** and Electron **37.2.4** (as Node, **22.17.1**). Both pass writes,
FTS, regex/WASM, native vectors and read-only reopen. Hiding WASM makes Electron refuse; restoring it passes.
This executes the real probe logic, not a complete electron-builder output or signed app. Other probe blocks
(node-pty/keyring), copied distribution files, UI, signing and other OS/architectures remain separate acceptance.
ASAR is disabled by the current packaging configuration, so no ASAR unpacking claim is appropriate.

Pinned better-sqlite3 **13.0.3** uses Node-API (node-addon-api dependency and shipped prebuild).
The SAME Linux addon SHA-256 **8ba771f284dfd9430e3ef8e2ffc373ed7cc5a92fc7c4c0c7baf39dd672863485**
loads with Node ABI **131** and Electron ABI **136**. No rebuild is required for this tested pair.
A local assumption based on older V8-specific versions led to temporary rebuild-list edits in b71ab00d5b;
115580d3fa removes those edits after actual runtime verification. Release/version metadata is unchanged.
The pinned package manifest and source are authoritative; its older troubleshooting paragraph still generally
recommends electron-rebuild: [v13 manifest](https://github.com/WiseLibs/better-sqlite3/blob/v13.0.3/package.json).

## Cache correctness

API bundle tests read tsup.config.ts and build/build-metadata.ts; source tests also load package-owned
regex/WASM through createRequire. The actual files now enter workspace/suite/typecheck cache inputs.
Five builds, byte-identical checked-in lockfile after dependency setup, API types, **78 repository guard cases**,
the compiler-read coverage guard with populated API test dep-info, scripts types (20.61 s against unchanged
60 s), lint and imports pass. Removing the declared API inputs fails the unchanged suite-read guard for both
original CI paths. No guard is weakened. Only API compiler coverage represented by the generated dep files is
claimed; this is not a complete strict-chain run.

The first archive harness lacked Git metadata required by chain-inputs and failed there. Its logs are retained;
the corrected harness initializes a synthetic Git index over exactly the tracked source archive before copying
dependencies. source.json identifies the original source pin and the synthetic metadata's limited purpose.

## Existing published CI

Strict run [40775526128](https://github.com/spankyed/apack/actions/runs/40775526128) at **3f4651b009** remains
unpromotable. Producer succeeds; integration-1 and app/rest fail on undeclared input reads fixed above.
Integration-2 reports **30 files / 538 tests passed** but fails with an unhandled Vitest onTaskUpdate RPC timeout;
its cause remains unisolated and its failed status is not waived. Native jobs were still live at this checkpoint.
Do not restart this tip or claim the newer local descendant has exact CI success. Original performance,
relevance, physical-failure and platform requirements remain open in the full goal.
