# Matched native width tradeoff at 54228d8407

[Actual run 41242646139](https://github.com/spankyed/apack/actions/runs/41242646139/job/124659868709) passes all 1,800 fusion checks and every main per-group mean recall target at K=10/40/64 with the benchmark-only 2,048 candidate floor. Minimum K=64 mean is 0.958125 (99.9k/10%/held-out). Inference payloads are not involved; independent Float64 truth, model identities and actual cleanup are recorded. Query execution runs at 2 CPU/6 GiB/no swap.

Every input also compares production/1,024/2,048 near retrieval against the same ready model and snapshot, rotating variant order by ordinal. The old production target fails K=40/64 on the larger native cohorts. At 10k all-live, K=40 recall improves from 0.929–0.940 to 0.9695–0.97375 with 1,024. At 99.9k/10%, K=64 improves from 0.87125–0.89141 to 0.958125–0.96265625 with 2,048. This supports a candidate-budget change rather than attributing results across different trained models.

It has a real latency cost. At 99.9k all-live, near-query p95 is about 20–21ms for production, 31–34ms for 1,024 and 45–48ms for 2,048. At 10k all-live it is roughly 7ms, 15ms and 25–27ms. Small eligible sets remain exact and have identical recall. These are one warm pass's matched query observations, not repeated model/OS-cold/app variance proof.

Main 2,048-floor hybrid p95 meets 100ms at 10k and 200ms at 99.9k, including 88.92–91.14ms all-live and 184.20–195.08ms in the 10% cohort at 99.9k. Every 99.9k heartbeat group still misses 16ms. The main pass follows comparison/reference reads, so do not compare its timings with prior standalone runs as a controlled speedup. Workflow success is not full responsiveness acceptance.

The ensuing production candidate keeps 256 owners through K=32, uses 1,024 through K=40 and 2,048 through K=64, with admission/fallback/exact routing preserved. That implementation still needs actual current-source qualification; this benchmark's override is not proof of its integration. Readiness, update/trash, duplicate owners, model variance and full app/resource gates remain required.

`matrix.json` and inspected `numeric-samples.json.gz` retain both main and all matched variant outcomes, without text, source IDs, vectors or model weights. `summary.json` retains conditions, model/oracle identity, cleanup and original report digests. Full originals remain in CI/private local evidence.
