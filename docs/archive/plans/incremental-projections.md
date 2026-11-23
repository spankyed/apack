# Incremental projections

Status: steps 1 to 5 built, 2026-11-06: elmdb #83, #84 and #85, apack #359, #360 and #361. Builds on `database-owns-change.md`, whose seven steps are open as PRs (apack #349 to #358,
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

## Step 1: a change sequence on every entity (elmdb) — built, elmdb #83

- **Stored:** `p/i id` is `[place, trashed, changed]`, `changed` the sequence of the commit that last wrote the entity: a
  field, its trash state, or a relation at either end. A commit stamps what it wrote once, as it commits.
- **Kept only where asked:** a type whose schema sets `changeOrder` keeps `d/h type changed place → id`, derived from
  `p/i`, built at open from the entities it holds and dropped when the schema stops asking. Keeping it for every type
  failed the write-cost gate: 100- and 2,000-row commits cost 20 to 30% more. A type that keeps one pays about a fifth
  more (one row about 48 µs against 40 µs, 100 rows about 1,500 µs against 1,230 µs); a type that keeps none pays
  nothing measurable (`examples/write-cost.rs`, 2026-11-06, load 6 to 12).
- **Read:** `changed_since(types, from, limit)` pages by position, a sequence plus the type and place to resume after,
  since one commit can stamp more entities than a page. Destroyed entities come from tombstones (`l/d`), kept and trimmed
  with the change log. A reader of a type keeping no order, from before its order was built, or older than the kept
  tombstones of a type with a destroy since, is told the answer is incomplete.
- **In a unit:** `next_sequence()` names the sequence its commit takes, so a reader inside it can say where it will have
  read to.

## Step 2: projections read what changed since their cursor (SDK, host) — built

- **The types:** the registry names every projection's `from` types, and the app's engine schema has them keep a change
  order (`EngineSchema.changeOrder`).
- **In a write:** the write applies what it changed, and what changed before it since the cursor when that is a chunk
  (500) or less, then moves the cursor past its own unit. A first run, a new version or a larger backlog applies the
  write's own and leaves the rest to a catch-up.
- **Catching up:** `installProjections` returns a runner whose `catchUp()` applies a chunk per unit and gives the event
  loop back between them, running again rather than twice at once. A projection that throws keeps its cursor and holds up
  no other. The host holds the runner: boot, a replacement, a wake and a pack change start it.
- **Rebuilding:** only on a first run, a new `version`, or an incomplete answer. `rebuild` stays required for those;
  a chunked rebuild is still to do, the first run being the only common case and cheap on an empty database.
- **The readings again**, the built app, 2026-11-06, load 7 to 9, 11,000 notes: one rebuild in the session (the first
  run, 0.1 ms); the 11,000-note import applied in 22 chunks of 500, the longest held 28.4 ms (311 ms in one hold
  before); the note edit after 4,200 folder commits applied one note in under 0.5 ms (468 ms before); a refresh 9.1 ms at
  one note and 11.0 ms at 11,000, as before.

## Step 3: the change log drops its entity lists (elmdb)

Once step 2 has landed nothing reads them. `LoggedCommit.entities` and `LOG_ENTITIES` go, and a record is its origin,
types, kinds and whether it changed everything: a few dozen bytes. That also answers the review's note that the bound
was on the number of ids rather than their size.

## Step 4: the tool's settings check caches its catalog (host) — built

Reading and compiling the installed packs' catalog costs about 72 ms a Settings write in a tool: 63 ms reading and
verifying the pack builds, 9 ms compiling (median of 20, 2026-11-06, load 8). `refuseInvalidSettings` keeps the
compiled catalog keyed by what it is read from (the packs directory's entries, each pack's directory, receipt and
snapshot, and the record of which are disabled), a few stats, and reads it again only when that key moves.

## Step 5: the invariant, generated (SDK) — built

`projections-converge.spec.ts` generates histories from seeds, a failure printing its seed: the app's engine writing,
a real second process writing and dying after a commit or inside an open unit, bursts larger than a chunk, a reset from
the second process, catch-ups, and the projection's version changing. After every catch-up the projection's rows must
be what deriving them afresh gives. Sixteen histories run in the fast pool in about 3 s. Ignoring destroyed entities,
a write skipping a backlog and a catch-up skipping ahead each fail it on a mutated copy.

**What it found:** on macOS a writer killed inside an open unit leaves the write lock held while another process has
the database open, and every later write there waits for good. elmdb locks with POSIX semaphores on macOS, which only an
environment's first opener resets; Linux and Windows keep LMDB's robust mutexes. elmdb #85 fixes it: a writer holds a
kernel-released lock on a file beside the database for its whole transaction, and whoever holds that lock releases a
semaphore left taken. The test kills writers inside a unit on every platform.

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
