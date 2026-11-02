# Current signed installed Preview qualification — 2026-10-30

[App acceptance 41144824212](https://github.com/spankyed/apack/actions/runs/41144824212) passes at
`49d6426961b7e02a361e3c115474f28aae89389e`, including the current CLI backup/close corrections. The preceding
[full strict checkpoint](../strict-1eb/README.md) qualifies identical production inputs; the later commit adds
only documentation/evidence. No release, deployment, production selection or daily-profile conversion occurs.

The actual downloaded Playwright report contains six expected passes, zero skipped/unexpected/flaky cases,
and one passed attempt with retry zero for every case. The mandatory packaged SQLite case executes through
the real installed API process. Its source verifies both primary/history SQLite header identities and kernel
model-owner claims while the packaged app runs in an isolated profile. Five additional cases cover launch,
connection, application state/surfaces, profile isolation and absent ordinary-session publication.

The successful job also builds the unsigned Preview, typechecks installed contracts, runs packaged native
smoke, signs with Developer ID/hardened runtime and verifies the sealed app strictly. Native smoke before and
after signing claims ownership, trains a vector model in a worker, queries FTS/regex and reopens read-only.
Signing records changed library bytes and refreshes their provenance before outer sealing. The original job
log, downloaded reports, native/signing/build logs and integrity receipts are retained losslessly.

This is **macOS arm64** installed qualification for these six cases, not every UI/CLI/pack workflow or all
OS/architectures. The alternate SQLite-platform job is skipped by this suite selection; its platform evidence
belongs to full strict. The failed responsiveness, representative relevance/load, physical I/O/directory
recovery and requirement-by-requirement adoption criteria remain open. Future relevant runtime/native changes
need affected installed qualification again; documentation-only checkpoints do not require repetition.
