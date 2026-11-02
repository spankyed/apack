# Admission checkpoint attribution and bounded commit batching

2026-10-29. Base app `2d0a0e7d4885b47c3d330870e75ff74666f81fdd`; later candidate code is identified
by `slice-inputs.json`. Real 99,900 × 1,536-dimensional corpus and frozen fresh oracle SHA-256
`ca6356a0cf0059ba87e5f628e9ae0a32260adf146617acb498c880cdf9442545`. The normal builder compiles the
pinned membership-patched extension; source and binary hashes match earlier qualification. All runs use
private Linux ARM64 Node 23.11.1 / SQLite 3.53.4, two CPUs, 6 GiB and zero additional swap, capabilities dropped.

## Checkpoint control changes the next action

The admission-only harness retains the actual EARS create/embed/trash/train/project path, canonical byte
verification, heartbeat and phase traces. It omits query/update cohorts and therefore cannot qualify those.
Each run loads primary data under FULL, performs the same successful truncating checkpoint before admission,
and verifies FULL again afterward. The control changes only admission's automatic checkpoint threshold
from the default 1,000 pages to zero, then measures a final foreground PASSIVE checkpoint.

| 99,900-vector run | Admission | Commits | Commit total | Heartbeat p99 | Peak WAL | Final checkpoint |
|---|---:|---:|---:|---:|---:|---:|
| Fixed 32, automatic | 46.190 s | 3,126 | 36.941 s | 80.881 ms | 4.695 MiB | 76.704 ms |
| Fixed 32, manual control | 39.347 s | 3,126 | 30.242 s | 55.517 ms | 2,058.326 MiB | 4,558.637 ms |
| Time slice, automatic | 17.740 s | 1,185 | 10.535 s | 26.440 ms | 5.497 MiB | 13.978 ms |
| Time slice, automatic repeat | 18.259 s | 1,075 | 11.594 s | 50.600 ms | 5.450 MiB | 0.083 ms |
| Fixed 32, automatic repeat | 26.571 s | 3,126 | 19.185 s | 23.270 ms | 4.668 MiB | 7.421 ms |

Exact readings and model identities are in `summary.json` and compressed original reports; use those if
rounded prose differs. The manual control includes a 2,392 ms COMMIT even with automatic checkpoints off.
Deferring checkpoints alone is insufficient: substantial commit cost remains and WAL/final-drain cost explodes.
These timings do not isolate the syscall-level share attributable specifically to fsync versus file growth or IO.
No production checkpoint setting or durability policy is changed.

## Candidate change

Native projection now processes an explicitly ordered page of at most 128 rows, stopping after the shared
four-millisecond scheduler budget. A completed row always makes progress. Cursor and readiness describe
only processed rows and commit atomically with them. An underfilled page stopped early is still building.
This amortizes FULL commits while preserving primary writes, schema/model metadata and automatic checkpoints.
Four milliseconds is a cooperative work target: query preparation, an indivisible row, GC and COMMIT can exceed it.

Across both automatic samples, fixed batches take 26.571–46.190 s and time slices 17.740–18.259 s; time
slices reduce commits from 3,126 to 1,075–1,185. The order is fixed baseline/manual/sliced/sliced/baseline,
with qualification between phases and independent model training. IO varies considerably. This supports a
throughput improvement in these runs, not a hardware-independent percentage or consistent heartbeat win.
In particular, the second sliced p99 is worse than the final baseline. Every 99,900-vector heartbeat gate
still fails 16 ms. At 1,000 vectors, baseline p99 13.815 ms becomes 17.225 ms with slicing despite faster total
admission; that regression is retained. Existing frozen query/recall parameters are untouched, not requalified here.

## Verification and provenance

All 626 SQLite EARS cases pass, zero skips, including the new elapsed-budget/rollback/resume case.
The unchanged fixture with the old implementation fails exactly that case (`true` readiness instead of `false`);
all new assertions execute against actual native projection. EARS typecheck and changed-source lint pass.
CI's expected native-generation case count is raised to six for the next source qualification.
The earlier exact all-platform green applies to base `2d0a0e7d48`, not this later overlay.

The first setup refused an empty prior artifact volume; no admission ran then. The normal builder rebuilt
from independently verified upstream bytes and the correct fresh oracle. `checkpoint-runner.py` records the
resume preflight over an exact archive; prepare an isolated archive/dependency seed first. It refuses changed
source. `slice-runner.py` applies the recorded overlay, populates synthetic Git metadata only from archived
tracked paths, runs the negative/positive checks and candidate measurements. `confirmation-runner.py` repeats
candidate then baseline and restores both candidate runtime files in `finally`; receipt hashes match current code.
No corpus, model bytes, dependency tree, compiler target or compiled binary is committed. `receipts.json` verifies
retained compressed reports. Full current Strict, physical fault/recovery and all remaining goal gates stay open.

SQLite documents that PASSIVE checkpoints can leave work unfinished without waiting for readers/writers;
therefore a future off-thread design must explicitly own WAL bounds, failure, retry and drain.
See [checkpoint semantics](https://sqlite.org/c3ref/wal_checkpoint_v2.html) and
[WAL growth](https://sqlite.org/wal.html#avoiding_excessively_large_wal_files). These are design constraints,
not proof that a particular worker design is implemented or qualified.
