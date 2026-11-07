# Change tracking: the follow-ups

Status: steps 1 to 3, 4a and 4b built, 2026-11-06 (elmdb #86, #87, #88; apack #362, #363 and the PR above it); 4c planned. Builds on `database-owns-change.md` and `incremental-projections.md`, whose PRs are open
(apack #349 to #361, elmdb #80 to #85). Each step below is a PR of its own, stacked on those, elmdb first where a step
touches both.

## What this fixes

A review of the stack found six things that are correct but clunkier than they need to be:

1. **Wake-ups use loopback UDP with port files and file locks** (#81). It binds a network socket a sandbox may block,
   and it's more machinery than the precedent: Realm, the nearest embedded database shared by several processes, uses
   a named pipe.
2. **Two change-tracking mechanisms overlap.** These are the change log and the per-entity change order (#83).
3. **The projection cursor is an SDK entity** (`ProjectionCursor`). It's runtime bookkeeping, yet it sits in every pack's
   `EntityName`, has no declared shape (hence the `as never` casts), and packs can read and write it.
4. **Change order is inferred from projections.** A projection appearing or going away builds or drops an index behind
   the scenes, and that then makes the projection rebuild once.
5. **A rebuild is one unit.** A first run or a new `version` holds the write lock for the whole walk.
6. **The lost-wake check is subtle.** A commit that skipped sequences reads the log to see who made the skipped ones.

## What the code says, which shapes the plan

- apack reads two things from the change log: whether a commit's `origin` is another handle's
  (`readChangedElsewhere`, `elsewhereBetween` in `packages/apack-ears/src/database.ts`), and whether the log was
  `truncated`. It never reads `types` or `kinds`. `DATA_CHANGED_ELSEWHERE` carries no payload, and a foreign commit
  re-runs every watch (`touched: 'all'`).
- Every commit raises the sequence by exactly one (`store/mod.rs`, `meta::SEQUENCE`).
- The log's other jobs are bounding the tombstones (`trim_tombstones` runs from the log's trim) and carrying the open
  unit's `pending` changes, which projections and the settings rule read through `changesSince(lastCommit(), 1)`.
  That second job belongs to the unit, not the log.
- The wake listener's callback ignores the sequence it is given (`hearCommitsElsewhere(() => …)`).
- The one projection (`notes/be/projections.ts`) has a `rebuild` that is `apply` over every note.

So item 2's fix is to delete the log, not shrink it. Items 2 and 6 become one step, and the wake (item 1) no longer has
to carry anything.

## Step 1: no change log; another process's commit is arithmetic (elmdb, then apack)

**Precedent:** SQLite's `PRAGMA data_version`, which changes when another connection commits and stays the same for the
connection's own commits. SQLite keeps no log for it, and neither will elmdb.

- **elmdb:** `Database::committed_elsewhere() -> bool`, which answers whether another process has committed since this
  handle last asked. Since every commit raises the sequence by one, that is `now - asked_at > own commits since then`.
  The handle records the sequences of its own commits, the index builder's included, and drops them as it answers. They
  are recorded at commit under the writer gate, so an own commit racing an ask counts on exactly one side of it.
- **The tombstones** are trimmed by sequence on the cadence the log used (`current - 4096`, every 64 commits), with the
  same `destroyedFloor` meta.
- **The unit's pending changes** become `Unit::pending_changes()`.
- **Deleted:** `l/c`, `LoggedCommit`, `Changes`, `LOG_COMMITS`, `LOG_TRIM_EVERY`, `changes_since` and its bytes form,
  `deposit_logged` and the `everything` flag. The epoch and `replaced_elsewhere` stay, since a replacement isn't a
  commit.
- **apack:** `readChangedElsewhere`, `elsewhereBetween`, `cursor`, `known` and `CHANGES_PER_READ` go. The wake handler,
  the check after an own commit and the boot check all call `committedElsewhere()`. Projections and `settings-rule.ts`
  read `pendingChanges()`. Repin.
- **Storage:** format 1 is edited in place (CLAUDE.md, storage formats). An existing database's `l/c` keys are dropped
  at open, like any key nothing reads.
- **Checks:**
  - the existing two-process tests: a lost wake, a sender killed before waking, an index builder's commits;
  - a new case for an ask racing this handle's own commits;
  - mutation checks: counting the builder's commits as foreign, and dropping the record of an own commit, each fail a
    case;
  - the write-cost compare: one log record fewer per commit, which should read as a small saving, measured rather than
    assumed.

## Step 2: wake through a mailbox per listener, not a port (elmdb)

**Precedent:** Realm wakes processes through a named pipe beside the database file. On Windows, a named kernel event
is the usual tool.

- **Unix:** a listener makes a FIFO at `wake/<pid>-<n>` and holds it open to read, with a write end of its own so it
  never reads end-of-file. A committer opens each FIFO `O_WRONLY | O_NONBLOCK`, writes one byte and closes it.
  `ENXIO` means nobody is reading, so the listener has gone and the committer removes the entry. That replaces the
  lock file, works across PID namespaces, and has none of a socket path's 104-byte limit.
- **Windows:** a listener creates a named event `Local\elmdb-<file id>-<pid>-<n>`, where the file id is the data file's
  volume serial and file index, and files an entry naming it in `wake/`. A committer opens and sets it. An event that
  won't open has no holder left, so its entry is removed.
- **What carries over:** reading the directory only when its modified time moves (`settled`), a commit with nobody to
  tell costing a `stat`, and a handle that can't write the directory not listening. The app already handles that last
  case by catching up at its next commit.
- **The listener** is told only that something committed (`Fn()`), and asks `committed_elsewhere()`. A wake carries
  nothing, so a lost one costs delay and a stray one costs an ask.
- **Deleted:** UDP, the ports and the per-port lock files.
- **Checks:**
  - the wake tests on all three platforms (CI runs Linux and Windows; Mac locally);
  - a listener killed with `SIGKILL` gets its entry removed by the next commit;
  - a mutation check that skips the removal fails it;
  - a reading of a commit's cost with one and with four listeners, against the UDP send, on the write-cost example.

## Step 3: checkpoints kept by the database (elmdb)

**Precedent:** CouchDB's `_local` documents, which hold replication checkpoints outside the data and its change feed,
and Kafka's committed offsets.

- **API:** `Unit::set_checkpoint(name, bytes)` writes `meta checkpoint:<name>` in the unit's transaction, so a
  checkpoint commits with what it describes. `Database::checkpoint(name)` and `Unit::checkpoint(name)` read it.
- **A checkpoint is not an entity:** no type, no change order, no stamp. Not in dumps, so an import starts without
  one and rebuilds. In a backup, since a backup is the whole environment, so a restored database and its checkpoints
  agree. `clear` empties them, and so does a replacement, which brings its own.
- **Checks:**
  - a checkpoint written in a unit that aborts isn't there;
  - one survives a reopen and a backup;
  - a dump leaves it out.

## Step 4: projections on checkpoints, declared change order and chunked rebuilds (apack)

**4a, the cursor is a checkpoint.** The runner keeps `{ position, version, full? }` as the checkpoint
`projection:<name>`. `ProjectionCursor` leaves `SDK_ENTITIES`, so it leaves every pack's `EntityName` and the casts go.
Run `api:update` and `facade:update`, and read the diffs. The lead developer's database still holds `ProjectionCursor`
rows. Format 1 doesn't migrate them, so that database is reset, or converted by hand on a copy, as CLAUDE.md says. The
projections run again from nothing either way.

**4b, change order is declared.** `apack.json` `data.entities.<Type>.changeOrder: true` sits beside `indexes` and
`search`, set by the pack that owns the type. The registry's `getChangeOrderTypes()` reads declarations, not projections.

- `apack pack validate` and `build` refuse a projection whose `from` names a type that doesn't declare it, naming the
  owning pack.
- A dependency's type is opted in by its owner, as an index is.
- Adding or removing the key is a visible manifest change, and so is the one rebuild it causes.
- `@apackdev/sdk/testing` uses the declarations instead of ordering every type, so a pack test catches a missing one.
- Run `schema:update`.

**4c, rebuilds in chunks.**

- `rebuild` leaves `ProjectionDefinition`, and an optional `reset()` takes its place for a projection whose rows can
  outlive their sources. A rebuild is `reset()` in one unit, if declared, then the checkpoint set to the start with
  `full: true`, then catching up as usual.
- A full pass ignores `complete` while `full` is set: with everything derived again, a destroy it can't see doesn't
  matter.
- An entity changed during the pass moves later in the change order and is met again, so nothing is skipped.
- A write meanwhile applies its own changes and leaves the rest to the pass, as it does with any backlog.
- The notes projection drops its `rebuild`.
- **The cost, stated:** a projection's rows are part-built during a pass. That's a few hundred milliseconds on an
  11,000-note first run or `version` bump, rather than a write lock held for 311 ms.

**Checks:**

- `projections-converge.spec.ts` gains a `version` change mid-history, a rebuild interrupted by a death, and a
  declared `reset()`.
- Mutation checks: honouring `complete` during a full pass, and moving the checkpoint past an unfinished pass, each
  fail it.
- A reading on the built app of an 11,000-note version bump: the longest hold, against 311 ms in one hold before.

## Order

| Step | Repo | Depends on |
|---|---|---|
| 1 No change log | elmdb, then apack | elmdb #85, apack #361 |
| 2 Mailbox wake | elmdb | step 1 (the listener's API) |
| 3 Checkpoints | elmdb | #85 |
| 4a Cursor as checkpoint | apack | step 3 |
| 4b Declared change order | apack | #361 |
| 4c Chunked rebuild | apack | 4a |

**Verification for every PR:**

- **elmdb:** `nextest`, `clippy -D warnings`, `check-mutant-exclusions`, `check-generated`, `check-sync`, the JS
  tests, the write-cost compare, and each new check shown failing on a mutated copy.
- **apack:** the whole `test:unit:host` and a strict run.

## Not doing

- **Polling a counter instead of waking**, which is SQLite's and LMDB's answer. It delays every foreign commit by the
  polling interval, and step 2 removes what made waking look costly.
- **Keeping `types` in some smaller record.** Nothing reads them: a foreign commit re-runs every watch, and the
  refresh reading (`incremental-projections.md`) puts that under a few ms.
