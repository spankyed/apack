# Full strict host suite deadline

[41212565910](https://github.com/spankyed/apack/actions/runs/41212565910) at `2cbafd7fb3` is terminal failure. Producers and four integration/native shards pass. The three candidate jobs fail their stale exact-eight private-file assertion, corrected separately at e2f569fa25 and requalified on all three platforms in 41215109929.

App-and-rest fails when `test:unit:host --all` reaches its unchanged 600s suite deadline. Progress records show 511 completed files: 507 passed, four skipped; new files were still queued immediately before termination. There is no completed suite result, so these are not a passing host gate. Largest completed file costs include recovery process-death scenarios (~81s) and SDK entry compilation (~75s). No deadline has been raised. The complete pinned-source gate remains required; inspect test placement/partition and costs before a new run. Raw chain, per-step and progress logs are retained with uncompressed-byte receipts.
