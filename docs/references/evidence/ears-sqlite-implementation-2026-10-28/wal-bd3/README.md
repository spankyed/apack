# Retained-reader WAL and competing-writer resources

The storage workload job in [run 41346500465](https://github.com/spankyed/apack/actions/runs/41346500465) passes at `bd3176dd25a468350c5f6da5f3b9f9ac974f8f14`. The overall workflow also launched an unrelated app-build job due to the then-missing general-job exclusion; `9a4a9e9fe6` corrects future routing without cancelling this run. This source includes the master rebase/numeric ordering, but predates projected-hit batching/dependency corrections.

Two fresh processes use actual built packages, ordinary FULL synchronization and the unchanged 1,000-page auto-checkpoint setting, with 512 64-KiB entity writes each. The private Docker workload is capped at two CPUs/6 GiB/no swap, network disabled, on an Intel Xeon Platinum 8370C host. Original reports include native/compiled hashes and exact cgroup limits. SHA256SUMS names decompressed originals. Only numeric observations and provenance are published; private databases/payloads are removed.

| Reader state | Write p95 ms | Heartbeat p99 ms | Sampled max logical bytes | Sampled max allocated bytes | Busy refusal ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Released | 0.9693 | 3.6130 | 37,630,056 | 37,634,048 | 0.4900 |
| Retained | 1.0696 | 0.9009 | 60,166,616 | 60,170,240 | 0.5159 |

The retained snapshot continues seeing its one initial entity while all 512 writes commit. It prevents truncation with 14,525 WAL frames and zero checkpointed frames; WAL logical size reaches 59,843,032 bytes. Releasing the reader permits successful TRUNCATE, restores current visibility and leaves zero WAL bytes. The released-reader cohort auto-checkpoints normally and finishes writes with a 4,231,272-byte reusable WAL. Both stores verify 514 entities after one refused competing write and one successful recovered write, then close/reopen read-only with successful integrity checks. Scratch removal succeeds. Whole-process maximum RSS is 152,776/152,792 KiB, including setup and instrumentation.

Both observed heartbeat p99 values pass the original 16-ms target in this diagnostic. The write loops last only 381.89/481.99 ms on this host; 512 writes establish bounded growth/reclamation witnesses, not long-duration steady-state or representative app responsiveness. Two serial cohorts in one VM do not establish independent trial/device variance, causal latency attribution, intra-commit disk peaks, engine-only memory or physical power-loss safety. The lower retained-reader heartbeat is not evidence that pinning readers improves performance. Keep all sustained/corpus/admission failures and remaining worker/storage fault requirements.
