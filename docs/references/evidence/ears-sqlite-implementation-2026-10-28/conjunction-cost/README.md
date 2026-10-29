# Conjunction cost correction cohort — 2026-10-28

Preregistered at `aadd721d43`. Exactly six fresh processes ran legacy 9a2771ec25 / materialized 026b6b18b0 /
selective aadd721d43 / selective / materialized / legacy, in one owned Linux arm64 container with two CPUs,
6 GiB and 180 seconds per process. All use the identical updated fixture and normal built entries. Both
control sources receive only that fixture; implementation sources remain pinned. Installs preserve lockfiles.
All six finish with expected answers. No sample is discarded or retried; the earlier four-process cohort is
retained separately. The updated dataset adds a group word in each name, so do not splice raw numbers into
the earlier cohort as an isolated-line comparison.

| p50 | Legacy trials | Materialized trials | Rowid-selective trials |
|---|---:|---:|---:|
| Point/common conjunction | .285 / .285 ms | 19.448 / 19.203 ms | .695 / .704 ms |
| Reverse order | .276 / .278 ms | 19.332 / 19.397 ms | .689 / .680 ms |
| 100-owner group/common | .503 / .505 ms | 19.963 / 20.037 ms | 68.575 / 68.146 ms |
| Reverse 100-owner order | .510 / .516 ms | 20.020 / 19.735 ms | 68.291 / 68.270 ms |
| Selective/global exclusion | .065 / .061 ms | 16.244 / 15.884 ms | .612 / .613 ms |
| Broad limited read | 13.979 / 14.095 ms | 27.236 / 27.157 ms | 27.190 / 27.409 ms |

This correction is **not accepted**. It fixes the point case while the medium case gets worse. Actual query
plans constrain MATCH by document rowids through the owner lookup; the approximately 100-fold point-to-medium
slope is consistent with repeated point-constrained FTS execution, not a set intersection inside its posting
lists. The next candidate will qualify an FTS-owned owner-term intersection, retaining phrase and query-set
semantics and measuring its storage/build overhead. Bound any generated owner mask with a correctness-preserving
fallback; never truncate answers from sampled estimates. Do not accept only the favorable point results.

All raw samples, native hashes, constraints, file/RSS/heartbeat readings, call counts, protocol, source archive
hashes, build/setup logs and runner are retained. Name writes and point/OR reads remain small; readiness and
index-size increases from the source-string shape remain. These are diagnostic results, not app/FULL or
filesystem acceptance. All unmet phase 3–7 criteria remain required.
