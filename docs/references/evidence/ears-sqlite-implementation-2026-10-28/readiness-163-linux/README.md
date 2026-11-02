# Linux scoped-readiness regression control

The Linux platform job of [strict run 41326246856](https://github.com/spankyed/apack/actions/runs/41326246856), source `16378a24db8463584dbe9fd4a1eb1a4d6c57ca48`, finishes with 919 EARS passes/one retained keyword failure/no exclusions, and 289 host passes/no exclusions. All three mandatory SQLite scope/cancellation/refusal cases and five mandatory host ownership/lifecycle cases pass. The changed API report is committed at this source.

The real regression control temporarily restores the old global database wait. The selected isolation test then fails specifically on the injected unrelated backfill failure (zero passes, one expected failure, eleven unselected cases). The control requires exactly that case/error, restores original source and verifies byte equality plus a clean source diff before continuing. Its CI step passes. This is a real mutant execution, not a metadata-only proof; `scoped-readiness-negative.json.gz` records an expected failed test, not a production test pass.

All three original reports are compressed unchanged with decompressed SHA-256 hashes. Final platform verification remains red on the retained keyword judgment. This source predates the installed-pack fixture and owner-race correction, so neither is claimed qualified here. Arbitrary filesystem/power-loss and final integrated acceptance remain separate.
