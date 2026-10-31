# Live native-model maintenance

Qualification uses base `95515e64637878681a33bea300ab4a0dae2b2e4c`, exact native pin
`95615ed8d493f9a7c2789eaf1f4c847ae375eb32` and the changed input hashes in `final-source.json`.
The isolated Linux ARM64 volume builds matching packages and the shipped pack with 2 CPU / 6 GiB and no
swap. Focused tests/negative controls use 0.5 CPU / 768 MiB. No host compiler or shared-agent outputs run.

- All **665 EARS** cases pass, zero skips; all **141 API** cases pass, zero skips.
- Full host suite: **1898 pass, one Windows-only embedded-drive probe skipped**, 142 files.
- EARS/host/API types, generated API reports, boundaries and changed-file correctness lint pass.
  The final LF-normalized API report is checked without rebuilding and original runtime hashes are verified.
- Eight new model cases cover actual worker drain, retained ownership and nested suspension, live logical
  backfill, epoch invalidation/rollback, reset and close/removal, failed resumption, offline claims, leaked
  units, stale declarations and cleanup/reopen after a real committed-but-unacknowledged write.
- Real host import tests run 4097 embedded 128-dimensional incumbents with managed workers through success,
  acceptance refusal and media-copy I/O failure; both stores, media, owner exclusion and subsequent writes
  are checked. Additional tests retain recovery copies on background/settings cleanup failure, preserve
  both errors, order completion after resumption and suppress success announcements while closing stores.
- Four reverted-code controls each fail exactly one selected test: omitted replacement epoch invalidation,
  a health guard preventing unknown-commit cleanup, missing offline ownership and discarded recovery copies.
  Source is restored in finally blocks and all runtime hashes match afterward.

`integrated-results.json` retains command outcomes, including the initial API fixture failure and native
fixture rebuild failure. The first API run lacked Linux node-pty (seven failures); rebuilding with the
container's installed Node headers fixed the fixture. The default header download/extraction failed under
dropped capabilities; `npm_config_nodedir=/usr/local` avoids that path. No product workaround was added.
Final `all-api.*` records the corrected run; the seven original API failures are described here rather than
retained as a separate raw report. `initial-settings-fixture` from earlier focused work remains private.
The resume helper initially omitted its Vitest command variable; it was corrected before the resumed checks.

Retained log files strip trailing whitespace/blank EOF lines; JSON reports remain byte-for-byte.
This is private Linux source-overlay evidence. Final combined CI, signed installed lifecycle, native
maintenance/publication authority, performance/recall/WAL/resource and filesystem fault gates remain open.
The prior published commit's all-platform/full strict qualification is retained separately in
[physical refresh](../physical-model-refresh/platform-41040846758/README.md). Production remains elmdb.

[Exact-source platform receipts](platform-41050219130/README.md) now qualify live maintenance on all three CI hosts. The full strict run has an unresolved bundled-editor app test failure; platform success does not qualify the complete chain.
