# Join order and planner statistics diagnostic

Frozen source: `a9c9340df74f90b85434e8ddafa9742bd6867cbf`. This is a diagnostic on an owned copy, not an acceptance run. It changes only the field-index join fence in a scratch wrapper and, separately, analyzes four metadata tables offline. ANN parameters and other execution fences remain fixed.

All 144 queries completed and matched the previously recorded IDs/scores. Logical commit, entity and embedding counts remained unchanged. The original retained database SHA-256 remained `60cf59f596e5c3dfb2dfcd2d1b8ec43017fff4c4aace1bcd4c47d120828bc21e`. STAT4 was available; offline analysis took 1820 ms.

Mean timed wall milliseconds (six observations per cell; three fixed queries over two warm rounds):

| Statistics | Cohort | Fenced | Planner chooses |
| --- | --- | ---: | ---: |
| retained-stats | 1000 / 10% | 10.04 | 10.19 |
| retained-stats | 10000 / 1% | 3.85 | 3.78 |
| retained-stats | 99900 / 100% | 18.94 | 19.94 |
| retained-stats | 99900 / 10% | 49.23 | 50.06 |
| offline-analyzed | 1000 / 10% | 10.03 | 8.34 |
| offline-analyzed | 10000 / 1% | 3.81 | 3.67 |
| offline-analyzed | 99900 / 100% | 18.28 | 17.76 |
| offline-analyzed | 99900 / 10% | 45.58 | 45.87 |

Neither removing the fence nor adding statistics resolves the observed larger-corpus cost. No production query change follows from this small diagnostic. Existing recall, latency and event-loop acceptance failures remain open. These means are not cold-cache measurements, causal kernel profiles or full application qualification.

Compressed raw observations, execution plans, input/source metadata, logs and reproduction scripts accompany this note. `receipts.json` hashes the original uncompressed bytes.
