# Integrated adaptive policy at 49ae64f223

[Actual run 41245527874](https://github.com/spankyed/apack/actions/runs/41245527874) completes all 1,800 fusion cases with ordinary production routing, no candidate-floor override, ready managed models and independent Float64 truth. Every mean recall target passes at K=10/40/64; minimum K=64 is 0.9571875 (99.9k/10%/held-out). Small scopes remain exact. This is one warm model/pass, not cold/reopen or model-variance certification.

At 10k, all-live hybrid p95 is 22.38–22.51ms. At 99.9k, all-live is 66.94–73.18ms, 10% is 163.15–172.28ms and 1% is 27.48–37.35ms. These meet the unchanged size-specific 100/200ms query targets. All 99.9k heartbeat groups still fail 16ms (p99 30.28–207.43ms), as do 10k all-live and 10% groups. A successful diagnostic workflow is not full responsiveness acceptance.

The matched projection diagnostic uses one lexical-control vector, the same current model/filter and three alternating-order samples per native cohort/width. Rowids plus canonical mapping return identical owners. At 99.9k and K=2,048, median owner projection is 19.15ms all-live and 36.49ms for 10%; rowid plus batch mapping is 17.53ms and 31.99ms. At K=256 differences are negligible. At 10k/K=2,048 it is 8.29ms versus 5.13ms. This limited gain does not justify changing production projection or adding mapping/scope invariants. No projection change was promoted.

Execution verifies 2 CPU/6 GiB/no swap, FULL synchronous policy, source/oracle/model identities and removal of database/acquisition scratch. Maximum process RSS is 1,517,516 KiB at 99.9k, including retained fixture/reference data, not engine-only memory. Numeric samples and source-pinned metadata retain failures without text, source IDs, vectors or model weights.

The same run's separate relevance job repeats 25/25 original hybrid judgments on both backends and observes model scratch removal. Text-only remains 24/25 under both explicit stemming configurations. Platform, app lifecycle, admission/update/trash, final strict gates and the rest of the goal remain required.
