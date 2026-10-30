# Supported ANN query-policy diagnostic — 2026-10-30

## Fixed inputs and preregistered comparison

The preceding [query trace](../query-attribution/README.md) identifies native candidate selection as the largest
query stage. Before maintaining additional native code, test the existing candidate budget and upstream
`nprobe` controls. Four settings are preregistered in the source metadata before execution, with the original
mean recall >=0.95, heartbeat p99 <=16 ms and diagnostic-latency gates unchanged. Production defaults do not change.

The same **closed updated snapshot** and model are used throughout. Native read-only mode is asserted,
all 99,900 canonical Float32 rows verify against the sealed corpus/update mapping, and the entire primary
SQLite file SHA256 is identical before and after. Nine updated cohorts x four passes x100 held-out queries x
four policies run: **14,400 policy queries**. Another **900 paired comparisons (1,800 executions)** prove the
parameterized 256-owner helper reproduces the actual production helper's hits/scores on all nine cohorts.
Every >4096-eligible pass still uses native candidates; exact small scopes retain their ordinary route.

This is an updated-only policy diagnostic, not a replacement for the full initial/update matrix, app-owned
admission, multi-chunk/large-K/unit/freshness contracts or adoption acceptance. The model and physical database
remain fixed; the initial source report and model hash are retained. Data/model/corpus payloads stay outside Git.

## Outcome

| Owner target | nprobe | Minimum cohort mean recall | Recall target met? |
| ---: | ---: | ---: | --- |
| 256 | 32 | 0.974 | yes |
| 128 | 32 | 0.948 | no |
| 256 | 16 | 0.915 | no |
| 128 | 16 | 0.893 | no |

All three cheaper settings fail the unchanged quality gate; none is adopted. The current setting still misses
responsiveness. There is no threshold adjustment for a near miss. Approximate reopened results need not match
those of the prior live-owner run exactly, so these values are compared only within this fixed reopened trial.

The resource guard paused only our container twice for other builds. Full timing samples and pause windows are
retained; phase/pass/query wall markers identify overlap. Timings are not certified and no causal speed claim
is made. Those pauses cannot alter the fixed data/model or the deterministic recall checks, so the quality
rejections remain useful. One container uses two CPUs/6 GiB/no swap/dropped capabilities after 30 seconds of
quiet. No source/compiler/full suite runs on the daily Mac and no other agent's container is stopped.

## Diagnosed harness assumption

The first run stops before querying because the harness incorrectly equates `PRAGMA query_only` with the
native read-only open mode. The database class passes `{ readonly: true }` to the binding; the separate pragma
is zero. A tiny disposable actual-driver fixture proves both requested/native read-only properties are true
and an attempted main-database update refuses with `SQLITE_READONLY`. The corrected harness checks the real
native mode, records the separate pragma, and requires the snapshot checksum to match both the initial failed
run's checksum and the final checksum. This corrects an invalid assertion, not a weakening of the read-only
invariant. Original failed input/report/log and the preflight remain losslessly retained.

## Next checkpoint

Use the extension's existing `vec1cat.qprofile` counters to separate metadata filtering, quantized vector
scans and native index reads before writing new C instrumentation or adding a fast path. A bounded dense
integer-membership optimization is a hypothesis, not a measured solution. Any optimization must preserve
ordinary-SQLite membership, unchanged candidates/quality, primary bytes, ownership and every original gate;
unscoped query and live-admission misses remain separate work. Do not replace correctness with looser ANN flags.

Exact probe, preregistered settings, source/native/input hashes, raw samples, immutable-file checks and runner
sources are retained. `summary.json` only derives the findings above; `receipts.json` verifies original/stored
bytes. All original phase 3–7 requirements remain active.
