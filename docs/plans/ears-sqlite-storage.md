# SQLite storage design for EARS

Status: authoritative layout integrated through the candidate EARS facade; performance qualification pending, 2026-10-28. Execution and acceptance belong to
[the SQLite goal](../goals/goal-ears-sqlite.md); [the contract matrix](ears-sqlite-contracts.md) defines required semantics.

## Direction

Use native scalar columns for declared fields, with large values stored separately and a flexible field store for
undeclared/repair data. Keep primary values authoritative and normalized list/value/search structures derived.
Validate this hybrid through the structured EARS slice before freezing the physical layout or thresholds.

A raw SQL diagnostic on the same lossless 3,000-message fixture found these median costs at a 4 KiB body size:

| Layout | Small field read | Whole row | Page of 50 | 100 partial writes in one transaction |
| --- | ---: | ---: | ---: | ---: |
| Whole MessagePack row plus JSON projection | 8.80 µs | 9.83 µs | 235.04 µs | 5,353.55 µs |
| Per-attribute MessagePack values | 3.80 µs | 22.43 µs | 1,000.44 µs | 476.58 µs |
| Native scalar columns and inline body | 2.49 µs | 8.00 µs | 179.16 µs | 806.14 µs |
| Native scalar columns and separate body | 2.05 µs | 8.04 µs | 211.52 µs | 140.19 µs |

These are one-process, five-round diagnostics of storage primitives with syncing off, not EARS performance or
production guarantees. Every layout checks identical dates, bytes, nested values, nulls, rows/pages and surviving
fields after updates. The body is repetitive synthetic text; compression, content entropy and actual shape mixes
need the real slice. The split variant currently models one known body field, not complete dynamic schema storage.
Other initial runs with small and larger bodies show the same field/page tradeoff; raw samples are retained with
the implementation evidence. Do not compare these figures directly to the earlier full API trials.

## Authority and representation

An entity catalog owns identity, type, creation order and engine metadata. Type-specific rows own declared values;
a flexible store owns undeclared values. A value has exactly one authoritative representation at a time. A large
value can live out of row without duplicating the whole entity as both MessagePack and JSON. Fetch requested large/
flexible values in batches, not one statement per entity or field; bound assembly by requested output.

Use an explicit value-kind/presence representation. SQL NULL alone cannot distinguish an absent field from a
present null or reconstruct arbitrary EARS values. Scalar columns must preserve type distinctions, while Date,
bytes and composite values retain their declared semantics. Unknown fields and existing values that violate a new
rule remain readable; checked mutations validate changed fields, and intentionally unchecked repairs remain possible.

Physical table/column identifiers must not collide under SQLite's case-insensitive identifier rules. Logical names
such as `Note`/`NOTE` or `fooBar`/`foobar` remain distinct. Allocate stable numeric identifiers or another reversible
collision-free mapping; keep logical names in metadata and diagnostics. Bind values and quote physical identifiers.

## Component checkpoint

`packages/apack-ears/src/sqlite/values.ts` implements scalar column pairs (kind and native value), with
large/composite and flexible values in a separate store. Declaration adds slots without rewriting incumbent
flexible data; the next write moves a changed field to its current representation. Caller-owned transactions cover
schema, primary metadata and derived writes; the caller also owns row-rule validation. Layout handles are admitted
schema state, not a process-global cache. Existing layouts reopen without writes.

Native slots currently stop at 128 per type so wide declarations fall back to flexible storage rather than exceed
SQLite's column limit. Text/bytes larger than the provisional inline threshold live outside the row. These are
bounded starting policies, not measured optimal values. The focused 300-field case proves no values are dropped;
component tests also prove a scalar patch neither reads nor encodes its neighboring large body, and a projected
50-row page uses two SQL calls without decoding unrelated composites.

The candidate now uses this layout through EARS. The entity catalog holds no whole-row payload or JSON document.
Scalar predicates use native values; direct scalar list members have rebuildable per-field derived records. Page
projection happens before overflow decoding, updates patch changed attributes and affected indexes, and backup
replacement copies logical values from one source snapshot instead of copying incompatible physical slot IDs.

Shared native/SQLite tests pin omitted undefined object properties and refused undefined list elements. Normalization
is per changed value, preserving the structured transport. Undeclared primary types remain readable/filterable through
all-entity or ID starts. The backend/query/search implementation is source-owned under `src/sqlite/`, with an app-only `./sqlite` entry
and pinned workspace dependencies. Measured backend-specific explain and discriminated operation/read/result
types are implemented. The [actual-facade comparison](../references/evidence/ears-sqlite-implementation-2026-10-28/facade-slice.md)
exposed expensive large-value key traversal in the overflow WITHOUT ROWID table. Only that table now uses rowids
plus a unique logical key; the identical repeat cuts its projected large-row page from ~14.3 ms to ~0.27 ms.
Sorting/vector regressions, app budgets and more precise native/allocator attribution remain open.

## Indexes and queries

Compile selective predicates, projections, ordering, limits and adjacency traversal into SQL. Handle multi-type
and caller-ID order explicitly. Preserve direct scalar/list membership, missing/null equality and heterogeneous
value ordering from the contract matrix; the original prototype's null-list hole is not an acceptable fallback.

Native scalar indexes and normalized list membership should serve their appropriate access paths. A readiness
protocol must preserve correctness during background builds. SQLite CREATE INDEX in a worker can still hold the
writer lock; bounded backfill into derived structures, foreground priority and atomic readiness need a concrete
implementation. A worker thread by itself is not the solution.

One owning foreground connection advances persistent value/text/trigram/vector jobs between synchronous
calls. A single `index_builds` catalog and scheduler owns generations, cursors, busy retry, stop/reopen behavior
and readiness. No second worker holds a long writer transaction. Admission creates an empty private generation
without hydrating the corpus; unchanged definitions keep their generation. Primary writes maintain every active
generation even while it is building. Each batch reads only its index inputs and atomically commits postings,
cursor and eventual readiness. Cancellation retires its generation rather than clearing a live index in admission.

Value reads use authoritative scalar/list fallbacks before readiness. Search reads instead refuse explicitly with
`INDEX_BUILDING`; failed builds report `INDEX_FAILED`. This candidate chooses explicit indexing over an unbounded
foreground corpus scan. `database.indexesReady()` waits for all current generations, not retired-table cleanup.
It keeps scheduled work alive while explicitly waiting, rejects open write-unit waits, read-only unfinished work,
failed builds and stopped/closed owners. Native's pinned synchronous schema admission is already ready.

A committed search readiness/failure transition invalidates matching tracked reads through the owning database
handle. Watches can observe the indexing error and later retry; an existing watch may coalesce the transient state
inside its normal scheduler gap. Visibility notification reuses the current logical commit identity. The backend
subscription is detached with the last watch. Ordinary background work remains unreferenced so a CLI can exit;
an explicit readiness wait refs its timer. Cross-handle/process reactive invalidation remains unsupported, as for
ordinary commits made outside that connection.

Text/trigram physical tables and vector chunks belong to a generation. Retirement alternates with build work,
removing bounded row batches before virtual-table destruction. A replacement vector build reuses embeddings only
when entity/index/chunk, content hash, model and dimensions agree. Cleanup retains the latest complete predecessor
until its replacement is ready; older or partial generations remain collectable. A failed replacement does not spin
on deferred cleanup. Unchanged vector/text/trigram definitions remain independently ready when a different index
changes. A fresh writable owner resumes failed or interrupted work from its last committed cursor.

Working qualification targets, set before the load measurements: no primary-row hydration during value-only
admission; admission below 100 ms for the 10k/100k synthetic fixtures; at most 32 records per backfill transaction
with a 4 ms cooperative work target; observed foreground operation and timer-stall p99 below 16 ms in sync-disabled
fixtures. Apply the same targets to separate FULL/durable runs before calling this slice qualified. The first
pinned FULL run misses its foreground and turn-wait targets; the goal links its retained raw evidence. Transaction begin/commit and an indivisible large value can exceed the work target; report full batch
and foreground latency rather than presenting 4 ms as a hard wall-clock bound. Background work pauses while a unit
is open and resumes when it ends. Competing writers fail promptly (SQLite busy timeout zero); only the background
queue retries busy batches after a yielding delay. Measure WAL/file growth and post-build old-generation cleanup: observed WAL at most 16 MiB (or initial WAL plus
4 MiB if larger), and database-side files at most twice the seeded baseline plus 16 MiB. Require zero retired-generation
entries after cleanup; freed pages may remain allocated for reuse.
The original timer metric measures a setImmediate turn between foreground operations, not delay during the
operation itself. Add an independent periodic heartbeat and report its delay before claiming total event-loop
responsiveness. Keep the original operation, turn-wait and resource targets; periodic-heartbeat p99 must also be
below 16 ms in the same fixtures. This requirement is set before its first maintained-harness measurements.
[Controlled diagnosis](../references/evidence/ears-sqlite-implementation-2026-10-28/durable-admission-diagnosis/README.md)
shows that synchronous durable COMMIT alone can exceed the operation target on the current host, including
without background work. Both native and SQLite controls miss it here. Separate environment/IO limits from
builder processing and qualify the remedy without weakening durable acknowledgments.
These are development qualification targets, not the phase-7 app budgets or platform durability qualification.

SQLite's [transaction rules](https://www.sqlite.org/lang_transaction.html) underpin the single-writer and snapshot
policy. Some I/O/resource errors can end a transaction automatically, so cleanup consults the driver's transaction
state. If rollback itself fails, the builder stops until reopen, retaining both errors. Readiness cache state is
prepared before the schema commit; accepting it afterward performs no IO. The [WAL documentation](https://www.sqlite.org/wal.html)
describes checkpoint/reader interactions; long readers, host filesystem support and real IO failure outcomes remain
phase-6 qualification, not guarantees inferred from these sync-disabled fixtures.

The shared search-generation implementation is not resource qualification. Preserve the prewritten admission,
foreground, independent-heartbeat, WAL and disk targets for the search fixtures, and report misses before tuning.
Cold matcher loading, whole-field decoding/tokenization, transaction COMMIT and final virtual-table destruction
can exceed the cooperative work target. Same-process ownership and real I/O/crash/checkpoint qualification, full
application handling of the explicit indexing state and realistic search/vector acceptance remain in the goal.

Query diagnostics must distinguish SQLite plans and measured SQL work from the legacy native engine's stage/key
counts. Never synthesize physical SQLite counters just to satisfy a backend-specific assertion. Preserve logical
warning and call-count meaning, and update diagnostics consumers/types where the reported information differs.

## Missing derived search storage

Primary values remain authoritative when a search group is missing. A read-only open refuses missing physical
storage as `CORRUPT`; an existing incomplete generation instead reports `INDEX_BUILDING` when searched. A writable
owner admits a fresh private generation under writer ownership, then backfills it in ordinary bounded batches.
A failed batch rolls back its postings and cursor; incomplete data never becomes searchable. Logical commit
identity does not change. Intact unrelated generations and embeddings survive. If chunk storage itself was lost,
derive pending chunks again so the embedding service can recompute vectors. A missing secondary chunk index
can be recreated without discarding vectors.

The object inventory includes the pinned FTS5 configuration's shadow tables. These are inspected by name;
normal repair drops/recreates the virtual table through SQLite, rather than editing shadow content or
`sqlite_schema` directly. The [FTS5 storage documentation](https://www.sqlite.org/fts5.html#fts5_data_structures)
describes which content/docsize tables exist for this configuration. Destructive fault fixtures explicitly
turn off SQLite's defensive mode only on disposable test databases; production keeps it enabled.

Repair uses the scheduler's at-most-32-row batches and projects only the current index inputs. A healthy
reopen hydrates no primary entities and avoids writer ownership, so another handle's open write unit does not
prevent committed reads. This bounds row count per page, not an individual field's size or peak bytes. Existing
but corrupt postings still require audit/rebuild and real-corruption qualification; physical presence is not a
checksum. Storage format 1 changes in place: disposable developer profiles use the current physical layout;
this does not introduce a legacy upgrade path.

## Required slice measurements

Measure actual EARS field reads, projected/full pages, lookups, small updates in large entities, streamed body
updates, units and watch settlement. Include structured transport, schema checks, value decoding, SQL execution,
partial-write amplification and the entity catalog/flexible store overhead excluded from the primitive diagnostic.
Record steady-state and durable acknowledgments separately against the current pinned elmdb build, which compresses
larger fields. Choose thresholds, compression and background-work budgets from that evidence, not the synthetic
repeated-body case alone.

## Host storage and backup composition

The database port reports its storage `format`; both adapters own that constant without changing the native ABI.
The host's `database/storage.ts` owns the finite format-to-open/data-file descriptors. Host constructors accept
an explicit `storageFormat`; otherwise the isolated process selector below applies (default elmdb). Selecting the other backend over recognized existing files
refuses as `STORAGE_MISMATCH`, outside run-history corruption salvage. This is essential: selecting the wrong
candidate backend must not move an incumbent aside or create an apparently empty replacement profile.

Backup inspection detects the actual supported data files and opens them read-only; metadata format labels remain
provenance. Ambiguous files and permission errors refuse. Export records each live store's format. Import snapshots
the candidate, checks every restorable store against its destination before validation/replacement, and uses the
existing coordinated incumbent-copy/media/acceptance rollback. Cross-format import requires a deliberate logical
conversion on a copy; it is not an implicit physical conversion. Primary data and run history may be inspected
through their actual descriptors independently.

This closes a host-boundary prerequisite, not app adoption. Live pack readiness,
settings/media acceptance through the complete runtime, logical maintenance/conversion, recovery
under real IO faults and platform packaging remain required by the goal. Normal production composition stays elmdb.

## Isolated candidate process selection

`APACK_STORAGE_FORMAT=sqlite/1` selects the candidate through the normal host constructors. App boot requires an
explicit absolute `APACK_USER_DATA_DIR`; named CLI targets supply their resolved profile instead. The selector
canonicalizes symlink aliases and refuses every default app directory and its children. Omission keeps elmdb;
unknown formats refuse before opening. Explicit constructor options remain available to owned fixtures.
History, backup, import preflight and offline settings reads carry the selected target's format rather than
re-reading an unrelated parent profile. Physical cross-format import remains a refused operation.

The API waits for initial index readiness and again after executable pack registration, before lifecycle hooks
and migrations. This preserves synchronous EARS operations while keeping asynchronous index admission out of
startup reads. Partial store acquisition closes the primary if history/runtime construction refuses. Two actual built Node server boots with shipped-pack/SDK/settings operations pass in isolated Linux.
Installed/live pack flows, Electron ABI and failure/packaging evidence remain acceptance work; the Node
proof does not qualify those flows. This selection is temporary evaluation machinery, to be removed or collapsed to
the chosen backend at the final adoption decision.


## Runtime index admission

The composition supplies `PackRegistryOptions.indexesReady` from its owning database. Registration stays
synchronous for installer acceptance; boot/reset and accepted activation/update/restore/reload await readiness
before onInit, migrations, content and actor publication. Pack operation claims cover that wait. An index failure
after acceptance retains published files and reports an unavailable runtime, rather than restoring obsolete
bindings or starting actors on incomplete indexes. Backup acceptance waits for both restored stores before
migrations. Declaration-only registries have no database work. This boundary does not make ordinary EARS reads
asynchronous; search continues to refuse `INDEX_BUILDING` where a caller has not awaited readiness.


## Storage refusal cleanup

SQLite may roll back an entire transaction itself after a storage failure. Cleanup checks `inTransaction`, keeps
the original error, invalidates rolled-back layout state and ends the corresponding unit. Catching that error
inside a unit cannot resume it as a new implicit transaction. If rollback itself fails, retain both errors and
refuse connection reuse while allowing explicit close/reopen. Actual Linux tmpfs spill/COMMIT exhaustion and an
allocator control preserve SQLITE_FULL, incumbent data/sequence/watch state and recovery after capacity returns.
These controls do not settle arbitrary COMMIT IOERR ambiguity or physical durability; those retain phase 6 scope.

Readiness currently waits on the entire database's active generation catalog. Qualification must also cover an
unrelated failed retained index while another pack starts: avoiding unnecessary global availability failures
belongs to complete live-pack admission, not a completed consequence of the new async startup boundary.

## Search usefulness contract checkpoint

The shared `tests/fixtures/search-relevance.json` corpus records useful-result expectations before tuning.
Current candidate translation honors declared field-qualified clauses, `any`, global exclusions, last-word
prefix and arbitrary recency timestamp fields. Native FTS receives original query text, with Unicode61
`remove_diacritics 2` and optional English Porter on fresh candidate tables. Other-script exact matching does
not imply word segmentation, universal accent folding or non-English stemming. Fresh/reset copied profiles
are required after changing this format-one derived layout; opening an old table does not retokenize it.
Highlights choose delimiters absent from authoritative source text when literal control markers collide,
then return offsets into the original scalar/list string in UTF-16 units.

`SqliteText` now owns one FTS document per nonempty scalar/list string and a private per-generation
owner table indexed by entity/field/element. FTS5 enforces phrases within that document. Materialized native
clause results combine by entity in SQL, preserving AND across fields/elements, OR/any and global exclusions.
BM25 is evaluated per string; each clause uses its best weighted field match, and positive clause scores sum.
This deliberately changes score statistics from the former per-entity document. Usefulness and resource
acceptance, rather than exact scores, decide whether this representation is acceptable.

A private indexed owner token encodes the immutable entity sequence with zero BM25 field weight. Capped
native cardinality counts order a single conjunction; subsequent clauses intersect owner postings inside
MATCH. Runtime masks include at most 2048 owners, with a full-clause fallback for larger sets, so estimates
never truncate answers. Global exclusions use positive candidate owners. OR/any positive scoring stays
unchanged. The preceding rowid-constrained approach was rejected after a medium-query regression. Owner
tokens are excluded from vocabulary expansion and from user text columns. Their added document length does
change BM25 statistics and their bytes/build costs are measured separately. Safe adjacent limits now select
the native ranked entity prefix before complete selected highlights are fetched in the same snapshot.
Finite numeric/Date recency participates in native ranking; nonfinite options retain generic behavior.
The source-string shape and its full resource costs are not yet accepted.

Original text stays indexed for whole identifiers. A second derived column inserts spaces at camelCase and
acronym boundaries. Queries reach both columns; sparse insertion offsets map its native highlights back to
the original UTF-16 source. It is not a replacement Unicode tokenizer or a new native extension. Strings
without such boundaries have no duplicate alias content. Latin folding uses native Unicode61; other language
segmentation/stemming choices still need representative qualification.

Per-field hashes allow changed fields to replace only their own documents. Foreground updates read only
changed text inputs when their generation already holds the row; a row changed ahead of a new generation's
cursor gets a full initial refile. Owner tables participate in physical checks, rebuild, atomic writes and
bounded retirement. The format-one tables and field-hash metadata changed in place; reset/rebuild copied
candidate profiles explicitly, without a compatibility path in normal boot.

The unchanged shared relevance corpus and targeted identifier/list/rollback/reopen/recovery cases pass in
Linux; source-loading and whole-suite results are owned by the current goal handoff. The preregistered
shape, conjunction, owner, prefix, sequence and recency cohorts have run and retain all samples, bytes,
name-update costs, failures and mixed results. They compare SQLite revisions rather than establish a
matched elmdb performance qualification. Query-derived typo alternatives now replace the vocabulary scan;
the bounded-typo checkpoint below records behavior and its remaining resource/usefulness qualification.
This does not replace the failed 100k admission qualification or any phase 4–7 requirement. See the
[corpus evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/search-relevance/README.md).

### Bounded typo checkpoint: candidate behavior

The behavior and useful-result cases were preregistered before implementation. Dictionary enumeration
is replaced with query-derived one-edit alternatives executed by native FTS. The
candidate supports insertion, deletion, substitution and adjacent transposition for folded ASCII letter/
digit query tokens of length 5–32. Each token generates at most `73 * length + 35` alternatives
before duplicate removal (at most 2371 at length 32), independent of database vocabulary size. Query terms
outside that range or alphabet remain literal; quoted phrases and the final prefix term remain literal.
`fuzzy: false` disables alternatives. Accent folding remains the existing query adaptation and native FTS
still owns matching, optional English stemming, ranking and highlights. No dictionary, extra posting
structure, native extension or request/result codec is added. The unused vocabulary virtual table is
removed from the format-one layout and its physical recovery inventory in the same checkpoint.

This is a deliberate candidate behavior change: two independent edits on long words are no longer
supported, while one adjacent transposition works at length 5–8 too. Short, very long and non-ASCII terms
retain exact/prefix matching. The length boundary is an explicit query-work limit, not truncation of
matching documents or vocabulary candidates. Do not silently change it after measuring. User usefulness,
especially identifiers and language limitations, remains subject to the full relevance review.

Always include the permitted alternatives, even when the literal term exists. An exact-first fallback
would make spelling decisions depend on other documents; it is not part of this checkpoint. Preserve
field restrictions, boolean/exclusion semantics, list-phrase boundaries, candidate scopes, trash, units,
watch delivery, reopen and complete UTF-16 highlights. All existing shared useful-result cases stay
unchanged. Cases were added before implementation for each edit position/kind, mixed-case/accent folding,
known-word neighbors, transposition, two-independent-edit refusal, the 4/5 and 32/33 boundaries, unsupported
scripts, explicit opt-out, quoted/prefix behavior and field/boolean/candidate restrictions.

The [bounded typo proof](../references/evidence/ears-sqlite-implementation-2026-10-28/bounded-typos/README.md)
passes 18 new cases, the unchanged shared corpus, actual native MATCH/growth checks, both removal controls,
509 SQLite / 289 native cases and affected recovery/build/types/API/lint checks in disposable Linux.
Before claiming a speedup,
preregister a fixed-order growth cohort with default fuzzy enabled, useful-answer checks, warm/cold reads,
large/absent/exact/typo inputs and memory/bytes costs. Functional passage alone does not accept latency or
replace the realistic search, vector and complete-app criteria in the goal.

The first [default-fuzzy growth cohort](../references/evidence/ears-sqlite-implementation-2026-10-28/typo-cost/README.md)
completed but rejects unpruned alternatives: broad 100k reads regress from about 300 to 1320 ms, despite
selective improvements. The [native counterfactual](../references/evidence/ears-sqlite-implementation-2026-10-28/typo-native-plan/README.md)
preserves exact native rows/scores after removing alternatives with no posting, isolating redundant MATCH
branches as a major cost. The correction probes only query-generated alternatives through native MATCH
EXISTS over body/aliases before building the scored expression. It uses the request's read snapshot,
preserves English stemming and alias tokenization, and retains original alternative order. This is
zero-match pruning, not an exact-first fallback; field/candidate restrictions cannot lose useful results.
No vocabulary view, replicated dictionary, persistent spelling index or new tokenizer is introduced.
Stemming/alias, probe-plan/query-work and two-handle snapshot safeguards accompany the correction.

Before execution, fix the follow-up cohort order **scan / presence / unpruned / unpruned / presence / scan**,
with e452d67ae1 / validated presence checkpoint / 9beb23ebc9 pinned in a source manifest. Use the identical
0ba7b955b8 growth fixture, all 1k/10k/100k profiles, OFF, twelve warm calls plus first invocation for all ten
paths, normal built entries, two CPUs/6 GiB and the existing 180-second process bound. Include native probe
time in the normal facade timings. Keep all original failed-strategy results and every new sample, check
the expected answers and actual loaded JS/native hashes, and stop on the first failure. Do not qualify
real-app/cold-store/language/memory budgets from this diagnostic alone.

The [six-process cohort](../references/evidence/ears-sqlite-implementation-2026-10-28/presence-cost/README.md)
completed on a2de2944a1 with all sizes/answers: 100k selective medians ~3–3.5 ms, broad ~164–166 ms;
the original scan is ~138–144 / ~294–299 ms. Small profiles and maximum-length tokens still regress
against the scan, and broad latency remains high. Preserve every result; architecture bounding and this
correction are implemented, while complete app/corpus/resource acceptance stays open.

## Explicit offline membership repair

Local candidate 00c462a0bb extends explicit index rebuild admission to reconstruct `value_members` from
authoritative array cells. SQLite owns the native scan, JSON expansion and deduplicated insertion; one
registered deterministic callback decodes each array using the same scalar member rules as ordinary writes.
The deletion/reconstruction and generation admission share one writer transaction. Other snapshots therefore
see incumbent or complete membership; failure in later search admission rolls the entire repair back.
Primary values and logical commit identity stay unchanged. Dynamic schema admission does not take this path.

This is explicit offline maintenance, not a new interactive index-admission implementation. Its transaction
scans all list-bearing overflow values, and a single large array can require memory proportional to that array.
It can hold the writer and block its calling thread for the full scan. Qualification must record duration,
peak memory, WAL/disk growth and interruption behavior on representative profiles before claiming acceptable
maintenance limits. The CLI holds managed profile exclusion; same-handle ownership does not exclude unmanaged
writers or certify arbitrary filesystems. Validation is pending; no performance target is waived.

## Lossless logical snapshot export and staged import

The existing CLI JSON/CSV export is a display format: it converts dates/bigints and reads individual queries.
Keep that behavior explicit. The recovery archive must instead preserve one snapshot's logical primary data,
without storing physical slot/table identifiers or derived FTS/value postings as authority.

Use the existing pinned MessagePack codec for a versioned record stream with a fixed magic, length-prefixed
frames, header, and terminal record count/checksum over the preceding framed bytes. Typed value cells retain
their kind: scalar negative zero stays distinguished by its `zero` kind, dates retain milliseconds, and bytes/
composites retain their original binary payload. Do not decode/re-encode opaque composite payloads through
JSON or accidentally normalize the persisted data. Logical field names replace physical slot numbers.

The records cover schema/application metadata and counters, ordered entity identities (live and trashed),
every logical field, relations with their identity/order/info, and stored embeddings with complete
entity/index/chunk/content-hash/model/dimension identity and Float32 bytes. Preserve reusable embeddings
independently of derived generation numbers. The current coupling between embeddings and generation-owned
chunks needs an explicit restore path; the currently unsupported unchecked embedding load must not silently
lose vectors during conversion. Media, packs and secrets remain separately owned by the host backup format.

Snapshot the source to a private directory first. Stream from that immutable copy in small entity batches,
using bounded native slot pages and an overflow cursor so output backpressure never pins a live app reader.
Memory may still scale with the largest individual field/frame unless explicit chunking is implemented;
never describe a row/field-limited implementation as a fixed 8 MiB bound. The codec should consume each
incoming byte linearly, avoid repeated whole-buffer concatenation, enforce explicit frame/record limits,
and close the input iterator and scratch owners on error/cancellation. Checksum is completeness/integrity,
not authentication against a malicious producer.

The host owns destination path/permissions, temporary output, sync, exclusive publication and cleanup. A
partial or failed export never replaces an existing artifact or appears complete. Import consumes the entire
stream into an isolated staging database, validates header/schema/records/footer/count/hash and rejects
truncation, trailing bytes and conflicting identities before any incumbent publication. Rebuild and audit
that staging database before coordinated replacement. Never commit successive decoded batches directly to
a live destination while its footer is unverified. Import into a new staging store can retain snapshot
ordering/counters; replacement of an existing app store must preserve the destination's monotonic commit
and stale-handle rules. Reuse the existing host replacement/recovery coordinator for incumbent protection.

Closing checks must include codec fragmentation and early iterator cleanup, invalid length/checksum/footer/
trailing data, prototype-looking field names, absent/null/zero/date/bytes/composites, raw embedding identity,
undeclared and case-distinct fields/types, live/trash/relations/counters, mid-output IO refusal and destination
collision, interrupted staging and populated replacement, all selected stores, and actual copied-profile
conversion/reopen. Measure large-field peak memory and output/staging disk, and retain source/native pins.
This contract specifies the remaining implementation; it does not declare export/import complete or replace
the full app/operational/adoption gates in the goal.

Archive ingestion spools raw records into a separate `archive.sqlite3`, with a terminal verified seal,
identity constraints and counter checks. It cannot be mistaken for an EARS profile's `data.sqlite3`. A seal
proves wire/identity completeness, not schema/cell/embedding semantics or full audit. The internal restore
operation now reserves a different destination, validates the spool/declaration/raw cells/catalog, copies
primary data, reopens to admit current indexes, waits for readiness and audits before returning a closed
store. Failure removes only its reserved destination; an existing destination and input spool stay owned
by their caller. The host must still coordinate publication, sync, interruption recovery and selected stores.

Primary `embedding_values` owns raw Float32 bytes independently of disposable `chunks`. Each chunk references
a primary integer ID only when entity/index/chunk/content hash/model/dimensions match. Rebuild/retirement
never delete primary embeddings; lost derived chunks can be reconstructed without calling an embedding model.
Dormant imports remain primary but do not answer searches under mismatched content/declarations. Producing
or unchecked-loading a newer embedding replaces obsolete identities for that chunk transactionally, clearing
retired references before removing old payloads. Destroy/reset delete primary vectors. The importer can retain
multiple distinct reusable identities from an archive; a later embedding write supersedes them for its chunk.
This representation stores one BLOB per identity rather than duplicating the BLOB across generations.

The prerelease format-one policy still applies: an older candidate whose chunks contain vector BLOBs refuses
opening rather than silently creating empty primary storage. Export using that original source and explicitly
convert a copy. No ordinary app profile or elmdb format is migrated. The vector join now has a measured covering-index path that avoids the input grouping sort. The fixed
warmed 10k diagnostic at c23a82301b records 59.34/57.57/39.43 ms inline/referenced/covered medians, with
identical exact answers; see the archive evidence. Its earlier incomplete-index baseline is retained
without treating its observed difference as a causal join cost. Dormant-identity
resource bounds and large restored/replaced stores need measured qualification; this design does not waive
existing vector latency/recall/resource or recovery gates.

### App and host archive composition

The app-only SQLite entry exposes `exportLogicalSnapshot(database, { maxFrameBytes? })` and
`stageLogicalSnapshot(chunks, newDirectory, { maxFrameBytes? })`. The latter reserves a private container,
fully verifies the ingestion spool, restores a separate child store with FULL commits, builds and audits,
then removes the spool and returns the closed child. A failure removes only its reserved container;
a pre-existing directory is untouched. Successful staging belongs to the caller. Keep it private until
publication; incomplete ingestion never becomes the profile's ordinary data file.

The host's `exportLogicalDatabase` writes through async bounded file writes, syncs/closes before exclusive
hard-link publication, cleans its private temporary directory and syncs the parent. A directory-sync
failure after publication returns `NOT_DURABLE` with `publishedPath` while retaining the complete artifact.
Cleanup failures retain their original causes and identify a published path where applicable. Exclusive
hard-link support is a requirement of this publication path; unsupported filesystems fail rather than
falling back to overwriting or a visible partial copy. Only actual CI hosts are qualified; Windows
inherited ACLs/directory durability and arbitrary filesystems are not certified.

The host's logical inspection/import accepts explicit primary/history archive paths. It stages and audits
every selected input before invoking the existing import coordinator. Physical-backup validation still
requires primary data. Logical selected-store validation supports history alone without refreshing or
rewriting an unrelated primary store. Inspection also runs the primary application validator when primary
is selected, making it usable for a genuine dry run. Import retains write exclusion, incumbent copies,
watch notifications, acceptance rollback and `COMMIT_UNKNOWN` recovery. Logical archives contain database
data only; current media remains untouched, and packs/secrets are separately owned. Full backup/media
composition, interruption/large-profile/real-conversion and packaged-platform
qualification remain required; these APIs alone do not complete those gates.

### CLI logical archives

`db dump --primary <new-file> [--runs <new-file>]` and `db load --primary <file> [--runs <file>]`
expose explicit per-store archives; either flag may stand alone. Dump takes managed offline exclusion,
requires a named profile and new distinct external outputs, opens all selected stores before any output,
and retains/names completed independent archives if a later selected export fails. Each file uses host
exclusive publication; the command does not promise an atomic multi-file artifact or cross-store snapshot.

Load stages/audits and validates application settings for a dry run. `--force` performs the same verification
once through the host coordinator and announces validation from its pre-replacement hook; it does not
stage/build/audit twice in the forced invocation. All selected existing stores are opened before staging,
and history-only load preserves primary commit/data. Unknown outcomes use existing retained import recovery.
Logical archives do not replace the physical backup's media ownership; media/packs/secrets remain separate.
Real profile command checks, actual built CLI and packaged/interruption/resource/copy-conversion acceptance
are distinct closing checks. Public command documentation does not imply those final gates have passed.

Parent-issued publication-boundary kill checks witness the actual exclusive link call, then stop the child
before or immediately after it. Before publication the final path is absent and retry succeeds; after
publication the complete archive verifies/restores and retry refuses overwrite. Source commit/values stay
unchanged. Process death may leave private export scratch in the output parent; retry owns a new directory
and never guesses that another directory is abandoned. After stopping all exporting tools and verifying
retained output, an operator can remove leftover `.apack-logical-export-*` directories. These process-kill
checks do not prove directory persistence under power loss. Interrupted ingestion/semantic rebuild and
large-profile disk/resource/power-loss qualification remain separate requirements.
