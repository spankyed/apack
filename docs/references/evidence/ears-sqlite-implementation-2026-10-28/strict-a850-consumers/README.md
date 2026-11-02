# Corrected-source strict native and integration consumers

[Run 41483924153](https://github.com/spankyed/apack/actions/runs/41483924153), source `a8500818f6d580dd061fd6bfdb6dffb735da2137`, completes native-1, native-2, integration-1 and integration-2 successfully. Actual job conclusions, completed progress records and chain logs agree. The producer and all three supported-platform jobs separately pass. App-and-rest now also succeeds; the entire strict run is terminal success, with all nine jobs successful.

| Consumer | Repository files | File states | Nested fixture files |
| --- | ---: | --- | ---: |
| native-1 | 9 | 8 passed, 1 existing skipped file | 0 |
| native-2 | 8 | 7 passed, 1 existing skipped file | 0 |
| integration-1 | 31 | 31 passed | 4 |
| integration-2 | 31 | 31 passed | 0 |

The progress reporter records files, not individual assertions; no per-test counts or zero-per-test-skip claims are invented. Integration-1's four additional ended records come from generated timing fixtures and are separated from repository integration files. Its previously timed-out dependency-publication file now passes in 158.56 s. The test is byte-identical to source 06106d18dd, including its `3 * 60_000 + 20_000` (200-second) deadline. This closes the current attempt; earlier timeout/replay evidence remains preserved, and no stable timing or causal fix claim follows from one observed pass.

Progress is normalized to public repository paths; nested fixture paths become ordinal labels. Gzip checksums refer to decompressed minimized progress. Original per-process progress, chain/job logs and job-metadata hashes are retained in the receipt. Raw logs, process identifiers, private temporary paths and generated profiles are omitted. App-flow/full-app/final performance gates remain separate from this now-successful complete strict run.

## Complete strict app/rest result

App/rest passes API/package/facade checks; host has 7,040 passing cases and 95 unchanged exclusions across 613 files (608 passed/five skipped). Pack has 989 passes/two unchanged exclusions across 149 files (148 passed/one skipped). Published authoring has seven producer tests and two app cases; external app groups total 32 cases, the independent fork step succeeds, and all five smoke cases pass. Six explicit real SQLite app/storage witnesses pass once with no failures/exclusions/flakes/retries; their public outcomes are minimized in the receipt, with the original full report hash and no configuration/profiles.

Host pool time is 585.1 s under the unchanged 600 s limit, leaving 14.9 s observed headroom. Two individual 15-second size-budget excursions remain reported diagnostics; actual test/pool deadlines were not relaxed. This pass establishes the measured cohort, not stable future CI timing. The earlier keyword failure and dependency timeout remain dated evidence. Normalized app/rest progress and raw-log/report/job hashes preserve the source/provenance boundary without publishing raw logs.
