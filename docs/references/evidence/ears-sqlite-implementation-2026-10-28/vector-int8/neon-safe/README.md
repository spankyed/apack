# Bounded-domain NEON counterfactual

Exact benchmark source: 53e625f2efa4ace05587cb5515cb14c2f7970b01. Disposable Linux ARM64, two CPUs, 6 GiB, no swap; no daily-Mac compiler ran. Official sqlite-vec source and identical compiler flags are recorded by the retained runner and native receipt. Only the NEON build defines SQLITE_VEC_ENABLE_NEON.

The l2-safe encoding restricts every coordinate to [-90,90], including equal-norm padding, avoiding the demonstrated signed-16 square overflow in this upstream NEON kernel. Authoritative inputs and reranking remain Float32. This does not make unrestricted int8 NEON safe.

All seven SQLite transaction controls pass. The predeclared 1k and 10k cohorts pass; first 100k clustered cohort retains recall 1.0 for all scopes and both phases, but heartbeat p99 39.65 ms exceeds 16 ms. Unfiltered warm median/p95 are 40.09/41.21 ms. Mixed 100k is unrun under the stop rule. The paired plain 10k control also misses its heartbeat gate. See summary.json and complete raw samples; no retries or discarded failures.

This is a primitive experiment, not EARS integration or an adoption result. It demonstrates a faster sampled candidate kernel, but still fails synchronous responsiveness at 100k. Stable derived identity, multi-chunk aggregation, large k, real embeddings, background ownership and platform qualification remain open. Moving work off the app thread requires an explicit snapshot/transaction design; it is not established by these measurements.
