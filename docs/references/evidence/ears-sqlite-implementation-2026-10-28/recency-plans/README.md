# Native recency plan — 2026-10-29

Preregistered source 78b8e7bc73 (production recency remains 0f57770e1f), one 10k profile, ten consecutive
samples for each of eight paths. Two CPUs/6 GiB, OFF commits, built entries and native hashes retained.
EARS build, fixture syntax/lint and every answer pass. SQL/parameters, native plans and FTS VDBE programs
are captured after timing. This is diagnosis, not a qualification rerun.

| Path | Total median | Binding median | Outside bindings median |
|---|---:|---:|---:|
| point | 0.355 ms | 0.127 ms | 0.198 ms |
| crossField | 1.030 ms | 0.930 ms | 0.095 ms |
| medium | 3.608 ms | 3.441 ms | 0.143 ms |
| broad | 16.875 ms | 16.711 ms | 0.182 ms |
| highlights | 19.035 ms | 18.643 ms | 0.420 ms |
| recency | 27.711 ms | 27.492 ms | 0.210 ms |
| recencyHighlights | 34.613 ms | 34.205 ms | 0.424 ms |
| unlimited | 25.191 ms | 21.803 ms | 3.096 ms |

The actual recency plans show MATERIALIZE r, SCAN v, per-value overflow lookup and an automatic covering
index on the materialized timestamp source. This occurs in both the full score query and the selected-only
highlight fetch. In the first highlighted sample the score statement is ~26.6 ms and the selected fetch
~6.4 ms, despite returning ten rows. The source subquery is a LEFT JOIN nested inside another LEFT JOIN.

Next test a correlated scalar selection from the existing authoritative field source, indexed by the
accepted entity ID. Preserve value/missing semantics, adjusted/base-score ties, snapshots and prefix scope.
A native timestamp visit counter should prove the selected fetch avoids full-table materialization; restore
the previous join to demonstrate the bound fails, then run one new preregistered changed-source cost cohort.
Do not assume this alone meets 16 ms or discard any previous failed qualification/cohort.
