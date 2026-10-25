# EARS persistence reliability and write batching

**Status:** proposed; implementation has not started.
**Audit date:** 2026-10-19.
**Decision:** retain LMDB behind the in-memory EARS engine. Improve durability and transaction batching
before considering another database.

## Why retain LMDB

Normal application queries run against JavaScript memory. Replacing LMDB with SQLite as a persistence
sink would not accelerate them. Moving those queries into SQL would require changing the query engine,
including its equality, ordering, relation traversal and synchronous mutation semantics.

Run history is outside this plan: it left the engine for a record store of its own, indexed by the fields
it is looked up by and paged ([run-history-store.md](run-history-store.md)). No new indexes are proposed for
the database either: normal queries already use in-memory entity-type and relation indexes.

This decision follows source inspection, not a measured LMDB-versus-SQLite benchmark. Revisit SQLite
WAL if primary data must become disk-resident and the application needs SQL filtering, JOINs, reporting
and pagination over that data. SQLite WAL would still need deliberate batching and checkpoint management.

## Current implementation

| Concern | Source | Finding |
|---|---|---|
| Attributes and entity membership | [attribute-storage.ts](../../packages/apack-ears/src/kv/attribute-storage.ts) | Entities and attributes are keys in the store (`['v', id, kind]`, a type's ranges, declared indexes); a read reads the store, and no copy of the data is kept in memory. |
| Query evaluation | [query.ts](../../packages/apack-ears/src/query.ts) | `where()` reads a declared index, or filters the type's rows from the store; each terminal reads one snapshot. |
| Relation lookup | [relations.ts](../../packages/apack-ears/src/kv/relations.ts) | Each relation is a row and edge keys (`['o'\|'n', entity, kind, seq]`, `['b', source, kind, target, seq]`) in the store. |
| Mutation lifecycle | [write.ts](../../packages/apack-ears/src/write.ts), [journal.ts](../../packages/apack-ears/src/kv/journal.ts) | A write is its own unit, or joins the open `transact(fn)` unit, which commits as one LMDB transaction or keeps nothing when it throws; `transact(fn, { durable: true })` commits with a sync. |
| Persistence scheduling | [kv-backend.ts](../../packages/apack-ears/src/lmdb/kv-backend.ts), [store.ts](../../packages/apack-ears/src/lmdb/store.ts) | A unit commits without a sync and is visible at once; group commit syncs within `SYNC_INTERVAL_MS`, a client's action asks for a sync at once (`requestSync`), and `durable()` waits for one. |
| Boot | [store.ts](../../packages/apack-ears/src/lmdb/store.ts) | Opening the store is the boot: there is no hydration, so boot cost and heap do not grow with the data. |
| Run history | [record-store.ts](../../packages/apack-ears/src/lmdb/record-store.ts), [run-history.ts](../../packages/apack-sdk/src/services/run-history.ts) | Flow runs are not in the engine: they are whole records in a record store of their own (`run-history`), found through indexed fields, one transaction per write without a sync. |
| Streaming writes | [stream-writer.ts](../../packages/default-setup/src/content/actions/claude-code/_helpers/stream-writer.ts) | Text updates are throttled to 80 ms by default and replace accumulated text. Microtask coalescing does not merge separate timer events. |
| Process ownership | [ApiServer.ts](../../packages/main/src/modules/api-server/ApiServer.ts), [config.ts](../../packages/main/src/modules/api-server/config.ts) | Electron Main starts the API child process. The child owns EARS and persistence; packaged execution uses Electron as Node. |
| Backup | [store.ts](../../packages/apack-ears/src/lmdb/store.ts) | `copyTo()` is LMDB's copy of one read transaction: every unit committed before it, with no buffer of pending writes left to flush. |

Notes use in-memory `CONTAINS` and `REFERENCES` traversal. Chat commands update message attributes,
timestamps and thread relations. Brain execution writes `TNode` lifecycle records to the run history, outside the engine. These are the
representative workloads for validation, rather than a synthetic key-value throughput score alone.

## Storage design

Retain one environment, with `meta`, `entities`, `attrs` and `relations` named databases.
The existing encoding is:

```text
primary/entities:
  Message-123 -> { type: "Message", createdAt: ... }

primary/attrs:
  text␟Message-123␟0   -> { t: "string", v: "Hello" }
  status␟Message-123␟0 -> { t: "string", v: "queued" }
  blocks␟Message-123␟0 -> { t: "array", v: [...] }

primary/relations:
  Relation-456 -> {
    kind: "CONTAINS", src: "Thread-789", tgt: "Message-123", createdAt: ...
  }
```

Keep the existing storage layout and encoding. No new named databases, history summaries, index
rebuild machinery or database-format changes are required by this plan. Preserve reset, import and
backup behavior. Follow repository data policy if implementation reveals a necessary format change;
conversion of obsolete developer data belongs outside normal boot.

Attribute-filter execution is a separate proposal. It is not a dependency of persistence reliability
and does not justify introducing persistent component indexes or archetypes here.

## Persistence contract

Keep `query()` and the write builder synchronous. Add a host-owned persistence boundary for logical
repository commands that require atomic storage, with asynchronous commit acknowledgment at the
service boundary where durable completion is promised.

- Preserve logical command boundaries across scheduling. A microtask is a batching opportunity, not
  an atomicity contract; an `await` must not silently split a command that promises atomic persistence.
- Include entity destruction, its attribute removal, relation changes in the unit.
- Commit a unit atomically within one environment. Do not fall back to independent row commits for
  a command whose contract requires atomicity.
- Validate before changing memory where possible. Specify how a failed commit leaves memory and
  queued work: retain recoverable work and expose a failed-save state; define retry ordering and how
  superseding updates are handled. Do not imply that database rollback reverses in-memory mutations.
- Expose a flush barrier that acknowledges all writes accepted before it, and propagates failure.
- State explicitly that separate environments cannot commit atomically together. Define history
  behavior when primary succeeds and history fails, and the inverse, before promising completion.
- Flush and await completion before shutdown, a durable stream-completion acknowledgment, backup,
  reset and store replacement. Define the write-admission boundary during each operation.

For background updates, initially evaluate a maximum 16 ms window, flushing earlier at 1,000 changed
keys or 1 MiB of encoded changes. These are provisional tuning inputs, not measured budgets. A logical
atomic unit cannot be split just to meet a size threshold: large commands need an explicit bulk-operation
contract. Bound queue growth and apply backpressure instead of accepting unlimited pending writes.

Retain the existing 80 ms streaming throttle and force the final update through the durable boundary.
Batch bulk imports into explicitly defined units and yield between them. Measure repeated replacement
of growing text and block values before introducing a different storage representation.

LMDB copy-on-write does not by itself establish a fragmentation problem. Track reusable space,
file growth and reader lifetimes under a sustained workload. Close iterators promptly; never retain a
reader across a user interaction. Use deliberate compact snapshot copies when measurements justify
maintenance, then verify and replace files only with the store closed. Ordinary saves do not compact.

## Process and build architecture

Keep heavy database operations in the existing API child process, managed by Electron Main. Moving
them into Main would put synchronous database work on the window-management event loop. Bound API
materialization and response sizes as well: a fluid renderer still feels stalled when requests wait.

Move persistence to a worker only if measured commits block the API beyond the accepted budget.
That design must preserve a single ordered writer, bounded batches, sequence acknowledgments,
backpressure, flush barriers and clear failure propagation. Do not create a worker boundary speculatively.

At audit time, root `package.json` pins Electron 37.2.4 and development Node >=23.5.0. The API declares
`lmdb: ^3.4.2`; the inspected installation is 3.5.3. Packaged execution uses Electron's Node 22.17.1,
while development uses system Node. The two runtimes need separate verification.

LMDB uses platform prebuilds, including Node-API builds. Keep selective rebuilding rather than blanket
Electron rebuilding. The existing install/build flow includes:

```sh
npm ci
npx electron-rebuild --only node-pty
```

No additional LMDB-specific rebuild is required on supported prebuilt targets. Add an actual database
open/write/close/reopen check under the packaged executable on every shipped platform and architecture.
Unsupported prebuilt targets may require a source build. Package-presence validation alone cannot prove
that the native binary loads.

SQLite's built-in `node:sqlite` could remove an external database addon, but its APIs in Node 22.17.1
are synchronous and under active development. Verify module availability in the packaged executable
before relying on it. Changing databases would not remove the app's `node-pty` rebuild requirement.

Runtime references: [Electron 37.2.4](https://releases.electronjs.org/release/v37.2.4),
[Node 22.17.1 SQLite API](https://nodejs.org/download/release/v22.17.1/docs/api/sqlite.html),
[LMDB bindings](https://github.com/kriszyp/lmdb-js), and
[SQLite WAL](https://www.sqlite.org/wal.html). Recheck runtime claims when dependencies change.

## Implementation checkpoints

Each checkpoint requires its deliverable and closing checks before the next dependent change.

| Checkpoint | Deliverable | Dependencies | Closing checks |
|---|---|---|---|
| 1. Establish budgets | Representative workload and measured baseline for commit duration, queue age/bytes, hydration, heap and file growth; define acceptance budgets | None | Reproducible dataset and workload; distinguish source findings from measured results; use existing instrumentation where possible |
| 2. Specify persistence units | Concrete API and failure semantics for logical commands, memory divergence, retries and flush acknowledgment | 1 | Trace message creation and graph deletion through success and failure; review all lifecycle callers |
| 3. Implement durability | Buffered destruction, atomic units, bounded background scheduling and barriers in lifecycle operations | 2 | Crash/reopen, commit failure, retry ordering, deletion, stream completion, shutdown, backup, reset and replacement checks |
| 4. Verify shipping behavior | Packaged-runtime database smoke coverage and final workload comparison | 3 | Native loading on shipped targets, no unacceptable API/UI stalls, bounded queues and acceptable sustained file growth |

## Validation and completion

Use meaningful failure and lifecycle tests rather than tests that mirror buffer implementation. Cover
atomic multi-record persistence, final acknowledged writes after reopen, failed saves, full-disk behavior
in an isolated temporary store, and backup/restore.

Run focused checks during implementation, the existing EARS benchmark with
`npm run bench -w @apackdev/ears`, and `npm run chain` after code changes. Public export changes also
require the repository's API report workflow. Follow the typed-EARS checklist before touching its
change-controlled types. This plan alone requires documentation and link checks, not implementation suites.

The work is complete when persistence acknowledgments have explicit tested semantics, lifecycle barriers
prevent acknowledged writes from being omitted, and representative sustained workloads meet the budgets defined
in checkpoint 1. Worker extraction remains conditional on measured stalls; SQLite remains a future
architectural choice if the query workload moves to disk.
