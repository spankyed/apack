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
pushdown or claim bounded sort memory. No new latency result is claimed before paired measurement.

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
