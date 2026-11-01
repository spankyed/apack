# Scratch-only SQLite DiskANN gate: not adopted

The prerelease `sqlite-vec@0.1.10-alpha.4` ([upstream release](https://github.com/asg017/sqlite-vec/releases/tag/v0.1.10-alpha.4)) was installed only under a private disposable prefix. Production remains pinned to 0.1.9; package manifests and the application lockfile are unchanged. The tested Linux ARM64 extension reports commit `04d28bd21773981e2d266bbf6aa4efbd011eb4f6`, native SHA-256 `aacb17cdfc11cf827528a217fcc20d6fed672119483a92322f89d8196185df05`. Source, npm integrity/lockfile, runtime/limits and logs are retained.

The exact gate source `5a7d763333` uses 512 deterministic negative-axis background vectors plus four positive/control vectors, dimensions 8, cosine, binary neighbor quantization, 16 neighbors and search_list_size 1,024. All 516 graph nodes exist. The same vectors/rowids and extension build populate an ordinary flat vec0 control. Results:

- DiskANN rejects metadata columns, matching the [pinned upstream compatibility tests](https://github.com/asg017/sqlite-vec/blob/v0.1.10-alpha.4/tests/test-diskann.py#L648).
- Direct access finds the exact-match row 10,001, preserves its canonical negative-zero bytes, and computes cosine distance zero.
- Asking DiskANN for K=1,024 returns 103 rows and omits that exact match; its closest returned row is 27 at distance about 1.868. This fixture exposes a retrieval failure; it does not establish general real-corpus recall or its root cause.
- More seriously, `rowid IN (SELECT value FROM json_each(?))` with the singleton [10,003] returns row 27 through DiskANN. The identical predicate on the flat control returns 10,003; flat unfiltered search finds the exact match 10,001. The ANN path fails this hard-filter contract independently of approximate ranking.

The original failing assertion is retained and the process exits nonzero. Transaction/savepoint/snapshot/backup/reopen controls later in the script are **not reached**, so they are unqualified, not passed. No real-corpus ANN latency, update cost or other-platform qualification occurred. Do not substitute a tiny flat pass or these failure diagnostics for the original goal requirements, and do not adopt this prerelease based on its feature list.

An earlier fixture attempt bound rowids as JavaScript numbers, which the virtual table rejected as non-integer; explicit BigInt bindings fixed the fixture without changing its data or assertion. Subsequent diagnostic and matching-flat attempts preserve and isolate the ANN failure. No upstream issue/message was posted.

Next evaluate another native strategy against the same transaction/filter/ownership requirements, or prepare an explicit execution-ownership proposal if preserving the synchronous facade cannot meet the original responsiveness budget. The existing correct SQL path stays in place and all goal phases 3–7 remain required.
