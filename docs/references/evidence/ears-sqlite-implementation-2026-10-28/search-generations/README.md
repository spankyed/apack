# Shared background search generations

The candidate uses one persistent index_builds/index_gc catalog and one owning scheduler for value, text,
trigram and vector work. Schema admission publishes empty private generations without primary hydration;
foreground writes reconcile them; batches atomically advance postings, cursor and readiness. Value reads retain
primary fallbacks; search reports INDEX_BUILDING/INDEX_FAILED rather than partial answers. Owners can await
indexesReady(). Readiness invalidates tracked watches without inventing a logical commit, with subscriptions
released on the last watch. Ordinary background timers are unreferenced; explicit readiness waits keep them alive.

Physical search tables/chunks belong to generations. Retirement alternates with builds. Vector reuse requires
matching entity/index/chunk, hash, model and dimensions. Cleanup keeps only the latest complete predecessor
needed by an incomplete replacement; older/partial generations remain collectable and a failed replacement does
not spin. Missing physical groups admit new generations. Recovery advances the schema/index ownership epoch,
not logical commit identity, so another handle cannot write a stale cached value generation. Readiness checks
also recheck the epoch before publishing a wait.

An intermediate pre-owner-guard full check passed 407 SQLite and 250 native cases, twelve safeguard mutations,
five package builds, 3 EARS and 30 SDK API reports, static checks and scripts typecheck (21.3 s / 60 s). Its source
hashes and logs are retained as intermediate evidence, not relabelled as the final source. After the owner guards
and access-path corrections, the pinning checkpoint passes EARS types and 71 adjacent cases. Final full checking
on the committed pin remains required before publication/promotion.

The first 1k OFF short-string smoke passed the prewritten budgets. Three fresh 10k OFF trials also passed;
admission 3.14–3.56 ms, operation p99 1.64–1.86 ms, heartbeat p99 9.55–12.20 ms. The first 100k OFF trial hit its
240 s process safety timeout before a final report. Later OFF/FULL trials did not run. Its exact uncommitted tested
source is reconstructable from base a1356b64b1 plus the retained patch; all 31 source hashes were checked. No
stage marker was emitted, so the timeout does not identify which phase exceeded the deadline or supply a
completed 100k budget result.

Review then found a quadratic path: text backfill deleted by an unindexed FTS column for each entity despite
knowing the FTS rowid. The pinned source uses rowid point deletion for backfill/edits/destruction, with an actual
access-plan regression and unindexed control. Generation cleanup now has selective indexes. Pending-vector
indexing uses a partial index, keeping embedding BLOBs out of secondary keys. The later benchmark adds five
optional stderr stage markers so a future timeout retains useful stage evidence. It does not relax budgets.
See the [FTS5 documentation](https://www.sqlite.org/fts5.html) for virtual-table behavior; the pinned runtime's
actual EXPLAIN plans, rather than a conventional SCAN/SEARCH label alone, establish rowid constraints.

Still required: final full gates on the pin, revised larger/load and FULL qualification, realistic large-text and
app budgets, real I/O/crash/checkpoint/ownership qualification, application readiness handling, search relevance,
vector recall, app/backup/maintenance/platform composition and the final adoption review. Physical presence is
not an integrity checksum. Orphaned derived entries after catalog corruption remain audit/rebuild work. Native
static-index recreation on a populated damaged profile may still run a long CREATE INDEX; 32 rows is not a hard
wall-clock or byte-memory bound, and virtual-table destruction/COMMIT can exceed the cooperative slice.
