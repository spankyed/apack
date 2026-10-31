# Ranked text prefixes and late highlight fetch — 2026-10-29

Exact tested source is 7be59bc2c1 plus `text-prefixes.patch`; the converged archive manifest is retained.
Only adjacent limits or terminal first/exists are pushed into native ranking. Later filters/orders/cursors
and hybrid fusion retain their original scope. Each type contributes a sufficient prefix before the global
limit. Recency ranks all candidates before slicing, uses one clock per query step, and decodes only its date
field. Positive half-life supports numeric and Date timestamps; nonpositive half-life preserves base scores.

A native ranked prefix precedes matched-string expansion. Bounded highlighted hits first select entity
scores/owners, then fetch complete highlights for that prefix in the same read snapshot. Field projection
avoids hydrating unrelated overflow values. The single-positive-clause SQL avoids a redundant aggregation.
No API, storage format, extension or dependency changes are introduced.

The converged disposable Linux arm64 run passes five package builds, types, API reports, lint/imports,
67 focused cases, 43 native search cases, **483 SQLite cases and 289 native cases** (194 SQLite-only skips).
Five removal controls fail as expected: remove the native limit, remove selected-only highlight fetch,
prematurely cap recency, cap across a later filter, and hydrate the full primary row. Tests observe actual
native returned rows and highlight calls and commit a concurrent writer between score and fetch to verify
snapshot consistency. Baseline native passes the added shared recency regression while old SQLite fails.
The first prefix attempt fails typecheck on the fixture ID's string inference; the corrected source is kept
separately from that failed attempt. Intermediate score/fetch proof is retained too.

`results.json` records setup subprocesses only; individual result logs and the fail-fast validation runner
record subsequent checks. Archives retain their failed negative controls, not false all-green claims.
The preregistered legacy/postings/prefix/prefix/postings/legacy cost cohort has **not run**. Broad reads,
highlights, recency, write/build/storage cost and all remaining goal requirements remain unaccepted.

Published 7cba75f431 CI run 40814018368 has an app/recovery failure: elmdb canonicalizes a parent alias
(`/var` to `/private/var` on macOS), but recovery compares its stored destination with the caller spelling.
The retained log shows both elmdb crash cases fail preparation validation; SQLite cases pass. This is a
real recovery bug to fix, not grounds to normalize away the test. Canonical remains at 585dcafccf.
