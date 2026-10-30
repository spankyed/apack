# Native projection audit and owned rebuild

The private Linux source overlay is based on published `4903c50a4a39bba91c8dff495d54764e1472ff18`,
integrated master `5e81dda7c2055a7fd10d4d7ee2bd94311473ac9d` and native
`95615ed8d493f9a7c2789eaf1f4c847ae375eb32`. `final-source.json` records validated/final input hashes.
The existing private volume and exact native binding are reused; no shared-agent outputs or Mac compiler run.
Matching packages and broad checks use 2 CPU / 6 GiB with no swap; focused controls use 0.5 CPU / 768 MiB.

**676 EARS cases pass with zero skips**, plus **98 host backup/import cases**, **seven API lifecycle cases**,
EARS/host/API types, ordinary matching packages, API report generation/check, boundaries and changed correctness
lint. Final LF-normalized API reports are rechecked without recompiling, and all restored runtime hashes match.
The historical handoff's relative links are repaired afterward, recorded as a documentation-only hash change.

Ten native audit/rebuild cases check healthy/trash projections without modifying source; missing native rows,
wrong owners/visibility, model-hash drift, altered triggers, damaged native page membership, lost catalog ownership,
partial-prefix completeness, offline derived rebuild with canonical bytes/commit unchanged, and refusal before
admission when another handle owns native work. An additional real-worker case verifies training drain and
retained service resumption across a logical rebuild. The platform verifier requires all ten audit cases and
all 35 model cases; a missing test file cannot silently pass the gate.

Three reverted-code controls each fail exactly one selected case: omit native owner/visibility comparison,
remove native rebuild suspension/claim, and keep the old native epoch. Source is restored in finally blocks,
then every validated runtime input is hashed again. `negative-controls.json` records the expected failures.

Original failures are retained. `initial-fixture/` catches a wrong test facade call, corrected to the write
builder. `initial-retirement-assumption/` records the preexisting fixed-100-step assertion failing after rebuild
starts legitimately retiring the old model. `initial-retirement-wallclock/` records an unsuccessful replacement
five-second wait. The retained diagnostic demonstrates **81 progress batches remove 2592 of 4608 native rows,
with 2016 remaining**, with no scheduler stop or new model enqueue. The final correctness assertion permits
finite work bounded by the corpus size and checks idle state/no failed-generation enqueue; it is not a latency
gate. This diagnostic is evidence of slow bounded retirement, not a responsiveness pass. The separate frozen
16 ms heartbeat and other performance/resource requirements remain unchanged and unfulfilled.

Audit compares pinned native storage to canonical normalized embeddings and owner visibility, validates exact
trigger SQL and model hashes, and reports orphaned tables/shadows. Existing SQLite/vec1 integrity checking
also catches native page membership damage. `comparedNativeModels` reports inspected groups; it may be zero
when earlier primary/logical checks fail. Native row scans remain in SQL; this is not a measured peak-memory,
SQL temporary-space or malformed-binary safety certification.

Public rebuild holds the native claim through suspension, atomic epoch invalidation/new logical generations,
logical readiness and bounded retirement. Offline rebuild starts no service; an existing service resumes.
This does not yet repair every missing/corrupt native structure, grant arbitrary physical rename/delete
authority, qualify noncooperating writers/filesystems or certify signed installed apps. Those requirements,
final combined/platform/installed and performance acceptance remain in the active goal. Production stays elmdb.

Logs strip trailing whitespace/blank EOF lines; JSON reports remain unchanged except the explicitly extended
final-source provenance. Corpus/model payloads, dependencies and compiled binaries remain private.

[Exact-source full strict and platform receipts](platform-41052678824/README.md) now qualify this checkpoint on all three CI hosts. Later repair/packaging edits and performance/installed signing remain separate.
