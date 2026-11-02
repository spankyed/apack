# Scalar predicate variants, 2026-10-28

First valid four-way native-SQL diagnostic on functional source ac84b7d3fb through e23636b763. Uses the exact
captured terminal SELECT and the same fresh 100k seed as the independent lookup probe. Compare the baseline,
array-kind guard before list-member probing, conditional overflow join, and both together. Twenty forward/reverse
blocks of 25 calls give 500 samples per mode. Every string-fixture answer must match the known ids. No production
query compiler changes or alternative index are involved. The fixture does not validate mixed-value semantics.

An initial malformed experimental replacement failed SQL preparation before timing. Its stderr and runner log are
retained. One missing closing parenthesis was corrected; the first valid comparison is preserved without retrying
for a favorable result. Source/harness hashes, actual variant plans, samples and CPU counters are retained.

| Native SQL | Median | p99 |
|---|---:|---:|
| Baseline | 1.629 ms | 23.43 ms |
| Array guard | 1.563 ms | 33.05 ms |
| Conditional overflow join | 1.579 ms | 20.82 ms |
| Combined | 1.620 ms | 12.61 ms |

The combined median is essentially unchanged; individual median changes are small and tails vary. This does not
establish a worthwhile general improvement. Do not cherry-pick the combined p99 as qualification or add compiler
complexity on this evidence. The production implementation is unchanged. Larger latency outliers also occur in
raw SQL with no background work, and process CPU deltas mostly grow with elapsed time. Those process counters
include all threads and do not identify VM versus native/GC work or certify host scheduling quality.

Next use an independent fixed-work CPU sentinel alongside the same SQL/facade to test whether database execution
is necessary for such tails. Its work is deliberately fixed, not calibrated to make the target pass. All admission
budgets and failed samples remain intact; actual app/large-text/FULL/platform acceptance is still required.
