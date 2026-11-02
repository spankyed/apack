# Corrected-source strict native and integration consumers

[Run 41483924153](https://github.com/spankyed/apack/actions/runs/41483924153), source `a8500818f6d580dd061fd6bfdb6dffb735da2137`, completes native-1, native-2, integration-1 and integration-2 successfully. Actual job conclusions, completed progress records and chain logs agree. The producer and all three supported-platform jobs separately pass. App-and-rest is still live; this is not an overall strict completion claim.

| Consumer | Repository files | File states | Nested fixture files |
| --- | ---: | --- | ---: |
| native-1 | 9 | 8 passed, 1 existing skipped file | 0 |
| native-2 | 8 | 7 passed, 1 existing skipped file | 0 |
| integration-1 | 31 | 31 passed | 4 |
| integration-2 | 31 | 31 passed | 0 |

The progress reporter records files, not individual assertions; no per-test counts or zero-per-test-skip claims are invented. Integration-1's four additional ended records come from generated timing fixtures and are separated from repository integration files. Its previously timed-out dependency-publication file now passes in 158.56 s. The test is byte-identical to source 06106d18dd, including its `3 * 60_000 + 20_000` (200-second) deadline. This closes the current attempt; earlier timeout/replay evidence remains preserved, and no stable timing or causal fix claim follows from one observed pass.

Progress is normalized to public repository paths; nested fixture paths become ordinal labels. Gzip checksums refer to decompressed minimized progress. Original per-process progress, chain/job logs and job-metadata hashes are retained in the receipt. Raw logs, process identifiers, private temporary paths and generated profiles are omitted. Whole strict/app-flow/full-app gates remain separate.
