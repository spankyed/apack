# Matched projection remeasurement at f55ecc3390

[Run 41288646196](https://github.com/spankyed/apack/actions/runs/41288646196) succeeds in all six fresh processes per cohort at source `f55ecc3390680e8672c35bb751c4f1061871d8c4`, native f496. The same built-package synthetic fixture, raw timing rounds and enforced 2 CPU/6 GiB/no swap apply. Actual runtime source matches correctness-qualified c27; subsequent changes before this run concern fixtures/docs/provenance.

OFF runs on Intel Xeon Platinum 8370C; FULL on AMD EPYC 9V45. Do not infer durability-policy overhead from absolute OFF/FULL timings on different CPUs. The earlier 470 run did not record CPU model, so cross-run absolute deltas alone cannot isolate code effects. Within-run backend ratios and the observed four-to-three driver-call reduction support the selective-read improvement; this is not a controlled same-host before/after experiment.

| Task | OFF SQLite us | OFF elmdb us | Ratio | FULL SQLite us | FULL elmdb us | Ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| field | 24.37 | 9.38 | 2.60x | 12.93 | 5.24 | 2.47x |
| smallFieldLargeRow | 21.19 | 7.64 | 2.77x | 10.66 | 3.92 | 2.72x |
| projectedLargePage | 326.24 | 101.08 | 3.23x | 164.72 | 51.27 | 3.21x |
| updateSmallRepeatedBody | 154.46 | 72.25 | 2.14x | 257.50 | 184.86 | 1.39x |
| updateSmallVariedBody | 153.14 | 69.37 | 2.21x | 266.33 | 186.59 | 1.43x |
| streamBody16Chunks | 12328.09 | 8624.61 | 1.43x | 16317.10 | 9041.49 | 1.80x |
| row | 36.41 | 16.24 | 2.24x | 18.78 | 8.96 | 2.10x |
| unique | 58.06 | 23.09 | 2.51x | 28.87 | 11.53 | 2.50x |
| page50 | 782.52 | 350.86 | 2.23x | 424.63 | 185.14 | 2.29x |
| all10k | 100653.73 | 57203.59 | 1.76x | 60033.99 | 31307.05 | 1.92x |
| sort10k | 21817.31 | 6199.50 | 3.52x | 14091.78 | 4141.97 | 3.40x |
| edges50 | 681.17 | 381.33 | 1.79x | 351.20 | 195.19 | 1.80x |
| walk299 | 2703.83 | 556.53 | 4.86x | 1360.48 | 321.09 | 4.24x |
| text | 737.10 | 337.74 | 2.18x | 396.50 | 192.73 | 2.06x |
| vector1k256 | 1793.61 | 198.18 | 9.05x | 970.35 | 112.41 | 8.63x |
| write | 171.83 | 85.83 | 2.00x | 300.58 | 199.86 | 1.50x |
| writeBatch100 | 10828.90 | 3490.08 | 3.10x | 6448.05 | 2348.67 | 2.75x |
| watch20 | 1057.79 | 1086.34 | 0.97x | 1121.81 | 1047.48 | 1.07x |

Single-field ratios improve from 4.43x to 2.60x OFF and 2.47x FULL; small-field-in-large-row ratios from about 5.1x to 2.77/2.72x. Diagnostic field and small-field calls now make three instrumented all/get/run crossings instead of four; exec-based BEGIN/COMMIT are outside that count. All correctness/model/Map/projection/corruption cases passed in focused c27 before remeasurement. The modest query specialization is retained on that evidence; it does not make SQLite faster than native on these reads.

Pages remain about 2.2–2.3x, small exact vectors 8.6–9.1x and settled watches close to parity. The tiny OFF watch advantage is not evidence of a storage win. SQLite sampled process RSS remains lower; raw file/RSS/rusage records retain their original non-engine-only scope. ANN recall, actual app latency, Windows model timing, 16ms heartbeat and complete resource/operational/platform acceptance remain unresolved.

summary.json retains all per-process medians and prior ratios; compressed originals preserve every timing round, plan, loaded binding and source/runtime hash. sha256.json hashes decompressed original files.
