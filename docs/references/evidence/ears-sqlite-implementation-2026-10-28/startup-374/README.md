# Complete fresh-process startup on both actual stores

[Run 41361438525](https://github.com/spankyed/apack/actions/runs/41361438525), source `37463f942215f8501335531a0bc0cd66d3192747`, completes five warmups and twenty admitted measured trials per actual backend. Each fresh process opens its own copy of a closed populated seed, verifies both managed stores, and reaches the correct usable thread view. The fixed synthetic corpus is twelve threads/1,200 large messages. Source/native provenance, storage identity, capture correctness and invocation admission pass. This source includes the native-readiness repair.

| Backend | Measured median | Min–max | Seed import (outside startup) |
| --- | --- | --- | --- |
| elmdb | 4,586.58 ms | 3,950.68–7,061.46 ms | 1,547.95 ms |
| SQLite | 7,140.74 ms | 4,848.67–12,532.64 ms | 9,501.84 ms |

SQLite's measured median is 55.69% higher in this run. This is a material observed regression requiring investigation/product disposition, not an acceptance waiver. The SQLite seed now completes correctly; its 9.50-second import exceeds the earlier five-second assertion window. The previous failed attempt remains preserved and is not retroactively counted as a successful import. Preparation duration stays visible outside startup timing.

These are warm-filesystem reopening trials, fixed native-first order on one macOS arm64 runner (three CPUs, about 7 GiB), with backend-default acknowledgment policies. They do not isolate engine CPU/I/O cost, physical flush equivalence, order/load effects, cold disk or independent-device variance. No explicit startup budget has been invented after observing the result; original foreground/query/resource requirements remain unchanged.

## Diagnostic capture, not exclusive wall-time attribution

Each measured trial records 309 EARS reads, thirty writes and two units on both backends. Median per-trial sums of instrumented read spans are native/SQLite 68.55/180.34 ms; write spans 6.61/125.83 ms; index-admission spans 347.43/562.95 ms. Backend startup span medians are 918.05/1,791.91 ms; renderer 1,279.90/2,094.50 ms. These spans overlap/nest and cover only instrumented work: they cannot be added as exclusive CPU time or subtracted from elapsed startup to assert a cause. Driver startup spans also include work outside the trial's launch-to-ready interval. Use the existing captures to narrow attribution before changing runtime behavior.

Original numeric admission/preparation/results/lifecycle reports are gzip-preserved with decompressed SHA-256. The receipt preserves all original trace hashes and selected fixed-name span aggregates; raw process/renderer traces, configuration, logs and profiles are omitted. The maintained reader admits all twenty trials per backend; passing completion does not mean the SQLite performance regression or broader adoption criteria are resolved.
