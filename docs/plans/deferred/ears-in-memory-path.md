# The in-memory engine until Step 10: writes stored when they return, and a store contract Step 10 inherits

Status: revised 2026-10-24. Part A is built (`b3dc05d54`, branch `session/ears-in-memory-path`) and waits on one
decision, when to land it (below). Part B is closed. The engine's destination is unchanged: it moves to disk, Step 10
of [ears-storage-layout.md](../ears-storage-layout.md). This plan only decides what the in-memory engine gets before
then, and what of it Step 10 keeps.

## The rule this plan follows

**Nothing here builds on the in-memory engine beyond fixing a defect in it.** Step 10 replaces that engine, so work on
it is only worth doing when it closes a live bug sooner than Step 10 can, and only in a form Step 10 can delete without
anyone outside `@apackdev/ears` and the host noticing. A new public contract — a manifest key, an SDK service, a
caller-visible API — fails that test even when it works, because it reaches pack authors and has to be taken back.

## Context

The engine is in memory: at boot the API hydrates every row (`store.hydrate()`, `packages/api/src/runtime/index.ts`),
and LMDB is a mirror the engine writes through a sink. Two costs follow.

**Writes could be lost without anyone knowing.** The adapter buffered writes and flushed them in a microtask; a row
that failed was dropped and reported through `onWriteFailure` after the writer had moved on, so memory ran ahead of
disk. A production app dropped 3,187 writes in one session that way. A backup started in the same turn as a write
missed it (`copyTo` ran before the flush), and every flush was an `F_FULLFSYNC` on the API's main thread.

**Memory and boot grow with the data.** Measured 2026-10-23 on copies converted to format 3, the built engine, 3 runs:

| Data | Entities (relations) | Attribute values | Hydrate | Heap |
|---|---|---|---|---|
| The lead developer's production data (`abuddy/ears-db`, 292 MB) | 68.6k (45.8k) | 224k | 1.3–1.5 s | 308 MB |
| The dev data dir (`apack-dev`) | 559 (325) | 2.4k | 22 ms | 1.4 MB |

Of the production data's 171 MB of values, `Message.blocks` is 141 MB and `Artifact.content` 13 MB. Never measure a
running app's files: copy `data.mdb`, convert the copy with `scripts/ears-convert.ts`, measure that.

## Part A — a write is stored when it returns, or throws and memory forgets it

Built in `b3dc05d54`. It closes the first cost.

- **Every write is a unit.** `journal.unit` runs a write inside the open unit or as a unit of its own; `unitWrites`
  applies it to the storage and relation mutators and to the write builder's operations (`create`, each builder call,
  `updateRelation`, `removeRelation`), so the admin face's direct writes are units too.
- **The journal commits before it forgets.** It keeps a unit's undos until the sink has stored it, and undoes the unit
  in memory when the sink throws, so the engine never holds a write the files do not.
- **The adapter commits each unit as one synchronous transaction** (`NO_SYNC_FLUSH`, on an environment opened with
  `overlappingSync: false` through `openEnvAt`, which every process shares), and throws on a refusal. Nothing is
  buffered, so `copyTo` holds every write that returned before it.
- **Durability:** safe from the app crashing as soon as a write returns; a background `root.sync()` every
  `SYNC_INTERVAL_MS` (1 s) and a flushed write on `close()` bound what an OS crash can take.
- **Reset and import are transactions on the open store**, for the database and the run history alike: `reset()`
  empties the data databases keeping the format stamp; `replaceWith(dir)` puts another store's contents in place.
  Import installs every store in one synchronous stretch that the caller's acceptance (clear and hydrate) follows at
  once. Gone: `reopen`, the write buffers, the row-by-row retry, `onWriteFailure`, `PersistenceErrorStats` and the
  API's dropped-write report.

**Measured** on a loaded machine (other work running; readings, not a baseline): 1,000 creates 7.2–8.6 ms against
Step 4's 4.50, about what 1,000 creates in one `transact` cost (7.4–9.4 ms) — the undo record every write now makes.

**What Step 10 keeps of it, and what it deletes.**

| Kept: the store and its lifecycle | Deleted: the second copy's machinery |
|---|---|
| the durability flags and the background sync | the journal's commit-before-forget |
| `reset()` and `replaceWith(dir)` as transactions | `unitWrites` and the adapter's unit commit |
| `BackupStore` and the host's import and reset | the sink port itself |
| no `reopen`, no `onWriteFailure` | |

The right column is the price of closing a data-loss bug before Step 10 lands, and it is paid once.

## The store contract — what Part A gives Step 10

Part A's specs are the part that outlives it. Each states behaviour at the store's boundary, which any engine behind
it has to keep, so they are Step 10's acceptance criteria and not Part A's tests:

1. A write that returned survives the process being killed (`SIGKILL`) right after it.
2. A unit the store refuses leaves nothing behind, in memory or on disk, and its refusal reaches the code that wrote.
3. A backup started in the same turn as a write holds it.
4. `reset()` and `replaceWith(dir)` each happen in one transaction with the store open, and `replaceWith` refuses a
   store in another format, leaving the current contents in place.
5. A closed store refuses a write, and the engine keeps none of it.

They live in `packages/apack-ears/tests/lmdb/store.spec.ts`, `tests/engine/persistence.spec.ts` and
`tests/lmdb/record-store.spec.ts` today, written against `openLmdbStore` and the engine. **Step 10 runs them unchanged
against its engine**, where each still has a subject, and rewrites only the adapter-level cases
(`tests/lmdb/persistence.spec.ts`), whose subject it deletes.

## Landing it — the one open decision

**One owner of the persistence layer at a time.** Step 10 is being built in the main checkout over the same files
(the journal, the adapter, the store), so the two cannot land in either order without one rewriting the other. The
decision is when Step 10 lands:

- **More than a week or two away:** land Part A first — rebase on master, the full chain, a PR — and Step 10 rebases
  onto it, keeping the left column above and deleting the right.
- **Close:** don't land Part A. Its store-contract specs go to Step 10 as acceptance criteria, and the silent write
  loss is fixed when Step 10 lands.

## Part B — closed

Part B moved the transcripts out of memory: first as record stores (the Database console and the AI database actions
query messages across threads, so that took a capability away), then as disk-only fields declared on an entity. Both
are closed, for the rule above: each built a lasting contract — an SDK service, a manifest key — to manage memory in an
engine Step 10 removes, and the measured cost (1.4 s at boot, 308 MB) is tolerable until then. Step 10 answers the
second cost for every field at once, with nothing for a feature author to declare.
