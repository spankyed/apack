# Focused architecture and maintenance review — 2026-10-30

Inspected candidate checkpoint `1d7a3de090d74028ca36eba574686da8c794609a`, whose production inputs remain
63c8267994 and test diagnostics 0126eda005. This is a phase-7 source review, not a completed adoption audit,
new test execution, approval to change a budget, or an assertion that every implementation path was reviewed.
The accompanying source inventory binds the inspected module footprint and critical ownership paths. Runtime
qualification and unresolved failures remain in the [current goal](../../../../goals/goal-ears-sqlite.md#current-handoff).

## Assessment

The storage port has a useful boundary: EARS owns its typed operation/query vocabulary and synchronous
facade; the elmdb adapter alone encodes native requests, while SQLite consumes structured objects directly.
SQLite owns its pager, B-trees, transactions, recovery log and FTS. This candidate does not implement another
pager or transaction log. It still owns a substantial semantic engine: schema normalization, SQL planning,
lossless values, graph traversal, watch dependencies, index admission, ANN lifecycle and app recovery.
Adoption should be justified by total maintenance and app-level behavior, not by the name of the base store.

There are 35 immediate TypeScript modules and 5756 lines under `src/sqlite` at this checkpoint; the database
orchestrator is 1663 lines. The selected native patch is 133 patch-file lines, not a claim of 133 changed C
statements. These describe review surface, not quality thresholds or an excuse to split files mechanically.
The design already reuses better-sqlite3/SQLite, FTS5, sqlite-vec, upstream vec1, msgpackr, AJV and lru-cache.
Additional libraries are useful only where they replace an owned invariant with an equally strong contract.

## Invariant owners and evidence boundaries

Fully qualified paths start at the repository root. Unqualified `tests/sqlite` and shared `src/` paths
start at `packages/apack-ears`; SQLite module basenames refer to its `src/sqlite` directory. Test names
identify where proof belongs; their existence alone does not prove every operational condition passed.

| Invariant | Code owner | Existing proof and remaining limit |
| --- | --- | --- |
| One authoritative value representation; absent/null/type distinctions survive | `packages/apack-ears/src/sqlite/values.ts`, `embeddings.ts`, `logical-records.ts` | Shared value/repair models and platform EARS suites; representative growth/large-field/peak-memory qualification remains |
| Schema refuses stale or conflicting state under writer ownership | `schema-validation.ts`, `database.ts:setSchema`, `index-builds.ts` | `tests/sqlite/schema-validation.spec.ts`, `schema-admission.spec.ts`, search-build/recovery cases; live-load budgets remain |
| A COMMIT error with ended transaction does not invent a definite outcome | `database.ts:commitWrite`, `abortFailedOperation` | `tests/sqlite/commit-outcomes.spec.ts`; real ENOSPC separately qualified; syscall-level I/O/unknown-outcome evidence remains |
| Rolled-back mutations never publish watch changes | `src/database.ts`, `src/watch.ts`, SQLite unit/change collection | Shared unit/watch models and `tests/sqlite/watch-lifecycle.spec.ts`; sustained load/external-writer scope needs final evidence |
| Canonical vectors outlive derived model/generation retirement | `embeddings.ts`, `vectors.ts`, `vector-index.ts` | Model/rollback/audit suites and real-corpus byte verification; large concurrent maintenance/resource qualification remains |
| Native candidate projection participates in the foreground transaction | `vector-index.ts:triggers`, `vector-candidates.ts` | Generation/model tests and ordinary-SQLite membership controls; complete real multi-chunk/hybrid/load coverage remains |
| Only committed readiness and the current physical generation become readable | `index-builds.ts`, `vector-models.ts`, `vector-training.ts` | Durable attempt/result protocol and model ownership/recovery tests; interruption/resource matrices remain |
| Directory publication and managed handles cannot race within the supported protocol | `packages/apack-host/src/database/recovery-lock.ts`, `backup/restore.ts`, `database/open.ts` | Claims/identity/reset/import-kill/platform witnesses; arbitrary external rename/delete or raw writers are outside this cooperation contract |
| Failed replacement retains an incumbent and truthful recovery/publication state | Host backup/import/recovery composition and CLI command wrappers | Logical/crash/CLI negative witnesses; Windows directory durability and physical I/O remain |
| Stored metadata cannot choose executable extension paths; signing refreshes final hashes | `sqlite/native-extension.ts`, `native/vectors/build.mjs`, packaging/signing scripts | Three-host provenance/membership and six signed macOS arm64 cases; other required architecture/executable flows remain |

## Findings and disposition

### A1 — Vector work scales with the scanned partition population (phases 4/7, open)

`vector-training.ts` trains 64 buckets; `vector-index.ts:candidates` explicitly requests nprobe=32.
The pinned vec1 source's `vec1InterpretNProbe` treats an argument above one as a bucket count, and
`vec1DoKANN` iterates the requested buckets and scans their blocks. With balanced buckets this requests
about half the quantized population. Distribution skew and filtering affect actual work; this is not an
assertion that every query scores exactly half the vectors or a wall-time attribution.

For fixed bucket/probe settings, the scan component grows with N. Sorted integer membership replaces
repeated linear list comparisons with logarithmic comparisons, but it does not turn the partition scan
into a graph search. A useful cost model separates SQL eligibility, operand construction/sort, visited
metadata/vector blocks, candidate-owner expansion and canonical owner reranking. Reranking is proportional
to the selected owners' current chunks times dimensions; multi-chunk owners matter. The measured failed
heartbeat gates and existing native counters make this a performance decision, not merely a naming issue.

Disposition: finish the matched current-native comparison before selecting another optimization. If the
scan remains dominant, preregister a separate index/model-strategy comparison with explicit training data,
holdout, recall, update, memory, durability and transactional-freshness criteria. Keep the existing 64/32
results and failures visible. Do not silently reduce probes/owner targets, tune to the held-out answers,
promote an alternate library without transaction/recovery proof, or call a different protocol the original
matrix passing. No alternative or setting is selected by this review.

### A2 — Cooperative projection slicing does not bound synchronous COMMIT (phases 3/7, open)

The scheduler's row/time bounds cover JavaScript/native projection work before the transaction finishes.
vec1 can perform deferred work in COMMIT, and FULL synchronizes durable state. A background training worker
therefore does not by itself keep the synchronous foreground connection within the heartbeat budget.
The existing COMMIT attribution and heartbeat failures are stronger evidence than inspecting the slice loop.

Disposition: distinguish projection, deferred native commit processing, synchronization and scheduling
with actual bounded diagnostics. Keep all original work, heartbeat and durability gates. A remedy must
preserve current synchronous semantics and truthful acknowledgments. If those contracts cannot meet the
measured budget on the supported execution boundary, present a concrete product/API/hardware tradeoff for
explicit approval; do not redefine the test after seeing the result. This review does not authorize one.

### A3 — Real I/O outcome evidence is still narrower than the error-handling implementation (phase 6, open)

The ended-COMMIT fencing and rollback-error aggregation are sensible. Most IOERR/acknowledgment tests
currently replace driver methods. Real filesystem ENOSPC is now covered, but it is not an fsync/read/write
I/O fault and does not establish both sides of an uncertain commit. A failed COMMIT must not be replayed
based on an assumption about SQLite's rollback behavior.

Disposition: add a disposable syscall-level fault observation scoped to one owned database/WAL and one
armed operation, with the exact injection log. Prefer an available mature tracer/test VFS before writing
production infrastructure. Verify fencing, original cause, watch silence, orderly close, reopen and an
internally consistent sequence/row outcome without predeclaring that ambiguous I/O definitely committed
or definitely rolled back. Test control/cleanup failures as relevant; do not call it device power-loss proof.

### A4 — Windows namespace durability remains unimplemented (phases 5/6, open)

`packages/apack-host/src/backup/recovery.ts:syncRecoveryDirectory` returns immediately on Windows.
Exclusive Directory.Move publication fixes overwriting a competing destination, but exclusivity is not
proof of durable namespace publication. The same helper serves recovery preparation, restoration and
history quarantine. Passing backup/rename/process-kill tests cannot fill this physical guarantee.

Disposition: choose the supported Windows publication/synchronization contract from authoritative OS
semantics, implement it at the shared host boundary and qualify the real operation. If the required
portable guarantee cannot be provided, request an explicit platform/product disposition. Do not quietly
change the helper to a different best-effort operation or mark the skipped directory-sync witness passed.

### A5 — Operational support must remain explicit (phases 5/6, partly evidenced)

The read-only-mount observation now distinguishes rollback-journal published backups from WAL files that
need existing sidecars or a writable directory. Managed profile readers also need writable claim metadata.
Claims and ordinary-file admission protect cooperating opens in a stable private namespace, not arbitrary
network storage, mount aliases or a noncooperating process replacing inodes.

Disposition: retain the documented support boundary and source-bound platform evidence. Additional
filesystem/ACL/permission/refusal qualification belongs in the existing operational matrix. An immutable
SQLite URI is not an acceptable silent workaround for a potentially live database. No extra filesystem
certification claim follows from this review.

### A6 — Keep one transaction coordinator; improve row typing at selected seams (maintenance recommendation)

`database.ts` coordinates format/open, schema, unit state, reads/writes, watches and maintenance; `query.ts`
and several projections use `Record<string, any>`. This increases the cost of auditing SQL-result assumptions.
The existing smaller value/index/model modules and backend-neutral requests already provide useful seams.
The statement cache has explicit count/text-size bounds. Dynamic physical names are numeric catalog IDs;
logical values are bound or explicitly quoted. These are strengths to preserve.

Recommendation: when changing a query or lifecycle path for a demonstrated defect, give its selected SQL
row a named internal type and keep transaction/commit ownership in one coordinator. Prefer compile-time
precision and boundary validation over validation/allocation on every hot row. Extract a component only
when it removes a concrete responsibility/coupling, not to satisfy a line-count rule. Run independent
semantic/property models and affected consumers. This is a review recommendation, not a newly invented
mandatory refactor or permission to broaden the current defect fix.

### A7 — The native patch is an explicit upgrade obligation (phase 7, retained)

The build is offline/pinned, checks the upstream and patched digests, stages provenance, preserves upstream
license, and checks membership against ordinary SQLite. Installed signing refreshes the actual final
library bytes. Those controls reduce accidental drift; they do not remove review work on the next vec1 or
SQLite/binding upgrade. The narrow patch's buffer ownership and NULL/wide/mixed cases remain important.

Disposition: keep the existing documented upgrade checklist and selected patch small. Require all relevant
membership, EARS, real recall/performance, platform and installed/signing proof before changing it. An
upstream contribution may eventually reduce fork maintenance, but no external issue/message is authorized
or sent by this review. Schema names still mention elmdb in shared normalization/comments; on adoption,
move terminology/docs to the surviving owner together with API reports, without adding compatibility aliases
or retaining a second production backend. The structured vocabulary itself is already EARS-owned.

## Recommended execution order

1. Complete the two existing live observations: full current-native real-vector baseline and focused
   macOS frontend timeline. Use their terminal reports to choose fixes; do not duplicate live work.
2. Close the demonstrated app/strict failures and the specific operational gaps, then affected suites.
3. Select the next vector decision from measured stages and total lifecycle cost, preserving original gates.
4. Finish representative app/resource/quality/architecture coverage and final exact-input acceptance.
5. Present the adoption decision with measured benefits, regressions, ownership and approved dispositions.
   Production stays elmdb until that decision; an unfinished benchmark or green narrow suite is insufficient.

This review does not close the full phase-7 requirement or waive any phase 3–6 acceptance condition.


## Later dependency review: Vectorlite is not a transactional substitute

At upstream[e68e41f435e777c5542c852d7d85af90186158b5](https://github.com/1yefuwang1/vectorlite/blob/e68e41f435e777c5542c852d7d85af90186158b5/README.md),
Vectorlite documents no transaction support, an in-memory index and explicit persistence/load operations.
Its published platform set also excludes this local Linux arm64 validation host. These are upstream
contracts, independently checked at that exact revision; no speed/recall measurement was performed.

Engineering inference: adopting it would require an explicitly rebuildable process cache with
transaction/unit visibility, rollback, cross-handle freshness, startup/recovery and memory ownership.
A faster HNSW benchmark alone would not satisfy those requirements. It remains a possible separate
architecture investigation, not a drop-in replacement or a selected dependency. Keep the current
candidate and failed responsiveness gates intact until the matched post-Seagate evidence is complete.
This focused review does not settle the final ANN choice or the maintenance/adoption audit.


## Pinned baseline algorithm and commit boundary

The exact native pin2441af4658d961f547c7094cd041c2ac246668c5 declares hannoy0.3.0,
not Arroy. Its[vector owner](https://github.com/spankyed/elmdb/blob/2441af4658d961f547c7094cd041c2ac246668c5/crates/elmdb/src/engine/vector/mod.rs)
uses HNSW build parameters16/32. Query setup requests max(4K,16) graph neighbors and
sets ef_search to at least64, with candidate restrictions and separate pending-unit reconciliation.
The commit path applies journaled changes and invokes the affected graph builder once per changed graph.
These are inspected source facts, not a profile identifying the cause of embedding cost. In particular,
a builder call per64-item durable batch does not by itself prove a whole-graph rebuild or quadratic growth.
The resumed27900-embedding diagnostic is not a fresh-ingestion timing; compare acknowledgments and
post-Seagate storage boundaries explicitly, and retain the native signed-zero byte gate failure.
