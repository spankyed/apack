# Native projection and shared eligibility, 2026-10-29

`ed23f228c5` removes unused native Float32 vector/distance projection when EARS only
needs candidate owners. The chunk/distance diagnostic projection remains available;
low-level tests compare ordered owner results across both projections. It passes 624
EARS, 135 host/storage, seventeen focused native cases, builds/types/API/static and
four mutation controls. The matched ninety-query stage profile shows no material
speedup: broad native candidate SQL remains about 13.6 ms and filtered native SQL
118–121 ms. This removes redundant calculation, but does not resolve the bottleneck.

`25668da288` shares one bounded eligibility page between count and small-scope exact
scoring. It materializes at most 4,097 chunk references, returns only a count above
4,096 and computes exact scores from that same page for smaller sets. A scalar scope
witness runs three times for three eligible rows, rather than six across two queries.
Reverting to the old count-then-exact path fails the intended assertion. The existing
large-query witness still counts only 555 exact distance evaluations for 4,899 chunks,
including all 300 chunks of the first owner; bounded probing does not score 4,097 rows.
No persisted schema, primary bytes, commit identities, ANN settings or thresholds change.

The final source passes **625 EARS, 135 host/storage and seventeen focused native cases**,
builds/types/API/static and the four prior mutation controls. The separate scope control
passes seventeen focused cases/types and fails the duplicate-evaluation mutation.
The requested image, actual cgroup limits, mode-denial preflight, exact source archives,
loaded native hashes, reports and runners are retained. These runs did not capture a
separate live external image-inspect receipt; no such receipt is claimed retroactively.

An initial scope attempt failed the multi-chunk fixture's first-hit assumption. Random
entity IDs determined vector assignment, while the earlier limit used creation sequence,
so the expected target could lie outside its scope. The fixture now uses deterministic
seed IDs aligned with creation sequence; assertions and limits are unchanged. The rerun
passes. The initial failure/source are retained; its database was cleaned by the fixture,
so no claim is made to have inspected that failed database after cleanup.

Matched instrumented means over ten queries per group:

| Group | Owner-only projection | Shared eligibility |
| --- | ---: | ---: |
| 10k /10% exact | 20.91 ms | 16.72 ms |
| 10k broad | 133.93 ms | 134.30 ms |
| 100k broad | 19.20 ms | 21.33 ms |
| 100k /10% | 141.54 ms | 142.88 ms |
| 100k /1% exact | 13.47 ms | 12.30 ms |

The small exact query avoids duplicated scope work, but added materialization and observed
variation do not establish an overall speedup. Broad timings are worse in this sample;
these are diagnostic means, not repeated first/timed p95 and heartbeat acceptance. Neither
change passes the complete performance goal or replaces the failed frozen matrix. The
large filtered path remains dominated by original native membership; multiple scope/count/
rerank stages still repeat some eligibility work. Use a shared SQL execution frame and
qualify native membership and WAL checkpoint ownership next. Preserve all failures and
FULL logical durability; no ANN retuning or native fork adoption follows from these samples.

Concurrent master `8b1a479b96` /native `4d558a2754` still needs deliberate isolated
integration and affected validation. These results retain their recorded older baseline.
