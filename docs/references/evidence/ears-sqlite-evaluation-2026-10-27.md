# EARS over SQLite: feasibility checkpoint, 2026-10-27

SQLite can support the broad EARS contract, but this experiment does not establish that replacing elmdb would
improve performance or reduce total maintenance. Keep elmdb in production. Preserve this isolated prototype as
a reproducible decision tool; do not start a migration from the flat-row benchmark or this first adapter.

The existing EARS builders, typed facades and observers run over the experimental database/unit port. All 200
existing package tests and 12 added operational probes pass against SQLite. Deeper search probes still find
behavior differences, and the host backup importer needs storage-format integration. This is a working
feasibility implementation, not a qualified replacement.

## Source and experiment controls

App baseline `58381456752b18f8522b45d50020cac2e4c332fa`; elmdb baseline
`9359949910d06087c6a21a7af1cbcdc00e200615`. The existing release addon SHA-256 is
`8ada39399a39e1671c188bd3d310c0509b358d72502fce5da6b277af29ee8f14`.
Worktree: `monorepo-worktrees.noindex/sqlite-evaluation`, branch `session/sqlite-evaluation`.
The active agent's app and engine checkouts were not edited. App dependencies/output are private APFS clones. The first gate attempt used the compiler's default cache;
the retry explicitly used `APACK_COMPILER_STORE=/private/tmp/ears-sqlite-evaluation-compiler-store`.
No Rust revision was built and no additional multi-gigabyte `target/` copy was needed.

Host: Apple M1 Pro, 32 GiB, Darwin 25.3.0 arm64, Node 23.11.1. SQLite 3.53.4 comes from pinned
`better-sqlite3` 13.0.3; vectors use pinned `sqlite-vec` 0.1.9. This Node build's bundled SQLite lacks FTS5,
so it was rejected for the full-feature prototype. Dependencies are private to the benchmark directory.

The adapter keeps authoritative MessagePack row payloads plus JSON projections, normalized scalar indexes,
relations, FTS5 indexes and embedding chunks in SQLite WAL transactions. It deliberately reuses the existing
EARS MessagePack database port. Consequently a SQLite read decodes the stored payload, encodes an answer,
and EARS decodes it again. That extra round trip is an avoidable integration cost, not a SQLite requirement.

Both backends receive the same API fixture: 10,000 messages with 500-character repeated body text plus topic
and search terms, indexed slug/thread fields, 349 graph edges, and 1,000 vector entities with 256-dimensional
vectors. Construction is outside timing. Three fresh processes per backend each run five rotated rounds,
with warmup and explicit GC outside timing; values escape the timed loop. The last watch measurement has one
50-write window per process. Backends run sequentially in alternating order. This is warm local-cache API
latency, not physical-disk latency, UI responsiveness, p95 latency or controlled exclusive-host throughput.
Other work may have been active on this machine. Samples precede the final read-only-backup and own-commit
sequence correctness fixes; the latter removes one post-commit metadata read. Those fixes were validated with
behavioral tests, not another full benchmark run.

The fixture checks entity/page/walk/vector counts and watch deliveries. Existing model and contract tests
supply broader semantic checks; the benchmark does not prove equality of every returned value or ranking.
Synthetic sine-generated vectors have low intrinsic rank. ANN recall and real embedding quality are unmeasured.
Elmdb's ANN vector query and this adapter's exact scan are different algorithms: their latency ratio is not
a like-for-like recall comparison.

## Measured API paths

Microseconds per API operation. Each cell is the median of three process medians, followed by their range.
SQLite/elmdb greater than 1 means this SQLite adapter took longer. Both backends have syncing disabled here;
these write numbers carry no durability claim.

| Operation | elmdb µs (range) | SQLite µs (range) | SQLite/elmdb |
| --- | ---: | ---: | ---: |
| Read one field | 5.4 (5.2–5.4) | 13.6 (12.9–13.8) | 2.53× |
| Read one row | 10.0 (9.9–10.0) | 15.6 (15.4–16.8) | 1.56× |
| Indexed unique lookup | 34.4 (34.2–34.7) | 54.1 (53.7–55.5) | 1.57× |
| Indexed page of 50 rows | 298.8 (298.7–309.4) | 418.6 (410.4–428.2) | 1.40× |
| Read all 10,000 messages | 36,993.6 (36,757.7–39,261.8) | 46,239.5 (45,959.4–47,693.7) | 1.25× |
| Sort 10,000, return 50 IDs | 7,826.2 (7,505.2–7,828.0) | 39,257.4 (39,054.8–40,275.8) | 5.02× |
| Traverse 50 edges, return rows | 270.1 (265.1–293.6) | 330.0 (318.8–331.6) | 1.22× |
| Walk 299 descendants | 550.8 (543.6–565.1) | 1,580.6 (1,564.9–1,664.4) | 2.87× |
| Text search, return 20 IDs | 304.2 (302.2–315.9) | 319.8 (312.4–321.3) | 1.05× |
| Vector top 10, 1,000 × 256 dimensions | 165.0 (160.0–167.1) | 2,768.1 (2,734.9–3,083.2) | 16.78× |
| One write, no sync | 72.0 (70.4–75.4) | 213.4 (184.9–222.5) | 2.96× |
| 100 writes in one unit, no sync | 2,631.8 (2,516.5–2,708.6) | 8,936.7 (8,233.7–9,110.1) | 3.40× |
| Write and settle, 20 watches | 96.6 (91.8–111.4) | 232.1 (226.1–248.8) | 2.40× |

The earlier flat-column SQL benchmark bypassed most of this contract and favored SQLite on several reads.
These results change the inference: fast native SELECTs do not automatically yield a faster EARS backend.
Elmdb performs well on its actual integrated API. They do not prove that an idiomatic SQLite implementation
would have these same costs.

An initial indexed equality accidentally scanned candidate rows; the corrected generated SQL starts with
`field_lookup(type,field,value,seq)` and resolves entities by primary key. The saved EXPLAIN confirms both
lookups, plus a temporary sort preserving EARS creation order. Native text search initially materialized
all candidate IDs and generated highlights/payloads even for IDs-only queries. Removing those costs brought
text search to approximately parity; no requirement was skipped to achieve it. This is evidence that query
shape and materialization boundaries matter substantially.

## Matched durable writes

Three fresh-process trials, five timing rounds each, with `transact(..., {durable:true})` on both backends.
SQLite uses `synchronous=FULL`, `fullfsync=ON`, and `checkpoint_fullfsync=ON`. LMDB uses `F_FULLFSYNC` on
macOS. An earlier SQLite result around 0.46 ms omitted fullfsync and was rejected as a durability mismatch.

| Operation | elmdb median | SQLite median | SQLite/elmdb |
| --- | ---: | ---: | ---: |
| One durable write | 4.42 ms | 4.98 ms | 1.13× |
| 100 writes, one durable unit | 9.63 ms | 16.68 ms | 1.73× |

SQLite's default in this prototype durably commits every write; elmdb normally groups syncs. Comparing their
default acknowledgments without separating durability would be misleading. These timings verify configuration
and successful operations, not power-cut behavior or actual disk-full/sync-failure outcomes.
[SQLite documents the separate fullfsync flag](https://www.sqlite.org/pragma.html#pragma_fullfsync).

## What works, what remains ours, what is missing

| Need | Evidence and disposition |
| --- | --- |
| Existing EARS builders/facades | Reused unchanged; 200 existing tests pass, including independent state and watch models. No production EARS source change. |
| Lossless values | MessagePack remains authoritative; operational reopen covers Date, bytes, nested null/false/zero and own `__proto__`. JSON alone would not preserve them. Arbitrary repeated-key wire maps are not qualified. |
| CRUD, roles, numbering, constraints | Existing tests pass. Domain constraints remain adapter code; full canonical schema validation and all schema-transition checks are incomplete. |
| Units/savepoints and atomic failures | Existing tests plus primary/FTS/vector rollback and injected mid-replacement failure pass. SQLite supplies the transaction engine; EARS still supplies domain checks. |
| Dynamic pack declarations | Existing declare/setSchema/watch tests and host opening work; new types and indexed existing data are exercised. Required-field and unsupported-stem admission failures roll back. Another handle's schema change refuses stale reads/writes/schema adoption. |
| Background index admission | Missing: prototype rebuilds synchronously in bounded 256-row pages, inside one write transaction. The event loop and writers can stall. Meeting the existing background-build contract needs worker/job-state/admission design. |
| Indexed filtering and paging | Native SQL with normalized value indexes; corrected access path saved. Creation order and multi-type order add work beyond a raw SELECT. |
| Graph semantics | SQL adjacency indexes and recursive cycle checks work. Ordered/deduplicated walks still use JS BFS and per-node SQL calls. SQL recursive execution could remove crossings, but must preserve existing ordering/scope semantics. |
| Mixed-value ordering/grouping/distinct | Custom JS fallbacks retain value semantics. Sorting materializes values; distinct and groupBy use potentially quadratic comparisons. Native SQL/ICU or explicit canonical keys would need separate parity work. |
| Watches | Existing EARS observer code is reused; dependency tracking/invalidation remain adapter responsibilities. Same-process commit behavior is tested. Cross-process watch delivery is not added; current EARS/elmdb does not provide it either. |
| Read snapshots and concurrency | Multi-statement snapshot stays consistent during another handle's commit. A child process sees committed data while a writer is open; its competing writer gets SQLITE_BUSY. Busy-wait/event-loop and worker ownership policies remain product decisions. |
| Native text search | FTS5 supplies inverted indexes, BM25, English Porter stemming, phrases and highlights. Existing seven search tests pass. Default ranking is not demonstrated equivalent to elmdb's scoring. |
| Exact text semantics | Observed gaps: `database` does not match the camelCase component of `openDatabaseStore`; inline `title:database` is not parsed; a phrase can cross array elements in the flattened FTS projection. List element/UTF-16 highlights were fixed and tested. Both engines missed the isolated Tokyo-substring probe; it is not a win for either. |
| Fuzzy and multilingual search | Prototype fuzzy expansion scans the full vocabulary and computes JS edit distances. It only accepts English stemming; the SDK advertises 18 Snowball languages. Native FTS5 is not a replacement for our tokenizer/fuzzy behavior without extensions or custom adapter work. |
| Embeddings/hybrid | Existing six vector tests pass, including stale hashes/model identity, filtering, like and hybrid ranking. Chunk lifecycle and hybrid fusion remain EARS code. |
| Scalable vector search | Prototype uses exact distance scans, not ANN. A separate pinned-extension probe verifies vec0 and scalar exact top-10 agree on ten queries. Native vec0 medians were 0.273 ms at 1k vectors and 2.90 ms at 10k, versus scalar 0.520/5.66 ms. This excludes EARS overhead and does not establish ANN quality or future corpus performance. |
| Reopen and read-only access | Payload, FTS and embeddings reopen correctly, including a read-only connection. Actual read-only filesystem/mount behavior is unqualified. Existing host opening suite passes. Existing elmdb directories are refused rather than silently creating a second store beside them. |
| Native backup/populated replacement | VACUUM INTO snapshot and transactional populated replacement pass with relations, text, embeddings and source preservation. A synthetic failure midway preserves the incumbent. Read-only-source backup is also covered. Backup publication, permissions, platform/filesystem behavior and snapshot resource use are not qualified. |
| App backup import | Host probe: 18/22 tests pass; four import cases stop at the hard-coded `data.mdb` preflight. Three passing coordinator tests use mocked stores. A storage descriptor/opener must replace the filename assumption before testing complete app rollback/media import over SQLite. |
| Error/durability contract | Successful FULL/full-device commits are measured. Existing proxy-based NOT_DURABLE observer tests pass, but do not inject a real SQLite I/O failure. SQLite error translation and precise commit-outcome reporting are unfinished production blockers. |
| Maintenance tooling beyond EARS | The prototype does not implement elmdb's raw logical dump/load, derived-data audit/rebuild, suggestions/fuzzy-label APIs or all multi-index/metric/schema options. SQLite structural integrity checks and SQL REINDEX are useful but do not establish parity for custom derived data. These are separate from the app's tested structural EARS port. |
| Existing data and run history | Factory injection is a test alias only. No production entry, format descriptor, manual conversion, backup-format cutover, run-history corruption policy or real-data migration is implemented. |
| Shipping and platform support | Only local macOS arm64 Node loading is proven. Linux/Windows, Electron, packaging/signing and extension distribution remain unqualified. No filesystem is certified by these tests. |

Stock SQLite has no fundamental obstacle demonstrated for the ordinary entity/graph API. Some needs are not
stock features: our watches, tokenizer, fuzzy matching, chunk lifecycle, hybrid semantics and background admission
still require code. Exact ANN behavior is not supplied by the selected exact-search implementation. These are
integration gaps, not proof that SQLite cannot implement them.

WAL has a real deployment limit: it requires same-host shared memory and is unsuitable for multi-host network-file
access. [SQLite documents WAL's concurrency and filesystem requirements](https://www.sqlite.org/wal.html).
We must also retain a single-owner/library-loading policy: switching engines does not remove every duplicate-binding
hazard. [SQLite documents risks from multiple linked copies](https://www.sqlite.org/howtocorrupt.html).

## Maintenance and algorithmic tradeoffs

This is roughly 2,100 formatted lines of adapter/query/search code before complete production validation, with
prototype `any`-heavy types and deliberately partial validation. Line count is not a maintainability comparison:
it excludes all machinery supplied by SQLite/extensions, and omits requirements elmdb already implements.

- SQLite would own SQL planning/execution, relational indexes and native FTS index maintenance. Its tools and
  query plans make inspection and ad-hoc analysis easier. It supports an alternate architecture with structured
  results and native SQL pushdown; we have not measured that architecture through EARS.
- Elmdb already delegates its durable B-tree/storage engine to mature LMDB. The decision is about which layer
  owns query execution, index semantics and integration, not replacing a homegrown persistence engine with the
  first mature engine in the stack.
- The current SQLite row layout makes a field read decode O(row size), and writes rewrite the payload plus JSON
  projection and scalar indexes. Reindexing unchanged scalar fields is unnecessary work in this prototype.
  Elmdb's entity/attribute layout can read or change one field with less materialization.
- Indexed equality uses O(log I + K log N) lookup work plus required ordering/materialization. JS ordering is
  O(N log N) with O(N) payloads and boundary crossings. Distinct/groupBy can be O(N²); those fallbacks should not
  become a permanent database executor by accident.
- BFS is O(V+E) graph work but incurs per-node binding calls. Exact vectors are O(ND), while ANN trades recall
  for reduced search work. Native vec0 reduces constants without proving a sublinear ANN solution.
- Fuzzy vocabulary expansion is approximately O(VL²) in the prototype; bounded edit distance does not justify
  scanning every vocabulary word on every query. Input limits and an indexed fuzzy strategy would be needed.
- Schema rebuilds hold a writer transaction while scanning/reindexing the corpus. WAL growth, disk use,
  cancellation, reader longevity and admission latency need explicit budgets even though the row batch is bounded.
- MessagePack is useful for lossless storage and native transport, but preserving a binary native-binding protocol
  between JavaScript modules introduces avoidable encoding/decoding and allocation. It should not define the only
  possible internal backend boundary.

## Principal-engineer recommendation

Keep elmdb as the supported implementation. The measured API is competitive, the engine already exists, and
this prototype supplies no performance or correctness reason to replace it now. Treat the raw in-memory Map
comparison as a lower bound without persistence/transactions/index maintenance, not a target a disk-backed engine
should match operation-for-operation.

If reduced database ownership remains a strategic goal, authorize one bounded second checkpoint before a
migration decision:

1. Extract a private structured read/transaction boundary while preserving public EARS builders; keep binary
   encoding at actual native/storage boundaries. Measure API/binding/materialization costs separately.
2. Implement a small representative vertical slice idiomatically over SQLite: native selective queries and
   projections, lazy text results, efficient graph execution, and vec0/another explicitly chosen vector strategy.
   Avoid reproducing the entire elmdb executor in JavaScript. Rerun realistic workloads with latency budgets,
   corpus sizes, update rates, background indexing and vector recall requirements chosen from app use.
3. Make a product decision on search semantics and run a relevance corpus. Either retain the existing tokenizer/
   languages/fuzzy behavior through a well-scoped component or explicitly approve the changed behavior.
4. Make backend-specific storage descriptors concrete at host open/backup/run-history boundaries, then get the
   four failing import cases green without compatibility marker files or weakened assertions.
5. Qualify true I/O failures and commit outcomes, crash/reopen, backup publication/permissions, packaged Electron
   and OS/filesystem support. Demonstrate the path for our own current data on disposable copies.
6. Compare owned invariants, code removed, dependency/update burden and failure recovery—not just line count.
   Choose one supported backend. Do not create a permanent dual-backend maintenance obligation by default.

Proceed with a cutover only if that checkpoint meets agreed app budgets and materially reduces owned machinery.
Otherwise retain elmdb and spend optimization effort on observed app bottlenecks, batching, result materialization
and narrow queries. The current evidence supports confidence in the existing investment, not an emergency rewrite.

## Validation and evidence

[Raw samples, provenance, negative proofs and logs](ears-sqlite-2026-10-27/) are retained beside this document.
The [reproduction guide](../../../packages/apack-ears/bench/sqlite/README.md) includes exact commands.

- SQLite EARS suite: 212 passed across 13 files; after lazy text changes, the 24 affected search/vector/operational
  cases passed again. Existing assertions were not skipped or weakened.
- Operational probes cover read-only reopen, backup/populated replacement, primary/FTS/vector rollback, dynamic
  indexes and stale handles, failed replacement, consistent snapshots, failed schema admission, a child-process
  competing writer, wrong-format refusal list highlight coordinates and own-commit sequence capture despite an immediately following writer.
- Five disposable mutations are detected by behavioral assertions: removing snapshot isolation, stale-schema
  refusal, replacement embedding transfer, transaction rollback, or own-commit sequence capture. No mutation touched the real worktree.
- EARS typecheck passed, including the benchmark files after relocation into the existing benchmark convention.
- Repository chain-input, test-placement and suite-read guards: 82 passed after correcting placement.
- Host backend-alias suites: 18 passed, four known backup-format failures, documented above.
- The broad local gate passed builds, API/package/static checks and its fast suite: 506 files passed, 5,909 tests
  passed, 19 skipped. It was interrupted before completion after noticing that `--no-native` still runs captured-
  compiler tests in that fast suite; those ran inadvertently under the earlier local-testing constraint.
  Remaining validation was limited to EARS tests and static checks. No complete gate, CI, release, production
  switch or real-data migration is claimed. See the current plan for the exact disposition.
