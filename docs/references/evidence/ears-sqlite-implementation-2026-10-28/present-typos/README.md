# Native presence pruning — 2026-10-29

The preceding 9beb23ebc9 query-derived alternatives pass correctness but fail growth-cost acceptance.
The native counterfactual isolates redundant empty MATCH branches. This correction keeps the same
one-edit/length/alphabet behavior and alternative order, probing only generated ASCII words through
json_each and native MATCH EXISTS over the body/alias column set. EXISTS stops at its first hit. Native
tokenization/stemming decides presence; no vocabulary view, copied dictionary or tokenizer fork is added.
Only alternatives with zero native matches are omitted from the scored expression. The original literal
query stays present. Known-word neighbors remain included, independent of field/candidate scope.

The exact tested two-file patch starts at 2d2613c2c4; source manifest, patch and raw results are retained.
Archival verifies working bytes against that archive. One disposable Linux arm64 container uses two
CPUs/6 GiB, dropped capabilities, actual permission-denial preflight, a read-only dependency seed and
the pinned 6ab2f69 engine. Five package builds, EARS types, **95 focused / 511 SQLite / 289 native cases**,
all four packages' API reports, lint and import checks pass. No API report changes. Setup-only results.json
does not replace later named logs. The unchanged shared 32-case relevance corpus remains in the checks.

Two added cases preserve native Porter behavior (`relases` → releases) and camelCase alias matching, and
hold presence pruning, ranked selection and complete highlights in one snapshot while another writable
handle commits. The growth proof inspects actual native MATCH plans, identical generated probe input
before/after unrelated vocabulary growth, one returned present alternative, and the final scored MATCH
containing only the literal and genuinely present spelling. No vocabulary query or view is permitted.

Four controls fail for the intended reason: removing alternatives loses typo results; restoring the old
implementation reaches its forbidden vocabulary enumeration; bypassing presence pruning violates the
native-work guard; breaking the snapshot at the probe boundary returns Row-b instead of the required
incumbent Row-a. Both production/test mutations are restored, and source equality is checked afterward.

End-to-end performance is still pending. The new six-process preregistered growth cohort must include
the presence probes, compare both the original scan and rejected unpruned strategy, and retain every
size/path/sample. Native presence is not free, and the counterfactual's scoring-only gain is not an app
latency claim. Dense genuine typo neighborhoods, realistic languages/corpora, multiple-type searches,
memory/bytes, cold-store and full phase 3–7 acceptance remain required.
