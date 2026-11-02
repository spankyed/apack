# Isolated Windows model qualification

[Run 41290696363](https://github.com/spankyed/apack/actions/runs/41290696363) is terminal success at source `592c1efac794b47631c9bb314e33c625c5e7b320`, native `f496470679a7bd9764398108b20f62a73333c701`, Node 23.11.1, Windows x64. Matching packages build and EARS typechecking pass before execution. The report contains three passed cases, zero failures and zero skips:

- Actual SQLite backend and independent empty-store witness: 89.07ms.
- All original 120 random workloads and comparisons: 13,832.71ms.
- All original 40 watch workloads and comparisons: 25,218.82ms.

Each model retains its original 30,000ms deadline. No automatic retry or reduced workload is configured by the focused route. The empty backup fixture completes and verifies WAL initialization once before independent copies. These results do not isolate the earlier full-suite timeout's cause or demonstrate timing under full-suite concurrency. Later text-prefix changes are absent from this source and require their own qualification.

Compressed complete reports, input-hash receipt, source/native pins and log are preserved. `sha256.json` hashes decompressed bytes. This is model correctness/timing evidence for this source and runtime, not complete platform/app/resource acceptance.
