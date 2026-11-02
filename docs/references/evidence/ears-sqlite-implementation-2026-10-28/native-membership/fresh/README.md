# Fresh native membership comparison, 2026-10-30

Exact app source `1860dd2eb141fc1d3f3b8b5d3e7b0a7a5f2fe332`, pinned upstream source and
membership patch, sealed corpus and independently verified fresh oracle. Both variants execute
actual EARS/native generations, all eighteen initial/updated cohorts at 1k/10k/99,900, first pass
and three timed passes over all 100 queries. Canonical rows, exclusions and FULL durability are
verified. Two CPUs / 6 GiB / no swap / 64 MiB cache; private ordinary container filesystem.

Both complete; independent verification still **rejects overall acceptance** for the original
budgets. The patched run passes every cohort's mean-recall and query-latency deadline, but query
heartbeat and admission heartbeat still miss 16 ms. No gate or ANN setting is changed.

Initial-phase timed p95 ranges in this run:

| Cohort | Upstream | Membership patch |
| --- | ---: | ---: |
| 10k, broad | 145.10–146.05 ms | 52.64–52.99 ms |
| 99,900, 10% | 152.44–170.91 ms | 63.05–64.41 ms |
| 99,900, broad | 19.21–19.51 ms | 20.13–20.26 ms |

Minimum mean recall over every phase/pass is 0.969 upstream / 0.974 patched. Admission
heartbeat p99 is 20.75 / 30.02 ms; maximum RSS is 1,065,064 / 1,066,812 KiB. This is not
a bounded-total-memory claim. The patch does not eliminate remaining scope/count/rerank work
or move checkpoint work off the foreground connection.

The models have **different recorded hashes**, and execution order is fixed upstream then
patched. These are matched app/input/resource measurements with independent complete model
admission, not randomized paired same-model causal timings. Broad latency and admission do
not improve in this run. The separate 1k smoke passes both gates only for the patched run;
it cannot stand in for the failed full matrix.

Raw answers/times/scores/heartbeat samples are retained as deterministic gzip, with original and
compressed SHA-256 values. All four verification records and explicit nonzero failed-gate exits
remain intact. No vector/model payload or publisher source IDs enter Git. Source, compiler/binary
provenance and commands are retained here. Subsequent builder newline canonicalization leaves
this Linux C source byte-identical; later app code must qualify its own integrated acceptance.

Next: consolidate scope evaluation/reranking, measure native membership's remaining cost and
qualify WAL checkpoint scheduling while preserving FULL commits, bounded growth and explicit
drain. Realistic multi-chunk/hybrid/app and packaging/fault/maintenance gates remain required.
