# Owner-postings cost and functional checkpoint — 2026-10-28

Preregistered at `c132441538bbbad60a53dc12fb79f77755c83406`. Exactly six fresh processes ran legacy 9a2771ec25 /
rowid aadd721d43 / postings c132441538 / postings / rowid / legacy in one owned Linux arm64 container,
two CPUs/6 GiB, OFF commits and 180 seconds per process. Every variant uses the identical updated fixture
from the preceding six-process cohort. Both controls receive only that fixture; source archives stay pinned.
Installs preserve lockfiles. All six finish with expected answers; no samples are discarded or retried.
The prior failed cohorts remain separate, including the apparently successful point-only correction.

| Measurement | Legacy trials | Rowid trials | Native owner-postings trials |
|---|---:|---:|---:|
| Point/common p50 | .289 / .286 ms | .695 / .712 ms | .673 / .681 ms |
| Reverse point/common p50 | .280 / .277 ms | .687 / .689 ms | .647 / .657 ms |
| 100-owner/common p50 | .523 / .522 ms | 69.458 / 69.216 ms | 3.103 / 3.116 ms |
| Reverse 100-owner p50 | .532 / .519 ms | 69.067 / 69.293 ms | 3.092 / 2.945 ms |
| 100-owner/common p99 | .860 / .867 ms | 73.053 / 73.110 ms | 4.064 / 3.800 ms |
| Selective/global exclusion p50 | .063 / .063 ms | .644 / .608 ms | .561 / .561 ms |
| Broad limited p50 | 14.732 / 14.602 ms | 27.804 / 27.326 ms | 28.110 / 28.284 ms |
| Name write p50 | .211 / .211 ms | .221 / .222 ms | .229 / .243 ms |
| Index readiness | 356 / 341 ms | 1,204 / 1,188 ms | 1,172 / 1,203 ms |
| Main database after build | 22.311 MB | 27.640 / 28.017 MB | 28.770 / 28.762 MB |

Native owner postings resolve the measured medium-set failure in both orders, about 22x faster than the
rejected rowid strategy. They remain slower than the legacy shape, which lacks correct list-phrase and
identifier behavior. Point and medium queries are small in absolute time, but this is diagnostic, not
representative app-budget qualification. Owner metadata adds roughly 3% main-file bytes over the preceding
string shape; the whole string shape remains roughly 29% above legacy and takes about 3.4x its readiness
time here. Sampled RSS/WAL/files, binding counts, independent heartbeat and all raw samples are retained.
Sampling misses possible short peaks, and the fixture certifies no filesystem or physical durability.

Broad limited queries are still about 28 ms versus 15 ms: this issue is **not accepted**. Next push only a
semantically safe adjacent text limit/top-k through native ranking before returning/expanding matches;
preserve recency, later filters, multi-type ordering and complete highlights. First verify pipeline correctness
and native returned-row bounds, then preregister the next cost comparison. Do not relax the original latency
budgets or treat this checkpoint as phase 3–7 acceptance. Fuzzy expansion, realistic corpus/languages/vectors,
full app/maintenance and platform qualification remain required.

A separate exact-source Linux run on c132441538 passes **475/475 SQLite EARS**, **288 native baseline cases**
(187 SQLite-only cases skipped in that selection), five normal package builds, EARS types, three API reports,
actual import rules and lint. The earlier focused run supplies **100 cases** and a real native-mask removal
control. Full raw logs and runner are in `checkpoint/`. This establishes a functional checkpoint suitable for
the next exact strict integration gate, not complete adoption or acceptance of the remaining broad regression.
