# EARS backend contracts for SQLite

Current integrated app master is `461f7bf2cb9f52b968957a423744168740bf37a7`; the pinned native engine
is `f496470679a7bd9764398108b20f62a73333c701`. The current goal records subsequent relation-key and canonical-schema qualification; the weighted receipt below retains its original source. [Focused weighted execution](../references/evidence/ears-sqlite-implementation-2026-10-28/weighted-focused-4ded/README.md) verifies the new shared weight contracts and lossless logical paths, with only retained text relevance failing. This does not qualify final platform, performance or app acceptance. Earlier [native integration evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/native-2441-integration/README.md)
and comparisons retain their original `2441af4658` pin.
The [SQLite goal](../goals/goal-ears-sqlite.md#current-handoff) owns current candidate source, qualification
and remaining failures. This matrix preserves requirements at the structured backend boundary; older
benchmark/failed-suite evidence retains its original source and native artifact.

## Experiment completion report (qualification in progress)

**Recommendation: retain elmdb in production.** The SQLite candidate demonstrates a feasible
implementation of the complete app-facing API; the evidence does not establish a net adoption benefit.
The candidate remains isolated in draft PR #286. This recommendation does not close unresolved gates
or authorize closing the PR, merging, migrating profiles or removing either implementation.

| Area | Demonstrated result and disposition |
| --- | --- |
| Functional app lifecycle | [Latest complete source-app replay](../references/evidence/ears-sqlite-implementation-2026-10-28/full-app-26c/README.md): 33 eligible passes, one packaged-only exclusion, zero failures/flakes, no retries. Ten main-window discovery cases and testing-workspace typecheck pass; the unit artifact is retained outside Playwright cleanup. Previous navigation and cleanup failures remain in the evidence history. |
| Integration and platform | [All four strict consumers pass](../references/evidence/ears-sqlite-implementation-2026-10-28/strict-81-consumers/README.md). Host completes 613 files in 518.61 seconds under 600; only the frozen keyword judgment fails. Six independent Electron smoke cases pass. [Three-platform host/readiness checks](../references/evidence/ears-sqlite-implementation-2026-10-28/platform-81/README.md) pass their stated scope with explicit exclusions. This is not a fully green strict chain. |
| Packaged runtime | [Linux and Windows native/API probes](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-eb/README.md) pass on actual Electron. [Current signed macOS](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-3ec-signed/README.md) also passes strict signing, post-sign native smoke and all six installed cases without exclusions/retries. The final app replay also passes the later test-only terminal-exit wait. Signing is not notarized distribution. |
| Foreground responsiveness | **Accepted known degradation by explicit user decision.** Search remains synchronous. Original 16 ms heartbeat misses remain failures in the recorded measurements; they no longer block experimental completion. Chunk-skew heartbeat p99 reaches 91.44 ms, and controlled synchronous checkpoint calls take 735/86 ms. No async worker API is implemented or promised. |
| Search quality | [Current-runtime frozen judgments](../references/evidence/ears-sqlite-implementation-2026-10-28/relevance-b989/README.md) retain keyword usefulness of 24/25 on both backends and pinned English hybrid retrieval of 25/25. The remaining generated-metadata judgment is not waived. Broader language/provider/model/UI coverage remains incomplete; limited passing fixtures cannot establish general search quality. |
| Latency and resources | [Current ordinary managed corpus](../references/evidence/ears-sqlite-implementation-2026-10-28/corpus-b989/README.md) verifies 1,800 queries, minimum mean recall 0.95671875 and all original query-p95 limits; eight heartbeat groups retain the accepted degradation. At 99.9k, load/admission take 68.96/42.52 s, recorded logical storage is 1.94 GB and process high-water RSS reaches 1,571,764 KiB including fixture/reference/harness data. These do not isolate engine cost or establish instantaneous disk bounds. Warm query results are workload-dependent. SQLite ordered watched reads are about 31 ms versus native 9.7 ms in the admission cohort. Startup's earlier 55.69% median gap is not stable across cohorts; opposite-order replay narrows it to 1.11%, without a causal engine claim. SQLite seed ingestion remains about 9.5 s versus native 1.55–2.25 s. [Cold/warm reopen](../references/evidence/ears-sqlite-implementation-2026-10-28/cold-27/README.md) verifies actual file residency on one Linux host, not whole-app/device cold start. |
| Recovery and disk | [Actual transient EIO](../references/evidence/ears-sqlite-implementation-2026-10-28/history-ae9/README.md) now refuses ambiguous CORRUPT without quarantining intact history. Worker fault/retry and process-death fixtures preserve their stated invariants. [Controlled retained-reader checkpoint](../references/evidence/ears-sqlite-implementation-2026-10-28/wal-c471/README.md) shows 765 MB logical main/WAL/shared-memory overlap, not an instantaneous peak bound. No physical power-loss or arbitrary-filesystem certification is claimed. |
| Maintenance burden | SQLite supplies transactions, page recovery and FTS execution, but this candidate still owns schema/value semantics, invalidation, live admission, native-vector lifecycle, backup coordination and a patched extension. The implementation and below invariant/dependency review do not demonstrate lower total maintenance cost than elmdb. |

The completion audit must still reconcile exact final source, remaining
search quality/coverage, required resource/fault regimes and later strict-chain stages. Only foreground
responsiveness has an approved degradation disposition. Measurements and historical failures remain
unchanged. Production stays on elmdb pending an explicit separate adoption decision.

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
| Induced graph algorithms | `query.ts`, `runtime.ts`, `storage.ts`; `engine/relations.spec.ts`, `sqlite/graph-algorithms.spec.ts` | Preserve query scope, first-encounter node identity, edge multiplicity, direction, PageRank seeds and stable score ties, ordered weak/strong components, stable SCC-condensation topological order, scoped neighbour-set similarity and deterministic seeded Leiden communities. SQLite projects the selected graph in SQL; iterative graph work uses query-owned memory. Genuine Leiden uses locked `leiden-rs@0.8.1` through a synchronous WASM transport; the unchanged native quality fixture and watch/trash cases pass in focused checks. Exact-current native/platform parity, resource/performance and package maintenance qualification remain required. Do not replace Leiden with Louvain or infer adoption from connectivity alone. |
| Substring and regex filters | `schema.ts` `substrings`; `query.ts` `containing`/`matching`; `engine/search.spec.ts` | Preserve pipeline order, per-element matching, case folding, write freshness, `UNKNOWN_INDEX` and `PATTERN_INVALID`. SQLite uses the pinned Rust-regex WASM bridge (`src/sqlite/regex.ts`) and native indexed literal narrowing. JavaScript backtracking regex is not an equivalent replacement. Current qualification and packaging evidence are owned by the goal; the three original integration failures are historical, not current open failures. |
| Sorting, distinct and groups | `engine/queries.spec.ts` mixed-value ordering and group cases | Required: native SQL for supported declared types; documented canonical ordering/fallback for heterogeneous values; eliminate quadratic prototype algorithms where corpus growth makes them unsafe. Current: native SQL scalar ordering uses keyed value lookups; heterogeneous ordering retains its documented comparator. Distinct/groups batch the requested field, preserve first encounter order, merge missing/null scalar keys, and keep each decoded object/array/date unique as the pinned native backend does. Shared query contracts and the grouping-258 evidence cover identity semantics and bounded statement counts. Further SQL aggregation/materialization improvements remain resource qualification work. |
| Relations and traversal | `engine/relations.spec.ts`, model-based suite | Deferred endpoint checks, keyed edge identity, duplicate-edge refusal and acyclic rules, adjacency filtering, BFS order/deduplication and trash handling. Walk each source in requested-kind order, then insertion order. Explicit relation-end filters match even a trashed or missing end; unconstrained adjacency requires a reachable end. Prefer batched/native SQL to per-node crossings without changing order. |
| Units and savepoints | `database.ts` connection; `engine/transact.spec.ts` and model suite | Lazy write unit, own writes, savepoint rollback/release, atomic refusals, no unit/commit for read-only work, synchronous body contract and one commit for nested successful writes. |
| Commit identity | `engine/sqlite-operations.spec.ts` immediate following writer regression; `sqlite/commit-outcomes.spec.ts` counter/refusal cases | Capture own sequence before unlocking; never reread a later writer’s sequence as the completed unit’s identity. Counter advancement validates finite representable integers: exhausted valid commit/schema counters refuse NUMBERS_EXHAUSTED without rounding; malformed values refuse CORRUPT instead of reseeding. Refused units/imports/schema changes roll back and do not report a committed invalidation. A missing key’s initial value is distinct from an explicit null. |
| Commit-outcome errors | `runCommitted`, connection and admin paths; `engine/watch.spec.ts` committed-error cases; host import tests | `NOT_DURABLE` means known committed; `SCHEMA_CHANGED` means uncommitted/stale. Real SQLite I/O failure mapping needs evidence, not just proxy tests. Preserve original errors during refresh/recovery. |
| Dependency tracking and watch delivery | `watch.ts`, `engine/watch.spec.ts`, model watch harness | Precisely track keys/ranges, invalidate successful writes and same-value write intent as contracted, freeze/compare results correctly, dispose safely and deliver errors without losing future state. |
| Watch scheduler added after the prototype | `watch.ts`; `engine/watch-schedule.spec.ts` | Preserve bounded reruns, coalescing/skipped states, clock/timer rules and settlement. Pending unawaited watches permit exit; explicit settlement waits retain their delivery timer. Closing the database releases tracked dependencies and cancels delivery. Its database fixture uses the shared backend selector; retain coverage for both drivers. |
| Call counting added after the prototype | `calls.ts`, connection; `engine/calls.spec.ts` | Count semantic reads/writes/units, sites, watch reruns and measured duration across either backend. Report physical SQL binding calls separately if added; do not silently change existing call-count meaning. |
| Query explain added after the prototype | `query.ts` `explain`, `runtime.ts` QueryExplanation/QueryStage; `engine/queries.spec.ts` explain cases | Actual SQLite plans/timing and correctly defined work metrics. Preserve useful diagnostics and update consumers where backend-specific fields differ; no fabricated native-key or VM counters. |
| Text search | `engine/search.spec.ts`, source search declarations and SDK language choices | Preserve important identifier matching, fields, phrases, list boundaries, highlights and supported language decisions. Relevance corpus governs scoring/ranking changes. Shared assertion changes need an explicit behavior decision. |
| Vectors and hybrid | `engine/vector.spec.ts`, prototype operational cases | Model/hash/chunk freshness, filtering, rollback and hybrid semantics. Ordinary cosine embeds/queries reject wrong dimensions, nonfinite Float32 components and all-zero Float32 vectors (including JS overflow/underflow); another embedding model is refused before obsolete-hash handling. Refused batches preserve pending work, commit position and watches. Evaluate algorithm latency at stated recall using representative dimensions/distributions. |
| Live index readiness | Current native builder contract in EARS guide and engine schema paths | Reads correct while backfill proceeds; generation/watermark/change reconciliation, atomic publish, cancellation and crash recovery. A worker alone does not remove SQLite writer contention. |
| Database open and run history | host `src/database/open.ts`, database tests and `tests/services/run-history.spec.ts` | Independent store ownership, read-only/closed/missing/permission/corruption distinctions, registry admission and safe run-history refusal/aside policy. |
| Backup/import/media recovery | host `src/backup/index.ts`, `tests/backup/import*.spec.ts` | Storage descriptors/openers, validated snapshot, populated replacement, recovery copy, acceptance/media rollback and both-error preservation. The format-aware host composition and storage/import suites replace the prototype filename preflight. Preserve real refusal, rollback and uncertain-outcome evidence; final filesystem, interruption and durability qualification remains required. |
| Developer tools and maintenance | host/CLI database entry points and tests | Supported export/import/audit/rebuild/diagnostics, explicit copied-profile conversion. Disposition raw elmdb-only APIs outside EARS explicitly. |
| Distribution and durability | host shared-instance/binding rules; packaging/native workflows | One supported loader/owner, pinned FTS/vector capability, packaged Electron/CLI, OS/architecture and filesystem policy, matched durability, real fault/crash evidence. |

## Integration boundaries

The current integrated base is app master `461f7bf2cb9f52b968957a423744168740bf37a7` with native engine/binding
`f496470679a7bd9764398108b20f62a73333c701`; the EARS adapter uses the structured relation
direction protocol. App `05490e387a` with native `7b484b0834720d6d7b4fb89270d4ac02a6f42c1d`, and native
`2441af4658`, belong to earlier checkpoints. Earlier integration
used native `6ab2f69fa13289ed4f02952253c58b4d41922c98` and app
master `98386b36a1`, while earlier facade/admission measurements used `933aa19f04355784412cadf4938f9b49e35e564d`
where their provenance says so. Those measurements do not qualify the current artifact.

Only committed inputs enter an integration. Relevant later committed changes require another pinned integration
and gate; neither dirty source nor a moving reference establishes acceptance.

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


## Packaged platform qualification boundary

The shipping targets in `electron-builder.mjs` are macOS arm64, Windows x64 and Linux x64.
Local Linux arm64 is a validation environment, not an additional shipping target. The recorded
master rebase preserves the previous package trees; the integrated master is `461f7bf2cb9f52b968957a423744168740bf37a7`, with native pin
`f496470679a7bd9764398108b20f62a73333c701`. Earlier package trees remain historical evidence.
Three-host Node/backend passes do not prove packaged Electron loading. Current packaged and signed installed evidence covers the projected-hit runtime corrections; later CI-only probe recipes do not change those runtime inputs.

The new `installed-platform` dispatcher builds the normal unsigned Preview on Windows x64 and
Linux x64, then calls the existing `build/prod/smoke-native.mjs` against its unpacked resources.
It requires actual packaged Electron provenance, native ownership,4097-vector worker model admission,
FTS/regex queries and read-only reopen, plus elmdb/PTY/keyring controls. Its evidence is explicitly
native/API runtime only: renderer, installer/signature and final app/platform/strict acceptance remain
separate. [Current Linux/Windows qualification](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-b7b/README.md)
at `b7bfb36671` passes both packaged native runtimes and all four Preview contract cases per platform.
[Current signed macOS qualification](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-d2e-signed/README.md)
at `d2e6f5f74e` passes deep/strict signature verification, post-sign native smoke and all six installed cases once.
These checkpoints include the projected-hit runtime corrections; their later differences are CI/evidence inputs.
Private signing has no timestamp/notarization and does not certify distribution. Missing/skipped witnesses refuse;
Node-only checks do not establish packaged execution, and these passing installed cases do not establish performance acceptance.

## Candidate invariant and maintenance review

This is the current ownership/risk inventory, not completion of phase 7. The active goal owns exact
source and final qualification. Recovery and cross-type query regressions have source-pinned focused evidence; the later empty-scope
like-reference and dependency-subscriber changes pass focused da1636c9ea execution. Earlier passes do not prove final-source acceptance.

| Invariant or concern | Owner and present evidence | Remaining decision or proof |
| --- | --- | --- |
| Primary values outlive derived generations | `values.ts`, `embeddings.ts`, `logical-records.ts`; canonical vector bytes belong to `embedding_values`, not generation-owned chunks. Logical round trips preserve lossless cells and dormant embeddings. | Final-source audit/rebuild/import and resource qualification; preserve originals in any failure experiment. |
| Truthful write outcomes | `database.ts` `commitWrite` and `abortFailedOperation` own commit/rollback/poisoning. Replacement now closes its read-only source before destination commit and preserves primary/cleanup failures. Actual successful WAL sync followed by process kill preserves complete writes, units, bulk load and schema changes. | Actual faae1545e2 post-sync EIO/error-return/kill-before-close probes recover complete committed data with COMMIT_UNKNOWN read quarantine in all four operation families. The later source-close ordering correction has pure negative controls and all 13 actual driver commit-outcome cases pass at 77cbd28f38. Process death and injected syscall errors do not certify power loss, arbitrary filesystems or real device failures. |
| One identity sequence across entities and relations | Writers share `next('seq')`; staging's `identities` table enforces global uniqueness. Audit, restore and export now detect cross-table collisions. Relation audit also checks positive safe-integer sequences. | Focused 7347dbdfc0 and later runs execute the physical-store/spool/export corruption regressions; retain final-source qualification. The new foreign-key check stops at its first violation rather than allocating every violation. |
| Pipeline scope and ranked limits | `query.ts`, `query-scope.ts`, `vectors.ts`; eligibility precedes vector K. Scoped graph references and trash traversal have actual focused evidence. New fixes apply vector K globally and fuse hybrid ranks across types. | Focused fcbe188ba0 passes global/filtered mixed-type text/vector search and independent hybrid legs on both adapters. Focused da1636c9ea also passes empty-scope like resolution. Do not use earlier single-type timing results to prove these invariants. |
| Reference-dependent reactive reads | `search.ts` resolves `like` from the reference type's generation; `requireReady` records that type's dependency. Candidate scoring remains in the queried type's scope. | Cross-type reference re-embedding/watch regressions pass on recorded focused/platform source; the latest empty-candidate reference case passes focused da1636c9ea. Broad per-type read invalidation remains a performance concern to measure under realistic watch load. |
| Pack schema admission and accepted authority | `host/database/open.ts` binds one live writable schema/readiness owner. `packs/registry.ts` prepares prospective tables/binding, checks existing owner health, and admits declarations before map publication/activation/retirement. [Real-peer baseline refusal](../references/evidence/ears-sqlite-implementation-2026-10-28/admission-refusal-ae9/README.md) exposes the old ordering bug; [fixed focused 112-case run](../references/evidence/ears-sqlite-implementation-2026-10-28/admission-9b7/README.md) preserves incumbent authority and files, checks cleanup/rebinding and forwards fresh committed/uncertain outcomes into readiness. | Integrated source `f61acd3c7d` passes both actual-write-unit controls on Linux/macOS (312 host cases each) and Windows (309 passes/six explicit host exclusions), plus complete SQLite source-app acceptance (33 passes, one packaged-only exclusion, no retries/flakes). The remaining strict consumers and operational/installed checks remain separate. Initial-owner binding refuses on declaration failure; replacement NOT_DURABLE/COMMIT_UNKNOWN is accepted identity with unavailable readiness, never permission to start actors. Backend quarantine remains authoritative. Injected installer outcomes do not prove physical faults. |
| Exclusive mutable native model ownership | `vector-owner.ts`, `index-builds.ts`, `vector-models.ts`; a held descriptor owns a persistent claim inode, and worker shutdown precedes release. No unlink-and-relock protocol is used. | Validate shutdown, paused maintenance, concurrent readers/writers and failure recovery on final supported runtimes. No claim that CI hosts certify network filesystems. |
| Native dependency and upgrade burden | Ordinary package production owns pinned better-sqlite3/sqlite-vec, the vec1 extension, Rust-regex WASM and portable Leiden WASM. Opens must not compile/download; packaged assets are checked against provenance. | Review each dependency's ABI, licenses, reproducible build/upgrade procedure and installed signing path together. SQLite has not eliminated native maintenance or the owned query/index scheduler. |
| Hybrid scaling | The candidate fuses the global top `max(40, 4*k)` vector results with text ranking. Native distinct-owner targets are 256 through K=32, 1,024 through K=40 and 2,048 through K=64. Small eligible sets and K>64 remain exact; raw BQ fallback stays at 256. [Actual adaptive-policy evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/adaptive-policy-49ae/README.md) passes all 1,800 fusion cases and per-group independent Float64 recall means, minimum K=64 0.9571875. | One warm model/pass is not model/update/trash/cold variance or app qualification. Preserve full-ranking overlap and independent usefulness evidence; bounded output does not imply bounded candidate-filter or distance work. |
| Responsiveness and resource limits | The original 16ms/100ms/200ms targets remain. The d027 current-master real paired hybrid matrix runs at 2 CPU/6 GiB/no swap, meets size-specific query p95 targets and still fails every 99.9k heartbeat group. Scoped eligibility now streams distinct IDs into bounded chunk lookup; pure old/new SQL controls prove early stopping and stable small/duplicate/limited answers, the c802 corpus receipt now preserves all 1,800 recall/query-p95 passes and the retained heartbeat failures. The subsequent built-package 470 comparison is slower than elmdb on every timed task; its post-GC process RSS is lower, and its open-file sizes include live WAL. The f55 built-package remeasurement retains passing projection correctness and improves the SQLite/native field ratio from 4.43x to 2.60/2.47x, still slower; CPU differences limit absolute cross-run causality. Multi-clause scoped FTS prefix reuse now has old/new SQL answer/evaluation-count controls, but actual-driver and representative resource qualification remain pending. | Meet heartbeat and foreground/admission budgets, then qualify cold/reopen, sustained app/write/watch load, memory/disk/WAL/checkpoint behavior and model variance. The sampled probe-count comparison is diagnostic only; production remains at 32 probes. |
| Long-term ownership | The pack-facing facade stays separate from storage construction. Production still selects elmdb; SQLite is an isolated candidate. | Adopt one backend only after the complete gate and explicit decision. Remove obsolete production paths and temporary comparison selection on adoption; do not create a permanent two-engine product by inertia. |

The review sequence is correctness qualification of the new regressions, measured execution-policy
choices, complete app/resource/operational validation, dependency/recovery review, then the
requirement-by-requirement recommendation. Passing a focused suite is insufficient for adoption.

The scope optimization shares `SqliteEntityScope` between text and vector
execution. Filter/limit/graph prefixes stay in SQL through FTS membership instead of returning
all eligible IDs to JavaScript and rebinding them. Shared regressions cover prefix limits, trash,
caller-ID order, graph traversal and transaction rollback. A separate SQLite explanation guard
requires a five-result page to avoid materializing the 256 eligible IDs across the binding.
Selected hit IDs used for bounded highlight fetches remain query-owned. Focused dc19e4ecd2 passes
the five-row binding guard; the capped fallback matrix still has heartbeat failures. This is not
full app-flow or final-source performance qualification.


## Native dependency and upgrade ownership

This review records repository ownership and resolved metadata, not a license approval or final
adoption decision. Inspect package-local lockfile entries: root versions can belong to unrelated
consumers. The active goal owns runtime evidence and unresolved resource/recovery requirements.

| Component | Pinned input and runtime boundary | Upgrade work and required evidence |
| --- | --- | --- |
| better-sqlite3 | 13.0.3, MIT in the lockfile. Node/Electron native addon; its SQLite headers compile vec1. | Rebuild for each supported Node/Electron ABI and platform. Recheck SQLite version/options, transaction/error outcomes, extension loading, backup/read-only behavior, host/CLI and actual packaged runtimes. An npm install or source-Node pass does not qualify Electron. |
| sqlite-vec | 0.1.9, `MIT OR Apache` recorded by its package. Platform-specific SQLite extension supplies cosine/BQ operations. | Preserve supported architecture packages, load actual extension bytes in installed runtimes, rerun independent cosine/recall and malformed-vector checks. Keep canonical primary vectors independent of derived projections. |
| Patched vec1 | Upstream 814fd8ef4d42d6567f1613a66f556c8194764d06 plus the vendored membership patch. Source disclaimer is staged with the built library. | Review operand ownership/filter semantics when rebasing the patch; verify pinned source, patch, canonical generated C and target binary provenance. Run all 735 membership comparisons, native model/admission/unit/recovery cases, capped recall/resource comparisons and installed signing/loading. Rebuilding C is an owned maintenance obligation. |
| Portable Leiden | leiden-rs 0.8.1, committed Cargo.lock, Rust 1.99.1, wasm-bindgen 0.2.105. Ordinary package production builds synchronous WASM and collects dependency license texts. | Preserve source/loader/WASM provenance and per-handle memory isolation. Recheck the independent karate modularity target, deterministic seed behavior, error propagation, graphs with cycles/parallel edges, memory/runtime limits and installed execution. A different implementation must meet quality, not merely connectivity. |
| Rust regex bridge | Vendored rregex source/revision, regex 1.13.1, Rust 1.99.1 and wasm-bindgen 0.2.100 are recorded in its provenance. Only portable runtime/provenance/license files ship. | Rebuild in an owned disposable environment using the recorded adapter recipe; update loader/WASM/adapter hashes together. Repeat differential syntax/Unicode/per-element checks, conservative literal-narrowing negative controls and allocator compile/free controls. Preserve explicit pattern disposal. |
| Native file locking | fs-native-extensions 1.5.2, Apache-2.0 recorded by the lockfile. Owns kernel locks for claims and maintenance. | Recheck actual same-process/cross-process exclusion, killed-owner recovery, maintenance pause/resume and shutdown on supported platforms. Preserve the held persistent claim inode; unlink/relock is not equivalent. CI host filesystems are the tested scope, not certification of network/external filesystems. |
| JavaScript validation/cache/transport | EARS resolves Ajv 8.20.0 (MIT), lru-cache 11.5.2 (BlueOak-1.0.0) and msgpackr 1.11.9 (MIT) in this lockfile. | Preserve strict typed versus unchecked writer contracts, bounded caches, lossless primary cells and native structured transport. Check package-local dependency resolution and emitted public API/publish ownership rather than reading unrelated root package entries. |

Build ownership is concrete: `scripts/build-package.ts` invokes `native/vectors/build.mjs`
and `native/graphs/build.mjs`, stages target assets/notices and only publishes its staged tree
after checks. `src/sqlite/native-extension.ts` and `community-core.ts` own runtime hash validation.
Regex asset hashes are checked by `tests/sqlite/regex.spec.ts`; its lazy loader uses the ordinary
package module loader and propagates missing/runtime failures, rather than rehashing on every
compiler construction. Opening an app-owned database must load trusted package assets, never
compile, download or choose executable locations from database metadata. Vector/graph provenance
mismatches refuse; do not generalize that runtime-hash claim to the regex module loader. Explicit internal fallback fixtures are not evidence that app opens may silently
ignore a missing native asset.

An upgrade checkpoint should pin the dependency/source changes, inspect the generated provenance
and notices, run focused correctness/negative controls, then close the named final platform,
installed/signing, app lifecycle, recovery and resource gates. Native libraries signed during
packaging change bytes: refresh the runtime manifest after inner signing and before sealing the
outer app. Preserve the previous tested application and disposable copies until replacement
and rollback witnesses pass. Do not infer a supported rollback from an unchanged format number;
pre-release layout changes still require the explicit copied-data conversion policy.

Operational recovery must distinguish authoritative primary data from derived models. Native
model corruption may be repaired through the owned pause/rebuild/audit path; it must not delete
canonical cells or embeddings. Unknown commit outcomes quarantine ordinary data operations until
fresh-open evidence resolves the state. Before removing/replacing private files, drain actual
workers and retain maintenance ownership through the operation. Keep the incumbent recoverable
when coordinated database/media replacement fails. Source-pinned corruption/kill/rollback tests
support these contracts; broader storage/worker fault regimes and complete app/resource qualification remain open
in the goal. The specific post-sync EIO/error-return/kill-before-close regime now has actual
complete-commit and quarantine evidence at faae1545e2.

The adoption decision must account for this whole ownership surface. SQLite removes LMDB page,
reader-slot and custom storage-format responsibilities, but EARS still owns query translation,
watch invalidation/scheduling, text adaptation, native model admission/projections and lifecycle
coordination. Current evidence supports continuing qualification, not a second permanent backend
or a cutover justified only by a fast microbenchmark.


### Dependency invalidation complexity

`read-tracking.ts` now owns both registrations and the inverse dependency-tag subscriber index.
Ordinary commits visit their changed tags, global subscribers and affected readers, then order those
affected readers by registration. They do not enumerate unrelated registrations. Expected lookup
work is O(changed tags + matching subscriptions + A log A), where A is the distinct affected reader
count; global invalidation deliberately visits all nonempty registrations. Removing a read costs
its dependency count. Diagnostic owner/key/range counts are maintained incrementally.

Pure Node qualification passes 4,000 operations against the previous independent scan semantics,
including tag overlap, global changes, removal and clear, and selective invalidation with 10,000
registrations while Map iteration is forbidden. Actual focused da1636c9ea passes shared engine watch cases; its model harness still opened elmdb under SQLite selection, so it does not establish SQLite model coverage. It also passes the four
subscriber tests on both adapters. Final-source broad and resource qualification remain required. This improves subscription selection only:
coarse per-type tags may still select many watches, and their rerun cost remains measured by the
original scheduler/foreground budgets. No responsiveness pass is inferred from the complexity fix.

## Relation-key rebase qualification

Master 984f / elmdb f496 identifies edges by kind, ends and declared info key fields. SQLite now follows relink replacement, omitted-field preservation, map/list/byte key equality and DUPLICATE_EDGE update refusal, and audits unchecked collisions without repairing them. Normal optional relation `info: null` follows native `Option<Value>` decoding and means omitted; nested `{key: null}` remains a key value. Raw imported scalar keyed info is diagnosed by audit. Between lookups use `(source,kind,target,seq)`.

The [091 focused receipt](../references/evidence/ears-sqlite-implementation-2026-10-28/relation-focused-091/README.md) identifies a model coverage gap: previous harnesses opened elmdb even under SQLite selection. Those reports do not establish SQLite model behavior. Current source selects and witnesses the real backend while preserving master's independent bootstrap-copy setup; its actual SQLite random/watch workloads pass at 63e and on Linux/macOS a8; Windows a8 hits the unchanged 30s random-model deadline, while its watch model passes. [Actual a902 platform receipts](../references/evidence/ears-sqlite-implementation-2026-10-28/platform-a902/README.md) now show all independent random/watch model cases passing on Linux/macOS/Windows, without changing the random-model deadline. Later runtime changes, including scoped readiness, still need fresh qualification. No model acceptance is inferred from a green native run or an environment variable alone.

## Actual read-only filesystem qualification

Linux platform CI now prepares a built-package database, mounts an alias with a genuinely read-only bind mount and starts an independent reader through it while a writer uses the writable path. Both processes require an actual mount record with `ro` and kernel `EROFS`, separately from EARS `READ_ONLY` and driver `SQLITE_READONLY` refusals. A retained reader pins one-row visibility while the writer commits sixteen 32 KiB rows and checkpoint truncation reports busy; release reveals all seventeen rows, reader exit is joined, and truncation then completes. The test uses the repository's quick-class watchdog wrapper and owns its mount cleanup.

The [actual a902 Linux ext4 receipt](../references/evidence/ears-sqlite-implementation-2026-10-28/platform-a902/filesystem-readonly.json) passes this independent reader/writer probe, including kernel EROFS, snapshot preservation, checkpoint blocking/release and joined exit. The pure receipt verifier also rejects missing reports and fifteen altered kernel/snapshot/checkpoint/exit/source witnesses. Writable-filesystem readOnly tests do not substitute for it. A pass covers the CI-host mount/filesystem only, without certifying network filesystems or device power-loss behavior.

## Native canonical ranks and planner qualification

Native f496 now serializes empty `ranks: {}` in canonical dump schemas. SQLite accepts that empty declaration so explicit copied-profile conversion can consume the current native format. Nonempty named maintained rank indexes are explicitly UNSUPPORTED; EARS EngineSchema does not expose them. No declaration is silently dropped. Existing on-demand query.rank behavior is separate and unchanged. The actual matching-producer conversion failed on this root property in platform a8 and passes all five copied-profile check groups in focused c27 on Linux after the correction. The skipped downstream/Windows gates still need qualification.

Adjacency plan guards require a persistent indexed SEARCH bounded by source equality, not one literal index name. relations_between is a valid covering access path alongside relations_source. Native plans that scan all relations or search only target do not satisfy the guard. Existing answer, call-count and early-cursor-release assertions stay intact. Source-plan predicate controls and actual focused native/SQLite driver cases pass at c27. Full supported-platform requalification remains required.

## App embedding and search lifecycle evidence

The shipped Library IndexedDoc declaration uses `openai:text-embedding-3-small`, 1,536 dimensions. The approved Qdrant DBpedia paired corpus names the same model/dimensions; its independent recall evidence concerns that stored embedding space, not an actual OpenAI request or Library-document usefulness. The separate frozen guide/hybrid judgment uses pinned English MiniLM at 384 dimensions; do not label it production-provider coverage.

SDK `services/embeddings.spec.ts` checks provider model selection, batches and stale chunks with fake three-dimensional inference; the complete SDK passes on SQLite at a8. Existing default-setup Library search-index tests run the actual repository and SDK service pipeline using fake 1,536-dimensional word-axis embeddings. Platform CI now explicitly selects all four alongside the existing five Thread query-work cases and requires their counts separately: folder/subfolder indexing and search, scope exclusion, edited-text pending/re-embed, and separate list chunks. The [a902 platform receipts](../references/evidence/ears-sqlite-implementation-2026-10-28/platform-a902/README.md) now verify all four Library cases and five query-work cases on all three platforms. This proves wiring/data lifecycle at that source, not remote provider availability, semantic quality, a live search UI or ANN scale. Full strict source-selected tests and actual app-flow qualification remain separate required gates.

## Algorithmic review: retained work is not total work

Source review identifies these boundaries; measured receipts remain source-specific. The active goal owns unresolved acceptance, including the relation-key cost below.

| Path | Current work/space boundary | Required disposition |
| --- | --- | --- |
| Keyed relation identity audit | The earlier audit scanned g(g−1)/2 prior rows within g distinct endpoint keys ([pinned source control](../references/evidence/ears-sqlite-implementation-2026-10-28/relation-audit-complexity/README.md)). New source uses a private indexed fingerprint/ID spool and checks existing equality only on candidate collisions, with a bounded scratch-cache setting rather than a graph-sized JS map. [Implementation/semantic controls](../references/evidence/ears-sqlite-implementation-2026-10-28/relation-audit-spool/README.md) pass; actual-driver/codec/collision/cleanup witnesses now pass on all three platforms at [a902](../references/evidence/ears-sqlite-implementation-2026-10-28/platform-a902/README.md). The [six-trial Linux resource cohort](../references/evidence/ears-sqlite-implementation-2026-10-28/audit-resource-441/README.md) covers 50k small-key and 10k large-info fixtures, disk spill and cleanup; it is not a total-memory bound or complete app qualification. | Retain the passing semantic/resource controls and qualify final-source/app workloads, total resource peaks and operational conditions beyond those fixtures. Expected hash/index work is not an adversarial collision-independent CPU bound. A normal-write identity index remains a separate design requiring declaration/import/recovery ownership. |
| Ordinary keyed link/update | Endpoint lookup is indexed, then matching keys are compared in JS. The new source streams to its first match and closes its cursor before mutation; its actual-driver regression now passes on all three platforms at [a902](../references/evidence/ears-sqlite-implementation-2026-10-28/platform-a902/README.md); representative absent-key/high-multiplicity workload costs remain open. One absent-key operation is still linear in that group's rows/key sizes, and repeated distinct-key inserts can be quadratic. | Measure high multiplicity and bound transported rows. A first-match streaming improvement alone does not establish efficient distinct-key insertion. Avoid presenting graph-wide SQL transport improvements as a bound on this path. |
| Text clauses | Native FTS still enumerates relevant postings and may sort/group them; a small result limit does not bound that work. Multi-clause candidate prefixes are now shared per SQL statement and actual-driver count controls pass. | Representative corpus/heartbeat/resource results decide the materialization tradeoff. No fixed 16ms guarantee follows from fewer binding calls or one prefix evaluation. |
| Vector queries | Exact paths scale with eligible chunks × dimensions. ANN owner output is capped, but native probe/filter work and exact reranking still depend on model, scope and chunk multiplicity; fallback may scan the eligible corpus. | Preserve independent recall and result-count semantics. Qualify filtering, fallback incidence, cold/reopen variance and foreground stalls; do not lower probes or bypass scope to meet a timing target. |
| Registry schema projection | Each registration copies the current maps, derives prospective whole-registry declarations and rebuilds contribution tables before schema admission. This is proportional to the accumulated declaration/contribution input plus backend declaration/index admission work; sequential registration of equally sized packs can accumulate quadratic projection work. Synchronous owner checks do not make schema admission free. | Measure realistic many-pack startup/install and retained-data declaration changes before adding caching or batching. Any optimization must preserve definite-refusal authority, synchronous installer acceptance, raw commit outcomes and dependency-scoped readiness; no throughput or bounded-latency claim follows from focused correctness passes. |
| Graph algorithms | Adjacency loading materializes selected vertices/edges. Component traversal is linear before stable output sorting; per-group/node ordering adds sorting work. PageRank uses repeated passes over selected vertices/edges up to the requested iteration limit. | Keep iterative traversal and explicit iteration controls. Measure selected graph size, skew/high-degree nodes and native/WASM transport plus memory, not only final output count. |
| Logical export/restore | Export first makes a private physical copy, then streams logical records; restore spools and rebuilds/audits a separate destination. Streaming does not remove physical-copy time, private disk needs, full validation or individual-value size costs. | Retain failure cleanup/source preservation and measure populated import/export/rebuild time and peak disk/WAL across the complete operational path. |
| Thread import writes and acknowledgment cost | `default-setup/features/threads/be/import-threads.ts` has no enclosing import unit: each message creates an entity, links it to the thread, then writes the reverse link. EARS builders send those requests eagerly (`ears/src/write.ts`), so the fixed 1,200-message seed issues at least 3,600 write requests before thread metadata and optional fields/media. The actor calls this importer synchronously. SQLite's default FULL-per-commit and native grouped acknowledgment differ; observed seed import is 9.48–9.50 s versus 1.55–2.25 s across the two lightweight runs. | Measure actual unit/commit/sync counts and matched acknowledgment policies before attributing the gap to SQL execution CPU. Preserve existing refusal/partial-result/media semantics before batching; a larger transaction changes failure boundaries. Yielding changes actor interleaving and needs cancellation/data-replacement ownership, not an unawaited async action. Neither weaker durability nor changed import atomicity is an authorized timing shortcut. |
| Statement cache | Owned references are capped at 256 statements and 1 MiB of SQL text; this is not a measurement of native prepared-VM allocations or statements still held by callers. | Keep reference/text bounds separate from process memory claims and measure actual app connections/workloads. |

The built-package `bench/sqlite/vector-owner-resources.mjs` probe is added to the focused CI resource
path. [Actual 045 qualification](../references/evidence/ears-sqlite-implementation-2026-10-28/owner-resources-045/README.md) completes all cohorts: query p95 is 6.37/9.68/80.47 ms and heartbeat p99 is 5.98/9.27/91.44 ms, with the heavy cohort missing 16 ms. It holds 4,608 owners and 1,536 dimensions fixed while varying one owner's
chunks across 1/1,024/16,384, with its only winning vector in the final chunk. Twenty warm serial queries
per fresh process verify top-five identities/scores against independent trigonometric expectations and
record raw query/heartbeat samples, process memory and a post-query file-size snapshot. It explicitly uses
untrained fallback selection and low-rank synthetic vectors; it cannot qualify managed-model recall,
representative corpus resources, independent-trial variance, peak disk or app responsiveness. Existing
16 ms heartbeat limits are reported unchanged rather than hidden behind diagnostic workflow success.

These findings do not authorize deferring requirements or expanding the product into a permanent dual backend. They guide the remaining implementation, measurements and final adoption recommendation.


### Hybrid highlight admission

Hybrid fusion requires the complete lexical ranking but only final lexical winners need
body text, aliases, terms and highlight ranges. The candidate now ranks without details,
selects the same RRF winners, then fetches details by those winner identities in the same
read snapshot. It retains RRF scores; vector-only winners keep empty text metadata. The
second read does not reevaluate the original candidate pipeline. Multiple types, prior
limits, recency time, list/phrase boundaries and marker collision retries remain semantic
requirements. The work reduction concerns formatting/transferred bodies, not bounded total
ranking or SQL posting work. A real independent-writer regression also commits a body change between
ranking and detail retrieval, requires original-snapshot output, and confirms the
new value becomes visible after the read. It adds no production fault hook.

The new actual-driver witness compares original component ranks/canonical highlights,
checks mixed-type limited scopes and vector-only/absent results, and observes that every
returned highlighted row belongs to a final lexical winner. The [8ee Linux type/API/actual-driver check](../references/evidence/ears-sqlite-implementation-2026-10-28/hybrid-highlights-8ee/README.md)
passes the original formatting/score/metadata witness; the additional independent-writer
witness and fresh corpus/final integration checks remain required. The recorded paired
corpus/strict checkpoints predate this runtime and establish no performance improvement.

### Native CPU backend investigation

The pinned vec1 source provides explicit AVX2/NEON paths and upstream two-object runtime
dispatch. Ordinary x64 package production still compiles one generic object. The trusted
artifact [actually reports Scalar on exposed AVX2/FMA hardware](../references/evidence/ears-sqlite-implementation-2026-10-28/audit-resource-441/README.md).
This establishes backend selection at that source, not a measured cause of heartbeat failure.
Historical corpus reports without vec1_info cannot establish backend selection from CPU names.

The isolated `sqlite-vector-dispatch` suite compiles the identical checked patched source
as upstream scalar/AVX2 objects, with GNU/Clang AVX2 and explicitly no FMA. Upstream's
baseline object admits AVX2 using CPU/OS checks; no ordinary artifact or hardware baseline
is changed. [Actual build/runtime/membership checks](../references/evidence/ears-sqlite-implementation-2026-10-28/vector-dispatch-9c/README.md)
pass both libraries and 735 independent comparisons each. Future Windows dispatch must
account for the source's FMA assumption, not simply reuse AVX2 admission.

[Persistent-model interchange checks](../references/evidence/ears-sqlite-implementation-2026-10-28/vector-model-015/README.md)
pass eight fresh writer/reader processes, both directions at 128/1536 dimensions, 48 full
filtered comparisons, canonical cosine against independent Float64 within 4.221e-7,
unchanged read-only source and cleanup. The [original failed probe](../references/evidence/ears-sqlite-implementation-2026-10-28/vector-model-03e/README.md)
compared hidden transformed-space BQ distance to an absolute cosine tolerance. Corrected
checks retain those approximate deltas separately and keep the original canonical 1e-5
bound. No product score, original recall or heartbeat criterion changes.

[Paired corpus run 41303652459](../references/evidence/ears-sqlite-implementation-2026-10-28/vector-pair-b9/README.md)
at `b9f05c894a` completes with same acquired inputs, run identity, CPU, limits/source and
matching worker/foreground artifacts. Both builds pass original query/reference/recall
and query-p95 checks but fail all six 99.9k and both 10k all-live heartbeat groups.
There is no consistent query win. Single 99.9k model admission is 47.437s/12.988s;
independent models and uncontrolled OS cache preclude a causal speedup/variance claim.
[Seventeen protocol controls](../references/evidence/ears-sqlite-implementation-2026-10-28/vector-pair-protocol/README.md)
reject mixed run/artifact/worker/policy evidence and retain failed recall/heartbeat outcomes.
Keep ordinary artifacts generic; prioritize measured foreground work and qualify a future
build change independently rather than promoting SIMD from compiler flags or one pair.

[Worker checkpoint qualification](../references/evidence/ears-sqlite-implementation-2026-10-28/worker-checkpoint-dcc/README.md) holds an actual training read snapshot while 16 foreground
writes commit, observes WAL/truncation refusal, then checks release after worker exit,
under both OFF/FULL modes and both artifacts. It extends actual worker malformed-input,
cancellation and ownership tests; no production fault hook is added. Both artifacts pass all nine named training cases with no skips on Linux. The later
test-only SQL-interface correction still needs corrected-source qualification. This does not
replace sustained-load, busy-writer, storage-I/O or power-loss evidence.

Before any promotion, qualify actual unsupported-CPU fallback execution, all native-worker
semantic/fault contracts, independent recall/resource/responsiveness/model variance,
cross-platform packaging, provenance/signing and installed app behavior. No host-only
compiler flag, hardware-baseline increase or SIMD speed claim follows from source/build
success. The full unmet requirements remain owned by the implementation goal.

### FULL admission stall attribution

The ordinary 4ded FULL value cohort still fails heartbeat in five of six trials;
the df0 inspector/GC/cgroup diagnostic does not reproduce those outliers. CPU names
were absent from those admission receipts. New reports retain CPU identity, and only
the explicit diagnostic wraps the public write-commit method with monotonic wall spans.
This narrows an observed stall to COMMIT versus other background/foreground work; it
does not isolate fsync, exclusive CPU, host scheduling or physical device causes.
Ordinary workloads install no per-commit observer. Source typecheck, actual nonempty
commit events and preserved original profile/heartbeat/cgroup data are required before
interpreting the next trace. Do not change durability, batches or latency budgets from
a non-reproduction or use an instrumented pass as ordinary acceptance.

### Canonical distance ownership

`src/sqlite/vectors.ts` uses trusted loaded vec1 cosine for exact/final canonical reranking;
unextended internal fallback stores use sqlite-vec cosine. ANN selection remains vec1-owned.
Canonical bytes and the safe extreme-magnitude projections are unchanged. The seven independent
numeric regimes pass on Linux/macOS/Windows. Earlier kernel-only diagnostics compare SQL scans/sorts
on identical synthetic inputs and independently check Float64 scores; they are not full-query evidence.

The [current-scorer paired corpus](../references/evidence/ears-sqlite-implementation-2026-10-28/paired-scorer-3ba/README.md)
actually selects vec1 cosine in both Scalar/AVX2 variants. Both meet independent recall/query-p95
targets, but miss nine/eight heartbeat groups. It establishes no consistent foreground remedy,
default dispatch promotion or causal speedup across independently trained models/cache states.
Further kernel/dependency work must justify its effect on complete queries, preserve canonical
numeric/recall semantics, and requalify unsupported CPUs, ordinary packages and installed runtimes.

## Current adoption assessment

Keep production on elmdb and PR #286 in draft. The candidate demonstrates substantial functional
coverage, including real pack replacement, storage refusal, units, watches and the source app. It
has not met the complete adoption gate. The following maps the original goal phases; a passing
subtest does not complete the phase that contains it.

| Goal phase | Current evidence | Requirement still open |
| --- | --- | --- |
| 1: Freeze contracts and integrate | Rebased master `461f7bf2cb`, unchanged elmdb `f496470`, current contract matrix. [Current strict receipts](../references/evidence/ears-sqlite-implementation-2026-10-28/strict-790-consumers/README.md) at the native-readiness repair include all four passing integration/native consumers, with explicit platform exclusions and changed-input/no-cache-stamp warnings. Host completes all 613 files in 557.27 seconds under 600, with 7,018 passes/the retained keyword failure/95 exclusions; all six independent built Electron smoke cases pass once. | The retained keyword failure stops later dependent host-chain gates; passing consumers and source integration do not establish complete strict acceptance. Reconcile relevant future master/runtime changes deliberately. |
| 2: Structured storage and SQL slice | [Combined projected-hit qualification](../references/evidence/ears-sqlite-implementation-2026-10-28/projection-a4a/README.md) at a4a passes all 29 cost cases, source/test types, zero API diff and both actual source-reversion controls. Final hit projection now batches selective reads instead of issuing per-hit SQL. Shared SQLite/native pass 454/263 cases with only the retained keyword failure. | Complete current-runtime strict/platform/installed acceptance and remaining matched workload/transport/allocation requirements. Narrow cost proof and earlier timing comparisons are not final-source universal performance claims. |
| 3: Declarations, admission and watches | Definite-refusal authority and scoped-readiness source reversions pass. All eight native-readiness adapter regressions pass on [all three platforms](../references/evidence/ears-sqlite-implementation-2026-10-28/platform-790/README.md). [Repaired real-admission cohort](../references/evidence/ears-sqlite-implementation-2026-10-28/admission-watch-009/README.md) completes all six trials with final convergence and both builders finishing during foreground writes. SQLite observed readiness is 0.84–0.93 seconds/625 intervening writes; native 20.70–21.68 ms/33–34 writes, including polling delay. | Complete remaining app/resource regimes and final-source gates. SQLite phase/whole-run heartbeat p99 passes 16 ms in this cohort, while native whole-run p99 misses in all three; short native phase sampling is not broad percentile qualification. Earlier sustained SQLite cohorts and ordinary 100k admission retain misses, including 16.39 ms against 16 ms. Cross-run variance precludes a universal/causal speedup claim. The earlier a538 native immediate-wait timings remain invalid for build completion. |
| 4: Search and vectors | Frozen English hybrid usefulness is 25/25 with one pinned model; current managed Scalar/AVX2 corpora pass independent recall and query-p95 limits. | Keyword remains 24/25 without waiver. Language/provider/UI/model variance and foreground responsiveness remain unqualified; nine/eight paired heartbeat groups fail. Chunk-skew fallback reaches 91.44 ms heartbeat p99. |
| 5: Complete app lifecycle | [Earlier source-app qualification](../references/evidence/ears-sqlite-implementation-2026-10-28/full-app-5cd/README.md) at 5cd passes all 33 cases once, one packaged-only exclusion, no retries/flakes. Host refusal/rollback/readiness controls pass. The new graph-hit projected-field watch case passes on both engines, with actual reversion failure on SQLite. The earlier 50c real-flow baseline admits all 120 measured actions and 30 warmups across both stores. | [Initial startup setup failure](../references/evidence/ears-sqlite-implementation-2026-10-28/startup-10d/README.md) remains preserved. Corrected lightweight [native-first](../references/evidence/ears-sqlite-implementation-2026-10-28/startup-374/README.md) and [SQLite-first](../references/evidence/ears-sqlite-implementation-2026-10-28/startup-48b/README.md) runs each admit twenty measured trials per actual store. Native/SQLite medians are 4.59/7.14 s and 7.21/7.29 s respectively, with no production-source/lock/pin changes between sources. The earlier 55.69% gap is not reproduced; order, runner identity and within-cohort drift preclude exclusive attribution or declaring it resolved. SQLite seed import remains 9.48–9.50 s versus native 1.55–2.25 s outside startup. [Detailed profiling](../references/evidence/ears-sqlite-implementation-2026-10-28/startup-ea775/README.md) is diagnostic and does not replace lightweight acceptance. [Verified cold/warm storage reopen](../references/evidence/ears-sqlite-implementation-2026-10-28/cold-27/README.md) now passes eighty fresh-process trials over a 10k-row dynamic fixture with actual main-file residency controls. Its page/order results are mixed, and backend imports are excluded from open timings; it is not a whole-app/device or heartbeat pass. [Latest full app 44](../references/evidence/ears-sqlite-implementation-2026-10-28/full-app-44-failure/README.md) has 32 passes, one packaged-only exclusion and a Settings navigation timeout. The explicit renderer role, ten discovery cases and terminal-exit wait are qualified by the final full replay at 26c291d031: all 33 eligible app cases pass once, plus retained unit/typecheck evidence. The old trace lacks selected-role attribution, so causality is not retroactively asserted. Finish balanced/representative latency and ingestion assessment, whole-app cold/update/provider/device/resource coverage and final-source lifecycle. Earlier warm native-first app-flow comparisons use differing default durability and predate later runtime corrections. |
| 6: Operations and packaging | [Current three-platform checks](../references/evidence/ears-sqlite-implementation-2026-10-28/platform-81/README.md) cover the history policy repair and native readiness: new generic-CORRUPT refusal passes everywhere; Linux/macOS host 313/recovery 12 pass, Windows host 310/six exclusions and recovery two/ten exclusions. EARS retains only keyword failure; [actual-EIO refusal/preservation](../references/evidence/ears-sqlite-implementation-2026-10-28/history-ae9/README.md) now passes, while all four strict consumers now pass their separately recorded source scope. Earlier [packaged Windows/Linux](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-b7b/README.md) and [private signed macOS](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-d2e-signed/README.md) cover projected-hit runtime corrections before that repair. [Actual worker header/canonical-page EIO recovery](../references/evidence/ears-sqlite-implementation-2026-10-28/worker-bdfe/README.md) now passes canonical/commit preservation, no publication, drained 512-sample retry, foreground reuse and cleanup in both phases. [Sustained WAL](../references/evidence/ears-sqlite-implementation-2026-10-28/wal-473/README.md) verifies two-minute reader retention/release, writer refusal/reuse, reopen and cleanup. | Current Linux/Windows packaged native/API probes and signed-macOS lifecycle checks pass their recorded scopes; remaining final-source/storage/resource regimes remain required. [Actual metadata-page EIO](../references/evidence/ears-sqlite-implementation-2026-10-28/history-c159/README.md) confirms generic SQLITE_CORRUPT falsely quarantines intact/readable history and returns an empty replacement. The corrected policy refuses that ambiguous code; NOTADB retains quarantine, while internal malformed pages require explicit inspection/recovery. [Real v2 refusal/preservation](../references/evidence/ears-sqlite-implementation-2026-10-28/history-ae9/README.md) and all 47 host policy/publication cases now pass at ae9; that specific defect is closed, with broader storage/final-source gates still open. [Explicit checkpoint capacity](../references/evidence/ears-sqlite-implementation-2026-10-28/wal-c471/README.md) now passes all four cohorts, showing 765 MB logical overlap for the retained sustained fixture before reclamation. This is not instantaneous peak; its synchronous FULL/TRUNCATE calls take 735/86 ms, outside write-loop heartbeat percentiles, so synchronous maintenance stalls remain an accepted experimental responsiveness degradation, not a passing heartbeat result. Worker input-page failure does not prove compute-stage, all scheduler/resource or physical/device regimes. Private signing is not notarized distribution; CI hosts do not certify arbitrary filesystems. |
| 7: Ownership and adoption | This matrix and the invariant, algorithmic and dependency reviews identify concrete owned costs and failure boundaries. | Full requirement-by-requirement final recommendation after remaining evidence or explicit approved dispositions; no acceptance requirement has been waived. |

The user has explicitly chosen to retain synchronous app search and accept its foreground
responsiveness degradation for completion of this experiment. Do not implement the proposed async
worker API or continue optimizing solely to clear the 16 ms gate. Preserve the measured misses as
failures against the original budget, with an accepted experimental disposition; they are not passes.
This decision does not authorize adoption or waive correctness, recall, keyword usefulness, resource
accounting or recovery requirements. Finish functional validation and the completion report with a
clear separation between demonstrated results, accepted degradation and remaining limitations.

### Deferred app-search execution proposal (not selected)

This records an alternative that the user did not select; it authorizes no implementation.
Its deliverable would be the actual app search interaction completing within the existing query and
foreground budgets under representative writes, admission and chunk skew. Moving a function into a
worker is insufficient evidence. Keep the existing synchronous EARS methods and their blocking costs
explicit; the app would opt into an asynchronous repository/service operation.

- **Request ownership:** reuse the existing structured query vocabulary for the app's data-only search
  plans. Send declared scope, search options and requested projections, never JavaScript callbacks,
  database handles or executable paths from stored metadata. Construct the reader from trusted package
  assets and the host's selected profile/storage descriptor. An unsupported plan must refuse explicitly.
- **Snapshot identity:** execute each answer on one actual read snapshot and capture its commit identity
  inside that snapshot. The existing observer sequence is explicitly not a snapshot ID and cannot be
  reused as one. Include request identity and schema identity in the response. Scope/ranking/highlights,
  model/hash freshness and projected values must describe the same accepted request and snapshot.
- **Publication and invalidation:** the app owns current input identity and publishes only its current
  request. Committed writes and schema/index visibility changes schedule a fresh read; they must not
  disappear when a request is superseded. Preserve existing synchronous watch contracts. Define any
  app-level invalidation coarsening explicitly and measure its rerun cost rather than inventing precise
  dependencies the worker never registered. Test writes between read completion and response delivery.
- **Queue and cancellation:** retain at most one executing request and one latest pending request per
  owned search session; account for request/result size and active sessions as well as queue length.
  Coalescing and refusing stale publication do not prove that native work stopped. Qualify cancellation
  during actual FTS/vector calls and join worker exit where shutdown requires it; do not assume a
  JavaScript cancellation message or termination request interrupts a native SQLite call promptly.
  Measure rapid input, old expensive work followed by a small query, crash/restart and repeated cancellation.
- **Lifecycle and resources:** the host owns the read handle, worker and retained snapshots. Maintenance,
  backup replacement, schema changes and profile removal must account for actual reader/worker exit,
  retain incumbent recovery authority on refusal, and release WAL pins and kernel claims. Measure worker
  startup, native/JS memory, transport/allocation, retained-reader WAL growth and foreground writer contention.
  A responsive parent with unbounded obsolete native work or leaked readers does not pass.
- **Closing evidence:** extend the maintained real app-flow, search supersession and owned shutdown
  harnesses. Require useful results, current-response identity, source/native provenance, cancellation and
  maintenance failure witnesses, and the original 16 ms/100 ms/200 ms budgets on the declared representative
  workloads. Preserve the existing synchronous failures as a different execution contract. A relative
  backend claim additionally needs the same app scheduling/acknowledgment contract on both sides; comparing
  a worker path with a blocking baseline is not an isolated engine comparison.

The current experiment retains synchronous execution. Foreground responsiveness misses are an
explicitly accepted known degradation, not evidence of a responsive app. Revisit this alternative
only if the candidate is reconsidered for adoption.

### Sustained write/watch requalification

The existing built-package `bench/watch-stress.ts` now records loaded native hashes and an
independent deadline heartbeat, including a final blocking operation. The `sqlite-watch` CI suite
runs three fresh-process 60-second trials for each backend with views open/closed, alternating
backend/mode order and using matched durable units on both engines. Each store has 20,000 tasks;
views cover one row, a 50-row page and the ordered open-task set. It verifies convergence, records
all raw heartbeat samples and each process report, and retains failed/180-second-timeout outcomes
without retry. Execution is restricted to a disposable 2 CPU/6 GiB/no-swap container.

[The first run](../references/evidence/ears-sqlite-implementation-2026-10-28/sustained-bd4/README.md) completes all twelve fresh-process trials at `bd4e6f9506`: all views converge, SQLite passes all six 16 ms heartbeat-p99 cohorts while native misses them, but SQLite retains slower ordered reads and individual stalls up to 146.51 ms. Closed-view median throughput favors SQLite; open-view throughput favors native. It replaces no original acceptance requirement and does not qualify
actual renderer/provider/search flows, peak disk/WAL or independent-device variance. The earlier
five-second Seagate pilot remains historical evidence; its absolute timings are not a matched
hardware comparison with this new CI cohort. Preserve the queued workload rather than dispatching another run into the same pending slot.

### Existing application-flow harness admission

The `sqlite-app-flows` manual CI path reuses the maintained performance scenarios instead of duplicating
renderer/transport/streaming logic. It runs five warmups and twenty measured lightweight actions for
thread opening, search and deterministic CLI streaming on each backend, each in a fresh app/profile.
The common warm-scenario manifest now includes a verified `storageFormat`: both stores must have the
requested persisted markers, with SQLite application/format headers checked and mixed files refused.
A focused tooling control covers requested-versus-actual mismatch, mixed stores, foreign identity and
non-disposable profiles. Existing full raw-run/capture admission remains intact.

[The first real app-flow run](../references/evidence/ears-sqlite-implementation-2026-10-28/app-flows-50c/README.md) completes at `50cf9d6980`: 120 measured actions plus 30 warmups pass full capture admission across both backends. Script/test types and actual store-provenance controls pass. Native/SQLite medians are 430.20/546.55 ms thread opening, 16.15/27.70 ms search and 786.10/847.20 ms streaming completion. Default durability differs, so these are not matched durable-acknowledgment algorithm comparisons. It characterizes one warmed process per backend/scenario on one macOS
runner; its actual machine metadata remains visible. It does not replace bounded Linux/corpus/physical
failure or independent-device requirements, and no timing budget is redefined. Both earlier runs are terminal; the ordering-focused run at `126d5a9dff` now owns the active slot. These app-flow results precede that correction.

### Known-type numeric ordering

The repeated workload retains SQLite's slower ordered view. Source inspection identifies an avoidable
whole-candidate type-discovery query even when the pipeline guarantees one admitted type. The new
ordering path accepts that private scope fact, checks only for a first member to preserve empty-scope
short-circuit behavior, and retains the existing per-cell validation, numeric/tie semantics and fallback.
Mixed/unknown scopes still discover actual types. Existing inline/overflow cost witnesses now require
absence of the redundant discovery, and a traversal control distinguishes a narrowed destination type
from seed/mixed types. The focused disposable suite now collects the cost file.

[Focused qualification](../references/evidence/ears-sqlite-implementation-2026-10-28/ordering-126/README.md)
passes all 28 cost cases and 114 host cases at `126d5a9dff`, source/test types and an empty API diff.
Only the retained keyword judgment fails. A later disposable Linux source-mutation control must
restore the old discovery call, require the intended cost assertion to fail, and restore source bytes
before repeated workload measurement. Its child trees use the maintained bounded process owner.
The new metadata gate rejects twelve missing/skipped/duplicate/replaced witness controls against
the original passing report. Source-mutation execution and remeasurement remain unproven; no
speedup is inferred from reducing one scan. Final platform/app qualification remains separate.
