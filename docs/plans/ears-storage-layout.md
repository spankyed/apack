# EARS storage: layout, relations, queries and write durability

Status: **the cut-over is complete**, 2026-10-24: the app runs on LMDB with no in-memory copy of the data, Steps 1–6
done (each records how, below). PR #273.
Every reading Step 5 asks for is recorded, production size and a cold page cache included. Takes up review items 6
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
- **What the done work left in memory:** attributes by entity (`attribute-storage.ts`), one relations module owning each
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
  listings have no engine entities to step around, and `Sequence` leaves `RESERVED_ENTITY_TYPES` (the last
  follow-up of relations not being entities, done here).
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

**Reads stream from LMDB cursors, one read snapshot per terminal** (decided 2026-10-24). The lazy query builder is
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

**Insertion order or id order: insertion order stays** (decided 2026-10-24, Step 1). The contract pins insertion
order, which costs `['e', type, seq]`'s sequence and the `seq` in `['i', id]` and in every index key. Engine-minted
ids are time-sortable, so id order is creation order for them; ids given explicitly (an import's, a compiled flow's or
node's, named after it) are not, and two ids minted in the same millisecond order by their random suffix. Measured:

- **Who reads the order without an `orderBy`.** Every type walk, raw listing and index read was switched to id order and
  every unit suite run against it. Outside the ears contract specs (17 cases that pin the order), one product path
  failed: exporting actions and prompts (`export-round-trip.spec.ts`, 4 cases), which writes `all()` in creation order
  and loses it for rows created in one millisecond. The sdk (1,273) and host (1,761) suites and the rest of the pack
  pool (919) passed.
- **What the sequence costs a create.** On LMDB, a create of four attributes and `['i', id]` in one `transactionSync`
  without a sync (`NO_SYNC_FLUSH`, `overlappingSync: false`), median of 5 runs of 5,000: 26.3 µs with the `['m', 'seq']`
  read and write and a sequence key, 25.1 µs with the id in the key instead — 1.2 µs, about 5%.

The sequence is cheap, a product path reads the order it gives, and id order would make same-millisecond creates and
every explicitly named entity order arbitrarily. Format 4 keeps it.

## Steps: the engine on an ordered key-value seam

Six steps, each one commit, shippable with its own checks; Step 1 lands on today's engine, so the cut-over carries
less. Engine changes are measured against the baseline under Done. The ears contract suite (`tests/engine/`) pins
behaviour throughout; a pure re-layout needs no new spec.

### How to carry out the steps

- Commit as you go. Open a PR before completing.
- No need to run the chain before each commit. Rerun only after fixing a failure you caused, or after a few turns to
  verify.
- Record benchmark numbers. Don't over-tune code to hit them, but make any obvious algorithmic improvements and
  optimisations you notice.
- **Done:** Step 6 is done, the app runs on LMDB with no in-memory copy of the data, and this plan's status says the
  cut-over is complete.
- **Blocked:** after multiple diagnosis attempts, write the blocker, the evidence and the next action into this plan's
  status. Commit any finished part that passes, then stop.

### 1. Declared indexes, and the order question decided
- `indexes` on an entity's manifest entry, written into the row rules and `SDK_ROW_RULES`; codegen refuses a field the
  shape doesn't declare; `apack.schema.json` regenerates.
- Today's value index covers declared kinds and roles only; a `where` on any other field filters the walk. The
  development warning for an unindexed `where` over a large type.
- Each pack's `indexes` chosen from its `where` calls.
- The open order question measured and decided (under Open): the callers that read a query's order without
  an `orderBy`, and what a sequence costs a create.

**Done when:** a `where` on an undeclared field finds every match and one on a declared field reads the index (a spec
counting reads); codegen refuses an undeclared field, mutation-checked; the warning fires once per call site; the order
measurements and the decision are recorded under Open.

Done, 2026-10-24.
- The manifest's `indexes` (`apack.schema.json` regenerated) reach the row rules through codegen, which refuses a field a
  shaped entity's shape doesn't declare; an unshaped entity's (`IndexedDoc`, `SearchIndex`) are taken as given.
  `SDK_ROW_RULES` declares the SDK's (Action `label`, `category`; Prompt `label`; Document and Collection `name`), and
  `SDK_INDEXES` adds `contentKey` to every type's, which the content applier finds an item by on whatever type wrote it
  (`_withSdkIndexes`, given to both engines the SDK and the app create). The engine always indexes `role` and `shortCode`.
- An index is per type and field, built from the type's rows on its first read and kept by `place`. A `where` on a type
  start reads it where the type declares the field and filters the type's rows where it doesn't; past a start (ids, a
  walk) a `where` tests each id. Values an index holds: `null`, booleans, finite numbers, strings up to 256 characters.
- The read count is observed through the engine's `warn` port, which reports how many rows an unindexed `where`
  filtered: 2,500 for an undeclared field, nothing through a declared one (`tests/engine/queries.spec.ts`, "declared
  indexes", each path mutation-checked). The app passes `warn` in development, logged once per call site; the site is
  the first stack frame outside the engine's own directory.
- default-setup declares Thread `pinned`, Note `title` and `linkTargets`, SearchIndex `folderId`, IndexedDoc `indexId`
  and `chunkKey`, from its `where` calls (Thread `status` appears only in prompt examples and the Database view's
  sample queries).
- Bench (mean ms, memory; the bench's Tasks now declare `status` and `title`, as an app's would): where and pickAll 6.59,
  1,000 unique-value lookups 1.01, 10 lookups on an unindexed field walking all 40k Tasks 58.7 (5.9 ms a walk),
  100 withRole 8.34; the rest within noise of the readings under Done.

### 2. The `OrderedKV` seam and `MemoryKV`
- `OrderedKV`: `get`, `range` (with `start`, `end`, `reverse`, `limit`, keys only), `put`, `del`, and transactions: a
  read snapshot, and a write unit that reads its own writes and commits or aborts whole.
- `MemoryKV`, for tests only, never the app: a sorted map whose snapshots and units behave exactly as LMDB's, which is
  what makes a test on it a test of the app.
- One contract spec, run against both backends: ordering of array keys, snapshot isolation (a snapshot doesn't see a
  later commit), a unit reading its own writes, abort leaving nothing, and a range closed on `break` and on a throw.

**Done when:** the contract spec passes on `MemoryKV` and on an LMDB backend opened on a temp directory.

Done, 2026-10-24.
- `src/kv.ts`: the seam (`OrderedKV`: `read`, a snapshot; `write`, a unit; `KvReader`/`KvWriter` with `get`, `range`,
  `put`, `del`) over a byte backend (`KvBackend`). The seam encodes keys with `ordered-binary` and values with
  `msgpackr`, the encodings LMDB uses, so both backends store the same bytes in the same order: LMDB opens its database
  with binary keys and values, compared byte for byte. Both are pure-JS dependencies of `@apackdev/ears` now (versions
  shared with `lmdb`'s); only `/lmdb` loads `lmdb`.
- What is the same on both lives in the seam, over the bytes: prefix ranges (a key's elements are separated by a 0 byte,
  so a prefix and 0 is the lowest key under it and a prefix and 1 is past them), a unit's reads going through it, and a
  unit inside another as a savepoint: the first write of a key in it records what the key held, and a throw puts that
  back, the outer unit taking over what a nested one recorded when it commits.
- `createMemoryKV()` (`createMemoryKVBackend`): every key as a byte string in one sorted list, each with its committed
  versions, so a snapshot reads the version it began at while later units commit; a unit holds its writes apart, its
  ranges merging them with what is committed as two sorted runs read by index, so a range that stops early reads only
  what it visited. Versions no open snapshot can read are dropped when the last one closes. For tests and tooling —
  the SDK test runtime, the harness, the CLI's flow compiler — never the app.
- `src/lmdb/kv-backend.ts` (`createLmdbKVBackend`): a snapshot is one `useReadTransaction()`, released in `finally`; a
  unit is one `transactionSync` committing without a sync (`ABORTABLE | SYNCHRONOUS_COMMIT | NO_SYNC_FLUSH`). Every range
  is a `for…of`; a reverse range adjusts LMDB's bounds (its start inclusive, its end exclusive) to the seam's.
- `tests/lmdb/ordered-kv.spec.ts`, each case run on both backends: key order (null, booleans, numbers, strings, element
  by element; `['a']` is no prefix of `['ab']`), prefix, bounds, direction, limit and keys-only ranges, values as fresh
  copies (Dates, nested values and `undefined` fields), snapshot isolation, a unit reading its own writes, abort and
  nested abort, and a thousand ranges that stop early or throw. On LMDB, `readerList()` holds at most the one shared
  reader after reads and writes interleave. Each mechanism mutation-checked; leaking a cursor inside a snapshot isn't a
  failure, since the snapshot's transaction is what holds the slot.

### 3. The engine over the seam
- Attribute storage and the relations module become the key layout above, over `OrderedKV`; the trash moves between
  `['e', …]` and `['d', …]`; numbering moves to `['s', key]` and `Sequence` leaves the reserved types.
- The read path above, with each terminal's snapshot and the unit's write transaction inside `transact`.
- The app still boots by loading the LMDB files into a `MemoryKV`, a bridge this step adds and Step 4 deletes, so the
  cut-over to disk is one change on its own.

**Done when:** the contract suite passes on `MemoryKV`, weakening nothing; the bench is recorded against the readings
under Done, any case past +10% reported; a spec counting reads shows `first()`, `exists()` and `limit(n)` stop early
and a live query reads no trashed entity.

Done, 2026-10-24.
- **The engine is written on the seam.** `store-access.ts` (`createStoreAccess`) gives the modules their reads and
  writes: a read runs in the snapshot or unit already open, or opens a snapshot; an engine operation's writes join the
  unit open, as a statement joins its transaction; `unit` (what `transact` runs in) is a savepoint inside another.
  `attribute-storage.ts` and `relations.ts` are the key layout above, with three keys it didn't name:
  `['x', type, kind, value, seq]` (an index is per type and field, as Step 1 declares it), `['xb', type, kind]` (an index
  is built on its first read, from the type's rows, and kept once built), and `['b', source, kind, target, seq]` →
  relId (the edges between two ends: a link finds the edge it would repeat without reading a hub's thousands; linking
  10k edges to one entity was quadratic without it, 3 s for 1k). A relation's id is `Relation-<time><seq>`, so ids sort
  in the order relations were made.
- **Rollback is the seam's.** The journal keeps a unit's commit-time checks and holds its sink calls until the outermost
  unit commits (until Step 4 deletes the sink); its undo log is gone.
- **Keys are encoded by a codec of the seam's own** (`kv.ts`): a tag byte per element, a string's UTF-8 ended by 0, a
  number as eight order-preserving bytes. `ordered-binary`'s `readKey` was 3 s of a 6 s profile of the bench's cases;
  neither backend needs it, both comparing bytes. Values are `msgpackr` with maps decoded as `Map`s and rebuilt as
  objects, since decoding straight to an object renames a `__proto__` key. `MemoryKV` keeps its keys in a chunked
  sorted list (an insert moves at most a chunk), since one sorted array made a load quadratic.
- **Numbering is `['s', key]`** and `Sequence` leaves `RESERVED_ENTITY_TYPES` (the SDK's manifest check follows it).
- **Each terminal reads in one snapshot**; `map`, `forEach` and `reduce` call back after it is released, so a callback
  reads its own writes. A start from types walks its range — `['e', …]` live, `['d', …]` trashed, both merged by
  sequence with the trash — and `count()` of a bare type is one get of `['c', type]`.
- **The bridge:** the app still hydrates its format-3 files into the engine, now in one unit (`admin.bulkLoad`), which
  Step 4 deletes with hydration.
- **The contract changed in three places, each spec updated:** an entity a throwing unit had destroyed comes back in
  its place rather than last (the store is left as the unit found it); schema stats are keyed in name order rather than
  first-seen; `Sequence` is no reserved type.
- **Reads counted:** `tests/engine/queries.spec.ts` ("reads") runs an engine over a `MemoryKV` that counts each get
  and each entry a range visits: `first()`, `exists()`, `limit(3)` and `count()` of a type read fewer than ten entries
  with 1,000 live and 1,000 trashed Tasks, and `ids()` reads the live thousand alone. Each mutation-checked.
- Suites: ears 265, sdk 1,273, host 1,761, the pack pool 923, all passing.
- **Bench on `MemoryKV`** (mean ms; the readings under Done for comparison) — every case is past +10%, as reading through
  a store that encodes every key and decodes every value is expected to be; `MemoryKV` is for tests and tooling, and
  Step 5 measures the app's backend:

  | Case | Before (memory engine) | `MemoryKV` |
  |---|---|---|
  | bulk load | 180.9 | 4,538 |
  | query by type with where and pickAll | 6.59 | 112.4 |
  | 1,000 where lookups by a unique value | 1.01 | 5.76 |
  | 10 where lookups on an unindexed field | 58.7 | 727.3 |
  | 100 withRole lookups | 8.34 | 237.0 |
  | 1,000 `query.ids(id)` lookups | 0.27 | 3.99 |
  | 3 chained steps (`orderBy('rank')`) | 11.4 | 250.9 |
  | relation traversal | 0.0025 | 0.0285 |
  | `orderBy` a string over 40k | 13.6 | 204.1 |
  | 1,000 `query(type).first()` over 40k | 0.27 | 4.73 |
  | 1,000 `getRow` | 0.17 | 16.2 |
  | `pickAll` over 40k | 14.1 | 474.5 |
  | 100 `linkedWith` | 44.4 | 453.8 |
  | link 10k tasks to one project, then destroy it | 40.6 | 271.6 |
  | 1,000 creates | 3.81 | 26.8 |
  | 1,000 short codes | 4.62 | 30.0 |
  | transact: 1,000 creates as one unit | 5.82 | 30.3 |
  | heap, graph loaded | 67.8 MB | 312.7 MB |

### 4. The app on LMDB
- The LMDB backend with format 4, and a 3 → 4 step in `scripts/ears-convert.ts`. Only the developers' own data is in an
  older format, converted explicitly, on a copy.
- The durability design: synchronous commits without a sync, the group-commit sync, the sync a client's delivery
  requests at the bus, `durable()` and `transact(fn, { durable: true })`, and the environment opened through one
  function. Reset and import as transactions (`replaceWith(dir)`).
- The host, API, CLI and SDK test runtime cut over. Deleted: hydration, Step 3's bridge, the sink, the adapter,
  the journal and `LmdbReader`.
- The development check that freezes returned values in tests.

**Done when:**
- the contract suite passes on both backends, weakening nothing;
- a write survives a child killed with SIGKILL right after it returns;
- a write a client's message caused is synced without a `durable()` call, a flow's is not synced per commit, and a
  write behind `durable()` is on disk when it resolves (the sync count observed through the backend);
- a thousand queries that break early or throw leave the environment's reader count where it was (lmdb-js
  `readerList()`).

Done, 2026-10-24.
- **Format 4 is one database, `kv`, holding the engine's keys** (`lmdb/store.ts`, `LMDB_FORMAT_VERSION = 4`), opened
  only through `openEnvironment`, which checks the stamp and sets `overlappingSync: false` for every process.
  `convertToFormat4` loads format 3's tables through an engine's `admin.bulkLoad` in one unit — entities by
  `createdAt`, relations under their ids — and keeps format 3's numbering rows (`Sequence-<key>`) as sequences
  (`['s', key]`), so a short code is still never handed out twice; `scripts/ears-convert.ts` runs it, on a copy.
  `scripts/short-codes-convert.ts` now rewrites a format 4 copy through an engine on the store.
- **Durability:** each unit commits with `NO_SYNC_FLUSH`; a sync runs once writes pause for `SYNC_IDLE_MS` (100 ms),
  and `SYNC_INTERVAL_MS` (1 s) after the first unsynced commit at the latest, off the main thread; `durable()` resolves once every
  unit before it is on disk; `transact(fn, { durable: true })` commits with the sync (`COMMIT_DURABLE`); `close()`
  syncs what is owed. Nothing asks for a sync on a user's action: the pause after it is the sync's cue, so its
  writes are durable within 100 ms of the last, which a burst of writes (a stream's 80 ms updates) shares as one
  sync per pause, or per second while it lasts.
- **Reset and import are units of the open store:** `reset()` deletes every key and `replaceWith(dir)` puts another
  database's entries in place of every key, each one durable unit, the store open throughout; the record store has
  `replaceWith` too. Nothing closes and reopens files, so nothing holds writes for a store that is briefly gone.
- **What asks `durable()`, against the plan:** reset and import do (durable units). A backup copies one read
  transaction of what is committed, so the source's sync is not what makes it whole. The content apply rides group
  commit: its record (`AppliedContent`) commits with what it wrote, so a sync lost to a power cut loses both, and the
  next boot applies the content again.
- **Deleted:** hydration and Step 3's bridge, the persistence sink (`PersistenceSink`, `noopSink`, `persistence`), the
  LMDB adapter, `envs.ts`, `LmdbReader`, the API's dropped-write report and `apack db`'s failed-close report — a write
  now commits or throws where it is made, so there is no write to fail later. Boot logs the database's size on disk
  and the heap in place of hydration's reading.
- **Two things the cut-over surfaced:** settings admission refused boot's first pack discovery once the engine could
  read the stored settings before the packs were found, so that discovery takes what is installed and leaves a stored
  value it makes invalid to recovery (`admitSettings`, `packs/catalog.ts`), as boot did when the engine was still
  empty at that point; and the backup validator read a stored `null` as no settings, now refused.
- **The test runtime freezes what it reads:** the SDK's `startTestRuntime` runs on `createMemoryKV({ freeze: true })`,
  so code that mutates a value a read returned fails in tests rather than appearing to work.
- **Done-when checks:** the contract suite runs twice, `ears` on `MemoryKV` and `ears-on-lmdb` on an LMDB store per
  engine, weakening nothing (359 cases between them); `tests/lmdb/store.spec.ts` holds the child killed with SIGKILL
  the moment its write returns; with the store's timers faked, a burst of units synced once, 100 ms after the last —
  a client's write or anyone's, with no `durable()` — and a steady stream synced at the 1 s cap rather than per
  commit; `durable()` by the sync count; a durable unit owing nothing; and a thousand early-stopping or throwing
  queries leaving `readers()` where it was.
- Suites: the host pool (12 suites) 5,865 and the pack pool, all passing; typecheck, lint and `check:specifiers`
  clean.

### 5. Measured
- Boot, heap, the test run's time and the bench against the readings above and the baseline, the `orderBy`
  regression from attributes by entity included; the bench's `first()`, `limit`, indexed-`where`, traversal and 10k-edge hub cases on
  LMDB.
- The write path profiled: a create and an update on format 4 (`node --cpu-prof`, self time per package). Without a
  sync the spike measured 115 µs a create against a ~20 µs commit; the rest was write amplification, which format 4's
  layout and declared indexes cut. Only if the binding's crossings still dominate does a native layer earn its place,
  and then an existing binding (`heed` through napi-rs) before LMDB bindings of our own.
- Query latency at p99 with a cold page cache on the production-size copy. If a cold read stalls the API's main
  thread, warming at boot or moving large reads off it is decided with that number.
- `getSchemaStats`' key-only walk on the production-size copy.

**Done when:** each reading is recorded here, or the prerequisite it lacked is.

Done, 2026-10-24. macOS (MacBook Pro), Node 23.11, lmdb 3.5.3, 76–80% idle (`npm run check:idle`) before and after each
run; the bench's graph (50k entities, 200k attributes, 100k relations) on an LMDB store in a temp dir; the engine in
`dist`.

- **Heap and boot** (`npm run bench:heap -w @apackdev/ears`, three runs, identical to 0.1 MB): **2.7 MB** of heap with
  the graph loaded, against 61.3 MB for the memory engine (the baseline) and 312.7 MB for `MemoryKV`. Opening the
  store again, creating the engine and counting what it holds (`admin.countEntities()`, the app's boot reading) takes
  **30.6 ms** (30.3–30.9), leaving 0.3 MB of heap; the memory engine's boot was loading the whole graph, 180.9 ms in
  the baseline and growing with the data. 78.9 MB on disk.
- **`getSchemaStats`**, a keys-only walk of the whole store: 323 ms (320–329) over the bench's graph; **480–492 ms on
  the production-size copy** below.
- **On the production-size copy** (2026-10-24, 78% idle): the app's production backup of 2026-10-17
  (`~/Develop/backups/abuddy-backups/full-db/…T23-06-18…`, 306 MB in format 1), copied and converted by
  `scripts/ears-convert.ts` in 6.9 s, 1 → 2 → 3 → 4: 22,816 entities in 13 types (19,803 `Message`, 2,033 `Artifact`,
  343 `Thread`, 280 `Note`), 178,131 attributes, 45,798 relations, 381 valueless rows skipped; 387 MB on disk after,
  since LMDB keeps the pages the old tables freed. With `COMPACT_COPIES` on, the script compacts the converted file
  (`compactEnvironment`), which takes it to 271 MB; the flag is off, because a compacted copy of this data aborts the
  process when a reset empties it, an lmdb-js bug fixed by kriszyp/lmdb-js#381
  ([the evidence and repro](../references/evidence/lmdb-compacted-copy-crash.md)). Read with the store open
  read-only, two runs each, both warm:

  | Reading | Production copy |
  |---|---|
  | boot: open the store, create the engine, count every type | 27.7 ms, +0.3 MB of heap |
  | `getRow`, 2,000 ids across every type | p50 0.016 ms, p99 0.30–0.35 ms |
  | `findRelations({ source })`, the same ids | p50 0.008 ms, p99 0.05–0.06 ms |
  | `query('Message').first()`, 200 times | p50 0.006 ms, p99 0.03–0.05 ms |
  | `query('Message').pickAll()`, 19,803 rows | 533–543 ms |
  | `query('Artifact').pickAll()`, 2,033 rows | 31–38 ms |
  | `query('Thread').pickAll()`, 343 rows | 4.8–5.3 ms |

  A read by id or by edge stays under half a millisecond at p99; what costs is a read of a whole large type, 27 µs a
  message row (messages hold their text), which on the API's thread is half a second. No product path reads every
  message today (a thread's messages are read by its edges); one that did would want paging rather than a warmer
  cache.
- **Cold page cache, on the same copy:** `purge` needs root, so the copy went onto a sparse disk image (`hdiutil
  create -type SPARSE -fs APFS`), which was detached — dropping its pages from the cache — and attached again before
  each run; the point reads ran first, so nothing warmed the pages they read. Two runs:

  | Reading | Cold | Warm |
  |---|---|---|
  | boot | 62.7–70.2 ms | 27.3–27.7 ms |
  | `getRow`, 2,000 ids | p50 0.021 ms, p99 1.0–1.1 ms | p50 0.016 ms, p99 0.30–0.35 ms |
  | `findRelations({ source })` | p50 0.009 ms, p99 0.46–0.57 ms | p99 0.05–0.06 ms |
  | `query('Message').pickAll()`, first of five | 687–708 ms | 533–562 ms |
  | `getSchemaStats`, read first | 799 ms | 480–492 ms |

  The image's backing file may keep pages in the host's cache below the image, so these bound a cold read from
  below; what they show is that a cold point read costs about a millisecond at p99 and nothing stalls the API's
  thread. Neither warming at boot nor moving reads off the main thread is called for.
- **The bench on LMDB** (mean ms, `npm run bench -w @apackdev/ears`; each case ran twice and the two agree within 5%,
  the first figure given):

  | Case | Baseline (memory engine) | LMDB |
  |---|---|---|
  | bulk load | 180.9 | 2,930 |
  | query by type with where and pickAll | 16.6 | 138.8 |
  | 1,000 where lookups by a unique value | 0.76 | 8.80 |
  | 10 where lookups on an unindexed field | — | 796.4 |
  | 100 withRole lookups | 12.0 | 90.4 |
  | 1,000 `query.ids(id)` lookups | 0.28 | 1.73 |
  | query by type with 3 chained steps (`orderBy('rank')`) | 11.8 | 85.3 |
  | relation traversal | 0.0025 | 0.058 |
  | `orderBy` a string over 40k | 11.9 | 90.7 |
  | 1,000 `query(type).first()` over 40k | 3,815 | 5.29 |
  | 1,000 `getRow` | 0.72 | 9.33 |
  | `pickAll` over 40k | 35.7 | 374.0 |
  | 100 `linkedWith` | 52.5 | 448.9 |
  | link 10k tasks to one project, then destroy it | 6,178 | 891.9 |
  | 1,000 creates | 4.50 | 139.9 |
  | 1,000 short codes | 4.43 | 97.8 |
  | transact: 1,000 creates as one unit | 6.93 | 23.7 |

  Reads that visit every row of a 40k type are 8–10x the memory engine's, and a read by id 6–13x: each row is a
  range of keys, read through a cursor and decoded, where the memory engine handed out the object it held. The
  `first()` and hub cases, which the memory engine walked or copied in full, are 720x and 7x faster. A bulk load is
  16x slower and is now a conversion's cost, not a boot's.
- **Production-shaped reads** (`bench/production.bench.ts`, 2026-10-24, 76% idle; data generated from the production
  copy's profile, `bench/production-shape.ts`: 22,816 entities in 13 types, 5,535 large values, 45,798 relations, a
  thread `contains` its ~58 messages; mean ms, two runs agreeing within 5%, the first given):

  | Case | LMDB |
  |---|---|
  | 100 threads opened (their messages, picked) | 70.0 |
  | 1,000 `getRow` on messages | 14.1 |
  | 1,000 `query('Message').first()` | 5.1 |
  | `pickAll` over the 343 threads | 4.2 |
  | 100 unindexed `where` lookups on the threads | 11.1 |
  | 1,000 `findRelations` from a thread, `contains` | 182.5 |
  | `pickAll` over the 19,803 messages | 285.6 |

  Opening a thread costs 0.7 ms, which is the read the app makes most; a message by id 14 µs. The whole-type read of
  the messages is the costly one, and no product path makes it.
- **The write path** (`node --cpu-prof`, 5,000 creates of four fields, then 5,000 updates of one, each its own unit,
  self time per package): a create 79 µs and an update 32 µs. lmdb-js is 58% of the time — the commit itself
  (`finishTxn`, LMDB writing the transaction's pages) 32%, and its per-write instruction buffer 11% — the engine 18%,
  `msgpackr` 5%. Under one unit, 1,000 creates take 23.7 ms, 24 µs each: per commit, not per key, is where a write's
  cost is, which `transact` already batches. A create read 23 keys to write 12; reading the value a write replaces
  only where its index is built (`43579628f`) makes it 18 reads, and an update 5 rather than 7. The binding's
  crossings are not what dominates, so no native layer is called for.
- **The app on real data, end to end:** a copy of the development data dir (format 3), converted by
  `scripts/ears-convert.ts` — 232 entities, 1,582 attributes, 325 relations, 2 sequences — and the built API booted on
  it as the guide's manual boot does. It installed and applied default-setup's content, started the brain's root flow,
  and ran the reconcile actions over the stored threads and artifacts, all successful; boot logged `Database 2.0 MB on
  disk, heap 120.7 MB` (the whole process: the packs' code and the API). Stopped by its pid, the copy read back with
  `apack db query` holds what that boot committed (the applied content's revision, the app version). The run found
  one defect, fixed: format 3 held 469 attribute rows with no value (`{ t: 'undefined' }`: `actionFn`, `description`,
  `final`, `mode`, `params`, `fieldMappings`), which its hydration read as absent and the conversion refused; it now
  skips and counts them (`emptyAttributes`).
- **The app on the production-size copy, end to end:** the built API booted on the converted production backup as
  well. Its first boot went into settings recovery, as designed: the backup's `Settings-app` row is in the pre-0.4
  shape (`general`, `plugins`, …), which the current contract refuses. With that row cleared on the copy
  (`apack db clear-settings --schema-from packages/default-setup --force`), it booted fully: default-setup installed and
  its content applied, the brain started its root flow, 281 notes' `REFERENCES` relations were rebuilt from their text,
  seven terminals restored, `Database 368.7 MB on disk, heap 120.2 MB`; stopped by its pid, its shells exited with it.
  The backup's root flow names a step type no pack provides now (`flow`), which the brain reports and steps past —
  a property of that data, not of the store.
- **Test time:** `npm run chain -- --no-native` passed in 870.4 s on a 10-core budget (Steps 1–3's run: 821.6 s), every
  step run: `test:unit:host` 69.6 s, `test:unit:pack` 42.1 s, `test:integration` 576.6 s, `test:smoke` 13.0 s.

### 6. What the systems keep in their contexts
An audit: a system that holds entity lists to answer `SEND_STATE` is a second copy of the data in app code. Each one
either keeps only what it publishes or reads it back when asked.

**Done when:** each system holding entity data is listed here with what it keeps and why.

Done, 2026-10-24: no system keeps a second copy of the data. Read from each system's declared context
(`be/contract.ts`) and the module state of its backend (`new Map`/`new Set` at module scope):

| System | What it keeps | Entity data? |
|---|---|---|
| `default-setup/library` | nothing | Its context declared entity lists (`documents`, `collections`, `currentItems`) that nothing wrote or read; removed. Its views read the repository when asked |
| `host/settings` | `applied`: each feature's effective settings as last told, to send the next `FEATURE_SETTINGS_UPDATED` only to features whose settings changed | What it publishes, derived from the one `Settings` row; kept |
| `default-setup/brain` | `eventQueue` (events waiting for the brain actor); module state: running flow actors, trigger listeners and cron jobs | No rows: run state and callbacks keyed by flow and trigger ids, rebuilt from the flows |
| `default-setup/logs` | `logs`: the process's log events | Not EARS data |
| `default-setup/code` | the browsed directory, a git repository handle and its watcher; module state: CLI and process handles, a git command cache | No |
| `default-setup/library` search index | `indexCache` (vector indices) | Dormant: switched off, and its vectors are files |
| `actions`, `database`, `flows`, `notes`, `prompts`, `threads`, `browser`, `host/packs`, `host/application` | no context, or an empty one | No |

Narrowing the two locks for multi-process writes follows these steps.

## Done

The in-memory work, each a commit measured against the baseline below.

### Close PR #261
Done, 2026-10-23: closed unmerged, pointing here. Its key layout and measurements are in the goal; the spike's code is
not reused.

### `link` idempotence by structural equality
Done: `link` compares `info` structurally, not by `JSON.stringify`, so key order makes no duplicate edge.

### `orderBy`: decorate-sort, collator, type order
Done: each value is read once, then sorted; strings compare with one cached `Intl.Collator`; mixed types order by type,
then value; undefined stays last. 3 chained steps 27.8 → 11.8 ms, `orderBy` a string 14.9 → 11.9 ms.

### The baseline
Done, 2026-10-23. `bench/ears.bench.ts` times the engine in `dist` (`npm run bench -w @apackdev/ears` builds first);
`bench/heap.ts` (`npm run bench:heap`) reads the heap with the same graph loaded. The bench graph holds 8 attribute
kinds, so `getRow`'s O(K) showed less here than in the app, which holds hundreds.

Baseline (mean ms, after the `orderBy` rework; macOS, Node 23.11, lmdb 3.5.3, the bench's 50k entities / 200k attributes / 100k
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

### Rewrite `goal-lmdb-only.md`
Done, 2026-10-23: it holds the cut-over's first design, the spike's measurements and the lock analysis.

### Attributes by entity (review item 6)
Done, 2026-10-23. Each row is a plain object, not a `Map` (mean ms against the baseline):

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
Relations leaving the entity map took them out of it; Step 5 measures it again on LMDB. A field named `__proto__` is set as an own
property (`setField`), with a spec.

### Lazy queries
Done, 2026-10-23. A step that keeps or walks ids is a stream: a loop over a visit callback, which answers whether to go
on (generators measured slower: relation traversal 2.3×, `linkedWith` +47%). A builder is a recipe: chaining runs
nothing, and every terminal runs the whole query against the data as it is then, so a predicate runs once per entity
per terminal. 1,000 `query(type).first()` over 40k 3,815 → 0.25 ms, 100 `linkedWith` 49.4 → 44.7 ms.

### Writes committed when they return (review item 9) — dropped
With one copy of the data there is nothing to roll back, so the journal, the adapter, the sink and hydration go in
the cut-over instead of being reworked. Its design is kept, with moving thread messages out of the engine, in
[deferred/ears-in-memory-path.md](deferred/ears-in-memory-path.md), the path not taken.

### Relations are not entities
Done, 2026-10-24, with two of its follow-ups:

- A relation is a row of its own, not an entity: the entity index doesn't list it and `query` doesn't reach it.
- **One relations module** (`relations.ts`) owns each relation's row and its adjacency, with every relation write and
  read; each entity's relations of a kind are an insertion-ordered set. Link 10k tasks to one project, then destroy it:
  4,054.70 → 38.40 ms; bulk load of 100k relations 144.50 → 126.41 ms.
- **Relations have their own operations:** `getRelation`, `findRelations`, `updateRelation` and `removeRelation`, the last
  two refusing an id no relation has (`NO_SUCH_RELATION`). A relation's id is an `EARS.RelationId`, which `write`
  refuses at compile time (`WriteTarget`). Relations through `write`, the alternative, is deferred in
  [deferred/relation-write-builder.md](deferred/relation-write-builder.md).
- The third follow-up, numbering rows out of the entity index, is Step 3's `['s', key]`.

## Out of scope

- The typed contract (`entities.ts`, `runtime.ts`, `typed.ts`): these steps change no type packs see. Declared indexes add
  a manifest key (`indexes`), not a type.
- `PACK_SNAPSHOT_FORMAT`. The store is format 3 until Step 4, which makes it format 4.
