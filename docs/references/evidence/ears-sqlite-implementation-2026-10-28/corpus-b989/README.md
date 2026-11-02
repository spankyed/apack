# Current-runtime ordinary managed corpus

[Run 41382184193](https://github.com/spankyed/apack/actions/runs/41382184193), source `b9896d520504ce37cfe38f1571474dd920ff527b`, succeeds with the ordinary packaged generic Scalar extension and production candidate policy, no promotion/override. Actual EARS warm hybrid execution verifies 1,800 queries across 1k/10k/99.9k owners, three eligibility scopes and two query families. Every mean recall at depths 10/40/64 passes the original 0.95 independent Float64/canonical-Float32 reference target; the minimum is 0.95671875. All original 100 ms/10k and 200 ms/99.9k query-p95 limits pass.

| 99.9k scope | Query p95 ms, lexical / held-out | Heartbeat p99 ms, lexical / held-out |
| --- | ---: | ---: |
| All live | 69.27 / 57.02 | 89.73 / 81.56 |
| Candidate 1% | 15.74 / 18.31 | 20.48 / 21.24 |
| Candidate 10% | 93.80 / 91.77 | 107.64 / 98.64 |

Eight groups still miss the original 16 ms heartbeat target. These are preserved measured failures with the user's accepted synchronous-responsiveness degradation disposition, not passing responsiveness results. Workflow success represents diagnostic completion/recall, not complete candidate acceptance. This is not a matched elmdb run, controlled model variance or an engine speedup claim.

The AMD EPYC 7763 runner records two CPUs/6 GiB/no swap, SQLite FULL, Node 23.11.1/SQLite 3.53.4 and actual foreground/worker/native fingerprints. The 10k and 99.9k native models reach ready; 1k deliberately uses the normal exact fallback. At 99.9k, load is 68.96 s and native admission 42.52 s, recorded separately. Main/WAL/shared memory total 1,939,233,816 logical bytes at the recorded snapshots. The process high-water maxRSS reaches 1,571,764 KiB after diagnostics; it includes fixture/reference/harness data and is not isolated database memory. Snapshot disk totals are not instantaneous peak bounds. Three reopen passes per cohort reproduce warm answers; they are not verified cold-file trials.

All 29 focused safeguards pass without exclusions. Full pinned source/vector/text/identity pairing passes, and private corpus/database scratch cleanup is verified. Ten original numeric/metadata reports are compressed unchanged with decompressed SHA-256; the unchanged maintained hybrid validator revalidates all groups and acceptance outcomes. Local aggregate recomputation differs only in floating-point mean roundoff (maximum 4.45e-16); original report bytes and their hashes remain unchanged. No corpus text, vectors, source IDs, raw install/acquisition logs, models or database files are published. This closes the current-query-runtime ordinary corpus replay, not the frozen keyword miss, generalized model/provider/language/UI coverage, physical/device qualification or every adoption gate.
