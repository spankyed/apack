# Complete strict consumers after history-policy repair

[Run 41371206316](https://github.com/spankyed/apack/actions/runs/41371206316), source `81e8ab4fe5be727872e36de5853fc49fe5a9e70e`, is terminal. Producer and all four integration/native consumers pass. The overall run remains failure solely at the retained keyword judgment in complete EARS/host validation; three-platform receipts are separately preserved at [platform-81](../platform-81/README.md).

| Consumer | Cases pass / excluded | Completed files | Chain time |
| --- | --- | --- | --- |
| integration-1 | 242 / 0 | 31 | 1,773.1 s |
| integration-2 | 580 / 1 | 31 | 784.8 s |
| native-1 | 26 / 2 | 9, including one excluded | 1,792.8 s |
| native-2 | 47 / 26 | 8, including one excluded | 852.1 s |

All four retain explicit changed-input/no-reusable-successful-stamp warnings. Their test outcomes pass; these warnings are neither hidden nor interpreted as reusable cache qualification. File counts exclude nested fixture Vitest runs. Original public main progress streams are gzip-preserved with decompressed hashes. Step/chain log hashes preserve provenance without publishing raw logs.

The app/rest consumer completes all 613 host files in 518.61 seconds under the unchanged 600-second bound: 7,019 pass, one keyword failure, 95 exclusions; 607 passing files, one failing file and five excluded files. API/package/facade/external-pack-fork gates pass first. Host failure leaves later dependent chain stages unproven. A separate matching app-runtime build and all six actual SQLite Electron smoke cases pass once, without retries/flakes/exclusions. The minimized app receipt omits configuration, paths, profiles, logs and attachments.

This source includes the host CORRUPT refusal repair, but predates the later shared main-window discovery fix. The [full app navigation failure](../full-app-44-failure/README.md) and corrected unit/full-app replay are separate evidence; passing six smoke cases does not override the complete-suite failure. Exact-current fixture/app/installed/signing and remaining relevance/responsiveness/storage requirements remain open. Cross-run duration differences do not prove causal performance improvement or a relaxed budget.
