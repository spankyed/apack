# Admission measurement correction — 2026-10-28

The maintained admission harness now measures an independent periodic 8 ms heartbeat, retains inter-operation
turn waits under their accurate `turnWaitMs` name, and keeps the original operation/lookup/resource targets.
Heartbeat p99 below 16 ms was recorded in the storage plan before its first measurement. Raw delays, counts,
percentiles and maximum are reported. Stopping records an overdue final operation; the timer does not own CLI
lifetime. Archived earlier reports keep their original `timerStallMs` field and narrower meaning.

`load-metrics.check.ts` runs before admission cohorts. Four real behavior checks pass locally and in disposable
Linux. Three independent mutations fail the intended assertions: dropping the final overdue sample, missing a
generic `.node` filename, or retaining the heartbeat timer's process reference. The files named `negative-*`
retain those failures; the restored helper passes all checks afterward.

A shared native-binding helper captures actual loaded addons and explicitly named extensions. Admission reports
capture each process's native bindings; facade provenance uses the same helper. The first smoke also loads
msgpackr's extract addon, so the final admission assertion explicitly requires the better-sqlite3 package path,
rather than allowing any unrelated `.node` to satisfy a claim about SQLite.

## Verification and failed smoke

Two ephemeral Linux checkouts used private copies of the pinned dependencies, excluding mutable caches, and a
read-only matching engine. Neither shared writable dependencies/output with another checkout or built on the Mac.
EARS typechecking, all four helper checks, and zero-trial provenance pass. Final provenance includes the actual
SQLite prebuild and vector extension hashes and identifies the complete measured source. Python scripts also
pass in-memory syntax checks. No Rust target or captured runtime was copied out of the disposable environment.

The initial sync-disabled 1k smoke passes its correctness assertions and emits its full report, but exits 1 for
failed budgets: lookup p99 31.82 ms, turn wait 19.53 ms and heartbeat delay 34.41 ms. Operation p99 is 6.23 ms;
admission is 9.69 ms. It has only 64 foreground operations and 20 heartbeat samples; this is not a 10k/100k
qualification cohort or an app latency claim. The failure is retained, not retried until green. Its exact admission
source snapshot and provenance are archived. The later metadata assertion tightening was re-typechecked and its
provenance/helper checks rerun successfully; that final check did not repeat the failed load.

This correction supplies stronger evidence, not a performance fix. The earlier durable failure and the controlled
IO diagnosis remain in force. Background text/vector admission, IO/ownership qualification and all remaining goal
requirements remain open. The implementation's separate strict gate is run `40676231748` at `6c29f083f3`.
