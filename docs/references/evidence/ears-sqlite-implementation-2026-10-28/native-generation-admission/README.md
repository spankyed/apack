# Native generation admission slice, 2026-10-29

The first actual EARS-backed storage slice is `src/sqlite/vector-index.ts`, not a new
backend factory or a benchmark implementation. It is internal and **not activated by
normal app composition**. Automatic training, scheduler ownership, final owner reranking,
normal native packaging/loading and complete qualification remain unfinished.

Source `b654f8050b` passes all **610 SQLite EARS cases**, packages build, EARS types,
API report and lint/import checks in capped disposable Linux ARM64. The initial source
stopped at a fixture type error (an internal index name supplied to the public embedding
API); the corrected fixture uses its public shape. The later `5ecb60b12b` adds a fourth
read-only backup/reopen case; all four focused cases and types/build pass. The entire
suite was not repeated solely for that added test; implementation source is unchanged.
All failed and passing receipts remain retained.

The class installs a private native table and immutable model identity inside its
caller's writer transaction. Triggers capture ordinary EARS chunk changes and trash
updates in the same transaction as primary data. A bounded cursor backfills existing
vectors and publishes readiness without incrementing the logical commit. Admission
refusal/rollback removes the model/table/triggers atomically. Retirement refuses a
nonempty group. Only a trusted owner supplies the extension path; data cannot select
executable code. Canonical vectors remain in ordinary primary storage.

Actual EARS writes prove updates behind the cursor, insertion during admission,
multiple chunks, owner scopes, nested/outer rollback, trash/restore, changed-content
replacement and destruction. A physical compacted EARS backup reopens read-only and
returns the same native candidates and logical sequence. Four deliberate mutations
(remove update capture, remove trash capture, exceed the batch bound, publish early)
fail at intended assertions. This does not prove every import/audit/rebuild/watcher or
cross-platform path. The candidate method returns chunk candidates, not final EARS hits.

These runs compile the **original** pinned vec1 source, separating lifecycle correctness
from the scratch membership patch. Raw compile commands/source identity are retained;
the binary hash was not captured in these runs. Earlier patch receipts do not substitute
for that missing binary provenance. Native source/patch/binary receipts must be mandatory
in the integrated build/platform gate before adoption. No default loader or dependency
was added, and the existing cross-platform green on 5ddcf922b7 predates this new class.

One local expensive container at a time: two CPUs/6 GiB/no swap, dropped capabilities
with actual mode-denial. Dependencies are private copies reconciled against the lockfile;
other-agent source/targets remain untouched. No daily Mac compiler execution occurred.

Next implement persistent automatic model admission and background training without a
long-held writer; bounded projection work and intervening mutations use this lifecycle.
Integrate canonical owner aggregation/reranking, model freshness, readiness/watch signals,
retirement, audit/rebuild/restore, failure/reopen and normal signed native distribution.
Then run the frozen fresh corpus protocol and complete integrated/platform/full Strict
gates. This storage slice completes none of those missing requirements by itself.
