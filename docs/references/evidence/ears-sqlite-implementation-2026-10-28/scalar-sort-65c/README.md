# Keyed single-type scalar ordering

Implementation: `65caaa962d`. Baseline source `a9c9340df7`; fixed diagnostic mounts only current numeric-order source and query-cost tests over the same frozen dependencies. Two CPUs/6 GiB/no swap/network, fresh synthetic stores with syncs disabled. This isolates query execution; it is not write/durability or full candidate qualification.

The original composite field-source LEFT JOIN materializes every type value and then performs SCAN f LEFT-JOIN for each candidate: quadratic work. The single-type path now probes the authoritative table and overflow cells by entity primary key. Validation and existing decoder fallback still apply; mixed-type execution is unchanged.

| Entities | Baseline query ms | Fixed query ms | Baseline sort ms | Fixed sort ms |
| --- | ---: | ---: | ---: | ---: |
| 1000 | 30.36 | 15.36 | 10.35 | 0.38 |
| 5000 | 267.79 | 12.12 | 253.01 | 1.75 |
| 20000 | 4075.43 | 48.50 | 4022.27 | 7.98 |

Each size has one measured query with statement-level EXPLAIN instrumentation included in total query time. These are diagnostic observations, not repeated warm/cold distributions or updated app/watch acceptance. Result counts and ascending rank values are verified. The full ordering-cost suite passes 20 actual tests, including inline/overflow keyed plans, mixed scalar kinds, stable ties, signed zero, corruption, missing primary values, cross-type stray rows, rounding and fallback semantics.

The first focused run failed an overly specific overflow plan assertion: the final sort legitimately omits an unused primary-table join after separate validation. The corrected assertion verifies the actual overflow keyed lookup. No semantics or budget was weakened. The original uninstrumented watch workload still needs remeasurement.

Raw plans, timings, test output, input hashes and reproduction scripts accompany this note; receipts hash uncompressed bytes.
