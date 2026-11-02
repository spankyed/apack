# Real corpus after the text ranking and audited-content correction

[Run 41481261106](https://github.com/spankyed/apack/actions/runs/41481261106), source `c28f067c96ffc8bbf1f3ff01a7fb158ed37b71e8`, succeeds with ordinary packaged Scalar execution, managed models, production candidate policy and the unchanged 2 CPU/6 GiB/no-swap envelope. This source differs from focused passing `7ffa2a7ca5` only in documentation. All 1,800 query executions across 18 size/scope/family groups pass unchanged recall/query-p95 gates. Minimum mean vector recall is 0.959375, above 0.95. All 29 routing/replacement safeguards pass without exclusions; all three reopen checks per size pass. Reopens are not cold-device measurements.

At 99,900 documents:

| Candidate scope | Lexical-control p95 | Held-out-title p95 |
| --- | ---: | ---: |
| All live | 89.13 ms | 77.65 ms |
| 1 percent | 21.05 ms | 24.19 ms |
| 10 percent | 114.76 ms | 107.83 ms |

Nine heartbeat groups miss the original 16 ms target. They remain measured failures with the user's accepted synchronous responsiveness degradation, not passing targets. At 99,900 rows, load is 76.56 s and managed admission 46.21 s. Maximum sampled database/WAL/sidecar bytes are 1,971,839,008. Whole-harness peak RSS is 1,494,368 KiB; this includes corpus loading/reference-oracle/query work and is not isolated database memory. File snapshots are not instantaneous disk peaks.

The unchanged pure validator independently checks every sample, pairing/provenance and original target. Its local recomputation differs from the CI summary only in ten floating-point means by at most 4.44e-16; all other fields and gate outcomes agree. Byte identity is not claimed. The receipt lists every rounding difference. All sealed corpus file identities and acquisition recipe match the preceding 94cf run; native model/runner/source differences preclude causal performance claims. No new corpus data is selected for these results.

Full private text/vector/identity pairing and cleanup pass. Ten original numeric reports/provenance files are gzip-preserved with decompressed SHA-256; no text, embeddings, source identities, profiles or raw logs are preserved here. The parallel relevance job also succeeds (both SQLite keyword configurations 25/25, 125 contracts, four effective controls and hybrid 25/25 per engine). Final lint/obsolete-fixture correction `a8500818f6` has its own pending strict/platform run; this earlier-source performance receipt does not pretend to execute it. The experiment remains open for full affected-source qualification.
