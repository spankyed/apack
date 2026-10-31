# Leiden integration and exhaustive graph checks

Source `240d3193ea` plus the accompanying Leiden and graph changes passes full EARS typechecking and all 98 cases across relation, graph-algorithm, shared query, query-cost and storage-port suites. No cases are filtered or skipped in that run. Component tests compare all 4096 four-node directed graphs with an independent transitive-closure oracle and handle a 20,000-node chain/cycle iteratively. PageRank reuses its two work buffers across rounds.

## Dependency decision

The candidate pins MIT `leiden-ts@0.1.0`, without runtime dependencies. Official npm metadata/integrity and the exact published implementation were inspected before selection. The implementation contains local moving, refinement and aggregation; this is genuine Leiden rather than a Louvain alias. A separate networkless disposable probe checks 500 seeded weighted graphs (including disconnected inputs, resolution zero and self-loops), requiring repeatable assignments, internally connected communities and finite modularity. All pass. This probe is not a modularity-quality benchmark, a proof of the implementation, or evidence of long-term package maturity. The package is a new 0.1.0 dependency; upgrade/maintenance and representative graph-quality/performance review remain acceptance work.

The SQLite adapter aggregates parallel and opposite directed edges into their undirected weight, permits unchecked self-loops, defaults to seed zero, validates unsigned seeds and finite nonnegative resolution, and returns groups in the documented size/encounter order. Resolution zero uses connected components. Empty and edgeless inputs remain defined. The library's deterministic partition need not match another Leiden implementation's choices; comparative quality and user-visible behavior still require review.

## Evidence boundaries

All candidate execution uses read-only source and exact integrity-verified dependency overlays over frozen a9 dependencies, with fresh fixture stores. The dependency probe uses no database volume. Reports retain source hashes and commands; no original benchmark database is touched. These results do not qualify native d33f859 binaries, supported installed runtimes, graph memory/latency under realistic load, or the remaining original goal gates. API generation is recorded separately when complete.

Compressed raw results, probe/runner scripts and package metadata have uncompressed-byte hash receipts. Official package/source: https://registry.npmjs.org/leiden-ts/0.1.0 and https://github.com/crodesrepos/leiden-ts .

The first disposable API-generation attempt emits declarations but refuses report generation because the frozen published-package builds are stale. That refusal is retained; no freshness guard is bypassed. The explicit `sqlite-api` CI suite rebuilds matching packages before updating and checking reports, and retains the report diff for review.
