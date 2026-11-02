# Durable native model scheduler, 2026-10-29

Runtime `89e79463f8` and the retirement/failure-assertion follow-up `bf9738ecf7`
each pass 622 EARS, 135 affected host/storage and fifteen focused native lifecycle
cases, package builds, types, API and static checks in disposable Linux ARM64.
The original stale-result and missing-cursor-index mutations fail their intended
assertions. Two additional controls reverse the shared scheduler acknowledgement order or bypass
attempt matching; both fail the intended assertions, without a timeout. Raw outputs, exact archive source receipts, extension provenance,
resource/mode-denial checks and runners are retained under `initial/`, `retirement/` and `controls/`.
No daily Mac compiler or other-agent build output was used.

The shared index scheduler now owns durable pending/training/trained/projecting/ready/
failed transitions. Attempts get UUIDs and commit before a read-only worker starts.
A bounded completed result stays in memory until its persistence transaction commits;
rollback retries the same result. Generation and attempt checks discard obsolete replies.
Stored models carry their hash and worker/native/source identities. Explicit exclusive-owner
recovery restarts abandoned attempts; committed models resume projection after reopen.
Only one model owner may attach to a connection. Stop detaches scheduled work immediately,
then drains the worker before ownership is released. The host must await this drain before
file replacement/deletion once normal composition enables the service.

Projection advances 32 rows per short scheduler transaction. Native readiness joins existing
readiness/watch delivery without logical commits. Retired native rows are collected in bounded
batches before triggers/table/catalog removal; a startup sweep handles catalogs whose logical
GC completed without an attached model owner. Canonical embedding bytes remain authoritative.
Tests cover schema retirement, retained bytes, reopen, explicit retry, owner exclusion, worker
drain, result rollback, injected shared-scheduler COMMIT refusal and obsolete attempt replies.

This remains an inactive internal candidate slice. It does not establish automatic admission,
incumbent-preserving model refresh, final EARS owner aggregation, native packaging/signing,
audit/rebuild/restore integration or real-corpus responsiveness/recall acceptance. Original
vec1 is used here; no benchmark membership patch or private corpus/model is checked in.
The production path remains elmdb and the current integrated SQLite vector query still
misses broad responsiveness. Full final Strict/platform/app acceptance remains open.

## Actual EARS candidate routing

Runtime `fa0362f0af` passes 623 EARS, 135 affected host/storage and sixteen focused
native cases, builds/types/API/static checks and all four mutation controls. The
`query-routing/` receipts retain exact source/provenance/results. Large eligible queries
now ask the attached ready model owner for bounded native candidates, expand repeated
chunk owners, and rerank every selected owner's current canonical chunks with stable
sequence ties. Eligibility is reapplied during reranking. Small scopes and large K
remain exact; an absent/unready owner or insufficient distinct native owners retains
the ordinary binary-owner path. Normal app composition still does not activate models.

The new 4,608-vector EARS test proves actual native invocation, current top-hit scoring,
scoped and large-K fallback, and own-unit trash/rollback visibility. It is a functional
fixture, not representative recall, multi-chunk quality, latency or heartbeat acceptance.
Further multi-chunk/tie/filter/freshness qualification, physical model refresh and native
packaging remain required. The host import path inspected here replaces data logically
inside the open connection; it does not physically swap that handle's files. Future
physical replacement/deletion owners still must await worker drain.

## Multi-chunk owners and platform follow-up

`666aa6e0c9` passes 624 EARS, 135 host/storage and seventeen focused native cases,
plus builds/types/API/static and the existing four mutation controls. The new case adds
300 chunks on one owner, verifies expansion through 512 and 1024 native candidates,
stable owner ties, a 4,500-owner SQL scope, like exclusion, advisory candidate distances,
and changed-content invalidation/rollback. `89539dda3e` strengthens this to include an
opposite-direction chunk on that owner and passes all seventeen focused cases/types.
Two further mutations stop expansion at 256 or score owners by their worst chunk;
both fail intended assertions. `owner-contracts/` and `owner-controls/` retain the receipts.

[Platform 40967406799](https://github.com/spankyed/apack/actions/runs/40967406799)
is terminal on `88b05e0bfa`: Linux x64/macOS ARM64 pass with 622 EARS cases and complete
platform verification. Windows passes 621 EARS cases (one POSIX-only skip), including all
fifteen then-existing native cases, and reaches linker verification; its new preflight
incorrectly inspects both MSVC and Git command paths instead of the first executable.
It refuses before building the native producer. This does not qualify the later Windows
conversion/crash gates. The correction explicitly selects the first command in execution
order, requires MSVC and sets Cargo's target-specific linker to that exact path. See
[PowerShell command lookup](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/get-command).
A new platform run must qualify the correction and seven current durable-model cases.
Artifact receipts/hashes and text results are retained without copying native binaries.


[Platform 40969207041](https://github.com/spankyed/apack/actions/runs/40969207041)
passes all three hosts on `ae156ce242`: each executes five generation, five worker and
seven model cases and completes native producer conversion, five profile process-kill
boundaries and final platform verification. Linux/macOS pass 624 EARS cases; Windows
passes 623 with one POSIX-only skip. Host counts are 135 Linux/macOS and 122 Windows;
Windows explicitly skips published-directory sync coverage. Linux additionally verifies
one native baseline/API boot, two converted SQLite boots, three live pack updates and
restart preservation. The Windows linker correction is exercised successfully. Text
receipts, per-host native binary hashes and detailed verification are retained under
`platform-40969207041/`. This is not Electron/signed installation, arbitrary filesystem,
performance or full Strict acceptance. Later benchmark/profiler-only commits are not
retroactively described as tested by this exact run.
