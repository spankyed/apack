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

**Built as one kind, not two.** The plan proposed inline and async modes, with library search rows as the async one. Reading the code showed that feature is switched off (`[SEARCH_INDEX_FF]`), so nothing maintains those rows, in the app or anywhere. An async mode and `whenProjected` would have had no user, so neither was built.

- **A write in this process** runs the projection in its own unit, so a row and what's derived from it commit together, like a database index.
- **Another process's commit** can't run pack code. It's caught up on from the change log: at boot, after data is replaced, and when told.

**Declared:** `defineProjections({ references: { from: ['Note'], apply(ids), rebuild() } })` in `@apackdev/sdk/framework`, named in `apack.json` at `features.<id>.projections`, generated like `views`.

**Exactly once:** each projection's cursor is a `ProjectionCursor` row, written in the same transaction as its output. No cursor, a `truncated` log, or a commit that can't say what it changed means `rebuild()`.

**The hook:** every outermost write becomes a unit that runs matching inline projections before it commits. Only projections whose `from` matches the unit's changed types run, so a write to anything else pays a type check and no more.

**Failure:** a throw in an inline projection fails the write and undoes it, as a trigger does. That's the safer failure, since the alternative is derived data quietly drifting. An async projection's failure is reported, and it retries from its cursor without losing its place.

**The first projection:** notes' references. `syncReferences` and `resolveReferencesTo` leave `notes/be/repository/commands.ts`, and `bootstrapReferences` and its fact handlers go, which removes the notes walk from the profile and from every boot after the first.

**Also touched:** public API reports, the pack facade, `apack pack` templates, `docs/public-facing/features.md`, and content goldens if applied content moves.

**Gate, measured 2026-11-05 (CPU per create, median of five, load about 36):** a write matching no projection 41.5 µs against 41.4 µs with no hook; a matching one 58.4 µs, the price of a unit.

**A known cost:** a projection untouched for more than the log's 4096 commits rebuilds on its next write, under the lock. That's about 140 ms at 11,000 notes, and rare.

**Verify:**
- Step 3's test extended so that every projection equals a rebuild from zero, under random histories and kills.
- A case that a reader in another process never sees a note without its references, which is what inline promises.
- A throwing projection undoes the write.
- The existing notes and library suites pass unchanged, which is the proof that behaviour held.
- An E2E where a tool edits a note and a document, with the app open and with it closed.

## Step 5: wake-ups in elmdb

Built: elmdb #81, and the apack PR it stacks under.

- **Mechanism:** loopback UDP, one code path on all three platforms and no socket path limit. A listening handle binds a port and files it as `wake/<pid>-<port>`, and a commit sends its sequence to what's filed, without blocking and ignoring failure, because the log is the truth. A handle that doesn't listen binds nothing, and a commit with nobody to tell costs one `stat`.
- **Binding:** `hearCommitsElsewhere(listener)`, built like `hearBuilderCommits`: weak threadsafe function, one listener, dropped on close.
- **On a wake:** elmdb queues owed builder work. The host waits out the burst, reviews the settings row, reads `changesSince`, runs the watches and projections, and tells the bus.
- **A lost wake:** a commit here that skips a sequence reads the log too, so the app's next commit makes one good.

**Removed:** `POST /db/changed-elsewhere`, `answerDataChanged`, `dataChangedToken` and its place in the port file, `tellAppDataChanged`, `tellApp`, `SAVED_BUT_NOT_TAKEN` and exit code 4, `elsewhereThrough`, `lastOwnCommit`, the elmdb public `queue_owed_work`, and the per-line telling in `repl`.

**What a tool no longer learns:** that the app refused an invalid settings row. The app logs it and puts the last valid row back, until step 6 refuses it at the commit.

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
| 4 Projections | SDK, codegen, the write path, pack authoring | Derived-row special cases, the boot walk | Changes how packs write derived data |
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
