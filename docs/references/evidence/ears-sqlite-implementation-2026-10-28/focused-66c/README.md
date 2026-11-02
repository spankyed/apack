# Focused driver qualification of relation streaming and audit spool

[Run 41296507159](https://github.com/spankyed/apack/actions/runs/41296507159) is terminal failure at `66c20fb4da30687712c2be0be3aa3f6cb1d30fc6`, native f496470679a7bd9764398108b20f62a73333c701, Linux x64/Node 23.11.1. SQLite passes 413 tests with no skips; native passes 262 with 151 SQLite-only exclusions. The only failure on each backend is the original `generate-entries` keyword judgment. No waiver is applied.

All five new real-driver witnesses pass: ordinary relation identity first-match/refusal/exhaustion cursor closure; 512 distinct keys grouped without collision comparisons and one true duplicate; forced fingerprint collisions without false duplicates; failed-spool close/removal with primary error and writable-source preservation; actual MessagePack/dense-array/key semantics including nonreflexive NaN. All existing required model/watch, Map/value/projection, schema and graph witnesses also pass.

Matching package generation, source/test typechecking and public API checks pass with a zero-byte patch. Graph/native routing, subprocess ownership and both persisted-WAL acknowledgement/error regimes pass. Matching-producer copied-profile conversion again passes all five groups, exercising private audits with the new spool and preserving source/commit/data contracts at the recorded scope.

This qualifies the changed relation algorithm on this driver/runtime. It is not a high-multiplicity maintenance time/memory/disk result, all-platform/signed/installed qualification or a responsiveness/keyword acceptance waiver. The resource probe prepared after this source remains unexecuted; its controls use fake children only. Ordinary repeated absent-key insertion still scans endpoint groups.

Compressed complete numeric reports/logs/source/native pins and decompressed SHA256 hashes are preserved. Native's additional five exclusions are exactly the new SQLite-specific regression cases, not omitted shared contracts.
