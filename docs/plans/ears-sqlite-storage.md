# SQLite storage design for EARS

Status: authoritative layout integrated through the candidate EARS facade; performance qualification pending, 2026-10-28. Execution and acceptance belong to
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

## Component checkpoint

`packages/apack-ears/src/sqlite/values.ts` implements scalar column pairs (kind and native value), with
large/composite and flexible values in a separate store. Declaration adds slots without rewriting incumbent
flexible data; the next write moves a changed field to its current representation. Caller-owned transactions cover
schema, primary metadata and derived writes; the caller also owns row-rule validation. Layout handles are admitted
schema state, not a process-global cache. Existing layouts reopen without writes.

Native slots currently stop at 128 per type so wide declarations fall back to flexible storage rather than exceed
SQLite's column limit. Text/bytes larger than the provisional inline threshold live outside the row. These are
bounded starting policies, not measured optimal values. The focused 300-field case proves no values are dropped;
component tests also prove a scalar patch neither reads nor encodes its neighboring large body, and a projected
50-row page uses two SQL calls without decoding unrelated composites.

The candidate now uses this layout through EARS. The entity catalog holds no whole-row payload or JSON document.
Scalar predicates use native values; direct scalar list members have rebuildable per-field derived records. Page
projection happens before overflow decoding, updates patch changed attributes and affected indexes, and backup
replacement copies logical values from one source snapshot instead of copying incompatible physical slot IDs.

Shared native/SQLite tests pin omitted undefined object properties and refused undefined list elements. Normalization
is per changed value, preserving the structured transport. Undeclared primary types remain readable/filterable through
all-entity or ID starts. The backend/query/search implementation is source-owned under `src/sqlite/`, with an app-only `./sqlite` entry
and pinned workspace dependencies. Measured backend-specific explain and discriminated operation/read/result
types are implemented. The [actual-facade comparison](../references/evidence/ears-sqlite-implementation-2026-10-28/facade-slice.md)
exposed expensive large-value key traversal in the overflow WITHOUT ROWID table. Only that table now uses rowids
plus a unique logical key; the identical repeat cuts its projected large-row page from ~14.3 ms to ~0.27 ms.
Sorting/vector regressions, app budgets and more precise native/allocator attribution remain open.

## Indexes and queries

Compile selective predicates, projections, ordering, limits and adjacency traversal into SQL. Handle multi-type
and caller-ID order explicitly. Preserve direct scalar/list membership, missing/null equality and heterogeneous
value ordering from the contract matrix; the original prototype's null-list hole is not an acceptable fallback.

Native scalar indexes and normalized list membership should serve their appropriate access paths. A readiness
protocol must preserve correctness during background builds. SQLite CREATE INDEX in a worker can still hold the
writer lock; bounded backfill into derived structures, foreground priority and atomic readiness need a concrete
implementation. A worker thread by itself is not the solution.

The first admission slice implements value indexes. One owning foreground connection advances persistent index
jobs between synchronous calls with unreferenced immediates; no worker holds a separate long writer transaction.
A job has a generation, building/ready/failed state and committed sequence cursor. Writes maintain its active
generation even while building. Reads use authoritative scalar/list values until readiness and all backfill writes
commit together. Retained indexes keep their generation across unrelated declarations. Removed generations enter
bounded indexed cleanup; an interrupted or failed build resumes its committed cursor on writable reopen. A stale
owner stops rather than changing the newer owner's job. Read-only handles use the same safe fallback.

Working qualification targets, set before the load measurements: no primary-row hydration during value-only
admission; admission below 100 ms for the 10k/100k synthetic fixtures; at most 32 records per backfill transaction
with a 4 ms cooperative work target; observed foreground operation and timer-stall p99 below 16 ms in sync-disabled
fixtures. Apply the same targets to separate FULL/durable runs before calling this slice qualified; these have not
yet been measured. Transaction begin/commit and an indivisible large value can exceed the work target; report full batch
and foreground latency rather than presenting 4 ms as a hard wall-clock bound. Background work pauses while a unit
is open and resumes when it ends. Competing writers fail promptly (SQLite busy timeout zero); only the background
queue retries busy batches after a yielding delay. Measure WAL/file growth and post-build old-generation cleanup: observed WAL at most 16 MiB (or initial WAL plus
4 MiB if larger), and database-side files at most twice the seeded baseline plus 16 MiB. Require zero retired-generation
entries after cleanup; freed pages may remain allocated for reuse.
These are development qualification targets, not the phase-7 app budgets or platform durability qualification.

SQLite's [transaction rules](https://www.sqlite.org/lang_transaction.html) underpin the single-writer and snapshot
policy. Some I/O/resource errors can end a transaction automatically, so cleanup consults the driver's transaction
state. If rollback itself fails, the builder stops until reopen, retaining both errors. Readiness cache state is
prepared before the schema commit; accepting it afterward performs no IO. The [WAL documentation](https://www.sqlite.org/wal.html)
describes checkpoint/reader interactions; long readers, host filesystem support and real IO failure outcomes remain
phase-6 qualification, not guarantees inferred from these sync-disabled fixtures.

Text/vector admission still uses a synchronous backfill when its definition changes. Unchanged search definitions
are retained during value-only declarations. Completing background text/vector readiness and full search/vector
semantics remains required; this first slice does not declare phase 3 complete. Same-connection watches still hear
only logical commits made through their connection; cross-process reactive ownership remains to be qualified.

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
