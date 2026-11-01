# Built-package relation audit resource protocol

The probe runs three fresh child processes for each of two synthetic fixtures: 50,000 distinct keys with 64-byte info payloads, and 10,000 distinct keys with 8KiB payloads. Each child imports the matching dist JavaScript, creates a fresh store, streams checksums before/after audit, requires unchanged relation bytes/commit identity and all expected audited rows, then drains/closes naturally. No user profile or real-corpus payload is involved.

The existing focused CI route gates this measurement on all named real relation correctness witnesses. It runs in a read-only workspace, network-disabled disposable container under verified 2 CPU/6 GiB/no swap. A separate parent samples owned source/audit/spool logical file sizes every 10ms, records observed peaks, joins each child exit and removes owned scratch. These samples are not exact allocated-disk peaks. Child before/after audit memory/CPU/cumulative maxRSS is captured before post-verification/provenance allocations; setup/source checksum work and native caches are part of the process, so this is not isolated engine allocation. Only the pre-audit baseline forces GC. syncs=false is explicit; no durability or full app-resource qualification follows.

All six children and their actual addon/compiled-input/source/phase metrics must be complete. Nonfinite/missing metrics, unexpected exit/source/driver/fixture, missing rows, sampling failures and cleanup failures refuse. Failed child reports/log tails are preserved before root deletion; a thrown undefined is still failure. Partial reports stay incomplete, with no automatic retry.

Protocol controls, from the repository root:

```sh
node docs/references/evidence/ears-sqlite-implementation-2026-10-28/relation-audit-resource-protocol/control.mjs
```

The actual parent is exercised with fake child emitters and tiny owned files: complete six-process flow passes, nine bad-exit/source/driver/phase/number/compiled/row/sampling/undefined cases refuse, and every root is removed. No real child, native database, container or large fixture runs on the host. These controls are not resource results. Actual capped built-package execution remains pending.
