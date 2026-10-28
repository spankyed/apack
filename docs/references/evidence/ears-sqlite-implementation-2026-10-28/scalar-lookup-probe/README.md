# Actual scalar lookup probe, 2026-10-28

One distinct diagnostic on functional source ac84b7d3fb through local checkpoint d422a9449c. It owns a fresh
100k primary profile matching the short-string/payload seed, without watches, background indexing or retirement.
Source hashes include the exact standalone harness. Two-core / 6 GiB disposable Linux arm64, Node 23.11.1 and
SQLite 3.53.4; pinned native/dependency inputs match the cleanup diagnostic. No production or daily profile is opened.

Capture the actual statements from `query('Row').where('slug', 'bucket-7-value').limit(10).ids()` and their real
EXPLAIN QUERY PLAN output. Compare the full facade against its exact generated terminal SELECT through the driver,
including native result mapping to ids. Alternate order in twenty pairs of 25-call blocks, 500 samples per mode.
Every answer must equal the known first ten ids. A separate 1,000-call facade CPU profile follows, with 1 ms
sampling; that profiled pass is excluded from latency samples. No index or hand-optimized SQL substitutes for the
actual terminal selection. This is a diagnostic, not app or admission qualification.

| Path | Median | p99 | Maximum |
|---|---:|---:|---:|
| EARS facade | 1.335 ms | 17.82 ms | 94.41 ms |
| Its generated SQL | 1.225 ms | 14.34 ms | 53.66 ms |

The native statement accounts for most of this query's median cost even without background work. The dominant
CPU-profile leaf has 1,092 of 1,176 samples and is an anonymous native call directly under the SQLite driver's
`all` method. This supports investigating the generated lookup itself before watch/batch tuning. It does not
separate SQLite VM work from binding execution/marshalling or establish the cause of all latency outliers.

The plan streams from `entity_type(type,trashed)`, then repeats an entity-id lookup, correlated constant-row
probe, scalar-cell lookup with an overflow left join and a separate list-membership lookup for rejected scalar
candidates. No temporary ORDER BY tree appears in the captured plan. The limit stays in SQL, but the generic
mixed scalar/list representation introduces several native probes per candidate. Preserve unchecked import,
array membership, null/missing, overflow, mixed-type and pipeline semantics when considering simplification;
declared scalar types alone cannot justify skipping actual unchecked array values.

Next compare targeted native predicate variants on this exact representation, then implement only a measured
improvement with independent mixed-value tests, actual access-plan guards and a negative control. Keep the
original admission workload/budgets and failed samples intact. These data do not prove the candidate meets the
16 ms original workload target or settle large fields, FULL durability, app integration or adoption.
