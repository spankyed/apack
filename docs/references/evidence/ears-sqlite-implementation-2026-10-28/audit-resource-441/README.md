# Complete built-package relation audit resource cohort

[Run 41301810718](https://github.com/spankyed/apack/actions/runs/41301810718), source `44155b34ca260c1fc7aaf41876a0e8baec68b63b`, completes all six fresh children under verified 2 CPU/6 GiB/no swap, Node 23.11.1, SQLite 3.53.4, AMD EPYC 9V45. Core relation runtime is `9ac1f748d3`; the later probe fix verifies canonical loaded-driver ownership across opaque addon filenames. All original report/log bytes are compressed here; sha256.json records decompressed hashes.

| Fixture | Three audit times (ms) | After-audit cumulative maxRSS (KiB) | Observed logical source/scratch peak (bytes) | Observed spool peak (bytes) |
| --- | --- | --- | --- | --- |
| 50k distinct small keys / 64-byte payload | 860.472, 874.730, 891.109 | 196784, 197916, 197604 | 62513816 each | 13926400, 14127104, 14139392 |
| 10k distinct keys / 8192-byte payload | 623.513, 637.374, 633.592 | 345408, 346076, 345916 | 270640448 each | 12288 each |

Every audit checks its full relation count, reports zero issues, preserves source relation bytes and commit identity, exits naturally with code zero and removes owned scratch. The small-key spool exceeds its 8 MiB cache setting, demonstrating actual disk spill. The large-info spool fits in cache; its process peak also includes fixture/setup/native allocations. These are OFF-maintenance synthetic cases, not a total-memory bound, allocated/exact disk peak, forced fingerprint-collision CPU bound, FULL durability/app-resource acceptance or a comparison with the earlier different-CPU partial trial.

The focused suites retain SQLite 413 pass / one keyword failure / no skips and native 262 pass / one keyword failure / 151 SQLite-only exclusions. All named relation/model witnesses, source/test typechecks, package/API checks with empty API patch, actual WAL controls and all five matching-producer conversion groups pass. The overall workflow is failure solely because both backends retain the frozen generate-entries relevance failure. This is Linux qualification, not final-source all-platform or installed acceptance.

The trusted packaged vector probe reports **version 0.8 (Scalar, multi-threaded)** on a runner exposing AVX2/FMA. This establishes that this artifact selects Scalar despite available AVX2; it does not establish a latency cause or speedup. The separate upstream runtime-dispatch diagnostic and paired corpus/model/fallback/platform qualification remain required before any production build change.
