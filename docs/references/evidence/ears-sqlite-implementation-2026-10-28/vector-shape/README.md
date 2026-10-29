# Held-out high-dimensional vector diagnostics

Protocol/generator/driver were committed before execution at 7a3a45a4a0022fcaf6e158a779d7f5767570aca1. The exact source archive hash and isolated runner are retained. Disposable Linux used two CPUs/6 GiB/no additional swap, capability dropping, mode-denial preflight, pinned read-only dependency/native seeds and private outputs. Package builds, lint and import checks passed.

The 1k-row smoke ran SQLite then native, both clustered and mixed 1536-dimensional corpora, with 16 held-out queries, k=10, all/10%/1% paths, trashed rows, initial and updated embeddings. Both passed all 384 requests per backend. Independent deterministic cosine sanity checks and coordinate variance checks passed. SQLite recall was 1 everywhere; native clustered/filtered recall was 1, mixed unfiltered initial 0.975 and updated 0.96875. These are synthetic engine results, not real-model or app acceptance.

Unfiltered warm medians: SQLite 4.62–4.66 ms, native 0.53–0.61 ms. 10% medians: SQLite 0.52–0.57 ms, native 0.24 ms. 1% medians: SQLite 0.15–0.16 ms, native 0.10 ms. Publishing 31 changed embeddings took SQLite 3.0–3.2 ms and native 40.7–47.6 ms. This is one process/backend, two distributions, OFF writes; do not infer durable throughput, peak bounds, storage-cold behavior, or causal attribution to ANN maintenance from these samples alone.

The follow-on driver adds per-phase recall summaries, updated ordinals and updated corpus hashes, with no change to generation, query/ground-truth logic or thresholds. Its 10k/100k balanced cohort stops at the first miss and retains partial results. Full representative-app budgets and licensed/attributed real-model data remain required independently.
