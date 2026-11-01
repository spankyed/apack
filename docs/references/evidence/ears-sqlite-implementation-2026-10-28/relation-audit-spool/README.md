# Disk-backed candidate grouping for relation audit

The previous cf68785d3c audit repeatedly scanned all earlier keyed relations between the same endpoints. The new source keeps an indexed private spool of kind/source/target/fingerprint/order/relation-ID and decodes primary info only for candidate collisions. It hashes one decoded key at a time, streams candidate IDs, reuses two prepared statements and gives the scratch SQLite connection an 8MiB page-cache setting with file-backed temporary work. That setting is not total process memory; individual decoded values, object-key sorting, hashing and native allocations still cost memory.

The fingerprint is private candidate selection, not stored primary identity. It shares the existing own-field reader (missing=null) and distinguishes ordered lists, bytes, dates, primitives and nested maps while ignoring map key order/undefined members. Tagged lengths and UTF-16 string bytes preserve boundaries and lone-surrogate distinctions. Every colliding candidate still passes through sameRelationKey; a hash match alone never reports a duplicate. Independent decoded NaN/invalid-date keys cannot equal one another, so nonreflexive keys do not enter candidate buckets. Persisted MessagePack arrays must be dense; a driver regression checks this boundary.

Scratch belongs to the existing private audit directory and participates in its close/remove/error aggregation. It never changes the source, introduces no on-disk product format or new normal-open index and does not alter ordinary link/update key equality. A failed setup must close the opened scratch database and remove the private root while preserving the primary error.

Expected healthy-key work is indexed insertion/lookup plus hashing and actual collision comparisons, rather than scanning every earlier endpoint row. This is not a collision-independent worst-case CPU guarantee: a deliberately constant fingerprint still causes pairwise checks, preserving correctness. Ordinary repeated distinct-key insertion remains a separate linear-per-operation concern; its new iterator bounds retained rows, not total search work.

Pure controls, from the repository root:

```sh
node docs/references/evidence/ears-sqlite-implementation-2026-10-28/relation-audit-spool/fingerprint-control.mjs
python3 docs/references/evidence/ears-sqlite-implementation-2026-10-28/relation-audit-spool/ddl-control.py
node docs/references/evidence/ears-sqlite-implementation-2026-10-28/relation-audit-spool/spool-control.mjs
```

The 961 value-pair control passes equality/token agreement, with 41 equal pairs, and exercises typed/nested values, own __proto__, undefined, nonreflexive keys and lone surrogates. Python SQLite 3.51.0 executes the actual DDL and a 512-row indexed lookup. The actual primaryData/fingerprint/equality loop additionally runs against a real file-backed Python SQLite spool with controlled primary cursors: 16/32/64 distinct keys produce zero candidate comparisons and one decode per relation; a reordered-map duplicate adds one comparison. Forced collisions on sixteen distinct keys produce all 120 necessary equality checks and no false duplicate. The bridge opens a Python connection per SQL call, so it does not qualify the actual Node transaction lifetime, driver/codec/types, cleanup or resources. No control establishes native speed.

Four required actual-driver cases now cover 512 distinct endpoint keys (zero collision comparisons), one reordered-map duplicate (one comparison), deliberately forced collisions (no false duplicates), setup-error cleanup/writable-source preservation and actual MessagePack value/dense-array semantics. [Focused 66c](../focused-66c/README.md) now passes all four driver cases plus type/models/conversion on Linux. The 4cc platform source predates this implementation. The historical quadratic source control is pinned to cf68785d3c so its finding remains reproducible. Final all-platform and high-multiplicity time/memory/disk/cleanup measurements remain required before closing this finding.
