# Windows call-site classification — 2026-10-29

Exact published b25a985c8c / [Strict chain 40842115212](https://github.com/spankyed/apack/actions/runs/40842115212)
passes both macOS arm64 and Linux x64 candidate lanes: **511 EARS / 95 host cases**, built probes and
selected-suite verification. Windows passes its built probe and **509 EARS cases**, with one permission
case skipped and one failure: call counting selects `src/calls.ts:106` instead of the caller. Its host
suite does not run. The frozen regex asset and real interrupted-index kill cases now pass on Windows.
The full run's other jobs are still live when this record is written; this source cannot be promoted.
All three platform reports/provenance and the actual Windows log are retained here.

The earlier assertion-only path fix was incomplete. `ENGINE_FRAME` and `shortened()` classify POSIX path
components, but `filePath()` leaves source-loader Windows backslashes unchanged. Normalizing only the
assertion cannot remove engine frames. Normalize decoded/raw paths before both classification and
shortening; restore the original strict test assertion. Three independent stack fixtures cover raw
Windows source paths, Windows installed-package paths and encoded file URLs. They require the first
three external caller frames, exclude engine/Node frames, and check stack-depth restoration.

Exact Linux validation starts at a6badf919a plus the two-file patch. The tested archive hash, patch,
old source and runner are retained; archival verifies working bytes against the tested archive. One
disposable Linux arm64 container uses two CPUs/6 GiB, dropped capabilities, actual mode-denial preflight,
read-only dependencies and pinned native 6ab2f69. Five builds, EARS types, **nine focused cases per backend**,
all **514 SQLite / 292 native cases**, all four API reports, lint and import checks pass. Restoring the old
collector fails both raw Windows fixtures while the URL fixture passes. The runner restores/checks the
fixed source afterward. Setup results.json covers setup only; named logs contain later outcomes.

The change is in opt-in call attribution, not text execution. Presence/FTS source is unchanged from the
qualified functional and measured a2de2944a1 checkpoint; its full cost cohort is not rerun for this fix.
The corrected collector still needs real Windows platform validation and a new exact integrated gate.
Keep the current full run until its remaining jobs finish, inspect any other failures, and do not retry
unchanged broad input or enlarge deadlines. Canonical remains exact green 60d4283f68; no adoption occurs.
