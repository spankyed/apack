# SQLite file ownership admission — 2026-10-30

Candidate parent `dcd374c477`, native pin `2441af4658`. Opens now inspect the main file and WAL,
shared-memory and rollback-journal names before even the read-only identity probe. Nonregular entries,
symlinks (including dangling links), files with multiple links and orphan sidecars refuse with `IO`.
Backups require an unoccupied four-file destination namespace before `VACUUM INTO`.

The unchanged implementation fails 37 of the first 38 regression cases. The hard-linked shared-memory
case also changes the external target's bytes; the dangling main-file case creates its target. The retained
baseline report includes those failures, not just error-code mismatches. After the fix, 42 ownership cases
plus all 19 identity cases pass, with no skips, in the private Linux ARM64 container capped at half a CPU,
768 MiB and no swap. FIFO checks use child processes with a five-second outer timeout so an accidental
synchronous native open cannot hang the test runner. Both read-only and writable opens are covered for
symlinks, hard links, directories, dangling links and orphan sidecars; backups cover each occupied name.
No existing assertion or deadline changed.

`inputs.json` identifies the changed runtime and test files. `receipts.json` records original/stored hashes;
large reports are losslessly gzip-compressed. The source and dependencies are private container inputs,
not the daily-use Mac or the other agent's worktree.

This enforces admission inside a cooperatively owned namespace. It does not provide an atomic no-follow
native open or exclude arbitrary concurrent namespace replacement, bind mounts or noncooperating writers.
Managed directory claims, exclusion before deletion and supported close/drain remain required.

Broader isolated validation passes EARS typechecking, changed-file lint, all five normal package builds,
762 full SQLite-selected EARS tests (zero skips) and 1929 host tests
(1 existing platform skip). The exact formerly timed-out CLI case passes in 28.6 seconds
in the Linux reproduction under its unchanged 200-second deadline; the other 13 cases in its file are
intentionally unselected. This does not diagnose the earlier macOS CI timeout or qualify that whole shard.
The run used two CPUs/six GiB/no swap/dropped capabilities after a 30-second quiet window. Its exact
commands, input hashes and durations are retained in `qualification.json`.

Final platform and installed acceptance on this source, quarantine-parent durability, reset exclusion and
all performance/relevance/adoption gates remain required. Production continues to use elmdb.
