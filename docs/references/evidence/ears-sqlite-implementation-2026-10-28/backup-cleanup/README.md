# Offline backup cleanup outcomes — 2026-10-30

## Reproduced defect

At parent `58ae8a7b0e`, `dbBackup` cleans its staging directory and releases its write lock in nested
`finally` blocks. Either cleanup error can replace the original failure, hiding a `PUBLICATION_UNKNOWN`
outcome and destination path. A cleanup failure after successful publication also omits where the valid
backup was retained. This contradicts the goal's truthful recovery-outcome and both-error requirements.

Three real command tests exercise ordinary SQLite profile snapshots and inject only the relevant boundary
failure: unknown publication plus failed staging removal, unknown publication plus failed lock release,
and successful publication plus failed staging removal. The lock-release injection performs its actual
release before reporting failure. Tests verify original error identity/code/path, ordered cleanup causes,
write-lock release, owned staging behavior and the still-verifiable published backup.

The final baseline run uses the exact final tests against the original backup source: **3 failed**, with the
other 12 tests deliberately unselected. The runner restores corrected source in `finally` before continuing.
The corrected exact platform CLI selection passes **32/32**, zero skips; lint and verifier syntax pass.
The initial two-case baseline and initial 31-case corrected run are also retained as development history;
the final reports and final input hashes own the three-case evidence.

## Implemented behavior and coverage

The command collects the primary failure, independently attempts staging removal and lock release, and
preserves all failures in order. A lone failure before confirmed publication is rethrown unchanged. Aggregated
failures preserve the primary code and destination path. If publication already succeeded, the error records
`publishedPath`; no error path removes that destination. Thrown `undefined` is retained as a failure by the
array rather than mistaken for success. The source database remains authoritative throughout offline backup.

All three new cases join the five existing named backup safety witnesses in the platform verifier.
Twenty controls extract and execute the real helper, eight required names, selector and call against the real
32-case passing report. Each omission (even replaced with an unrelated passing case) and pending witness
refuses; duplicate names refuse, additional passing cases are accepted, and Windows separators select the same
cases. These controls protect coverage, not actual Windows filesystem behavior.

All commands ran in the private Linux volume at half a CPU/768 MiB/no swap/dropped capabilities, without
compiling on the daily Mac. CLI types still require the larger disposable budget; the preceding 512 MiB heap
failure is retained in [exclusive publication evidence](../windows-backup-exclusive/README.md). Matching normal
package builds and final integrated/platform acceptance remain required. Existing platform run 41130505526
qualifies the preceding exclusive-move inputs at `58ae8a7b0e`, not these later cleanup changes. Do not restart
that live run or treat its eventual result as exact-source acceptance of this checkpoint.

`inputs.json`, `implementation.patch`, exact runner/control source and compressed raw reports preserve the
inputs and commands. `receipts.json` verifies original/stored bytes. No assertion or deadline was relaxed;
Windows physical directory durability and the remaining full-goal acceptance requirements remain open.
