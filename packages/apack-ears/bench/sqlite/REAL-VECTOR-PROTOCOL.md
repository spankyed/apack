# Real-model vector strategy comparison

This is a native execution decision gate, followed by integration qualification, not an adoption gate.
Freeze this protocol before collecting strategy timings. Keep failing samples and configurations.

Use the sealed private Qdrant projection described in `acquire-real-vectors.py`: 99,900
1536-dimensional corpus vectors and 100 held-out queries. Do not redistribute payloads or source IDs.
The publisher's model label is not independent model provenance. No external model calls are needed.

`real-vector-oracle.py` independently computes Float64 cosine over the canonical stored Float32 values.
It imports neither SQLite nor the candidate extensions. Compare prefixes of 1,000, 10,000 and 99,900
rows. Eligibility is corpus ordinal modulo 100 below 100, 10 or 1 respectively, with rows whose
ordinal modulo 97 is zero treated as trash. This excludes trash before limiting results.
Tie order is ascending corpus ordinal. Return up to ten eligible owners.
The update phase replaces every row whose ordinal modulo 100 equals 7 with the original corpus
vector at `(ordinal + 31337) % 99900`; queries remain held out. Smaller cohorts deliberately include
updates sourced from outside their prefix. This is a vector-only fixture, one chunk per owner.

Compare vec1 flat exact and trained IVF binary quantization against this truth, preserving original
Float32 bytes for exact reranking. Fix IVF at 64 buckets and 16 probes, separately retrieving 256
and 1,024 candidates before exact reranking. Train with one thread on at most 20,000 evenly spaced
corpus rows, never held-out queries. Record training, initial load, update, database/model sizes and
query costs separately. Do not tune on these queries after seeing results. Report unsupported or
insufficient-training configurations explicitly. Retain raw query samples, candidate counts and
answers for every phase/scope/cohort. A flat baseline miss is a correctness failure to investigate.

One capped disposable Linux container at a time: two CPUs, 6 GiB RAM, no swap; read-only source,
corpus and dependency mounts, private result/database paths. Record tool/source/native hashes.
Use one untimed pass followed by three timed passes over all 100 queries, including exact reranking
and eligibility handling. Record first pass separately, latency p50/p95/p99 and an independently
scheduled 1 ms main-thread heartbeat. Scheduling/GC stalls remain in the samples.

Mean recall@10 must be at least 0.95 for each scope/phase/cohort, with per-query distribution retained.
Diagnostic query p95 limits remain 100 ms at 10k and 200 ms at 100k; main-thread heartbeat p99 remains
16 ms. These diagnostic limits do not replace stricter goal requirements or app responsiveness gates.
Primitive success still requires EARS integration and native execution, transactional own-write and
savepoint visibility, filtering before K, multiple chunks/owner aggregation, model freshness,
large K, numerical extremes, bounded background admission and update latency, real application
workloads and every supported platform. Failure does not authorize weakening those requirements.

## Follow-on matrix after initial IVF failures

The original independent-training runs at 1k and 10k missed recall, including broad searches.
Keep those results. Because each invocation trained independently, their candidate-limit differences
are not a controlled comparison of K alone. The follow-on matrix reuses the identical hashed model
within each cohort/family for both candidate limits. Retain the model privately with its training
identity; only hashes and timing receipts enter Git.

Add `scan-bq-256` and `scan-bq-1024`: the same binary quantizer with **zero coarse buckets**, scanning
all compressed vectors before exact reranking. Keep 256/1,024 candidates and all other original
scopes, updates, samples and budgets. This tests whether removing bucket selection restores recall
at acceptable cost. It is a separately identified follow-on, not a replacement for failed IVF results.
Use the same model-reuse control for a fresh IVF comparison. No claim of one model's generality,
training-repeat stability, or EARS integration follows from this matrix.

## Existing sqlite-vec dependency control

Before adding another native dependency, run `vec0-binary-256` and `vec0-binary-1024`
through the same harness, truth, scopes, updates, passes and budgets. Use the already-pinned
sqlite-vec `vec_quantize_binary` and a `vec0` bit[1536] table with scope/active metadata
filters applied before K. Preserve canonical Float32 values in a separate ordinary SQLite
table and rerank retrieved rows with native `vec_distance_cosine`, with owner ordinal as
the deterministic final tie breaker. Query cost includes query quantization, native scan,
canonical lookup, exact reranking and result materialization/sorting. There is no trained
transform. For updates, replace the derived binary row within the same transaction as
the canonical update. Retain load/update/disk/RSS costs and any unsupported behavior.
Metadata filtering in this primitive control does not qualify arbitrary EARS owner-ID
candidate sets, multiple chunks, units, watches or model/generation admission.

Also compare `sql-binary-256` and `sql-binary-1024` using the same dependency and
quantizer with an ordinary derived table. SQLite applies indexed eligibility, orders
by native Hamming distance with an ordinal tie breaker, retains the candidate prefix,
then performs the same native cosine rerank. This isolates whether vec0's additional
virtual-table lifecycle is necessary. Keep every existing budget and input unchanged.

## Application-cache and filesystem control

The earlier primitive harness used SQLite's default 2,000 KiB page cache and kept
temporary databases under the mounted result directory. EARS currently sets
`cache_size=-65536` in `src/sqlite/database.ts`. Large random canonical reranks can
therefore behave differently from that primitive configuration. Do not promote those
primitive timings to app estimates or silently replace their recorded samples.

Before selecting the layout, compare both vec0 and ordinary SQL, both candidate limits,
at 99,900 rows with `EARS_VECTOR_CACHE_KIB=65536` and
`EARS_VECTOR_SCRATCH=/metrics/databases` (a private ordinary container filesystem).
Keep all phases, eligibility, queries, passes, limits and acceptance budgets unchanged.
Record actual cache size and database location; retain earlier results separately.
This is a controlled production-configuration follow-on, not proof of cold storage,
physical durability, main-app performance or arbitrary filesystem behavior.
