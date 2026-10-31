# Indexed timestamp-selection cost — 2026-10-29

Preregistered at f426f938f8. All four fresh processes complete materialized / indexed / indexed / materialized,
using exact sources 0f57770e1f and f426f938f8, the identical expanded fixture, two CPUs/6 GiB, OFF commits and
180 seconds each. All expected answers/highlights pass; no retry or discarded sample. Installs preserve
lockfiles and loaded native hashes match. Actual native-plan safeguards are in recency-selection evidence.

| Measurement | Materialized (1 / 4) | Indexed (2 / 3) |
|---|---:|---:|---:|
| Point p50 | 0.136 / 0.130 ms | 0.131 / 0.141 ms |
| Point/common p50 | 0.903 / 0.849 ms | 0.857 / 0.878 ms |
| Reverse point/common p50 | 0.872 / 0.839 ms | 0.868 / 0.838 ms |
| 100-owner/common p50 | 3.279 / 3.397 ms | 3.296 / 3.538 ms |
| Reverse 100-owner p50 | 3.105 / 3.324 ms | 3.345 / 3.257 ms |
| Exclusion p50 | 0.751 / 0.733 ms | 0.738 / 0.737 ms |
| Disjunction p50 | 0.251 / 0.250 ms | 0.246 / 0.245 ms |
| Broad p50 | 16.983 / 16.789 ms | 16.997 / 17.079 ms |
| Broad p99 | 18.168 / 19.982 ms | 18.863 / 18.794 ms |
| Highlights p50 | 18.089 / 17.833 ms | 22.716 / 18.426 ms |
| Highlights p99 | 19.417 / 19.496 ms | 68.259 / 20.314 ms |
| Recency p50 | 27.250 / 27.475 ms | 30.133 / 25.581 ms |
| Recency p99 | 28.634 / 46.514 ms | 60.202 / 27.510 ms |
| Recency highlights p50 | 35.047 / 35.332 ms | 27.705 / 26.992 ms |
| Recency highlights p99 | 48.893 / 44.313 ms | 56.070 / 28.750 ms |
| Name write p50 | 0.241 / 0.219 ms | 0.225 / 0.228 ms |
| Readiness | 1242.9 / 1148.8 ms | 1679.6 / 1185.3 ms |
| Main after build | 28.762 / 28.770 MB | 29.008 / 28.762 MB |
| Peak observed WAL | 4.516 / 4.586 MB | 5.335 / 4.375 MB |
| Sampled peak RSS | 160.398 / 157.070 MiB | 159.078 / 158.027 MiB |

Recency highlights improve consistently ~35 to ~27 ms, about 22%, matching the verified avoidance of
full timestamp materialization during the selected fetch. ID-only recency is mixed: 30.1 / 25.6 ms versus
27.2 / 27.5 ms. Do not claim a consistent ID-only win. One indexed trial also has slower readiness and
ordinary highlights, larger observed WAL/main bytes and broader tails. Those samples remain in the cohort;
no causal attribution to code, GC, I/O or host contention is established by these elapsed measurements.

This remains diagnostic, not production latency/resource acceptance. Typical broad, highlighted and
recency timings still exceed the 16 ms reference; original phase 3/substring targets and failed cohorts
remain unchanged. Representative app/search budgets still require their own recorded flows and matched
native-baseline comparisons. Next prioritize bounded fuzzy search and real relevance/vector/app/operational
requirements; this correction does not close them or justify repeatedly rerunning a failed qualification.
