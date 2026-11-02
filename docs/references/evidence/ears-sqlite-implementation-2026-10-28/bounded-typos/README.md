# Query-derived typo alternatives — 2026-10-29

The behavior and 18 candidate-only useful-result cases are preregistered at **5e72c2dc14**, before the
implementation. The exact four-file implementation patch and source archive manifest are retained here.
Archival verifies every changed working file against the tested source archive. The original pre-change
text implementation is retained for the vocabulary-scan control. No dependency or extension is added.

`SqliteText` derives one-edit alternatives from folded ASCII letter/digit query tokens of length 5–32:
insertion, deletion, substitution and adjacent transposition. Native FTS owns matching/ranking/highlights.
There is no dictionary read, persistent spelling index or candidate truncation. Before deduplication there
are at most `73 * length + 35` alternatives per eligible query token, independent of corpus vocabulary.
The former Levenshtein scan and unused FTS vocabulary virtual table are removed together, including that
obsolete object's physical-recovery fixture. Other physical objects remain checked and reconstructable.
Format 1 changes in place; reset/rebuild candidate copies explicitly rather than add an old-layout shim.

The candidate deliberately supports one edit rather than the old two edits for words of nine characters
or more, while adding adjacent transposition at lengths 5–8. Lengths below five/above 32 and non-ASCII
query tokens remain literal. Quoted phrases, the final prefix term and `fuzzy: false` do not expand.
Alternatives remain enabled when a literal term exists; no exact-first or scope-dependent fallback is
introduced. These limits and differences are explicit candidate behavior, not a claim of universal typo
tolerance. Broader identifier/language usefulness and performance still require qualification.

## Exact validation

One disposable Linux arm64 container, two CPUs/6 GiB, dropped capabilities, real mode-denial preflight,
read-only dependency seed and pinned native 6ab2f69. The source archive starts at 5e72c2dc14 and adds only
the four manifest paths. Five package builds, EARS types, **93 focused cases**, all **509 SQLite / 289 native
EARS cases**, all four packages' API reports, lint and import checks pass. No API report changed.
`results.json` records setup only; named logs contain every later check and negative-control result.

The focused checks retain the unchanged shared 32-case relevance corpus and cover every edit position,
accent/case folding and original UTF-16 highlights, known-word neighbors, explicit two-edit refusal,
4/5 and 32/33 length boundaries, exact non-Latin terms, fields/boolean/exclusion/candidate scopes,
literal phrase/final-prefix behavior, units/rollback/watches and read-only reopen. Existing source-string,
physical recovery and builder search suites run alongside them. Tests do not compare exact elmdb scores.

The growth case forbids vocabulary queries, checks an actual native FTS MATCH plan, grows 1000 unrelated
unique indexed terms and verifies identical bound search expressions/SQL and the same useful answer.
Restoring the old implementation fails at its vocabulary query; removing the alternatives fails the
single-edit cases. Both controls exit nonzero for the intended assertions. The runner restores and checks
the fixed source after each mutation. This proves the query-work property for this implementation and
case, not constant total database execution time: postings and result work can grow with actual matches.

No latency or memory-speedup claim is made. The prior search cost cohorts disable fuzzy expansion and
cannot qualify this new default path. Next preregister and run a fixed-order default-fuzzy growth cohort,
retaining every first/warm call, answer, binding/resource/byte observation and failed trial. Full cold-store,
realistic search/vector, failed 100k admission/FULL and complete app/platform criteria remain required.
