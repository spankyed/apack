# Compiler tooling outside API startup

[PR 369](https://github.com/spankyed/apack/pull/369) keeps the SDK build namespace inexpensive to
load. Its existing async compilation operations dynamically load a private implementation;
content hashing has an independent leaf module. Settings type generation loads its external compiler
only after its existing definition/default validation. Public signatures and authoring semantics stay
unchanged. The host's generated shared-module bridge remains intact.

## Recording-disabled qualification

[Run 42344106422](https://github.com/spankyed/apack/actions/runs/42344106422), artifact
`startup-revision-comparison-42344106422` (ID 13563746400), passed. The retained
[comparison](compiler-startup-boundary-2026-11-07/comparison.json) contains manifests and all scalar
samples; [selected raw hashes](compiler-startup-boundary-2026-11-07/sha256.json) identify its source
reports, lifecycle and observed execution journal.

| Populated startup | Baseline | Candidate |
| --- | ---: | ---: |
| Median | 5,087.45 ms | 4,119.85 ms |
| Range | 3,521.16–7,891.83 ms | 3,168.54–6,721.32 ms |
| Measured passing | 20/20 | 20/20 |
| Warmups passing | 5/5 | 5/5 |

The pooled median decreased 967.60 ms (19.02%) in this run. Variability is substantial: the candidate
was faster in six of ten observed ABBA blocks when comparing each block's two-sample variant means.
Exploratory first-/second-half medians were 4,102/5,471 ms for baseline and 3,838/5,138 ms for candidate.
These checks caution against promising a stable one-second or 19% improvement. No tail-percentile,
cold-disk or across-machine claim is made. In particular, this run's baseline is slower than the earlier
startup-stack qualification; do not subtract this candidate from that earlier run's baseline.

The maintained comparator's raw-trial admission, lifecycle, matching provenance and observed balanced
ABBA order were independently verified with `readPerformanceRevisionComparison(..., 20)`. Both
separate detailed diagnostic stores passed `readPerformanceRun(..., 1)`; their instrumented single
trials are excluded from the timing comparison. One disposable macOS runner hosted private revision
checkouts/dependencies/outputs/profiles. Native binary, fixture, runtime and machine identities match.
The measured policy is fresh processes over a warm filesystem, using the existing populated seed and
correct fifty-message usable restored-chat boundary. Failures and warmups were retained; none of the
fifty launches failed.

### Source provenance

Measured baseline: `0c1e6a7491a9783f9b8b25ccc4d583905f203adf`.
Measured candidate: `1dccce44681b9cc5d62416fd9b1e749530b8adc0`.
Native pin: `4b67670ba9b2ed58ee13f8463486a6a91292e412`.

The PR was subsequently based on `7bf2e9ba30d917ba1cd4bef7cecf346e1cf60fd7`, containing current
master `76a1eafeba` and the reviewed startup stack through `418a4ea68e`, without the earlier
standalone diagnostic tooling. Relative to the measured source, the corrected implementation tip
`fd687c8e0f6ec18acf43dacf8699a5c231568cf3` removes only that diagnostic workflow/docs/test hook,
updates inferred API-report member ordering, trims private compiler whitespace and extends the
existing concurrent-generation test. The removed hook was disabled and ran before application launch.
The compiler-loading boundary in the startup path is unchanged; the recorded source identities
above remain the exact identities measured. Later review fixes the test package import and snapshots
a validated authoring schema before awaiting its compiler import. The startup scenario restores
compiled data and does not invoke type generation. These later changes are not a new benchmark.

## Correctness and loading-boundary evidence

- The regression check imports the built SDK by its public package name in a fresh Node process with
  the source condition removed, then checks the complete host bridge with forbidden compiler modules
  mocked to throw if loaded. It passes without weakening shared-instance module ownership.
- Independent fresh Node imports of the built SDK and source host bridge observed zero TypeScript,
  esbuild, Prettier or schema-to-TypeScript loads through Node's module load hooks.
- A fresh built-SDK process then ran real bundling and settings type generation concurrently: both passed;
  23 compiler dependency modules loaded only after the operations were requested.
- A real compiled action was compared with the unchanged baseline implementation: entries, warnings,
  errors and content hash were identical (`46e007c8920759c5`).
- Thirty explicit compiler/settings/content tests passed, plus the loading-boundary test. The existing
  settings case now also checks concurrent first-use generation with distinct requested names; all three
  settings tests pass. Final review adds a fourth case proving the validated schema is captured before
  the new async import can yield to caller mutation; the case fails with the unfixed ordering and
  passes with the original snapshot ownership restored. The final loading/settings/placement/
  subprocess check bundle passes all 36 cases. Invalid-default and external-reference refusals remain covered.
- Repository lint, scripts/E2E/repo/publish typechecks and all 30 SDK API-report checks passed locally.
  The API report changes four inferred member positions; public signatures are unchanged. Its existing
  CRLF representation is preserved.
- The API-only production build passed, including declarations. An ESM-lexer traversal of its emitted
  `server.js` static closure found four local JavaScript files (1,129,809 bytes) and no compiler-package
  external imports. [Actual graph](compiler-startup-boundary-2026-11-07/api-startup-graph.json).
  Dynamic compiler chunks remain available. This is structural evidence, not a separate latency saving.

## Validation failures retained

The local spec router selected a broad set of host/CLI suites, many requiring the isolated checkout's
missing macOS elmdb binary. Those results are not a successful local broad gate; explicit affected
compiler tests passed separately. Native-dependent acceptance runs on disposable CI.

Initial strict run [42344104382](https://github.com/spankyed/apack/actions/runs/42344104382) failed in
producer `typecheck:scripts`: the earlier diagnostic-only ancestry imported an untyped `.mjs` helper.
That tooling was removed from this PR's baseline. The exact failed gate subsequently passed locally.
Run [42345049940](https://github.com/spankyed/apack/actions/runs/42345049940) passed its producer,
but app/rest found that the new loading test used a relative import into another package. The test
now imports the public SDK package by name; built-entry loading and first use remain independently
verified by the fresh Node smoke checks. The corrected test and all seventeen placement checks
passed locally. All four native/integration shards in that run subsequently passed.
Final reviewed acceptance [42348411661](https://github.com/spankyed/apack/actions/runs/42348411661)
passed on `35ede0e71af09e10a3c11499fd737c0cb0ca307d`, including the schema snapshot correction:
producer, integration 1/2, native 1/2 and application/rest all passed. The separate validation ref
pointed at that exact PR commit; it changed no workflow or job selection and was removed after
completion. The preceding corrected run
[42347096625](https://github.com/spankyed/apack/actions/runs/42347096625) also passed all six jobs.
The final evidence update changes this document only; no runtime code changed after acceptance.
No deadlines, integrity checks, compiler validation or performance assertions were relaxed.
