# Fixed-model native allocation diagnostic — 2026-10-30

## Question and preserved workload

Does upstream vec1's supported `blocksize-min` control reduce deferred COMMIT stalls without changing canonical
vectors, FULL durability, default checkpoints, query semantics or the original budgets? This diagnostic compares
16 KiB and 4 KiB on one freshly trained, hashed model. Each starts from a copy of the same closed pre-admission
snapshot. The actual EARS query/update code and sealed held-out 99,900 x 1536 corpus/oracle remain unchanged.
Source is `8d1a166c19`; every recorded EARS/native input still matches current `a8e12b1cd1`. This is direct
physical admission, not the complete app-owned model scheduler or adoption acceptance.

Each configuration completes all 18 initial/updated cohorts (1k/10k/99,900 x 100%/10%/1% scopes), each with
100 held-out queries across first plus three timed passes: **14,400 query executions** in total. All original
frozen gates are evaluated; failing cohorts remain in the report. Each verifies all 99,900 canonical Float32
rows before/after updates. All 7,200 paired ordered answers match across configurations; minimum cohort mean
recall is 0.971 for both. Each records 2,400 native candidate calls, with every >4096-eligible query pass
executing at least 100; the large cohorts did not silently benchmark only the small-scope exact route.

## Observations, not performance qualification

| Observation | 16 KiB | 4 KiB |
| --- | ---: | ---: |
| Admission time | 15.20 s | 20.39 s |
| Admission heartbeat p99 (budget 16 ms) | 31.42 ms | 64.50 ms |
| Projection batches | 1,117 | 1,645 |
| COMMIT wall total | 10.49 s | 13.47 s |
| COMMIT p99 | 27.96 ms | 61.20 ms |
| Projection p99 | 4.14 ms | 4.15 ms |
| Minimum cohort mean recall | 0.971 | 0.971 |
| Final data-file bytes | 1,798,057,984 | 1,820,045,312 |

Neither configuration establishes the original responsiveness gate. Query heartbeat gates also fail;
scoped ANN queries remain a separate expensive path. The projection slice still does not bound COMMIT.
No production setting or default changes on this evidence; keep 16 KiB pending a qualified improvement.

The entire run is **not timing-certified**. It is a single fixed-order comparison, and the resource guard paused
only our container twice when other agents started theirs (about 109.3 seconds and 2.1 seconds). Pauses then
resumed the same process; no container was restarted and no other agent was stopped. Raw samples, failures
and `resource-watch.log` are retained without removing outliers. The harness lacks wall-clock phase markers,
so it cannot robustly map every pause to every sample. Do not treat the table as a causal speedup/regression
estimate or use paused query delays as intrinsic engine latency. Canonical-byte, answer and recall checks
remain useful. Process max RSS is cumulative in one process, not an independent per-configuration peak;
file/WAL readings are endpoint observations, not disk-growth or peak-resource qualification.

One owned container uses two CPUs, 6 GiB/no swap/dropped capabilities after a 30-second quiet admission.
FULL=2 and `wal_autocheckpoint=1000` are asserted unchanged. The same model and starting database are used
within the comparison. Model/corpus payloads, dependencies and native binaries remain outside Git; reports
contain only generic row ordinals, scores, measurements and hashes.

## Diagnosed harness failure

The first admitted run stopped before measurement: better-sqlite3 binds JavaScript Number as SQLite REAL,
while the native configuration requires INTEGER. The terminal failure, original probe and container identity
are retained. A small actual-SqliteDatabase check proves Number refuses and BigInt succeeds for both minima.
Only that parameter binding changes before the corrected run; no dataset, query, budget or durability change.
The corrected original process finishes with exit 0 and both variants complete; this is not a passing adoption
gate. Private database/model payloads are removed by the probe's normal cleanup.

## Next checkpoint

Attribute scoped-vector query cost through actual SQL plans and per-statement/decoding timing, especially
repeated scope eligibility in probe, native candidate filtering and exact reranking. Attribute deferred COMMIT
work independently. Preserve all scopes, updates, canonical bytes and recall/heartbeat gates. Use phase wall
markers and an uninterrupted disposable environment for the decisive timing rerun; do not repeatedly restart
local work to wait for a fortunate sample. A dedicated CI measurement using reproducibly sealed public fixtures
is preferable when the shared local budget is continuously used. Any worker design must preserve synchronous
foreground contracts and avoid internal writer BUSY/stalls. A smaller projection loop alone is insufficient.

`summary.json` is derived from the full raw report, not a replacement for it. Exact probe, runner, admission
watcher, generator, input hashes and original failure are retained. `receipts.json` verifies stored/original
bytes. Full app-owned admission, uninstrumented acceptance, isolated peak resources and every remaining
phase 3–7 criterion remain open.
