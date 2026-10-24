# PR #274 against the on-disk engine: what to take

Reviewed 2026-10-24. [PR #274](https://github.com/spankyed/apack/pull/274) builds the in-memory engine
(`docs/plans/ears-in-memory-engine.md`, Steps 0–8): memory is the database and LMDB is how it is made durable. This
branch, `ears-disk-engine` ([PR #273](https://github.com/spankyed/apack/pull/273)), builds the opposite: the engine
reads and writes LMDB and keeps no copy of the data (`docs/plans/ears-storage-layout.md`). Several things #274 builds
do not depend on that choice. This lists them in the order worth taking, with what each would cost here.

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

### 1. The correctness harness

The strongest thing in #274, and what #273 lacks most.

- **Model-based** (`tests/engine/model-based.spec.ts`, `tests/_harness/model.ts`, `workload.ts`): random workloads
  from `fast-check` over a small pool of ids, so writes collide, refer to each other and are refused. Each op is
  applied to a plain reference model and to the engine; after every op the engine holds what the model holds and
  refuses what the model refuses. Units that return or throw and a store refusing a commit (a full disk) are ops
  too. A second property reopens the files and compares them with memory.
- **Crash injection** (`tests/engine/crash.spec.ts`, `tests/_harness/crash-child.mts`): a child runs a seeded workload,
  writes each acknowledgement to stdout once the write returns, and is killed with SIGKILL at a random point. The
  reopened files must equal the model after the acknowledged writes, or after one more (the write in flight).

**#273 today:** one fixed SIGKILL case (`tests/lmdb/store.spec.ts`) and the contract suite on both backends; no
random workloads, no refusals mid-sequence, no kill at an arbitrary point.

**Cost:** port from #274's persistence-sink API to `kv`. The model and workload carry over as they are; the drivers
change (create the engine on a store, no `hydrate`). A refusing store is a `KvBackend` wrapper whose `write` throws
once when told to. Run it under both test projects (`ears` and `ears-on-lmdb`). Adds `fast-check` as a dev
dependency of `@apackdev/ears`.

### 2. A deterministic durability spec

`tests/lmdb/durability.spec.ts` in #274 mocks the environment's `sync`, so each case decides when a sync finishes or
fails, and fakes the timers. It covers two cases #273 does not:

- a write made while a sync is running is not covered by that sync, and `durable()` waits for the next;
- a sync that fails rejects the `durable()` waiting on it, and the next call tries again.

**#273 today:** `3830b86b2` faked the store's timers for the pause and the cap, but the sync itself is still LMDB's,
so neither case above is exercised.

**Cost:** small. The store does not expose its root; the spec needs either a test seam on `openLmdbStore` (the sync
function as an option) or a spy reached through the backend.

### 3. The prompts selection fix

A defect on master and on #273 alike, unrelated to either engine
(`packages/default-setup/src/features/prompts/fe/state.ts`):

- `PROMPT_UPDATED` for any prompt replaces `selectedPrompt` with it, so another window editing prompt B shows B in
  place of the A this window has open;
- `PROMPT_DELETED` for any prompt clears the selection and returns to the list;
- `PROMPT_CREATED` for a prompt the list already holds adds it a second time.

#274 changes the selection only when the event names the selected prompt, replaces a held prompt rather than adding
it, and adds a case to `tests/features/prompts/fe/page-and-selection.spec.ts`.

**Cost:** the diff and its spec, as its own commit.

### 4. Compaction on conversion

#274's converted production copy compacts from 116 to 86 MB. #273's is 387 MB after conversion, because LMDB keeps
the pages the format 3 tables freed, and they are reused by later writes rather than returned.

**Cost:** `scripts/ears-convert.ts` writes the converted environment through LMDB's compacting copy
(`root.backup(dir, true)`) and swaps it in. A conversion runs once, on a copy, so the extra copy costs nothing a user
waits on.

### 5. Production-shaped bench data

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

### Sync once writes pause

#274 syncs 100 ms after writes pause, and at most a second after the first unsynced commit. #273 adopted the same in
`3830b86b2` (`SYNC_IDLE_MS`, `SYNC_INTERVAL_MS`), and the bus's sync request after each client message was removed: a
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

Items 1–3 strengthen what #273 already claims and change nothing it ships; 4 and 5 are small and improve the
conversion and the readings. Live queries and the served database are designs to plan, after #273 lands.
