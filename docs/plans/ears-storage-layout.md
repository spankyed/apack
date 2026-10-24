# EARS storage: layout, relations, queries and write durability

Status: Steps 1–7 and 9 done, Step 8 dropped, 2026-10-24; Step 10 next, in the order below. Takes up review items 6
(row reads) and 9 (durability) from the EARS API cleanup, and supersedes the open parts of
[goal-lmdb-only.md](../goals/goal-lmdb-only.md) (PR #261, closed unmerged), which holds the spike's measurements and
the lock analysis.

## Where the engine is

The engine holds the whole database in memory and mirrors it to LMDB:

- **Boot loads everything.** `hydrate` reads every table into the engine. Measured 2026-10-23 on copies converted to
  format 3, the built engine, 3 runs each:

  | Data | Entities (relations) | Attribute values | Hydrate | Heap |
  |---|---|---|---|---|
  | The lead developer's production data (`abuddy/ears-db`, 292 MB) | 68.6k (45.8k) | 224k | 1.3–1.5 s | 308 MB |
  | The dev data dir (`apack-dev`) | 559 (325) | 2.4k | 22 ms | 1.4 MB |

  Of the production data's 171 MB of values, `Message.blocks` (thread transcripts) is 141 MB and `Artifact.content`
  13 MB; everything else is under 10 MB.
- **Memory runs ahead of disk.** `lmdb/adapter.ts` buffers writes and flushes them in a microtask; a row that fails is
  dropped and reported through `onWriteFailure` after the writer has moved on (one production session dropped 3,187).
  Each flush is an `F_FULLFSYNC` on the API's main thread (3.5–8 ms), and a `transact` pays it twice.
- **What Steps 1–9 left in memory:** attributes by entity (`attribute-storage.ts`), one relations module owning each
  relation's row and its adjacency (`relations.ts`), lazy queries, a value index any queried kind joins, a trash set,
  and numbering rows that are still entities (`Sequence-…`).

## Decisions

### One copy of the data, in LMDB

**The engine reads and writes LMDB; the in-memory database goes** (decided 2026-10-23). An embedded store with one
copy of the data is the industry norm, and the reasons are the pit of success:

- a write commits or throws, so nothing can run ahead of disk;
- data size is never a rule a feature author has to know (moving the transcripts out would fix today's 308 MB and leave
  the trap for the next large field);
- a read returns a copy, so mutating it can't change stored data unsaved;
- tests run the engine the app runs, on an in-memory backend of the same seam.

Reads cost more per operation (2–10× in the spike, before lazy queries), in microseconds; writes are covered under
durability.

**Nothing holds data in memory but a call** (decided 2026-10-24):

| What | Shape | Lifetime |
|---|---|---|
| A read snapshot | one LMDB read transaction: a reader slot, no copied data | one terminal |
| A query's working set | the current id while streaming; a set of ids reached, for a walk's dedupe; the ids `orderBy`, `distinct` or a deep walk collects | one terminal |
| A result | fresh copies decoded from LMDB | the caller's; the engine keeps no reference |
| A unit | one LMDB write transaction, whose dirty pages are LMDB's | the unit |
| Group commit | a "committed since the last sync" flag, a timer, the pending `durable()` promises | until the next sync |
| The schema | the registered names and row rules | the app's run (configuration, not data) |

Two rules keep it so:

- **No cache of data in the engine.** Not lmdb-js's `cache: true` (the spike measured no gain), not a cached next number
  for short codes (numbering reads its key inside the write transaction), not a memoised row. A slow read is fixed by
  the key layout or the query, measured.
- **No reference to stored data outlives its call.** Results are copies, and a development check freezes them in tests,
  so code that mutates one fails loudly instead of silently not persisting.

The operating system's page cache holds recently read pages of the memory-mapped file, outside the heap, and evicts
them on its own.

### The key layout

By entity, so an entity's fields share one or two B+tree pages and a commit dirties few (LMDB is copy-on-write; a commit
costs about the leaf pages it dirties). Engine-minted ids are `Type-<base-36 time><random>`, so a new entity's keys
append at the end of its type's range, a B+tree's cheapest write. One environment, one named database, ordered-binary
array keys, msgpack values (which keep Dates, nested values and `undefined`):

| Key | Value | Serves |
|---|---|---|
| `['v', id, kind]` | the value | `getAttr` (one get), `getRow` (one range), `has(k)` (one get) |
| `['i', id]` | `{ seq, trashed }` | existence, an entity's sequence, whether it is in the trash |
| `['e', type, seq]` | id | a type's live entities in insertion order |
| `['d', type, seq]` | id | a type's trashed entities in insertion order |
| `['c', type]` | count | `count()` of a type's live entities |
| `['x', kind, value, seq]` | id | a declared index (below), streaming in insertion order |
| `['o', entity, kind, seq]`, `['n', entity, kind, seq]` | `[relId, farEnd]` | an entity's edges out and in, by kind, in link order: a hop never decodes the relation row |
| `['r', relId]` | the relation row | `getRelation`, `findRelations` |
| `['s', key]` | next number | short codes and numbered labels |
| `['m', 'seq']`, `['m', 'format']` | | the sequence, the store format |

What the layout decides, beyond the goal's first draft:

- **The trash is a range, not a check.** Trashing an entity moves its type key from `['e', …]` to `['d', …]`, adjusts
  `['c', type]` and sets `trashed` on `['i', id]`. A live query walks only live entities, with no per-entity lookup;
  `withTrashed` merges both ranges by sequence; `trashed` walks `['d', …]` alone.
- **Numbering is keys, not entities.** `['s', key]` replaces the `Sequence-…` rows, so `query.all()` and the raw
  listings have no engine entities to step around, and `Sequence` leaves `RESERVED_ENTITY_TYPES` (Step 9's third
  follow-up, done here).
- **No list-length keys and no catalogs.** `has(k)` is a get of `['v', id, kind]`. `getSchemaStats` walks key ranges
  reading keys only, which is an admin read; the goal's per-kind first-seen catalogs cost a write each and served only
  it.
- **No relation kind index.** A whole-graph read by kind (the Database view, `apack db export`) is rare, so it walks
  `['r', …]` rather than every link paying a kind key.

### Writes and durability

**A write is committed when it returns** (decided 2026-10-23). A failure throws and leaves the store as it was; there is
nothing to `flush()`.

**Group commit, with a user's action durable by default** (decided 2026-10-24):

- **Every write commits synchronously without a sync:** `transactionSync` with `NO_SYNC_FLUSH`, the environment opened
  with `overlappingSync: false`. It is visible at once and survives the app crashing.
- **One sync makes every commit before it durable.** It runs on a short timer (100–250 ms), on idle and on close.
- **A user's action is durable without anyone asking.** The bus already scopes each delivery (it is what `reply` reads).
  When it finishes handling a message that came from a client and that handling committed anything, it requests a sync,
  without blocking the handler, so the action is durable within one sync. Work nobody asked for in that moment — flows,
  a run's step results, background reconciliation — rides group commit.
- **What has no delivery asks:** `await durable()` resolves once everything committed so far is on disk, and
  `transact(fn, { durable: true })` syncs as that unit commits. Backup, export, import and the content apply ask.
- **One setting for every process.** Processes sharing an environment must open it with the same `overlappingSync`, so
  the app and `apack db` open it through one function.

Postgres (`synchronous_commit=off` with group commit, settable per transaction), SQLite (WAL, `synchronous=NORMAL`) and
RocksDB (WAL without sync by default) make the same trade.

- **Why the sync is the cost, and native code doesn't change it.** On macOS the LMDB lmdb-js vendors syncs with
  `fcntl(F_FULLFSYNC)` (`mdb.c`'s `MDB_FDATASYNC`), which empties the drive's cache to the flash: 3.5–8 ms a commit. A
  commit without a sync is 0.015–0.026 ms through lmdb-js, so neither the binding nor a Rust adapter is where the time
  goes; how often a commit pays for a full sync is. lmdb-js 3.5.4–3.5.9 change none of this.
- **What it costs, against memory** (the spike): 1,000 creates, a commit each, 3.4 ms in memory, 13,550 ms with a full
  sync per commit and 115 ms without; in one commit, 3.8 ms against 15.0 ms. Memory's figure is not a durable write:
  today's comparable cost is a full sync per microtask flush, which group commit beats for writes spread across turns.
  A burst in one turn costs a commit per write, and `transact` batches one.
- **Why not `overlappingSync`.** It serves lmdb-js's asynchronous writes, moving the sync out of the writer lock; with
  it on, even a `NO_SYNC_FLUSH` commit waits for the flush. Asynchronous writes were rejected: reads don't see pending
  writes, and a failure surfaces after the writer has moved on.
- **Rejected:** a full sync on every commit (today's) or at each `transact`; background sync with no way to ask for
  durability; and `noSync` with `useWritemap`, which can corrupt the database.

### Reads

**Reads stream from LMDB cursors, one read snapshot per terminal** (decided 2026-10-24). Step 7's lazy builder is
already the shape that streams:

| Step | Reads | Streams in |
|---|---|---|
| `query(type)` | `['e', type]` range | insertion order |
| `query.withTrashed(type)` / `query.trashed(type)` | `['e', …]` and `['d', …]` merged / `['d', type]` | insertion order |
| `query.ids(ids)` | `['i', id]` gets | the order given |
| `getAttr(id, k)` / `getRow(id)` | one get / `['v', id]` range | — |
| `where(k, v)` on a declared index, `withRole(r)` | `['x', kind, value]` range | insertion order |
| `where(k, v)` on any other field | the type's range, filtered | insertion order |
| `out` / `in` / `outEdges` / `inEdges` | `['o' \| 'n', entity, kind]` range | link order |
| `descendants` / `ancestors` | those ranges, breadth first | nearest first |
| `getRelation(relId)` | one get of `['r', relId]` | — |
| `findRelations({ source \| target })` | that end's adjacency range | link order |
| `findRelations({ kind })` / `findRelations()` | a walk of `['r', …]`, filtered | relation id |
| `count()` of a type with no filter | `['c', type]`, one get | — |

- **Stopping and collecting.** `first`, `exists` and `limit` stop the cursor; `count` with a filter counts the stream
  without collecting it; `orderBy`, `distinct` and the deep walks collect; a `reverse` directly over a range reads it
  backwards (`reverse: true`).
- **One read snapshot per terminal.** A terminal opens one read transaction (lmdb-js `useReadTransaction()`, passed as
  `transaction` to every get and range it makes) and releases it when it returns or throws (`try`/`finally`). Every
  range answers from the same moment, and a write a `where` predicate makes commits outside it, so a walk reaches only
  what was there when it began. A snapshot never outlives its terminal or crosses a turn: an open read transaction
  stops LMDB reusing pages, so a held one grows the file.
- **A unit reads its own writes.** Inside `transact`, every read goes through the unit's write transaction.
- **No cursor leaves the store.** The engine hands out arrays and values, never an lmdb-js iterator. Every range is
  consumed by `for…of`, which closes it on `break`, `return` and a throw; a range a body writes into is collected first.
  An environment has 126 reader slots, and a cursor taken by hand and left open holds one for the life of the process
  (the `getAttrLength` incident in `packages/apack-ears/CLAUDE.md`).
- **Synchronous, and decoded only when read.** Ranges use lmdb-js's synchronous `getRange`, so queries stay
  synchronous; lazy `map` and `filter` are fine inside the store, `asArray` only where a step collects. A walk that
  needs only keys reads keys (`getKeys`, or `values: false`).
- **Pagination is keyset when it is added.** Nothing pages today (`b64Encode`/`b64Decode` have no caller). A page API
  continues from the last key it returned, never from an offset.
- **The offline reader goes.** `LmdbReader` is deleted with hydration: `apack db` opens the same engine on the LMDB
  backend, read-only, so a tool's queries are the app's.

### Declared indexes

**Indexes are declared, not implied** (decided 2026-10-24). Indexing every queried kind on disk would make every put
write index keys and every update read the old value to remove its old entry, which is most of the spike's write
amplification.

- **Declared in the manifest.** An entity's entry gains `indexes: ["status", "label"]`. Codegen writes them into the row
  rules beside `required` and `shortCode`, and refuses a name the shape doesn't declare as a field. The SDK's entities
  declare theirs in `SDK_ROW_RULES`. Roles are always indexed (`withRole`).
- **Correct either way.** A `where(k, v)` on a declared index reads its range; on any other field, or with a value the
  index doesn't hold, it filters the type's range, never missing a match. The index holds strings up to 256 characters,
  finite numbers and booleans; a longer string or an object value is found by the filtered walk.
- **Telling a developer an index is missing.** In development, a `where` that filters more than a few thousand entities
  without an index logs once per call site, naming the entity, the field and the manifest entry to add it to — the
  pit of success for "declare an index", as a query planner's warning is.
- **Which fields each pack indexes** is chosen from the `where` calls its code makes.

### Open

**Insertion order or id order.** The contract pins insertion order, which costs `['e', type, seq]`'s sequence, the
`seq` in `['i', id]` and in every index key: a sequence per create and a hop per index match. Engine-minted ids are
time-sortable, so id order is creation order for them; ids given explicitly (an import's, a compiled flow's or node's,
named after it) are not. Id order would drop the sequence as a contract change, with code that needs an order saying
so through `orderBy`. Settled by measuring, in Step 10.1: which callers read a query's order without an `orderBy`, and
what the sequence costs a create on format 4.

## Steps (in order of lift)

Each step is one commit, measured against the Step 4 baseline where it touches the engine. The ears contract suite
(`tests/engine/`) pins behaviour throughout; a pure re-layout needs no new spec.

### 1. Close PR #261
Done, 2026-10-23: closed unmerged, pointing here. Its key layout and measurements are in the goal; the spike's code is
not reused.

### 2. `link` idempotence by structural equality
Done: `link` compares `info` structurally, not by `JSON.stringify`, so key order makes no duplicate edge.

### 3. `orderBy`: decorate-sort, collator, type order
Done: each value is read once, then sorted; strings compare with one cached `Intl.Collator`; mixed types order by type,
then value; undefined stays last. 3 chained steps 27.8 → 11.8 ms, `orderBy` a string 14.9 → 11.9 ms.

### 4. Benchmark cases and baseline
Done, 2026-10-23. `bench/ears.bench.ts` times the engine in `dist` (`npm run bench -w @apackdev/ears` builds first);
`bench/heap.ts` (`npm run bench:heap`) reads the heap with the same graph loaded. The bench graph holds 8 attribute
kinds, so `getRow`'s O(K) showed less here than in the app, which holds hundreds.

Baseline (mean ms, after Step 3; macOS, Node 23.11, lmdb 3.5.3, the bench's 50k entities / 200k attributes / 100k
relations):

| Case | ms |
|---|---|
| bulk load | 180.9 |
| query by type with where and pickAll | 16.6 |
| 1,000 where lookups by a unique value | 0.76 |
| 100 withRole lookups | 12.0 |
| 1,000 `query.ids(id)` lookups | 0.28 |
| query by type with 3 chained steps (`orderBy('rank')`) | 11.8 |
| relation traversal | 0.0025 |
| `orderBy` a string over 40k | 11.9 |
| 1,000 `query(type).first()` over 40k | 3,815 |
| 1,000 `getRow` | 0.72 |
| `pickAll` over 40k | 35.7 |
| 100 `linkedWith` | 52.5 |
| link 10k tasks to one project, then destroy it | 6,178 |
| 1,000 creates | 4.50 |
| 1,000 short codes | 4.43 |
| transact: 1,000 creates as one unit | 6.93 |
| heap, graph loaded | 61.3 MB |

### 5. Rewrite `goal-lmdb-only.md`
Done, 2026-10-23: it holds Step 10's first design, the spike's measurements and the lock analysis.

### 6. Attributes by entity (review item 6)
Done, 2026-10-23. Each row is a plain object, not a `Map` (mean ms against the Step 4 baseline):

| Case | Baseline | `Map` per entity | object per entity |
|---|---|---|---|
| heap, graph loaded | 61.3 MB | 85.6 MB | 67.8 MB |
| 1,000 `getRow` | 0.72 | 0.62 | 0.18 |
| query by type with where and pickAll | 16.6 | 9.6 | 7.0 |
| `pickAll` over 40k | 35.7 | 18.7 | 20.7 |
| 1,000 creates | 4.50 | 4.00 | 3.65 |
| `orderBy` a string over 40k | 11.9 | 13.3 | 13.4 |
| 3 chained steps (`orderBy('rank')`) | 11.8 | 13.4 | 13.0 |

`orderBy` went over the +10% tolerance: each `getAttr` looked its id up in one map of every entity, relations included.
Step 9 took relations out of that map; Step 10 measures it again on LMDB. A field named `__proto__` is set as an own
property (`setField`), with a spec.

### 7. Lazy queries
Done, 2026-10-23. A step that keeps or walks ids is a stream: a loop over a visit callback, which answers whether to go
on (generators measured slower: relation traversal 2.3×, `linkedWith` +47%). A builder is a recipe: chaining runs
nothing, and every terminal runs the whole query against the data as it is then, so a predicate runs once per entity
per terminal. 1,000 `query(type).first()` over 40k 3,815 → 0.25 ms, 100 `linkedWith` 49.4 → 44.7 ms.

### 8. Writes committed when they return (review item 9) — taken up by an experiment
Built as Step 0 of [ears-in-memory-engine.md](ears-in-memory-engine.md): the strongest version of the in-memory
design, built beside Step 10 and judged against it on the same harness, bench and production readings.

### 9. Relations are not entities
Done, 2026-10-24, with two of its follow-ups:

- A relation is a row of its own, not an entity: the entity index doesn't list it and `query` doesn't reach it.
- **One relations module** (`relations.ts`) owns each relation's row and its adjacency, with every relation write and
  read; each entity's relations of a kind are an insertion-ordered set. Link 10k tasks to one project, then destroy it:
  4,054.70 → 38.40 ms; bulk load of 100k relations 144.50 → 126.41 ms.
- **Relations have their own operations:** `getRelation`, `findRelations`, `updateRelation` and `removeRelation`, the last
  two refusing an id no relation has (`NO_SUCH_RELATION`). A relation's id is an `EARS.RelationId`, which `write`
  refuses at compile time (`WriteTarget`). Relations through `write`, the alternative, is deferred in
  [deferred/relation-write-builder.md](deferred/relation-write-builder.md).
- The third follow-up, numbering rows out of the entity index, is Step 10's `['s', key]`.

### 10. The engine on an ordered key-value seam

Six steps, each shippable with its own checks. The first two land on today's engine, so the cut-over carries less.

#### 10.1 Declared indexes, and the order question settled
- `indexes` on an entity's manifest entry, written into the row rules and `SDK_ROW_RULES`; codegen refuses a field the
  shape doesn't declare; `apack.schema.json` regenerates.
- Today's value index covers declared kinds and roles only; a `where` on any other field filters the walk. The
  development warning for an unindexed `where` over a large type.
- Each pack's `indexes` chosen from its `where` calls.
- The open order question measured and decided: the callers that read a query's order without an `orderBy`, and what a
  sequence costs a create.

**Done when:** a `where` on an undeclared field finds every match and one on a declared field reads the index (a spec
counting reads); codegen refuses an undeclared field, mutation-checked; the warning fires once per call site; the order
question is recorded here as decided.

#### 10.2 The `OrderedKV` seam and `MemoryKV`
- `OrderedKV`: `get`, `range` (with `start`, `end`, `reverse`, `limit`, keys only), `put`, `del`, and transactions: a
  read snapshot, and a write unit that reads its own writes and commits or aborts whole.
- `MemoryKV`, for tests only, never the app: a sorted map whose snapshots and units behave exactly as LMDB's, which is
  what makes a test on it a test of the app.
- One contract spec, run against both backends: ordering of array keys, snapshot isolation (a snapshot doesn't see a
  later commit), a unit reading its own writes, abort leaving nothing, and a range closed on `break` and on a throw.

**Done when:** the contract spec passes on `MemoryKV` and on an LMDB backend opened on a temp directory.

#### 10.3 The engine over the seam
- Attribute storage and the relations module become the key layout above, over `OrderedKV`; the trash moves between
  `['e', …]` and `['d', …]`; numbering moves to `['s', key]` and `Sequence` leaves the reserved types.
- The read path above, with each terminal's snapshot and the unit's write transaction inside `transact`.
- The app still boots by loading the LMDB files into a `MemoryKV`, a bridge this step adds and 10.4 deletes, so the
  cut-over to disk is one change on its own.

**Done when:** the contract suite passes unchanged on `MemoryKV`; the bench is within tolerance of Step 9's readings;
a spec counting reads shows `first()`, `exists()` and `limit(n)` stop early and a live query reads no trashed entity.

#### 10.4 The app on LMDB
- The LMDB backend with format 4, and a 3 → 4 step in `scripts/ears-convert.ts`. Only the developers' own data is in an
  older format, converted explicitly, on a copy.
- The durability design: synchronous commits without a sync, the group-commit sync, the sync a client's delivery
  requests at the bus, `durable()` and `transact(fn, { durable: true })`, and the environment opened through one
  function. Reset and import as transactions (`replaceWith(dir)`).
- The host, API, CLI and SDK test runtime cut over. Deleted: hydration, the bridge from 10.3, the sink, the adapter,
  the journal and `LmdbReader`.
- The development check that freezes returned values in tests.

**Done when:**
- the contract suite passes unchanged on both backends;
- a write survives a child killed with SIGKILL right after it returns;
- a write a client's message caused is synced without a `durable()` call, a flow's is not synced per commit, and a
  write behind `durable()` is on disk when it resolves (the sync count observed through the backend);
- a thousand queries that break early or throw leave the environment's reader count where it was (lmdb-js
  `readerList()`).

#### 10.5 Measured
- Boot, heap, the test run's time and the bench against the readings above and the Step 4 baseline, the `orderBy`
  regression from Step 6 included; the bench's `first()`, `limit`, indexed-`where`, traversal and 10k-edge hub cases on
  LMDB.
- The write path profiled: a create and an update on format 4 (`node --cpu-prof`, self time per package). Without a
  sync the spike measured 115 µs a create against a ~20 µs commit; the rest was write amplification, which format 4's
  layout and declared indexes cut. Only if the binding's crossings still dominate does a native layer earn its place,
  and then an existing binding (`heed` through napi-rs) before LMDB bindings of our own.
- Query latency at p99 with a cold page cache on the production-size copy. If a cold read stalls the API's main
  thread, warming at boot or moving large reads off it is decided with that number.
- `getSchemaStats`' key-only walk on the production-size copy.

**Done when:** each reading is recorded here.

#### 10.6 What the systems keep in their contexts
An audit: a system that holds entity lists to answer `SEND_STATE` is a second copy of the data in app code. Each one
either keeps only what it publishes or reads it back when asked.

**Done when:** each system holding entity data is listed here with what it keeps and why.

Narrowing the two locks for multi-process writes follows Step 10.

## Out of scope

- The typed contract (`entities.ts`, `runtime.ts`, `typed.ts`): Step 10 changes no type packs see. Declared indexes add
  a manifest key (`indexes`), not a type.
- `PACK_SNAPSHOT_FORMAT`. Steps 1–9 keep LMDB format 3; Step 10.4 is format 4.
