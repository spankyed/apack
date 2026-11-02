# Corrected-source integrated strict results

[Run 41391989615](https://github.com/spankyed/apack/actions/runs/41391989615), source `06106d18ddc61e0792b9faa1f64a302ffe1f7fdd`, is terminal failure. Producer succeeds. This documentation-only descendant of cd8 includes the query dependency correction. No failed gate is suppressed.

| Consumer | Tests pass / fail / excluded | Completed files |
| --- | --- | --- |
| Host | 7,029 / 1 / 95 | 613 |
| Integration-1 | 199 / 1 / 0 reported | 28 of 31; three uncompleted |
| Integration-2 | 580 / 0 / 1 | 31 |
| Native-1 | 26 / 0 / 2 | 9, including one excluded |
| Native-2 | 47 / 0 / 26 | 8, including one excluded |

Host completes in 482.66 s under the unchanged 600 s bound; its only failure remains frozen keyword usefulness. Integration-1 fails the dependency-publication case at its unchanged 200 s deadline, with cause unresolved. Its bail stops three files, which are not counted as passes. Earlier successful integration-1 runs do not override this failure. Passing shard logs retain changed-input/no-reusable-stamp warnings.

The separately executed remaining chain now succeeds, with current producer/freshness guards: all 989 eligible pack units pass, two remain excluded, across 148 passing files/one excluded file; the actual thread-view regression file passes. Packed authoring has seven producer harness passes and two app passes. External-pack app qualification records 32 passing executions (27 fixture cases and five single-case executions across the runner's additional fixture/fork launches). Smoke has five passes. These execute after the retained host failure; they do not turn the integrated run green.

All six independent actual SQLite Electron/storage witness cases pass once, with no exclusions/flakes/retries. Their report survives later Playwright stages in `.apack/qualification/`. Shared engine contracts explicitly select SQLite. Ordinary app stages retain the production default unless explicitly selected; this receipt does not falsely label every app launch as SQLite. The separate [packed authoring](../packaged-061/README.md) and [full app](../full-app-d268/README.md) receipts qualify explicit SQLite selection.

Six original public main file-progress streams are compressed unchanged with decompressed SHA-256. Embedded fixture-run progress is excluded from the main counts. The minimized receipt keeps exact source/counts, per-step original log hashes and six public witness case names. Raw compiler/app logs, Playwright configuration, profiles, traces and fixture payloads are omitted. Platform results have separately recorded scope. This closes the previously unexecuted remaining-stage evidence gap and the full pack watch regression; final integrated acceptance remains incomplete.
