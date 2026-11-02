# Corpus resource measurement boundaries

The prior corpus probe sampled `memoryAfterQueries` and `maxRssKiB` after extra plan/native-probe/owner-projection diagnostics and native binary hashing. Those historical figures remain whole-process measurements at their actual sampling point, not isolated foreground-query memory.

The next run now records snapshots after native admission, after all queries and independent-reference work, and after diagnostics. Each snapshot records Node memory/resourceUsage and logical file bytes partitioned into main database, WAL, shared memory and other owned files. The query fields are taken before diagnostics and provenance hashing. CPU model metadata is also recorded. Snapshots are outside timed queries, contain no private filenames/payload and do not checkpoint, force GC or alter the connection.

These remain whole-process measurements. maxRSS is a cumulative process-lifetime peak including acquisition/setup/reference work; file totals are sampled logical lengths, not peak allocated disk, private corpus volume or an atomic filesystem inventory. Changes in a diagnostic phase cannot explain earlier query latency. No phase snapshot establishes full app/admission/streaming resource acceptance, cold/reopen behavior or the unchanged heartbeat target.

The current CLI qualifier requires resource and CPU metadata, checks all three phases, finite memory/counters, file partition totals, monotonic cumulative memory peaks and correct pre-diagnostic attribution. Historical report validation remains available without inventing absent fields. Pure controls:

```sh
python3 docs/references/evidence/ears-sqlite-implementation-2026-10-28/corpus-resource-protocol/control.py
```

Two valid current/historical shapes pass; nine missing/malformed/nonfinite/misattributed shapes refuse. This checks the protocol, not actual runtime resource behavior. [Actual cd4 snapshots](../corpus-cd4/README.md) now pass validation and retain failed heartbeat results.

## Sampled read-only reopening

The next harness source also closes and drains its writer/model owner, then performs three independent read-only opens. On each pass, the same eighteen preselected cohort/family/query combinations (three scopes, two query families, ordinals 0/37/99) must reproduce warm IDs and scores. Private reference answers stay in memory and never enter reports. Each pass records close/drain and open time, all query latency/heartbeat samples and a process/file snapshot. All reopen work occurs after the original warm-query and diagnostic snapshots, preserving their measurement boundary.

This is 54 sampled reopen queries, not three repetitions of the full 600-query workload. OS page cache is uncontrolled; no cold-disk or complete cold/reopen/model-variance acceptance is claimed. The CLI requires three complete passes on future runs; the already-running ed7 corpus source predates this addition. Pure controls accept the complete shape and refuse nine missing-pass/case, answer-parity, returned-count, invalid-query or nonfinite timing shapes. [Actual cd4 execution](../corpus-cd4/README.md) now completes all three sampled passes at each size; reopened heartbeat still misses the target at larger sizes.
