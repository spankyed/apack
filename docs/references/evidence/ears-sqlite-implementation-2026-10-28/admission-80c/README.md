# Ordinary admission qualification at 80c

[Run 41312905554](https://github.com/spankyed/apack/actions/runs/41312905554) is terminal failure at `80c289ca62f84750d700994e395c5346dfe98181`, pinned elmdb `f496470679a7bd9764398108b20f62a73333c701`. All 24 fresh ordinary processes complete. Value/OFF, search/OFF and search/FULL pass six of six each; value/FULL passes five of six. Tracing is disabled; original watches, work, durability and budgets are unchanged. The only failed budget is 100k value/FULL trial 2 heartbeat p99, 16.3925ms against 16ms. No result is waived.

| Cohort | CPU | 10k heartbeat p99 ms, trials 1/2/3 | 100k heartbeat p99 ms, trials 1/2/3 |
| --- | --- | --- | --- |
| Value/OFF | AMD EPYC 9V74 | 5.45 / 4.90 / 4.64 | 5.59 / 5.65 / 5.85 |
| Value/FULL | AMD EPYC 9V45 | 3.37 / 4.38 / 3.85 | 14.80 / **16.39** / 15.47 |
| Search/OFF | AMD EPYC 7763 | 8.42 / 8.38 / 8.11 | 10.92 / 10.80 / 10.33 |
| Search/FULL | AMD EPYC 7763 | 11.95 / 10.35 / 10.04 | 12.03 / 12.07 / 12.42 |

The three passing cohorts retain all original admission, operation, lookup, turn-wait, heartbeat, WAL and observed disk budgets. FULL value also passes every budget except the one heartbeat miss. Source metadata capture, EARS types and actual loaded native fingerprints pass. Each cohort runs under 2 CPU/6GiB/no swap with matching source/package setup, Node 23.11.1 and SQLite 3.53.4. CPU differences prevent attributing changed measurements to durability or source changes. Earlier 4ded and healthy instrumented samples remain source-specific evidence; these new results neither erase failures nor certify app-wide responsiveness, power loss or long-reader behavior.

Ordinary reports identify periodic retirement/background stalls; a separately labelled [checkpoint-policy comparison](../checkpoint-protocol/README.md) investigates the hypothesis without changing production policy. This matrix did not override wal_autocheckpoint. Its numerical metadata is not fsync/CPU attribution.

Only the explicit inspected filenames in files.json are retained through gzip with original byte lengths/hashes: all 24 numeric trial reports, four matrices and source/image/limit receipts. All workloads are synthetic and reports contain numeric samples, fixture counts and native/source hashes rather than source documents/vectors/database contents. Per-cohort provenance is filtered only to omit host mounts and records the original digest and omission. Duplicate stdout/stderr and uninspected trees remain in the private download/CI. summary.json is an explicitly derived index, not a replacement for raw evidence.
