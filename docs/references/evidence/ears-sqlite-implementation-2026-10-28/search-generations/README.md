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


## Pinned checks and corrected load cohort

Functional pin **ac84b7d3fb4dba6b6c460ea5163096c4a1a1cdb1** passes **413 SQLite / 250 native tests**, EARS types,
71 adjacent cases before/after eighteen routine safeguard mutations, five package builds, 3 EARS / 30 SDK API
checks, 64 build-input cases, lint/import rules and scripts typecheck (20.95 s / original 60 s). Only the EARS root
API report changes: readiness method, optional visibility subscription and two error codes. SDK reports do not
change. Earlier affected SDK/host/API/CLI typechecks also pass; the newer private SQLite fixes do not change those
public signatures. Final CI must still cover the exact published descendant.

The paired-epoch counterexample additionally removes both the stored epoch bump and its local increment, so the
fresh owner remains internally valid. It fails because the stale writer **does not throw**, demonstrating the
actual missing-invalidation hazard rather than just making the fresh owner's epoch inconsistent. Both negative
variants are retained. The corrected cohort source hashes match the functional pin after restoring that mutation.

All three corrected 10k OFF trials pass: build 2.57–2.81 s, admission 3.19–3.32 ms, heartbeat p99 3.41–7.78 ms.
The earlier instrumented 10k build median was 9.07 s; the corrected median is 2.58 s. The change set includes FTS
point deletion, cleanup access paths and sparse diagnostic markers; this is an observed whole-fixture result,
not a claim that one isolated line alone explains the ratio. Foreground work continues throughout.

All three corrected 100k OFF processes complete (the prior source timed out). The first two pass every limit;
the third fails **heartbeat p99 26.43 ms against 16 ms**. Its operation / lookup / turn p99 are 1.22 / 8.06 / 5.34 ms;
observed WAL/files stay within original limits. Build times are 40.7–43.5 s and cleanup 39.0–57.1 s under concurrent
foreground work. The planned FULL trial was **not run** after this miss. The controller exits successfully after
retaining data; that is not a passing qualification result. Individual profile exitCode/passed fields are authoritative.

The failed sample's batch p99 is 1.62 ms during build and 1.81 ms during cleanup, with rare larger batches. Its
lookup tail, file reads and cleanup time also increase. Conservative bounds reconstructed from the reset-deadline
algorithm and stage markers place 180 of its 196 stalls above 16 ms entirely within cleanup (6 within build, 10
unassigned). Clipped zero-delay samples widen the time bounds by about 7.1 seconds; the analysis accounts for
that uncertainty rather than inventing exact timestamps. This localizes most stalls to the cleanup phase, but does
not identify a callback, SQLite merge/checkpoint, cache pressure or host contention as the cause. The retained
`heartbeat-phase-bounds.py.txt` reproduces these bounds. Next gather correlated batch/foreground/watch/heartbeat spans and distinct
idle/workload controls before tuning. Do not repeat the qualification until green, waive the sample, shrink the
fixture or relax the target. Large text, real app budgets and FULL qualification remain open.

Terminal logs/reports are byte-preserving gzip files; source hashes, cohort summaries and exact scripts are plain
JSON/text. Source-only source patches reconstruct the initial uncommitted timed source; the corrected source is
an ordinary committed pin. No daily profile or mutable native build from the other agent was used.
