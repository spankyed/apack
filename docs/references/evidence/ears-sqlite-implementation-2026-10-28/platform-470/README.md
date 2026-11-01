# Rebased-source platform qualification

Completed platform jobs in [strict run 41346286188](https://github.com/spankyed/apack/actions/runs/41346286188), source `4701bd839df1cf32e39e674b02fa285904f80a7f`, master `461f7bf2cb`, elmdb `f496470`. The strict producer passes; consumer jobs remain separate live gates. This source predates projected-hit batching and row-dependency corrections; it cannot qualify those changes.

Linux/macOS each have 920 EARS passes, the one retained frozen keyword relevance failure and no exclusions. All 28 ordering-cost cases pass on each. Host has 312 passes and crash/recovery 12 passes, with zero failures or exclusions. Windows has 916 EARS passes/the same failure/four FIFO exclusions; all 28 ordering cases pass. Its host report has 309 passes/six documented exclusions, and crash/recovery two passes/ten POSIX exclusions.

Original EARS, host, crash/recovery and platform verification reports are gzip-preserved with decompressed SHA-256. The derived receipt records counts and bounded scope. Logs, source databases, private profiles, native build outputs and duplicate artifacts are omitted. The coverage verifier remains red because complete EARS contracts include the original keyword judgment; independent later passing checks do not waive it. This is platform contract evidence, not final installed/signing/app/resource acceptance.
