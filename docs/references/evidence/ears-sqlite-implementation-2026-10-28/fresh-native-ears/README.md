# Fresh integrated native EARS retrieval, 2026-10-29

Runtime/benchmark `71810414e8` completes the frozen eighteen-cohort matrix: 100 queries,
first pass plus three timed passes, initial and 1% updated data, over 1k/10k/99,900 prefixes
and 100%/10%/1% scopes. The separate 1k smoke also completes. All groups pass mean recall
>=0.95, with a minimum of 0.972. **Responsiveness fails; this is not acceptance.**
Model admission also misses the 16 ms heartbeat budget: p99 24.34 ms, maximum 364.13 ms.

The original source/extension and all frozen model settings are unchanged: 64 buckets,
32 probes, 256 initial candidates, at most 20k training vectors and one training thread.
No exploratory model is reused. The same 101-ordinal exclusion union removes selected
queries and update collisions from training and retrieval. FULL durability, the app cache
(64 MiB), two CPUs/6 GiB/no swap and actual mode denial are recorded. Training returns
20,000 samples; candidate routing invokes the native extension 2,400 times. All canonical
Float32 payloads match before and after updates. Filtered queries use indexed EARS SQL
fields, not a JS list of eligible IDs. This fixture still has one chunk per entity; separate
functional multi-chunk tests do not establish realistic multi-chunk performance/relevance.

The table reports the worst of the three timed passes; first-pass records remain separately
retained and are included in the gate verdict. Values are milliseconds.

| Prefix | Phase | Scope | Mean recall | Worst timed p95 | Worst timed heartbeat p99 |
| --- | --- | --- | --- | --- | --- |
| 10,000 | initial | 100% | 0.980 | 139.02 | 141.84 |
| 10,000 | initial | 10% | 1.000 | 22.01 | 23.14 |
| 10,000 | initial | 1% | 1.000 | 5.08 | 5.97 |
| 99,900 | initial | 100% | 0.982 | 20.69 | 26.38 |
| 99,900 | initial | 10% | 0.975 | 147.69 | 154.46 |
| 99,900 | initial | 1% | 1.000 | 14.46 | 15.39 |
| 10,000 | updated | 100% | 0.981 | 141.67 | 146.18 |
| 10,000 | updated | 10% | 1.000 | 22.17 | 23.04 |
| 10,000 | updated | 1% | 1.000 | 4.79 | 5.79 |
| 99,900 | updated | 100% | 0.982 | 19.32 | 20.75 |
| 99,900 | updated | 10% | 0.972 | 149.09 | 157.36 |
| 99,900 | updated | 1% | 1.000 | 14.38 | 25.81 |

First-pass misses are not erased by the timed table: for example updated 99,900/1% has
heartbeat p99 25.81 ms. Initial broad first-pass p95 is 24.66 ms, heartbeat p99 29.23 ms.
The 10k broad cohort also misses its separate p95 <=100 ms diagnostic limit. The 100k
p95 <=200 ms limit alone is insufficient: large filtered queries miss heartbeat badly.

Observed maximum RSS is 1,067,584 KiB; final database bytes are 1,809,018,880 plus an
11,515,432-byte WAL. Native model admission takes 25.88 s. These are this synthetic app
fixture over real vectors, not whole-app, cold-start, growth or cross-backend claims.
The fresh partition/SQL scopes differ from earlier exploratory runs; no controlled speedup
ratio against those earlier measurements is claimed.

Raw answers, recalls, latency and independent 1 ms heartbeat samples, native/source hashes,
actual container receipt and collection runner are retained. JSON whitespace is normalized
without changing values; original and retained file hashes are recorded in `receipts.json`.
Payloads, publisher source IDs and trained model bytes are not checked in.

Next decompose the actual query and admission costs. The previous original-native membership
bottleneck is a hypothesis for filtered slowdown, not a new trace finding. Do not retune ANN
parameters or loosen gates based on this partition. Preserve this failed matrix when fixing
SQL/native execution. Final app/resource/packaging/quality gates remain open.

## Independent verification and targeted profile

The committed verifier at `dacd2093ca` validates all raw answers/eligibility, exact mean
recall, order/ties, native-call counts and recomputed latency/heartbeat summaries. It
returns 0 for the passing 1k smoke and 1 for the valid but failing full matrix. Corrupted
recall, excluded-query eligibility and heartbeat metadata are rejected. Diagnostic-only
runs cannot pass this verifier. `verification/` retains these outcomes.

A separate instrumented run at `dacd2093ca` profiles the initial data without changing
ANN settings or rerunning the matrix as a new acceptance claim. It captures ninety
queries across all prefixes/scopes and actual admission stages. Source/native/image
receipts and full timings/plans are under `profile/`.

- Native metadata-filtered candidate SQL averages 120.78 ms at 10k broad and 124.24 ms
  at 100k/10%. Eligibility count and canonical reranking add roughly 16–21 ms combined.
  The earlier isolated original-C membership results suggest its linear IN implementation
  is responsible for much of that native cost; this trace alone does not isolate C internals.
- At 100k broad, native candidate SQL averages 13.63 ms, reranking 4.12 ms and the
  bounded eligibility count 1.22 ms. This combination exceeds the heartbeat target.
- Even 10k/10% exact lookup spends 8.32 ms counting and 12.87 ms scoring; SQL scope
  execution needs improvement independently of ANN membership.
- Admission takes 27.84 s. Across 3,126 commits, COMMIT accounts for 20.05 s, p99
  23.20 ms and maximum 385.69 ms. Projection takes 5.08 s total, p99 3.89 ms; native
  model installation takes 0.85 ms. Main-thread GC observations peak at 4.11 ms.
  These measurements identify COMMIT, not model installation/GC, as the major tail.

Investigate scheduling SQLite's own PASSIVE checkpoints off the foreground thread while
preserving FULL logical commits, bounded WAL growth, error reporting and explicit worker
drain. SQLite documents [separate checkpoint threads](https://sqlite.org/wal.html) and
[PASSIVE's nonwaiting semantics](https://sqlite.org/c3ref/wal_checkpoint_v2.html).
The trace does not separately time fsync versus automatic checkpoint work, so automatic
checkpointing is a hypothesis to test, not a proven exclusive cause. Do not silently
switch primary writes to NORMAL/OFF or claim a data-integrity tradeoff as acceptance.
Optimize actual scope/count/rerank plans and qualify the native membership implementation
and distribution decision. All original failed measurements and frozen budgets remain.
