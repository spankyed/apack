# Allocation-free integer-IN prototype — 2026-10-30

## Hypothesis and implementation boundary

The [native trace](../native-query-profile/README.md) identifies repeated per-block conversion of a complete
integer RHS. The [supported block controls](../supported-large-blocks/README.md) reduce block count but fail
responsiveness. A smaller private prototype searches the existing query-owned sorted 64-bit integer operands
directly when filtering compact 1/4-byte metadata. It adds no bitmap, allocation, ownership state, format or
ANN-setting change. NULL sentinels are explicitly excluded. Short lists, mixed/real operands and generic
metadata retain their preceding paths. The private earlier bitmap prototype is not used.

Source `5b531948f5` has unchanged EARS/native inputs from the strict-qualified product. The exact preceding
patched C source is compiled alongside the prototype with the ordinary flags. Its binary SHA256 is identical
to the packaged baseline. The ordinary package artifact is checksummed before/after and remains unchanged.
**Nothing here adopts or packages the prototype.** The C source, difference and compiler/input provenance are
retained; compiled libraries remain in the private disposable volume.

## Independent correctness controls

Each library passes **735 comparisons with ordinary SQLite**: all preceding 555 controls plus compact NULL
sentinels, full signed-64-bit/out-of-compact-range RHS, mixed real/integer operands and compact nonmatches.
Fifteen none/flat/IVF fixture groups exercise compact/sparse/full-width/mixed/real metadata, combined filters,
prepared reuse, updates, deletion and nested/outer rollback. Baseline and prototype each execute the same
extended controls, so a new fixture cannot silently redefine expected semantics.

A second diagnostic opens the same updated real-vector snapshot read-only under each library. Each completes
nine cohorts x100 actual EARS queries: **1,800 executions**, all **900 paired ordered hits/scores identical**,
minimum cohort mean recall **0.974**. The entire primary-file checksum stays unchanged. Every large eligible
cohort executes the expected native candidate calls. Existing model/ownership guards are not changed; this is
an explicitly trusted-library fixed-model counterfactual, not fresh model-owner/upgrade qualification.

## Attribution and limitations

Filtered native metadata timer ticks decrease in this observation, consistent with removing per-block RHS
conversion. All raw timings/counters are retained in `summary.json` and the complete reports. The guard pauses
only our container for another build; wall markers and events remain present. Hardware ticks are not CPU time,
and fixed-order/warm-cache/paused observations do not certify a causal speedup. Unfiltered scanning, repeated
SQL scope work and deferred durable COMMIT remain separate costs. The query sample is updated-only and one
pass, not the full initial/update four-pass acceptance matrix. Responsiveness is not established.

Before promotion, qualify the complete fixed-model initial/update matrix, unit/savepoint/multi-chunk/freshness
behavior, fresh actual owner lifecycle, all affected platform/package/signing inputs and unchanged app gates.
No threshold, assertion, durability mode or checkpoint policy is relaxed. One owned container uses two CPUs,
six GiB/no swap/dropped capabilities after quiet admission; no other build is stopped and no daily-Mac compiler
or full suite runs. Corpus/model/database/native-binary payloads remain outside Git. Integrity receipts verify
all retained original/stored bytes.
