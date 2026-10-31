# Native recency cost — 2026-10-29

Preregistered at 0f57770e1f. All four fresh processes complete sequence / recency / recency / sequence,
using exact sources 2d0bdcbde9 and 0f57770e1f with the identical expanded fixture, two CPUs/6 GiB, OFF
commits and 180 seconds each. Both controls receive 50 recency-highlight reads plus every preceding case.
Every answer and complete highlight passes; all samples are retained, with no retry or budget change.
Loaded native hashes match and installs preserve lockfiles. Fixture syntax and current root lint pass.

| Measurement | Sequence (1 / 4) | Native recency (2 / 3) |
|---|---:|---:|
| Point p50 | 0.139 / 0.143 ms | 0.136 / 0.132 ms |
| Point/common p50 | 0.854 / 0.850 ms | 0.873 / 0.856 ms |
| Reverse point/common p50 | 0.848 / 0.847 ms | 0.856 / 0.833 ms |
| 100-owner/common p50 | 3.294 / 3.261 ms | 3.255 / 3.279 ms |
| Reverse 100-owner p50 | 3.360 / 3.200 ms | 3.232 / 3.377 ms |
| Exclusion p50 | 0.750 / 0.749 ms | 0.745 / 0.743 ms |
| Disjunction p50 | 0.279 / 0.239 ms | 0.248 / 0.243 ms |
| Broad p50 | 17.887 / 16.920 ms | 17.023 / 17.185 ms |
| Broad p99 | 34.108 / 19.140 ms | 18.182 / 18.307 ms |
| Highlights p50 | 18.949 / 18.383 ms | 18.675 / 18.354 ms |
| Highlights p99 | 29.120 / 19.777 ms | 43.580 / 19.780 ms |
| Recency p50 | 46.701 / 46.233 ms | 27.750 / 27.723 ms |
| Recency p99 | 62.671 / 72.044 ms | 28.982 / 29.376 ms |
| Recency highlights p50 | 80.492 / 80.098 ms | 35.013 / 34.655 ms |
| Recency highlights p99 | 101.985 / 119.059 ms | 37.157 / 36.201 ms |
| Name write p50 | 0.234 / 0.240 ms | 0.222 / 0.231 ms |

Recency improves about 40% (~46 to ~28 ms); recency highlights improve about 57% (~80 to ~35 ms).
Other query/write medians remain close. Main-file bytes are identical at 28,762,112 after build and
29,253,632 after updates. Sampled RSS peaks drop from ~263–280 MB to ~167–169 MB in these processes,
but this is not a memory bound. Raw heartbeat, file/WAL/RSS and binding measurements are retained.

After all timed processes, capping base scores before decay makes the unit-recency regression fail with
Row-0 instead of Row-15. The positive native-hydration control is in adjacent native-recency evidence.
This proves the cutoff cannot move ahead of recency, not that query work is globally bounded.

The new p99 values still exceed 16 ms. All prior failed cohorts, phase 3 100k/FULL qualification, fuzzy
vocabulary bounding, larger relevance/languages/vectors and complete app/packaging acceptance remain open.
Next capture the changed native field/ranking plan (including recency highlights) before choosing another
optimization. Do not assume a materialization or I/O cause from elapsed time alone.
