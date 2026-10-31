# Current application latency and recording overhead

Execution: [approved optimization plan](../../plans/application-performance-optimization.md).
Status: all eight baseline comparisons admitted. Two lightweight budgets fail; final implementation
acceptance remains open. Unsuccessful antecedents remain preserved.

## Environment and provenance

The initial matrix used clean application revision `54007b70947d4e83adcdadd03bc86291376b88f9`
(runtime code from master `78c8f15ea7`) and a frozen private elmdb checkout at the declared pin
`dde229d90c60665405fdcfc93b054a77fe8d0e1d`. The maintained Linux runner constrained the whole
process tree to two CPUs, 6 GiB memory with no additional swap, and 256 MiB shared memory.
OrbStack's disk image was on the external Seagate APFS volume. These measurements do not certify
macOS latency, physical input, paint, cold storage, network inference or developer data.

Each comparison uses five warmups and twenty measured actions per mode in the maintained observed
ABBA order. Separate comparisons have separate disabled references; do not pool them. Reports are
admitted by the maintained readers, including source/build/native hashes and complete trial reports.

Raw evidence is retained in Docker volume `apack-linux-work-220c5d355e10`, under
`/work/.apack/performance/optimization-baseline-54007b7094`. Each scenario has its own logs, exit,
execution journal, manifests, raw trials, compact index, traces and detailed profiles where enabled.
The native binding SHA-256 in the initial admitted comparisons was
`c088fe831664a5fb7f38eb9f6f44fad0ea81129b270f747246ea4c4d8464544e`.

The four thread/search comparisons used `54007b7094`, startup used `9eede3e3cd`, and the final
streaming comparisons used `d7161a93d2`. All five application-output tree hashes and the native
binding hash were identical across these revisions: only measurement harnesses and documentation
changed. Each admitted pair independently verifies its source and build identity.

## Admitted baseline comparisons

Times are milliseconds. Ranges are observed minima/maxima, not tail-percentile estimates.

| Action / recording | Disabled median (range) | Recording median (range) | Difference | Outcome |
|---|---:|---:|---:|---|
| Thread open / lightweight | 384.0 (350.8–823.8) | 396.2 (358.4–896.6) | +12.2 / +3.2% | Within 5% budget |
| Search / lightweight | 12.2 (10.4–15.9) | 14.1 (10.6–42.5) | +1.9 / +15.6% | **Over budget** |
| Thread open / detailed | 443.1 (381.8–837.8) | 546.3 (386.0–1,247.5) | +103.2 / +23.3% | Descriptive; no low-overhead promise |
| Search / detailed | 17.6 (14.8–33.1) | 19.3 (16.2–33.7) | +1.7 / +9.7% | Descriptive; no low-overhead promise |
| Streaming / lightweight | 759.2 (724.4–1,934.4) | 742.6 (720.2–3,008.8) | −16.6 / −2.2% | Within 5% budget; not a speedup claim |
| Streaming / detailed | 753.8 (739.5–1,055.0) | 733.0 (700.5–1,040.8) | −20.8 / −2.8% | Descriptive; not a speedup claim |
| Populated startup / lightweight | 6,972.7 (5,688.8–9,695.6) | 7,451.0 (6,355.8–9,249.8) | +478.2 / +6.9% | **Over budget** |
| Populated startup / detailed | 6,138.2 (5,135.9–11,179.1) | 6,619.5 (5,339.7–8,510.6) | +481.4 / +7.8% | Descriptive; no low-overhead promise |

Every row contains twenty passed measured actions on each side. Search's overhead failure is
separate from functional correctness: all answers and process recordings passed. Its absolute
difference is small but exceeds the existing budget; neither rounding nor historical results
qualifies the current implementation.

## Retained qualification failures and corrections

- Initial streaming comparisons put all fifty scheduled actions under one 120-second Playwright
  test deadline. The lightweight run completed forty-five actions before the batch deadline closed
  the page. The corrected harness makes each scheduled action a serial test, keeping one warm
  process/profile, the same journal/corpus/order, all assertions and the existing per-test and
  whole-scenario deadlines. This changes the deadline's ownership, not the sample count.
- Startup readiness dereferenced a surface actor before registration. The failure diagnostic then
  dereferenced it again, masking the initial failure and preventing trial adoption. Optional actor
  lookup now lets the existing readiness predicate poll until registration; failure diagnostics
  cannot replace the original readiness outcome.
- Corrections are committed at `9eede3e3cd`. Only the affected streaming/startup comparisons are
  repeated under `optimization-harness-9eede3e3cd`; successful unaffected results were retained.
- The first corrected lightweight streaming attempt failed before any measured action: the initial
  application connection took 102.9 seconds, and CLI Settings setup exhausted the existing deadline.
  Its retained log is not a latency sample. The unchanged detailed streaming run then completed
  fifty actions, ruling out a persistent Settings integration failure; no deadline changed.
- A subsequent lightweight run found two completed production files in one trial. The real chat
  flow launches a non-persistent background `/context` CLI query after completion. The fixture treated
  that request as another paced response, and the harness incorrectly attributed its progress to
  the next foreground trial. `d7161a93d2` labels progress with the foreground trial and distinguishes
  non-persistent background requests. Background work still executes; duplicate foreground producers
  still fail. Both two-trial contracts and full comparisons then passed. Their evidence is under
  `streaming-attribution-d7161a93d2`. The failed attempt remains under
  `optimization-focused-9eede3e3cd/lightweight-streaming`.

## Controls and remaining overhead acceptance

A single predeclared disabled A/A control for each failed action used the maintained revision
coordinator on `9eede3e3cd`, twenty measured actions per side, and identical runtime/native bytes:

- Search: 17.4 → 18.0 ms, +0.6 ms (+3.4%). This is smaller than the original +1.9 ms gap.
- Startup: 5,536.8 → 6,647.8 ms, +1,111.0 ms (+20.1%), greater than the original +478.2 ms gap.

These controls use two application workers; startup also has independently prepared seed profiles.
They are not an exact single-process/common-seed mode control. They demonstrate material
process/profile variability, especially for startup, and cannot certify that recording is free.
Neither failed 5% assessment is relabeled a pass. Do not make a tracing change solely to chase
startup's uncertain percentage. Any accepted runtime optimization still needs its final affected
application checks; results here certify the baseline bytes, not future implementation bytes.

## Ranked costs

1. Populated startup is the largest action, roughly 6–7 seconds. Detailed spans put backend startup
   at a 1,071 ms median, including 357 ms of index/pack admission, and renderer startup at 1,390 ms.
   Those scopes overlap and are not additive; process launch, loading and driver readiness account
   for additional time. This is fresh-process, warm-filesystem startup, not cold-disk certification.
2. Thread opening is roughly 0.4 seconds. Renderer sampling points to rich-text editor construction,
   allocation/GC and layout. Across twenty detailed actions, JavaScript allocation samples totaled
   about 1,639 MiB; that is sampled allocation activity, not retained heap or native memory.
3. Streaming is roughly 0.75 seconds, with 0.6 seconds of fixed fixture producer pacing. Its remaining
   latency cannot all be assigned to persistence. Foreground completion and backlog remain required.
4. Search is roughly 12–18 ms without recording. The retained lightweight traces show three backend
   reads per action, consistent with the already-bounded search and batched related reads.

The dependent investigation records allocation attribution and acceptance conditions before
prototypes. It has identified an all-entity artifact scan and eager query-method construction as
concrete avoidable work. This baseline PR contains harness repairs and evidence, with no runtime
optimization or claim that the failed overhead budgets have been resolved.

## Reproduction and retention

Use a clean checkout and frozen native pin with the maintained bounded Linux runner, build normally,
then run `scripts/qualify-performance.ts --scenario <action> --mode disabled --compare
<lightweight|detailed> --trials 20 --output <owned-directory>` under Xvfb through
`scripts/with-source.mjs tsx`. The suite README describes fixture and completion contracts.
All original journals, failures, indices, actual build hashes and raw profiles remain in the owned
Docker work volume. `baseline-evidence.json` is a compact collection of the admitted comparisons,
profile summaries and startup spans. No partial run contributes passing measured samples.

Upstream master advanced during this work to `05490e387a`, including validation lifecycle fixes
and elmdb pin `7b484b0`. The tables above remain the original-pin baseline; they do not certify
the newer native binary. Final implementation checks and affected qualification must use that
newer frozen pin and be reported separately.


## Final implementation qualification

All four disabled/lightweight comparisons qualified on clean application source `03a572ff0a`
and frozen native `1849f6899e3d707ac8e25e7f81fa52b472b2a9a0`. The native binding SHA-256 is
`9c0469d914d90d0ad7763e84378f0f7149855a85420ae2965dcfb4b4eb2f1474`.
Each row admits five warmups and twenty successful measured actions **per mode**, in observed
balanced ABBA order, with no unsuccessful measured trials and complete required captures.
The original two-CPU, 6 GiB/no-extra-swap, 256 MiB-shared-memory Linux boundary, external-drive
backing, fixtures, action/view deadlines and 5% lightweight median budget remain unchanged.

| Action | Disabled median (min–max), ms | Lightweight median (min–max), ms | Median difference | Assessment |
|---|---|---|---|---|
| Thread open | 343.85 (334.40–634.50) | 354.50 (336.70–372.90) | +10.65 ms / +3.10% | Within 5% |
| Search | 13.05 (9.90–14.90) | 13.45 (10.30–16.00) | +0.40 ms / +3.07% | Within 5% |
| Streaming | 774.50 (734.60–3,049.40) | 753.25 (726.90–2,144.30) | -21.25 ms / -2.74% | Within 5% |
| Populated startup | 6,681.38 (4,557.20–9,814.74) | 6,025.69 (4,948.92–13,596.67) | -655.69 ms / -9.81% | Within 5% |

Negative differences do not establish that recording makes the app faster; the ranges and earlier
A/A controls show substantial variability. Startup remains particularly variable: its lightweight maximum was 13.60 seconds. Twenty samples certify
this declared median comparison, not tail latency, desktop macOS behavior or universal overhead.
The historical search/startup failures and A/A controls remain unchanged above. No recorder
optimization is claimed to have caused these later passes; the final source includes the justified
query/allocation changes and a newer native revision. Do not pool these runs with the original pin.

All six build hashes match across these four final comparisons and their two modes. Raw admitted
comparisons, trial/index records, journals, invocation results and manifests remain in owned Linux
work volume `apack-linux-work-2bd9183070f1` under
`.apack/performance/final-qualification-03a572ff0a-clean-native-serial/`.
Each `lightweight-<action>/<action>/comparison.json` records the actual source, fixture, machine,
API/main/preload/renderer/pack outputs and native binding, plus every admitted scalar sample.

The final ranking is unchanged: populated startup and thread editor construction dominate visible
latency; query construction has a worthwhile allocation improvement, and artifact lookup avoids a
whole-entity starting set. Existing bounded search and independently owned message watches remain.
The rejected editor-rule and serializer candidates do not meet their predeclared benefit thresholds.
