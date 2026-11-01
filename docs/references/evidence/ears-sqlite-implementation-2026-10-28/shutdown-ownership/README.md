# Graceful app shutdown and terminal worker draining

2026-10-30. Base `4a5b3a8bba21d1176d04be33aeabfba16332549d`; exact tested source overlay
in `inputs.json`. Validation ran in private Linux ARM64 containers, image
`sha256:0146a4490634fe153ec35c63e7075a4b3e31b1d1a2996d29c77506c5d07b6507`,
with `--cpus 2 --memory 6g --memory-swap 6g --cap-drop ALL`. No working-agent source/output,
daily profile, shared writable dependency tree or Mac compiler was used.

## Implemented ownership

The storage port exposes optional `drainBackground()`. SQLite's drain is terminal: it stops the
index scheduler and awaits actual native worker exit; new writes refuse `WRITE_PAUSED` from the
start of draining until close/reopen. Repeated calls join the same stop. Read operations remain
possible; drain refuses an open unit. Synchronous close remains available as a final safety net.

Host `closeDatabases` deduplicates handles, holds each one's async write exclusion through drain
and close, and attempts all stores independently. An absent hook preserves synchronous-backend
behavior. Failed drains retain their open handles; all failures are aggregated without replacing
original errors. Absent/already closed handles are ignored. No directories are removed or published.

The API's SIGTERM path stops actors/transport, runs pack shutdown hooks once, awaits host drain/close
for both stores, then exits successfully. Repeated signals share one attempt. Failure reports an
unsuccessful exit. The synchronous exit callback retains its final cleanup safety net; hooks are
not run twice. Parent disconnect still routes through SIGTERM.

## Qualification

- All **637 SQLite EARS cases pass**, zero skips. The existing real worker ownership test now proves
  writes refuse during and after terminal drain, repeat draining succeeds, actual workers settle,
  and a reopened owner can recover/readiness-publish its persisted attempt.
- Four host shutdown cases pass with real SQLite handles: delayed drain/order, deduplication,
  write exclusion with continuing reads, independent-store failure/error retention, open-unit
  refusal and backends without a background hook.
- Eighteen affected API cases pass, including two new signal cases. They execute the production
  SIGTERM callback and host close implementation with real SQLite handles, while sockets, process
  exit and pack/actor hooks are controlled. A delayed drain proves exit cannot occur early; repeated
  signals/hooks and failed-drain exit status are checked. These are not real child-process,
  Electron or forced-kill tests.
- EARS, host and API typechecks, import boundaries, correctness lint, ordinary package build and
  API generation/check pass. The generated root API report adds only the optional drain method;
  SQLite/LMDB reports are unchanged. Repository LF normalization is byte-equivalent apart from
  line endings and passes a further API check, with both hashes retained.
- Omitting the API await fails exactly the delayed-drain test because exit has already happened.
  Removing the terminal write barrier fails exactly the real native worker test because a write
  succeeds. Original bytes are restored and hashed; `controls.json` retains actual failures.

`results.json`, historical runner and compressed raw reports record commands/verdicts. The runner
resumes private `ears-auto-admission-work`, applies the hashed overlay and uses read-only extension
and native-binding mounts. It is a historical command receipt, not a self-contained image. Report
gzip/original hashes are retained. No corpus or model payload is checked in.

## Scope still open

Normal host native-artifact resolution/signing and model-owner creation remain required. Terminal
drain cannot substitute for live logical-import suspend/resume: the same scheduler stays stopped.
Host replacement/deletion ownership, all temporary/disposal paths, native audit/rebuild/restore,
incumbent-preserving physical refresh, real process/forced termination and installed app coverage
remain in the goal. This does not certify current native-pin integration, arbitrary filesystems,
full Strict, responsiveness or performance; the last real 100k heartbeat result is still failed.
The SQLite source checks use the recorded older base-plus-own-unit-patch elmdb binding as an unused
backend dependency, not an exact build of current `006d6cec88`.
