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
