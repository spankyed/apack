# Broad-word SQL attribution; no runtime optimization promoted

Current `e2f569fa25` source overlays were tested against fresh synthetic fixtures in the owned disposable Electron environment. Seed/admission are outside timing, syncs are disabled, OS caches are warm. Thirteen alternating-order rounds per variant and size retain twelve warm samples. All 195 timed calls return the same IDs/scores on this fixture. `firstInvocationMs` means first **timed** invocation, after validation calls; it is not cold latency.

| Entities | Actual SQL p50 ms | Slim projection + integer grouping | Direct FTS rank |
| --- | ---: | ---: | ---: |
| 1,000 | 1.647 | 1.570 | 0.615 |
| 10,000 | 16.028 | 15.480 | 5.712 |
| 100,000 | 167.440 | 159.094 | 58.339 |

Projection/grouping changes offer about 5% at 100k. Direct FTS ordering is about 2.9 times faster here but is **not a general replacement**: multi-source/list owner aggregation, unequal field weights, recency, explicit candidates and stable creation ties after updates/rebuild still require proof. No runtime change is made from this diagnostic. Even 58ms does not establish the original 16ms foreground budget; heartbeat, app, durability and representative relevance gates remain open. Recipes, raw timings/plans and input hashes are retained.
