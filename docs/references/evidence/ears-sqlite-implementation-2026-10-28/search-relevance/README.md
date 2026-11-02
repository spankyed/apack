# Shared search relevance corpus — 2026-10-28

Preregistration `2cca9f1b06` adds 28 curated repository-domain documents and 32 useful-result expectations.
Names, code symbols, notes, tags and recovery terminology reflect the app/SDK domain; no private developer data
was read. This is a first contract corpus, not a representative production relevance or language qualification.
Cases assert required/forbidden results, two useful first results and exact source highlights; they do not demand
identical backend scores or full rankings. High-dimensional vectors and realistic corpus scale remain separate gates.

The first run stopped at TypeScript: fixture IDs were annotated `string`. `882e03734e` changes only the ID type.
The next run passes types and records elmdb 31/32, SQLite 21/32. Two fixture defects are preserved rather than
silently relabeled: a Python default had turned the intended default-fuzzy case into `fuzzy:false`, and the
identifier-component case accidentally matched a tag. The retained patch restores intended `{}` options and
restricts that case to the name field. No required/forbidden result, phrase boundary, score or time budget changed.
With those input corrections, pinned elmdb passes all 32 cases.

Candidate source is `882e03734e` plus `verified-search-fixes.patch`, exactly hashed in the archive manifest.
One Linux container per run, two CPUs, 6 GiB, dropped capabilities and permission-denial preflight; dependencies
leave the lockfile unchanged. EARS build/types and lint pass. The corrected corpus passes **29/32 SQLite**;
existing shared search contracts pass **10/10**. A separate full SQLite EARS run reports **460 passed / 3 failed**,
with exactly the same three unmet corpus requirements and no additional failures. Failed logs are retained;
this is not a green acceptance checkpoint and has not replaced the published branch under strict CI.

Implemented contract corrections:

- Read the actual recency field before scoring; custom timestamps now affect both ID and hit order.
- Honor `any`, group positive disjunction before exclusions, support declared field-qualified clauses,
  and apply prefix matching only to the last query word.
- Let native FTS tokenize the original query instead of stripping marks from every script. This preserves
  Greek accents and Japanese dakuten for exact matching. New FTS tables use `unicode61 remove_diacritics 2`
  (optionally wrapped with English Porter), fixing multiply-accented Latin characters. These candidate
  format-one layout fixtures are fresh; reopening an older table does not change its tokenizer. Reset/rebuild
  copied candidate profiles explicitly; no legacy upgrade or live daily-data migration is introduced.
- Detect literal FTS marker bytes in authoritative payloads and choose verified absent UUID delimiters before
  parsing highlights. Original control characters and UTF-16 offsets remain intact; the extra FTS select occurs
  only when the default markers collide. This does not change text scoring or adopt probabilistic offsets.

Still failing and required: camelCase component discovery in the selected field; a positive phrase crossing
list elements; and a negated phrase incorrectly excluding a split-list match. Whole identifiers, scalar phrases,
ordinary list highlights and cross-element AND already pass. Resolve the native document/token representation
rather than weakening these cases. Evaluate changed index bytes, write/build cost and foreground latency when
that representation changes. Fuzzy expansion still scans the full vocabulary; realistic relevance/languages,
bounded typo handling, search growth/resources and vector recall remain open.

FTS behavior was checked against SQLite's primary documentation:
[Unicode61](https://www.sqlite.org/fts5.html#unicode61_tokenizer),
[Porter](https://www.sqlite.org/fts5.html#porter_tokenizer), and
[highlight](https://www.sqlite.org/fts5.html#the_highlight_function).
The exact runner files, source archive hashes, raw logs and patch are retained beside this document.
