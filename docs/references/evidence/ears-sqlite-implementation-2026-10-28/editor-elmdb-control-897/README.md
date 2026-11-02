# Elmdb activation control — 2026-10-30

[Run 41157076346](https://github.com/spankyed/apack/actions/runs/41157076346) at
`897b609e0186f22a9d188ad3f7a64674749b631d` repeats the same diagnostic editor case three times with
elmdb/1. Production/test runtime inputs are identical to e76; intervening changes only record static evidence.
The actual report has three passes, no skips/unexpected/flaky results, and one attempt with retry zero each.
All original activation/deactivation/draft/selection/update assertions and the five-second gate remain.

The first two workers publish frontend-ready about 3.35/3.20 seconds after toggling; the third passes too,
though its unprefixed log line does not provide an independent frontend-ready timestamp. The separate
[SQLite observation](../editor-activation-e76/README.md) fails its first repetition and passes two, with
only host bindings/surfaces at failure. This narrows investigation toward candidate activation latency or
delivery; it does not isolate one backend statement, establish a general latency distribution or prove a fix.
These are identical app interactions, not matched durable-write acknowledgments: elmdb defaults to group
sync while SQLite keeps FULL per transaction. No policy is weakened to make the clock pass. Profile the
candidate's declaration/content/activation work and frontend arrival before choosing a causal correction.

Original per-case reports, worker/job logs, source metadata and integrity receipts are retained. This is
one three-repeat macOS arm64 control, not complete app/performance/adoption acceptance.
