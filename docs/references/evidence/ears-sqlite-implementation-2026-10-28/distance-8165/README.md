# Existing cosine-function diagnostic at 8165

[Run 41311956964](https://github.com/spankyed/apack/actions/runs/41311956964) passes at `8165db1caf4a53a60e59bed7bc6650c08204adc1`. The synthetic diagnostic uses Linux/x64, AMD EPYC 7763, Node 23.11.1, SQLite 3.53.4, sqlite-vec v0.1.9 and exact cgroup limits of 2 CPUs, 6GiB memory, no swap. One fresh process per artifact performs matched SQL scan/sort queries, alternates function order and retains all 80 timings per function/fixture after warmup. Input hashes match. Fixture creation and Float64 reference/checking are outside measured calls.

| vec1 build | Rows × dimensions | sqlite-vec cosine p95 ms | vec1 cosine p95 ms | Ratio |
| --- | --- | --- | --- | --- |
| Generic Scalar | 1024 × 256 | 0.5703 | 0.4732 | 1.205 |
| Generic Scalar | 4096 × 1536 | 10.1272 | 8.5732 | 1.181 |
| Dispatch AVX2 | 1024 × 256 | 0.5667 | 0.2684 | 2.112 |
| Dispatch AVX2 | 4096 × 1536 | 10.1268 | 3.5396 | 2.861 |

Returned scores differ from independent Float64 cosine by at most 1.768e-7 across both functions/builds; both boundary membership checks pass. Plans are the same scan plus temporary sort. This is a useful existing-function optimization lead, not EARS, ANN, joins, eligibility, body formatting, real-corpus recall, process variance, cold storage or application acceptance. No production SQL or build is changed. AVX2 is still a diagnostic artifact, not the ordinary packaged build. A single process per artifact cannot establish general speed ratios.

Same-run upstream membership, bidirectional persisted-model and actual training-worker/checkpoint checks pass. The retained actual-driver training reports have nine passing cases and no skips each; this does not cover all concurrency/fault/resource regimes. Their original richer reports remain in CI/private download rather than copying native libraries or uninspected trees.

Before choosing a production scorer, qualify small/odd dimensions, magnitude extremes, cancellation/ties and supported platforms, preserve fallback stores without vec1, then measure full EARS queries and unchanged relevance/recall/heartbeat requirements. Connection-owned native extension loading is optional (`SqliteDatabase.nativeVectorExtension`); changing every SQL call to vec1 unconditionally would break supported fallback execution. Existing extreme-magnitude normalization and canonical byte ownership must remain intact.

The five explicitly inspected reports named in files.json are retained byte-for-byte through gzip with original hashes/lengths. They contain synthetic numeric samples, SQL plans, source/native hashes, build/runtime metadata and fixture test outcomes; no input vectors, database or private corpus payload is retained.
