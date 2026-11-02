# Source-string FTS cost cohort — 2026-10-28

Preregistered source is `026b6b18b0b786f5cc732ffb83982b2b90d37ca1` and its benchmark README. The exact
same `text-shape.mjs` runs normal built package entries on old `9a2771ec25` and new `026b6b18b0`. Old receives
only that identical new fixture; its implementation is unchanged. Four fresh processes ran old/new/new/old
in one owned Linux arm64 container, two CPUs/6 GiB, OFF commits, 180 seconds per process. Both dependency
installs leave the lockfile unchanged. All four complete with their expected common-query/write answers.
No samples were discarded, repeated, warmed away or converted into production acceptance.

Each has 10,000 rows: camelCase name, mostly 500-byte body (1/128 large), three tags. Seed precedes admission;
readiness includes cooperative build. Each retains 250 point reads, 250 selective-plus-common cross-field
reads, 50 broad limited searches and 1,000 name writes. Binding counts include post-write verification reads,
while write timings cover only the write. Broad-search validation checks membership/count/uniqueness, not
identical ranking: per-string score statistics intentionally differ. Native binaries and actual entrypoints
are recorded in each report. This is a small synthetic shape diagnostic, not app/watch/FULL qualification.

| Measurement | Old trials | New trials |
|---|---:|---:|
| Index readiness including admission | 339 / 341 ms | 1,160 / 1,112 ms |
| Point query p50 | 0.078 / 0.077 ms | 0.104 / 0.099 ms |
| Cross-field query p50 | 0.294 / 0.290 ms | 20.241 / 19.886 ms |
| Cross-field query p99 | 0.484 / 0.529 ms | 21.461 / 21.259 ms |
| Broad limited query p50 | 14.670 / 14.547 ms | 27.894 / 27.538 ms |
| Name write p50 | 0.216 / 0.212 ms | 0.229 / 0.226 ms |
| Main database after build | 22,278,144 bytes | 27,926,528 bytes |

These costs are **not accepted**. The mixed-field query selects one ticket and a common body word. The new
native clause CTEs materialize all common-word matches before entity intersection; the fixture exposes this
execution cost rather than a correctness or native-loader problem. Fix native selective clause execution and
verify both term orders, OR/any and exclusions, retaining this cohort. Do not remove the field/phrase features,
raise budgets or repeat the identical source until a favorable result appears. Broad-search materialization,
index/build costs and representative scale still need qualification even after that targeted fix.

The sampled filesystem/RSS peaks and independent heartbeat are in every raw report and analysis; 20 ms
sampling can miss short peaks, and these numbers certify no filesystem. Sources, archive hashes, runner,
protocol, all raw samples/stdout/stderr and descriptive analysis are retained here. The original 100k heartbeat
failure and every phase 3–7 requirement remain open.
