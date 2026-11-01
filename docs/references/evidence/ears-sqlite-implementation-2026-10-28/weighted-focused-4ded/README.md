# Corrected current-master weighted integration

[Run 41249427239](https://github.com/spankyed/apack/actions/runs/41249427239), source `4ded696f7996df36d40486b61bedc34461d972ba`, builds matching native pin `1849f6899e3d707ac8e25e7f81fa52b472b2a9a0`, produces packages/API with an empty generated patch and executes the shared contracts on master `8e2d334e2b`. This corrects the truncated-module build failure at 6c3087ebea; that earlier run executed no database tests.

SQLite passes 230 with one failure and no skips. Elmdb passes 195 with one failure and 35 SQLite-only skips. Both failures are the unchanged generated-metadata overview relevance judgment. The run remains a failed gate.

All seven weighted shared cases pass on both engines: default/read weights, invalid weights/unweighted refusal, unique and parallel relinks, edits/loads, rank-watch commit/rollback, weighted seeds/explain and weighted communities. SQLite's dormant weight bytes survive real logical export/stage/restore and redeclaration; the existing raw weighted round-trip/replacement cases also pass. Shared graph/watch/model/search and scope contracts pass within the selected suite. This does not execute the complete platform native suite or the standalone malformed-seed helper regression.

The dedicated ready-native routing witness passes (one selected case, 35 unselected). Both actual WAL modes cover writes, units, bulk loads and schema changes plus a rejected disabled-injector control. Package/subprocess ownership passes. Process death and injected post-sync EIO are not physical power-loss certification.

The inspected summary contains individual weighted dispositions and raw digests, not compiled outputs, private payloads or filesystem claims. Current-source admission/load, full native/platform/host/CLI/conversion lifecycle, strict/signing, performance/variance and the remainder of the original goal remain required.
