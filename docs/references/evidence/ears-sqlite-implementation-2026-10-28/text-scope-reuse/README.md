# Share a multi-clause text candidate prefix

The c802 corpus profile identifies repeated scoped membership work in the final FTS statement as one foreground cost. The candidate now exposes a request-owned candidate prefix once as a materialized SQL CTE for multi-clause statements. Each clause keeps its original membership check; single-clause queries and the bounded second highlight statement retain their direct path. No candidates are returned to JavaScript, and ranking, exclusions, limits and snapshot ownership are unchanged.

Run from the repository root:

```sh
node docs/references/evidence/ears-sqlite-implementation-2026-10-28/text-scope-reuse/control.mjs
```

The control executes actual generated old (`958bf780b7`) and proposed SQL through Python SQLite 3.51.0 in a disposable directory. Eighteen cases per variant retain exactly equal answers, scores, terms and highlights across AND/OR/negative clauses, field and phrase queries, prefix completion, duplicate/missing candidate IDs, empty/global scope and bounded hit/ID results. A nondeterministic observer records 52 candidate visits before versus 26 after for two clauses, including the separate bounded highlight fetch. The old implementation is a negative control for the new exact evaluation-count requirement. The SQL fixture and file are removed in finally.

This is correctness and repeated-work evidence, not Node-driver qualification, production-provider relevance, an end-to-end latency result or proof that the 16ms heartbeat budget is met. Materialization adds SQLite scratch work; its time, memory and spill behavior must be measured on representative prefixes before accepting this as a performance improvement. Current actual-driver regression and corpus remeasurement remain pending. No search judgment or resource budget changes.
