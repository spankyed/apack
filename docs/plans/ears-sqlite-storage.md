# SQLite storage design for EARS

Status: proposed implementation direction, 2026-10-28. Execution and acceptance belong to
[the SQLite goal](../goals/goal-ears-sqlite.md); [the contract matrix](ears-sqlite-contracts.md) defines required semantics.

## Direction

Use native scalar columns for declared fields, with large values stored separately and a flexible field store for
undeclared/repair data. Keep primary values authoritative and normalized list/value/search structures derived.
Validate this hybrid through the structured EARS slice before freezing the physical layout or thresholds.

A raw SQL diagnostic on the same lossless 3,000-message fixture found these median costs at a 4 KiB body size:

| Layout | Small field read | Whole row | Page of 50 | 100 partial writes in one transaction |
| --- | ---: | ---: | ---: | ---: |
| Whole MessagePack row plus JSON projection | 8.80 µs | 9.83 µs | 235.04 µs | 5,353.55 µs |
| Per-attribute MessagePack values | 3.80 µs | 22.43 µs | 1,000.44 µs | 476.58 µs |
| Native scalar columns and inline body | 2.49 µs | 8.00 µs | 179.16 µs | 806.14 µs |
| Native scalar columns and separate body | 2.05 µs | 8.04 µs | 211.52 µs | 140.19 µs |

These are one-process, five-round diagnostics of storage primitives with syncing off, not EARS performance or
production guarantees. Every layout checks identical dates, bytes, nested values, nulls, rows/pages and surviving
fields after updates. The body is repetitive synthetic text; compression, content entropy and actual shape mixes
need the real slice. The split variant currently models one known body field, not complete dynamic schema storage.
Other initial runs with small and larger bodies show the same field/page tradeoff; raw samples are retained with
the implementation evidence. Do not compare these figures directly to the earlier full API trials.

## Authority and representation

An entity catalog owns identity, type, creation order and engine metadata. Type-specific rows own declared values;
a flexible store owns undeclared values. A value has exactly one authoritative representation at a time. A large
value can live out of row without duplicating the whole entity as both MessagePack and JSON. Fetch requested large/
flexible values in batches, not one statement per entity or field; bound assembly by requested output.

Use an explicit value-kind/presence representation. SQL NULL alone cannot distinguish an absent field from a
present null or reconstruct arbitrary EARS values. Scalar columns must preserve type distinctions, while Date,
bytes and composite values retain their declared semantics. Unknown fields and existing values that violate a new
rule remain readable; checked mutations validate changed fields, and intentionally unchecked repairs remain possible.

Physical table/column identifiers must not collide under SQLite's case-insensitive identifier rules. Logical names
such as `Note`/`NOTE` or `fooBar`/`foobar` remain distinct. Allocate stable numeric identifiers or another reversible
collision-free mapping; keep logical names in metadata and diagnostics. Bind values and quote physical identifiers.

## Indexes and queries

Compile selective predicates, projections, ordering, limits and adjacency traversal into SQL. Handle multi-type
and caller-ID order explicitly. Preserve direct scalar/list membership, missing/null equality and heterogeneous
value ordering from the contract matrix; the original prototype's null-list hole is not an acceptable fallback.

Native scalar indexes and normalized list membership should serve their appropriate access paths. A readiness
protocol must preserve correctness during background builds. SQLite CREATE INDEX in a worker can still hold the
writer lock; bounded backfill into derived structures, foreground priority and atomic readiness need a concrete
implementation. A worker thread by itself is not the solution.

Query diagnostics must distinguish SQLite plans and measured SQL work from the legacy native engine's stage/key
counts. Never synthesize physical SQLite counters just to satisfy a backend-specific assertion. Preserve logical
warning and call-count meaning, and update diagnostics consumers/types where the reported information differs.

## Required slice measurements

Measure actual EARS field reads, projected/full pages, lookups, small updates in large entities, streamed body
updates, units and watch settlement. Include structured transport, schema checks, value decoding, SQL execution,
partial-write amplification and the entity catalog/flexible store overhead excluded from the primitive diagnostic.
Record steady-state and durable acknowledgments separately against the current pinned elmdb build, which compresses
larger fields. Choose thresholds, compression and background-work budgets from that evidence, not the synthetic
repeated-body case alone.
