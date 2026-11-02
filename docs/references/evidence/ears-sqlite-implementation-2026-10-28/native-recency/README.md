# Native timestamp recency before ranked prefixes — 2026-10-29

The preceding plan/cost evidence shows generic recency returning and hydrating all 10k candidate timestamps.
This correction joins the existing authoritative field source and computes decay in native SQL before the
ranked prefix. Numeric, negative-zero and Date cells decay; missing and nonnumeric cells retain base score.
Finite query clocks/half-lives use this path; nonfinite options retain their preceding generic JS behavior.
Adjusted-score ties retain base-score order, then immutable entity sequence. No additional storage, native
extension, dependency or public API is introduced. SQLite's bundled pow function is exercised by real reads.

Bounded recency hits select the adjusted-score prefix, then fetch complete highlighted source strings in the
same read snapshot. Later filters/cursors/reorderings preserve their scope; global type merging still uses
its existing ordering. Hybrid text ranking remains complete. Timestamp updates inside a unit are visible,
rollback restores the incumbent, and outside-prefix writes invalidate watched reads.

Exact tested runtime is b5767d189a plus native-recency.patch (manifest retained). One disposable Linux
arm64 container at a time, two CPUs/6 GiB, dropped capabilities and permission-denial preflight. The corrected
snapshot passes five package builds, EARS types, **75 focused / 491 SQLite / 289 native cases**, lint/imports
and API reports. Disabling native recency fails the permanent candidate-hydration guard. Actual returned
rows equal the requested prefix; tests also independently compute expected generic-value decay/order and
cover underflow ties, mixed flexible fields, declared slots, read-only reopen, dynamically admitted scalar
slots retaining incumbent overflow, units/watches and concurrent timestamp/text writes between score/fetch.
The first attempt fails typecheck because its fixture incorrectly declares a date schema type; the existing
any declaration stores Date values correctly. The failed attempt remains separate and is not acceptance.

The benchmark-only protocol/fixture addition follows this runtime archive: add recency-highlight reads to
both pinned controls, then one sequence/recency/recency/sequence cohort. Its results are not yet available.
The previous latency failures, fuzzy vocabulary scan, real relevance/vector/app/packaging requirements and
all remaining phase 3–7 acceptance criteria remain. Functional correctness alone does not establish cost.
