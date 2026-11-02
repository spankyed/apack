# Full managed corpus on the 64-bucket policy

[Run 41503539981](https://github.com/spankyed/apack/actions/runs/41503539981) succeeds at `93ed37e67f40faee3fd25a10f3b897c15e55c858` with ordinary packaged native execution, managed models, production candidate policy and unchanged 2 CPU/6 GiB/no-swap limits. All **1,800 queries/18 groups** meet the original recall and size-specific query-p95 targets. Minimum mean recall across K=10/40/64, scopes and families is **0.988**, above 0.95. All 29 routing/replacement safeguards pass without exclusions, three reopen checks per size pass, and full private text/vector/identity pairing and cleanup succeed. Reopens are not cold-device tests.

At 99,900 documents:

| Candidate scope | Lexical-control p95 | Held-out-title p95 |
| --- | ---: | ---: |
| All live | 88.62 ms | 77.18 ms |
| 1 percent | 18.65 ms | 20.56 ms |
| 10 percent | 111.22 ms | 101.27 ms |

Eight heartbeat groups miss 16 ms. These remain original measured failures with the user's accepted synchronous-responsiveness degradation. Load takes 67.23 s and managed admission 46.65 s; maximum sampled database/WAL/sidecar bytes are 1,972,178,976. Whole-harness peak RSS is 1,523,708 KiB, including reference/query/harness work; it is not isolated storage memory or an OS-page-cache total. File snapshots do not establish instantaneous peaks.

The maintained pure validator independently recomputes all samples and gates. The receipt records any summary-mean rounding differences; all other fields agree. Sealed corpus identities and acquisition recipe match the preceding qualified corpus. The earlier [failed 32-probe model](../final-3fea/README.md) remains a failure and is not overwritten. This fresh model/runner is not a matched causal before/after comparison.

After main timings, the report also evaluates 8/16/32/64 probes on the same model/query/filter for twenty selected queries per large cohort, with rotated order. The receipt summarizes 32 versus 64: it supports investigating coarse-probe loss and cost without pretending that this subset is the full recall gate. Every bucket is considered before bounded binary candidate selection; binary approximation and exact owner reranking remain, so no universal recall guarantee is claimed.

Ten original numeric/provenance reports are gzip-preserved with decompressed SHA-256; no corpus text, vectors, source identities, profiles or raw logs are published. The [parallel relevance job](../relevance-93ed/README.md) passes both SQLite keyword modes 25/25, 125 contracts, four effective controls and hybrid 25/25 per engine. Whole strict/platform run 41503546216 remains a separate unfinished gate.
