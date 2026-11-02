# Scratch vec1 text-IN optimization, 2026-10-29

Source `06777eb25b`, original/native/patched hashes in `patch-provenance.json.gz`.
This is a private feasibility patch, not an adopted dependency, production extension,
upstream submission or complete EARS execution strategy. The main runtime remains
unchanged and production still uses elmdb.

The previous UUID owner-IN test took seconds. The patch sorts all-text membership
operands once and binary-searches each generic text metadata value. It retains the
original path for mixed types, numbers and short lists. Storage format, canonical
vectors, SQLite transaction ownership and query API do not change. Membership work
changes from O(N*M) comparisons to O(M log M + N log M), ignoring variable string
comparison length; this is algorithmic inspection, not a measured profiler breakdown.

The patch is [reviewable source](../../../../../packages/apack-ears/bench/sqlite/vec1-text-in.patch).
It applies only to the pinned upstream source from the [compatibility gate](../vec1-compat/README.md).
Native binaries and upstream source are compiled only in capped disposable Linux.
No full third-party source or native binary is added to the app.

Both original and patched extensions pass 93 independent ordinary-SQL membership
comparisons across none/flat/IVF binary modes. Cases cover empty/singleton/7/8/9/large
lists, reverse order, duplicates, missing owners, case, Unicode, empty strings, embedded
NULs, mixed NULL/numeric/blob operands, additional metadata predicates, own updates,
nested delete rollback and outer rollback. The patched extension also passes all
20 existing small compatibility groups across four index modes, including held-reader
snapshots, compacted read-only backups and reopen. These are finite tests, not general
proof of a native fork's correctness or supported-platform safety.

Using the identical frozen model and real corpus, the ten-query UUID owner test returns
identical candidates/distances to its range control. Patched owner-IN p95 is **19.46 ms
for 9,889 owners**, versus **13.75 ms for 988 owners**. Range p95 is approximately
10–11 ms. The original seconds-scale result remains in [owner-scope evidence](../vec1-owner-scope/README.md).
The native binary differs intentionally; the benchmark requires explicit source/patch/
binary provenance tied back to the original model extension instead of silently
accepting different native code.

This removes the worst observed multiplicative cost but still fails the broad scoped
responsiveness requirement before EARS integration. Observed queries are exploratory;
no fresh held-out or whole-app acceptance follows. No production dependency changed.

Next inspect compact integer owner surrogates and membership execution before deciding
whether any extension change is worth owning. Preserve efficient arbitrary graph scopes,
filtering before K, own-unit/savepoint reads, deterministic owner aggregation, canonical
bytes and all admission/resource/platform/fresh-quality gates. A fork requires a deliberate
maintenance/upgrade/signing/distribution decision; this small patch alone does not settle it.

Other upstream sources checked during this checkpoint: [vectorlite](https://github.com/1yefuwang1/vectorlite#known-limitations)
documents pushed-down row-ID filtering but no transaction support, so it is not a direct
transactional index substitute. [libSQL vector documentation](https://docs.turso.tech/features/ai-and-embeddings)
shows a separate vector_top_k table-valued lookup; arbitrary pre-K graph filtering was
not established by that documentation and remains unqualified, not proven impossible.
The [SQLite vec1 guide](https://sqlite.org/vec1ref.html) owns its extension API. No external
issue, message or PR was posted.
