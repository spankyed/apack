# Supported larger vector blocks — 2026-10-30

## Controlled inputs and full diagnostic matrix

Source `49d6426961` uses identical EARS/native inputs to the current candidate. The trained model is read
from the preceding retained snapshot in native read-only mode, checked by SHA256, and reused without
retraining. The immutable original snapshot's entire primary-file checksum is identical before/after.
A fresh canonical initial store is closed once; each 16/64/256 KiB `blocksize-min` variant starts from that
same base. Only one base plus one candidate exists at a time, on our private named volume. The original
snapshot is never copied or mutated. Minimum pre-admission host free-space budget is seven GiB.

Each variant completes **18 initial/updated cohorts x4 passes x100 held-out queries**, totaling **21,600
queries**. All 99,900 canonical vectors verify before and after updates; every large eligible cohort uses
native candidates. FULL durability, default autocheckpoints, original 0.95 recall/16 ms heartbeat gates,
candidate target 256 and nprobe 32 remain unchanged. This uses direct bounded physical admission, not the
complete app-owned scheduler; it does not substitute for live foreground/watch/contention qualification.

## Observations and disposition

| Minimum block | Minimum mean recall | Metadata blocks/query, initial / updated 10k | Admission wall | Admission heartbeat p99 | Admission pause overlap |
| --- | ---: | ---: | ---: | ---: | ---: |
| 16 KiB | 0.973 | 656.56 / 664.80 | 25.25 s | 97.56 ms | 0.00 s |
| 64 KiB | 0.973 | 180.04 / 180.42 | 33.18 s | 66.97 ms | 4.48 s |
| 256 KiB | 0.973 | 57.74 / 57.74 | 221.57 s | 175.19 ms | 125.25 s |

All three variants fail responsiveness gates even when considering only the three timed query passes; **no production setting changes**. Larger blocks
reduce the number of metadata blocks scanned, but this is not enough to establish acceptable foreground
responsiveness. The complete canonical/recall/call-count/paired-answer comparisons are in `summary.json`.
Recorded wall timings include guard pauses; **do not interpret this table as causal speedup/regression**.
All original samples remain present, including paused and outlier samples. Phase/pass/query/COMMIT wall
markers and guard events identify overlaps; a two-millisecond boundary margin accounts for wall rounding.
Single fixed ordering, warm caches and cumulative process maximum RSS also prevent isolated resource claims.
Database/WAL bytes are sampled before close, not a certified steady-state disk budget.

The supported block-size avenue is measured and remains insufficient. Before adding a query-owned bitmap,
test the smaller native change: compact integer metadata can binary-search the existing sorted 64-bit RHS
array directly, bypassing repeated per-block conversion/allocation. This preserves O(log RHS) membership
without a new representation, range policy, allocation or lifetime state. NULL sentinels and mixed/real
operands must retain ordinary SQLite semantics; compare all existing membership controls plus boundary cases,
then unchanged-model actual query answers/recall. An untested private bitmap prototype is not adopted.
SQL scope materialization and unfiltered native scans remain separate costs. Durable-COMMIT responsiveness,
all representative app/resource requirements and original goal phases remain open.

## Reproduction and evidence

Exact probe/generator/runner/guard, input hashes, full raw report/logs, pause events and model provenance are
retained losslessly with integrity receipts. The container uses two CPUs/6 GiB/no swap/dropped capabilities,
waits for 30 seconds of quiet and pauses only itself when another build starts. Nothing is compiled/full-tested
on the daily Mac, no other container is stopped, and no corpus/model/database/native-binary payload is in Git.
The preceding [query attribution](../query-attribution/README.md), [policy rejection](../query-policy/README.md)
and [native counters](../native-query-profile/README.md) motivate the diagnostic without changing acceptance.
