# Indexed native timestamp selection — 2026-10-29

The adjacent recency-plans evidence observes MATERIALIZE r and SCAN v in both score and selected-highlight
statements. Replace the nested LEFT JOIN with a correlated scalar selection from the same authoritative
field source, using the accepted entity ID. Missing cells retain base score through coalesce; numeric/Date
semantics, base-score ties, snapshot/owner/clause behavior and prefix scope remain unchanged. No new index,
storage layout, extension or API is added.

Exact tested runtime is a3f390fa6a plus selection.patch (manifest retained). One disposable Linux arm64
container at a time, two CPUs/6 GiB, dropped capabilities and real permission-denial preflight. Final checks
pass five package builds, EARS/host types, **76 focused / 492 SQLite / 289 native cases**, 34 host recovery
cases, lint/imports/API reports and two negative controls. Native recency disablement trips the candidate
hydration guard. Restoring the preceding native join fails the selected-stage plan guard: the old plan
scans the timestamp value table; the new unmodified plan uses primary-key/index probes. Requested highlight
rows, winner and complete field highlights remain checked independently.

The first attempt's value-function observer was insufficient: the old join also passed it, so validation
stopped. Its raw results/source manifest are retained, not treated as a successful negative proof. The revised
guard inspects unmodified native SQL, without wrapping timestamp expressions or changing optimizer inputs.
This proves the selected-stage access path on the pinned distribution, not a universal elapsed-work bound.
The host cases include the Windows-junction fixture correction's unchanged POSIX branch; actual Windows
recovery/platform qualification remains open.

Next execute the preregistered materialized/indexed/indexed/materialized cost cohort on committed source.
Functional proof does not accept latency or replace any previous failed cohort, phase 3 gate or remaining
search/app/operational/platform requirement. Bounded fuzzy search is the next major search implementation gap.
