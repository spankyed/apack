# Managed corpus with the selected scorer at b99

[Run 41315957504](https://github.com/spankyed/apack/actions/runs/41315957504) completes at `b992897bdeb2d82409b11ed4866b124027874aa3`. All 23 preflight safeguards, 1800 independent-reference query cases, recall means (minimum 0.9596875), 100ms/200ms query-p95 limits, three sampled read-only reopen passes per size and private/database scratch cleanup pass. Diagnostic success is not heartbeat acceptance: the same eight groups miss the original 16ms limit (both 10k all-live groups and every 99.9k group).

| 99.9k scope/family | Query p95 ms | Heartbeat p99 ms |
| --- | --- | --- |
| All / lexical | 51.99 | 69.73 |
| All / held-out | 53.44 | 69.99 |
| 1% / lexical | 16.20 | 17.85 |
| 1% / held-out | 16.76 | 17.27 |
| 10% / lexical | 76.32 | 87.78 |
| 10% / held-out | 76.38 | 82.74 |

The actual scorer is vec1_cos_distance, ordinary Scalar artifact `93e2fe6c3752a4ca75e2d733f137bc683ffa8f806ac53fdde2b85cb9f09c3138`, Node 23.11.1/SQLite 3.53.4, AMD EPYC 9V45, under 2 CPU/6GiB/no swap. The preceding e793 run used EPYC 7763 and independently trained models/cache state. Lower observed timings therefore do not establish a causal scorer speedup. Recall/reopen correctness qualifies this source, not the later counter guard. Reopen OS caches remain uncontrolled; process peaks include references, fixture and model work rather than isolated engine allocations.

All 25 frozen English hybrid judgments pass on both engines with one pinned local MiniLM model. Keyword-only remains 24/25 under none/en; no judgment waiver or complete language/provider/UI acceptance follows. Model metadata records 141 truncated inputs of 239 documents/queries at its 256-token cap; this is a narrowly scoped relevance sample.

The actual local qualification recipe accepts all raw reports and reproduces every gate decision and non-mean field. Recomputed mean fields differ by at most 4.441e-16 between local Python 3.9.6 and the recorded Python 3.12.16 environment; original CI reports are retained unchanged. No recall or heartbeat threshold changes.

Fifteen explicitly inspected metadata reports are retained through gzip with original hashes/lengths. They contain numeric samples, plans, counts and model/native hashes; no vectors, corpus text, source IDs, database, private payload or per-document relevance outputs are copied. Acquisition/install logs, duplicate outputs and uninspected trees stay in CI/private download. The source pairing receipt alone certifies acquisition, not query performance; use the hybrid matrix and raw reports for those claims.
