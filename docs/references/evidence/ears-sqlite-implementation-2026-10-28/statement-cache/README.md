# Bounded statement retention — 2026-10-28

The owning SQLite connection now retains prepared statements in lru-cache 11.5.2, bounded by **256 entries**
and **1 MiB of UTF-8 SQL key text**. This is an explicit EARS runtime dependency, already present at that version
elsewhere in the lockfile, not a dependency borrowed through another workspace. Hits refresh recency. SQL larger
than the text budget still prepares/executes, but is not retained and does not evict existing hot statements.
Eviction drops only the cache's reference; a statement borrowed by a caller remains usable. Close clears all
owned cache entries before subsequent CLOSED refusals.

These are provisional cache configuration values, not representative application performance/RSS acceptance
budgets. They bound retained cache entries and counted SQL text, not compiled SQLite VM allocations, external
references, garbage-collection timing or total process RSS. Sustained application memory/load qualification
remains required. This removes one unbounded owner retention path without claiming an overall memory bound.

## Verification

Private Linux arm64, Node 23.11.1, 2 CPUs / 6 GiB, immutable native 6ab2f69:

- Types and **79 focused query/schema/watch/cache/module-state cases** pass, initially and after mutations.
- Six independent mutations fail meaningful assertions: excessive entry allowance, excessive byte allowance,
  counting UTF-16 units instead of UTF-8 bytes, reading without recency promotion, retaining oversized SQL,
  or omitting cache release on close.
- Tests churn 600 distinct statement shapes and 600 real EARS dynamic-field query shapes, verify returned values,
  keep a repeatedly used statement hot, force byte eviction below the entry limit with multibyte SQL, execute
  oversized SQL twice without retaining it, preserve borrowed statements and isolate connection caches.
- Full SQLite **353 pass, three fail**, the same inherited containing/matching cases. This is not full acceptance.
- All five publishable packages build through normal prerequisites and **all three EARS API reports pass** unchanged.

Exact sources/manifests/lock hashes, logs, negative proofs and runner are retained here. All compilation/full
validation is disposable; no daily-Mac Rust/compiler build or shared mutable dependency write occurred. The
published strict run 40703362139 still covers 194c72c77c, not this local descendant.

Library options follow the [lru-cache documentation](https://isaacs.github.io/node-lru-cache/); the resource
configuration, statement lifetime and EARS correctness expectations remain owned by this package.
