# Sustained WAL retention, checkpoint and refusal witnesses

[Run 41364161387](https://github.com/spankyed/apack/actions/runs/41364161387), source `4738d9bab5`, completes both released/retained reader states for the original 512-write burst and new 4,096-write sustained regime. The latter paces FULL 64-KiB inserts over approximately 120 seconds under two CPUs, 6 GiB and no swap; it is not saturation throughput. All four processes verify reader visibility, committed row counts, competing-writer refusal with unchanged sequence, reuse, read-only reopen/integrity and scratch cleanup. Ordinary 1,000-page autocheckpoint remains unchanged. Original numeric reports/heartbeat samples are gzip-preserved with decompressed SHA-256.

| Sustained reader state | Write p95 | Heartbeat p99 / maximum | Sampled WAL maximum | Reported maxRSS at end of writes |
| --- | --- | --- | --- | --- |
| released | 1.55 ms | 1.15 / 22.76 ms | 4,247,752 bytes | 201,500 KiB |
| retained | 4.34 ms | 3.92 / 25.76 ms | 492,838,552 bytes | 215,004 KiB |

Both meet the unchanged 16-ms heartbeat p99 target on this paced fixture; maxima remain visible. With the retained snapshot, 119,621 WAL frames cannot be checkpointed. Releasing it permits TRUNCATE to reclaim WAL to zero. Busy-writer refusal takes about 0.50/0.63 ms, and final recovered row counts are 4,098. These are two-minute bounded witnesses, not indefinite-load, independent-device, renderer/search or physical power-loss qualification. Process memory includes setup/instrumentation; the reported maxRSS is observed at the end of writes, not a measurement of every later cleanup phase.

## Disk capacity limitation

Per-commit sampled logical/allocated maxima are released 273,506,504/273,514,496 bytes and retained 494,014,104/494,018,560 bytes. They **are not total peak disk requirements**: synchronous checkpointing can grow the main database while the WAL still exists, and JS samples outside that call do not capture the overlap. Transient commit/checkpoint allocations and external filesystem overhead are also unmeasured. Retain disk headroom for database plus WAL; do not size storage from the sampled totals alone. The existing one-step TRUNCATE witness proves reclamation, not the peak capacity during it. A separate explicit FULL-before-TRUNCATE diagnostic can expose the overlap without claiming to observe the uninstrumented operation's instantaneous peak.

The earlier sub-second burst evidence is retained in its own directory. Longer duration does not waive unrelated foreground/admission/search misses, startup regression, resource/device variance or any original adoption requirement.
