# Incremental projections

Status: planned, 2026-11-06. Builds on `database-owns-change.md`, whose seven steps are open as PRs (apack #349 to #358,
elmdb #80 to #82). Each step below is a PR of its own, stacked on those, elmdb first where a step touches both.

## Why

Two readings of the built app, 2026-11-06, on a Mac at load 10 to 12, an isolated data dir with 11,000 notes.

**What a projection rebuild costs, and what causes one.** A scripted session with the notes projection logging each
rebuild:

| When | Cause | Held the write lock for |
|---|---|---|
| Boot, empty data | First run | 0.4 ms |
| A tool imports 11,000 notes in one unit | Too many entities for the log record to name | 311 ms |
| A note edit after 4,200 app commits to folders | The log no longer reaches the cursor | 468 ms |

Twenty note edits, one unit each, rebuilt nothing. Both rebuilds were full walks of every note under the write lock,
for one note that changed (the third) or a batch that could have been applied in pieces (the second). Both come from
the change log being a bounded list of commits: a cursor that falls behind it, or a commit too large for it to name,
can only be answered by doing everything again.

**What a refresh after a tool's commit costs.** A CPU profile of the API process, 16 refreshes:

| Notes | Busy per refresh, at most |
|---|---|
| 1 | 27.5 ms |
| 11,000 | 8.7 ms |

It no longer grows with the data (it was 148 and 259 ms before #349 and #354). Re-running watches doesn't appear in the
profile, and the largest named share is the bus fanning the fact out to systems, a few ms. That settles one of the
proposed improvements: refreshing only the watches a commit touched buys nothing measurable now, and is deferred below.

## The design: what changed since, kept by the database

Every entity carries the sequence of the commit that last changed it, and the database keeps its entities in that
order, per type. A reader asking "what of these types changed since sequence N" reads a range: what it reads is what
changed, however far behind it is, and nothing else.

This is a change feed in the sense of CouchDB's by-sequence index or Firestore's update times. It replaces what the
change log's per-commit entity lists did for projections, which a bounded log can't do in general.

It also removes the distinction between this process's commits and another's for projections. A projection applies
whatever changed since its cursor and moves the cursor past it, whoever wrote it. That closes the review's open cases
(writes made while the projecting pack wasn't registered, writes inside `transactWithoutHook`, admin loads) by making
them ordinary.

The change log stays, for what it is good at: whether another process committed and which types, for watches and
`DATA_CHANGED_ELSEWHERE`. Its per-commit entity lists go, since nothing reads them.

## Step 1: a change sequence on every entity (elmdb)

- **Stored:** `p/i id` becomes `[place, trashed, changed]`, `changed` being the sequence of the commit that last wrote
  the entity: a field, its trash state, or a relation with it at either end. Format 1 is edited in place
  (`format.md`); a database from before reads as an entity with no change sequence, which `changed_since` treats as
  changed at 0, so a reader starts from everything.
- **Derived:** `d/h type changed place → id`, the entities of a type in change order. A write moves the entity's key:
  the old one removed, the new one put, once per entity per commit however many of its fields the commit wrote.
  `rebuild()` derives it from `p/i`, and `check()` compares it.
- **Destroyed entities:** a destroy leaves no `p/i`, so it writes `l/d changed type id`, bounded like the change log
  (newest 4,096) and trimmed with it. A reader whose cursor is older than the oldest kept tombstone, when one of its
  types has had a destroy since, is told the answer is incomplete. The type's newest destroy is kept in meta
  (`m/destroyed/<type>`) so that is one read.
- **Read:** `Database::changed_since(types, cursor, limit) -> Changed { ids, destroyed, through, complete }`, merging
  the types' ranges in change order, at most `limit`, `through` the last sequence read. `Unit::changed_since` reads in
  the unit, so its own writes are there, and `Unit::next_sequence()` says which sequence its commit will take: the
  stored one plus one, read under the write transaction the unit already holds.
- **Commit sequence before commit:** `commit_txn` assigns the sequence it does now; the change sequence an entity gets
  in a unit is that same number, which the unit knows from its first write since it holds the write lock.
- **Binding:** `changedSince(types, cursor, limit)` on `Database` and `Unit`, `nextSequence()` on `Unit`, generated
  types, the protocol type.
- **Cost, gated:** `examples/write-cost.rs` before and after, three runs, `cargo xtask compare`. Each written entity
  costs one more `p/i` put and a `d/h` delete and put. A relation op bumps both ends. If one row's commit costs more
  than the run-to-run spread, the change is narrowed before it lands: relation bumps for the source only, or behind a
  schema flag per type.
- **Tests:** a reader in another process asking from 0, from the middle and from past the end; a field write, a trash,
  a restore, a relation link and unlink each moving the entity; a destroy reported once and then trimmed, after which
  an old cursor is incomplete; `check()` catching a missing and a stale `d/h` key on a mutated copy; `rebuild()`
  making `d/h` from `p/i`; a dump and load starting every entity at the load's sequence; a unit seeing its own writes
  and its next sequence.

## Step 2: projections read what changed since their cursor (SDK, host)

- **One algorithm for a write and a catch-up.** Read `changed_since(from, cursor)`, apply those ids and the destroyed
  ones, and set the cursor to the sequence this unit commits as. In a write the unit's own changes are in the range, so
  the special handling of pending changes and of origins goes.
- **A write that touches none of `from`** runs nothing, as now: the unit's pending types are checked first.
- **A backlog doesn't land on a write.** If what changed since the cursor, beyond the unit's own, is more than a chunk
  (500 entities), the write applies only its own entities and leaves the cursor; catching up takes the rest.
- **Catching up in chunks, outside a write.** `_catchUpProjections` becomes a job: a chunk of 500 ids per unit, its
  cursor moved in the same unit, and the event loop given back between chunks, so a write never waits for more than
  one chunk. A boot, a replacement, a wake and a pack change start it; one already running carries on rather than
  starting twice.
- **Rebuild only when the answer is incomplete.** A cursor of 0 needs no rebuild: everything is in the range, applied in
  chunks. `rebuild()` becomes optional and runs only when `changed_since` says it is incomplete (a destroy lost from
  the tombstones), as a chunked walk when the projection supplies none.
- **Versions.** `ProjectionDefinition.version` (a number, default 1). The cursor row stores it; a different one starts
  the cursor at 0, which re-applies everything in chunks. A cursor whose projection is no longer declared is removed
  when its pack is uninstalled.
- **Relations.** A projection hears an entity whose relations changed, at either end, which removes the limitation the
  contract states now. A projection that writes relations itself, as notes' does, hears its own writes as changes at
  the sequence its cursor moves to, so they don't come back.
- **Remove:** the origin filtering, `everything`/`truncated` handling and pending-id reading in
  `apack-sdk/src/runtime/projections.ts`; `rebuild` from the notes projection if the chunked default serves.
- **Tests:** the readings' three cases as SDK specs (the first run, a bulk import, a cursor far behind), each applying
  what changed and never rebuilding; a write behind a large backlog applying only its own; a catch-up interleaved with
  writes landing between chunks; a version change re-applying; a relation change heard; an incomplete answer
  rebuilding. Then both readings taken again on the built app, the rebuild column expected empty but for the first run.

## Step 3: the change log drops its entity lists (elmdb)

Once step 2 has landed nothing reads them. `LoggedCommit.entities` and `LOG_ENTITIES` go, and a record is its origin,
types, kinds and whether it changed everything: a few dozen bytes. That also answers the review's note that the bound
was on the number of ids rather than their size.

## Step 4: the tool's settings check caches its catalog (host)

`refuseInvalidSettings` reads and compiles the installed packs' catalog on every Settings write. It keeps the compiled
catalog keyed by the pack builds' integrity hashes and the disabled list, and compiles again only when they change.

## Step 5: the invariant, generated (ears)

`writers-converge.spec.ts` checks fixed scenarios. A model-based test generates sequences of: app writes, a second
process's writes, a second process killed mid-unit, a reset elsewhere, a burst large enough to pass the log's bound,
and a projection version change. After each it asserts what the app's engine shows, its projections included, equals
what a fresh engine over the same files shows. It runs a fixed number of seeded sequences in the fast pool and prints
the seed of a failure, as elmdb's own model tests do.

## Deferred, with what would bring each back

- **Refreshing only the watches a foreign commit touched.** The refresh reading puts it under a few ms. A profile in
  which re-running watches or publishing shows as a real share is what would bring it back.
- **The newest foreign commit's sequence in meta,** so the lost-wake check is one read. It reads a few log records today,
  only after an index build. A profile showing that read is what would bring it back.

## Order and verification

| Step | Repo | Depends on |
|---|---|---|
| 1 Change sequence | elmdb | #82 |
| 2 Projections on it | apack | step 1, #358 |
| 3 Log without entity lists | elmdb | step 2 |
| 4 Settings catalog cache | apack | #358 |
| 5 Generated invariant | apack | step 2 |

Each elmdb PR runs `nextest`, `clippy`, `check-mutant-exclusions`, `check-generated`, `check-sync` and the write-cost
gate, and shows each new check failing on a mutated copy. Each apack PR runs the whole `test:unit:host`, the E2Es that
cover it against the built app, and a strict run. Steps 4 and 5 don't wait on the others beyond what the table says.
