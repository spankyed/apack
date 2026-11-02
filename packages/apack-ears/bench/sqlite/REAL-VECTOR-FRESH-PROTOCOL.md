# Fresh vector validation partition

Frozen after the exploratory integer-membership diagnostic, before evaluating this
partition. The [fresh oracle](../../../../docs/references/evidence/ears-sqlite-implementation-2026-10-28/fresh-vector-oracle/README.md)
now records eighteen cohorts, exclusions and independent scalar checks. Database/model
execution and its acceptance gates remain unqualified. Preserve every earlier failed configuration.

Use the sealed original 99,900-vector Qdrant projection, SHA-256
`07483f2744b8c71fa788884f0f3b268403fd36e4e2303c585e390c973a53ad7f`.
Select 100 new query vectors at zero-based corpus ordinals `499 + 999*j` for
`j=0..99`. These correspond to source rows halfway between the original held-out
queries. Freeze this deterministic selection without inspecting their retrieval results.
Do not put payloads/source IDs into Git or call an embedding provider.

Remove all selected query ordinals from corpus eligibility and model training.
Also exclude every ordinal `i` where `i % 100 == 7` and `(i+31337)%99900` is a selected
query ordinal, so the prescribed update cannot introduce a held-out vector. Use the
same exclusion union in both initial and updated phases. Keep the canonical source
file unchanged; exclusion belongs to fixture metadata and actual query eligibility.
Do not simply evaluate a query against its own stored vector.

Recompute independent Float64 cosine truth over canonical Float32 values, preserving
the original prefixes 1,000/10,000/99,900, 100%/10%/1% scopes, modulo-97 trash,
1% update mapping, K=10 and ascending original ordinal cutoff ties. Record exact
eligible counts, query/exclusion/truth hashes and independent scalar checks. The old
truth files are inapplicable to this new partition and must not be reused.

For the provisional vec1 candidate, freeze 64 buckets, 32 probes, K=256 candidates,
20,000 evenly spaced non-excluded training vectors at most, and one training thread.
Training must exclude fresh query vectors; the previous exploratory model may contain
them and cannot be reused. Exact evaluation applies when the actual eligible chunk
count is at most 4,096 or the existing unsupported-dimension/large-K rules require it.
Eligibility precedes candidate K. Actual EARS integration must retain all-chunk owner
reranking, prior filters/limits/traversals, trash/exclusions, commit visibility,
model/hash freshness and deterministic owner ties. This is a provisional candidate
configuration, not approval to adopt a native fork or change production dependencies.

Use the original two-CPU/6-GiB/no-swap limits, FULL durability, application cache and
private container filesystem. Include first pass separately and three timed passes
over all 100 queries, with raw answers, per-query recall, latency and independent
1 ms heartbeat samples. Each group must retain mean recall >=0.95, heartbeat p99
<=16 ms, and original diagnostic latency limits (100 ms at 10k, 200 ms at 100k).
No threshold changes follow from results. Keep all failures; do not silently retune
this partition and continue calling it fresh validation.

This partition does not replace realistic multi-chunk, hybrid, language/relevance,
streaming/watch/admission, cold/reopen/growth/resource, matched elmdb, platform or
whole-app acceptance. Those remain in the owning goal. Native fork correctness,
allocation failure, sparse-ID behavior and distribution/maintenance must be reviewed
before runtime adoption. No semantic behavior changes are approved by this protocol.
