# Vector unit visibility regression

Source 45e5e360f4 adds a shared contract in tests/engine/vector.spec.ts: rank embeddings written in the current unit, nested rollback, trash filtering and outer rollback without advancing the commit. This protects the synchronous transactional requirement before changing execution ownership.

The first disposable Linux setup copied an older dependency seed without lockfile reconciliation; EARS build refused Ajv types, and no tests ran. The corrected runner installs with scripts disabled, asserts byte-identical package-lock, then builds. It uses the same immutable seed and native checkout, two CPUs/6 GiB/no swap, capability removal and a real permission-denial probe. No daily-Mac build ran.

Corrected source passes package builds, EARS typecheck and all 17 SQLite vector cases. Pinned elmdb passes 16 and fails the new case, returning the first owner where the second is expected within the unit sequence. The outer error matcher masks the precise internal assertion site; isolate the individual checkpoints before attributing the cause. Native source writes embeddings into the transaction and journals graph changes for flush, but that observation alone does not establish which path caused this result. The original failure is retained, not skipped or relabeled as success. Lint was after the failed native step and therefore did not run.

This is an unresolved baseline discrepancy, not evidence that SQLite lost data. Do not mutate another agent's engine checkout or silently change the pinned baseline. Preserve the contract, isolate the failure and disposition it explicitly before claiming shared-suite acceptance. Native source remains 6ab2f69fa13289ed4f02952253c58b4d41922c98; the broad green 6cf checkpoint precedes this new test.
