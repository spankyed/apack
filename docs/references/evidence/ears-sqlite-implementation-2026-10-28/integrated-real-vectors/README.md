# Integrated real-vector qualification and query-plan repair

Baseline benchmark source `b0cf8c523c`; scoped plan diagnostic `f8d2e64609`; repaired runtime and benchmark `a4a49fba10`. Disposable Linux ARM64, 2 CPUs/6 GiB/no swap/all capabilities dropped; actual mode-denial and exact dependency versions verified. FULL writes, 64 MiB SQLite cache, private container databases. The corpus is the pinned private 99,900 × 1536D projection plus 100 held-out queries. Canonical bytes verify across all owners both before and after 1% updates. Payloads/source IDs remain outside Git.

Both full matrices complete all 18 size/scope/phase groups, retaining the first pass and all three timed passes. Every sampled mean recall is at least 0.999. Neither matrix passes all original responsiveness gates. The 1k smoke separately completes. The fixture includes one chunk per owner and synthetic titles; it does not qualify app language relevance, realistic multi-chunk performance, hybrid/watch load, cold storage or full app acceptance.

Initial 100k phase, 300 timed queries per row:

| Source | Scope | Mean recall | Query p95 ms | Heartbeat p99 ms |
|---|---:|---:|---:|---:|
| baseline | 100% | 1.000 | 304.41 | 311.68 |
| baseline | 10% | 1.000 | 47.34 | 49.13 |
| baseline | 1% | 1.000 | 11.99 | 13.01 |
| plan-fixed | 100% | 1.000 | 55.63 | 58.37 |
| plan-fixed | 10% | 1.000 | 35.29 | 41.92 |
| plan-fixed | 1% | 1.000 | 13.31 | 14.68 |

The original query materialized candidate owners but looked up canonical vector rows across the eligible generation before joining them. A separate warmed counterfactual also took about 208 ms for reranking; plans show canonical lookup before candidate membership. Candidate-only work was about 62 ms. These diagnostic stage costs include different cache states and are not an independent decomposition of the uninstrumented samples.

The repair makes candidate membership an explicit chunk-index constraint and bounds the exact/approximate eligibility decision at 4,097 rows. All 606 SQLite EARS and 135 affected host/storage cases, builds, types/API, lint/import checks pass. Reverting the owner plan or removing the count limit fails the intended new guards. The earlier scalar-call bound alone could not detect unnecessary canonical BLOB reads. Raw plans, wall/CPU costs and successful/negative check receipts are retained.

Baseline load: create 12.32 s, embeddings 29.16 s, 1% vector update 0.50 s. Baseline process max RSS is 1,012,180 KiB and includes the fixture’s 614 MB input buffer; it is not app working-set memory. Data file is 895,709,184 bytes, WAL 10,563,712 bytes after these sampled workloads. No general sustained growth, durability, cold-load or memory guarantee follows.

Setup failures are retained separately and precede any database work: the raw seed resolved Ajv 6 instead of EARS’s lockfile Ajv 8.20; a metadata probe used sqlite-vec’s unexported package.json subpath; the corrected probe then detected the stale seed. The final disposable setup makes its own dependency copy, reconciles npm with scripts disabled, proves the tracked lockfile unchanged and records exact versions/native hashes. No production dependency or assertion changed to resolve setup.

Still open: broad and 10% responsiveness, tighter integrated plans and owner scope handling, native execution/admission ownership, representative search/vector/hybrid/relevance/update/resource work, matched current elmdb comparison, all remaining goal phases 3–7 and final architecture/adoption review. No newer full Strict or adoption is claimed.

## Owner-only rerank follow-on

Source `f8a5706b1e` retains only candidate-owner membership and type/index/generation for outer reranking. Owner eligibility has already been evaluated in the same request snapshot. All 606 SQLite EARS/135 host cases, builds, types/API, lint/imports and three negative plan/probe/outer-scope controls pass. The complete unchanged matrix and canonical-byte checks pass; all sampled mean recalls remain at least 0.999.

| Phase | 100k scope | Mean recall | Query p95 ms | Heartbeat p99 ms |
|---|---:|---:|---:|---:|
| initial | 100% | 1.000 | 85.33 | 127.92 |
| initial | 10% | 1.000 | 28.86 | 30.36 |
| initial | 1% | 1.000 | 13.32 | 17.76 |
| updated | 100% | 1.000 | 61.97 | 68.10 |
| updated | 10% | 0.999 | 29.18 | 30.70 |
| updated | 1% | 1.000 | 13.67 | 14.81 |

Selective 10% cost falls modestly, while broad tails vary and still fail responsiveness. The broad initial median per timed pass is 56–60 ms with worse tails in passes two/three; no causal attribution of those tails is established. Do not claim a universal speedup or discard slower samples. Next remove native-to-JavaScript-to-native candidate-scope materialization and qualify filter/limit/traversal semantics and performance. All original failed budgets and remaining goal requirements stay open.

## Native owner scope follow-on

Source `d28c296edb` passes request-owned SQL entity scopes directly to vector selection. Public synchronous EARS contracts stay unchanged. Filters, earlier limits, outgoing/recursive graph traversal and like are covered by a new shared contract, passing on both SQLite and pinned elmdb. All 607 SQLite EARS and 135 affected host/storage cases, build/type/API/lint/import checks pass. Four negative controls include restoring the JavaScript ID roundtrip, which fails the new bounded-materialization guard.

The full matrix retains all 18 scope/phase/cohort groups and byte checks. Mean recall remains at least 0.999, but the responsiveness gate still fails. Native scope ownership removes allocations/transport; it does not remove the linear binary scan or establish a material latency win in every group.

| Phase | 100k scope | Recall | Query p95 ms | Heartbeat p99 ms |
|---|---:|---:|---:|---:|
| initial | 100% | 1.000 | 61.14 | 64.32 |
| initial | 10% | 1.000 | 28.55 | 37.02 |
| initial | 1% | 1.000 | 12.56 | 14.39 |
| updated | 100% | 1.000 | 59.84 | 64.52 |
| updated | 10% | 0.999 | 28.16 | 30.16 |
| updated | 1% | 1.000 | 12.59 | 13.83 |

Next evaluate native ANN transaction/filter compatibility independently before changing dependencies. Keep the current correct native SQL path and all failed budgets explicit. Native scope predicates can be evaluated for both threshold probing and selection; expensive compound predicates and app workloads still require qualification. No native/full Strict green, dependency adoption or overall performance acceptance follows.
