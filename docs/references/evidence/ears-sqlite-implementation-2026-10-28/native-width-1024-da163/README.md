# 1,024-candidate diagnostic near miss at da1636c9ea

[Actual run 41240710307](https://github.com/spankyed/apack/actions/runs/41240710307/job/124655194789) executes all 1,800 cases at 2 CPU/6 GiB/no swap with the explicitly recorded benchmark-only 1,024-candidate floor and independent Float64 recall truth. Production policy is unchanged.

Exactly one mean recall target fails: 99.9k, 10% candidate scope, held-out titles, K=64 is 0.94890625 against the unchanged 0.95 target. All other size/scope/family/K means pass. All-live K=40 recall is about 0.970–0.986 and K=64 about 0.958–0.978. This is a failed quality gate, not a rounded-up pass.

All-live 99.9k hybrid p95 is 57.67–62.36ms; the 10% cohort is 138.21–160.28ms. Heartbeat p99 still fails in every 99.9k group. The first-row type-discovery SQL is identified by its exact hash: the sampled 99.9k 10% statement takes 0.1253ms (previous full DISTINCT sample: 9.4430ms), and the 1% statement 0.0253ms. These are individual plan samples, not a variance result.

Training produced different model hashes from b04 despite identical native extension bytes at both larger prefixes. Source also adds single-type SQL discovery. Therefore comparisons with b04 cannot isolate candidate width or establish a controlled speedup. A later matched-width recipe compares production/1,024/2,048 against one ready model and snapshot with rotated order; it remains unqualified.

All per-database removals and private acquisition cleanup are witnessed, including after recall failure. The inspected numeric samples/metrics, model/oracle identity and original report digests are retained; no text, source IDs, model weights or vectors are copied. Final app, cold/reopen, update/trash, variance and resource acceptance remain required.
