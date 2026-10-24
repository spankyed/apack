# The in-memory path: writes committed when they return, and thread messages in a record store

Status: deferred by decision, 2026-10-23. This is the road not taken by
[ears-storage-layout.md](../ears-storage-layout.md): the engine moves to disk (its cut-over, Steps 1–6) instead of staying in
memory with these two fixes. Resume only if the cut-over is abandoned, or stalls long enough that the silent write loss
(Part A) has to be fixed first. If the cut-over lands, close this: it deletes Part A's subject, and with one copy of the
data no field is too large for the engine, which is Part B's.

## Context

The engine is in memory: at boot the API hydrates every row of the database (`store.hydrate()`,
`packages/api/src/runtime/index.ts`) and every read after that is a memory read. LMDB is a mirror the engine writes
through a sink. Two costs follow, and each part below fixes one while keeping the engine in memory.

**What real data costs** (measured 2026-10-23, copies converted to format 3, the built engine, 3 runs each):

| Data | Entities (relations) | Attribute values | Hydrate | Heap |
|---|---|---|---|---|
| The lead developer's production data (`abuddy/ears-db`, 292 MB) | 68.6k (45.8k) | 224k | 1.3–1.5 s | 308 MB |
| The dev data dir (`apack-dev`) | 559 (325) | 2.4k | 22 ms | 1.4 MB |

Of the production data's 171 MB of values:

| Field | Rows | JSON |
|---|---|---|
| `Message.blocks` (thread transcripts) | 7.5k | 141 MB |
| `Artifact.content` | 2.0k | 13 MB |
| `Message.text` | 19.8k | 7 MB |
| Relations (details and ids) | 45.8k | 6.6 MB |
| everything else | | under 2 MB |

The probes are `npm run bench:heap -w @apackdev/ears` for the bench graph, and for real data a read-only hydrate of
a converted copy (`openLmdbStore({ readOnly: true })`, then `getSchemaStats()` and each row's JSON size). Never open
a running app's files: copy `data.mdb`, convert the copy with `scripts/ears-convert.ts`, measure that.

## Part A — writes committed when they return

**Why.** `lmdb/adapter.ts` buffers writes and flushes them in a microtask; a row that fails is dropped and reported
through `onWriteFailure` after the writer has moved on, so memory runs ahead of disk with no signal to the code that
wrote. A production app dropped 3,187 writes in one session that way. The main environment also opens with default
sync, so every flush is an `F_FULLFSYNC` on the API's main thread (3.5–8 ms in the spike), twice for a `transact`.
And a backup can miss a write: `copyTo` (`lmdb/store.ts`) starts LMDB's `backup` in the turn it is called, before
the adapter's microtask flush, so a write made earlier in that same synchronous turn is not in the copy (anything
from an earlier turn has been flushed already).

**Design.**

- **Every write is a unit.** The journal gains `unit(fn)`: `fn` inside the open unit, or as a unit of its own when
  none is open. The write builder's operations, `create`, `upsert`, `updateRelation`, and the storage's mutators
  (so the admin face's direct writes too) go through it.
- **The journal commits before it forgets.** The outermost unit sends its held calls between `onUnitStart` and
  `onUnitEnd`, and keeps its undos until `onUnitEnd` returns; a sink that throws runs them in reverse and rethrows,
  so memory never holds what disk refused. `onUnitStart` resets the adapter's collected steps, so a call that threw
  mid-unit leaves nothing behind.
- **The adapter commits synchronously**, one `transactionSync` per unit (block-bodied callbacks), and throws.
  Removed: the buffers, `DROPPED`, `discardBuffered`, the row-by-row retry, `getErrorStats`, `onWriteFailure` and
  the API's `reportDroppedWrite`.
- **Durability:** commits with `NO_SYNC_FLUSH` on an environment opened with `overlappingSync: false`; a 1 s unref'd
  timer runs `root.sync()` (asynchronous, off the main thread) when something was written; `close()` makes one
  flushed write (a `meta` row), which makes every commit before it durable, since lmdb-js has no synchronous sync.
  Safe from app crashes, ~1 s lost on an OS crash (decided 2026-10-23).
- **Reset and import are transactions.** `reset()` clears the data databases in one transaction, keeping the stamp,
  and becomes synchronous, so app reset runs `store.reset(); engine.clear()` with no write between them. Import is
  `replaceWith(dir)` on both store kinds: open the candidate read-only, clear, copy its rows, one transaction; the
  rollback is `replaceWith` of the rollback copy. Removed: `reopen`, `heldForReset`, `openFailure` and the carried
  error stats; the running app's store never closes.
- **A backup holds every write made before it.** With nothing buffered, `copyTo` copies what is committed, which is
  every write that returned. Until Part A lands, the gap closes on its own with a flush of the adapter before
  `backup` (three lines in `copyTo`); a spec writes and backs up in one turn and reads the write from the copy.

**Costs.** Every write records an undo, as a `transact` write does today (1,000 creates: 4.5 ms alone against
6.9 ms as one unit, an upper bound to measure). A full disk surfaces as an error in the system that wrote rather
than as silent loss. `PersistenceSink` (in the change-controlled `runtime.ts`, though not part of the typed contract
packs see) loses `getErrorStats`; `api:update` moves.

**Done when:** a child killed with SIGKILL right after a write returns reopens with it; a commit that fails leaves
memory unchanged and throws; reset and import work while systems keep writing; a backup started in the turn of a
write holds it; each mutation-checked; the bench
records the implicit unit's cost.

## Part B — thread messages and their artifacts in a record store

**Why.** A transcript is a log: appended, read one thread at a time, never queried across threads, and growing
without bound — the same diagnosis that moved run history out of the engine
([run-history-store.md](../run-history-store.md)). It is 88% of the production data's values.

**Today.** A thread `contains` its messages and `has` its artifacts
(`default-setup/src/features/threads/be/repository/index.ts`): messages are read per thread in order
(`query.ids(threadId).out(CONTAINS, Message).pick(messagePickFields)`), one is read or updated by id, and deleting a
thread unlinks and destroys its messages.

**Design.**

- A record store per kind, `thread-messages` and `thread-artifacts` (`openRecordStore`), indexed by `threadId`, ids
  time-sortable so an index range is creation order. No retention: unlike run history these are the user's content,
  kept until the user deletes them.
- A repository over them in the threads feature (`messages.forThread(id, page)`, `get`, `add`, `update`, `remove`,
  `removeThread`), replacing the engine reads above. A thread keeps its own row in the engine; messages and
  artifacts stop being entities and their `contains`/`has` relations go.
- Backups gain the two stores (`BackupStores`), and the app's reset and import cover them, as they cover the run
  history.
- The developers' data moves explicitly, on a copy, with a conversion step in `scripts/ears-convert.ts`: each
  `Message`/`Artifact` row and its relation becomes a record. Nothing converts at boot.

**Open before starting.** Whether anything reads messages across threads (search, references, a note embedding a
message), which would need an index or a reason to stay in the engine; and whether `Message` and `Artifact` are
SDK-visible types any other pack queries.

**Done when:** the threads specs pass on the record stores; hydrate and heap on a converted copy of the production
data are re-measured against the table above (expected: the 141 + 13 MB of values out of the heap).

## What this leaves

The in-memory engine and its rules: a new feature with large or unbounded data has to know to keep it out of the
engine, and a read returns stored values by reference. Those, and tests running a memory engine whose sink stores
nothing, are what ears-storage-layout.md's decision weighed against this path.
