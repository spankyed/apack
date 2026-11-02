# Completed strict run at 6cfdf32dad

[Actual strict run 41236766386](https://github.com/spankyed/apack/actions/runs/41236766386) is terminal **failure**. Producers and all four integration/native shards pass. Producer chain execution takes 696.0s on two cores; `typecheck:scripts` takes 37.7s within its unchanged 60s deadline.

The four failed jobs are the three SQLite platform jobs and app/rest. [Platform receipts](../strict-platforms-6cf/README.md) retain the text-only relevance miss plus the stale K=33 routing assertion. [App/rest receipt](../strict-host-6cf/README.md) retains 6,893 pass/1 fail/84 skips; its only test failure is the same relevance judgment. No timeout or dependency-declaration failure remains in this run. Required skips and later unexecuted steps still need their final acceptance disposition.

This complete job ledger is evidence for its pinned source only. Later focused da1636c9ea qualifies the corrected K=64/K=65 witness and subsequent reference/subscriber/type-discovery correctness, but does not replace a final-source strict/platform/app gate. No broad green status, production adoption, merge or release is implied.

`summary.json` preserves inspected terminal job identities/statuses, producer timings and the raw producer-log digest. Complete logs and compiled outputs remain in CI/private local evidence and are not copied here.
