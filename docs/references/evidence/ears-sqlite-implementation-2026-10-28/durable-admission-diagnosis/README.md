# Durable admission diagnosis — 2026-10-28

This is diagnosis against implementation `6c29f083f344a2ae4b373c82d0946011e1dbb3a5`, not a replacement
qualification cohort. The earlier `8220a11d70` durable failure and all original targets remain in force.
No production implementation or durability policy was changed.

Three SQLite idle controls and three admission/cleanup loads ran in alternating order, with a fresh 10k profile,
53 watches and synchronous durable foreground units. Idle controls run 626 units; build samples run 626–628 as
bounded batches finish. Three current-native idle controls ran afterward, using engine `6ab2f69`. Every process
ran sequentially under the same checkout lock, with 2 CPUs/6 GiB, Node 23.11.1, Linux aarch64, no network, and
fresh profiles on the container's `/tmp` overlay filesystem. This is not a certified filesystem or app budget.

| Workload | Foreground operation p99 across trials | Between-operation turn-wait p99 |
| --- | --- | --- |
| SQLite, no build | 216.7–307.2 ms | 2.9–10.9 ms |
| SQLite, build and cleanup | 237.5–362.7 ms | 272.2–298.3 ms |
| elmdb, no build, run afterward | 75.4–217.3 ms | 0.5–2.1 ms |

The SQLite control's write-COMMIT p99 is 216.1–306.7 ms; its measured operation p99 is almost entirely inside
COMMIT. Background write-COMMIT p99 is 272.0–297.7 ms, corresponding closely to turn waits during admission.
BEGIN IMMEDIATE is small in these traces. COMMIT spans include SQLite synchronization/checkpoint and filesystem
work: these measurements do not distinguish their individual costs. They do establish that shrinking JavaScript
backfill work alone cannot guarantee a 16 ms synchronous durable operation on this host.

Both implementations miss the original durable-operation target in these conditions. Native controls were not
interleaved with SQLite; host conditions changed substantially across trials. Do not use this table to rank the
backends or infer the cause of the earlier 16.79/19.39 ms sample. No targets were relaxed and none of these SQLite
samples passes all original budgets.

## Measurement correction

The original `timerStallMs` records a `setImmediate` wait *between* foreground operations. It measures background
work/watch delivery on that turn but cannot observe blocking inside the foreground operation itself. For example,
a SQLite control has 307 ms operation p99 but only 2.9 ms turn-wait p99. The archived reports preserve the original
field and calculation; `summary.json` calls it `turnWaitP99Ms`. Add an independent periodic heartbeat and report
its scheduling delay before claiming overall event-loop responsiveness. This strengthens verification; it does
not remove the original foreground-operation, turn-wait or resource targets.

## Provenance and reproduction

`provenance.json` hashes the unchanged SQLite implementation files and diagnostic harness. Each source hash was
compared with the committed checkout after the run. Raw process JSON, including individual SQL BEGIN/COMMIT
spans and all operation/lookup/turn samples, is preserved as `.json.gz`; runner logs and both harnesses are retained.
The native reports include their loaded addon hashes. `scope.json` records ordering, environment and limitations.

The first SQLite binding filter missed v13's generic `prebuilds/linux-arm64.node` basename. A post-cohort probe of
the unchanged dependency tree captures the actual loaded binary in `sqlite-binding-supplement.json` (SQLite 3.53.4,
SHA-256 `8ba771f284dfd9430e3ef8e2ffc373ed7cc5a92fc7c4c0c7baf39dd672863485`). This supplements, rather than
pretending to be, a per-process binding capture. Future harnesses should reuse the actual-loaded-object helper
and include generic `.node` names; no vector extension loads for this non-vector fixture.

To reproduce, prepare the pinned source and matching native binding in a disposable Linux environment. The
archived runners expect `/work` for that checkout, `/elmdb` for the matching native dependency and `/results` for
private output. Copy `admission-diagnostic.ts.txt` and `admission-native-control.ts.txt` into
`packages/apack-ears/bench/sqlite/` without `.txt`, then execute the corresponding archived Python runners
sequentially under the checkout's run lock. Keep their entire output even when budget checks fail. No captured
compiler/runtime or Rust target output belongs on the daily-use Mac.

## Next checkpoint

Add independent heartbeat coverage, reusable native-binding provenance and explicit write/read COMMIT attribution
to the maintained load harness. Then qualify ownership/scheduling with matched controls and WAL/checkpoint
telemetry before selecting a fix. Preserve explicit durable acknowledgments; a derived-index synchronization
policy needs its own atomic-prefix/readiness/crash proof. The full background text/vector and phase 3–7
requirements remain open in the goal.
