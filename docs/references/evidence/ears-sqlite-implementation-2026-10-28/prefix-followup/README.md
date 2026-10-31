# Corrected native coverage and prefix growth — 2026-10-31

Runtime45180293a3, unchanged through published487011c484. Linux arm64,2CPUs/6GiB/no swap,
with a30-second quiet admission window. No protective pause was recorded. The normal built
vec1 manifest and hash are verified, then EARS_VEC1_EXTENSION names that artifact. All75
cases from the four previously skipped native vector files pass with zero failures/skips.
All seven affected search files already passed in the original run (153 assertions), so
none is repeated. This corrects the private harness omission and does not replace the
original failed full run or close its seven original30-second timeouts.

The existing query-cost diagnostic retains its ten paths and adds four explicitly named
prefix paths: typo,32-character typo, literal opt-out and typo opt-out. At1k/10k/100k rows,
all14 paths pass their expected IDs; each retains its first call and12 warm calls, plus
separate untimed statement observations. No model/corpus/query-work limit changed. Queries
use the actual built dist entries; runtime hashes and loaded bindings are recorded.
Fixture ingestion intentionally usesOFF, as in the existing diagnostic: this is not FULL
write qualification. These are first-invocation/warm readings, not OS-cold measurements.

At100k, prefix-typo warm p50 is3.719ms (max4.218ms);32-character prefix-typo p50 is11.193ms
(max12.568ms). Literal and typo opt-outs remain correct. Peak cumulative RSS at that point
is237392KiB. The original broad common-word path still takes184.431ms on first call and
up to197.257ms warm. The entire14-case sequence reaches329.482ms heartbeat delay. Phase
labels are sampling context, not independent syscall attribution, and a delay can cross
phases or include the untimed observation call. This is evidence of bounded prefix work,
not passage of the goal's16ms responsiveness criterion or complete realistic search/app
acceptance. Raw data and exact recipes are retained with hash receipts.

Storage is post-migration Seagate. No causal speedup is claimed against old internal-drive
samples. The pending platform run41181673785 and all remaining goal criteria still apply.
