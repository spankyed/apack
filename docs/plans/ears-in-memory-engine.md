# The in-memory engine, done properly: an experiment beside Step 10

Status: active, 2026-10-24, on branch `session/ears-in-memory-path`. Steps 0–2 are done; Step 3 is next.

[ears-storage-layout.md](ears-storage-layout.md)'s Step 10 moves the engine to disk. This plan builds the strongest
version of the other design — the engine's memory is the database, and disk is how it is made durable and rebuilt —
and judges the two on the same evidence. Either result is useful: a better engine, or a measured reason for Step 10.

## The hypothesis

An in-memory engine can be correct, durable and bounded, keep reads at memory speed with no query planner and no
declared indexes, and give the app something a disk engine does not: every commit known as it happens, so queries can
be live. What it costs is resident memory and boot time growing with the number of entities — not with the size of
their values — and a single writing process, which tools reach through the app.

## Where it starts

**What the engine was:** memory as the read path and LMDB as a mirror of it, one key per attribute (`kind␟id`, JSON,
format 3). That is the costs of both designs at once: a write dirties scattered B-tree pages, boot decodes every
attribute row, and a failed write was dropped after the writer had moved on (3,187 in one production session).

**What it costs today**, measured 2026-10-23 on copies converted to format 3, the built engine, 3 runs each:

| Data | Entities (relations) | Attribute values | Hydrate | Heap |
|---|---|---|---|---|
| The lead developer's production data (`abuddy/ears-db`, 292 MB) | 68.6k (45.8k) | 224k | 1.3–1.5 s | 308 MB |
| The dev data dir (`apack-dev`) | 559 (325) | 2.4k | 22 ms | 1.4 MB |

Of the production data's 171 MB of values, `Message.blocks` is 141 MB and `Artifact.content` 13 MB; everything else is
under 10 MB. So the engine's *structure* — ids, small fields, indexes, relations — is about 10–20 MB, and almost all of
the heap is a few large values. Never measure a running app's files: copy `data.mdb`, convert the copy with
`scripts/ears-convert.ts`, measure that.

## The design

1. **A write is stored when it returns, or throws and memory forgets it.** Every write is a unit; the journal keeps a
   unit's undos until the store has committed it and undoes it in memory on a refusal. Commits are synchronous and
   unflushed, with a sync in the background, then group commit with durable points.
2. **Stored values are immutable.** A value is deep-frozen when it is written, so a read hands back the stored value
   itself — no copy, at memory speed — and code that changes a returned array fails at once rather than silently
   changing stored data (Datomic's model). It costs a freeze per write and nothing per read.
3. **Large values live out of line, automatically.** Any value over a threshold (2–4 KB serialized, measured) is stored
   on disk, and memory holds a marker; a read takes it synchronously from LMDB, which is memory-mapped, through a small
   LRU cache (Postgres's TOAST). Nothing is declared and no caller changes; queries, the Database console and the AI
   actions keep working, and the value index never indexed values that size. About 154 of the production data's 171 MB
   leaves the heap.
4. **Boot loads compact rows.** On disk an entity is one record of its small fields (msgpack, keyed by the entity),
   its large values in a database of their own that boot does not read. Hydration decodes ~68k compact rows instead of
   224k JSON attribute rows, and skips the large values. A format 4 for this path, converted explicitly on a copy.
5. **The app is the database server.** While the app runs it owns the data; `apack db`, scripts and agents reach it
   through its API (the token and the port exist) instead of opening its files, so they see live data and write
   through the same engine — one writer, many clients, the client/server norm. Offline, a tool opens the files as it
   does today.
6. **Commits publish what changed, and queries can be live.** The journal knows every key a unit touched; each commit
   emits its change set (entity ids and fields), and `subscribe(query, onChange)` runs a query again when its inputs
   change (Convex, Replicache). Today every feature hand-writes cache invalidation over the bus — `NOTE_UPDATED`, fetch
   slots, broadcasts, a section of default-setup's guide with its own catalogue of bugs. Views that subscribe delete
   that class of bug instead of documenting it, and it is what makes the app as a server pay: windows, tools and agents
   follow live data.

## Non-goals

- **No hand-rolled write-ahead log or snapshot format.** The textbook in-memory design is a log plus snapshots, and
  writing one correctly — torn writes, checksums, fsync semantics, compaction — is a project of its own. LMDB is
  crash-safe, transactional and memory-mapped already; it holds the row snapshot and the out-of-line values.
- **No in-memory MVCC** (persistent structures, a consistent view across an `await`) until a measured need: immutable
  values make it possible later, and it is not free now.
- **No public contract for memory management.** Nothing a pack author declares decides what stays in memory; the
  engine decides by size, and the API does not change.

## Steps

Each step lands on its own, measured against the one before it, and passes the harness of Step 1 from then on.

### 0. Writes stored when they return — done (`b3dc05d54`)
Every write is a unit (`journal.unit`, `unitWrites` over the storage and relation mutators and the write builder's
operations); the journal keeps a unit's undos until the sink has stored it; the adapter commits each unit as one
synchronous transaction (`NO_SYNC_FLUSH`, `overlappingSync: false` through `openEnvAt`) and throws on a refusal; the
store syncs every `SYNC_INTERVAL_MS` (1 s) and on close; `reset()` and `replaceWith(dir)` are transactions on the open
store for the database and the run history alike, and import installs every store in one synchronous stretch its
acceptance follows. Gone: `reopen`, the buffers, the row-by-row retry, `onWriteFailure`, `PersistenceErrorStats`, the
API's dropped-write report. Read on a loaded machine: 1,000 creates 7.2–8.6 ms against Step 4's 4.50 — what 1,000
creates in one `transact` cost (7.4–9.4 ms), the undo record every write now makes.

### 1. The correctness harness
Storage earns trust by technique, not by examples.
- **Model-based property tests** (`fast-check`): random sequences of creates, writes, links, destroys, units that
  return or throw, store refusals, resets and imports, run against the engine and a trivial reference model; after
  every step memory equals the model, and on reopen disk equals memory.
- **Crash injection:** a child runs a random workload and is killed (`SIGKILL`) at a random point; on reopen, what is
  stored is exactly a prefix of the writes that returned, in order.
- The store contract it subsumes, already specs: a write that returned survives a kill; a refused unit leaves nothing
  in memory or on disk; a backup started in the turn of a write holds it; `reset()` and `replaceWith(dir)` are each one
  transaction with the store open; a closed store refuses a write.

**Done when:** both run in the ears suite (a bounded number of runs, seeds reported on failure) and each fails under a
mutation of the journal's rollback, the adapter's unit commit and the store's close flush.

Done, 2026-10-24 (`packages/apack-ears/tests/harness/`). `model.ts` is the reference model and `stateOf`, `workload.ts`
the random workload over six ids (creates, sets, appends, deletes, links, unlinks, destroys, units that return or
throw, and the store refusing the next commit). `model-based.spec.ts`: 300 runs against the model, every write
compared, and 60 runs on an LMDB store reopened against memory; `crash.spec.ts`: 6 runs of a 400-write child killed at
a random acknowledgement. Each fails under a mutation: the journal's rollback removed fails both model-based
properties; the adapter's commit deferred to a microtask fails the files-against-memory property; deferred by 20 ms,
the crash property. The suite's cost: about 2 s and 3.5 s.

### 2. Immutable values
Deep-freeze a value as it is stored (`place`), so reads return it as it is. Freezing is the write's cost; a reading of
the bench decides whether it is done always or in development and tests only.

**Done when:** a spec shows a returned list and object cannot be changed, and the default-setup and pack suites pass
with values frozen — any code that changed a read's value fails there and is fixed at its source.

Done, 2026-10-24. `deepFreeze` (`utils.ts`) in `place`, the one memory write every attribute change, undo and
hydration goes through, and in a relation's row; a frozen object is skipped with what it holds, so a value is walked
once. Frozen always, not only in development: freezing measured within noise. The ears, SDK, host and API suites and
the pack pool pass with values frozen — no code changed a stored value. Readings (loaded machine): 1,000 creates
6.7 ms, bulk load 126 ms; the converted production copy hydrates in 0.97–1.24 s to 309.5 MB of heap (22.8k entities
now that relations are not, 45.8k relations, 178.5k attributes).

### 3. Large values out of line
A value whose serialized size passes the threshold is stored in its own LMDB database (`values`, keyed by entity and
kind) and held in memory as a marker; `getAttr`, `getRow` and `pick` read it synchronously through an LRU cache of a
bounded size. A write replaces or removes it in the same transaction; the journal's undo restores the marker. With no
store behind the engine (tests, the harness), a value stays in memory.

**Done when:** the harness passes; heap on the production copy is measured against 308 MB (expected: about the 10–20 MB
of structure plus the cache); opening a thread of the production copy is timed; the bench's read cases stay within
+10%.

### 4. The row format and fast boot
Format 4: an entity is one msgpack record of its small fields, keyed by its id, its large values in `values`;
relations as today. Hydration decodes the rows, not the attributes, and reads no large value. `scripts/ears-convert.ts`
gains the 3 → 4 step, run on a copy.

**Done when:** boot on the converted production copy is measured against 1.3–1.5 s (target: a few hundred
milliseconds); the harness and the contract specs pass on format 4.

### 5. Group commit and durable points
A commit returns at once; a sync runs on a short timer, on idle and on close; `await durable()` resolves once
everything committed so far is on disk, and `transact(fn, { durable: true })` syncs as it commits. Backup, export and
import ask for it.

**Done when:** a write behind `durable()` survives power loss as modelled by the harness (a kill with the environment's
unsynced pages dropped), and the write cases of the bench are read against Step 0.

### 6. Telemetry and budgets
The engine reports resident bytes per type, bytes out of line, the cache's size and hit rate, boot time, and commits
and syncs per second. The bench loads production-shaped data at its measured size and twice it, and fails past a
budget (boot about 300 ms, structure about 50 MB).

**Done when:** the readings are printed at boot and by `apack db inspect`, and the budget fails under a mutation that
keeps large values in memory. This is the honest trigger for when an in-memory engine stops being the right design.

### 7. The app as the database server
`apack db query`, `exec`, `script` and `runs` send their work to the running app's API when one runs on the data dir,
and open the files only when none does; the write lock then guards only tools working offline.

**Done when:** each command gives the same result against a running app and offline, and a write through the app is
seen at once by the app's own views.

### 8. Commit change sets and live queries
Each commit emits its change set; `subscribe(query, onChange)` on the engine, and through the SDK to systems and
surfaces, runs a query again when an entity it read changes. One feature moves its hand-written invalidation to a
subscription first, to price the rest.

**Done when:** a subscription sees exactly the commits that change its result (the harness extended to subscriptions),
and the moved feature's specs pass with its broadcasts deleted.

## Judging it against Step 10

On the same evidence, at the end and at each step that changes a reading:

| | Reading |
|---|---|
| correctness | the Step 1 harness and the store contract, run against both engines |
| reads | the ears bench's read cases |
| writes | the bench's write cases, and a durable write's latency |
| boot | the converted production copy, cold |
| memory | the engine's heap on the production copy, at its size and twice it |
| tools and agents | what a tool sees of a running app's data, and how it writes |
| what the app gains | live queries (Step 8); for Step 10, its own list |
| complexity | lines added and removed, and the public API either one changes |

## Coordination

Step 10 is being built in the main checkout over some of the same files (the journal, the adapter, the store). This
branch merges only once the comparison has a result, or one of its steps stands on its own and is agreed to land; until
then it rebases on master.
