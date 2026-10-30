# Trusted native connections and shared candidate selection

2026-10-30. Base `6509f4ed39e3bc23b00aaa05a2470007dd278674`; `inputs.json` pins the
tested overlay. All validation runs in private Linux ARM64 containers limited to two CPUs,
6 GiB, zero extra swap and dropped capabilities. Image:
`sha256:0146a4490634fe153ec35c63e7075a4b3e31b1d1a2996d29c77506c5d07b6507`.
No working-agent checkout/output, daily profile or Mac compiler is used.

## Implemented

The app-only SQLite constructor accepts `nativeVectorExtension`, an absolute executable path
supplied by the application owner. It loads once on that connection before constructor schema/data
writes; a second different path refuses `NATIVE_CHANGED`. Relative paths refuse `VALUE_INVALID`.
Database metadata cannot select this path. Direct internal index/model owners register their same
trusted loader, so export, audit and replacement-source connections can inherit it from the owner.
Copies never obtain executable paths from the copied data.

Ready native candidates are now available to separately opened readers and writers without creating
a training owner. A shared selection function preserves the existing 256-owner budget, bounded
chunk expansion, current canonical reranking and ordinary owner fallback. Lazy candidate attachment
uses the existing native catalog/index; read-only handles perform no native model DDL. Writable
connections load the module before persistent vec1 triggers can execute. Training and durable job
ownership remain separate, with no peer trainer implicitly created.

## Evidence

All **637 SQLite EARS cases pass**, zero skips, including all sixteen durable model cases. New
coverage exercises an actual native EARS read on a separately opened read-only handle, read-only
write refusal, independent writer trash/rollback, newly embedded peer data visible to the reader,
unchanged durable training attempts, path refusals, and private native-bearing export/audit copies.
Existing owner-expansion, scopes, ties, exact fallbacks and own-unit tests remain in the full run.
Types, import boundaries, correctness lint, normal package build and API generation/check pass.
The generated API diff adds only the app-only trusted loader option; root/LMDB reports are unchanged.
SQLite report CRLF output is normalized to the repository’s LF convention without textual edits;
API Extractor checks the normalized report successfully, with both hashes retained.

Two controls each fail their intended test: omitting early connection loading prevents native
candidate calls; omitting audit-copy loader propagation reproduces `no such module: vec1` while
rebuilding a native-bearing copy. Candidate bytes are restored and hashed. `controls.json` records
actual failing assertions. The initial new test incorrectly read the facade builder's `id` method
as a value; calling `id()` fixes the test, and its failed report is retained. No product assertion,
query behavior or deadline is relaxed.

The source suite first completed, then API generation correctly refused stale package prerequisites.
The follow-up builds packages before API generation/check and runs only those outstanding checks;
it does not repeat passing source tests. Both command histories are retained. Historical runners
resume private `ears-auto-admission-work` with the recorded overlay and read-only native/extension
mounts; they are command evidence, not self-contained images. Gzip hashes cover retained reports.

## Remaining scope

This adds a trusted connection option, not packaged-artifact resolution/signing or normal host model
owner creation. Unconfigured connections are not certified writers of a model-bearing store; normal
composition still needs to supply the trusted artifact to every connection. Idle cross-process watch
notification, exclusive worker recovery, physical model refresh, complete native maintenance/audit
and host drain remain required. The audit test covers loader propagation and existing primary/derived
audit behavior, not exhaustive native model integrity. Physical faults, installed app coverage,
full query/relevance/recall and latency/resource budgets remain in the goal.

These SQLite source checks use the earlier recorded base-plus-own-unit-patch elmdb binding only as
an unused backend dependency. They do not qualify current native pin `006d6cec88` or establish exact
combined platform/full Strict success. The unchanged 16 ms heartbeat limit remains failed in the
most recent real 100k admission probe; this work makes no performance acceptance claim.
