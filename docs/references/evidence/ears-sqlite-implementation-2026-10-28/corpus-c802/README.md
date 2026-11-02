# Managed corpus at c80289641c

[Run 41256553252](https://github.com/spankyed/apack/actions/runs/41256553252) completed successfully at `c80289641cafed824ad8e0789b9adce3217e5d58`, before the relation-key rebase. Its actual-driver preflight passes all 18 vector/replacement safeguard cases without skips. All 1,800 independent Float64-reference cases and mean recall targets pass (minimum 0.961875), as do size-specific query-p95 budgets.

The unchanged 16ms heartbeat budget still fails every 99.9k group and both 10k all-live groups. At 99.9k, the two query-family p95 values are 64.71/63.19ms all-live, 20.27/22.73ms for 1% and 97.91/100.16ms for 10%. Corresponding heartbeat p99 is 81.20/73.12ms, 24.97/23.53ms and 105.97/106.13ms. The sampled scoped eligibility probe is 12.136ms versus 17.664ms in d027; independent models/runs do not isolate a causal total speedup. Acquired private inputs and database scratch were removed.

Compressed reports preserve numeric timings, plans, safeguards and cleanup; sha256.json hashes their decompressed original bytes. This warm diagnostic does not establish cold/reopen/model variance, actual app-load responsiveness, resource acceptance or qualification of newer source. A green workflow does not waive its failing heartbeat budget.
