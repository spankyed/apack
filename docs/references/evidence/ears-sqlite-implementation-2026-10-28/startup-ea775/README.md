# Detailed startup diagnostic

[Run 41365493877](https://github.com/spankyed/apack/actions/runs/41365493877), source `ea775920eb0c66a496e33000cd4eab6009755739`, completes five warmups and twenty admitted measured launches per actual store. All fifty trial byte lengths/hashes, detailed-mode/source/store manifests and 300 CPU/allocation exports were checked locally. Original numeric admission/preparation/results/lifecycle reports are gzip-preserved with decompressed SHA-256; the minimized receipt records profile hashes and backend self-sample/allocation aggregates. Raw profiles, application configuration and logs are omitted.

| Backend | Detailed-mode median | Min–max |
| --- | --- | --- |
| elmdb | 6,189.78 ms | 5,370.27–10,709.22 ms |
| SQLite | 5,225.35 ms | 4,326.85–8,042.24 ms |

This diagnostic reverses the ordering in the [lightweight measurement](../startup-374/README.md), where SQLite was 55.69% slower. Different recording overhead and runner/load variance prevent treating either run as exclusive engine attribution. Detailed mode does not replace lightweight latency acceptance, and the earlier regression remains unresolved. Both runs use warm filesystems, fixed native-first order, one macOS runner and backend-default acknowledgments; neither establishes cold-device behavior or flush equivalence.

Across the twenty backend captures, both stores spend substantial self-sample time in idle, shared update/dispatch/validation work, garbage collection and instrumentation. Native/SQLite summed idle samples are 44.75/34.52 seconds; garbage collection 2.76/2.20 seconds; Inspector post 1.71/1.38 seconds. These are profiler-window sample deltas, not exclusive launch-to-ready costs, and native calls can be charged to a JavaScript caller. Sampled allocations have similar leading sites on both stores (buffer slice and shared compiled bundle frames); they are allocation samples, not peak or retained heap. Minified names cannot support a precise subsystem claim without mapping their call sites.

The next attribution checkpoint is to map relevant shared/bundled frames and startup phase boundaries, then qualify any targeted change with the maintained lightweight protocol. This run provides no evidence supporting a speculative transaction/atomicity change, relaxed budget or adoption decision.
