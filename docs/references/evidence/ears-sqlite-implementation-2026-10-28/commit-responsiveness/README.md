# Attribution of native admission stalls — 2026-10-30

Current-source diagnostic on `a95039a8c7`, not performance acceptance. One private Linux ARM64 container
uses two CPUs, six GiB, no swap and dropped capabilities after quiet admission. There were no resource-pause
events during this run. It uses the same sealed 99,900 × 1,536 corpus and fresh held-out oracle as the retained
automatic-admission protocol. All 99,900 canonical Float32 rows verify before and after admission; synchronous
remains FULL (2) and wal_autocheckpoint remains 1,000. The inherited explicit premeasurement TRUNCATE checkpoint
is preparation from that diagnostic protocol, not an adopted scheduling policy. Payloads/models stay private.

Admission takes 18,151.84 ms; heartbeat p99 is 31.05 ms versus the unchanged 16 ms gate, so it still fails.
This is an instrumented attribution run, not a speedup comparison with the older independently trained model.
Its 1,088 commits take 11,315.80 ms wall time; near-call main-thread schedstat accounts for 4,230.75 ms CPU,
4.91 ms run-queue delay and zero cgroup throttling. Commit p99 is 35.73 ms; projection p99 is 4.08 ms.
These counters support substantial blocked time, consistent with storage waits, rather than container CPU
throttling. They do not identify individual syscalls. Reading counters outside each timed call introduces
small diagnostic CPU overhead, so CPU attribution is approximate and cannot replace an uninstrumented gate.

The full transaction is larger than the measured projection slice. Pinned vec1 upstream's xSync invokes
vec1FinishWriter, which flushes buffered native index work during COMMIT. Native CPU work and durable I/O
therefore occur after the JavaScript four-millisecond projection loop. Its base shadow table also retains the
Float32 input alongside encoded ANN data; the database grows from 963,133,440 to 1,807,450,112 bytes during
admission. The current design must count this deferred work and write volume, not simply shrink a row loop
and claim bounded callback latency.

Next tests should use a fixed model and supported upstream physical allocation controls before extending
native storage or introducing writer-thread coordination. Any physical-layout candidate must retain the full
recall/update/scope/query/resource matrix. If durable background transactions move to a worker, qualify
foreground writer arbitration, schema/generation races, commit uncertainty, worker death, maintenance and
shutdown; a second connection without coordination would introduce internal BUSY failures. Preserve synchronous
EARS, FULL, canonical bytes, original checkpoint policy and all original budgets. This finding completes no
remaining responsiveness, real-app or adoption requirement.

Files retain exact probe source, its two changes from the historical probe (current nativeModelsReady contract
and near-commit Linux scheduling counters), runtime input hashes, commands, complete report and lossless receipts.
