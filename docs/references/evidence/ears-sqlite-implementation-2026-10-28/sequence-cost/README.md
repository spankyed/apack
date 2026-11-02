# Entity-sequence ranking cost — 2026-10-29

Preregistered at 2d0bdcbde9. All four fresh processes complete prefix / sequence / sequence / prefix,
using exact sources 76b1aa2765 and 2d0bdcbde9, the identical existing fixture, two CPUs/6 GiB, OFF commits,
180 seconds per process and no retry or discarded sample. Expected answers/highlights pass. All loaded
native hashes match; installs leave lockfiles unchanged. Raw samples, binding counts, heartbeat and
resource/entrypoint provenance are retained. Actual native-plan proof is in adjacent text-sequence evidence.

| Measurement | Prefix (1 / 4) | Sequence (2 / 3) |
|---|---:|---:|
| Point p50 | 0.136 / 0.144 ms | 0.135 / 0.133 ms |
| Point/common p50 | 0.880 / 0.872 ms | 0.879 / 0.863 ms |
| Reverse point/common p50 | 0.838 / 0.852 ms | 0.865 / 0.841 ms |
| 100-owner/common p50 | 3.180 / 3.260 ms | 3.296 / 3.152 ms |
| Reverse 100-owner p50 | 3.236 / 3.301 ms | 3.243 / 3.157 ms |
| Exclusion p50 | 0.729 / 0.741 ms | 0.741 / 0.743 ms |
| Reverse exclusion p50 | 0.726 / 0.730 ms | 0.756 / 0.749 ms |
| Disjunction p50 | 0.240 / 0.249 ms | 0.263 / 0.246 ms |
| Broad p50 | 18.538 / 18.693 ms | 17.363 / 16.889 ms |
| Broad p99 | 19.710 / 20.323 ms | 18.904 / 18.378 ms |
| Highlights p50 | 19.719 / 19.811 ms | 18.284 / 18.375 ms |
| Highlights p99 | 21.537 / 22.817 ms | 19.478 / 19.620 ms |
| Recency p50 | 47.575 / 48.015 ms | 46.327 / 46.021 ms |
| Recency p99 | 60.644 / 65.079 ms | 84.084 / 58.890 ms |
| Name write p50 | 0.229 / 0.222 ms | 0.217 / 0.222 ms |

Broad improves modestly from ~18.6 to ~17.1 ms; highlights ~19.8 to ~18.3 ms. Recency remains
~46 ms versus ~48 ms; its full candidate hydration is not fixed. Point/conjunction/write medians stay
close. Main-file bytes are identical (28,762,112 after build; 29,253,632 after writes); sampled high-water
resources remain in raw reports and do not bound memory. Broad and highlighted p99 still miss 16 ms,
as does recency. No production latency acceptance or phase 3 qualification follows.

The next main correction belongs in native timestamp/value ranking before the prefix, preserving numeric
and Date values, missing/non-numeric fields, one read clock, adjusted-score ties, global type ordering,
complete highlights and later pipeline scope. Preserve every failed cohort and all remaining goal criteria.
Changing entity metadata clustering could also remove the text-key index/table double lookup; SQLite’s
[WITHOUT ROWID guidance](https://www.sqlite.org/withoutrowid.html) suggests measuring it only for small
noninteger-key rows. It has not been implemented or measured here; secondary-index and write/storage
tradeoffs remain unknown. Large payload storage must retain its previously justified separate layout.
