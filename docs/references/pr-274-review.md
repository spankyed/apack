# PR #274 against the on-disk engine: what to take

Reviewed 2026-10-24. [PR #274](https://github.com/spankyed/apack/pull/274) builds the in-memory engine
(`docs/plans/ears-in-memory-engine.md`, Steps 0–8): memory is the database and LMDB is how it is made durable. This
branch, `ears-disk-engine` ([PR #273](https://github.com/spankyed/apack/pull/273)), builds the opposite: the engine
reads and writes LMDB and keeps no copy of the data (`docs/plans/ears-storage-layout.md`). Several things #274 builds
do not depend on that choice. This lists them in the order worth taking, with what each would cost here.

**Status, 2026-10-24:** everything worth taking is taken (under Taken already, below): the harness, the durability
spec, the sync policy, the prompts fix and production-shaped bench data. Compaction is behind a flag until lmdb-js
ships its fix (under Not taken, below).

## Head to head on the production copy

Both engines were read on the same production backup (2026-10-17, 306 MB in format 1), converted.

| | #274, in memory | #273, on disk |
|---|---|---|
| Heap after boot | 52 MB | 0.3 MB |
| Boot | 0.24–0.27 s | 28 ms warm, 63–70 ms cold |
| A read by id | memory speed | 0.3 ms p99 warm, 1.0–1.1 ms cold |
| 1,000 creates, each its own commit | 101 ms | 140 ms |
| 1,000 creates in one unit | 11.1 ms | 23.7 ms |
| A durable write | 3.5–4.8 ms | not read separately |
| Heap as the data grows | grows; gated at 64 MB per 1× of production-shaped data | flat |

#274's readings are its plan's "Judging it against Step 10" table; #273's are `docs/plans/ears-storage-layout.md`,
Step 5.

## Consider as later steps

### Live queries

#274's commits publish change sets (the entities, types, attribute kinds and relation kinds a unit wrote), and
`subscribe(read, onChange)` re-runs a read only when a commit touches what it read, calling back when its result
changed. The prompts system follows every writer this way, with its hand-written broadcasts deleted. Six more
features carry about 150 such broadcasts.

The design does not depend on memory: #273's units know what they wrote, and reads can record what they touched.
It is a new public contract and a migration of six systems, so it is a plan of its own, not a follow-up to #273.

### `apack db` through the running app

#274 serves `apack db query`, `exec`, `script` and `runs` from the running app (`POST /db`, with the API token), and
runs them offline when no app answers. A tool then sees the app's data and writes through its engine, with no write
lock.

On #273 half of this is free: LMDB is multi-process, so an offline read already sees what the running app has
committed. Writes are the other half: a tool's write reaches the files but not the app's systems, which publish only
when told. Serving through the app fixes that, at the cost of publishing the API token on every run (today only in
development, or when the API made up its own).

## Taken already

### The correctness harness

Ported in `c9eeec751`, then taken further than #274 went (`deb20b011`, `3210c24e7`):

- **Model-based** (`tests/engine/model-based.spec.ts`, `tests/_harness/`): after every op the engine holds what a plain
  reference model holds and refuses what it refuses, on a memory backend and on a refusing LMDB one. Beyond #274's,
  it checks the derived reads the engine keeps in keys of their own — a type's entities, count and trash, an indexed
  and an unindexed `where`, `withRole`, each kind's `out`/`in`, in order — and its workload adds trash, restore,
  grant, revoke and nested units.
- **Crash injection** (`tests/lmdb/crash.integration.spec.ts`): a child killed with SIGKILL at a random point; the
  reopened files hold the model's state after the acknowledged writes, or one more. It counts acknowledgements on
  `close` rather than `exit`, since stdout can still be draining at exit.
- **Dropped:** #274's reopen property compared the engine with its own files reopened, which on an engine that reads
  its files are the same bytes; it passed with deletes disabled.
- **What porting found.** #274's workload averaged six ops over less than one entity and refused nearly all of them
  (not one link accepted in 300 runs); every run now creates its ids first and mixes in an edge linked, unlinked and
  linked again. Extended, the model found an engine bug, fixed in `ae0b37b5b`: an index built on its first read made
  that read a write, so `withRole` and an indexed `where` threw on a read-only store or a full disk.
- **Mutation-checked:** a stale index entry, a trash that doesn't move its range key, a count blind to trash, a
  savepoint that doesn't undo, a stale incoming-edge key and a stale key between two ends each fail it.

### A deterministic durability spec

`tests/lmdb/durability.spec.ts`, with its fixes in `a34a2ba20`, as #274's is, but without a seam on the store: the spec wraps `lmdb`'s `open`, so each
environment's `sync` is one the spec finishes or fails, and fakes the store's timers. It holds which sync each
`durable()` waits for: one begun after the write, a write made during a sync waiting for the next, a running sync
shared, a sync queued behind a failed one, and nothing started when nothing is owed.

It found two defects in #273's store, fixed with it: a caller that joined a running sync was handed a promise that
swallowed the sync's failure, so it heard "on disk" for writes that weren't; and a failed sync cleared what was owed,
so the next `durable()` resolved without syncing at all. A failed sync now rejects every caller waiting on it and
leaves its commits owed, and a timer's sync queued behind a running one, which nobody waits on, is caught rather than
an unhandled rejection. Each of the four was mutation-checked.

### The prompts selection fix

A defect on master and on #273 alike, unrelated to either engine
(`packages/default-setup/src/features/prompts/fe/state.ts`): `PROMPT_UPDATED` for any prompt replaced the open one,
`PROMPT_DELETED` for any prompt closed it, and `PROMPT_CREATED` for a prompt already listed listed it twice. Fixed on
master in `c427e84fd`, which this branch is based on: the surface changes its selection only for the prompt an event
names, and a held prompt is replaced rather than added. `tests/features/prompts/fe/page-and-selection.spec.ts` covers
all three.

### Production-shaped bench data

`bench/production-shape.ts` is #274's profile of the production database, with a loader beside it
(`loadProductionShape`); `bench/production.bench.ts` reads it: a thread opened through its `contains` edges, messages by
id, the thread list, a `where` on the threads, and the whole-type read of the messages. A thread opens in 0.7 ms and a
message reads in 14 µs (the readings are the storage plan's, Step 5). #274's budget gates on heap, which an engine that
holds no data has none of, so the budget is not taken; the uniform graph in `ears.bench.ts` stays, being what the
recorded comparisons were taken on.

### Sync once writes pause

#274 syncs 100 ms after writes pause, and at most a second after the first unsynced commit. #273 adopted the same in
`c8d7de6ae` (`SYNC_IDLE_MS`, `SYNC_INTERVAL_MS`), and the bus's sync request after each client message was removed: a
user's action is durable within 100 ms of its last write.

## Not taken

### Compaction on conversion and backup

#274's converted production copy compacts from 116 to 86 MB. On #273 a compacting copy (`root.backup(dir, true)`) takes
the converted production copy from 387 to 271 MB — most of the rest is 153 MB of large values stored uncompressed — and
was added to the conversion and to every backup (`c31804a75`). It came back out (`a7a4234ae`): a compacted copy of
data with values spanning several overflow pages aborts the process when it is emptied, an LMDB assertion in
`mdb_page_alloc` on lmdb-js 3.5.9, the newest release. It reproduces without this repo's data; the evidence, the
measurements and a repro to report it with are in
[lmdb-compacted-copy-crash.md](evidence/lmdb-compacted-copy-crash.md). The cause is in lmdb-js's patched
`mdb_page_alloc`, fixed by kriszyp/lmdb-js#381. The code is back behind `COMPACT_COPIES` (`@apackdev/ears/lmdb`), which
is off; turning it on is that flag, once `lmdb` is a release with the fix.

## Not needed here

- **Large values out of line, for memory** (#274 Steps 2–3): values over 2 KB leave memory once committed and are
  read back through an LRU cache. #273 holds no values in memory, so the memory reason doesn't apply. A different
  reason does, and it is a separate question: `getRow` and `pickAll` read an entity's whole `['v', id]` range,
  transcripts included, which is most of what reading every message costs (533–708 ms). Keeping large values under a
  prefix of their own would leave those reads to the field that names them; `pick` already reads only the fields it
  is given.
- **The onboarding copy fix**: onboarding edited a stored value it had read, which #274's frozen values refused. On
  #273 every read decodes a fresh copy, so the edit harms nothing; the SDK's test runtime freezes reads, which is
  where such a mutation would show.
- **The rolled-back destroy fix**: a destroy undone put the entity back last in its type's order. On #273 a unit that
  throws leaves the store as it found it, the entity's place included (`tests/engine/transact.spec.ts`).
- **The memory budget** (`admin.memoryStats()`, the heap gate): measures what #273 does not hold.

## Order

Live queries and the served database are designs to plan, after #273 lands.
