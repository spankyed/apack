# Real warm application flows on both backends

[Run 41341760226](https://github.com/spankyed/apack/actions/runs/41341760226), source `50cf9d6980d417fbb17eacf5ede17eb9798e68e7`, passes script/test types and the storage-provenance tooling controls, then completes all six maintained application scenarios. Each backend/scenario owns a fresh app/profile, five warmups and twenty measured lightweight actions: 120 measured actions and 30 warmups. Both actual store files are checked before assigning `runtime.storageFormat`; the standard raw-run reader verifies every immutable trial/capture and clean source/native provenance.

| Scenario | Native median ms | SQLite median ms | Native observed range ms | SQLite observed range ms |
| --- | ---: | ---: | ---: | ---: |
| Thread opening | 430.20 | 546.55 | 367.8–613.0 | 431.1–1,022.1 |
| Current-query search | 16.15 | 27.70 | 12.2–30.0 | 20.9–36.7 |
| Deterministic CLI streaming completion | 786.10 | 847.20 | 760.1–820.6 | 815.5–960.7 |

Streaming first-visible median is native/SQLite 144.3/218.0 ms; maximum-visible-update-gap median is 85.9/92.0 ms. Largest observed update gap is 111.9/108.0 ms. Progress/backlog measurements refer to producer enqueue through database-backed view/DOM completion with approximate clock alignment, not individual commit latency or paint. The fixture calls no network/model provider.

This is one macOS arm64 runner (three reported CPUs/7 GiB), Electron 37.2.4 and warm-process cache policy, with each scenario running native before SQLite. It is not an independently balanced backend/cold-device experiment or the two-CPU Linux/corpus gate. Twenty samples do not establish tail percentiles. App defaults differ: native groups syncs while SQLite uses FULL per commit; these end-to-end results are not matched durable-acknowledgment algorithm comparisons. The separate sustained cohort matches durable units. No causal engine-only slowdown or universal speedup follows, and neither 16 ms corpus/admission misses nor full host-suite timeout is cleared. This source precedes the known-type numeric-order correction.

Eighteen explicit original admission/manifest/index JSON reports are compressed unchanged. Six additional derived scalar/resource reports retain all warmup/action samples, work counters, visible-progress/backlog points, bounded process statistics, renderer metrics and original raw-trial hashes. SHA-256 hashes refer to decompressed bytes; the derived reports identify themselves as derived. Encoded spans, profiles, full raw trial payloads, Playwright configuration/stdout, private directories and trace/viewer exports are omitted. Actual process observations remain sampled/window totals, not per-action causal attribution or true peak memory/disk.
