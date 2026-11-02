# Actual macOS frontend activation timeline — 2026-10-30

[Run 41163254193](https://github.com/spankyed/apack/actions/runs/41163254193) at source
`0126eda0052f8ac87f292cbc3f2bd3eb3d59f12f`, SQLite source-app editor case, three repeats:
**terminal failure: one failed, two passed, zero skipped/flaky/retries**. All source/runtime builds succeed.
The failure is the original five-second referenceSuggestion predicate, not a diagnostic setup/type failure.
Document/selection/update-count/deactivation assertions and the original deadline remain unchanged.

| Observation | Failed first repeat | Passed second repeat | Passed third repeat |
| --- | --- | --- | --- |
| Backend receives toggle (UTC) | 03:32:21.634 | 03:32:38.188 | 03:32:54.759 |
| Backend logs registered pack | 03:32:23.658 | 03:32:40.048 | 03:32:56.539 |
| Backend starts applying content | 03:32:24.175 | 03:32:40.573 | 03:32:57.093 |
| Backend logs activated | 03:32:26.116 | 03:32:41.679 | Untimestamped log line |
| Frontend PACK_ACTIVATED / LOAD_PACK_FRONTENDS | Not observed by failure attachment | 03:32:42.399 | 03:32:58.911 |
| Frontend PACK_FRONTEND_LOADED | Not observed by failure attachment | 03:32:42.730 | 03:32:59.247 |
| Event to accepted frontend | Not established | 331 ms | 336 ms |

The first backend activation log is 4482 ms after its received toggle, leaving about half a second of the
original five-second window for event arrival and frontend acceptance. The last failing predicate sample
is 03:32:26.614; the final timeline attachment is 03:32:26.661. It contains no selected lifecycle events,
packLoadRunning=false, packLoadQueued=false and no accepted pack runtime. The separate contribution
attachment again contains only host frontend contributions. This narrows the failure to backend activation/
delivery latency before frontend loading begins; it does not establish an editor replacement rejection.
It also does not prove which backend statement is slow or whether the event arrives after teardown starts.

The second repeat spends 3491 ms before backend activated, then 720 ms until frontend PACK_ACTIVATED,
then 331 ms until accepted frontend: 4542 ms from received toggle. The third's frontend acceptance is
4488 ms after received toggle. The observed backend content interval is 1941 ms in the failed repeat
versus 1106 ms in the timestamped passing repeat; this interval includes more than database work and is
not a causal SQLite statement measurement. Earlier Linux attribution found only about 474 ms of measured
SQLite commit spans in a 3.24-second backend activation; that different platform does not explain this run.

All three resource arrays are empty, including passing loads. The custom protocol therefore provides no
usable resource-timing attribution in this run; an empty array must not be called proof that no fetch ran.
XState lifecycle events, actual accepted contributions and loader state provide the useful boundary evidence.

Next diagnostic: profile backend module loading, registration, content apply/actor startup and event delivery
before changing production behavior. Retain the current failure; no broad rerun or relaxed timeout is justified
by the two passing repeats. The real-vector comparison and all other original acceptance remain independent.
Raw job/per-case JSON/logs, each uniquely named decoded attachment and failed test trace JSON are retained.
