# Mixed-type search qualification at fcbe188ba0

[Actual focused run 41237774881](https://github.com/spankyed/apack/actions/runs/41237774881) passes all three new shared regressions on both adapters: global/filtered text search with unindexed types, global/filtered vector search, and hybrid fusion retaining independent text-only and vector-only types.

SQLite passes 185/186 cases with no skips. Elmdb passes 152/153 applicable cases, with 33 SQLite-only skips. Both retain the unchanged text-only `generate-entries` overview judgment failure. This run predates the later empty-scope like-reference correction and the updated ready-native K=64/K=65 boundary test.

The inspected numeric summary retains individual regression outcomes and original report digests; raw reports remain in the CI artifact and private local evidence directory. No broader app/performance/platform acceptance is implied.
