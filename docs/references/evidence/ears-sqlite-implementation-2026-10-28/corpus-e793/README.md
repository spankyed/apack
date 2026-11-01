# Winner formatting preserves correctness; heartbeat remains unmet

[Run 41307020950](https://github.com/spankyed/apack/actions/runs/41307020950), source `e7934fb9af2bf94e60d74e2c128db824dca753cd`, completes the managed/generic corpus diagnostic on AMD EPYC 7763, Node 23.11.1/SQLite 3.53.4, enforced 2 CPU/6GiB/no swap. Actual extension is Scalar. All 23 preflight cases pass, including both hybrid formatting/snapshot witnesses. All 1800 query/reference cases, original ≥0.95 recall means, query-p95 targets, three sampled reopen passes per size and private/database cleanup pass. Hybrid usefulness passes 25/25 on both backends; keyword-only none/en remains 24/25.

| 99.9k scope/family | Query p95 (ms) | Heartbeat p99 (ms) |
| --- | --- | --- |
| all / lexical | 78.92 | 96.06 |
| all / held-out | 61.43 | 94.51 |
| 1% / lexical | 19.38 | 24.17 |
| 1% / held-out | 23.62 | 25.76 |
| 10% / lexical | 106.36 | 119.88 |
| 10% / held-out | 97.37 | 112.33 |

Both 10k all-live groups also fail heartbeat (24.80/22.47ms); narrower 10k scopes pass. All eight prior failing groups remain failing. Deferred formatting is functionally qualified and bounds returned detail rows, but no consistent end-to-end improvement is established. Models train independently and OS cache is uncontrolled; mixed timing changes versus the prior same-CPU-model pair do not establish causality.

Sampled SQL still includes canonical scoring at 10.79–13.13ms, 10% eligibility at 13.59ms and native owner selection at 19.94/39.02ms (all/10%). These diagnostic samples do not isolate kernels or explain full latency distributions. Full strict, actual app/installed, provider/language/model variance and all original budgets remain required.

Retention uses an explicit inspected metadata allowlist: original numeric query/resource/reopen reports, hash/count-only input manifest/qualification, preflight test metadata and aggregate relevance/model receipts. Samples contain query ordinals, counts, overlaps, recalls and timing, with no text, source IDs or vectors; plan details contain schema access paths rather than bound values. Acquisition/install logs and per-document relevance output are excluded from repository retention; original downloaded artifacts remain in private scratch and CI. sha256.json covers exactly the retained bytes. This source predates the replacement cleanup/lint correction.
