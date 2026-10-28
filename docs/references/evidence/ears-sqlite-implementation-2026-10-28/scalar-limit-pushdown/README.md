# Scalar sort limit pushdown — 2026-10-28

An immediately following limit now reaches the scalar ORDER BY. Sorting a 10k-row input for a 50-row page
returns 50 IDs to JavaScript rather than 10k, avoiding that larger ID array, JSON serialization and re-entry.
A filter, different sort, traversal or other intervening step prevents this optimization. Prior limits remain
part of the input. Validation still scans all candidates and refuses corruption even outside a returned prefix
or under a zero limit. Stable ties and duplicate IDs retain the established order.

This is a narrow SQL top-k path, not a claim of indexed ordering, bounded overall query work or complete
pagination optimization. ICU text/composite fallbacks and unbounded scalar reads still materialize their results.
SQLite still visits all candidates for validation and ranking; broader execution work remains in the goal.

Private Linux passes EARS types, **50 focused cases**, restored **18 cost/semantic cases**, and all nine
independent safeguard mutations fail meaningful assertions. The two new mutations remove the pushed limit
(512 sorted IDs instead of 7) or push through an intervening filter (wrong result prefix). The full SQLite suite
passes **296** with the same three inherited substring/regex failures. This is not complete-candidate acceptance.

## Statement profile

The committed profiling harness uses actual EARS queries over 10k reversed numeric ranks, for flexible and typed
layouts, sync disabled, 2 CPUs / 6 GiB, private Linux arm64 and Node 23.11.1. Five warmups precede ten explain
samples. Before source is `a82813ee38`; after is that commit plus exactly the implementation/test hashes retained
here. These are sequential diagnostic snapshots, not balanced fresh-process performance qualification.

Median instrumented query time changes **33.57 → 28.90 ms flexible** and **31.52 → 26.33 ms typed**.
The last before sample spends approximately 2 ms finding candidate types, 14 ms validating and 15 ms sorting
and returning all IDs. The after samples retain the full validation scan but return only 50 sorted IDs; the
final JSON-prefix query falls from about 0.5 ms to 0.06 ms. Captured SQL, bindings, returned counts and plans
support the narrower mechanism. Driver spans include marshalling/preparation and do not isolate allocator/VM costs.
Host variation and explain overhead mean these snapshots do not replace the paired benchmark's no-overall-win
finding or establish an application latency budget. Eligibility scans remain the next measured cost to address.

Full profile JSON, validation output, mutation failures, runner and source hashes are retained here. No compiler
or full suite ran on the daily Mac, and no other checkout's native build or mutable dependencies were borrowed.
