# Isolated profile and built runtime checkpoint — 2026-10-28

These are diagnostic and functional checks, not an adoption or performance qualification.
All builds and tests ran in disposable Linux containers (2 CPUs, 6 GiB). No captured
runtime or target tree was copied to the daily Mac. Raw logs are gzip-compressed without
changing their bytes; scripts are retained alongside them.

## Source and results

- Published 460866c5c28a6cd40aeb9aa0c633c46023d33a6a failed strict run
  [40761412029](https://github.com/spankyed/apack/actions/runs/40761412029).
  Producers, native-2 and integration-2 passed; native-1, integration-1 and app/rest failed.
  Retained logs identify compiler fresh-build timeout, missing-worker repair timeout,
  and the settings-owner backup assertion respectively. Neither compiler failure's Mac
  cause is established: exact-source Linux controls pass unchanged original limits.
  The control harness's shared timing label incorrectly says 120 seconds for both cases:
  watcher repair retains 60 seconds per wait and 260 seconds for its whole case.
- Profile implementation through 731a38e06b includes explicit isolated selection,
  named CLI target propagation, preflight before locks, actual primary/history storage,
  backup/import/query workflows and startup index readiness. Parser negative control
  fails on removal; it does not open the rejected default profile.
- The first actual built API boot failed because bundling relocated better-sqlite3's
  native loader. 5512e5604e preserves the SQLite package boundary and makes its source
  entry erasable by plain Node. At af93f3897c, normal package/default-setup/API builds,
  two authenticated built-server boots, real shipped pack loading, persistent SDK
  Prompt reads, AppState and settings lifecycle, plus a bundled CLI ID query pass.
  The reported readySeconds include RPC completion and are not latency qualification.
  Electron ABI, asar unpacking/signing, compiled CLI coverage on other platforms and live pack admission
  remain separate requirements.
- 86ea008dd8 waits for the existing frontend-unloaded precondition before backup in the
  disabled-owner E2E case. Its original 5-second backup assertion is unchanged. CI log
  receipt timestamps suggest a short backup span but do not isolate backend CPU/IPC cause.
- db3f7a96fb's ancestor-change repair failed an existing explicit-directory noise guard.
  846dfb4ef99893cede83bc3cd5bf176e756ff018 narrows it to unregistered ancestors of
  missing reads. Existing contract tests and the new negative control pass.
- The final run on 846dfb4e passes 414 SQLite / 251 native tests, host/API/CLI profile
  cases, compiler build/repair cases, package types, API checks, lint and import checks.
  It FAILS the unchanged aggregate scripts-typecheck 60-second limit without capturing
  a diagnostic. A lockfile-corrected diagnostic passes all four constituent projects separately (36.03 seconds total),
  without TypeScript errors. The aggregate timeout cause remains unisolated; no exact green descendant
  or promotion is claimed.

Node source syntax, bundled API native ownership and missing-ancestor invalidation each
have a removal/mutation control that fails for the intended reason. Runtime files and
source archives are deliberately excluded. The existing 100k heartbeat qualification
miss and all remaining phase 3–7 requirements retain their original acceptance targets.

The [compiled CLI asset check](cli-assets/README.md) additionally passes regex, substring and vector
queries under plain Node, with a missing-WASM refusal and restored success. Electron remains open.
