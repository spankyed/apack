# Source-string FTS documents — 2026-10-28

Source is `9a2771ec25` plus the retained `source-string.patch`; each executed snapshot has its own archive hash.
Only documentation changes followed the final execution snapshot. The patch also records the benchmark fixture
and source-condition config corrections. All validation executes in owned Linux arm64 containers, one at a time,
two CPUs, 6 GiB, dropped capabilities, permission-denial preflight and pinned native engine/dependencies.

The former one-row-per-entity FTS document joined list strings. Native phrase positions could cross the join;
negation then excluded valid entities. Unicode61 did not expose camelCase components. The new private
`SqliteText` owner stores each nonempty source string as a document, preserving its field and original list
position. SQLite materializes FTS clause hits, combines them by entity, applies OR/AND/any and global exclusions,
and ranks natively. It hydrates no primary text rows for ordinary ID search. A per-generation owner lookup
makes deletion selective and participates in missing-object checks, background repair and bounded retirement.

Original text remains indexed. An optional alias column inserts spaces at camelCase/acronym boundaries, retaining
source offsets through sparse insertion positions. Native original/alias highlights merge into UTF-16 source
ranges. Whole lowercase identifiers still match their original token. No custom native tokenizer, extension or
full-corpus JS filter is introduced. Per-field hashes and changed-input selection keep name updates from reading
or replacing unrelated overflow body strings. A row updated ahead of a new generation's cursor still receives
complete initial postings. Format-one table/hash metadata changed in place; use fresh/reset copied profiles,
not an implicit upgrade of daily-use data.

Ranking deliberately changes: BM25 is per source string, each positive clause takes its best weighted field,
and clause scores sum. That choice meets the curated useful-result expectations but still needs realistic
relevance and resource qualification. Broad common terms may materialize many native clause hits; fuzzy
expansion still scans vocabulary. Neither limitation is waived by this checkpoint.

Validation and retained failures:

- First representation: EARS build/types, **94 focused cases**, lint pass. Import check cannot load SDK dist
  because that harness built only EARS. This setup failure is retained.
- Selective fields: five normal package builds, EARS types, **95 focused cases** pass. Import check then
  reports the root EARS Vitest source condition; both root and benchmark configs now explicitly declare it.
- Converged source: five builds, benchmark syntax, types, **95 cases**, actual import check and lint pass.
  Removing identifier splitting fails the unchanged component case; restoring list joining fails both phrase
  cases; removing selective text input reads fails the 100-large-string overflow guard. Sources restore before
  the whole suite. Full SQLite EARS initially reports **470 passed / 1 failed**: plain Node source loading
  rejects the new TypeScript constructor parameter property. No deadline or assertion changes.
- The sole runtime correction replaces that parameter property with an ordinary field assignment. The focused
  plain-Node source-storage probe, EARS build/types and full SQLite suite then pass: **471/471**. This includes
  the unchanged 32-case relevance corpus, transactional shape changes, mixed-list offsets, acronym/whole-name
  highlights, original index-plan guards, interrupted admission, watches and both new missing-owner objects.
  Earlier checks cover the same source except that constructor declaration and documentation; no new import
  graph or behavior changed in that correction.

Strict CI [40804552364](https://github.com/spankyed/apack/actions/runs/40804552364), exact published e5fe7ea16b,
completed FAILURE in producers: benchmark Vitest lacked the repository-required source condition. Consumer
jobs were skipped. This is separate from the preceding recovery-child failure. Its log is retained here;
config corrections pass the actual Linux import guard. Canonical remains on green 585dcafccf. Do not dispatch
another full gate until the new functional/cost checkpoint converges; do not promote on an ancestor's success.

Before accepting shape costs, run the preregistered old/new/new/old four-process 10k diagnostic in the benchmark
README. Preserve build/admission cost, calls, all point/cross-field/broad/update samples, sampled bytes/RSS and
heartbeat. Its old source is 9a2771ec25, new is this converged implementation. No measurement is claimed yet.
This remains diagnostic; the failed 100k heartbeat cohort, FULL, representative languages/relevance, bounded
fuzzy handling, real/high-dimensional vectors, full app/maintenance and OS/filesystem/packaging gates remain open.

Primary SQLite references: [FTS5](https://www.sqlite.org/fts5.html) and
[CTE materialization](https://www.sqlite.org/lang_with.html#materialization_hints).
