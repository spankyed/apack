# Goal: EARS reads from disk — the engine's data only in LMDB

Status: done, 2026-10-24 — the cut-over in [ears-storage-layout.md](../plans/ears-storage-layout.md), which has the
decision and the readings behind it. The spike (PR #261, closed unmerged) is recorded below; its code is not reused.

## Where it starts

- **Run history is not in the engine** ([run-history-store.md](../plans/run-history-store.md)): no trace partition,
  no router, one environment.
- **Attributes are stored by entity** (done in the plan), the disk layout's `['v', id, kind]` order.
- **Relations are not entities** (done in the plan): a relation is a row of its own, which the contract suite pins.
- **Queries are lazy** (done in the plan), so `first`, `exists`, `count` and `limit` stop reading early.
- **Durability is decided** (2026-10-24, [ears-storage-layout.md](../plans/ears-storage-layout.md)): every commit is
  synchronous without a sync (`transactionSync` without a flush, `overlappingSync: false`), so it survives an app crash;
  a group-commit sync on a short timer, on idle and on close; and `durable()` / `transact(fn, { durable: true })` for a
  write that must survive an OS crash or power loss.

What is left is the engine itself: one copy of the data, in LMDB, behind an ordered key-value seam.

## Design

- **An ordered key-value seam.** `OrderedKV` (`get`, `put`, `del`, `range`, `commit`) under the whole engine, with a
  `MemoryKV` for tests and an LMDB backend for the app, and one contract spec both pass. The spike's
  `RelationIndexReader` and `composeEngine` were seams above it and are not built.
- **Key layout:** decided in [ears-storage-layout.md](../plans/ears-storage-layout.md#the-key-layout), the one copy
  of it: by entity, with the trash as its own range, numbering as keys, declared indexes, and no list-length or
  catalog keys.
- **Values are copies.** Reads decode fresh values; pack code that mutated a returned value would silently stop
  persisting, so a development check freezes returned values in tests.
- **Format 4.** Format 3 converts once, explicitly, with `scripts/ears-convert.ts` on a copy (the repo's rule for
  stored data), never at boot.
- **Locks narrow** in the same change (below).

## Spike results (2026-09-17)

The read-path spike ran the whole ears contract suite on a disk-only engine, unchanged.

### Read path
- **Contract suite:** all 104 ears specs pass with `EARS_ENGINE=disk`, including the 38 contract specs, unchanged (re-run and confirmed).
- **Other configurations:** the suite also passes with lmdb-js `cache: true`, with the value index off, with `noSync`, and with every filter forced through the index.
- **Seams it needed:** the two in Design, plus `QueryStorage.idsWithValue(kind, value)` (the value index for
  `where(k, v)` and `withRole` past 64 ids) and `admin.relationIndex` as a getter. Its `orderBy` decorate-sort is
  done in memory (the plan's `orderBy` rework). Its key layout is the one in Design, with relation rows and per-type counts added.
- **Benchmark.** Median of 3 runs, ms, 50k entities / 200k attributes / 100k relations. "no fsync" is `noSync` (see the write path).

  | Case | Memory | Disk | Disk, no fsync | No fsync, no value index |
  |---|---|---|---|---|
  | bulk load | 215 | 1291 | 1271 | 1117 |
  | `query(type).where().pickAll()` | 19.5 | 48.3 | 47.4 | 53.5 |
  | 1,000 `query.ids(id)` | 0.21 | 0.45 | 0.49 | 0.44 |
  | 3 chained steps (`orderBy`) | 7.7 | 31.8 | 31.8 | 30.2 |
  | relation traversal | 0.0027 | 0.0177 | 0.0174 | 0.0264 |
  | `findById` ×1,000 | 1.33 | 2.82 | 2.75 | 2.44 |
  | `query().withRole` over 50k | 5.6 | 50.9 | 48.7 | 96.0 |
  | 1,000 creates, a commit per write | 3.4 | 13,550 | 115 | 75.5 |
  | 1,000 creates, a commit per write chain | 3.5 | 4,772 | 79.6 | 49.1 |
  | 1,000 creates, one commit | 3.8 | 24.5 | 15.0 | 9.7 |
  | `updateEntity` ×1,000, one commit | 0.37 | 15.4 | 3.75 | 3.8 |

  - **Memory use:** heap drops from 358–521 MB to 13–25 MB. `data.mdb` is 253 MB (225 MB without the value index).
  - **`cache: true`** made no difference: most reads are range scans.
- **Problems it found:**
  - **Write amplification:** a put writes 2–6 keys (value, length, value-index diff, first-time entity/type/kind keys), and updates read the old list to diff the index.
  - **Full scans:** queries with no type or index are about 9× slower.
  - **`orderBy`/`pickAll` over a whole type:** 4×.
  - **Values come back as copies:** pack code that mutates a returned array would silently stop persisting.
  - **Attribute kinds:** the memory engine registers a kind when it's merely read; the disk engine doesn't. No spec pins this.
  - **Backup** was not covered. Multi-process access was covered later (2026-09-20), under the locks below.

### Write path: what "synchronous" can mean (lmdb-js 3.5.3, macOS, Node 23.11)

| Option | Per write | Survives process crash | Survives OS crash / power loss | Visible to reads right away |
|---|---|---|---|---|
| `putSync`/`transactionSync`, default (fsync) | 3.5–8 ms | yes | yes | yes |
| `noMetaSync`, `commitDelay`, `eventTurnBatching:false` | no gain | | | |
| `transactionSync(fn, 0x10003)` (ABORTABLE, SYNCHRONOUS_COMMIT, NO_SYNC_FLUSH) with `overlappingSync: false` | 0.015–0.026 ms | yes | loses commits since the last sync; database stays intact | yes |
| `noSync` (whole env) | 0.011–0.016 ms | yes | same as above | yes |
| `noSync` + `useWritemap` | 0.003–0.007 ms | yes | **can corrupt the database** | yes |
| `useWritemap` (sync) | 0.11–0.14 ms | yes | power loss can lose data (`msync`, no full fsync) | yes |
| async `put` | commits in batches | **no** | no | **no** (with `cache:true`: `get` yes, `getRange` no, pending removes not reflected, stale values after commit) |
| in-memory overlay + one `transactionSync` per turn | 4.2 ms with fsync | yes | yes | from the overlay |

- **Why fsync is slow:** on macOS, LMDB's sync is `F_FULLFSYNC`, which flushes the drive cache on every commit.
- **`overlappingSync`** (on by default on macOS) makes even `NO_SYNC_FLUSH` commits wait for the flush; turn it off.
- **Background sync:** `root.sync()` takes about 9 ms, off the main thread.
- **Read-your-writes:** a read after `putSync`/`transactionSync`, or inside `transactionSync`, sees the write.
- **Transaction boundaries:** a write transaction can't stay open across turns; lmdb-js only exposes callback-scoped `transactionSync`.
- **Gotcha:** `db.put()` returns a Promise. A `transactionSync` callback that returns it (`() => db.put(k, v)`) turns the transaction async: it stays open, later transactions nest inside it, and `process.exit` hangs. Callbacks must have block bodies.
- **Multiple processes:** a second process can read and write the same env with 0 errors, and each side sees the other's commits. Sync commits hold the writer lock. Processes must open the env with the same `overlappingSync` setting.

## What it does to the two locks

A data dir carries two markers that exist only because the app keeps a second copy of the data in memory.
`apack db`'s refusal says so outright (`apack-cli/src/commands/db/target.ts`):

> refused while an app runs on that data dir, **which holds the database in memory and would overwrite the
> change or lose it**

LMDB is already multi-process-safe — one writer, many readers, MVCC, the writer lock held in `lock.mdb` by
the kernel — so two processes writing *through* LMDB serialise correctly today. What cannot be protected is
the app's second copy: a tool changes the store, the app's memory is stale, and the app's next write puts
the stale version back. Reading from disk deletes that copy, and with it the reason.

**Reset and import stop closing the store before this goal starts**: the plan's Step 4 runs reset as one transaction
clearing the databases and import as one transaction copying a backup's rows, so neither replaces files under a
live environment. With both changes in, every `apack db` write is an ordinary transaction LMDB serialises
against the app's:

| `apack db` command | After this goal |
|---|---|
| `exec`, `repl --write`, `clear-settings --force` | **No lock needed.** Ordinary transactions |
| `import --force`, `reset --force` | **No lock needed**, once they run as transactions (the plan's Step 4) |

What `db-write.lock` and `app.lock` still guard then is settled with this goal; the measurements below rule out
LMDB's own mechanisms as a replacement for `app.lock`'s other job, saying whether an app is using the data dir.

### Measured, 2026-09-20

- **`lmdb-js`'s `tryLock`/`hasLock` are not a cross-process lock.** Two processes both got `tryLock: true`
  on one env. It coordinates `overlappingSync` within a process. It does **not** remove the native
  dependency that `goal-write-lock-advisory.md`'s Phase 0 settled on.
- **LMDB's reader table does track cross-process liveness**, but it cannot replace `app.lock`.
  `readerCheck()` returned `1` after a holder was `SIGKILL`ed, so LMDB does detect and clear slots belonging
  to dead processes. Two things rule it out anyway:
  - **No usable API.** `readerList()` prints to the C-level stdout and returns nothing; `readerCheck()`
    returns the count of *stale* slots cleared, not live ones. Nothing answers "is a live process using this
    env".
  - **It is blind exactly when the answer matters.** `app.lock` exists to cover the windows where no process
    has the env open: between the app starting and its API opening the store (`openAppStore`, in a separate
    process), and while a crashed API is being restarted (`MAX_RESTART_ATTEMPTS: 3`). Asking LMDB in those
    windows answers "nobody is here", which is the wrong answer and the reason the marker was added in the
    first place. Replacing the marker with a reader-table check would reintroduce the bug it fixed: a tool
    takes the write lock in the window, and the API then refuses to come back.

  So the marker file stays. The reader table is the right shape of mechanism — kernel-backed, no pid
  heuristic — but it can only ever speak for a database that is open, and this question outlives that.

### What it means for the advisory-lock goal

`docs/goals/goal-write-lock-advisory.md` weighs a native dependency (`fs-native-extensions`)
against the lock's correctness. It was surveyed while the lock guards every write. **If this goal lands
first, that lock guards little or nothing**, and the case for adding a cross-platform native dependency to an app
that also ships an npm-installed CLI gets much weaker. Neither goal should be decided on the other's stale
assumptions: settle the sequencing before either Phase 3.

