# Batched distinct/grouping and native key semantics

Implementation `11d37821bc`, corrected contract `2584617f8c`. A disposable Linux arm64 container with two CPUs/6 GiB/no swap/network mounts all changed EARS source/test inputs read-only over verified frozen `a9` dependencies. Full EARS typecheck passes. Shared query contracts pass 29 actual cases against the pinned elmdb backend and 29 against SQLite; SQLite additionally passes all 22 query-cost cases (51 total), without deselections.

Distinct/grouping formerly hydrated one full row per selected entity and searched growing arrays of previous keys. They now batch only the requested field, preserve encounter order and use a Map for scalar keys. Identifier-only distinct uses Set. Every decoded object/array/date is a unique query key, matching the pinned native backend and JS Map/Set rather than deep value equality; null and missing share a scalar key. Thus lookup/group assembly is linear in selected rows, excluding field decoding/output size, and avoids the old per-entity SQL and quadratic key comparisons.

The review of the pinned native implementation exposed SQLite's older compound-key mismatch, and the shared independent backend test now covers it explicitly. It also verifies that all missing/null members survive one group instead of later null-key groups replacing earlier members in the public Map. The 512-scalar regression requires bounded SQL statement count, no per-entity row reads and no unrelated body hydration.

This does not establish large-corpus memory/application performance or full candidate/platform qualification. Primitive-only SQL aggregation and reducing materialized values for highly duplicate distinct queries remain potential improvements; this change supplies the correct batched linear terminal implementation and contract evidence.

Compressed raw typecheck/results/logs, input hashes and reproduction scripts accompany this note; receipts hash uncompressed bytes.
