# Native scalar ordering — 2026-10-28

Numeric, boolean, date and null/missing sort keys now use SQLite ordering. Eligibility follows actual stored cell
kinds, including unchecked repairs, rather than assuming the declared field rule proves their contents. A scalar
probe defers unsupported or malformed cells to the established projected decoder/ICU comparator. Text, bytes,
arrays and composite values retain that fallback. Locale/options validation remains unchanged.

The source view retains missing attributes through primary rows and admits only each entity's actual physical
type. Missing primary records reach the existing corruption refusal; a stray row in another type cannot substitute
for them. Candidate types come from the already-filtered/limited input, so unrelated physical tables and empty
inputs are not inspected. Type-source order is canonicalized without changing caller order or stable ties.

SQL casts numeric values to REAL to preserve the driver's JS-number rounding of SQLite integers. Signed-zero,
null/missing and input-order ties stay stable. Fractional timestamps use the decoder's date clipping through the
fallback. The path still materializes all sorted IDs and restarts the pipeline; it does not implement top-k
pushdown or claim bounded sort memory.

Private Linux passes EARS types, 48 focused query/value/cost cases and the restored 16 cost/semantic cases. The
full SQLite suite passes **294**, with the same **three inherited substring/regex failures** still open. The JSON
and logs retain those exact results; this is not a complete-candidate green gate.

Seven independent mutations fail the intended safeguards: bypass SQL execution through hydration; compare raw
64-bit integers instead of driver-rounded doubles; omit primary-row presence; drop missing flexible values;
skip date clipping; admit another type's stray row; or inspect unrelated physical tables. The fixed suite is
rerun after restoring the original sources. Cases also compare both directions against the ICU fallback on a
mixed scalar corpus, plus prior limits/order, duplicate IDs and embedded-NUL field fallback.

The implementation under strict CI remains `683e1d5912`; this change is its local descendant until reviewed gates
and publication. All remaining schema/index/search/vector/app/IO/platform requirements remain in the goal.

## Paired timing outcome

Nine fresh-process actual-facade trials use the unchanged benchmark with sync disabled, 2 CPUs / 6 GiB in
private Linux arm64, Node 23.11.1, current native `6ab2f69`, SQLite before `683e1d5912` and after
`9f0cd225be`. Order varies before/after/native, native/after/before, before/native/after. Each process supplies
five batches, normalized per sort call. The median of the three process medians is **38.24 ms before,
41.21 ms after, 5.89 ms native**: the scalar path is **7.7% slower** overall and **7.00× native** in this cohort.
Individual process medians before are 73.11/38.24/37.09 ms and after 42.58/41.21/36.07 ms; this variability
precludes claiming a stable regression size or a general speedup. This is synthetic sorting, not app qualification.

SQL scalar ordering removes JS comparison/key decoding, but introduces candidate-type and validity probes and
re-executes the input for the final sort. Those costs are plausible causes, not isolated measurements. Keep
its semantic/cost tests; before treating the path as a performance improvement, profile these statements and
combine eligibility/key materialization with execution or push a bounded top-k through the pipeline.

[Paired trials](paired-trials/) retain every JSON/stdout/stderr, exact source maps, loaded binaries, harness and
summary. Both provenance snapshots identify checkout HEAD `9f0cd225be`; the before snapshot has its complete
EARS source replaced by the trusted `683e1d5912` Git archive and a corresponding dirty status, independently
verified against every expected source hash. The after snapshot is clean. Dependencies and benchmark stay the
same. The initial harness failed before any samples because this Linux Python lacks the extraction `filter`
argument; the corrected runner uses system tar on these trusted Git archives. No failed timing run was discarded.
