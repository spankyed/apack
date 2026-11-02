# Held-out high-dimensional vector diagnostics

Protocol/generator/driver were committed before execution at 7a3a45a4a0022fcaf6e158a779d7f5767570aca1. The exact source archive hash and isolated runner are retained. Disposable Linux used two CPUs/6 GiB/no additional swap, capability dropping, mode-denial preflight, pinned read-only dependency/native seeds and private outputs. Package builds, lint and import checks passed.

The 1k-row smoke ran SQLite then native, both clustered and mixed 1536-dimensional corpora, with 16 held-out queries, k=10, all/10%/1% paths, trashed rows, initial and updated embeddings. Both passed all 384 requests per backend. Independent deterministic cosine sanity checks and coordinate variance checks passed. SQLite recall was 1 everywhere; native clustered/filtered recall was 1, mixed unfiltered initial 0.975 and updated 0.96875. These are synthetic engine results, not real-model or app acceptance.

Unfiltered warm medians: SQLite 4.62–4.66 ms, native 0.53–0.61 ms. 10% medians: SQLite 0.52–0.57 ms, native 0.24 ms. 1% medians: SQLite 0.15–0.16 ms, native 0.10 ms. Publishing 31 changed embeddings took SQLite 3.0–3.2 ms and native 40.7–47.6 ms. This is one process/backend, two distributions, OFF writes; do not infer durable throughput, peak bounds, storage-cold behavior, or causal attribution to ANN maintenance from these samples alone.

The follow-on driver adds per-phase recall summaries, updated ordinals and updated corpus hashes, with no change to generation, query/ground-truth logic or thresholds. Its 10k/100k balanced cohort stops at the first miss and retains partial results. Full representative-app budgets and licensed/attributed real-model data remain required independently.


## First growth miss

Source 9e64045eaf2858d599829819ce45a5e3c89d3ea5 passed package builds, lint and import checks. The first 10k SQLite clustered profile passed all 192 requests with recall=1, candidate/trash constraints and update freshness, but failed the predeclared heartbeat ceiling: p99 57.91 ms >16 ms. Unfiltered warm median/p95 were 53.00/56.72 ms; 10% 5.24/6.45 ms; 1% 0.64/1.03 ms. The provisional query-p95 ceiling passed; the execution strategy still fails because it blocks the shared event loop too long. Initial setup 2.85 s; content/embedding batches 4.57/2.47 ms. All raw samples and partial report are retained.

The runner stopped at that first miss. The mixed 10k profile, native 10k cohort and all 100k trials are UNRUN; do not extrapolate timings or recall, retry unchanged source, or call the balanced cohort complete. No budget was relaxed. This does not resolve the separate admission heartbeat miss or establish full-app/vector qualification.

Next preregistered diagnostic: one fresh 10k clustered SQLite profile, same generator and query vectors, no production change. Capture the actual facade SQL/binding times and EXPLAIN QUERY PLAN. Compare native scalar distance/sort over the same Float32 corpus against sqlite-vec vec0 exact KNN (already pinned, no dependency addition), including all/10%/1% paths and all held-out queries. Verify against independent ground truth, retain first and warm samples and native plans, include derived-index construction/disk cost, and treat these primitive comparisons as causal diagnostics rather than acceptance. Only choose exact packed scanning, quantization or ANN after this evidence. Chunk-to-entity aggregation, tie order, arbitrary candidate/trash scopes, large k/hybrid, generation recovery, authoritative embeddings and index storage duplication must remain explicit in any chosen integration.


## Actual-plan and packed exact counterfactual

At c95de2ed65a4df33e047583732cfa47875420707, package builds/lint/import checks and the committed diagnostic passed. One fresh 10k clustered/1536 profile supplied 576 result-checked requests across the actual facade, a single-chunk scalar query without grouping, vec0 metadata filters and vec0 candidate-rowid filters, plus three observed facade calls before packed-index construction. Every checked result matched independent Float32 cosine ground truth. This is a primitive/plan diagnosis, not a completed growth cohort or application acceptance.

Unfiltered warm medians: facade 52.30 ms; scalar without grouping 37.22 ms; vec0 metadata 30.34 ms; vec0 candidate IDs 31.25 ms. At 10%: facade 5.64 ms, vec0 metadata/candidate IDs 14.30/14.07 ms. At 1%: facade 1.29 ms, vec0 12.54/12.17 ms. Removing grouping is only valid for this one-chunk fixture and cannot be copied into the general entity aggregation contract. Neither packed variant meets the 16 ms event-loop strategy target for unfiltered calls; selective searches regress.

Actual facade unfiltered SQL uses chunk_generation, entity primary-key lookup, and temporary GROUP BY/ORDER BY B-trees. Selective paths use the chunks composite key and json_each candidates, avoiding the GROUP BY temp tree. Retained native plans show vec0 KNN virtual-table access, not a JS fallback. The duplicate packed index took 505.8 ms to build and grew page_count from 21,561 to 37,029 (about 60.4 MiB at 4096 bytes/page). These samples do not isolate a single CPU, allocation or I/O cause, establish cold storage, or justify integration of vec0 unchanged.
