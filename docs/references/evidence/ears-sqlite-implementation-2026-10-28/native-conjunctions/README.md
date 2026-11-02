# Native selective conjunction execution — 2026-10-28

Source is `409f08d468` plus `native-conjunctions.patch`; exact executed archive hashes are retained.
The earlier 10k cohort found selective/common reads regressing from ~0.29 ms to ~20 ms because every
clause materialized its whole matching corpus. This correction keeps source-string phrase semantics and
native FTS ranking, with no extra persistent term index, native extension or JS result-set intersection.

For a single conjunction, native count probes choose its first clause. Counts stop after at most
32/128/512/2048 eligible joined rows at successive levels, stopping when one clause is unsaturated. This
bounds counted output, not FTS posting traversal, rejected rows, tokenization or time. All-saturated clauses
can still choose a poor order. Counts only choose ordering; the final statement rereads current matches and
never truncates answers using an estimate. Subsequent clauses use FTS MATCH plus rowid constraints through
the indexed document-owner lookup. OR groups and `any` retain their previous positive score calculation.
Negative clauses only check candidate owners from the positive groups, preserving global exclusion semantics.

Tests cover rare/common and medium/common in both orders, exact scores/highlights for reversed conjunctions,
OR/any/exclusions including leading negations and multi-group disjunctions, absent fields, primary row
nonhydration and actual native MATCH+rowid/index plans. Removing the owner restriction makes the plan guard
fail; no runtime deadline is used as a unit assertion. Independent probe observations check returned counts
respect their bound and expand beyond the first level for medium groups.

One owned Linux arm64 container at a time, two CPUs/6 GiB, permission-denial preflight, pinned dependencies
and native engine; installs preserve the lockfile. Initial fixed-probe source passes focused cases/types/lint
and the removal control. Adaptive source passes five normal builds, benchmark syntax, types, focused search,
import/lint, the removal control, **42 pinned native search cases** and **473 SQLite EARS cases**. The sole
subsequent runtime change restricts negative matches to positive candidate owners; the converged snapshot
passes EARS build/types, benchmark syntax, **98 focused cases**, lint/removal control and **473/473 SQLite**.
No source condition, score expectation or original workload budget was relaxed. All raw logs/runners/hashes
are retained. Different snapshots are not silently treated as one exact whole-repository gate.

The preregistered six-process legacy/materialized/selective/selective/materialized/legacy cost cohort is
recorded in the benchmark README before execution. It adds both word orders, a 100-owner group/common
query, selective/global exclusions and a two-ticket OR to the identical fixture for all variants. No new
cost results are claimed here yet. The previous regression remains retained. Broad queries, index/build
costs, fuzzy bounding, representative app/search/vector and every phase 3–7 gate remain required.
