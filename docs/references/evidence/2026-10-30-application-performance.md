# Application performance evidence

These are immutable, source-qualified historical results, not timing goldens or claims about later
cleanup revisions. The [recording reference](../application-performance.md) owns architecture and
limits; the [suite guide](../../../tests/performance/README.md) owns commands and acceptance criteria.
The [investigation archive](../../archive/references/application-performance-investigation-2026-10-31.md)
preserves the full experiment/checkpoint history, operational failures, commands and validation provenance.

## Recorded qualification

Full mode comparisons used five warmups and twenty measured actions per variant in observed ABBA
order. Recorded lightweight median changes were thread-open +3.04%, search +3.51%, streaming −2.12%
and startup +1.09%. An earlier search run exceeded the 5% budget (+9.91%) and is retained. Negative
changes are measurement variation, not instrumentation speedup claims. Detailed mode has no low-overhead
budget. The full thread A/A control measured +0.27%; it validates execution, not an application speedup.
View readiness is not paint; process totals are not exact per-action attribution or tail-latency evidence.

## Immutable record inventory

| Record | Contents |
| --- | --- |
| [earlier-search-budget-failure](application-performance-2026-10-30/earlier-search-budget-failure.json) | Invocation and outcome evidence |
| [populated-startup-paired-contract](application-performance-2026-10-30/populated-startup-paired-contract.json) | Invocation and outcome evidence |
| [review-capture-admission](application-performance-2026-10-30/review-capture-admission.json) | Invocation and outcome evidence |
| [search-detailed-comparison](application-performance-2026-10-30/search-detailed-comparison.json) | Comparison and provenance |
| [search-detailed-execution](application-performance-2026-10-30/search-detailed-execution.json) | Observed process/order evidence |
| [search-detailed-invocation](application-performance-2026-10-30/search-detailed-invocation.json) | Invocation and outcome evidence |
| [search-lightweight-comparison](application-performance-2026-10-30/search-lightweight-comparison.json) | Comparison and provenance |
| [search-lightweight-execution](application-performance-2026-10-30/search-lightweight-execution.json) | Observed process/order evidence |
| [search-lightweight-invocation](application-performance-2026-10-30/search-lightweight-invocation.json) | Invocation and outcome evidence |
| [search-paired-contract](application-performance-2026-10-30/search-paired-contract.json) | Invocation and outcome evidence |
| [startup-detailed-comparison](application-performance-2026-10-30/startup-detailed-comparison.json) | Comparison and provenance |
| [startup-detailed-execution](application-performance-2026-10-30/startup-detailed-execution.json) | Observed process/order evidence |
| [startup-detailed-invocation](application-performance-2026-10-30/startup-detailed-invocation.json) | Invocation and outcome evidence |
| [startup-lightweight-comparison](application-performance-2026-10-30/startup-lightweight-comparison.json) | Comparison and provenance |
| [startup-lightweight-execution](application-performance-2026-10-30/startup-lightweight-execution.json) | Observed process/order evidence |
| [startup-lightweight-invocation](application-performance-2026-10-30/startup-lightweight-invocation.json) | Invocation and outcome evidence |
| [streaming-detailed-comparison](application-performance-2026-10-30/streaming-detailed-comparison.json) | Comparison and provenance |
| [streaming-detailed-execution](application-performance-2026-10-30/streaming-detailed-execution.json) | Observed process/order evidence |
| [streaming-detailed-invocation](application-performance-2026-10-30/streaming-detailed-invocation.json) | Invocation and outcome evidence |
| [streaming-lightweight-comparison](application-performance-2026-10-30/streaming-lightweight-comparison.json) | Comparison and provenance |
| [streaming-lightweight-execution](application-performance-2026-10-30/streaming-lightweight-execution.json) | Observed process/order evidence |
| [streaming-lightweight-invocation](application-performance-2026-10-30/streaming-lightweight-invocation.json) | Invocation and outcome evidence |
| [streaming-paired-contract](application-performance-2026-10-30/streaming-paired-contract.json) | Invocation and outcome evidence |
| [superseded-startup-cancellation](application-performance-2026-10-30/superseded-startup-cancellation.json) | Invocation and outcome evidence |
| [superseded-startup-harness-failure](application-performance-2026-10-30/superseded-startup-harness-failure.json) | Invocation and outcome evidence |
| [thread-open-detailed-comparison](application-performance-2026-10-30/thread-open-detailed-comparison.json) | Comparison and provenance |
| [thread-open-detailed-execution](application-performance-2026-10-30/thread-open-detailed-execution.json) | Observed process/order evidence |
| [thread-open-detailed-invocation](application-performance-2026-10-30/thread-open-detailed-invocation.json) | Invocation and outcome evidence |
| [thread-open-lightweight-comparison](application-performance-2026-10-30/thread-open-lightweight-comparison.json) | Comparison and provenance |
| [thread-open-lightweight-execution](application-performance-2026-10-30/thread-open-lightweight-execution.json) | Observed process/order evidence |
| [thread-open-lightweight-invocation](application-performance-2026-10-30/thread-open-lightweight-invocation.json) | Invocation and outcome evidence |
| [thread-open-paired-contract](application-performance-2026-10-30/thread-open-paired-contract.json) | Invocation and outcome evidence |
| [thread-open-paired-control-A-invocation](application-performance-2026-10-30/thread-open-paired-control-A-invocation.json) | Invocation and outcome evidence |
| [thread-open-paired-control-B-invocation](application-performance-2026-10-30/thread-open-paired-control-B-invocation.json) | Invocation and outcome evidence |
| [thread-open-paired-control-comparison](application-performance-2026-10-30/thread-open-paired-control-comparison.json) | Comparison and provenance |
| [thread-open-paired-control-execution](application-performance-2026-10-30/thread-open-paired-control-execution.json) | Observed process/order evidence |

The archive records the source/build/native identities and retained compressed raw reports, including
all 450 re-admitted historical trials. Superseded startup discovery failures remain evidence of that
harness defect; they do not qualify application overhead.

## Cleanup validation checkpoints

Runtime separation `0ca8217459` passed `chain --no-native --cores 2` in 2032.5 seconds
(31 steps, nine valid cache hits; run `2026-10-31T12-40-32Z-43939`). This includes 6,124 host unit
tests, 988 pack unit tests, 788 integration tests, runtime builds, smoke, external-pack acceptance
and both packaged-authoring checks. Native acceptance was explicitly omitted locally.

[Strict CI 41197944979](https://github.com/spankyed/apack/actions/runs/41197944979) passed on earlier
source `a075fe1c41`. [Strict CI 41202958789](https://github.com/spankyed/apack/actions/runs/41202958789)
was dispatched on `0ca8217459`; current status belongs to that run, not this historical result.

## Linux startup resolution

Historical Linux run [41203505748](https://github.com/spankyed/apack/actions/runs/41203505748)
failed before scenario execution with renderer module requests reporting `net::ERR_FAILED`.
The failure reproduced on clean source `9a0f431c8f` with native pin `f31222a697` in
[41218111415](https://github.com/spankyed/apack/actions/runs/41218111415).

[Controlled run 41219107561](https://github.com/spankyed/apack/actions/runs/41219107561) built once
and changed only Docker's shared-memory capacity: 64 MiB failed application readiness (exit 1);
256 MiB passed the real thread-open scenario (exit 0). At 256 MiB, populated startup also passed
all five warmups and one measured trial, with six canonical `trial-N/trial.json` records and
seven successful invocations (seed plus six fresh workers). The maintained reader admitted the run.
Both source and native manifests were clean and the checkout matched the native pin.
A local warm-output 64 MiB control then reproduced the same module failures after successful
startup, ruling out cold builds/cache warming. The updated maintained runner reported 256 MiB
and reached application readiness with no failed requests or page errors.

The maintained runner now requests `--shm-size=256m` explicitly. OrbStack's approximately 8 GiB
default explains why local startup controls, including the retained renderer bytes in the full
app, succeeded while Ubuntu Docker failed. No application timeout, renderer security setting or
completion assertion changed. This closes the Linux startup correctness blocker; these small
functional runs do not qualify timing overhead or establish a universal shared-memory requirement.
Diagnostic workflows remain outside both PRs.
