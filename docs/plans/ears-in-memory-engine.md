# The in-memory engine, done properly: an experiment beside Step 10

Status: Steps 0–8 done, 2026-10-24, on branch `session/ears-in-memory-path`; the judging table below holds this
engine's readings, and Step 10's column is read on its own branch.

[ears-storage-layout.md](ears-storage-layout.md)'s Step 10 moves the engine to disk. This plan builds the strongest
version of the other design — the engine's memory is the database, and disk is how it is made durable and rebuilt —
and judges the two on the same evidence. Either result is useful: a better engine, or a measured reason for Step 10.

## The hypothesis

An in-memory engine can be correct, durable and bounded, keep reads at memory speed with no query planner and no
declared indexes, and give the app something a disk engine does not: every commit known as it happens, so queries can
be live. What it costs is resident memory and boot time growing with the number of entities — not with the size of
their values — and a single writing process, which tools reach through the app.

## Where it starts

**What the engine was:** memory as the read path and LMDB as a mirror of it, one key per attribute (`kind␟id`, JSON,
format 3). That is the costs of both designs at once: a write dirties scattered B-tree pages, boot decodes every
attribute row, and a failed write was dropped after the writer had moved on (3,187 in one production session).

**What it costs today**, measured 2026-10-23 on copies converted to format 3, the built engine, 3 runs each:

| Data | Entities (relations) | Attribute values | Hydrate | Heap |
|---|---|---|---|---|
| The lead developer's production data (`abuddy/ears-db`, 292 MB) | 68.6k (45.8k) | 224k | 1.3–1.5 s | 308 MB |
| The dev data dir (`apack-dev`) | 559 (325) | 2.4k | 22 ms | 1.4 MB |

Of the production data's 171 MB of values, `Message.blocks` is 141 MB and `Artifact.content` 13 MB; everything else is
under 10 MB. So the engine's *structure* — ids, small fields, indexes, relations — is about 10–20 MB, and almost all of
the heap is a few large values. Never measure a running app's files: copy `data.mdb`, convert the copy with
`scripts/ears-convert.ts`, measure that.

## The design

1. **A write is stored when it returns, or throws and memory forgets it.** Every write is a unit; the journal keeps a
   unit's undos until the store has committed it and undoes it in memory on a refusal. Commits are synchronous and
   unflushed, with a sync in the background, then group commit with durable points.
2. **Stored values are immutable.** A value is deep-frozen when it is written, so a read hands back the stored value
   itself — no copy, at memory speed — and code that changes a returned array fails at once rather than silently
   changing stored data (Datomic's model). It costs a freeze per write and nothing per read.
3. **Large values live out of line, automatically.** Any value over a threshold (2–4 KB serialized, measured) is stored
   on disk, and memory holds a marker; a read takes it synchronously from LMDB, which is memory-mapped, through a small
   LRU cache (Postgres's TOAST). Nothing is declared and no caller changes; queries, the Database console and the AI
   actions keep working, and the value index never indexed values that size. About 154 of the production data's 171 MB
   leaves the heap.
4. **Boot loads compact rows.** On disk an entity is one record of its small fields (msgpack, keyed by the entity),
   its large values in a database of their own that boot does not read. Hydration decodes ~68k compact rows instead of
   224k JSON attribute rows, and skips the large values. A format 4 for this path, converted explicitly on a copy.
5. **The app is the database server.** While the app runs it owns the data; `apack db`, scripts and agents reach it
   through its API (the token and the port exist) instead of opening its files, so they see live data and write
   through the same engine — one writer, many clients, the client/server norm. Offline, a tool opens the files as it
   does today.
6. **Commits publish what changed, and queries can be live.** The journal knows every key a unit touched; each commit
   emits its change set (entity ids and fields), and `subscribe(query, onChange)` runs a query again when its inputs
   change (Convex, Replicache). Today every feature hand-writes cache invalidation over the bus — `NOTE_UPDATED`, fetch
   slots, broadcasts, a section of default-setup's guide with its own catalogue of bugs. Views that subscribe delete
   that class of bug instead of documenting it, and it is what makes the app as a server pay: windows, tools and agents
   follow live data.

## Non-goals

- **No hand-rolled write-ahead log or snapshot format.** The textbook in-memory design is a log plus snapshots, and
  writing one correctly — torn writes, checksums, fsync semantics, compaction — is a project of its own. LMDB is
  crash-safe, transactional and memory-mapped already; it holds the row snapshot and the out-of-line values.
- **No in-memory MVCC** (persistent structures, a consistent view across an `await`) until a measured need: immutable
  values make it possible later, and it is not free now.
- **No public contract for memory management.** Nothing a pack author declares decides what stays in memory; the
  engine decides by size, and the API does not change.

## Steps

Each step lands on its own, measured against the one before it, and passes the harness of Step 1 from then on.

### 0. Writes stored when they return — done (`b3dc05d54`)
Every write is a unit (`journal.unit`, `unitWrites` over the storage and relation mutators and the write builder's
operations); the journal keeps a unit's undos until the sink has stored it; the adapter commits each unit as one
synchronous transaction (`NO_SYNC_FLUSH`, `overlappingSync: false` through `openEnvAt`) and throws on a refusal; the
store syncs every `SYNC_INTERVAL_MS` (1 s) and on close; `reset()` and `replaceWith(dir)` are transactions on the open
store for the database and the run history alike, and import installs every store in one synchronous stretch its
acceptance follows. Gone: `reopen`, the buffers, the row-by-row retry, `onWriteFailure`, `PersistenceErrorStats`, the
API's dropped-write report. Read on a loaded machine: 1,000 creates 7.2–8.6 ms against Step 4's 4.50 — what 1,000
creates in one `transact` cost (7.4–9.4 ms), the undo record every write now makes.

### 1. The correctness harness
Storage earns trust by technique, not by examples.
- **Model-based property tests** (`fast-check`): random sequences of creates, writes, links, destroys, units that
  return or throw, store refusals, resets and imports, run against the engine and a trivial reference model; after
  every step memory equals the model, and on reopen disk equals memory.
- **Crash injection:** a child runs a random workload and is killed (`SIGKILL`) at a random point; on reopen, what is
  stored is exactly a prefix of the writes that returned, in order.
- The store contract it subsumes, already specs: a write that returned survives a kill; a refused unit leaves nothing
  in memory or on disk; a backup started in the turn of a write holds it; `reset()` and `replaceWith(dir)` are each one
  transaction with the store open; a closed store refuses a write.

**Done when:** both run in the ears suite (a bounded number of runs, seeds reported on failure) and each fails under a
mutation of the journal's rollback, the adapter's unit commit and the store's close flush.

Done, 2026-10-24 (`packages/apack-ears/tests/engine/model-based.spec.ts`, and the integration half's
`tests/lmdb/reopen.integration.spec.ts` and `crash.integration.spec.ts`, their support in
`tests/_harness/`). `model.ts` is the reference model and `stateOf`, `workload.ts`
the random workload over six ids (creates, sets, appends, deletes, links, unlinks, destroys, units that return or
throw, and the store refusing the next commit). `model-based.spec.ts`: 300 runs against the model, every write
compared, and 60 runs on an LMDB store reopened against memory (`reopen`); `crash`: 6 runs of a 400-write child killed at
a random acknowledgement. Each fails under a mutation: the journal's rollback removed fails both model-based
properties; the adapter's commit deferred to a microtask fails the files-against-memory property; deferred by 20 ms,
the crash property. The suite's cost: about 2 s and 3.5 s.

### 2. Immutable values
Deep-freeze a value as it is stored (`place`), so reads return it as it is. Freezing is the write's cost; a reading of
the bench decides whether it is done always or in development and tests only.

**Done when:** a spec shows a returned list and object cannot be changed, and the default-setup and pack suites pass
with values frozen — any code that changed a read's value fails there and is fixed at its source.

Done, 2026-10-24. `deepFreeze` (`utils.ts`) in `place`, the one memory write every attribute change, undo and
hydration goes through, and in a relation's row; a frozen object is skipped with what it holds, so a value is walked
once. Frozen always, not only in development: freezing measured within noise. The ears, SDK, host and API suites and
the pack pool pass with values frozen. One path they don't reach did change one: onboarding's steps edited the state
they read and stored it after, which the external fixture's onboarding E2E caught once frozen; `getOnboardingState`
now hands a step a copy. Readings (loaded machine): 1,000 creates
6.7 ms, bulk load 126 ms; the converted production copy hydrates in 0.97–1.24 s to 309.5 MB of heap (22.8k entities
now that relations are not, 45.8k relations, 178.5k attributes).

### 3. Large values out of line
A value whose serialized size passes the threshold is stored in its own LMDB database (`values`, keyed by entity and
kind) and held in memory as a marker; `getAttr`, `getRow` and `pick` read it synchronously through an LRU cache of a
bounded size. A write replaces or removes it in the same transaction; the journal's undo restores the marker. With no
store behind the engine (tests, the harness), a value stays in memory.

**Done when:** the harness passes; heap on the production copy is measured against 308 MB (expected: about the 10–20 MB
of structure plus the cache); opening a thread of the production copy is timed; the bench's read cases stay within
+10%.

Done, 2026-10-24. The value stays in the attribute row it is stored in; memory holds a frozen `OutOfLine` marker
(its size, and its length when it is a list). A value over `OUT_OF_LINE_BYTES` (2,048) leaves memory once its unit
commits (`journal.afterCommit`, new), so a unit reads its own writes from memory even past the cache, and an undo puts
back the marker the store still answers for. Reads go through the persistence port's new synchronous `readAttr` and
a 16 MB LRU cache (`CACHE_BYTES`); with no `readAttr` (tests, the harness's model run) every value stays in memory.
The value index never holds a string over `INDEXED_STRING_MAX` (256): `where` on one walks. The harness's workload
now writes large strings and lists too; a mutation that puts a value out of line before its commit fails the engine
spec that writes past the cache inside a unit.

Readings, the converted production copy (built engine, 3 runs): heap 309.5 → 74.4 MB (the 16 MB cache included);
hydrate 0.97–1.24 → 1.39–1.42 s, the cost of sizing each value as it loads, which Step 4's format removes; the largest
thread (1,647 messages) read with its transcripts 2.1–2.3 ms cold, 1.4–1.7 ms warm. The bench's read cases are within
noise of Step 4's baseline; its heap probe, which holds no large values, 68.7 MB.

### 4. The row format and fast boot
Format 4: an entity is one msgpack record of its small fields, keyed by its id, its large values in `values`;
relations as today. Hydration decodes the rows, not the attributes, and reads no large value. `scripts/ears-convert.ts`
gains the 3 → 4 step, run on a copy.

**Done when:** boot on the converted production copy is measured against 1.3–1.5 s (target: a few hundred
milliseconds); the harness and the contract specs pass on format 4.

Done, 2026-10-24. `rows` holds an `EntityRecord` per id — its type, its small fields as `[kind, value]` pairs, and its
large ones as `[kind, size, length]`, each value in `values` under `kind␟id` — and `relationRows` a `RelationRecord`
per relation (`source`/`target`, renamed from `src`/`tgt`); msgpack throughout, so Dates round-trip without the JSON
`{ t, v }` wrapper. The adapter keeps a working copy of each record a commit touches and puts each once as it commits;
an attribute written to an id no entity was created with is kept as a record of no type, which hydration skips as
format 3 skipped attributes with no entity row. Placement is one rule, `isLarge` (`values.ts`), shared by the adapter,
the converter and the engine; hydration loads a large value as its marker (`admin.bulkLoadOutOfLine`, new) and sizes
nothing. The value index no longer reads an out-of-line value back to index it unless it is a list, since a string
that large is past `INDEXED_STRING_MAX` and an object is never a key. `convertToFormat4` converts in one transaction
and drops format 3's databases; `rewriteAttributes` and `LmdbReader` work on format 4. A BigInt within 64 bits is now
stored (JSON refused every BigInt); one past them is refused, as the refusal specs now write.

Readings, the production copy converted 3 → 4 (`scripts/ears-convert.ts`, 3.9 s: 22,817 records, 178,539 attributes of
which 5,613 out of line, 45,798 relations; built engine, a machine at load 30–55): hydrate 1.39–1.42 s → 0.24–0.27 s;
heap 74.4 → 52.4 MB; the largest thread 2.4–2.8 ms cold, 1.0–1.2 ms warm. A compacted copy of the files 116 → 86 MB.
The bench (memory engine): bulk load 131 ms, 1,000 creates 8.8 ms mean, a `transact` of 1,000 creates 9.9 ms, read cases
within noise of Step 3; `bench:heap` 68.7 MB.

### 5. Group commit and durable points
A commit returns at once; a sync runs on a short timer, on idle and on close; `await durable()` resolves once
everything committed so far is on disk, and `transact(fn, { durable: true })` syncs as it commits. Backup, export and
import ask for it.

**Done when:** a write behind `durable()` survives power loss as modelled by the harness (a kill with the environment's
unsynced pages dropped), and the write cases of the bench are read against Step 0.

Done, 2026-10-24, with the power-loss model replaced, stated here: dropping an environment's unsynced pages needs a
filesystem that can lose writes on demand (dm-flakey, a VM), which neither this Mac nor the Linux test container has —
a `SIGKILL` leaves every committed page in the OS cache. What is modelled instead is the boundary that decides it: which
flush each promise waits for. `tests/lmdb/durability.spec.ts` watches the environment's own `sync` and the flags each
commit is made with: `durable()` resolves at once with nothing unsynced, starts a sync at once otherwise, and resolves
only when a sync that *began after* the commit has finished — a write made while one runs waits for the next; a failed
sync rejects; `close()`'s flushed write settles it. `transact(fn, { durable: true })` commits flushed
(`ABORTABLE | SYNCHRONOUS_COMMIT`, LMDB's default), which flushes every commit before it, so `durable()` then has nothing
to wait for, and a durable unit inside another makes the outer one durable. The background sync now runs once writes
pause for `SYNC_IDLE_MS` (100 ms) — a burst shares one sync — and at the latest `SYNC_INTERVAL_MS` after the first
unsynced commit. Each of five mutations fails the spec (`durable()` resolving at once; a sync counting commits made
while it ran; the adapter ignoring `durable`; the journal not handing it up; no idle sync). The harness's units are now
durable at random, so the flushed commit runs under the model, the reopen and the crash runs. `reset()` and
`replaceWith()` were already flushed transactions, and a backup copies a read transaction, which holds every commit
flushed or not, so neither needed `durable()`; import is `replaceWith`.

Readings (the bench, a machine at load 35–45; new cases on an LMDB store of its own): 1,000 creates written
`create().set().set()` 101 ms — 3,000 synchronous commits, about 34 µs each — against 9.1 ms on a sink that keeps
nothing; the same as one `transact` 11.1 ms against 10.2 ms; a durable unit of one create 4.7 ms, and a create then
`durable()` 4.8 ms (macOS `fsync`, which is not `F_FULLFSYNC`). The memory-engine write cases are within noise of Step 0's
(1,000 creates 9.1 ms mean against 7.2–8.6 ms).

### 6. Telemetry and budgets
The engine reports resident bytes per type, bytes out of line, the cache's size and hit rate, boot time, and commits
and syncs per second. The bench loads production-shaped data at its measured size and twice it, and fails past a
budget (boot about 300 ms, structure about 50 MB).

**Done when:** the readings are printed at boot and by `apack db inspect`, and the budget fails under a mutation that
keeps large values in memory. This is the honest trigger for when an in-memory engine stops being the right design.

Done, 2026-10-24, with boot reported rather than gated: the repo's rule is that load inflates a duration and cannot
deflate it, so a boot budget would fail a loaded machine and not a slow engine; the heap, which load does not move, is
the gate. `admin.memoryStats()` gives, per type, its entities, attributes and values' size serialized as memory holds
them (an out-of-line value as its marker), the values out of memory and their bytes, and the cache's values, bytes,
hits and misses — a walk of every value, 15 ms on the production copy, so taken on demand. `store.stats()` gives the
hydrate time, commits (and the flushed ones), syncs and time open. Hydration logs its out-of-line values, closing logs
the commits and syncs, the API's boot line keeps its time and heap, and `apack db inspect` with no argument prints a
per-type memory table, the out-of-memory total, the cache and the load time. `npm run bench:budget -w @apackdev/ears`
writes data of the production data's profiled shape (`bench/production-shape.ts`: 22.8k entities, their small fields
by kind, 5.6k large values by kind, 45.8k relations) at 1× and 2×, boots each three times in its own process and exits
1 when the heap passes `HEAP_BUDGET_MB` (64) a scale. With hydration loading large values into memory it fails at both
scales: 186.1 MB of 64 and 371.5 MB of 128.

Readings (2026-10-24, a machine at load 17–30): the budget, 1× heap 38.5 MB, boot 167–172 ms; 2× heap 76.5 MB, boot
311–326 ms — heap and boot both linear in the data, as the hypothesis says. The production copy: 9.4 MB of values in
memory (Message 8.4 MB over 19.8k entities), 5,613 values out of it (148 MB), hydrate 271 ms.

### 7. The app as the database server
`apack db query`, `exec`, `script` and `runs` send their work to the running app's API when one runs on the data dir,
and open the files only when none does; the write lock then guards only tools working offline.

**Done when:** each command gives the same result against a running app and offline, and a write through the app is
seen at once by the app's own views.

Done, 2026-10-24. The API takes `POST /db` (`transport/database.ts`) from a caller with its token, in every build,
and answers through `answerDatabaseRequest` (`@apackdev/host/database`, `serve.ts`) over the engine, store and run
history it holds: a `query`, an `exec` (one transaction), `runs` (a run's tree, or the runs newest first) or a `script`
— compiled by the CLI to one ES module with its packages resolved from where it lives, imported and called in the
app's process with the same `{ db, EARS, args, log }`. The answer is the structured clone of the result (`node:v8`),
so Dates, BigInts and `undefined` print exactly as offline. The app now publishes its token, 0600, for every run beside
its port: the CLI needs it to call a packaged app, and anyone who can read it can read the database files beside it.
`apack db query`, `exec`, `script` and `runs` ask the app first (`askRunningApp`) and go offline when no app answers;
a `--read-only` script stays offline, where read-only is enforced, since the app cannot stop a script writing — and
since Step 0 every commit the app made is in the files to read. Through the app no write lock is taken: its engine is
the one writer, and the lock guards only tools working offline. `consoleScope` and the script runner moved to the host
so both paths build the same `EARS` and fail with the same messages. `repl` and the destructive commands stay offline.

`db.integration.spec.ts` serves a data dir as the app does (the database open in the test, `POST /db` answered by
`answerDatabaseRequest`): `query` (a Date, a BigInt, sorted titles) and `runs` print byte for byte what they print
offline; an `exec` through it is in the app's engine at once and in the files after, takes no lock, and its failure is
offline's; a script that writes runs in the app with its log lines, a read-only one offline; a refused token is
reported, and a port nothing answers on falls back offline. The API's own route refuses a missing or wrong token and
answers 503 before the data is open. "Seen at once by the app's views" is proved to the engine: a view shows the write
on its next read, and following it without a read is Step 8.

Readings (2026-10-24, the production copy as a data dir, a stand-in app serving it): `apack db query` offline
1.10–1.21 s — process start, schema and a 0.3 s hydrate — and 0.84–0.92 s through the app, where the CLI's own start is
nearly all of it and the query a few milliseconds.

### 8. Commit change sets and live queries
Each commit emits its change set; `subscribe(query, onChange)` on the engine, and through the SDK to systems and
surfaces, runs a query again when an entity it read changes. One feature moves its hand-written invalidation to a
subscription first, to price the rest.

**Done when:** a subscription sees exactly the commits that change its result (the harness extended to subscriptions),
and the moved feature's specs pass with its broadcasts deleted.

Done, 2026-10-24. `changes.ts`: each write in a unit names what it touched — the entity and its type, the attribute
kind, a relation, its kind and both ends — and the journal's outermost commit publishes them as one `ChangeSet`
(`engine.onCommit`); a rollback publishes nothing; `admin.clear()` and the store's hydration (`admin.replaced()`)
publish the data replaced. `engine.subscribe(read, onChange)` records what `read` reads as it runs — an entity by id
(`held`, `getRow`, `hasEntity`, a relation walk from it), a type walked, a value-index kind, a relation by id or kind,
or everything — runs it again when a change set meets those reads, and calls back only when the result is no longer
`sameValue`. The SDK's `subscribe` (`@apackdev/sdk/ears`) is over the bound engine.

The harness property: over 200 random workloads, six subscriptions (an entity, a type, a `where`, relations from an
end, relations of a kind, and the whole state) are each called back after exactly the ops that change their result.
Its first run found a defect older than this step: a rolled-back destroy put the entity back at the end of its type's
order, so `query(type).ids()` came back reordered after a unit that threw (the Step 1 model compared sorted state).
An undo now puts it back where it was (`reenter`), and the value-index spec that recorded the old order says so.
Mutations of the type walk's read, of a change set's types and of its relation kinds each fail the specs; dropping the
relation-walk, `findRelations`-by-end or value-index reads does not, since each read also reaches every entity it
returns through `hasEntity`/`held` — equivalent, not missing.

The moved feature is prompts: the system invokes a callback actor holding `subscribe(() => promptQueries.all())` and
turns each change of the result into `PROMPT_CREATED`, `PROMPT_UPDATED` or `PROMPT_DELETED`, the events its surface
already took; every hand-written broadcast after a write is deleted (create, update, delete, import, the category
rename, and the import's list refresh). Its specs pass unchanged, and a new one writes prompts through the repository
with nothing announcing them, which the surface now hears. Hearing every writer exposed three assumptions in the
surface — an update replaced the open prompt whatever its id, a delete closed the open prompt whichever went, and a
create appended an id already listed — each fixed and specced. Price: the system 32 lines added and 53 removed, the
surface 15 and 9; the other features hand-writing the same are library (32 broadcasts), threads (28), notes (28),
brain (22), database (20), flows (14) and actions (8).

Readings: the bench's read cases within noise of Step 7 on a loaded machine (relation traversal 2.6 µs, `getRow` ×1,000
0.20 ms) — a read with no subscription running costs one null check per tracked read; writes 1,000 creates 8.8 ms.

## Against Step 10's evidence

Four follow-ups from reviewing Step 10's branch (PR 273), 2026-10-24:

- **Rows holding no value.** Format 3 could store an attribute as `{ t: 'undefined' }`, which Step 10's conversion
  found and skips. `convertToFormat4` kept them as fields present and `undefined`: 381 on the production copy, 469 on
  the development copy. It now leaves them out and counts them (`emptyAttributes`).
- **The app on the converted data, end to end** (the built API booted by hand, as the guide's manual boot does, on
  copies; stopped by its pid). The development copy (234 entities): hydrate 7 ms, default-setup's content applied, the
  brain's root flow started, the reconcile actions succeeded; `apack db query`, `exec` and `runs` went through the
  running app (`Database: … (the running app's)`), an `exec` refused by the app's own row rules with offline's words,
  and a write made through it was in the files once the app had stopped. The production copy: hydrate 214–258 ms,
  heap +14.8 to +60.7 MB as the process settled (101.7–144.3 MB in all, the packs' code and the API included). Its
  first boot went into settings recovery, as designed, its `Settings-app` row being pre-0.4; with that row cleared
  on the copy (`apack db clear-settings --schema-from packages/default-setup/dist --force`) it booted fully: content
  applied, root flow started, terminals restored. Its root flow names a step type no pack provides now (`flow`),
  which the brain reports and steps past — the data's, as Step 10's run found too. `apack db query` through it
  0.93–1.12 s, the CLI's start nearly all of it.
- **This harness against Step 10's engine** (a worktree of PR 273's head, `c4e11bdd4`, the specs adapted to its
  construction: `createMemoryKV`, a backend that refuses the next unit that writes, a store opened again with no
  hydration). The model-based property, a new one that a rolled-back unit leaves each type in its insertion order,
  the files against the engine and the crash property all pass on three seeds, in both of its vitest projects. The
  subscription property has no subject there. The first injector refused empty units too, which Step 10 opens for a
  write that changes nothing (an `unlink` of no edge) — the injector's error, since a full disk refuses only a commit
  that writes.
- **A cold page cache**, as Step 10 measured it: the production copy on a sparse disk image (`hdiutil create -type
  SPARSE -fs APFS`), detached and attached before each run. What this engine reads from disk is boot and the large
  values; two runs:

  | Reading | Cold | Warm |
  |---|---|---|
  | boot | 266–283 ms | 234–240 ms |
  | a transcript read back, 300 messages' `blocks` | p50 0.25–0.26 ms, p99 2.1–2.3 ms | p50 0.03 ms, p99 1.1–1.3 ms |
  | the largest thread (1,647 messages) with its transcripts | 2.7–2.9 ms | 1.9–2.0 ms |

## Judging it against Step 10

On the same evidence, at the end and at each step that changes a reading:

| | Reading | This engine (2026-10-24, the readings above) |
|---|---|---|
| correctness | the Step 1 harness and the store contract, run against both engines | model-based (engine, files, subscriptions), crash and power-loss-boundary specs pass; defects found and fixed on the way: onboarding changing a frozen value, a rollback's order, valueless rows kept by the conversion. Step 10's engine passes the same harness (above) |
| reads | the ears bench's read cases | unchanged by every step, within noise; a large value read back p99 1.1–1.3 ms warm, 2.1–2.3 ms with a cold page cache; the largest thread 1.9–2.9 ms |
| writes | the bench's write cases, and a durable write's latency | memory engine 1,000 creates 8.8 ms; on LMDB 101 ms as 3,000 synchronous commits, 11.1 ms as one unit; a durable write 3.5–4.8 ms |
| boot | the converted production copy, cold | 1.3–1.5 s → 0.24–0.27 s (format 4), 266–283 ms with a cold page cache; the whole app booted on it; budget data 170 ms at 1×, 320 ms at 2× |
| memory | the engine's heap on the production copy, at its size and twice it | 308 MB → 52.4 MB on the production copy; budget data 38.5 MB at 1×, 76.5 MB at 2×, gated at 64 MB a scale; 116 → 86 MB on disk compacted |
| tools and agents | what a tool sees of a running app's data, and how it writes | `apack db query`/`exec`/`script`/`runs` go through the running app: its data, its engine as the one writer, no lock; 0.84–0.92 s a call against 1.10–1.21 s offline, the CLI's start nearly all of it |
| what the app gains | live queries (Step 8); for Step 10, its own list | `subscribe` and commit change sets; prompts follows every writer with its broadcasts deleted; six more features carry 150 hand-written broadcasts to move |
| complexity | lines added and removed, and the public API either one changes | ears src +1,225 −703, tests +1,139 −342, bench +183; host +160 −33, CLI +168 −94, API +81 −40, SDK +7, default-setup +53 −63; API: `subscribe`, `onCommit`, `durable`, `transact` options, `memoryStats`, `bulkLoadOutOfLine`, `replaced`, `stats`, format 4 records, `POST /db` |

## Coordination

Step 10 is being built in the main checkout over some of the same files (the journal, the adapter, the store). This
branch merges only once the comparison has a result, or one of its steps stands on its own and is agreed to land; until
then it rebases on master.
