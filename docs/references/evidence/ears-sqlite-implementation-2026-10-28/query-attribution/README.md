# Actual-owner scoped-vector query attribution — 2026-10-30

## Preserved workload and result

Source `1eb47d88e1` runs the existing real-vector EARS probe with its actual SqliteVectorModels owner, adding
observability only. The same sealed 99,900 x1536 fixture, held-out query/oracle checks, all initial/updated
cohorts, first plus three timed passes, original updates and frozen quality/heartbeat/latency checks remain.
All **7,200 queries** complete; all 99,900 canonical vectors verify initially, after updates and at the end.
Minimum cohort mean recall is **0.973**. Frozen responsiveness gates still fail. No production setting changes.

`all`/`get` statement boundaries record lookup/preparation and combined binding/execution/materialization
cost, row counts and phase/query wall windows. The binding exposes no independent decoder timer: that combined
cost must not be called pure SQL CPU. Iterator and other unobserved facade/binding work remain explicitly
unattributed, rather than labelled JavaScript time. Plans are collected outside the timed query matrix with
the first actual parameter shape for each SQL text; no extra counterfactual execution warms the measured query.

## What dominates

Independently calculated medians over the three timed passes of the updated 100%-scope cohorts:

| Cohort | Query | Eligibility probe | Native candidates | Rerank | Unattributed remainder |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1k | 7.35 ms | 7.01 ms (exact result) | n/a | n/a | 0.26 ms |
| 10k indexed scope | 51.82 ms | 8.87 ms | 34.28 ms | 8.02 ms | 0.40 ms |
| 99,900 unfiltered | 18.38 ms | 1.74 ms | 12.78 ms | 3.45 ms | 0.29 ms |

Medians are independently calculated and need not sum exactly. Preparation totals 108.71 ms over all 7,200
queries, about 0.015 ms/query. The trace does not support optimizing request serialization or facade glue as
the first vector-query fix. Native candidate selection is the largest observed stage. The actual SQL repeats
scope eligibility independently in the probe, native IN predicate and final rerank; the recorded plans and
full stage distributions retain the evidence, without assuming one unmeasured rewrite will close the gap.

Actual owner-driven admission records **45.81 s**, heartbeat p99 **181.71 ms**. There are **no recorded guard
pauses** in this run; phase/query wall markers make future pause overlap auditable. This is still diagnostic,
not app acceptance or a speed comparison with prior runs: query instrumentation adds overhead, the model is
freshly trained, and this store lives on the private named volume so it can be retained after closing. The
allocation study's stores lived in the container writable layer. Host/storage variance, matched elmdb,
uninstrumented timing, cold/reopen and full app resource budgets remain separate requirements.

## Conditions and retained snapshot

One private container is admitted after a 30-second quiet window, with two CPUs/6 GiB/no swap/dropped
capabilities. The guard pauses only our container for other builds; no such action was recorded here.
A 12-GiB host-headroom check precedes creation/retention. The existing probe asserts FULL durability; no
checkpoint policy, vector bytes, query budget or application contract was weakened. A model-ready store is
not the complete installed application lifecycle.

After measurement and final canonical-byte validation, the real model owner drains/stops, the database
closes, and its private directory is moved within the same volume to
`/electron/.temp/ears-query-attribution-retained`. No backup copy duplicates its approximately 1.8-GB payload.
The report records closure/retention, while corpus, model and database payloads remain outside Git. Future
counterfactuals must reopen that known updated snapshot explicitly and preserve its bytes or use owned copies.

The next diagnostic tests supported candidate/probe query controls against that fixed model and read-only
updated snapshot, keeping all nine updated cohorts and original gates. That diagnostic cannot replace full
initial/update acceptance, multi-chunk/large-K/unit/freshness contracts, live admission or final app budgets.
If those controls do not suffice, use the trace to justify SQL/algorithm changes rather than expanding native
ownership blindly. Writer-worker alternatives must still preserve synchronous foreground behavior and avoid
internal writer contention.

Exact probe/generator, source/input/native hashes, runner/admission guard, phase markers, raw samples,
SQL statements/plans and derived summary are retained with lossless receipts. No compiler or broad suite ran
on the daily Mac. The full SQLite goal and all remaining adoption criteria stay active.
