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

Global readiness waits on the entire active generation catalog for boot/reset/whole-store maintenance.
Single-pack activation and reload instead include that pack's entity types, its transitive dependency declarations
(including admitted declarations without a running runtime), and common SDK/host types. Unrelated retained
failures remain visible to global waits without blocking the scoped admission. The database snapshots scoped
generation identities and rejects `CANCELLED` when they retire or change while waiting, rather than silently
accepting a replacement. The registry also snapshots relevant accepted runtime bindings/dependency declarations and checks them again after awaiting, because a replacement can add types outside an earlier scope. This check ignores unrelated owners and structurally equal catalog clones; dependency discovery is iterative with indexed owner lookup. All five owner-race cases pass [focused 3bc](../references/evidence/ears-sqlite-implementation-2026-10-28/owner-3bc/README.md), with 97 host passes and full host/EARS types. Closed/stale/open-unit/fatal-owner refusals still apply, including empty scopes.
Real-store unrelated-failure and generation-replacement regressions plus registry ownership and actual lifecycle
forwarding checks pass [focused 644](../references/evidence/ears-sqlite-implementation-2026-10-28/readiness-644/README.md). The additional host fixture uses normal SQLite store composition and installed-pack activation, with a valid persisted failed derived generation and bridged onInit primary read; it still requires global readiness to refuse. The integrated fixture now passes [real-host d9c](../references/evidence/ears-sqlite-implementation-2026-10-28/real-host-d9c/README.md), including full host types; the [Linux 163 mutation control](../references/evidence/ears-sqlite-implementation-2026-10-28/readiness-163-linux/README.md) proves the original EARS isolation regression fails with the old global wait. The owner-race correction is now focused-qualified at 3bc; the installed-pack mutation control and full latest-source platform/app coverage still require their own routes. Passing these controls alone does not close full final-source/app acceptance.

Canonical cosine scoring uses the already loaded, application-owned vec1 kernel when that connection has one, and sqlite-vec otherwise. Both consume the same canonical/safe derived direction and the same normalized query; primary bytes, membership filters, owner aggregation, ANN budgets and tie-breaking policy stay unchanged. This deliberately permits existing Float32 kernel rounding differences, rather than requiring bitwise score identity across kernels. Independent Float64 compatibility at 1–1536 dimensions, magnitude extremes and odd lengths is required through public fallback/native reads; supported-platform and real-corpus recall/responsiveness gates still apply. The initial matched synthetic scan diagnostic is an optimization lead, not a full-query performance claim.

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
outside that range or alphabet remain literal; quoted phrases remain literal. The final prefix term combines
literal completion with bounded exact whole-word alternatives; generated alternatives never receive a wildcard.
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

The threads panel sets `prefix:true`; the candidate now preserves its literal completion branch and
allows the same bounded **whole-word** typo alternatives alongside it, with default/explicit fuzzy:true.
It never applies prefix wildcards to alternatives, expands quoted phrases, enumerates vocabulary or
overrides fuzzy:false. [Four useful-result judgments](../references/evidence/ears-sqlite-implementation-2026-10-28/prefix-typo-preregistration/README.md)
were preregistered before implementation. [Post-rebase validation](../references/evidence/ears-sqlite-implementation-2026-10-28/prefix-rebase-validation/README.md)
records native36/36, pre-fix SQLite34/36 with exactly the two intended failures, and all153 assertions in
seven affected search files passing after the change. Types, lint and all five package builds pass.
The full local run still has seven original-deadline timeouts. Its75 native skips from a private harness
omission are covered by a [corrected focused run](../references/evidence/ears-sqlite-implementation-2026-10-28/prefix-followup/README.md):75pass/0skip.
All14 cost paths pass answer checks at1k/10k/100k. At100k, prefix typo warm p50 is3.719ms and the
32-character typo11.193ms. Broad common-word queries still reach197ms warm and the full diagnostic
sequence reaches329ms heartbeat delay. These observations do not claim a speedup, pass the16ms
responsiveness criterion or complete app/search/goal acceptance.

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
independently of derived generation numbers. Primary `embedding_values` now owns those bytes; generation-owned
chunks reference them. Unchecked embedding load and logical staging/restore preserve full identities, including
dormant reusable vectors, without making a derived generation authoritative. Media, packs and secrets remain separately owned by the host backup format.

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

### Generation-owned native storage

The explicitly selected SQLite host composition starts one managed native model owner per store;
production's default composition remains elmdb. `sqlite/vector-index.ts` owns the trained native projection.
The application resolves its trusted packaged extension; stored metadata never selects executable code.
Read-only and offline opens do not start a model owner. Model installation, table/triggers and catalog admission
share one writer transaction. The model hash identifies the private generation.

Chunk triggers capture ordinary foreground changes, including writes behind the bounded
backfill cursor. Trash changes update that owner's native rows in the same transaction.
Canonical bytes stay in `embedding_values`; native rows are derived. Readiness publishes
after backfill, without a logical data commit. A nonempty group cannot be dropped through
the retirement operation. Candidate queries apply owner scopes before K. When a model owner is attached and ready,
EARS requests 256 distinct owners through K=32, 1024 through K=40, and 2048 through K=64.
Duplicate-chunk expansion grows the native page up to 4096 chunks until that target is supplied;
all returned distinct owners are retained, then every current canonical chunk for those owners is
reranked with stable entity-sequence ties. Too few native owners retain the ordinary owner-level fallback.
Small scopes (at most 4096 eligible chunks), K above 64 and unsupported dimensions remain exact.
The native page cap does not bound canonical reranking work: one selected owner may have many chunks.
Phase-4/7 resource qualification must cover that skew as well as one-chunk-per-owner corpora.
[The current managed corpus](../references/evidence/ears-sqlite-implementation-2026-10-28/corpus-b99/README.md)
passes mean recall at 10/40/64 against independent Float64 truth in each scope/family, but still misses eight
heartbeat groups. This is neither complete fallback/model-state qualification nor product adoption.

The [lifecycle evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/native-generation-admission/README.md)
covers actual EARS mutation/rollback, bounded admission, a read-only compacted backup
and negative controls on original upstream vec1. It does not select a native fork or
establish automatic admission, performance, normal packaging or platform qualification.
`sqlite/vector-training.ts` now isolates training in a read-only worker and validates the
vector generation again after completion. Its samples/input budget and returned model are
bounded; total native memory and timing still require measurement. The owner supplies trusted
paths, serializes workers and awaits actual exit on cancellation. Close signals cancellation,
but host storage must explicitly drain before replacement/deletion; native C need not stop
immediately. The [worker evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/native-training-worker/README.md)
retains a real stale-snapshot failure, its fix, negative controls and exact native hashes.

Projection backfill first pages IDs using `chunk_native_admission`, then loads only that page's
vectors. Native model projection now takes at most 128 ordered rows and stops after the shared
four-millisecond work target. Cursor/readiness include only completed rows and roll back with them;
an early stop within an underfilled page cannot publish readiness. This reduces redundant FULL commits,
but an indivisible row, query/GC and COMMIT can exceed the cooperative target. Missing cursor indexes on populated stores require explicit offline preparation.
The shared scheduler now persists attempt/model states, claims attempts before worker launch,
acknowledges responses only after result COMMIT, resumes committed work after reopen and
joins native readiness/watch notification and bounded retirement. Explicit restart recovery
requires the managed exclusive writer. [Scheduler evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/native-model-scheduler/README.md)
retains rollback, stale-attempt and acknowledgement mutation controls.
Attached model owners now perform automatic **initial** eligibility admission. Shared routing limits keep
scopes of at most 4,096 chunks exact; admission requires more live chunks and at least 256 live owners,
with supported training dimensions. Generation-specific dependency maps are prepared before a schema
commit and accepted without IO. Only committed embedding, membership and declared source-field changes
mark affected generations; registered generations stop receiving initial work. Another connection's changes
are conservatively observed through `data_version` when polled, without promising cross-process watches.
An active finite-range metadata scan is not reset by intervening relevant writes. Each turn reads at most
128 references before joining live-owner metadata, stores at most 256 owners, and accepts its progress/enqueue
only after COMMIT. No vector payload is hydrated. Failed logical generations and unsupported dimensions
are skipped. Persisted failed training still requires explicit retry.
[Automatic admission evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/automatic-model-admission/README.md)
covers 633 EARS cases, all fourteen model cases, five mutation controls and real 1k/100k owner-driven admission
without explicit benchmark enqueue. The 100k heartbeat p99 still misses 16 ms; neither concurrent training
WAL/write behavior nor complete query/relevance acceptance follows from this probe.
App-only `openDatabase` now accepts an owner-supplied absolute `nativeVectorExtension` and loads it
before connection writes. Ready native candidate selection is shared with separately opened read-only and
writable handles, without automatically creating a trainer. Private export/audit/replacement-source copies
inherit the owner's loader, never a path from stored data. [Connection evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/native-connections/README.md)
retains 637 passing SQLite cases, generated API/package checks and two negative controls. This is the
connection contract; ordinary unsigned package resolution is now implemented below; installed/signing qualification remains required.
Graceful API SIGTERM now uses host `closeDatabases`: per-handle write exclusion remains held until
optional terminal drain and close complete. Other stores still settle if one fails; repeated signals and
shutdown hooks are idempotent. SQLite's terminal drain rejects new writes until close/reopen. This does
not implement live replacement suspension/resume or offline publication; those require separate ownership.
[Shutdown qualification](../references/evidence/ears-sqlite-implementation-2026-10-28/shutdown-ownership/README.md)
retains real worker-drain tests and host/API controls, without claiming installed-process acceptance.
Ordinary EARS package production now builds vec1 offline from the vendored pinned C source, retaining the
existing membership patch and native parameters. Only the target library, stable provenance and upstream
license ship. App-only opens resolve and hash-check their package-owned artifact by default, while trusted
owner overrides remain explicit. The CI wrapper requires independent/package byte equality. Native source
is a declared package input; Windows compiler setup precedes package production. Signed/installed artifacts
must finalize their binary hashes after library signing, before the outer app is sealed; that lifecycle is
not supplied by an unsigned npm package. Managed app owner creation is now implemented below.
Native model constructors now take an OS-backed service claim using pinned `fs-native-extensions` 1.5.2.
One persistent empty inode per store prevents independently opened services from recovering each other's
work. The descriptor remains held through actual worker exit; no signal/PID timeout releases it early.
Idle owners release synchronously, and process death releases kernel ownership. The addon is loaded lazily
through one typed consumed signature, avoiding ambient declarations in consuming workspace builds.
This does not certify network filesystems, arbitrary inode deletion or noncooperating writers.

Managed API startup now uses the host storage hook to start a claimed service on each writable SQLite
store before loading packs. It recovers abandoned attempts only after claiming ownership, and drains both
stores if either startup refuses. Forensic readers and offline constructors do not start services.
Logical `indexesReady()` remains usable while optional native work is pending or failed; explicit
`waitForNativeModels()` includes model completion. Graceful shutdown joins the service's actual worker exit.
[Exact platform qualification](../references/evidence/ears-sqlite-implementation-2026-10-28/model-readiness-activation/platform-41034695900/README.md)
passes Linux/macOS/Windows on committed master `5e81dda7c2` and native `95615ed8d4`. This does not
certify signed installed apps, live replacement suspension or the final performance budgets.

Physical refresh separates logical vector generations from physical model identities. `vector_indexes`
allocates persistent non-reused physical IDs, with unique partial indexes for one ready and one building
model per logical generation. `ann_<physical-id>` tables capture canonical writes transactionally during
projection. App-only `refreshNativeModels()` durably queues replacements without retaining write exclusion
through training; it neither changes logical generations nor invents a logical commit. Failed attempts leave
the incumbent usable on owner and independently opened reader connections. Candidate routing follows the
ready physical row, independently of the latest training attempt's state.

Only complete projection switches the ready row, within the same transaction as its final cursor update.
The previous model becomes retiring and loses its write triggers at that switch, so foreground mutations
cannot repopulate garbage. Cleanup deletes at most 32 native rows per scheduler step before dropping an
empty physical group; public refresh refuses another attempt until the prior projection/retirement finishes.
An older read snapshot remains valid across another connection's publication and retirement. Interrupted
private projection resumes after reopen while the incumbent remains current. This changes pre-release
format-one derived metadata in place: recreate developer SQLite profiles rather than adding a compatibility
migration; production remains elmdb.
[Physical refresh evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/physical-model-refresh/README.md)
records the five focused cases, three reverted-code controls and current-pin integrated Linux qualification.
Physical refresh passes all three platforms and full strict at `95515e6463`; installed qualification remains required.

Live replacement now retains native ownership through actual worker drain and resumes only after acceptance
or restoration; its canonical transaction invalidates the old model epoch. Native audit/rebuild coverage is
described below. Physical publication/deletion authority, physical-file recovery and trusted
installed loading/signing remain required; explicit native group repair is described below.
No raw constructor or model-service claim grants physical replacement/deletion authority.
Ordinary empty-store creation now prepares the native cursor index before primary/stage ingestion,
with transactional failure/retry and populated staging/reopen coverage. Populated stores missing it
still require explicit offline preparation. [Cursor preparation evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/native-cursor-preparation/README.md)
retains 635 SQLite cases and the reverted-code control; it does not qualify the newer native pin. The new platform gate requires the native
lifecycle cases; neither it nor these local cases establish performance or final adoption.
Keep the complete goal and frozen fresh validation gates.
The [fresh integrated matrix](../references/evidence/ears-sqlite-implementation-2026-10-28/fresh-native-ears/README.md)
now completes all eighteen cohorts with mean recall >=0.972, but fails responsiveness
and 10k broad latency. Native filtered SQL dominates large scopes; count/rerank plans
also cost measurable time. Admission profiling identifies COMMIT as the dominant tail,
not model installation or observed GC. Investigate projection pruning, scope execution,
native membership and off-thread SQLite PASSIVE checkpoints without relaxing FULL logical
durability. Frozen parameters, original failures and remaining app/resource gates stay intact.
Owner-only native projection now omits unused vector payload/distance calculation, without
material sampled speedup. A bounded materialized eligibility page shares count and exact
scoring for small sets, with a scalar witness against duplicate scope evaluation. Source
`25668da288` passes 625 EARS/135 host cases; [diagnostics](../references/evidence/ears-sqlite-implementation-2026-10-28/vector-projection-scope/README.md)
show a small exact-query improvement but no overall acceptance and worse broad samples.
[Checkpoint and batching evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/admission-commit-batching/README.md)
now separates automatic-checkpoint deferral from the same FULL admission workload. Deferral alone still
misses heartbeat and grows WAL to about 2.16 GB before a 4.56 s final checkpoint, so it is not selected.
Time-sliced projection reduces sampled FULL commit counts from 3,126 to 1,075–1,185 and admission from
26.57–46.19 s to 17.74–18.26 s. Heartbeat p99 varies and remains failed; this is not a general latency win.
All 626 SQLite EARS cases and the reverted-implementation control pass their intended assertions.
Further shared execution and bounded checkpoint/writer ownership work remains required, preserving FULL
logical durability and the frozen heartbeat limit. Off-thread checkpoints alone are not established as sufficient.

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

### Explicit developer conversion from elmdb

`packages/apack-ears/scripts/convert-elmdb-dump.ts` is an offline developer tool, outside the public
package entries and normal app startup. A matching pinned Rust `elmdb dump <copied-store> <new-file>`
produces its input. Run the converter only in a disposable environment, with a new private output container:

```sh
node --import tsx packages/apack-ears/scripts/convert-elmdb-dump.ts copied.dump new-private-container
```

The result names `new-private-container/store`, a closed SQLite store. The tool validates the native
version/schema/framing/count/EOF, imports in batches of at most 1,000 loads or approximately 8 MiB of
encoded input (one frame may exceed that), rebuilds derived indexes, reopens and audits. It preserves
original composite field and relation-info MessagePack payloads, avoiding re-encoding loss such as nested
Float64 negative zero. It refuses integers JavaScript cannot represent exactly. Memory still scales with
the largest native frame (currently limited to 1 GiB), its decoded values and the current batch.

Failure removes only its newly reserved output container; existing destinations and the input file remain
caller-owned. The native dump's footer has a count, not a checksum; retain producer provenance and a hash
of trusted input. Conversion starts a new commit history and preserves ordering rather than physical
internal sequence numbers. Entity/relation IDs, logical counters and reusable embeddings must survive.
This tool alone does not convert an entire application profile, publish a live replacement, transfer media
or establish interruption/resource/platform qualification. Full copied-profile conversion and app reopen
remain acceptance requirements. The explicit interoperability probe is
`tests/_support/elmdb-conversion-native.ts`; it requires the matching native CLI and compares real copied
source rows, trash, relations, search, embeddings and counters, including unchanged source data hashes.

### New private application profile from a stopped native copy

The developer wrapper `scripts/convert-sqlite-profile.ts` converts an explicitly named stopped profile copy
into a new private output container, using the matching native CLI. Parent directories must already exist:

```sh
node scripts/with-source.mjs node --import tsx scripts/convert-sqlite-profile.ts \
  /absolute/source-copy /absolute/new-conversion-container /absolute/matching/elmdb
```

The returned path is `new-conversion-container/profile`. Before that final name exists, the wrapper copies
app-owned `apack/` files into `.profile-incomplete`, exports/converts primary and existing history, rebuilds
and audits both, and reopens them through normal host composition. It reads stored settings and validates
materialized installed-pack metadata through that composition. Only then does a same-container directory
rename give the completed profile its final name. Do not point an app at `.profile-incomplete` or the outer
container. A killed conversion may leave private scratch; inspect it after stopping tools and retry in a new
container rather than guessing an interrupted directory is safe to reuse. No automatic resume is implemented.

The source's managed writer claim is held throughout; a running source app, pending import recovery,
existing output, overlapping/aliased source/output, mixed/invalid native stores and links/special files refuse.
The wrapper requires materialized source content and preserves encrypted secret bytes without promising
cross-machine decryption. Media, per-pack data, settings, installed enablement metadata and sealed pack
files transfer; browser/Chromium state outside `apack/`, stale runtime tokens/endpoints and lock/reader claims
do not. Primary data and app-owned source payloads stay unchanged; normal LMDB/managed lock metadata may
change. Missing history stays absent until ordinary boot creates it. Failure removes only owned incomplete
output; a complete profile survives a later source-lock cleanup error with `completedPath` reported.

The Linux gate at cedeb1f362 passes five actual native-producer profile groups, seven dump cases and fifteen
host lock cases, plus types/builds/static checks. It uses a sealed **data-only** pack fixture and normal host
reopen, not executable pack activation or a complete API/Electron/renderer boot. Process-kill during profile
conversion, physical/resource faults, supported-platform results and actual app acceptance remain required.
The platform workflow now requires this probe, exact source/native producer receipts and all seven dump cases.

### Actual API lifecycle on a converted native profile

After building matching packages, the starter pack and API, the disposable Linux gate is:

```sh
python3 tests/scripts/test-sqlite-converted-api.py \
  --producer /absolute/matching/elmdb --output /absolute/new-evidence-directory
```

The gate uses only synthetic temporary data. It boots the real starter pack on native storage, updates a Prompt
through authenticated RPC and observes the real pack view, stops the API, converts the resulting native profile,
then boots SQLite twice and verifies further updates/restart persistence. Offline inspection verifies typed/large
values, settings, history and media and unchanged native source hashes. It records observed optional Codex
executable absence rather than claiming all pack integrations work; JSON fatal API reports refuse. It is a built
Node API gate, not an Electron/renderer or installed-distribution certificate. The Linux platform job requires it,
while every platform separately requires the native-producer profile conversion/refusal probe.

### Process death during profile conversion

`tests/scripts/test-sqlite-profile-crash.ts <matching-elmdb-cli> <new-receipt.json>` runs under the source condition
and tsx in disposable environments. A parent kills the child only after real method-boundary witnesses: partial
FULL ingestion, primary installation, and final directory publication. The final profile stays absent before
publication; after it, both stores and owned data reopen completely. Reuse of the killed operation's container
refuses; a new-container retry reclaims the dead source owner while preserving the old output file bytes. The
Linux five-case proof is retained, and platform CI now requires all five cases. This is process-kill qualification,
not proof against power loss, resource exhaustion or arbitrary filesystem behavior; no automatic resume/cleanup
of a killed operation's private scratch is introduced.

### Live model maintenance

`withNativeModelsPaused(database, operation)` acquires write exclusion and drains the actual worker,
retaining the service's kernel claim across the callback and nested scopes. Without a service it takes an
offline claim without starting training. Logical backfill and `indexesReady()` remain usable; explicit native
waits/admission refuse with `BACKGROUND_PAUSED`. Only a previously running service resumes. Stale schema
handles refuse at entry and again before recovery. Leaked foreground units are aborted before write
exclusion is released. Closing in the callback releases ownership and prevents resumption.

Reset and same-schema replacement retire every physical model and remove attempts in the canonical
transaction; rollback restores the old epoch. Canonical embedding bytes remain authoritative. Model
admission observes the new corpus after commit. This avoids using an incumbent trained for replaced data.

Host import keeps native suspension around acceptance and restoration and settings replacement outside
suspension. Native recovery completes before success/notifications. Recovery failure or settings cleanup
failure after installation retains the prepared incumbent and reports `RECOVERY_REQUIRED` with
`recoveryPath` and `dataInstalled` (preserving `COMMIT_UNKNOWN`). Both managed stores drain/close and
replacement announcements are suppressed. Quarantined handles permit ownership leases for cleanup;
all data reads/writes still refuse. Arbitrary directory publication, noncooperating writers and signed
installed lifecycle remain separate acceptance work.

### Native audit and derived rebuild

Private audit snapshots also inspect pinned vec1 projections. SQLite's native integrity method checks native
page membership. EARS checks catalog/model hashes, trigger definitions, canonical normalized vectors, owner
sequences and trash visibility, complete ready membership and the visited prefix of building projections.
It reports orphaned tables/shadows and missing catalog ownership. Shadow schema/model identity are now
checked before native integrity code sees potentially damaged payloads. `comparedNativeModels` and the other
checked counters record each completed inspection phase; an early failure can leave later counters zero.
The source is never repaired by audit. SQL owns row scans; model hashing holds one trained model blob at a time. This is not a measured
native memory/disk budget or a guarantee against arbitrary malformed native binary payloads.

Public derived rebuild now runs within `withNativeModelsPaused`: it refuses an independent native owner,
drains an attached worker and retains the claim. Admission invalidates old native models in the same
transaction as fresh logical generations, preserving authoritative embedding bytes and the logical commit.
After logical readiness, invalidated native rows retire in batches of at most 32 under the held claim before
resumption/release. An existing service resumes; an offline rebuild does not start training.

The failed-logical-generation test now allows finite old-model retirement before checking idle admission.
A diagnostic at 0.5 CPU removed 2592 of 4608 native rows in 81 batches within five seconds, with 2016
remaining; it was not stalled. This is evidence that a row bound is not a latency bound, not a performance
pass. The separate frozen heartbeat limit remains 16 ms. Explicit group repair is implemented below; physical-file recovery, complete physical publication ownership,
final platform/installed and resource qualification remain open.

### Repair damaged native groups during explicit rebuild

Public rebuild diagnoses native groups under the retained maintenance claim and inside the logical rebuild
transaction. Missing/malformed shadow structures, missing/corrupt model bytes, missing/altered triggers,
canonical row drift, native page membership damage and orphaned groups are disposable derived storage.
Verified damaged groups are removed by the pinned vec1 `xDestroy` path, which drops its shadows without
parsing the damaged model/config. Orphan shadows are removed only from the reserved native namespace.
Healthy invalidated groups still retire in batches of at most 32 rows; damaged-group DROP is an explicit
repair path with no claimed latency bound. Model hashing examines raw bytes before invoking native integrity.

Repair and new logical admission commit together. A refused COMMIT or a later I/O failure rolls back both;
committed-but-unacknowledged repair quarantines the handle and requires reopen/inspection, never blind replay.
Ordinary integrity I/O errors do not authorize deletion. Unsafe catalog identities and foreign tables in the
native namespace refuse rather than guessing ownership. Unreadable primary/catalog files require recovery
from a retained copy or logical export/staging into a new private profile; this repair is not a general file
salvager. The existing logical archive operations retain canonical bytes independently of derived models.

[Native derived repair evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/native-derived-repair/README.md)
records the exact overlay, fault cases and four negative controls. Final all-platform, physical-publication,
installed/signing and unchanged performance gates remain required. Full strict at the preceding live-maintenance
checkpoint also has an unresolved bundled-editor app assertion; native platform success does not close it.


### Native runtime and installed Preview validation

The packaged native smoke now exercises a real 4097-row, 128-dimensional ready model, worker/ownership,
search and read-only reopen within its original deadline. Resolved EARS assets and loaded native addons
must remain inside the staged app. Node-API 10 in better-sqlite3 13.0.3 supports both Node 23 and Electron
37's Node 22 without a driver rebuild; selective node-pty rebuilding remains appropriate.

The `installed` app-acceptance suite builds an ordinary unsigned Preview, runs the complete native smoke,
and launches its actual executable against an isolated SQLite profile. An app-integration witness requires
both managed stores to contain SQLite files and retain their native model claims across the real API process.
The report guard refuses a missing or skipped witness. This complements source-based authoring tests;
it does not certify signing or all required architectures. [Component evidence and limits](../references/evidence/ears-sqlite-implementation-2026-10-28/native-electron-runtime/README.md)
retain runtime hashes, fixture corrections and negative controls. [Actual packaged Windows/Linux module probes](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-platform-dcbb/README.md) pass at their recorded source; they do not launch the renderer or certify an installer. Current-source installed execution remains required.


### macOS signing and final native hashes

`mac.sign` preserves electron-builder's resolved signing options and retries through @electron/osx-sign.
The hook verifies unsigned native bytes first, then updates only their manifest's binary hash immediately
before outer sealing, after the actual inner library signing pass and signature verification. It refuses
changed manifests, escaping paths and unsupported universal layouts. Signing never mutates sealed resources.

The `installed-signed` app acceptance suite exercises the same hook using the existing CI Developer ID
certificate on a disposable Preview, verifies strict bundle integrity, then runs the full native smoke and
SQLite app lifecycle. No release or notarization occurs. [Ordering/fault evidence and cold-build fix](../references/evidence/ears-sqlite-implementation-2026-10-28/native-mac-signing/README.md)
record the 12 isolated tests and three safeguard controls. [Actual signed macOS installed execution](../references/evidence/ears-sqlite-implementation-2026-10-28/installed-49d/README.md) passes at 49d, with six app cases and native smoke before/after signing. This predates the current runtime, so exact-current signing/distribution qualification remains required.
Preview and production now let the ordinary pack build generate entries after preparing SDK dependencies.


### Managed directory lifetime and quarantine authority

All managed host opens claim directory lifetime before entering either backend. Writable handles participate
alongside readers. Physical recovery excludes the entire profile; history quarantine uses store-scoped
exclusion so a primary handle does not prevent legitimate corrupt-history replacement. Claims carry the
physical directory identity and leaf name. Unresolved identity stays excluded, managed leaf symlinks refuse,
and quarantine verifies the original directory still occupies the destination after taking exclusion.

A constructor that cannot close its native connection reports `databaseConnectionUnclosed`; its host claim
survives until process exit. Aggregate/uncertain errors never authorize quarantine. Backend-owned classification
recognizes SQLite's own corruption codes without treating I/O, permission, full-disk, busy or known derived-index
failures as evidence that a whole history directory may be moved. Ordinary background owners continue to drain
through `closeDatabases` before close or filesystem changes.

[Managed publication evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/managed-publication/README.md)
retains both-format tests, live-writer process death, stale-publication and close-fault proofs, exact input hashes
and seven reverted-safeguard controls. The current named inventory requires 29 publication and 19 identity witnesses on every platform; extra passing cases
cannot mask missing, skipped or duplicated required witnesses. Local functional evidence does not certify final
platform, unmanaged-writer, directory durability or performance behavior.

SQLite admission now checks the main file and `-wal`, `-shm` and `-journal` entries with `lstat` before any
native open, including the read-only identity probe. Each present entry must be an ordinary file with exactly
one link; dangling links and sidecars without a main database refuse with `IO`. Backup publication requires
all four destination names to be absent before `VACUUM INTO`. This is admission within a cooperatively owned
directory, not a claim that a path check excludes hostile concurrent namespace replacement or arbitrary mount
aliases. The host's directory-lifetime claims and recovery exclusion remain necessary. Positive format identity
is implemented and covered by the format-identity evidence; final platform qualification of the new file
admission and quarantine-parent synchronization remain required before adoption.


### Reset and quarantine publication

A forced CLI reset takes store-scoped recovery exclusion for history before clearing primary data or
secrets, even when history is absent. It refuses existing managed history readers and writers; new managed
opens are blocked until deletion finishes. A sibling primary claim is excluded from that decision only
when its distinct leaf and physical directory identity still agree. Unknown, same-store and stale claims
remain refusals. Dry runs remain read-only and take no destructive exclusion. All error paths release the
exclusion. Reset spans separate stores and secrets rather than one atomic transaction: an interrupted
reset may have cleared primary data while retaining history, and can be explicitly retried.

Unreadable history moves to a timestamped, unique quarantine name under store exclusion. A parent-directory
flush is required before replacement opens, and again after the replacement directory is created.
A failed synchronization reports `PUBLICATION_NOT_DURABLE`, preserves the original open refusal and sync
error, and names the retained quarantine. If closing a failed replacement also fails, both the cleanup
error and its managed directory claim survive; uncertainty never authorizes another quarantine.
Windows barriers now request a real flush using a writable directory descriptor; the pinned Node23/
libuv1.50 NTFS probe confirms the operation, while r descriptors refuse with EPERM. Recovery barriers
propagate failure; private-file publication reports NOT_DURABLE with its installed path and cause.
The changed production paths still require affected three-platform verification. Ordinary-user ACL,
installed-runtime and physical filesystem qualification remain required; API success alone is not
power-loss proof or arbitrary-filesystem certification.


### Current graph contract

The private structured plan carries `both`, bounded hierarchy walks, shortest `pathTo` and terminal
`degrees` from the current EARS facade. One-hop adjacency and degree counting execute in SQL against the
source/target relation indexes; parallel edges count separately, and a self-edge counts twice in both directions.
Hierarchy and shortest-path execution batch each breadth-first frontier into one SQL read, ordered by seed,
requested kind, direction and insertion sequence. The driver iterator avoids retaining the complete layer's
adjacency rows in JavaScript and closes on early path discovery. The frontier, visited set and parent map remain
proportional to visited vertices; SQLite may also allocate or spill for ordering. This is not a constant-memory
traversal or a latency qualification. Output-type restriction does not block traversal through other types.
Graph membership dependencies include intermediate and unchecked repair types so trash/restore/destruction
cannot leave a path or degree watch stale. Focused contracts compare both backends; final combined-source
qualification and representative graph performance measurements remain required by the goal.


The facade also carries `rank`, `weakComponents`, `strongComponents` and `communities` from pinned master
`8f8433a5b9`. `graph-algorithms.ts` projects the induced graph with one SQL statement, retaining requested
kind/direction/edge order and repeated edges, and deduplicates nodes by first encounter. Iterative Kosaraju
computes strong components; iterative traversal computes weak components. PageRank uses two reusable
work buffers with the native default damping, tolerance and round limit. Graph algorithms use O(V+E)
working storage; result ordering adds sorting work, and SQL may allocate or spill for its own projection.
This is neither bounded-memory graph execution nor a realistic-load performance qualification.

`communities.ts` sends the projected edges to locked `leiden-rs@0.8.1` through the small synchronous
Rust/WASM wrapper in `native/graphs`. Native's graph builder preserves parallel/opposite edge weights.
Seed zero is explicit, unsigned seeds and finite nonnegative resolution validate, resolution zero returns
connected components, and groups retain size/encounter order. Errors propagate rather than becoming
invented singleton partitions. The initial TypeScript dependency was rejected after its seed-zero karate
modularity reached 0.3952 versus native 0.4198; its failed test/evidence remain, while the Rust core reaches
0.419789612 and passes the unchanged regression.

`community-core.ts` validates pinned source and generated binding/WASM hashes before evaluating trusted
package code. It creates a fresh generated module without Node's global require cache; each SQLite handle
owns its linear memory and releases its reference on close. App-owned opens initialize it before creating
database files. Package production performs locked builds with Rust1.99.1/wasm-bindgen0.2.105, private
intermediates, path remapping and third-party license texts. No compiler/download runs at database open,
and stored metadata never selects executable code. Missing or changed artifacts refuse explicitly.

[Portable-core evidence](../references/evidence/ears-sqlite-implementation-2026-10-28/graph-wasm-4ed/README.md)
records Node native-quality parity and 106 focused passing EARS cases, including independent memories and
negative integrity checks. This does not qualify the new production build, installed runtimes, realistic
graph resource costs or all remaining original acceptance gates. The original strict checkpoint is green
atdcbb289e56; exact-current full/platform/packaging checks remain required.


### Read-only media and published backups

A low-level read-only connection does not promise to open every WAL database on read-only media.
SQLite [requires readable existing WAL/SHM files, permission to create them, or an explicitly immutable
image](https://sqlite.org/wal.html#read_only_databases). The candidate does not mark arbitrary profiles
immutable: they may have a concurrent writer. A cleanly closed WAL-mode file can therefore refuse with
`SQLITE_CANTOPEN` on an actual read-only mount when its sidecars are absent. Do not remove a committed WAL
or switch a live database's mode to bypass that refusal. Publish a database backup before placing an image
on read-only media; the existing `VACUUM INTO` backup uses rollback journaling and needs no WAL sidecars.

The [Linux mount observation](../references/evidence/ears-sqlite-implementation-2026-10-28/readonly-mount-aea/README.md)
verifies successful published-backup queries and logical write refusal under kernel `EROFS`, the closed-WAL
refusal, and unchanged file hashes/inventories. Managed host opens still require writable directory-lifetime
claim metadata, including read-only inspection. This is not support for a read-only app profile, qualification
of a live WAL reader on that mount, or certification of arbitrary filesystems.

### Persisted identity and initialization

Format-one SQLite files carry application ID `0x45415253` (EARS) and `user_version=1`. A foreign or mismatched
identity refuses with `WRONG_FORMAT` before EARS initialization. Existing writable targets first undergo
read-only inspection: closing a writable connection can checkpoint another application's committed WAL even
when our initializer refused it. A real killed-writer fixture verifies that refusal preserves both the main
file and committed WAL bytes. A failed probe close retains the managed directory claim and original failure.
New empty files publish their identity and foundational primary tables in one transaction, before enabling
WAL. Initialization failure rolls back both and permits a clean retry. Driver busy timeout is zero from the
first metadata read. Missing primary catalogs or admitted per-type tables refuse as corruption; declarations
must not recreate them over a damaged store. Derived-index recovery remains separately owned.

This edits pre-release format one in place. Unmarked earlier candidates require explicit export/conversion
with their original code or recreation; normal opens add no compatibility fallback or migration. Format
validation does not grant physical replacement authority or exclude arbitrary raw writers and path aliases.
Ordinary data-file ownership, reset/history deletion exclusion, durable directory publication and the remaining
operational qualification are still required by the goal.


### Background responsiveness: transaction-level attribution

The [current-source admission diagnostic](../references/evidence/ears-sqlite-implementation-2026-10-28/commit-responsiveness/README.md)
still fails: 99,900 vectors take 18.15 seconds and heartbeat p99 is 31.05 ms against 16 ms. Native projection
itself stays near its four-millisecond slice, but 1,088 COMMITs consume 11.32 seconds wall time and about
4.23 seconds of main-thread CPU, without cgroup throttling or substantial run-queue delay. Upstream vec1's
xSync flushes buffered native writers during COMMIT, outside the current projection slice. Its base table also
retains Float32 inputs; database growth during admission is approximately 844 MB. These are attribution
results, not a speedup comparison or acceptance.

The [fixed-model allocation diagnostic](../references/evidence/ears-sqlite-implementation-2026-10-28/fixed-model-allocation/README.md)
compares upstream 16-KiB and 4-KiB `blocksize-min` with unchanged FULL, default checkpoints and canonical
bytes. Both finish the complete query/update matrix with matching paired answers and minimum cohort mean
recall 0.971, but neither establishes the responsiveness gate. The guard paused only our container when other
agents started work, contaminating some timing samples; single fixed-order observations are not causal layout
or peak-resource qualification. The production default stays unchanged. The first harness's REAL/integer
parameter refusal and corrected BigInt preflight are retained alongside the complete report.

The [SQL attribution matrix](../references/evidence/ears-sqlite-implementation-2026-10-28/query-attribution/README.md)
now completes all 18 initial/updated cohorts with phase/query wall markers, canonical-byte verification and
minimum mean recall 0.973. In the warmed updated 10k scope, independent stage medians are 8.87 ms eligibility,
34.28 ms native candidates and 8.02 ms reranking; preparation averages about 0.015 ms/query. Driver execution
and materialization remain combined, so this does not isolate decoding. The live owner still fails admission
responsiveness; differences in model, instrumentation and storage prevent causal comparison with earlier runs.

[Cheaper supported query policies](../references/evidence/ears-sqlite-implementation-2026-10-28/query-policy/README.md)
fail the existing recall gate on the same immutable updated snapshot: 128/32 reaches 0.948, 256/16 reaches
0.915 and 128/16 reaches 0.893, versus 0.974 for default 256/32. No settings or thresholds change. This
updated-only diagnostic retains pause windows and does not replace the full acceptance matrix.
[Upstream native counters](../references/evidence/ears-sqlite-implementation-2026-10-28/native-query-profile/README.md)
then identify metadata scanning as about 51–54% of filtered native timer ticks versus 0.14% unfiltered.
About 665 metadata blocks/query each repeat RHS conversion/allocation. These timer ratios are not CPU time
or complete EARS call attribution. The [supported larger-block comparison](../references/evidence/ears-sqlite-implementation-2026-10-28/supported-large-blocks/README.md)
now completes 16/64/256 KiB on one fixed trained model, with 21,600 queries, verified canonical bytes,
minimum mean recall 0.973 and exact paired answers. Metadata blocks/query decrease, but every variant still
fails responsiveness, including the three timed query passes. Pause-overlapping samples remain in the raw
report; fixed ordering/caches/cumulative RSS prevent causal or isolated-resource claims. No defaults change.
The smaller next native diagnostic is to binary-search the existing query-owned integer RHS directly for
compact metadata, avoiding per-block conversion without a bitmap, new allocations or lifetime state. Require
ordinary-SQLite NULL/full-width/mixed semantics, baseline controls and full scoped query/update/recall/resource
checks before adoption. The [private direct-IN prototype](../references/evidence/ears-sqlite-implementation-2026-10-28/direct-in-prototype/README.md)
passes 735 ordinary-SQLite comparisons per library, then reproduces all 900 updated-snapshot EARS answers/
scores exactly at minimum mean recall 0.974. Its baseline binary matches the package; that package remains
unchanged. This diagnostic does not replace the full initial/update matrix, fresh model owner, platform/
packaging or app acceptance. Deferred COMMIT and unfiltered scanning remain separate responsiveness requirements.
Do not discard paused/outlier samples or relax original gates. Supported allocation controls alone have
not established a solution. Compare write volume, all query scopes/updates/recall, memory and disk before
adopting any layout. A background worker
alternative must coordinate its SQLite writer with synchronous foreground units and qualify worker death,
commit uncertainty, schema/generation changes, maintenance and shutdown. Merely adding a second writer
connection would introduce internal BUSY failures; enlarging slices or hiding fsync changes is not a solution.
The complete uninstrumented workload and original budgets remain required after any implementation.

## Weighted relation primary data

Current-master integration carries a nullable MessagePack weight BLOB alongside relation info. Absence represents the default weight 1; ordinary writes canonicalize explicit 1 to absence and -0 to 0, validate the declared weighted kind and range 0 through 2^960, and include supplied weight in relink identity. Unique relinks replace only supplied parts. Unchecked loads retain primary bytes independently of the current declaration. A temporarily unweighted kind ignores its stored weight without deleting it.

Logical export, staging, restore and transactional replacement carry the weight bytes. Audit/export/restore reject invalid numerical weights. Rank validates positive seed weights, adds repeated seeds and distributes each outgoing share by its effective edge weight; an outgoing weight sum of zero is dangling. Communities pass the effective weights to the owned Leiden core, whose wrapper admits zero. SQL explain reports actual weight projections rather than invented native graph counters. Shared rollback/watch and dormant-weight logical round-trip cases pass in [focused weighted qualification](../references/evidence/ears-sqlite-implementation-2026-10-28/weighted-focused-4ded/README.md) and the [6135 platform suites](../references/evidence/ears-sqlite-implementation-2026-10-28/platform-613/README.md). These precede the counter guard and do not establish final-source performance, packaging or broader storage-fault acceptance.
