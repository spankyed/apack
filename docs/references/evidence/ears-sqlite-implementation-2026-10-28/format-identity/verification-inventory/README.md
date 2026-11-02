# Require named safety cases instead of a stale total

On runtime source `f731a4a549`, Linux completes its runtime checks but the final verifier fails `28 !== 27`:
adding WRONG_FORMAT classification expanded the selected cases. The new real foreign-history refusal was
also not selected by the old pattern. macOS and Windows likewise complete their earlier steps and fail at
“Verify candidate cases actually ran”; their specific assertion logs have not been retrieved here.

The verifier now selects the actual foreign-history case and requires all **29 named publication** and
**19 named identity** cases, including the killed-writer WAL and primary-table checks. Every selected case
must pass and names must be unique. More passing cases are allowed; they cannot replace a missing required
case. Verification records the actual identity/publication totals without asserting a fragile fixed total.

Eight controls execute the actual selectors, helper and production call sites against the real passing
reports. They accept current cases, an additional passing case and Windows path separators; missing foreign
history, skipped WRONG_FORMAT, missing WAL, skipped primary refusal and duplicate names are rejected. Node
syntax parsing passes. This changes the CI verifier only; no application/storage/signing runtime changes.

Signed installed run **41106578424 passes on f731a4a549**, including the strengthened persisted-identity witness.
The metadata is retained. Its job-log download returned HTTP503; no downloaded-log claim is made. The same
strict run **41106571398** still has other jobs in progress at the retained snapshot and must be preserved.
Final exact-source CI and all remaining goal gates remain required.
