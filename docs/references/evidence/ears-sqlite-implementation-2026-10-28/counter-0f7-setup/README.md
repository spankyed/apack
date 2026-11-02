# Counter guard setup refusal at 0f7

[Run 41317559397](https://github.com/spankyed/apack/actions/runs/41317559397), source `0f7d91c2b2`, is terminal setup failure. Package/API preparation fails TS18046 in database.ts:468: the newly introduced unknown counter is not narrowed after calling the const throwing helper. Source now uses explicit return-fail branches to make control-flow termination visible. Runtime refusal semantics are unchanged.

Contract, type/lint, WAL and resource checks skip; required-model checks fail because reports are absent. The attempted copied-profile conversion fails on the missing package graph manifest, also a downstream setup refusal. No new counter case or replacement outcome is qualified by this run. The corrected source must rerun actual build/type/API/native tests. No assertion is waived.

Only the inspected primary compiler-error excerpt is retained, unchanged through gzip with excerpt range, byte length and digest of the complete original failed log. Full logs/artifacts remain in CI/private download. No input data, binary or database is copied.
