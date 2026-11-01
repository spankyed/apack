# Actual text execution diagnosis — 2026-10-29

Preregistered source 4a89893fe8, one 10k profile, ten consecutive samples per path, two CPUs/6 GiB,
OFF commits, no retries or discarded samples. Five builds, syntax/lint and every expected answer pass.
This is diagnostic, not qualification; SQL, parameters, actual native plans, loaded hashes and raw timings
are retained. Each value below is the median of that measurement independently.

| Path | Facade total | Binding calls | Outside bindings |
|---|---:|---:|---:|
| point | 0.345 ms | 0.133 ms | 0.192 ms |
| crossField | 1.016 ms | 0.918 ms | 0.095 ms |
| medium | 3.435 ms | 3.299 ms | 0.137 ms |
| broad | 18.337 ms | 18.155 ms | 0.184 ms |
| highlights | 19.659 ms | 19.130 ms | 0.428 ms |
| recency | 49.814 ms | 36.318 ms | 13.253 ms |
| unlimited | 27.488 ms | 23.754 ms | 3.376 ms |

Broad limited reads spend almost all time in the main native statement. Its plan has three entity
lookups: each matched string, each aggregated candidate before LIMIT, and the returned prefix. GROUP BY
and sorting also use temporary B-trees. The implementation can carry the already available immutable
entity sequence through aggregates rather than looking it up again at ranking/output. This does not
claim that removing those lookups will by itself meet the target; measure the changed source.

Recency returns 10,000 scored candidates, then hydrates all timestamps through entity/value/overflow
queries and sorts in JS. Most time is in native bindings, with substantial remaining allocation/decoding
and sorting. This path needs a distinct native-value ranking design preserving numeric/Date/missing and
non-numeric semantics, one read clock, complete highlights and correct global/pipeline limits. Never
push an unadjusted score prefix ahead of recency. Existing full failed cohorts remain authoritative.
