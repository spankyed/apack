# Actual EARS facade slice

## Baseline and conditions

The first current-candidate comparison is source `5985709142b3b908d0f4d635a1c4ec7da571a607` against owned engine
`933aa19f04355784412cadf4938f9b49e35e564d`. Node 23.11.1, SQLite 3.53.4, pinned better-sqlite3 13.0.3 and sqlite-vec
0.1.9 run in the disposable Linux aarch64 runner (two cores, 8 GiB), with fresh temporary databases/processes.
Three trials per backend alternate backend order. Each ordinary task retains five timing samples per process;
watch20 retains one. Tables show the median of each process's median. Raw samples and min/max trial medians are
in `facade-api-5985709142`, `facade-durable-5985709142` and `facade-baseline-summary.json`.

The fixture has 10,000 flexible Message rows, 1,000 low-rank synthetic 256-dimensional vectors, a 299-edge chain,
a 50-edge fanout and 64 explicitly typed Large rows holding 256 KiB bodies (half repeated, half deterministic
high-entropy ASCII). This is a synthetic facade comparison, not complete app, cold-cache, relevance or recall evidence.
Both non-durable fixtures disable syncs. Durable tasks use durable unit acknowledgments on both backends, including
watch writes; this does not qualify every I/O failure, group-commit policy or operating system. No filesystem beyond
this tested environment is certified. The runner's own untracked checkout/lock metadata appears in provenance;
exact source fingerprints identify the implementation. Peak RSS includes mapped/native/runtime memory.

## First measurements

Times are microseconds per task. StreamBody16Chunks includes sixteen commits, not one. The final column is the
SQLite/elmdb ratio for the separate durable trials; a ratio above one favors elmdb on that workload.

| Task | elmdb, sync off | SQLite, sync off | SQLite / elmdb | Durable ratio |
|---|---:|---:|---:|---:|
| field | 8.33 | 23.74 | 2.85× | 3.07× |
| smallFieldLargeRow | 7.25 | 282.62 | 38.97× | 39.24× |
| projectedLargePage | 126.86 | 14301.59 | 112.73× | 114.42× |
| updateSmallRepeatedBody | 63.10 | 1129.71 | 17.90× | 1.55× |
| updateSmallVariedBody | 60.11 | 1069.60 | 17.80× | 1.35× |
| streamBody16Chunks | 7044.04 | 24947.86 | 3.54× | 1.17× |
| row | 15.27 | 27.47 | 1.80× | 1.79× |
| unique | 42.54 | 68.91 | 1.62× | 1.53× |
| page50 | 282.81 | 555.56 | 1.96× | 1.95× |
| all10k | 40514.31 | 73164.39 | 1.81× | 1.86× |
| sort10k | 5189.10 | 149378.16 | 28.79× | 29.46× |
| edges50 | 297.39 | 619.34 | 2.08× | 2.09× |
| walk299 | 477.60 | 1335.60 | 2.80× | 2.92× |
| text | 310.58 | 343.68 | 1.11× | 1.13× |
| vector1k256 | 174.96 | 2233.49 | 12.77× | 12.51× |
| write | 69.40 | 147.89 | 2.13× | 1.10× |
| writeBatch100 | 3122.89 | 9982.07 | 3.20× | 1.85× |
| watch20 | 1163.89 | 1146.81 | 0.99× | 0.92× |

These results do not justify adoption. Sorting and synthetic vector execution remain substantial regressions;
ordinary reads/pages are roughly 1.6–3× slower here. Watch settlement is close. Baseline process peak RSS is lower
for SQLite (~258–260 MiB versus ~388–394 MiB, sync off), while total database-side files are larger (~80.5 MB versus
~32.2 MB); these are process/fixture observations, not general engine memory or steady-state space guarantees.

## Layout problem found and isolated correction

The small-field/large-entity case is materially worse: ~283 µs per field read, ~14.3 ms per 50-row projection,
and ~1.07 ms per small unflushed update. Instrumented diagnostic spans put most time inside driver calls rather
than JavaScript adaptation or MessagePack decoding. The overflow table used WITHOUT ROWID, placing large values
in an index B-tree. SQLite specifically recommends ordinary rowid tables when rows contain large strings/BLOBs:
[WITHOUT ROWID guidance](https://www.sqlite.org/withoutrowid.html).

`df99b9d579` changes only that table's physical layout, retaining its unique logical key. Nine focused value/port
cases passed on the owned local driver. Linux typechecking and all 258 SQLite cases passed. The identical
three-trial cohorts completed successfully; the complete raw repeats and summaries are in `facade-api-df99b9d579`,
`facade-durable-df99b9d579` and `facade-rowid-summary.json`. Actual loaded SQLite/vector binaries were fingerprinted
from the unchanged dependency volume in `facade-native-bindings.json`. This follows the repository's format-one policy for pre-user data;
no legacy migration or release bump is introduced. Previously created candidate files retain their old physical
table; use a fresh/copied logical database for comparisons rather than assuming CREATE IF NOT EXISTS converts it.

## Repeat after the isolated layout correction

| Task | elmdb, sync off | SQLite, sync off | SQLite / elmdb | Durable ratio |
|---|---:|---:|---:|---:|
| smallFieldLargeRow | 7.22 | 21.01 | 2.91× | 2.98× |
| projectedLargePage | 119.76 | 270.71 | 2.26× | 2.17× |
| updateSmallVariedBody | 60.98 | 116.55 | 1.91× | 1.17× |
| streamBody16Chunks | 6958.53 | 8499.52 | 1.22× | 1.09× |
| page50 | 304.25 | 545.41 | 1.79× | 1.96× |
| sort10k | 5177.93 | 150125.68 | 28.99× | 29.75× |
| vector1k256 | 176.47 | 2226.62 | 12.62× | 12.62× |
| write | 70.42 | 125.73 | 1.79× | 1.14× |
| writeBatch100 | 3241.62 | 8657.96 | 2.67× | 1.79× |
| watch20 | 1112.07 | 1154.16 | 1.04× | 1.25× |

The corrected table cuts SQLite's large-row projection by ~53×, small-field reads by ~13× and small unflushed
updates by ~9× versus the first candidate. The ordinary SQLite/native ratio is now ~1.6–3× for these reads;
large-row updates are ~1.8–1.9× with syncs off and ~1.2× with durable acknowledgments. Sorting (~29×) and this
synthetic vector case (~13×) remain material regressions. These results support the physical-table correction,
not an adoption verdict. Database-side files increase slightly to ~81.3 MB in the sync-off repeat; no compression
or steady-state-space claim follows from this fixture.

## Attribution limits and work remaining

The separate diagnostic pass times driver all/get/run spans and pack/unpack spans, counts calls and captures actual
SELECT plans. Driver spans combine preparation, binding, native SQL execution and returned-value marshalling;
the binding does not expose separate timers. Remaining facade time includes source-to-SQL adaptation, validation,
other allocation/transaction work and instrumentation overhead. It is not a pure compilation timer or a measured
allocation byte count. More precise native/allocator attribution remains open; the measurements are not relabeled
as fulfilling it. Normal timing samples do not include these wrappers.

The complete background-index, search/vector, host lifecycle, failure/packaging and adoption-budget requirements
remain in the goal. This slice is sufficient for an early draft review, not an adoption or merge recommendation.
