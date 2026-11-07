# Startup loading and initial-view qualification

[Measurement run](https://github.com/spankyed/apack/actions/runs/42326078534),
artifact `startup-revision-comparison-42326078534` (ID 13556353749).
The [comparison](startup-demand-loading-2026-11-07/comparison.json) retains both manifests,
all scalar samples and the maintained comparator's result. Selected raw-report
[hashes](startup-demand-loading-2026-11-07/artifact-sha256.json) identify the retained CI evidence.

## Result and conditions

| Recording-disabled populated startup | Baseline | Candidate |
| --- | ---: | ---: |
| Median | 4,516.54 ms | 3,970.66 ms |
| Range | 2,864.56–8,672.94 ms | 2,765.68–8,489.91 ms |
| Measured trials passing | 20/20 | 20/20 |
| Warmups passing | 5/5 | 5/5 |

The median decreased 545.88 ms (12.09%) in this run. This qualifies the combined stack,
not each PR independently. The wide ranges remain visible; there is no tail-percentile,
cold-disk or cross-machine claim.

Baseline: `8f337560a7417abb692e229773b605bc81c8194a`.
Candidate: `e52df2e7cfa6fca8520df84001a137e9cd3568f9`.
Both sources were clean; the subsequent editor-test-only fix does not change application output.
Both used elmdb `4b67670ba9b2ed58ee13f8463486a6a91292e412` and the same native binary hash,
fixture hash, runtimes and machine identity. The API build hash is unchanged.

One disposable macOS 26 arm64 runner (3 CPUs, 7 GiB RAM) hosted two private checkouts,
dependencies, outputs and profiles. Node 24.22.2, Electron 44.9.3. Fresh processes ran over a
warm filesystem; each profile came from a closed populated seed (12 threads × 100 messages).
Completion required the restored chat's correct fifty full message bodies and matching revision.
The maintained coordinator serialized five warmups per revision and twenty measured trials per
revision in balanced ABBA order. Its observed execution journal, process exit results, trial
hashes and provenance passed `readPerformanceRevisionComparison(..., 20)`; both stores also
passed `tests/performance/verify-run.ts` independently.

## Architecture and attribution

The renderer provides one memoized Monaco resource through Vue. Editor consumers load the
runtime and configure their local wrapper only when mounted; workers remain locally bundled.
Production shared-module publication no longer executes every published UI entry at startup.
Renderer loading begins while the backend initializes; authenticated transport awaits the
authoritative ready endpoint. Fourteen inactive canvas, panel and routed implementations use
the existing lazy contribution contract, preserving actor registration and lifecycle.

The produced pack's local static frontend graph contains 1,819,675 bytes in two JavaScript files;
37 external host modules are separate. Notes/Library/Logs canvas and panel implementations are
absent from that graph. This establishes the loading boundary, not an independent byte-saving
or timing percentage. The bundled-editor browser test confirmed no Monaco vendor request before
opening the editor, then loaded its content with external HTTP blocked. Its initial typing check
incorrectly assumed Monaco's textarea implementation; the correction clicks the visible code
before exercising actual keyboard editing (Monaco now also supports native EditContext).

Separate detailed baseline and candidate captures followed the disabled-mode comparison.
Each retained five warmups and one diagnostic trial, complete driver/backend/renderer CPU and
sampled allocation profiles, traces and successful process teardown. Both stores passed
`readPerformanceRun(..., 1)`. These sequential instrumented single trials do not measure a speedup.

In the final diagnostic trial, baseline/candidate renderer CPU windows were 1,006/1,000 ms.
Renderer GC self-time was 79/47 ms; `formatMessageTime` self-time was 29/25 ms.
The corresponding renderer startup spans were 897/923 ms, backend startup 776/1,116 ms,
and backend index admission 271/315 ms. Spans nest or overlap: do not add them into a wall-clock
breakdown. These samples show remaining JS rendering and backend work, but do not demonstrate a
dominant language-rewrite target or independently establish savings from lazy surfaces. Initial
module loading is partly outside the renderer profile's capture window. Further reduction of the
remaining startup time needs attribution of those uncovered launch/module-loading intervals.

## Failures retained

The first matched CI attempt [42325297908](https://github.com/spankyed/apack/actions/runs/42325297908)
failed during dependency installation: ripgrep's unauthenticated release lookup returned HTTP 403.
No timing trials ran. The successful retry scoped the existing CI token to dependency installation.
Earlier external-drive runs suffered uninterruptible filesystem waits and process teardown failures;
they are diagnostic only and excluded from the comparison. No deadline or correctness assertion was
relaxed to obtain this result.

Final application acceptance is tracked separately from performance qualification; successful timing
trials alone do not certify the editor, pack lifecycle or native/compiler suites.
