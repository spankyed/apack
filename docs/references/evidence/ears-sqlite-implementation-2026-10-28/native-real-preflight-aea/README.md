# Current native real-vector protocol preflight — 2026-10-30

Source `aea408425154c52f46de5b5abd8de6ba181c9922`, unchanged EARS production inputs through
0126eda005. The exact native elmdb binding and CLI at pinned revision
2441af4658d961f547c7094cd041c2ac246668c5 are verified against their recorded binary digests before use.
No second binding or mutable artifact from the other agent is loaded. One owned two-CPU/6-GiB/no-swap
container runs after quiet admission; no protective pause occurs.

The preflight uses 1000 actual 1536-dimensional vectors and the existing fresh-query/exclusion/truth protocol.
Every create/embed/trash/update unit commits with durable:true and default syncs enabled. Native default
ANN behavior is unchanged. Before querying each initial/updated phase, the matching independent CLI exports
a snapshot. A bounded framed MessagePack reader verifies all 1000 canonical Float32 vector payloads against
the corpus, by unique ordinal, plus frame count, schema/version, dimensions and end-of-file. Dump payloads
and temporary databases are removed; no corpus, database, vector payload or native binary enters Git.

All six phase/selectivity cohorts, four passes and 100 queries complete: 2400 measured queries, minimum
mean recall 0.999, all membership/uniqueness/finite-score checks passing. Observed p95 query latency ranges
from 0.274 to 1.580 ms; largest cohort/pass heartbeat p99 is 7.040 ms. Loading takes 92.2 ms for creates and
617.3 ms for embeddings; updates take 40.9 ms. The process peak RSS is 776048 KiB, which includes the entire
roughly 600-MB corpus buffer, not just the database engine. Total runner duration is 7.18 seconds.

This proves the protocol at 1000 rows, not the required 100k comparison or app adoption. Preflight timings
exclude root/where construction; the separately prepared full matrix moves the timing boundary before those
operations to match the candidate harness. Query vectors are prepared outside timers in both. Reopening the
connection does not evict the OS page cache and is never called disk-cold. This independent native ANN can
return different valid neighbors from SQLite; shared exact truth/recall and original latency/heartbeat budgets,
not paired rank equality across algorithms, determine usefulness. Different runs/machines/cache scheduling
still preclude a causal speedup claim. The complete 99900-row native matrix is running separately.

The previous expanded goal handoff is archived byte-for-byte as `prior-goal-handoff.md.gz` with its digest.
Its historical results and still-required work are preserved; it does not override the reconciled current
handoff or waive any acceptance condition.
