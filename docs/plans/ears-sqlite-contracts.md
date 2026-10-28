# EARS backend contracts for SQLite

Survey: committed app `a1b6603e5ae628ccbb90ea125a9822b7f178931f`, merged with prototype/planning checkpoint
`8a1bf789d3468effbea500cb92f1437636729d1c` in detached candidate `3f4c54b7a92c47aafd9d661fc551b6393b1f7765`.
Execution belongs to [the SQLite goal](../goals/goal-ears-sqlite.md). This matrix preserves requirements while the
private binary port is replaced by structured requests/results.

## Ownership and acceptance

Paths in the test column are relative to `packages/apack-ears/tests/` unless prefixed otherwise.

| Contract | Current owning code and tests | SQLite responsibility |
| --- | --- | --- |
| Pack-facing types and fluent builders | `src/entities.ts`, `runtime.ts`, `typed.ts`, SDK `TYPED-EARS.md`; default-setup typed suites and published-package checks | Preserve shape/id/field/relation/role typing and result ownership. Update exported construction/storage types and API reports together if the internal port changes. |
| Schema declarations | `src/schema.ts`, `engine.ts`; `vocabulary.spec.ts`, host `tests/database/open-app-database.spec.ts` | Preserve declared names, enabled/disabled pack lifecycle and append-only `declare` behavior. Validate/refuse changes atomically. |
| Typed fields added after the prototype | `schema.ts` canonicalization; `engine/writes.spec.ts` section “fields typed by a type's shape”; SDK declaration/codegen tests | Every ordinary write validates resulting values: optional/nullable, enum, list, declared references, undeclared-reference text fallback and text-source coercion. Enforce at the backend, not only in typed callers. |
| Unchecked repair/import | `engine.ts` admin loads; `engine/bulk-load.spec.ts` and `engine/writes.spec.ts` “loads a row ... whatever it holds” | Preserve deliberately unchecked admin loads, including orphaned data and missing required fields. A normal write validates what it changes; app import acceptance validates the candidate before publishing it. Do not accidentally enforce ordinary-write constraints on repair APIs. |
| Entity identity, reserved attributes, roles and numbering | `write.ts`, `engine/writes.spec.ts`, `relations.spec.ts`, `vocabulary.spec.ts` | Atomic refusals, non-reused numbering, engine-owned timestamps/roles/trash, unregistered-name refusal, relation/entity distinction. |
| Value fidelity and ownership | `database.ts` codecs/freezing; `engine/writes.spec.ts`, `search.spec.ts`, prototype operational cases | Preserve Date, binary, missing versus null, arrays/maps and own `__proto__`. Structured reads return independent values. Frozen reads preserve existing semantics. |
| Query starts, filtering and order | `query.ts`; `engine/queries.spec.ts`, independent `_harness` model | Scope/trash, caller ID order and duplicates, type/creation order, scalar/list membership, null/missing rules, filter ordering, limits/cursors and first/last semantics. SQL optimizations must preserve the pipeline. |
| Sorting, distinct and groups | `engine/queries.spec.ts` mixed-value ordering and group cases | Native SQL for supported declared types; documented canonical ordering/fallback for heterogeneous values. Eliminate quadratic prototype algorithms where corpus growth makes them unsafe. |
| Relations and traversal | `engine/relations.spec.ts`, model-based suite | Deferred endpoint checks, unique/acyclic rules, adjacency filtering, BFS order/deduplication and trash handling. Walk each source in requested-kind order, then insertion order. Explicit relation-end filters match even a trashed or missing end; unconstrained adjacency requires a reachable end. Prefer batched/native SQL to per-node crossings without changing order. |
| Units and savepoints | `database.ts` connection; `engine/transact.spec.ts` and model suite | Lazy write unit, own writes, savepoint rollback/release, atomic refusals, no unit/commit for read-only work, synchronous body contract and one commit for nested successful writes. |
| Commit identity | `engine/sqlite-operations.spec.ts` immediate following writer regression | Capture own sequence before unlocking; never reread a later writer's sequence as the completed unit's identity. |
| Commit-outcome errors | `runCommitted`, connection and admin paths; `engine/watch.spec.ts` committed-error cases; host import tests | `NOT_DURABLE` means known committed; `SCHEMA_CHANGED` means uncommitted/stale. Real SQLite I/O failure mapping needs evidence, not just proxy tests. Preserve original errors during refresh/recovery. |
| Dependency tracking and watch delivery | `watch.ts`, `engine/watch.spec.ts`, model watch harness | Precisely track keys/ranges, invalidate successful writes and same-value write intent as contracted, freeze/compare results correctly, dispose safely and deliver errors without losing future state. |
| Watch scheduler added after the prototype | `watch.ts`; `engine/watch-schedule.spec.ts` | Preserve bounded reruns, coalescing/skipped states, clock/timer rules and settlement. This suite currently creates elmdb directly: move its database fixture behind the shared backend selector before claiming SQLite coverage. |
| Call counting added after the prototype | `calls.ts`, connection; `engine/calls.spec.ts` | Count semantic reads/writes/units, sites, watch reruns and measured duration across either backend. Report physical SQL binding calls separately if added; do not silently change existing call-count meaning. |
| Query explain added after the prototype | `query.ts` `explain`, `runtime.ts` QueryExplanation/QueryStage; `engine/queries.spec.ts` explain cases | Actual SQLite plans/timing and correctly defined work metrics. Preserve useful diagnostics and update consumers where backend-specific fields differ; no fabricated native-key or VM counters. |
| Text search | `engine/search.spec.ts`, source search declarations and SDK language choices | Preserve important identifier matching, fields, phrases, list boundaries, highlights and supported language decisions. Relevance corpus governs scoring/ranking changes. Shared assertion changes need an explicit behavior decision. |
| Vectors and hybrid | `engine/vector.spec.ts`, prototype operational cases | Model/hash/chunk freshness, filtering, rollback and hybrid semantics; evaluate algorithm latency at stated recall using representative dimensions/distributions. |
| Live index readiness | Current native builder contract in EARS guide and engine schema paths | Reads correct while backfill proceeds; generation/watermark/change reconciliation, atomic publish, cancellation and crash recovery. A worker alone does not remove SQLite writer contention. |
| Database open and run history | host `src/database/open.ts`, database tests and `tests/services/run-history.spec.ts` | Independent store ownership, read-only/closed/missing/permission/corruption distinctions, registry admission and safe run-history refusal/aside policy. |
| Backup/import/media recovery | host `src/backup/index.ts`, `tests/backup/import*.spec.ts` | Storage descriptors/openers, validated snapshot, populated replacement, recovery copy, acceptance/media rollback and both-error preservation. Resolve four filename-preflight failures through actual composition. |
| Developer tools and maintenance | host/CLI database entry points and tests | Supported export/import/audit/rebuild/diagnostics, explicit copied-profile conversion. Disposition raw elmdb-only APIs outside EARS explicitly. |
| Distribution and durability | host shared-instance/binding rules; packaging/native workflows | One supported loader/owner, pinned FTS/vector capability, packaged Electron/CLI, OS/architecture and filesystem policy, matched durability, real fault/crash evidence. |

## Integration boundaries

The pinned native engine is `933aa19f04355784412cadf4938f9b49e35e564d`, which includes compressed larger field values
and field-write improvements absent from the experiment's `9359949` addon. Compare SQLite against a matching
artifact from disposable validation; do not reuse the old binary as if it proved the new baseline.

The other agent's working tree contains additional uncommitted search/schema/manifest changes. They are not part
of this contract snapshot and must not be copied. Reconcile relevant committed changes at the next explicit
integration checkpoint. Original prototype test counts do not establish parity with this snapshot.

## Structured backend boundary

Retain the existing EARS operation/query vocabulary as a typed internal contract; do not introduce another query
language. A backend accepts structured read requests and write batches, returns structured answers/change sets,
and owns snapshots, write units/savepoints and commit outcomes. `src/storage.ts` owns the discriminated request/
answer vocabulary, including query steps and terminals. Compile-time assertions exercise the actual database,
unit and connection entries; direct-port shared cases check result tags as well as facade behavior. Common connection code owns transaction nesting,
observers, frozen-result handling and call instrumentation. SQLite accumulates dependency changes only after a
batch succeeds and within its current savepoint; rollback discards the local delta, release merges it and commit
collects still-open descendants. Native deliberately retains rolled-back keys conservatively, so shared contracts
require no missed dependencies and correct primary rollback; exact rollback invalidation is a stronger SQLite
requirement verified separately within those cases.

The elmdb adapter alone encodes/decodes its native protocol. SQLite executes structured operations directly.
Lossless storage may still encode individual values; that is separate from serializing already-live requests and
answers between JavaScript modules. Describe codec/storage costs separately in performance evidence.

Schema normalization and typed validation need one clear owner. Preserve the canonicalization decisions already
made by EARS, but remove accidental dependence on an elmdb-only storage schema from the future SQLite public factory.
The first slice must include an ordinary typed write, an intentionally unchecked repair load, selective read/page,
nested rollback and committed watch notification so the boundary is tested on both sides of the checked/unchecked split.


The authoritative-layout integration also pins two value boundaries in the shared query-value suite: unchecked
primary entities remain filterable through all/ID starts even if their type is not declared, and undefined object
properties are omitted while undefined list positions are refused. Native and SQLite both pass these cases.
SQLite applies the omission per changed value rather than serializing a structured transport envelope.
