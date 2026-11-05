# The database owns change

Status: planned, 2026-11-05, revised after the refresh profile and a review of how projections should stay consistent. Nothing built. Not committed to doing every step: each ships alone, and the plan can stop at any gate.

## Why

Terminal writes beside a running app shipped (#341, #344, #346, #348), and each fix patched the same two gaps:

- **What a commit changed exists only in the process that made it.** elmdb returns a change set to the caller and stores only a sequence, so another process learns that something changed but not what. That cost us the tell and its token, `elsewhereThrough`, `reconciled`, `lastOwnCommit`, `queueOwedWork` and re-running every watch.
- **Some rules live in app code on the write path.** `syncReferences`, `indexDocument` and settings validation run only if a write goes through the repository or the settings store. A tool skips them. That cost us `adoptStored`, the notes reindex on a fact, and search rows going stale.

**The invariant every step serves:** with any number of writers, in any order, including crashes, an open app ends up showing what a fresh boot would show.

## Profile

CPU profile of the API process on the built app, 2026-11-05, library open, 15 refreshes per row, 200 µs sampling, machine load about 40. The timings are CPU samples and inflated by load, so read the shares.

| Notes | Busy per refresh | `sendPacksList` | `bootstrapReferences` | Everything else |
|---|---|---|---|---|
| about 1 | 148 ms | 124 ms (83%) | not visible | 24 ms |
| about 11,000 | 259 ms | 98 ms (38%) | 118 ms (46%) | 43 ms |

What it settles:

- **Re-running watches isn't the cost.** It doesn't appear among the top frames, with one surface's views open. So **key-level records aren't justified**: type-level is enough, and it's what `ChangeSet` already has.
- **The two real costs are both wasted work.** `sendPacksList` re-reads and re-validates pack manifests from disk (`read`, `open`, zod) when a data fact asks every system to publish, though no row change can alter that list. `bootstrapReferences` walks every note whatever changed.
- **It corrects my earlier reading.** I said the cost doesn't grow with note count. It does: the notes walk is about 118 ms at 11,000 notes. Noise in the POST timings hid it.

## Step 1: cache the packs list (host)

Have `sendPacksList` (`features/packs/be/system.ts`, through `emitPacksList`) serve a list cached until a pack changes. No row change can alter that list, so it's wasted work on every data fact, about 100 ms per refresh here, and likely on every other `SEND_STATE` too. It needs nothing else in this plan.

**Verify:** a case showing a pack change still updates the list, which is what the cache could break, and the profile re-taken to confirm the share is gone.

Scoping the notes walk is the other half of the cost, but it needs to know what changed, so it arrives with step 2.

## Step 2: a change log and cursors (elmdb, then apack)

The log starts as a pure addition. Nothing is deleted until a consumer moves onto it.

- **Record:** `commit_txn` writes the commit's record in the same transaction, under a new key family, `l/<sequence>`. `ChangeSet` already holds entities, fields, relations, types and kinds, so a record is that, without `touched` and `elsewhereThrough`, plus an origin: a random id per handle, so a reader can skip its own commits.
- **Commits with no key-level writes:** `reset`, `replaceWith`, `setSchema`, `bulkLoad` and admin units write a record saying "everything". The app already hears these that way.
- **Bounded:** keep the newest N records, trimmed in the writing transaction. A reader behind the oldest record is told it's `truncated` and does a full resync, the same path as boot.
- **API:** `Database::changes_since(cursor, limit)` answers `{ through, truncated, commits }`. It reads one snapshot, so a read can't see half a commit. Binding: `changesSince`.
- **Visible inside a unit:** `changes_since` called in a write unit also answers that unit's pending changes, because step 4's inline projections need them before the commit.
- **Format:** edits format 1 in place, per CLAUDE.md. The log is derived, so dumps and backups leave it out and a replaced database starts an empty one, which reads as `truncated`.
- **apack:** `createConnection` holds a cursor. Hearing of another process (`changedElsewhere`, or `elsewhereThrough` on a commit) reads forward from it rather than assuming everything changed. A refresh gets narrower by type: notes reindexes only if `Note` is in the changes, and settings adopts only if `Settings` is.

**Removes at this step:** `reconciled`, and the notes walk when a commit changed no `Note`. The rest of the bookkeeping stays until wake-ups land, because a trigger is still needed.

**Gate before apack adopts it:** measure write cost on elmdb's `write` and `maintenance` benches, against `main`, with `cargo xtask compare`. Record the reading with date and load. Stop and report if a typical commit costs more than 10% more, or the bulk cases more than 25%, since a change log isn't worth a slower writer for one terminal user. The instruction-count job on the PR is a second, noise-free reading.

**Verify:** a real second process commits, and the first reads exactly those commits. Random histories compared with change sets as committed. A kill between commit and read loses nothing. Trimming and `truncated` each have a firing case. Mutation run on the diff. Golden bits unchanged.

## Step 3: the invariant test (apack)

- **A generated property test** beside `packages/apack-ears/tests/engine/model-based.spec.ts`: random writes from a real second process, kills included, then every open watch is compared with a fresh read of the same query.
- **At app level:** the same check for what systems publish, using `startApp` from `@apackdev/testing/harness`, extended to derived rows in step 4.
- **Failure must name the history** so it can be replayed.

**Removes nothing.** It comes this early so that the removals below have something to fail. **Verify:** it fails with `changedElsewhere` turned into a no-op, and with the cursor not advancing.

## Step 4: projections (SDK, host, default-setup). Review before starting

This is the step that changes how packs are written. Review it as a design first.

**Two modes, chosen per projection, because there are two situations.** This is the pattern of Marten's inline and async projections, and of CQRS systems with checkpoints.

- **Inline:** runs in the same transaction as the write that caused it, so the source and its derived rows commit together, like a database index or trigger. A note and its references are never seen apart, by any process.
- **Async:** runs after the commit, from the cursor, for work too slow to do under the write lock.
- **Other processes' commits always go the async way, for both modes.** A tool can't run pack code. An inline projection catches up on them at the app's next wake or commit.

**Declared:** `defineProjection({ from: ['Note'], mode: 'inline', apply(changes) })` in `@apackdev/sdk/framework`, named in `apack.json` at `features.<id>.projections`, and generated like `views` and `repositories`. An `apply` works only from the changes and the engine, and must be rebuildable from nothing.

**Exactly once, in order:** each projection's cursor lives in a host-owned row, written in the same transaction as its output. The inline step holds the write lock, so it applies any other process's commits before its cursor first, then the unit's own pending changes, then advances. `truncated` means rebuild from nothing. At boot, every projection catches up from its cursor.

**Waiting:** `whenProjected(sequence)` lets a reader wait for an async projection or for another process's commit where that matters. Inline projections never need it.

**The hook:** every outermost write becomes a unit that runs matching inline projections before it commits. Only projections whose `from` matches the unit's changed types run, so a write to anything else pays a type check and no more.

**Failure:** a throw in an inline projection fails the write and undoes it, as a trigger does. That's the safer failure, since the alternative is derived data quietly drifting. An async projection's failure is reported, and it retries from its cursor without losing its place.

**Which mode:**
- **Notes' references, inline:** `syncReferences` and `resolveReferencesTo` leave `notes/be/repository/commands.ts`. `bootstrapReferences` and its fact handlers go, which also removes the notes walk from the profile. `resolveReferencesTo` queries `linkTargets` across notes, so measure that under the lock.
- **Library search rows, async:** `fileDocument` and `indexDocument` move off the write path, which fixes the stale `IndexedDoc` rows a tool's edit leaves today. Search results lag a write slightly, and embedding is already deferred.

**Also touched:** public API reports, the pack facade, `apack pack` templates, `docs/public-facing/features.md`, and content goldens if applied content moves.

**Gate, before anything moves onto it:** measure the hook on `write` benches and on a real notes write, with no projection matching and with references inline. Stop and report if a write that matches no projection gets more than 5% slower, or if holding the lock through references visibly stalls the app's other writes.

**Verify:**
- Step 3's test extended so that every projection equals a rebuild from zero, under random histories and kills.
- A case that a reader in another process never sees a note without its references, which is what inline promises.
- A throwing inline projection undoes the write, and a throwing async one resumes.
- The existing notes and library suites pass unchanged, which is the proof that behaviour held.
- An E2E where a tool edits a note and a document, with the app open and with it closed.

## Step 5: wake-ups in elmdb

- **Mechanism:** each write handle binds a datagram socket under the data directory, and a commit sends its sequence to every peer without blocking. A failed send is ignored, because the cursor is the truth, and a dead peer's socket is removed. The binding already uses Unix datagram sockets for its process claim (`crates/elmdb-node/src/process.rs`), including abstract names on Linux.
- **Binding:** `hearCommitsElsewhere(listener)`, built like `hearBuilderCommits`: weak threadsafe function, one listener, dropped on close.
- **Engine:** on a wake, read `changesSince`, run the watches it names, run projections from their cursors, tell the bus, and queue owed builder work.

**Removes:** `POST /db/changed-elsewhere`, `answerDataChanged`, `dataChangedToken` and its place in the port file, `tellAppDataChanged`, `tellApp`, `SAVED_BUT_NOT_TAKEN` and exit code 4, `elsewhereThrough`, `lastOwnCommit`, the elmdb public `queue_owed_work`, and the per-line telling in `repl`.

**Risks to settle first:**
- **Windows:** no shared code path. Named pipes, or accept a next-commit check there and say so.
- **Path length:** a socket path is limited to about 104 bytes on macOS, so a long data dir needs a hashed path under the temp directory.
- **A lost wake on an idle app:** there's no retry. The next local commit, or a window focus, reads the cursor too.

**Verify:** real processes in elmdb's tests on all three platforms in CI. Kill either side. Hundreds of peers' dead sockets don't slow a commit. The E2Es in `db-writes-beside-app.spec.ts` pass with the route gone.

## Step 6: rules enforced at commit

- **Goal:** an invalid `Settings` row can't commit, so `adoptStored`, `lastValid`, `validStored` and the 422 go.
- **Shape of the work:** today's checks are JSON schemas compiled in JS (`features/settings/validation.ts`, with a `previous` rule that lets a write repair only the invalid part). elmdb's row rules cover required fields, types and enums. Doing this means a schema validator in Rust, the catalog stored with the schema and re-declared when packs register, and the same answer as the JS validator wherever both run.
- **Boot recovery stays.** A pack update can still narrow a schema over a row already stored.

**Gate:** this is the weakest cost-to-value step. It removes roughly 30 lines of host code and adds a validator and a parity problem. **I'd skip it unless a second rule like this appears.** The current refusal works.

## Step 7: the epoch

- **Mechanism:** `reset` and `replaceWith` bump a stored epoch, checked inside each transaction by the same mechanism as the schema fingerprint (`EngineSchema::validate`). Handles notice, and a wake delivers it at once. `DATA_REPLACED` becomes that one signal, for a replacement from any process.
- **`reset` first:** it can run beside a running app, which remounts.

**`import` may never get here, and that's a correction to what I said earlier.** An in-app import also replaces the run history and media, and then runs migrations and pack starts (`services/app-data.ts`). A tool can't run pack code, so a tool's import beside a running app would need the app to do that half. I'd keep refusing it.

**The lock doesn't fully go away either.** `backup` and `pack-mutation.ts` also hold it, for reasons that have nothing to do with replacing rows. This step removes it only for `reset`.

**Gate:** remounting is only as safe as every surface. Do it only if `reset` beside a running app is actually wanted.

## Order and what it costs

| Step | Touches | Removes | Risk |
|---|---|---|---|
| 1 Packs list cache | host | About 100 ms per refresh | Low |
| 2 Log and cursors | elmdb format, write path; ears | `reconciled`, the notes walk on unrelated commits | Write cost, gated by measurement |
| 3 Invariant test | tests | nothing | Low |
| 4 Projections | SDK, codegen, the write path, pack authoring | Derived-row special cases | Highest: changes how packs are written, and adds a hook to every write |
| 5 Wake-ups | elmdb, binding | Tell, token, route, exit code, most bookkeeping | Windows, socket paths |
| 6 Commit rules | elmdb, host | Settings special cases | Poor value, likely skipped |
| 7 Epoch | elmdb, surfaces | `DATA_REPLACED` as a separate path | Surface remounts, likely `reset` only |

**Natural stopping points:** step 1 stands alone. After 3 we have a proven log and a test. After 5 the bookkeeping is gone. Steps 6 and 7 are optional.

## Working arrangement

Separate PRs, elmdb first, and apack pinned to it. Each PR runs its own gates, the whole `test:unit:host` as well as targeted specs, and a strict run before merge. Conventional commits, no attribution, no merging without being asked. Mutation checks on copies, and each check confirmed to have run.

## Not doing

- **Serving `apack db` through the app:** declined.
- **Polling or file watching** for foreign commits.
- **Logging key-level writes for every commit:** the profile doesn't justify it.
