# Capped fallback hybrid matrix at 6cfdf32dad

[Actual run 41237293070](https://github.com/spankyed/apack/actions/runs/41237293070/job/124643625586) completes 1,800 fusion checks across 1k/10k/99.9k prefixes, three eligibility cohorts and two query families. Node/native query execution verifies 2 CPU/6 GiB/no-swap cgroup limits. Each prefix owns a fresh database, synchronizes each commit (FULL=2) and removes its database scratch. Private acquired payload/tool scratch is also removed by the workflow.

All per-group mean vector recall targets at 10/40/64 pass 0.95 against this revision's **same-engine exact** reference; minimum mean at 64 is 0.97390625. No managed native model owner starts. This does not qualify trained-model routing or independent Float64 recall; a later recipe owns those checks.

All 10k/99.9k p95 latency targets pass. At 99.9k, all-live p95 is 121.16ms for corpus-derived lexical controls and 128.72ms for held-out titles. Heartbeat p99 still fails 16ms in all six 99.9k groups and three 10k groups. Success of the diagnostic workflow is not success of the responsiveness acceptance gate. The 1k groups meet the heartbeat target.

Peak process RSS is about 1.41 GiB at 99.9k and includes fixture loading, full exact reference reads and query execution; this is not engine-only memory or a sustained app measurement. One warm pass after reference reads is not cold/reopen or three-pass variance evidence.

`matrix.json` retains every group metric and budget disposition. `numeric-samples.json.gz` retains all 1,800 inspected numeric samples with fixed cohort/family labels and query ordinals 0–99, never corpus text, source IDs or vectors. `summary.json` retains conditions, cleanup outcomes and original report digests. Full original reports remain in the CI artifact and private local evidence directory.
