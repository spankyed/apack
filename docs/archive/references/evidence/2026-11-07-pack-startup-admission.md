# Pack startup admission qualification

The admission change captures app-shipped offers once per boot, uses the same capture for installation
and catalog publication, and passes discovered installed builds into loading instead of rediscovering
them. Catalog publication is atomic. Boot inspection versus live settings enforcement is explicit.
Final executable verification remains; changed build revisions are refused before execution.

## Recording-disabled result

[Run 42358440907](https://github.com/spankyed/apack/actions/runs/42358440907) passed, artifact
`startup-revision-comparison-42358440907` (13569493303). The retained comparison contains the complete
scalar [samples and manifests](pack-startup-admission-2026-11-07/comparison.json);
selected [raw hashes](pack-startup-admission-2026-11-07/sha256.json) identify the reports and execution journal.

| Populated startup | Baseline | Admission candidate |
| --- | ---: | ---: |
| Median | 4,298.71 ms | 3,694.97 ms |
| Range | 2,831.42–5,900.84 ms | 2,717.10–5,338.66 ms |
| Measured passing | 20/20 | 20/20 |
| Warmups passing | 5/5 | 5/5 |

The pooled median decreased 603.73 ms (14.04%). Eight of ten observed ABBA blocks favored the
candidate when comparing each block's two-sample means. Variability and drift remain visible:
first-/second-half medians were 3,756/4,479 ms for baseline and 3,747/3,695 ms for candidate.
This does not promise a stable 14% saving or establish tail, cold-disk or cross-machine performance.

The maintained reader independently verified raw hashes, lifecycle, observed balanced ABBA order and
matching fixture/native/runtime/machine provenance. Both separate detailed diagnostic stores also
passed admission; their instrumented single trials are excluded from the timing comparison. All
fifty launches passed the unchanged correct fifty-message restored-chat boundary and process teardown.

Baseline source: `87f3ed1841e9981d88510a9d4d61302d54f0cbf8`.
Measured candidate: `a331741c7c9a2ecb83c60528647d027a84c5f283`.
Native pin: `4b67670ba9b2ed58ee13f8463486a6a91292e412`.
Both checkouts were clean and used private dependencies, builds and profiles on one disposable
macOS arm64 VM (three CPUs, 7 GiB RAM): Node 24.22.2, Electron 44.9.3. The policy is fresh processes
on a warm filesystem. Main/preload/renderer build hashes match; API/default-pack hashes differ.
Do not combine this comparison arithmetically with results from another CI run.

The final production implementation remains identical to the measured candidate. Subsequent changes
extend/fix tests and maintain the comparison workflow. The separately investigated runtime deferral
was removed after its benefit proved insufficient; see the dependent runtime investigation in PR #371.

## Correctness and retained failures

Local host typechecking and 32 focused catalog/source tests passed with one worker. New regressions
cover atomic publication/no-op/refusal, explicit settings policy on the first call, and a changed
valid build being refused before its runtime executes. The existing API recovery case checks the
handoff of discovered builds after restart. All source callers use the explicit policy interface.

Initial strict run 42358307784 passed its producer and all four native/integration shards. Its
application/rest shard found that the new settings-policy fixture read an unconfigured app environment
because it omitted explicit disabled IDs. The fixture was corrected; production code did not change.
A local attempt at the native-dependent settings suite could not collect without the isolated binding;
that is not a passing result. Broad/native validation remained in CI.

[Final integrated strict acceptance 42364159120](https://github.com/spankyed/apack/actions/runs/42364159120)
passed on `9b20ffbbe0`: producer, native 1/2, integration 1/2 and application/rest all passed.
This contains the corrected settings-policy fixture and installed-pack action coverage, with the
runtime experiment removed. The application shard passed host and pack unit suites, runtime build,
external-pack application checks, smoke and packaged-authoring checks. The final production source
is identical to the measured admission candidate. Later changes are the private performance fixture
ownership fix (qualified separately by streaming run 42365886856) and evidence/docs only.
No integrity checks, deadlines, settings admission or readiness assertions were relaxed.
