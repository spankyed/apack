# Native owner-postings candidate — 2026-10-28

Source is `abc6c3af2b` plus `native-owner-postings.patch`; exact tested archive hashes are retained. The
preceding rowid-selective approach is rejected by the retained medium-query cohort. This candidate indexes
an owner token `e<immutable entity sequence>` in each FTS string document. SQL composes a native MATCH
expression intersecting the owner postings with the text clause, avoiding repeated rowid-constrained MATCH.
There is no new native extension, persistent custom posting implementation or JS set intersection.

Owner terms have zero BM25 field weight and are excluded from text vocabulary expansion. Text query branches
still restrict to body/identifier columns, so owner metadata is not user-searchable. The extra indexed token
does affect FTS document length and storage: ranking/resource qualification must cover that change. Primary
entity values and the entity-sequence allocator remain authoritative; fresh/reset copied format-one profiles
are required after this derived layout change.

The final statement constructs masks from current positive clause matches. At most 2048 distinct owners are
encoded; larger sets use the unrestricted clause. No sampled estimate truncates answers. Native expression
observation verifies a 2000-owner mask and an untruncated 2200-owner fallback. Trace functions exist only in
tests. No application-side SQLite function or extra native dependency is introduced. Empty queries now avoid
the previously unnecessary full vocabulary read; nonempty fuzzy expansion remains an unbounded follow-up.

One isolated Linux arm64 container at a time, two CPUs/6 GiB, dropped capabilities and permission-denial
preflight, pinned dependencies/native engine. The first two typechecks refuse the test observer's function
registration: the driver requires three arguments, including an explicit deterministic option. Those failed
setups are retained. Correcting only that observer to the actual driver interface allows EARS build/types,
**100 focused cases**, lint and a native-filter removal control to pass. Cases include the unchanged 32-case
relevance corpus, both query orders, OR/any/exclusions, original/mixed-list UTF-16 offsets, transaction/reopen,
background generation/recovery, primary-row nonhydration, bounded masks, private metadata and empty queries.
Removing the native owner suffix makes the actual MATCH-expression guard fail. Full-suite and new cost
qualification are not claimed yet; the previous 473-case source is a predecessor, not this exact candidate.

The next preregistered legacy/rowid/postings/postings/rowid/legacy cost cohort uses exactly the same updated
fixture as the failed rowid cohort, with all samples and storage/build costs retained. Do not accept a point
win alone, relax a budget, or replace either failed cohort. Broad queries, build/index costs, fuzzy, real
relevance/vectors, full app/maintenance and all remaining phase 3–7 requirements stay open.
