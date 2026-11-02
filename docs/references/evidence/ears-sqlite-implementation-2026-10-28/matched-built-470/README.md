# Matched built-package EARS comparison at 470c12dfdd

[Run 41284740871](https://github.com/spankyed/apack/actions/runs/41284740871) succeeds in both OFF and FULL cohorts at `470c12dfdda94e11735b0be8bacf34c31f19a147`, master 984f / elmdb f496. Each cohort has three fresh processes per backend in alternating order, five raw timing rounds per task (one settled-watch round), built JavaScript and enforced 2 CPU/6 GiB/no swap. Each provenance records 68 compiled runtime hashes and actually loaded native bindings; SQLite children do not load elmdb and native children do not load the SQLite addon. Matching typechecks pass. This is a synthetic workload, not app/ANN/relevance/durability or complete resource acceptance.

Median of the three per-process medians; times are microseconds per task. A larger SQLite/elmdb ratio means SQLite is slower. Streaming includes sixteen commits, batch includes one hundred updates, and watch includes settlement.

| Task | OFF SQLite | OFF elmdb | Ratio | FULL SQLite | FULL elmdb | Ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| field | 44.83 | 10.12 | 4.43x | 44.66 | 10.08 | 4.43x |
| smallFieldLargeRow | 40.36 | 7.88 | 5.12x | 41.11 | 8.06 | 5.10x |
| projectedLargePage | 377.58 | 106.84 | 3.53x | 375.14 | 108.82 | 3.45x |
| updateSmallRepeatedBody | 243.92 | 111.56 | 2.19x | 481.54 | 330.26 | 1.46x |
| updateSmallVariedBody | 238.65 | 101.91 | 2.34x | 465.28 | 330.53 | 1.41x |
| streamBody16Chunks | 16938.15 | 12340.22 | 1.37x | 24034.54 | 17851.27 | 1.35x |
| row | 51.55 | 19.13 | 2.69x | 50.35 | 18.51 | 2.72x |
| unique | 88.38 | 29.02 | 3.05x | 86.31 | 30.09 | 2.87x |
| page50 | 787.79 | 350.34 | 2.25x | 787.56 | 347.93 | 2.26x |
| all10k | 108603.99 | 57354.01 | 1.89x | 104524.82 | 56613.78 | 1.85x |
| sort10k | 23753.96 | 6505.08 | 3.65x | 23102.42 | 6448.21 | 3.58x |
| edges50 | 728.53 | 386.42 | 1.89x | 742.24 | 373.60 | 1.99x |
| walk299 | 2873.82 | 582.00 | 4.94x | 2905.04 | 562.63 | 5.16x |
| text | 738.32 | 349.81 | 2.11x | 756.14 | 343.31 | 2.20x |
| vector1k256 | 1865.15 | 212.08 | 8.79x | 1847.56 | 200.71 | 9.20x |
| write | 257.54 | 121.39 | 2.12x | 540.40 | 344.82 | 1.57x |
| writeBatch100 | 16614.29 | 3901.42 | 4.26x | 18752.07 | 4686.09 | 4.00x |
| watch20 | 1061.80 | 1045.96 | 1.02x | 1175.81 | 1100.62 | 1.07x |

Elmdb is faster in every timed task here. Single-field reads cost SQLite about 44.7us versus 10.1us; 50-row pages about 788us versus 348–350us; the 1k/256D exact-vector task about 1.85–1.87ms versus 0.20–0.21ms. Settled watches are close (1.02–1.07x). FULL durable single updates are 1.57x, distinct from OFF at 2.12x. This contradicts a speed-based adoption claim for this workload; no failing goal budget is relaxed.

Post-GC sampled process RSS is about 243–256 MiB SQLite versus 385–404 MiB elmdb; this includes the harness, fixture and native/mapped storage, not engine-only memory. SQLite JS heap is higher in the retained first trial. Open files total about 75.6–75.7 MiB SQLite versus 29.8–31.3 MiB elmdb. SQLite includes a 37.2 MiB live WAL and 38.4 MiB main file; do not call that a compacted-database ratio. No post-close/checkpoint size or resource certification follows. Setup is about 3.8s SQLite versus 1.9s elmdb, outside task timing.

Instrumented diagnostic spans are separate from the uninstrumented samples. In the first OFF trial, field reads make four instrumented all/get/run calls per read (BEGIN/COMMIT exec calls are not included) and decode one value. Small-field reads have the same crossing count. Driver spans include preparation/binding/execution/result marshalling; codec spans and the remainder do not isolate a pure SQL compiler cost. Native page/graph plans use temporary ordering, and graph plans include multiple window/sort stages. These observations identify diagnostic targets, not causal attribution of the full slowdown.

Next performance work should test coalescing selective point-read/catalog/value/overflow work while preserving snapshot/schema-revision/corruption and watch behavior, and separately profile exact vector execution before changing policy. Do not add speculative indexes or sacrifice correctness to improve this table. Larger-corpus heartbeat, sustained writes/admission, cold/reopen and real app acceptance remain open. Three trials establish limited within-run dispersion.

Compressed original JSON retains every sample, plan and provenance; sha256.json hashes decompressed originals. summary.json derives per-process medians and ratios without dropping trials. No private corpus payload or database copy is retained.
