# All three platform contracts on the 64-probe implementation

All three platform jobs in [strict run 41503546216](https://github.com/spankyed/apack/actions/runs/41503546216) succeed at `93ed37e67f40faee3fd25a10f3b897c15e55c858`. Original JSON reports and actual final verification guards agree. The overall strict consumers remain separate unfinished gates at this checkpoint.

| Platform | EARS passed/excluded | Host passed/excluded | Recovery passed/excluded | CLI passed/excluded |
| --- | ---: | ---: | ---: | ---: |
| Linux x64 | 946 / 0 | 313 / 0 | 12 / 0 | 41 / 0 |
| macOS arm64 | 946 / 0 | 313 / 0 | 12 / 0 | 41 / 0 |
| Windows x64 | 942 / 4 | 310 / 6 | 2 / 10 | 41 / 0 |

No unexpected failures occur. Windows exclusions retain their existing POSIX FIFO/process capabilities. Linux also passes 1,330 SDK, 78 package-build coverage and seven API-startup cases. Each OS passes two SDK backend and nine repository-query cases. The actual-driver probe-option assertion runs inside the complete EARS suite.

The receipt records actual job conclusions, exact assertion/exclusion counts, job metadata hashes and final guards. Original JSON is compressed unchanged with decompressed SHA-256. The Linux contract inventory independently maps 2,630 passing assertions from EARS/host/SDK/CLI to 204 unique source fixture files and their hashes; it is a runtime coverage inventory, not compiler or installed-app evidence. Signing, packaged loading, full source-app, faults and whole strict consumers retain their own source scopes.
