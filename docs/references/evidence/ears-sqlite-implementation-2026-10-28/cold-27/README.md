# Verified main-file cold/warm reopen and first reads

[Run 41373060681](https://github.com/spankyed/apack/actions/runs/41373060681), source `27c9cdca4fb2777f4fcc8b04cf0d6816dab5f002`, completes eighty fresh-process trials: twenty per backend/cache condition, alternating backend/condition order. All read answers/counts, file residency checks, report hashes, per-backend runtime/native fingerprints and owned cleanup pass. The fixture has 10,000 dynamic Row entities, deterministic 2-KiB ASCII bodies and group/rank value indexes, with no explicit field-type declarations. The container enforces two CPUs, 6 GiB and no swap on its actual Linux overlayfs. This is a storage slice, not complete cold-application qualification.

| Backend / main-file cache | Backend open | EARS construction | First field | Filtered/ordered page 50 | Subsequent ordered 50 |
| --- | --- | --- | --- | --- | --- |
| elmdb / evicted | 3.31 ms | 1.61 ms | 2.59 ms | 69.51 ms | 63.60 ms |
| elmdb / resident | 0.75 ms | 1.63 ms | 2.10 ms | 1.81 ms | 8.24 ms |
| SQLite / evicted | 83.67 ms | 2.93 ms | 3.45 ms | 80.12 ms | 50.71 ms |
| SQLite / resident | 81.64 ms | 2.93 ms | 1.72 ms | 13.62 ms | 25.16 ms |

All entries are medians, not sums or steady-state throughput. The receipt also retains min/max/p95 and process maxRSS for every group. The main files are 32,702,464 bytes native and 45,957,120 bytes SQLite; these are selected closed-file sizes, not general database/disk-efficiency rankings. Every cold trial observes zero resident main-file pages before launch; every warm trial observes all 7,984 native or 11,220 SQLite pages resident. A separate control establishes both warm and evicted observations. Nonempty SQLite WAL refuses admission. No privileged/global eviction occurs.

Backend modules are imported before the open timer. Backend-specific library initialization, asset validation and factory work may occur at different stages, so the open numbers cannot isolate the SQLite/LMDB OS open cost or whole-process startup. File-resident trials still have fresh JavaScript/JIT/codec/statement state. Open and first reads warm pages; the later page operations are successive and are not independently cold. Preparation/copy/cache control is outside the measured operations; application/code/device caches are uncontrolled. These facts preclude a universal engine ranking or treating the lower SQLite evicted-file ordered median as an overall win.

The repeated opens and correct reads qualify this fixture's observed cache states and operations. There is no heartbeat measurement or new timing threshold here; these results do not waive the existing foreground/recall/resource budgets. Whole-app/device cold behavior, other schema/corpus shapes, large-corpus/provider variance and final adoption remain separate requirements.

The archive contains only the original matrix, two seed reports and eighty numeric read reports, with decompressed per-file SHA-256 in SHA256SUMS. No synthetic primary data, stdout/stderr, environment, profiles or credentials are published. Full matching native/compiled fingerprints remain in the numeric reports; no unmeasured module-import or device-flush time is inferred.
