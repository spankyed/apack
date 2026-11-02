# EARS SQLite candidate

This describes the implementation on `session/ears-sqlite`, draft PR [#286](https://github.com/spankyed/apack/pull/286).
Production continues to select elmdb. The [goal](../archive/goals/goal-ears-sqlite.md#current-handoff) records
completed qualification; the [evaluation report](ears-sqlite-evaluation-report.md)
owns the adoption recommendation. This reference does not authorize a cutover or daily-profile migration.

## Selection and ownership

`APACK_STORAGE_FORMAT=sqlite/1` selects SQLite through normal host composition. App boot additionally
requires an explicit absolute `APACK_USER_DATA_DIR`; CLI tools require a named isolated target such as
`--data-dir`. Canonicalized default app directories and their children are refused. An omitted format
keeps elmdb; unknown formats and foreign/ambiguous physical stores refuse before replacement.
Use disposable profiles or the explicit developer conversion on a stopped copy.

Each primary/run-history store owns `data.sqlite3`, with SQLite WAL/shared-memory sidecars as needed.
Host storage descriptors select open/backup/maintenance behavior; backup metadata cannot override actual
file validation. The EARS application ID and format 1 distinguish owned SQLite files. Format 1 changes
in place before release; derived text revision 4 is rebuildable state, not a new primary format.

Packs receive the existing typed EARS facade. App-only `@apackdev/ears/sqlite` constructs storage and
owns native model/maintenance helpers; it does not expose the complete raw elmdb binding API. The
[tooling disposition](../archive/plans/ears-sqlite-storage.md#native-tooling-disposition) maps supported commands.
The host opens primary and history independently and closes partial acquisitions when boot refuses.

## Primary data, queries and observations

Typed cells preserve missing/null, dates, binary and composite values. Ordinary writes enforce declarations;
explicit repair/import loads retain their deliberately unchecked contract. Canonical embeddings belong to
primary storage. Value, FTS, trigram, graph projections and native models are derived and rebuildable.

A private structured storage port carries typed operations, results, units and tracked reads. SQLite
executes supported filtering, field projection, ordering, paging and traversal in SQL. Heterogeneous value
ordering and graph algorithms retain documented facade semantics rather than assuming SQLite's defaults.
Leiden uses portable WASM; regex matching uses the pinned Rust-regex bridge. Explain reports actual SQL
plans and binding work; it does not invent LMDB page/work counters.

Successful logical mutations publish their commit identity and touched dependencies. Nested units use
savepoints; a refusal rolls back and publishes no committed change. Watch dependencies include absent IDs,
filters, ordering and traversal reachability. Scheduling/settlement remains shared EARS behavior.
Notifications are owned by the current handle; cross-handle/process reactive invalidation is unsupported.

Pack registration admits prospective declarations before publishing registry authority. Backfills use bounded
cooperative transactions, capture intervening writes and atomically publish readiness. Host activation,
reload and backup acceptance await logical readiness. Direct synchronous queries can refuse INDEX_BUILDING;
cooperative work targets do not bound a large value, transaction sync or checkpoint's wall-clock cost.

## Search and vectors

Text search uses native FTS5 with standard none/English Porter analysis, field weights, phrases, list boundaries,
boolean clauses, prefix search, recency and UTF-16 highlights. Non-English stemming and the exact analyzer
refuse atomically. Typo expansion is bounded to one edit/transposition for folded ASCII-alphanumeric tokens
of length 5–32; other terms retain literal matching. Literal Unicode support is not broad multilingual stemming
or segmentation. The library semantic-search UI remains dormant in the integrated baseline; its backend
repository and the active thread text-search UI have separate tests.

Each indexed source is stored once in ordinary shared document content. Native primary/English-literal FTS
indexes retain complete strings plus at most one bounded leading passage: 256 UTF-16 units at a whitespace
boundary, weight 3. Unquoted compound components can combine across fields/list elements; explicit phrases
retain adjacency. English literal-compound coverage precedes stem-only matches, with monotonic BM25 inside
a tier and recency afterward. Empty field selection searches no fields. Writable obsolete derived text is
regenerated; read-only obsolete layouts refuse rather than modifying files.

Vector membership applies scope, trash and exclusion before K; owner scores use current canonical chunks.
Small eligible sets of at most 4,096 chunks and K above 64 are exact. Large supported queries use a managed
native model when ready: 64 bucket probes, owner targets 256 through K=32, 1,024 through K=40 and 2,048
through K=64, with duplicate-chunk expansion capped at 4,096 native candidates. All selected owners' current
chunks are reranked exactly. Candidate caps do not bound coarse filtering or per-owner chunk work.
Native training supports dimensions 128–4,096 divisible by eight. The ordinary untrained fallback uses a
256-owner binary candidate pool when eligible; dimensions below 128 or not divisible by eight are exact.
Probing all trained buckets does not make binary candidate admission exact or guarantee arbitrary-model recall.

Writable managed stores claim one native model service. Training uses a read-only worker and validates
model/source hashes before installation; canonical bytes remain authoritative. Readers can reuse a ready
projection without owning training. Logical readiness and optional native-model readiness are distinct;
`waitForNativeModels` requires a live service. Maintenance drains workers while retaining the claim, then
resumes only a previously running service. A failed model does not authorize publishing partial state.

## Durability, backup and recovery

Writable stores use WAL, foreign keys, busy timeout zero and FULL synchronization by default, with macOS
full-sync pragmas requested. `syncs:false` is for disposable fixtures. Competing foreground writers refuse;
background retries yield. This acknowledgment policy differs from native default grouped synchronization.

Known committed errors and uncertain outcomes remain distinct. NOT_DURABLE means committed; COMMIT_UNKNOWN
fences the handle instead of pretending refusal or permitting transparent retry. Cleanup retains original and
secondary failures. Reopen/recovery inspects persisted state. Controlled sync/EIO/process-death tests do not
certify physical power loss or arbitrary devices. Ambiguous history corruption/read faults refuse rather than
automatically quarantining intact data.

Physical backup and populated replacement go through the host's primary/history/media coordinator. Failed
acceptance or a second-store replacement restores readable incumbents; failed recovery retains its journal
and copies. Lossless `db dump`/`load` archives preserve primary values and reusable embeddings, rebuilding and
auditing derived state in private staging. They exclude media, packs and secrets; display JSON/CSV is separate.
Export takes a private snapshot; staging needs disk/time and memory can scale with the largest value. Publication
requires the filesystem operations documented by the CLI; interrupted work can leave owned scratch.
Use `db audit`, `db rebuild`, `db backup`, `db import` and `db recover` through their documented offline targets.
Direct SQL writes bypass EARS identity/schema/projection/watch ownership and are not a supported repair API.

## Runtime and qualification limits

Ordinary package production stages pinned better-sqlite3/sqlite-vec, patched vec1, graph and regex assets and
provenance/notices. Runtime opens load trusted application assets rather than compiling/downloading or choosing
code from database metadata. Signing refreshes native hashes after inner signing; recorded private signing
checks do not imply notarized distribution certification. Supported qualification covers macOS arm64,
Windows x64 and Linux x64 in their recorded runtime scopes.

App and worker use the canonical packaged SQLite driver. Independent SQLite library copies must not access
the same file in one process, nor should raw descriptor open/read/close bypass its locking bookkeeping. The
native-model claim coordinates model/maintenance ownership; it is not a generic duplicate-driver detector.
Use independent SQL tools in a separate process on a verified copy. Filesystem evidence covers observed CI
hosts, with reliable SQLite locking/sync assumptions; arbitrary network/exotic filesystems are unqualified.
Read-only backup access does not promise every live-WAL open on a read-only filesystem.

Search remains synchronous. The user accepts its foreground responsiveness degradation for this experiment;
original 16 ms heartbeat misses remain measured failures, while correctness, recall, query-latency and resource
requirements remain in force. Resource reports distinguish whole-process/harness high-water RSS from isolated
engine memory and sampled files from instantaneous disk peaks. Source/model/runner-specific timings do not
establish a general SQLite speedup or lower maintenance cost.

The [contract matrix and ownership review](../archive/plans/ears-sqlite-contracts.md) link exact tests, native dependency
upgrade obligations, recovery evidence, timings and original failures. The [storage design](../archive/plans/ears-sqlite-storage.md)
retains implementation detail and source-pinned history. An adoption decision must choose one production backend;
this candidate does not establish a permanent obligation to maintain both.
