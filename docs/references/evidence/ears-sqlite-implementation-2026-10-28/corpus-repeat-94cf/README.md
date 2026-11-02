# Independent ordinary managed corpus repetition

[Run 41413055256](https://github.com/spankyed/apack/actions/runs/41413055256), source `94cf2eeac6208c6022865b5d7e5bf513935a6080`, succeeds with the ordinary packaged Scalar artifact, managed models and production candidate policy. All 1,800 queries/18 scope-family-size groups pass original mean recall at depths 10/40/64 (minimum 0.95203125 against 0.95), and every original query-p95 limit passes. Eight groups still miss 16 ms heartbeat, retained as failures with the user's accepted responsiveness-degradation disposition.

| 99.9k scope | Query p95 ms, lexical / held-out | Heartbeat p99 ms, lexical / held-out |
| --- | ---: | ---: |
| All live | 72.80 / 61.29 | 101.75 / 84.72 |
| Candidate 1% | 18.06 / 20.96 | 23.33 / 21.75 |
| Candidate 10% | 107.88 / 105.59 | 134.90 / 113.58 |

The [comparison](comparison.json) validates both runs with the maintained hybrid validator and matches all six sealed corpus file sizes/hashes, acquisition recipe and production policy. Native extension, Node binary and worker hashes match the [earlier ordinary run](../corpus-b989/README.md); the CPU model label also matches. Both native model hashes differ. Minimum mean recall moves from 0.95671875 to 0.95203125; the latter is held-out/candidate-10% recall at 64. Query timings are higher in this repetition. These are two observed outcomes, not a distribution or stable tail guarantee.

The query dependency correction is the only shipped-source difference from the earlier run. Independent runner/cache/scheduling/training differences remain uncontrolled. Oracle report hashes differ and are retained explicitly; the corpus bytes and oracle recipe match, and both runs independently validate their canonical Float32/Float64 references. No reference-report byte identity, isolated model effect, causal speedup or matched elmdb comparison is claimed. Recomputed aggregate means may differ from original receipts by floating-point roundoff; original reports are retained unchanged.

At 99.9k, load/admission take 75.11/46.56 s. The largest recorded main/WAL/shared-memory total is 1,939,336,216 logical bytes; process high-water RSS reaches 1,523,220 KiB including fixture/reference/harness data. These are sampled disk totals and whole-process memory, not instantaneous peak disk or isolated database memory. Both larger native models reach ready; 1k uses exact fallback. Three reopen passes per size reproduce warm answers, not verified cold reads. All 29 safeguards, corpus pairing and private scratch cleanup pass.

Ten original numeric/metadata reports are gzip-preserved with decompressed SHA-256. The comparison recipe and minimized receipt are included; the recipe rejects incompatible payload/policy identities before comparing outcomes. To reproduce after decompressing the repeat reports into a private directory, run `python3 compare.py --repeat /path/to/reports --output /path/to/new-comparison.json` from this repository. No text, vectors, source IDs, models, database files or raw installation/acquisition logs are published. The [separate relevance replay](../relevance-94cf/README.md) remains hybrid 25/25 and keyword 24/25 on each backend; this corpus success does not waive keyword acceptance or close all remaining qualification.
