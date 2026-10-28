# Batched projected ordering keys — 2026-10-28

SQLite ordering previously called `row(id)` for each candidate, loading all fields separately even when a sort
needed only a small key. It now uses the existing grouped `rows(ids, [field])` projection once for the candidate
set. The comparator, stable input ordering, null/missing rules, collation and duplicate-ID behavior are unchanged.
This removes per-entity SQL and unrelated value hydration. Mixed-value comparison still runs in JavaScript and
retains all sort keys; this is not completion of native typed sorting or a bounded top-k algorithm.

Disposable Linux passes EARS typechecking and all 34 focused query/value/cost cases. The full SQLite suite passes
280 cases with exactly the three inherited substring/regex failures still open. `sqlite.json` and `all-sqlite.txt`
retain those terminal results; no overall-green claim is made for the candidate.

Independent mutations prove the work bounds: per-entity projected reads issue 770 SELECTs for the 256-row test
and fail its at-most-16 diagnostic statement limit. Batched whole-row hydration stays batched but fails the
unrelated-body projection guard. Both restored cost cases pass. A second cost case preserves stable ties and
duplicate IDs across two types with different physical layouts. Raw passing/failing logs and source hashes are
included. The historical ~29× sort gap retains its own source/native provenance.

## Paired actual-facade trials

The maintained `bench.ts` fixture ran sequentially in nine fresh processes: three each for pre-change SQLite,
corrected SQLite and current native engine `6ab2f69`. Order varied across trials (before/after/native;
native/after/before; before/native/after). Profiles were fresh, syncs disabled, with 2 CPUs/6 GiB, Node 23.11.1,
SQLite 3.53.4 and the recorded native/vector binaries. This is not production durability or app acceptance.

All EARS implementation source hashes were checked against `59395aea0f` (before) or `31300a9532` (after).
The private measurement checkout retains HEAD at the latter while temporarily restoring the earlier query file;
the before provenance explicitly reports that modification, and its entire source map matches the earlier commit.
The benchmark code and dependencies are the same in both variants. `trials/expected-source.json` and both full
provenance reports preserve this distinction; do not treat a HEAD alone as the measured source.

For sorting 10k numeric keys and returning 50 IDs, the median of three process medians falls from **220.91 ms
to 56.95 ms**, about **3.88× faster**. Per-process medians are before 220.91/158.14/262.71 ms and after
60.26/51.68/56.95 ms. Current native medians are 8.12/7.74/7.11 ms; corrected SQLite remains about **7.36× slower**
by the same aggregation. Each process has five normalized batches of two sort calls, plus warmup; sample counts
and broad variability remain visible in the full raw facade reports. This improvement is specific to key hydration,
not proof that SQLite execution, mixed-value sorting, native top-k or application budgets are finished.

`trials/` retains all nine full raw JSON reports, stderr, runner/source hashes and summary. No failed sample was
removed. The comparison does not replace the earlier measurements or establish realistic search/vector relevance.
