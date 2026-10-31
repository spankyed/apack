# Commit uncertainty and maintenance safety — 2026-10-28

This checkpoint qualifies failure handling, not production adoption. Native pin is
`6ab2f69fa13289ed4f02952253c58b4d41922c98`; the app integration parent is
`1a0f664d01bacb969ab48cd27aae1afd146de1cc`. No compiler or native validation ran on the daily Mac.

## Real syscall baseline

`syscall-baseline/` records source `479e6bc333c82020ceb66a61dd84882aab396a5f`, before the
uncertain-COMMIT handling in `8b7159e051d2fa261b7e61aa6613f7aceeba891b`.
The Linux-only LD_PRELOAD shim intercepts one exact synthetic database WAL's fsync/fdatasync,
armed only for COMMIT. It injects EIO either before the real sync or after a successful real sync.
It never intercepts unrelated database paths. The source, harness, shim hash, syscall records and
clean-close/SIGKILL reports are retained here. There are six cases: no fault/before/after × clean/crash.

All four injected cases returned SQLITE_IOERR_FSYNC and independently reopened at the incumbent
sequence with no candidate row. No-fault cases reopened with the candidate and incremented sequence.
The after-sync records show the actual sync returned zero before the injected EIO.
These observations establish rollback in these cases; they do **not** establish an ambiguous persisted
commit, physical power-loss safety, or behavior on other filesystems.

## Commit-boundary regression tests

The permanent commit-outcomes suite distinguishes a still-active failed transaction from an ended
transaction whose driver acknowledgement is unavailable. Its applied-COMMIT/lost-ack case is an explicit
driver-boundary injection, separate from the syscall observations above. It verifies no replay, preserved
cause/code, stopped background indexing, refused reuse and independent reopen of actual persisted data.
Schema and bulk-load use the same boundary; watch change capture happens before COMMIT.

## First maintenance snapshot

`maintenance-first-source.json` pins the exact dirty source archive by SHA-256 and committed parent.
The first disposable Linux run passed all five package builds, EARS and host types, 17 SQLite safety
cases (8 commit outcomes, 4 transaction failures, 5 maintenance contracts), 5 native maintenance cases,
and 10 host import/runtime cases. The container had 2 CPUs, 6 GiB, all capabilities dropped; the permission
preflight confirmed mode denial. Raw outputs are compressed without rewriting.

The write lease excludes ordinary writes on the same database handle while maintenance copies and replaces
stores. Owner operations may await and nest. Watches and composition-owned settings listeners lose that
authority. This is not a cross-process lock or a global atomic read snapshot across stores.

The recovery preparation is written before the first live replacement. An unknown commit preserves incumbent
copies and never automatically replays the replacement; host composition closes affected handles and suppresses
settled replacement publication. Writable host opens refuse a pending preparation; read-only inspection remains
available. Explicit recovery tooling, process-kill qualification, physical durability of all copied recovery files,
independent-process exclusion and full integrated validation are still required. Do not remove a preparation
merely to make startup proceed.

`maintenance-followup/` records a separate source snapshot pinned by `maintenance-followup-source.json`.
It passed five builds, both typechecks, API generation (only the two intended construction methods),
69 host recovery/settings/runtime cases, 13 SQLite maintenance/commit cases and 5 native maintenance cases.
Disabling the lease check caused the maintenance suite to fail as required; protection was restored before
native validation. The generated API report was transferred as text with the repository's existing LF endings.
The later real-store snapshot/rollback concurrency case and final integrated checks remain unqualified here.


## Final source checkpoint and retained lint failure

`maintenance-final-source.json` pins the executed archive; `maintenance-final-commit-comparison.json`
proves all 2,491 package source/test/API files in it match committed `8f23caf3dc`.
The final run passed five builds, EARS/host/API typechecks, 75 host tests (including a real incumbent-copy/
streaming-write/rollback race), 431 SQLite contracts, 256 native contracts and all three EARS API reports.
It then failed lint on assigning to a catch parameter in the background index failure recorder. The raw
failure is retained under `maintenance-final-lint-failure/`; import checks and real syscall probes did not run.
This entire run is failed, even though the preceding suites passed.

The correction preserves the caught exception and uses a separate `reportingFailure` local for aggregation;
it changes no failure policy or test deadline. `maintenance-lint-fixed/` records the separate successful run: five builds, EARS types, 17 focused
storage safety cases, lint/imports and all six real before/after-WAL-sync EIO probes. Its source/archive
comparison is retained separately. Faults return COMMIT_UNKNOWN with SQLITE_IOERR_FSYNC as cause, refuse
further data reads and reopen at the incumbent sequence; both no-fault controls retain the candidate.
`outcomes-verified.json.gz` records independent assertions over all six reports. After-sync faults again prove
the underlying sync succeeded before EIO. These results do not establish physically ambiguous persistence
or power-loss correctness. The caught-exception local is the only package source change since the full suites. No unchanged full suite was retried to turn the failed run green.
