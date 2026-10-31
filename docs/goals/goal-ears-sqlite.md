# SQLite implementation for EARS

```text
# Goal: Deliver a production candidate for EARS over SQLite

Implement docs/goals/goal-ears-sqlite.md. Follow CLAUDE.md and docs/AGENTS.md.
Read Scope, Decisions, Phases, Validation and Current handoff before changing code.
The prototype checkpoint is 4a3fe698f8. The current detached integration combines master dc67febcce
and its native pin 2441af4658; full combined acceptance remains pending. Inspect the current handoff and actual source before continuing.
Work in the isolated session/ears-sqlite checkout and preserve concurrent work.

Finished when the SQLite candidate runs the complete app data lifecycle, all required
contracts and recorded performance/relevance/recall budgets pass, full validation is
recorded on pinned source in disposable environments, and a draft PR is ready for
an adoption decision. Commit usable checkpoints. Do not silently drop requirements.
```

Status: active candidate integration and qualification, 2026-10-30.
Branch: `session/ears-sqlite`. Checkout: `monorepo-worktrees.noindex/sqlite-evaluation`.
The original `session/sqlite-evaluation` branch preserves the experiment at `4a3fe698f8`.

## Scope

Build a complete, maintainable SQLite implementation of the app's EARS needs, using the prototype's tests,
fixtures and integration lessons. Replace its experimental execution/transport choices where appropriate.
The deliverable is a candidate that boots an isolated app profile and supports installed packs, entity and
relation operations, watches, search, embeddings, live declarations, run history, CLI data operations,
backup/import/recovery and supported packaging. A benchmark adapter or test-only factory alias is insufficient.

Preserve current data-integrity, transaction, typing, lifecycle and observability contracts, including relevant
work committed after the original experiment. Search acceptance measures user usefulness and explicit features;
exact scores and rank order need not reproduce elmdb. Important identifier matching, correct highlights and
phrase boundaries remain requirements. Typo handling, syntax and language choices must be specified and evaluated.

Use the [feasibility evidence](../references/evidence/ears-sqlite-evaluation-2026-10-27.md) as historical findings,
not current acceptance. Existing trial results used an older elmdb/API baseline and low-rank synthetic vectors.

A production cutover is the final adoption decision after a complete reviewable candidate. Until then keep the
normal production composition on elmdb. Use copied/synthetic profiles for SQLite; never migrate daily-use data
implicitly. Follow the repository's format-one policy: developer conversion is an explicit operation on a copy,
not a legacy compatibility layer in normal boot.

## Decisions

- Preserve the pack-facing EARS facade and its current typed contracts. Exported storage/construction types may
  change with every call site and API report updated together. Introduce a small private structured backend
  boundary using typed operations/results/transactions. Keep MessagePack where native boundaries or lossless
  persistence require it; SQLite's JavaScript path must not encode/decode requests and results unnecessarily.
- Adapt elmdb at that boundary while it remains the baseline. Avoid a general database framework, plugin registry,
  second query language or permanent dual-backend product. If adopted, SQLite becomes the single supported backend
  and temporary selection/comparison machinery is removed or retained only as explicit historical fixtures.
- Give SQLite selective filtering, projection, ordering, pagination, aggregation and traversal wherever compatible
  with the contract. Define necessary value/collation fallbacks explicitly. Do not promote the prototype's JS scans,
  per-node/per-row SQL loops, vocabulary scans or full-row rewrites into the final design by default.
- Choose one storage layout after measuring representative field reads, rows/pages, streaming field updates and
  typed dynamic declarations. Evaluate the prototype's duplicate MessagePack/JSON/index storage against selective
  typed storage. Do not assume either per-type SQL tables or a generic field layout is correct without this slice.
- Keep primary entity/relation data authoritative and derived indexes rebuildable. Derive watch invalidation from
  successfully committed logical mutations; keep precise commit identity and failed-operation atomicity.
- Keep backend-specific file/open/backup/recovery knowledge at the host storage boundary. Replace hard-coded
  `data.mdb` preflight with concrete storage descriptors and real open/validation paths, not marker files.
- Use a pinned FTS5-capable SQLite distribution and an explicitly chosen vector strategy. The tested
  better-sqlite3/sqlite-vec combination is a starting candidate, not a settled packaging or ANN choice.
- Local checks remain targeted EARS/driver/static checks. Compiler/captured-runtime tests and broad gates run in
  disposable Linux/CI. Packaged-platform checks use disposable runners/VMs. Session-specific compiler caches and
  independent dependencies/output are required; a Rust build additionally needs an isolated engine checkout and
  private target/artifacts. Do not borrow a mutable build from the other agent.

## Phases

### 1 Reconcile contracts and pin the integration base

Inventory changes since the prototype and map each current EARS/host requirement to its owning test and backend
responsibility. Include typed-field enforcement for every ordinary writer and the deliberate unchecked repair/import contract,
explain diagnostics, call counting,
watch scheduling/settlement and ongoing search/schema changes. Preserve useful prototype operational cases and
remove accidental protocol/implementation assumptions from shared assertions only through explicit decisions.

Integrate a pinned committed snapshot of the concurrent branch through the repository's detached integration
workflow in disposable Linux/CI. Never copy its dirty files or merge a moving branch blindly. Record the commit,
matching elmdb native artifact and inherited contracts. Reconcile later relevant changes at deliberate checkpoints.

Acceptance: a current contract matrix, a pinned clean integration result, baseline suites and native provenance,
and explicit search invariants versus approved behavioral flexibility. Source integration is not acceptance by itself.

### 2 Deliver the structured backend and first native SQL slice

Implement the private typed backend/transaction boundary and elmdb adapter. Put the SQLite candidate under normal
source ownership and production dependency/packaging conventions. Implement its chosen authoritative layout,
lossless value representation, typed validation, CRUD, relations, nested units and committed change delivery.
Complete native selective lookup, a representative page and a common graph query through the actual EARS facade.

Measure source-to-SQL mapping, binding calls, decoding/allocation and SQL execution separately. Include small
field updates in large entities so the layout is not selected by whole-row reads alone. Preserve useful call
counting; explain must report actual SQLite access paths rather than fabricate LMDB-equivalent work counters.

Acceptance: shared core/model tests pass for both adapters, the slice has verified query plans, and a first honest
EARS benchmark comparison on the pinned current baseline. Open the draft PR here with a working vertical slice,
its outstanding requirements and this goal. Keep it updated through the remaining phases.

### 3 Complete live declarations and watches

Implement type/field/index declaration validation and refusal atomically, including stale-handle checks and
interactions with open units. Define index states, build generations, committed change capture, readiness and
recovery. Backfill in bounded work, reconcile intervening writes and publish readiness atomically. Define correct
reads while an index is building, cancellation, reopen and failed-build behavior.

Choose foreground connection and worker ownership explicitly. Our synchronous API cannot become asynchronous
silently. Moving a long index build to a worker alone does not solve writer-lock contention: foreground calls
must not sit in a long busy wait. Set and test budgets for index admission, foreground stalls and WAL/disk growth.

Preserve scheduler behavior, watch settlement, commit identity, rollback and notifications for every write path.
Document same-process ownership and any deliberate cross-process limitation.

Acceptance: declaration changes during realistic read/write/watch load remain correct and within recorded latency
and resource budgets; interrupted builds recover; model/watch/scheduler tests and meaningful negative proofs pass.

### 4 Deliver search and vector behavior

Build a shared relevance corpus from representative app fixtures: identifiers/camelCase, names, accents, phrases,
field restrictions, typos, list fields, supported languages and mixed relevance/recency. Record expected useful
results before tuning. Specify matching, query syntax, language/stemming support, tie-breaking and highlighting.
Use native FTS indexes/ranking and only justified adaptation. Avoid an unbounded vocabulary scan per query.

Choose vector execution using target corpus sizes, dimensions, update rates and candidate-filter selectivity.
Use deterministic high-dimensional clustered and mixed corpora plus representative real embeddings from approved
fixtures. Compare exact ground truth, recall@k, latency and resource/update cost. If exact scan meets the app's
recorded budget, it is acceptable; otherwise select and qualify an ANN solution. Preserve model/hash/chunk
freshness, rollback, trash/candidate filtering and hybrid behavior independently of the search algorithm.

Acceptance: explicit relevance and recall targets pass, important search features work, and behavior differences
are reviewed against user needs rather than exact elmdb score equality. Extensions load in the supported runtime.

### 5 Integrate the complete app lifecycle

Replace test-only aliases with normal host composition for an explicitly isolated SQLite profile. Wire both app
and run-history stores, dynamic pack registration, SDK testing, CLI data commands, diagnostics, export/import and
settings/media acceptance. Exercise the actual app and representative streaming, browsing and reactive flows.

Complete storage descriptors, backup publication, read-only access, populated replacement and coordinated rollback
when database replacement, media installation or acceptance fails. Keep a durable recoverable incumbent when
restoration fails. Define corruption versus permission/disk-full refusal at run-history boot. Provide required
logical export, audit and rebuild operations for the app; disposition raw elmdb-only tooling explicitly.

Acceptance: the four known backup-import failures are resolved through the real storage path; complete lifecycle
and failure scenarios pass on disposable profiles, including a copied-profile developer conversion and reopen.

### 6 Qualify operational behavior and packaging

Map SQLite failures to truthful EARS outcomes. Do not classify an ambiguous COMMIT failure as definitely committed
or definitely refused without evidence. Qualify disk-full/I/O faults, killed processes, interrupted admission and
backup/replacement, busy writers, long readers, checkpoint behavior and schema/index corruption. Set durability
policies and compare matched acknowledgments, including macOS full-device flushing where required.

Package and test the selected binding/extensions with Electron and CLI on supported OS/architectures. Verify
native loading, signing/distribution, file permissions and actual read-only mounts. Publish supported filesystem
assumptions without claiming that a few CI hosts certify arbitrary filesystems.

Acceptance: failure-injection and platform evidence on pinned source, complete required CI gates in disposable
runners, and explicit resource/ownership policies. No residual native-loader or recovery assumption hidden in a helper.

### 7 Review and decide adoption

Before optimization, record app latency/resource budgets from representative flows and current instrumentation.
Evaluate warm and cold/reopen paths, sustained writes/watches, background work, corpus growth, peak memory,
disk/WAL growth and search recall/relevance. Preserve samples and variance. Compare matched current elmdb and
SQLite behavior; microsecond ratios alone are not the cutover criterion.

Review owned invariants, code complexity, native dependencies, upgrade burden and operational recovery. A material
regression needs a concrete product tradeoff, not a relaxed test added after the result. Produce a complete draft
with adoption evidence and the remaining decision stated plainly.

Acceptance: all requirements above have evidence or an explicit approved disposition, reference/public docs and
API reports match the result, and the candidate is ready for a final adoption decision. On adoption remove obsolete
production elmdb paths and temporary backend selection, finish conversion/recovery instructions and rerun integrated
validation. If rejected, record why and close the draft without leaving a permanent second backend obligation.

## Validation

Reuse and extend independent EARS contracts/models, transaction/watch/scheduler tests and host lifecycle suites.
Use differential tests where semantics must match and relevance/recall tests where search is deliberately different.
Demonstrate new safeguards with mutations or realistic fault injection on disposable copies. Keep fast tests
independent of native/compiler captures; run the full repository and packaging gates in disposable environments.
Record source/dependency/native-artifact revisions, conditions and raw results. Benchmark, compatibility and
platform claims must identify their actual tested scope.

## Current handoff

The full goal remains active; all phases and original acceptance budgets still apply. Deliverable:
[draft PR #286](https://github.com/spankyed/apack/pull/286), `session/ears-sqlite`. Production stays elmdb.
No master merge, release, adoption, implicit daily-profile conversion or version-only PR is authorized.

Source work is `/private/tmp/ears-sqlite-query-integration`; detached publisher:
`monorepo-worktrees.noindex/integration-3AEBRl`. Canonical `sqlite-evaluation` remains earlier `6cf6c8349e`;
it does not contain later published work. Current committed master baseline is `dc67febcce` and native pin
`2441af4658d961f547c7094cd041c2ac246668c5`. Inspect actual Git/workflow state before continuing.

The candidate includes the structured graph/query port, native query execution, identity/atomic bootstrap and
foreign-WAL preservation, canonical signing recognition, managed directory claims, file/sidecar admission,
logical recovery/conversion and model/index lifecycle. [Native integration](../references/evidence/ears-sqlite-implementation-2026-10-28/native-2441-integration/README.md),
[identity/signing](../references/evidence/ears-sqlite-implementation-2026-10-28/format-identity/README.md) and
[file ownership](../references/evidence/ears-sqlite-implementation-2026-10-28/file-ownership/README.md) retain their
source-bound evidence. The EARS ownership checkpoint passes 762 SQLite-selected cases (zero skips).

The [reset/quarantine checkpoint](../references/evidence/ears-sqlite-implementation-2026-10-28/reset-quarantine/README.md)
excludes history handles before primary reset, verifies unrelated sibling identities even when history is
absent, and syncs POSIX quarantine/replacement parent publication. Failed publication preserves the original
refusal, sync/cleanup errors, forensic path and uncertain directory authority. Tests prove held-handle refusal,
new-open exclusion, cleanup and actual killed-process reset recovery. Windows directory flushing remains
unimplemented in the shared helper; passing ordering/fault tests there do not prove physical durability.
Local host/CLI types, lint, syntax, 106 focused host cases, seven SQLite CLI cases, five package builds,
shipped-pack build, nine reset integration cases and 1953 full host cases
(1 existing platform skip) pass. Baseline failures, reverted guard, restored source and
initial test-development failures are retained. Nine actual-report controls protect the new named platform
witnesses. The original assertions/deadlines were not relaxed. Broad/compiler work stays in private
Linux/CI, capped at two CPUs/six GiB/no swap with a quiet admission window; focused checks use half a CPU/768 MiB.

[Platform run 41112243866](https://github.com/spankyed/apack/actions/runs/41112243866) passes all three hosts
at `9fbea37d0d`, before the native/ownership/reset changes. Reset checkpoint `a95039a8c7` passes
[signed installed Preview 41120611981](https://github.com/spankyed/apack/actions/runs/41120611981), including
both store identities, and Linux/macOS SQLite qualification in [strict run 41120604961](https://github.com/spankyed/apack/actions/runs/41120604961).
That strict run is a terminal failure: producers, both native and both integration shards pass; the app/unit
shard fails only its subprocess inventory (three sites recorded versus four). The
[inventory correction](../references/evidence/ears-sqlite-implementation-2026-10-28/reset-subprocess-inventory/README.md)
records the actual killed-reset process with its isolation reason; all 14 detector/control cases pass.
Windows fails the original CLI backup reservation with EPERM. The first attempted correction at `2a641ce102`
passes Linux but [platform run 41125212261](https://github.com/spankyed/apack/actions/runs/41125212261) proves
its direct Windows rename replaces competing files and dangling symlinks. Linux/macOS pass that run;
Windows fails two preservation assertions. The [exclusive-publication correction](../references/evidence/ears-sqlite-implementation-2026-10-28/windows-backup-exclusive/README.md)
uses the system Windows Directory.Move operation with paths passed as data and retains all race assertions.
All 29 platform CLI cases pass on Linux, including twelve focused profile cases and a literal metacharacter
path. [Run 41130505526](https://github.com/spankyed/apack/actions/runs/41130505526) now passes all three hosts at
exclusive-move source `58ae8a7b0e`, including the actual Windows races and literal path. That does not qualify
the later cleanup/close-wrapper inputs or physical directory durability. All five backup invariants are required by name in the
platform verifier, with fourteen real-report omission/skip/duplicate/path controls passing. Earlier CLI types exhausted the small 512-MiB heap; those failures remain retained. The adequate-budget
local qualification below passes, without treating the earlier resource failures as passing checks.
The [backup cleanup correction](../references/evidence/ears-sqlite-implementation-2026-10-28/backup-cleanup/README.md)
preserves the original publication outcome alongside staging/lock cleanup errors, still attempts lock release,
and reports a retained `publishedPath` after successful publication. Three exact-source baseline failures
become passing cases; all 32 platform CLI cases, lint, syntax and twenty required-witness controls pass on
Linux. The final strict result below qualifies these later cleanup inputs; run 41130505526 alone
qualifies only the preceding exclusive-move checkpoint `58ae8a7b0e`.
The [CLI close-wrapper correction](../references/evidence/ears-sqlite-implementation-2026-10-28/cli-close-outcomes/README.md)
refuses thrown `undefined`, retains both command/close failures and preserves machine-readable commit/recovery
outcomes. Five reproduced failures pass after correction; all 41 expanded platform CLI cases pass on Linux,
along with lint, syntax, fourteen command-outcome controls and the preceding twenty backup controls.
The platform workflow now includes the wrapper cases. [Full strict run 41132219406](https://github.com/spankyed/apack/actions/runs/41132219406)
at `a8e12b1cd1` is terminal failure at producer CLI TS2698; all three independent platform jobs pass.
Producer-dependent consumers cannot qualify from that run. The [diagnostics/type correction](../references/evidence/ears-sqlite-implementation-2026-10-28/backup-cli-diagnostics/README.md)
at `dd0ddfeb86` uses an explicit object ternary for callback-assigned publication state. Backup error messages
now print all failures and the destination/retained published path, matching the CLI's actual message-only
reporter. Three baseline message failures become passing cases. CLI/testing types with incremental cache
disabled, all five normal package builds, lint and all 41 platform CLI cases pass in one properly capped
2-CPU/6-GiB/no-swap container with an explicit 4096-MiB Node heap. Original resource/type failures remain.
[Full strict run 41135036125](https://github.com/spankyed/apack/actions/runs/41135036125) at `1eb47d88e1`
is terminal success: producers, all three SQLite platforms, both integration shards, both native shards and
app-and-rest pass. [Retained metadata](../references/evidence/ears-sqlite-implementation-2026-10-28/strict-1eb/README.md)
distinguishes those nine successful jobs from six skipped alternate workflow jobs. This closes the current
strict/platform gap, not the remaining app/operational/performance gates.
[Signed installed run 41144824212](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-49d/README.md)
also passes at `49d6426961` (identical production inputs): six actual macOS arm64 executable cases, zero skips/
retries, mandatory two-store identity/model-claim witness, pre/post-sign native smoke and strict Developer ID
sealing. This closes the current six-case macOS installed gap; broader flows and required architectures remain.
Repeat affected integrated gates after future production changes; documentation alone does not require a rerun.
The earlier full strict run 41106571398 failed its old verifier and a 200-second CLI integration case.
The verifier is fixed; that case passes in 28.6 seconds on isolated Linux, but the earlier macOS timeout
remains unexplained. The older editor intermittent also remains unexplained despite ten unchanged repeats.
Neither partial/source checks nor six installed smokes complete app/performance acceptance. The
[prior handoff](../references/evidence/ears-sqlite-implementation-2026-10-28/reset-quarantine/prior-handoff.md)
preserves historical sources, CI boundaries and failures.

Next checkpoint: diagnose the [integration-2 hook failure](../references/evidence/ears-sqlite-implementation-2026-10-28/integration2-63c/README.md)
in terminal exact-source strict run 41151679157, and the
[source-app failure](../references/evidence/ears-sqlite-implementation-2026-10-28/source-app-63c/README.md)
in run 41152805669. Integration-2 times out at the unchanged 240000-ms four-pack diamond fixture setup;
its five assertions never run. Added phase markers preserve that deadline and every build/assertion.
The current strict run cannot qualify overall: eight required jobs pass, one fails and six alternate jobs skip. The actual report has 32 passes, one intended installed-only skip and one unexpected
failure: the open editor misses its original five-second `referenceSuggestion` predicate after pack activation.
Backend logs show activation before the deadline but do not prove frontend acceptance or editor replacement.
The [focused diagnostic](../references/evidence/ears-sqlite-implementation-2026-10-28/editor-activation-e76/README.md)
at e76 (run 41155440320) reproduces one failure and two passes without retries. At failure the registry has
only the host contribution and the shell only host surfaces; an accepted pack/editor replacement is not
observed. The [same-deadline elmdb control](../references/evidence/ears-sqlite-implementation-2026-10-28/editor-elmdb-control-897/README.md)
in run 41157076346 passes all three actual cases without skips/retries. Investigate candidate declaration/
content/activation work and frontend arrival; this does not isolate one statement or prove a fix. These
app interactions do not match durable-write acknowledgments (elmdb group sync versus SQLite FULL).
Diagnostic source passes oxlint and complete test types, with original failed invocation retained.
No causal fix or current broad app pass is claimed.
The [new native qualification](../references/evidence/ears-sqlite-implementation-2026-10-28/native-63c/README.md)
verifies the three completed platform jobs and signed installed run 41151681981 at this source: 735 native
membership comparisons per host, Linux/macOS EARS 762 passes, Windows 757 passes plus five named platform
skips, and six actual installed passes without skips/retries. Generated C and patch digests agree with
runtime/build pins, and signing refreshes the changed native library provenance.
The ordinary Linux arm64 package, 735 controls and fresh public model-owner probe also pass. Its subsequent
local EARS suite fails with one text-prefix timeout plus a worker RPC error after a protective ~1053.7-second
pause during the suite; retain that failure and original deadlines. The remaining typecheck/lint steps were
not reached. Independent platform passes do not relabel the local failure. Earlier strict/app/installed
results qualify preceding native inputs; exact-source strict is terminal failure at integration-2 despite
eight successful jobs, and broader/focused source-app failures remain as recorded above. Preserve all failures.
The [private direct-IN proof](../references/evidence/ears-sqlite-implementation-2026-10-28/direct-in-prototype/README.md)
passes 735 ordinary-SQLite controls per library and 900 paired updated-snapshot answers. The subsequent
[full initial/update matrix](../references/evidence/ears-sqlite-implementation-2026-10-28/direct-in-full-matrix/README.md)
completes 14,400 queries in separate baseline/prototype Node processes: all 7,200 paired ordered hits/scores
match, every canonical vector verifies, minimum mean recall is 0.973 and each variant makes 2,400 native calls.
The identical initial base/model and original snapshot remain unchanged. Responsiveness still fails, including
timed-only query gates. This closes prototype equivalence, not backend adoption or package/owner qualification.
The baseline equals the unchanged packaged binary; the exact tested candidate C digest is `04043ede29b2998b2cd0e7735cc696dba2158554a0bf9036e2a77849dec0425a`.
The [supported-block study](../references/evidence/ears-sqlite-implementation-2026-10-28/supported-large-blocks/README.md)
completes 16/64/256 KiB with one fixed trained model: all 21,600 initial/updated queries finish, canonical bytes
verify, both larger variants reproduce all 7,200 baseline answers, and minimum mean recall is 0.973. All
variants still fail responsiveness, including the timed-only query gates. Pauses are retained and timings do
not establish causal layout effects; no default changes. Larger blocks reduce metadata blocks/query but do
not close the gate. Dependencies for the next native diagnostic: exact pinned baseline source, unchanged
ordinary-SQLite semantics (including compact NULL sentinels, wide integer RHS and mixed/real lists), no new
allocation/lifetime/format state, and preserved product artifacts. The private membership/boundary controls and fixed-model initial/update equivalence above are complete.
Closing checks now apply to the ordinary candidate package, fresh model owner, complete EARS contracts and
affected platform/installed inputs; retain every failed performance gate. Adoption still requires complete EARS, fresh actual-owner, platform/packaging/installed and original app
gates. The earlier untested bitmap prototype is not selected. Scoped SQL work and durable COMMIT remain
separate responsiveness costs. The [scope-driven eligibility comparison](../references/evidence/ears-sqlite-implementation-2026-10-28/scope-driven-eligibility/README.md)
now completes 7200 updated-only measured queries and 950 paired controls, including duplicate IDs and prior
order/limit operations. Every paired answer/score matches; 99900 canonical rows verify and the retained
read-only snapshot stays unchanged. No protective pauses occurred, but fixed order/shared caches remain.
Both shapes still fail responsiveness; the additional DISTINCT/join rewrite is not promoted. The
[metadata-only projection controls](../references/evidence/ears-sqlite-implementation-2026-10-28/owner-projection-controls/README.md)
now pass for the current library, a private C lookup prototype and a SQL-only alternative. Each runs 735
ordinary metadata comparisons, complete vector bytes, paired distance projections and ten missing-base
refusals. The initial cross-library distance comparison failed with independently trained IVF models;
the corrected comparison shares exact frozen models and preserves the failure. Neither alternative is
selected. The [actual EARS comparison](../references/evidence/ears-sqlite-implementation-2026-10-28/owner-projection-query/README.md)
now completes 2700 queries in independent baseline/C/SQL processes: all 900 paired ordered answers/scores
match for each alternative, minimum cohort recall is .974 and the same read-only snapshot/model checksums
remain intact. No protective pauses occur, but fixed order/system/cache effects remain; this is one updated-
only pass per cohort. SQL is modestly lower in some observations, C establishes no benefit and all variants
observe heartbeat misses. Neither alternative is promoted. The original settings/gates remain unchanged.
Complete initial/update, actual owner/multi-chunk/unit/platform/packaging proof is required before selection.
The [real filesystem-full checkpoint](../references/evidence/ears-sqlite-implementation-2026-10-28/filesystem-full/README.md)
passes four actual ENOSPC/COMMIT refusal paths on Linux arm64 in an isolated 8-MiB tmpfs, with verified
0.5-CPU/768-MiB/no-swap limits, FULL=2 and default checkpoint=1000. Prior rows/sequence survive; watches
stay silent on refusal, reuse commits once and read-only reopen retains only incumbent/recovered rows.
The tracked regression script and mandatory Linux platform report checks reject 42 missing/invalid witness
controls; syntax, focused lint and workflow parse pass. The new owned-mount Ubuntu CI step still requires
actual platform qualification. This is not device power loss, other I/O fault, Windows durability or a
replacement for all phase 6 requirements. The dependency-graph focused Linux observation is the next owned
heavy check after the completed query diagnostic; inspect its existing admission/run handle before new work.

No evidence here certifies arbitrary filesystems or completes the goal.

The broader phase 5 source-app checkpoint now passes: [run 41148535620](../references/evidence/ears-sqlite-implementation-2026-10-28/source-app-qualified/README.md)
at `f05eda527c`, `suite=app, storage_format=sqlite/1`, records 33 actual passes, zero unexpected/flaky cases/
retries and one intended installed-only skip. Downloaded per-case JSON verifies the two-store physical EARS
SQLite identity witness, saved-settings repair/reopen, external file changes/terminal output, API kill/reconnect
and running-app CLI read/mutation refusal. The skipped packaged case has separate signed installed evidence
above. This qualifies the existing macOS arm64 source app suite; broader SDK/executable-pack/architecture,
load/performance and operational requirements remain. Do not rerun this unchanged checkpoint for documentation.

The [original SQLite failure and unchanged-source elmdb control](../references/evidence/ears-sqlite-implementation-2026-10-28/source-app-delivery/README.md)
remain failed at the same FILE_CONTENT predicate and unchanged 15-second deadline. The test asked outside any
surface delivery/reply address and expected an obsolete terminal CREATED payload. The correction enters the
real surface handlers and checks the addressed OPENED reply, preserving all file-change/output/title/path
assertions and deadlines; no database/runtime behavior changes. Current reporting retains individual cases
rather than inferring named witness execution from aggregate counts. This closes that diagnosed current test
failure, not unexplained historical compiler/editor failures on different inputs.


Next deliverables and their closing checks, without narrowing phases 3–7:

- Qualify native repair faults on the final platforms, complete physical publication/deletion authority and
  physical-file recovery, and verify interruption/reopen outcomes under cooperating ownership.
  Claims inside a database directory do not authorize arbitrary rename/delete or noncooperating writers.
- Complete installed Electron/renderer/CLI, executable-pack/SDK flows and required OS/architectures beyond
  the six-case macOS arm64 signed qualification above. Requalify native provenance after inner-library signing
  and before app sealing when relevant inputs change. `asar:false` already keeps
  the native files on disk. Ordinary source/unsigned package builds do not prove installed/signing behavior.
- Close remaining filesystem/format ownership work: qualify ordinary unaliased data files and foreign
  valid SQLite refusal/positive persisted identity on final platforms, and synchronize/qualify
  history-quarantine parent publication, including Windows directory flushing. Reset exclusion before
  primary mutation and held-handle/interruption cases are implemented; final platform qualification remains.
  Test active worker shutdown and namespace operations through the supported managed lifecycle. Directory
  claims cannot exclude noncooperating raw SQLite writers or arbitrary mount aliases; data-file admission is
  a separate guard. These remain phases 2/5/6, not completed requirements.
- Resolve the existing failed responsiveness gate. The original representative 99,900-vector admission takes 20.77 s
  with heartbeat p99 48.14 ms against 16 ms. Projection batching improves throughput but does not prove a
  heartbeat win. A [current-source attribution run](../references/evidence/ears-sqlite-implementation-2026-10-28/commit-responsiveness/README.md)
  still fails at p99 31.05 ms: 11.32 seconds of COMMIT wall time includes deferred vec1 work and substantial
  blocked time, with no cgroup throttling. The projection slice alone does not bound its transaction. This is
  not a speedup comparison or acceptance. The [fixed-model allocation study](../references/evidence/ears-sqlite-implementation-2026-10-28/fixed-model-allocation/README.md)
  completes both 16-KiB and 4-KiB variants: all canonical rows verify, all 7,200 paired query answers match and
  minimum cohort mean recall is 0.971. Both fail frozen query gates; recorded admission heartbeat p99 is 31.42/
  64.50 ms. Resource-driven pauses contaminate some timings, so this is not timing certification or a causal
  layout comparison. No production setting changes. The [SQL trace](../references/evidence/ears-sqlite-implementation-2026-10-28/query-attribution/README.md)
  completes all 18 initial/updated cohorts x four passes x100 queries, verifies all canonical rows and reaches
  minimum mean recall 0.973. In the warmed updated 10k scope, independent median stages are 8.87 ms eligibility,
  34.28 ms native candidates and 8.02 ms rerank; preparation averages about 0.015 ms/query. Actual-owner admission
  still misses responsiveness (45.81 s, heartbeat p99 181.71 ms); different storage/model/instrumentation prevents
  a causal comparison with prior runs. A [fixed-snapshot policy diagnostic](../references/evidence/ears-sqlite-implementation-2026-10-28/query-policy/README.md)
  rejects cheaper target/nprobe settings: minimum mean recall 0.948, 0.915 and 0.893, below 0.95. Timing pauses
  are retained; this updated-only comparison is not full acceptance. [Existing native counters](../references/evidence/ears-sqlite-implementation-2026-10-28/native-query-profile/README.md)
  attribute about 51–54% of filtered native timer ticks to metadata scans, with about 665 metadata blocks/query.
  Whole-list conversion per block remains despite binary-search membership. No cheaper ANN policy or native
  prototype is adopted. The supported larger-block diagnostic above is now complete and insufficient;
  next test skipping repeated operand conversion through the already-sorted integer RHS, without a bitmap.
  COMMIT and unfiltered native scanning remain separately required work. In a later
  0.5-CPU diagnostic 81 retirement batches removed 2592 rows in five seconds;
  bounded native deletion still needs latency/WAL/resource qualification. FULL writes, canonical bytes,
  default checkpoints and original budgets remain unchanged. Do not relax gates around these results.
- Complete representative search usefulness (language/identifier/typo/phrases/highlights/field restrictions),
  vector/hybrid recall, multi-chunk owners, candidate/trash filtering before K, ties, large-K/exact fallbacks,
  unit/savepoint visibility, model/hash/generation freshness and readiness/watch settlement under real load.
- Qualify representative app warm/cold/reopen flows, sustained FULL writes/watches/streaming/large fields,
  live admission/cleanup, corpus growth, peak memory, disk/WAL/checkpoints, long readers/busy writers and
  matched current elmdb/SQLite latency/resource budgets. Primitive/synthetic timings are not app acceptance.
- Qualify disk-full/I/O/unknown-commit, killed processes, interrupted admission/backup/import, physical/resource
  faults, corruption, permissions/read-only mounts, Windows ACL/directory durability and filesystem refusals.
  CI hosts certify their runs, not arbitrary local/network filesystems.
- Pass final exact-input full strict plus architecture/native dependency/maintenance review, reconcile public
  docs/API reports, and produce a requirement-by-requirement evidence-based adoption decision. Do not silently
  migrate daily profiles. If adopted, remove the temporary second-backend obligation as phase 7 requires.

Preserve canonical Float32 bytes and original failures. Synchronous EARS contracts cannot silently become
asynchronous. Missing native cursor indexes on populated stores require explicit offline preparation.
Private corpus/model payloads, dependencies, compiler targets and binaries stay outside Git. The optional
Codex executable is absent in baseline API images, so boot checks do not certify external inference or all
pack capabilities. All broad/compiler checks remain in disposable Linux/CI with private artifacts.

[Prior handoff](../references/evidence/ears-sqlite-implementation-2026-10-28/handoff-before-native-audit.md),
[earlier checkpoint history](../references/evidence/ears-sqlite-implementation-2026-10-28/checkpoint-history.md)
and the linked evidence preserve historical source boundaries and original failures.
