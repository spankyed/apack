# PR #274 against the on-disk engine: what to take

Reviewed 2026-10-24. [PR #274](https://github.com/spankyed/apack/pull/274) builds the in-memory engine
(`docs/plans/ears-in-memory-engine.md`, Steps 0–8): memory is the database and LMDB is how it is made durable. This
branch, `ears-disk-engine` ([PR #273](https://github.com/spankyed/apack/pull/273)), builds the opposite: the engine
reads and writes LMDB and keeps no copy of the data (`docs/plans/ears-storage-layout.md`). Several things #274 builds
do not depend on that choice. This lists them in the order worth taking, with what each would cost here.

**Status, 2026-10-24:** the harness, the durability spec and the sync policy are taken (under Taken already, below);
the prompts fix, compaction on conversion and production-shaped bench data are still to take, in that order.

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

## Take

### 1. The prompts selection fix

A defect on master and on #273 alike, unrelated to either engine
(`packages/default-setup/src/features/prompts/fe/state.ts`):

- `PROMPT_UPDATED` for any prompt replaces `selectedPrompt` with it, so another window editing prompt B shows B in
  place of the A this window has open;
- `PROMPT_DELETED` for any prompt clears the selection and returns to the list;
- `PROMPT_CREATED` for a prompt the list already holds adds it a second time.

#274 changes the selection only when the event names the selected prompt, replaces a held prompt rather than adding
it, and adds a case to `tests/features/prompts/fe/page-and-selection.spec.ts`.

**Cost:** the diff and its spec, as its own commit.

### 2. Compaction on conversion

#274's converted production copy compacts from 116 to 86 MB. #273's is 387 MB after conversion, because LMDB keeps
the pages the format 3 tables freed, and they are reused by later writes rather than returned.

**Cost:** `scripts/ears-convert.ts` writes the converted environment through LMDB's compacting copy
(`root.backup(dir, true)`) and swaps it in. A conversion runs once, on a copy, so the extra copy costs nothing a user
waits on.

### 3. Production-shaped bench data

`bench/production-shape.ts` and `bench/budget.ts` in #274 generate data shaped like the production database (its
types, field sizes and relation counts, profiled 2026-10-24) at 1× and 2×. #273's bench is a uniform graph of three
types and four small fields, which understates large values (a message's text) and the type mix.

**Cost:** take `production-shape.ts`; point #273's read cases at it. #274's gate is on heap, which says nothing for an
engine that holds no data; the readings worth gating here are read latency and boot, and by the repo's rule only as
readings ("measured slower" is a report, never a failure).

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

Ported in `5acbd7784`, then taken further than #274 went (`4048a3193`, `0cf3e237e`):

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
  linked again. Extended, the model found an engine bug, fixed in `336755474`: an index built on its first read made
  that read a write, so `withRole` and an indexed `where` threw on a read-only store or a full disk.
- **Mutation-checked:** a stale index entry, a trash that doesn't move its range key, a count blind to trash, a
  savepoint that doesn't undo, a stale incoming-edge key and a stale key between two ends each fail it.

### A deterministic durability spec

`tests/lmdb/durability.spec.ts`, as #274's is, but without a seam on the store: the spec wraps `lmdb`'s `open`, so each
environment's `sync` is one the spec finishes or fails, and fakes the store's timers. It holds which sync each
`durable()` waits for: one begun after the write, a write made during a sync waiting for the next, a running sync
shared, a sync queued behind a failed one, and nothing started when nothing is owed.

It found two defects in #273's store, fixed with it: a caller that joined a running sync was handed a promise that
swallowed the sync's failure, so it heard "on disk" for writes that weren't; and a failed sync cleared what was owed,
so the next `durable()` resolved without syncing at all. A failed sync now rejects every caller waiting on it and
leaves its commits owed, and a timer's sync queued behind a running one, which nobody waits on, is caught rather than
an unhandled rejection. Each of the four was mutation-checked.

### Sync once writes pause

#274 syncs 100 ms after writes pause, and at most a second after the first unsynced commit. #273 adopted the same in
`0950e2d3e` (`SYNC_IDLE_MS`, `SYNC_INTERVAL_MS`), and the bus's sync request after each client message was removed: a
user's action is durable within 100 ms of its last write.

## Not needed here

- **Large values out of line** (#274 Steps 2–3): values over 2 KB leave memory once committed and are read back
  through an LRU cache. #273 holds no values in memory.
- **The onboarding copy fix**: onboarding edited a stored value it had read, which #274's frozen values refused. On
  #273 every read decodes a fresh copy, so the edit harms nothing; the SDK's test runtime freezes reads, which is
  where such a mutation would show.
- **The rolled-back destroy fix**: a destroy undone put the entity back last in its type's order. On #273 a unit that
  throws leaves the store as it found it, the entity's place included (`tests/engine/transact.spec.ts`).
- **The memory budget** (`admin.memoryStats()`, the heap gate): measures what #273 does not hold.

## Order

The prompts fix is a defect on master as well; compaction and the bench data are small and improve the conversion and
the readings. Live queries and the served database are designs to plan, after #273 lands.
