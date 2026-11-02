# Explicit import recovery — 2026-10-28

The candidate adds `apack db recover` for an explicitly named profile. Inspection reads records only;
`--session <reported-name> --restore` deliberately restores retained incumbent stores/media. The command
holds the existing profile writer lock, refuses a running app and excludes managed read-only connections.
Copies are staged and checked before publication, a persisted plan allows resumption, interrupted live
directories remain for inspection, and a completed session is never replayed after later app writes.

Managed read-only opens register atomic private metadata claims until close. Recovery publishes its
exclusion before enumerating readers; readers publish a claim before checking that exclusion. A live
reader prevents publication, a new reader refuses during publication, and dead readers use existing host/PID
liveness cleanup. Profile metadata must be writable; direct backend snapshot construction is unchanged.
Raw backend handles are outside the managed profile ownership protocol and must be closed before recovery.

## Qualified source and checks

`ears-import-recovery-node-source.json` pins the source archive and parent; `source-comparison.json` proves
all package implementation/test/API bytes match that archive. In Linux Node 23.11.1 (2 CPUs, 6 GiB, all
capabilities dropped, permission-denial preflight), the final run passes five builds, host/CLI types,
67 host cases, 3 CLI recovery/backup cases, lint and import checks. The host cases include existing
open-app-database and profile write-lock contracts. Removing the pre-publication verification fails the
changed-stage test, while the normal cases and other protections remain in place.

The five permanent process cases run the normal built SDK/EARS entries under plain Node. They actually
SIGKILL an import after primary COMMIT and before history/media replacement, independently verify the
mixed physical state and blocked writable startup, then SIGKILL recovery after moving or publishing the
primary store. Both elmdb and SQLite resume to both incumbent stores and incumbent media, keep candidate
and incumbent forensic copies, unblock startup only after completion and release the writer lock. A separate
live reader blocks recovery; after SIGKILL, a fresh process reclaims its stale claim and completes recovery.
These process-death probes run on POSIX; Windows is explicitly skipped. They are not power-loss tests.

## Retained failures

- `ears-import-recovery`: builds/types and six ordinary restore cases passed, three interruption tests failed
  because ESM namespace exports cannot be spied on. Switched to the repository's mutable builtin plus
  syncBuiltinESMExports pattern; no storage rule or budget changed.
- `ears-import-recovery-fixed`: corrected 33 host cases, 3 CLI cases, types/builds/lint/imports passed.
- `ears-import-recovery-crash`: positional `inspect` accidentally launched Node's debugger. All four crash
  cases timed out and a blocked synchronous worker also reported RPC timeout. Probe inputs now use a private
  environment value and child execution is asynchronous. The failed run is retained, not counted as acceptance.
- `ears-import-recovery-coordinated`: all 12 ordinary recovery and existing import/storage cases passed;
  three real process cases passed but two child startups crossed the original 15-second limit. This run failed.
- `ears-import-recovery-node`: switching the probes from the full source/tsx graph to normal built SDK/EARS
  entries plus plain Node passes all 67 host cases. Original 15-second child and 30-second test limits remain.
  This does not isolate the earlier startup delay to one cause or prove every performance/resource budget.

## Remaining acceptance

The preparation barrier now syncs all retained files/tree and the session's parent before the first live
replacement. Sync failures at either boundary preserve the original error and incumbent, call no replacement,
acceptance or rollback handler, and remove the unneeded staging session. Removing either sync fails its
specific regression (one failure/five passes per control). Shared helpers own the same file/directory sync
policy for preparation and restore. Windows still cannot sync directories through this Node API; no universal
power-loss assertion follows from these Linux checks.

`ears-import-recovery-durable/` passes 69 host cases, 3 CLI cases, builds/types/lint/imports and all three
removal controls. `ears-import-recovery-runtime/` additionally passes API types and **73 host cases**, covering
metadata permission refusal, retained reader ownership after failed backend close, unreadable/foreign reader
claims, existing managed open/write-lock behavior and all five process-death cases. All three removal controls
fail for their intended assertions. The Linux capability/permission preflight is retained. Its entire package
source/test/API tree matches `runtime-source-comparison.json`; `runtime-observed-checks.json` explicitly records
orchestrator-observed exits, separately from the harness's own logs.

The final run executes the actual built `dist/package/dist/cli.js`: a real SIGKILL leaves a partial SQLite
import, CLI inspection reports pending, CLI --restore settles both stores/media, and an independent fresh
process verifies incumbent data and unblocked writable opens. This uses built-workspace output/dependencies,
not a fully installed or signed distribution. Raw stdout/stderr and the structured result are retained.

The prior published maintenance source `585dcafccf` completed all six strict jobs in run 40790543472; its
exact CI record is retained and the approved helper advanced canonical to that source. This recovery descendant
requires its own exact strict gate before canonical advances again.

Broader integrated host/API/CLI validation, read-only mounts, raw/unmanaged ownership, filesystem/power-loss
and supported packaged platforms remain required. Directory creation/parent hierarchy beyond the preparation,
media writer coordination and large-copy time/memory/disk usage still need qualification. The remaining SQLite
goal (performance, relevance, vectors, full app flows and final review) stays active.
