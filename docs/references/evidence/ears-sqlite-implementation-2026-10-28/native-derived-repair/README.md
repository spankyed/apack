# Transactional repair of native derived groups

Private Linux qualification overlays exact published `212b819db6f505a87e44cc93cb3d3d0967c424e8`, with
integrated master `5e81dda7c2055a7fd10d4d7ee2bd94311473ac9d` and native
`95615ed8d493f9a7c2789eaf1f4c847ae375eb32`. `followup-source.json` identifies broad and final inputs;
`bundled-editor-diagnostics.json` separately identifies the failure-only test diagnostic input.
The existing verified private volume/native binding is reused. Compiler/broad checks use 2 CPU / 6 GiB
with no swap, only while no other container is running; focused checks/controls use 0.5 CPU / 768 MiB.
No Mac compiler, shared-agent output or production profile runs.

The broad overlay passes **690 EARS cases, zero skips**, **98 host backup/import cases**, **seven API
lifecycle cases**, EARS/host/API types, ordinary matching package builds, generated API reports, boundaries
and changed correctness lint. Afterward one extra malformed-model case is added: **all 25 native audit/repair
cases pass with zero skips**, EARS types pass again, normalized API reports recheck and runtime hashes agree.
The final changes after the broad run are the additional test, CI expected count and report normalization;
product runtime inputs remain identical. Intermediate focused reports are developmental witnesses, not the
final-source qualification. Four reverted-code controls each fail exactly one selected case, restore source
in finally blocks and verify every final input hash afterward.

Repair runs inside the owned rebuild admission transaction, after actual worker drain and before retiring
healthy models. Raw shadow structure/model identity checks precede native integrity, avoiding native parsing
of malformed model bytes. Native semantic/page drift, missing triggers/tables/models/shadows, wrong shadow
schema, and orphaned/catalogless groups are diagnosed as disposable derived storage. Verified damaged groups
use the pinned vec1 xDestroy path, which drops shadows without loading model/config payloads. Healthy groups
keep bounded 32-row retirement; damaged-group DROP has no claimed latency bound.

Tests preserve exact canonical embeddings and logical commit identity through repair; prove refused COMMIT
and I/O after native DROP roll back repair/admission together; and inject an actual committed repair whose
acknowledgment fails. That handle is quarantined, then reopened to inspect/recover persisted state without
blind replay. Integrity I/O does not authorize deletion. Unsafe catalog IDs and foreign tables in the native
namespace refuse without guessing ownership. This is not arbitrary physical file salvage or permission to
rename/delete a store under unmanaged writers.

Controls omit repair, ignore native page damage, convert I/O into permission to discard and remove the foreign
table guard. Each is rejected by its corresponding real test. Final platform verification requires all 25
native maintenance cases and 35 model cases. Platform/installed, physical-publication, filesystem/resource,
signing and unchanged performance gates remain required. In particular the 16 ms heartbeat gate is not relaxed.

The preceding live-maintenance source has [all three platform receipts](../live-model-maintenance/platform-41050219130/README.md),
but its [bundled-editor app assertion fails](strict-app-41050219130/README.md). This failure is unresolved;
console-only evidence does not prove cause. Diagnostics change neither the assertion nor its timeout.
The original full strict run must finish, and queued `41052678824` must start before another full strict is
queued, to avoid replacing GitHub's pending slot. A focused bundled-ui diagnostic run is still required.

Logs normalize trailing whitespace/blank EOF lines; JSON and test trace are retained without rewriting.
Corpus/model payloads, dependencies and compiled binaries stay private. Production remains elmdb.

[Exact repair-source full strict and all three platform hosts pass](platform-41056724109/README.md). Later packaging/signing changes require separate qualification.
