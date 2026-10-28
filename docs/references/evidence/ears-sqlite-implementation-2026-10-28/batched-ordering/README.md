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
included. No new latency improvement is claimed before paired measurements; the historical ~29× sort gap keeps
its own source/native provenance.
