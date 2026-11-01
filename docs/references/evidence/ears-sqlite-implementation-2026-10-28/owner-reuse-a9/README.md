# Reuse native-filtered owners during canonical reranking

Candidate implementation: `772cbe32df`. Frozen runtime: `a9c9340df74f90b85434e8ddafa9742bd6867cbf`. An alternating scratch SQL wrapper applies only the candidate rerank change on an owned copied updated database. It preserves ANN parameters, durability configuration, planner statistics and the original frozen source/native files. This is not full candidate qualification.

All 144 queries match prior matrix IDs and scores. The original database hash is unchanged. Each variant has 15 timed observations per cohort (three fixed queries over five warm rounds); the first round is retained separately.

| Corpus / scope | Baseline mean ms | Owner reuse mean ms |
| --- | ---: | ---: |
| 1000 / 10% | 7.10 | 7.04 |
| 10000 / 1% | 2.37 | 2.44 |
| 99900 / 100% | 16.17 | 15.91 |
| 99900 / 10% | 42.96 | 37.49 |

The 99.9k/10% cohort improves about 13% in this diagnostic. Its q0 explained final rerank falls from 8.67 to 2.34 ms; earlier eligibility and candidate selection still dominate. Root-query movement and small-scope differences are small. Neither these warm means nor one explained query establish application latency, heartbeat, cold-cache performance or a passed original acceptance gate.

Safety requires native selection and canonical reranking to share the same read snapshot. Ordinary EARS reads own a transaction in `SqliteDatabase.readSync`; writes query their current unit. Native selection applies scope/trash/exclusion before returning owners, and reranking still checks the current type/index/generation/chunks and falls back to exact scoring if underfilled. Three-platform regression checks remain pending.

Compressed raw observations, plans, recipes, input hashes and logs accompany this note; receipts hash original uncompressed bytes.
