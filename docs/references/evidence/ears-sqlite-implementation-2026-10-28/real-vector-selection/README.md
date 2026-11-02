# Real-vector fixture reconnaissance — 2026-10-29

This is metadata reconnaissance, not an acquired/approved fixture or vector qualification. The shipped
manifest (`packages/default-setup/apack.json`) declares `openai:text-embedding-3-small`, dimensions 1536.
The current engine tests use three-dimensional hand-authored vectors; they do not qualify that workload.
SQLite's current near path in `src/sqlite/search.ts` uses native cosine distance, entity aggregation,
candidate/trash filtering and a ranked limit. Real size/dimension/update/resource costs remain unmeasured.

Qdrant publishes a [100k DBpedia dataset with that model/dimension](https://huggingface.co/datasets/Qdrant/dbpedia-entities-openai3-text-embedding-3-small-1536-100K).
Public API metadata was fetched once, without credentials, and is retained as huggingface-metadata.json.
Its pinned repository revision is **0d5fd00fbc5a9c0c836d70cd409f7e461255e572**. The metadata lists four
Parquet shards totaling about 1.65 GB. **Select `text-embedding-3-small-1536-embedding`, not `openai`:**
the former is a float64 sequence, while the separate older `openai` field is float32. Combined text and
source IDs are available to tie input content to vectors. No payload was downloaded, embedding API called,
user key accessed or private data uploaded. The card declares no license; resolve upstream dataset
provenance/permitted use before publishing or redistributing a subset.

Next choose a bounded acquisition/projection recipe on pinned source, preserve checksums/attribution,
and preregister recall/latency/resource targets before timing. Stream row groups/batches rather than
materialize both embedding columns as Python/JS number lists. Preserve stored Float32 conversion in
independent exact ground truth, hold query rows out of the corpus, and cover candidate selectivity,
trash, multiple chunks, updates and model/hash freshness independently of the search strategy.
Combine the real-model fixture with genuinely high-dimensional clustered/mixed synthetic corpora;
do not substitute the existing low-rank sine fixture or self-neighbor lookups for recall qualification.
