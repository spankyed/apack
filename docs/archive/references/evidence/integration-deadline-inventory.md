# Integration deadline inventory

Status: complete failure inventory across all 68 source files; setup-blocked cases remain unverified.
Inventoried source `27e9e4109`; inventory checkpoint `89898080c`. No further normal integration or strict run until the
classification, composition repair and affected checks below converge.

## Failure classification before further execution

Diagnostic [39210359774](https://github.com/spankyed/apack/actions/runs/39210359774),
isolated `4d4014241`, stops after 1,202.034 seconds. Its console is preserved locally at
`/private/tmp/apack-integration-coverage-39210359774.log` and in the run’s retained output.

| Category | Observed failure | Disposition |
|---|---|---|
| Whole-scenario timeout | Complete pool exceeds its private 1,200s bound | Primary failure. Eight files pass; one Windows-only file skips. The remaining 59 files are unproven. The normal 600s aggregate is also insufficient: the completed native file alone takes 906.983s. |
| Assertion failure | Diagnostic driver expects exit 0 but receives timeout exit 124 | Consequence of the aggregate timeout, not a failed product assertion. No test assertion failure is reported in the completed files. |
| Individual-operation timeout | None reported in this diagnostic | Expected native-load refusals on stderr belong to passing negative tests; do not count them as failures. |
| Cleanup failure | None reported in this diagnostic | Completed owner/cleanup assertions pass. Interrupted or unexecuted work is not certified by that result. |

The JSON reporter writes at normal completion, so termination leaves no complete JSON report.
Do not describe this as an all-files pass or a complete failure inventory. Exactly **495 actual tests**
pass in the completed eight files; 26 Windows-only cases skip.

Earlier normal-run exit-handler failure `39207375977` is a **whole-scenario timeout** at 60s.
The complete worker control `39209331600` passes all 16 cases; the exit-mutation refusal takes
22.030s alone. The complete-coverage control also passes that case. Its earlier slowdown remains
unattributed; no runtime assertion or cleanup defect has been demonstrated.

## Composition findings to repair in one pass

- Electron authoring/build/archive: four existing command limits total 360s (60 + 60 + 180 + 60),
  exceeding the 300s outer case before verification and disposal. Preserve each command limit.
- Public build cancellation: startup allows 60s, shutdown 20s and final cleanup 20s, while the outer
  case inherits 60s. Give the sequence an enclosing budget without enlarging startup or cleanup.
- Native search/override/suffix cases and staged/publication cases perform multiple builds and
  verification/disposal steps under one default or fixed scenario limit. Audit the declared operations,
  including refused attempts, rather than multiplying the latest elapsed duration.
- Keep existing event waits, native-loader helper limits and cleanup bounds. A larger enclosing
  budget does not authorize a larger bound on a stuck operation. Identify missing operation ownership
  explicitly; do not replace it with an unbounded promise race or expand into a generic test framework.
- The full pool needs a separate aggregate budget appropriate to its complete bounded workload.
  Do not widen all unit/compiler/test defaults to compensate for this one acceptance pool.

## Per-file execution coverage

An authored `it.each` body represents several runtime cases. The source inventory is used to inspect
operations and declarations; completed console case counts are the execution evidence.

| File | Current execution evidence | Remaining batch |
|---|---|---|
| [packages/apack-cli/tests/build/build-output-swap.integration.spec.ts](../../../../packages/apack-cli/tests/build/build-output-swap.integration.spec.ts) | 12 passed, 2 failed, 0 pending; 561.752s. | 1 |
| [packages/apack-cli/tests/build/build-registry.integration.spec.ts](../../../../packages/apack-cli/tests/build/build-registry.integration.spec.ts) | 1 passed, 1 failed, 0 pending; 82.811s. | 4 |
| [packages/apack-cli/tests/build/build-worker.native.spec.ts](../../../../packages/apack-cli/tests/build/build-worker.native.spec.ts) | 16 passed; 574.740s. | — |
| [packages/apack-cli/tests/build/compilation-inputs.integration.spec.ts](../../../../packages/apack-cli/tests/build/compilation-inputs.integration.spec.ts) | 6 passed, 3 failed, 0 pending; 90.714s. | 6 |
| [packages/apack-cli/tests/build/compiler-configuration.integration.spec.ts](../../../../packages/apack-cli/tests/build/compiler-configuration.integration.spec.ts) | 1 passed, 0 failed, 0 pending; 31.078s. | 1 |
| [packages/apack-cli/tests/build/compiler-elf-libraries.native.spec.ts](../../../../packages/apack-cli/tests/build/compiler-elf-libraries.native.spec.ts) | 0 passed, 0 failed, 0 pending; 0.000s. | 4 |
| [packages/apack-cli/tests/build/compiler-esbuild-configuration.integration.spec.ts](../../../../packages/apack-cli/tests/build/compiler-esbuild-configuration.integration.spec.ts) | 15 passed; 232.409s. | — |
| [packages/apack-cli/tests/build/compiler-file-reads.integration.spec.ts](../../../../packages/apack-cli/tests/build/compiler-file-reads.integration.spec.ts) | 12 passed; 243.862s. | — |
| [packages/apack-cli/tests/build/compiler-native-libraries.native.spec.ts](../../../../packages/apack-cli/tests/build/compiler-native-libraries.native.spec.ts) | 25 passed; 906.983s. | — |
| [packages/apack-cli/tests/build/compiler-pe-libraries.native.spec.ts](../../../../packages/apack-cli/tests/build/compiler-pe-libraries.native.spec.ts) | 26 Windows-only cases skipped; retain the owning goal’s Windows evidence. | — |
| [packages/apack-cli/tests/build/declaration-aliases.integration.spec.ts](../../../../packages/apack-cli/tests/build/declaration-aliases.integration.spec.ts) | 2 passed, 0 failed, 0 pending; 1.592s. | 2 |
| [packages/apack-cli/tests/build/dependency-flow-helpers.integration.spec.ts](../../../../packages/apack-cli/tests/build/dependency-flow-helpers.integration.spec.ts) | 3 passed, 0 failed, 0 pending; 3.631s. | 2 |
| [packages/apack-cli/tests/build/dependency-graph.integration.spec.ts](../../../../packages/apack-cli/tests/build/dependency-graph.integration.spec.ts) | 0 passed, 0 failed, 0 pending; 0.000s. | 1 |
| [packages/apack-cli/tests/build/dependency-inputs.integration.spec.ts](../../../../packages/apack-cli/tests/build/dependency-inputs.integration.spec.ts) | 0 passed, 1 failed, 0 pending; 71.279s. | 2 |
| [packages/apack-cli/tests/build/dsl-defs.integration.spec.ts](../../../../packages/apack-cli/tests/build/dsl-defs.integration.spec.ts) | 6 passed, 0 failed, 0 pending; 5.138s. | 1 |
| [packages/apack-cli/tests/build/dsl-snapshot.integration.spec.ts](../../../../packages/apack-cli/tests/build/dsl-snapshot.integration.spec.ts) | 1 passed, 0 failed, 0 pending; 50.806s. | 6 |
| [packages/apack-cli/tests/build/editor-declarations.integration.spec.ts](../../../../packages/apack-cli/tests/build/editor-declarations.integration.spec.ts) | 0 passed, 1 failed, 0 pending; 60.067s. | 4 |
| [packages/apack-cli/tests/build/facade-gate-system-contract.integration.spec.ts](../../../../packages/apack-cli/tests/build/facade-gate-system-contract.integration.spec.ts) | 2 passed, 0 failed, 0 pending; 6.533s. | 6 |
| [packages/apack-cli/tests/build/facade-gate.integration.spec.ts](../../../../packages/apack-cli/tests/build/facade-gate.integration.spec.ts) | 5 passed, 0 failed, 0 pending; 10.598s. | 6 |
| [packages/apack-cli/tests/build/facade-type-data.integration.spec.ts](../../../../packages/apack-cli/tests/build/facade-type-data.integration.spec.ts) | 0 passed, 0 failed, 0 pending; 0.000s. | 3 |
| [packages/apack-cli/tests/build/facade-typing-published.integration.spec.ts](../../../../packages/apack-cli/tests/build/facade-typing-published.integration.spec.ts) | 0 passed, 0 failed, 0 pending; 0.000s. | 3 |
| [packages/apack-cli/tests/build/facade-typing.integration.spec.ts](../../../../packages/apack-cli/tests/build/facade-typing.integration.spec.ts) | 0 passed, 0 failed, 0 pending; 0.000s. | 1 |
| [packages/apack-cli/tests/build/fe-bundler-dev-server.integration.spec.ts](../../../../packages/apack-cli/tests/build/fe-bundler-dev-server.integration.spec.ts) | 2 passed, 0 failed, 0 pending; 0.094s. | 5 |
| [packages/apack-cli/tests/build/fe-bundler-host-registry.integration.spec.ts](../../../../packages/apack-cli/tests/build/fe-bundler-host-registry.integration.spec.ts) | 20 passed, 0 failed, 0 pending; 27.754s. | 4 |
| [packages/apack-cli/tests/build/fe-bundler-opaque-deps.integration.spec.ts](../../../../packages/apack-cli/tests/build/fe-bundler-opaque-deps.integration.spec.ts) | 3 passed, 0 failed, 0 pending; 0.534s. | 6 |
| [packages/apack-cli/tests/build/frontend-generation.native.spec.ts](../../../../packages/apack-cli/tests/build/frontend-generation.native.spec.ts) | 0 passed, 1 failed, 0 pending; 125.561s. | 5 |
| [packages/apack-cli/tests/build/frontend-globs.integration.spec.ts](../../../../packages/apack-cli/tests/build/frontend-globs.integration.spec.ts) | 7 passed, 0 failed, 0 pending; 6.573s. | 6 |
| [packages/apack-cli/tests/build/frontend-outputs.integration.spec.ts](../../../../packages/apack-cli/tests/build/frontend-outputs.integration.spec.ts) | 1 passed, 0 failed, 0 pending; 0.646s. | 2 |
| [packages/apack-cli/tests/build/frontend-resources.integration.spec.ts](../../../../packages/apack-cli/tests/build/frontend-resources.integration.spec.ts) | 6 passed, 5 failed, 0 pending; 354.313s. | 3 |
| [packages/apack-cli/tests/build/frontend-workers.native.spec.ts](../../../../packages/apack-cli/tests/build/frontend-workers.native.spec.ts) | 3 passed, 1 failed, 0 pending; 88.360s. | 2 |
| [packages/apack-cli/tests/build/own-declarations.integration.spec.ts](../../../../packages/apack-cli/tests/build/own-declarations.integration.spec.ts) | 1 passed, 0 failed, 0 pending; 42.247s. | 2 |
| [packages/apack-cli/tests/build/package-inputs.integration.spec.ts](../../../../packages/apack-cli/tests/build/package-inputs.integration.spec.ts) | 5 passed, 4 failed, 0 pending; 290.747s. | 4 |
| [packages/apack-cli/tests/build/staged-dsl.integration.spec.ts](../../../../packages/apack-cli/tests/build/staged-dsl.integration.spec.ts) | 0 passed, 1 failed, 0 pending; 146.979s. | 5 |
| [packages/apack-cli/tests/build/tool-identity.integration.spec.ts](../../../../packages/apack-cli/tests/build/tool-identity.integration.spec.ts) | 1 passed, 0 failed, 0 pending; 38.718s. | 5 |
| [packages/apack-cli/tests/build/types-bundler-determinism.integration.spec.ts](../../../../packages/apack-cli/tests/build/types-bundler-determinism.integration.spec.ts) | 0 passed, 1 failed, 0 pending; 102.867s. | 1 |
| [packages/apack-cli/tests/build/watch-external-types.native.spec.ts](../../../../packages/apack-cli/tests/build/watch-external-types.native.spec.ts) | 0 passed, 1 failed, 0 pending; 89.473s. | 3 |
| [packages/apack-cli/tests/build/watch-module-freshness.native.spec.ts](../../../../packages/apack-cli/tests/build/watch-module-freshness.native.spec.ts) | 0 passed, 2 failed, 0 pending; 120.017s. | 2 |
| [packages/apack-cli/tests/build/watch-publication.native.spec.ts](../../../../packages/apack-cli/tests/build/watch-publication.native.spec.ts) | 0 passed, 2 failed, 0 pending; 120.047s. | 6 |
| [packages/apack-cli/tests/build/watch-worker-inputs.native.spec.ts](../../../../packages/apack-cli/tests/build/watch-worker-inputs.native.spec.ts) | 0 passed, 1 failed, 0 pending; 120.082s. | 4 |
| [packages/apack-cli/tests/commands/add-extensions.integration.spec.ts](../../../../packages/apack-cli/tests/commands/add-extensions.integration.spec.ts) | 15 passed, 3 failed, 0 pending; 484.585s. | 5 |
| [packages/apack-cli/tests/commands/add-feature-validate.integration.spec.ts](../../../../packages/apack-cli/tests/commands/add-feature-validate.integration.spec.ts) | 13 passed, 0 failed, 0 pending; 128.273s. | 1 |
| [packages/apack-cli/tests/commands/app-install.integration.spec.ts](../../../../packages/apack-cli/tests/commands/app-install.integration.spec.ts) | 1 passed, 0 failed, 0 pending; 0.224s. | 1 |
| [packages/apack-cli/tests/commands/db.integration.spec.ts](../../../../packages/apack-cli/tests/commands/db.integration.spec.ts) | 64 passed; 46.855s. | — |
| [packages/apack-cli/tests/commands/default-pack-archive.integration.spec.ts](https://github.com/spankyed/apack/blob/18d8a47b19495498f5a4bf52b41dae684c6efc12/packages/apack-cli/tests/commands/default-pack-archive.integration.spec.ts) | 1 passed, 0 failed, 0 pending; 30.428s. | 4 |
| [packages/apack-cli/tests/commands/dev-build.integration.spec.ts](../../../../packages/apack-cli/tests/commands/dev-build.integration.spec.ts) | 2 passed, 0 failed, 0 pending; 49.975s. | 3 |
| [packages/apack-cli/tests/commands/doctor.integration.spec.ts](../../../../packages/apack-cli/tests/commands/doctor.integration.spec.ts) | 9 passed, 0 failed, 0 pending; 0.670s. | 3 |
| [packages/apack-cli/tests/commands/facade-report.integration.spec.ts](../../../../packages/apack-cli/tests/commands/facade-report.integration.spec.ts) | 10 passed, 1 failed, 0 pending; 149.049s. | 5 |
| [packages/apack-cli/tests/commands/info.integration.spec.ts](../../../../packages/apack-cli/tests/commands/info.integration.spec.ts) | 0 passed, 1 failed, 0 pending; 60.195s. | 4 |
| [packages/apack-cli/tests/commands/pack-doctor.integration.spec.ts](../../../../packages/apack-cli/tests/commands/pack-doctor.integration.spec.ts) | 14 passed, 0 failed, 0 pending; 32.240s. | 3 |
| [packages/apack-cli/tests/commands/release.integration.spec.ts](../../../../packages/apack-cli/tests/commands/release.integration.spec.ts) | 31 passed; 5.375s. | — |
| [packages/apack-cli/tests/commands/scaffold.integration.spec.ts](../../../../packages/apack-cli/tests/commands/scaffold.integration.spec.ts) | 6 passed, 5 failed, 0 pending; 558.005s. | 2 |
| [packages/apack-cli/tests/harness/dependency-runtime.integration.spec.ts](../../../../packages/apack-cli/tests/harness/dependency-runtime.integration.spec.ts) | 5 passed, 0 failed, 0 pending; 32.239s. | 6 |
| [packages/apack-cli/tests/harness/harness-setup.integration.spec.ts](../../../../packages/apack-cli/tests/harness/harness-setup.integration.spec.ts) | 7 passed, 0 failed, 0 pending; 59.812s. | 6 |
| [packages/internal-repo-checks/tests/bounded-spawn.integration.spec.ts](../../../../packages/internal-repo-checks/tests/bounded-spawn.integration.spec.ts) | 4 passed, 0 failed, 0 pending; 6.831s. | 2 |
| [packages/internal-repo-checks/tests/component-contracts.integration.spec.ts](../../../../packages/internal-repo-checks/tests/component-contracts.integration.spec.ts) | 3 passed, 0 failed, 0 pending; 6.665s. | 5 |
| [packages/internal-repo-checks/tests/dep-files.integration.spec.ts](../../../../packages/internal-repo-checks/tests/dep-files.integration.spec.ts) | 30 passed; 2.598s. | — |
| [packages/internal-repo-checks/tests/dev-pack-hmr.integration.spec.ts](../../../../packages/internal-repo-checks/tests/dev-pack-hmr.integration.spec.ts) | 2 passed, 1 failed, 0 pending; 0.008s. | 3 |
| [packages/internal-repo-checks/tests/fingerprint-scope.integration.spec.ts](../../../../packages/internal-repo-checks/tests/fingerprint-scope.integration.spec.ts) | 10 passed, 0 failed, 0 pending; 5.974s. | 2 |
| [packages/internal-repo-checks/tests/import-specifiers-script.integration.spec.ts](../../../../packages/internal-repo-checks/tests/import-specifiers-script.integration.spec.ts) | 2 passed, 0 failed, 0 pending; 9.040s. | 4 |
| [packages/internal-repo-checks/tests/import-specifiers.integration.spec.ts](../../../../packages/internal-repo-checks/tests/import-specifiers.integration.spec.ts) | 302 passed; 11.278s. | — |
| [packages/internal-repo-checks/tests/session.integration.spec.ts](../../../../packages/internal-repo-checks/tests/session.integration.spec.ts) | 10 passed, 0 failed, 0 pending; 4.820s. | 3 |
| [packages/internal-repo-checks/tests/spec-durations-reporter.integration.spec.ts](../../../../packages/internal-repo-checks/tests/spec-durations-reporter.integration.spec.ts) | 11 passed, 0 failed, 0 pending; 46.642s. | 6 |
| [packages/internal-publish-checks/tests/published-declarations.integration.spec.ts](../../../../packages/internal-publish-checks/tests/published-declarations.integration.spec.ts) | 1 passed, 0 failed, 0 pending; 4.197s. | 3 |
| [packages/internal-publish-checks/tests/published-exports.integration.spec.ts](../../../../packages/internal-publish-checks/tests/published-exports.integration.spec.ts) | 4 passed, 0 failed, 0 pending; 7.090s. | 5 |
| [packages/internal-publish-checks/tests/published-manifest-paths.integration.spec.ts](../../../../packages/internal-publish-checks/tests/published-manifest-paths.integration.spec.ts) | 5 passed, 0 failed, 0 pending; 4.780s. | 5 |
| [packages/internal-publish-checks/tests/published-sdk-any.integration.spec.ts](../../../../packages/internal-publish-checks/tests/published-sdk-any.integration.spec.ts) | 14 passed, 0 failed, 0 pending; 7.866s. | 3 |
| [packages/internal-publish-checks/tests/published-sdk-types.integration.spec.ts](../../../../packages/internal-publish-checks/tests/published-sdk-types.integration.spec.ts) | 10 passed, 0 failed, 0 pending; 20.639s. | 4 |
| [packages/internal-publish-checks/tests/published-ui-types.integration.spec.ts](../../../../packages/internal-publish-checks/tests/published-ui-types.integration.spec.ts) | 4 passed, 0 failed, 0 pending; 6.228s. | 5 |

## Execution setup (completed)

Workflow-only `32ec489cf` on main `1a6304827` ran six sequential batches, two workers and unchanged
main per-test deadlines. Each had a 900s aggregate bound; the 120m job envelope included preparation.
Failures did not suppress later batches. The earlier eight passing files and Windows skip were excluded.

## Completed six-batch inventory (2026-10-19)

Run [39214676663](https://github.com/spankyed/apack/actions/runs/39214676663) is terminal.
All six batches completed normally under their existing test limits; none hit its 900s aggregate bound.
All **59 unique file reports** are retained. They report **251 passed, 38 failed and 50 pending cases**.
Of the pending cases, **47** were blocked by failed facade/dependency setup hooks; two ELF cases skip
on macOS and one frontend-server case is a declared configuration skip. Reporting a file does not prove
its blocked bodies executed. Preserve the earlier eight completed files and their 495 passes separately.

| Batch | Files | Passed | Failed | Pending | Complete invocation |
|---|---:|---:|---:|---:|---:|
| 1 | 8 | 33 | 3 | 15 | 663.194s |
| 2 | 10 | 30 | 9 | 0 | 570.221s |
| 3 | 11 | 58 | 7 | 32 | 516.449s |
| 4 | 10 | 39 | 8 | 2 | 402.359s |
| 5 | 10 | 44 | 6 | 1 | 544.336s |
| 6 | 10 | 47 | 5 | 0 | 245.763s |

The six invocations total **2,942.322s**, excluding the one shared preparation. This is a failed-run
measurement, not a completed normal-suite budget: timed-out and blocked operations are incomplete.
The normal 600s aggregate is contradicted by both this inventory and the earlier native file alone.

### Classification of every failed case

Categories identify the observed boundary, not an inferred root cause. A wait's final assertion error
is classified by its explicit 20s operation deadline. Actual assertion failures remain separate even
when prior timeout leakage is a plausible cause. No event, operation or cleanup deadline is changed.

| Batch | File | Case | Classification | Reported duration |
|---|---|---|---|---:|
| 1 | `apack-cli/tests/build/build-output-swap.integration.spec.ts` | a build that fails does not reuse facade files from an incumbent with stamps from a refused replacement | Whole-scenario timeout | 143.379s |
| 1 | `apack-cli/tests/build/build-output-swap.integration.spec.ts` | a build that fails publishes help as snapshot data and retains accepted articles after an invalid edit | Whole-scenario timeout | 76.959s |
| 1 | `apack-cli/tests/build/types-bundler-determinism.integration.spec.ts` | facade bundle determinism (needs dist: npm run packages:build) is identical from the workspace and from the packed tarballs a consumer installs | Whole-scenario timeout | 102.867s |
| 2 | `apack-cli/tests/commands/scaffold.integration.spec.ts` | apack pack init → add feature → build → tsc → pack adds a feature, builds, typechecks and packs a verified archive | Whole-scenario timeout | 60.073s |
| 2 | `apack-cli/tests/commands/scaffold.integration.spec.ts` | apack pack init → add feature → build → tsc → pack records the facade dependents compile against, and then reports it up to date | Assertion failure | 0.038s |
| 2 | `apack-cli/tests/commands/scaffold.integration.spec.ts` | apack pack init → add feature → build → tsc → pack adds a step (declared, shipped in build/steps.build.mjs) and a service that build | Assertion failure | 67.500s |
| 2 | `apack-cli/tests/commands/scaffold.integration.spec.ts` | apack pack init → add feature → build → tsc → pack regenerates entries when a source file codegen reads changes, not only the manifest | Whole-scenario timeout | 78.388s |
| 2 | `apack-cli/tests/commands/scaffold.integration.spec.ts` | apack pack init → add feature → build → tsc → pack fails the build on an unresolvable dependency | Assertion failure | 321.866s |
| 2 | `apack-cli/tests/build/dependency-inputs.integration.spec.ts` | retains the consumer build when a content compiler changes accepted dependency bytes | Whole-scenario timeout | 71.279s |
| 2 | `apack-cli/tests/build/frontend-workers.native.spec.ts` | retains the accepted build after a worker error and publishes its repair | Whole-scenario timeout | 66.786s |
| 2 | `apack-cli/tests/build/watch-module-freshness.native.spec.ts` | refreshes flow modules loaded through ordinary imports on the next watched build | Whole-scenario timeout | 60.013s |
| 2 | `apack-cli/tests/build/watch-module-freshness.native.spec.ts` | recompiles changed transitive content modules and retains the accepted build on failure | Whole-scenario timeout | 60.004s |
| 3 | `apack-cli/tests/build/frontend-resources.integration.spec.ts` | rebuilds Vue styles after only an external stylesheet changes | Whole-scenario timeout | 62.615s |
| 3 | `apack-cli/tests/build/frontend-resources.integration.spec.ts` | CSS dependency watching recovers a missing nested stylesheet while retaining the accepted build | Individual-operation timeout (20s rebuild wait) | 76.251s |
| 3 | `apack-cli/tests/build/frontend-resources.integration.spec.ts` | watches an external css-url asset in a separate directory | Whole-scenario timeout | 60.025s |
| 3 | `apack-cli/tests/build/frontend-resources.integration.spec.ts` | watches an external template asset in a separate directory | Whole-scenario timeout | 60.026s |
| 3 | `apack-cli/tests/build/frontend-resources.integration.spec.ts` | watches initially empty external Tailwind content through nested directory links | Individual-operation timeout (20s rebuild wait) | 54.304s |
| 3 | `apack-cli/tests/build/watch-external-types.native.spec.ts` | rebuilds external contracts and recovers a retargeted missing input without an authored edit | Individual-operation timeout (20s rebuild wait) | 89.473s |
| 3 | `internal-repo-checks/tests/dev-pack-hmr.integration.spec.ts` | a pack whose source this machine has has 'a pack outside the workspace' in the renderer's own module graph, accepting its own updates | Assertion failure | 0.006s |
| 4 | `apack-cli/tests/build/build-registry.integration.spec.ts` | a build compiles flows against the steps it loaded, and leaves the bound registry untouched | Whole-scenario timeout | 63.860s |
| 4 | `apack-cli/tests/build/editor-declarations.integration.spec.ts` | builds declared editor members and step presentation, then discovers a copied source-free build | Whole-scenario timeout | 60.067s |
| 4 | `apack-cli/tests/build/package-inputs.integration.spec.ts` | rebuilds the frontend when an undeclared imported package changes behind unchanged types | Whole-scenario timeout | 60.465s |
| 4 | `apack-cli/tests/build/package-inputs.integration.spec.ts` | automatically rebuilds an undeclared runtime imported by 'TypeScript state' without a type or authored edit | Whole-scenario timeout | 60.014s |
| 4 | `apack-cli/tests/build/package-inputs.integration.spec.ts` | automatically rebuilds an undeclared runtime imported by 'Vue canvas' without a type or authored edit | Assertion failure | 42.740s |
| 4 | `apack-cli/tests/build/package-inputs.integration.spec.ts` | keeps a captured build current after standalone generation with unchanged generated code | Whole-scenario timeout | 63.753s |
| 4 | `apack-cli/tests/build/watch-worker-inputs.native.spec.ts` | rebuilds for worker inputs and repairs missing external reads without authored edits | Whole-scenario timeout | 120.082s |
| 4 | `apack-cli/tests/commands/info.integration.spec.ts` | external pack offline inspection reports authentic compiled content and cached dependency provenance after producer source removal | Whole-scenario timeout | 60.195s |
| 5 | `apack-cli/tests/build/frontend-generation.native.spec.ts` | refreshes backend and live frontend together, retains failed incumbents and awaits retirement | Whole-scenario timeout | 125.561s |
| 5 | `apack-cli/tests/build/staged-dsl.integration.spec.ts` | staged DSL definitions preserves a verified build on a later failure, then publishes and reuses the current definitions with its frontend | Whole-scenario timeout | 146.979s |
| 5 | `apack-cli/tests/commands/add-extensions.integration.spec.ts` | apack pack add artifact and block scaffolds an artifact viewer taking artifact, declared with its icon and viewer | Whole-scenario timeout | 63.446s |
| 5 | `apack-cli/tests/commands/add-extensions.integration.spec.ts` | apack pack add artifact and block scaffolds display blocks taking their props and input blocks taking disabled/response, emitting submit/cancel | Whole-scenario timeout | 78.690s |
| 5 | `apack-cli/tests/commands/add-extensions.integration.spec.ts` | apack pack add migration declares each migration under its version line and the version it targets, which the pack entry registers and tsc accepts | Whole-scenario timeout | 153.376s |
| 5 | `apack-cli/tests/commands/facade-report.integration.spec.ts` | apack pack facade-report checks the verified current build without changing generated files | Assertion failure | 2.891s |
| 6 | `apack-cli/tests/build/compilation-inputs.integration.spec.ts` | captures runtime export conditions as well as package bytes | Assertion failure | 4.132s |
| 6 | `apack-cli/tests/build/compilation-inputs.integration.spec.ts` | invalidates cached compilation when preload order changes with identical file inputs | Assertion failure | 3.427s |
| 6 | `apack-cli/tests/build/compilation-inputs.integration.spec.ts` | invalidates compilation when native execution flags change | Assertion failure | 4.137s |
| 6 | `apack-cli/tests/build/watch-publication.native.spec.ts` | publishes source and manifest edits together and retains the incumbent after refusal | Whole-scenario timeout (setup hook) | 60.034s |
| 6 | `apack-cli/tests/build/watch-publication.native.spec.ts` | follows retargeted manifest links through refusal, repair and atomic replacement | Whole-scenario timeout (setup hook) | 60.013s |

Additional failures outside individual case results:

- **Whole-scenario setup timeouts (60s):** dependency-graph setup; facade-typing workspace setup;
  facade-typing-published setup; both facade-type-data dependency variants. These prevent 47 bodies
  from executing. The two watch-publication beforeEach timeouts are already counted in the case table.
- **Cleanup failure:** frontend-resources afterAll removes its retained compiler-input directory and
  receives `ENOTEMPTY`. Timed-out work and ownership must be inspected before changing deletion.
- **Individual-operation timeouts:** five Vitest `onTaskUpdate` RPC timeouts (two in batch 1; one each
  in batches 2, 5 and 6). Their cause is unproven. They are not product assertion failures or permission
  to disable reporting deadlines.
- **Consequential assertion failure:** final inventory collector correctly rejects nonzero batch
  exits after confirming 59 file reports. This is not a missing-report or aggregate-timeout failure.

### Repair boundaries and next action

Source **`1e6e7aea7`** repairs direct compilation's execution-input freshness. Its `current()` hash
reused an identity captured once, so later environment/flag changes were invisible. Direct compilation
now rechecks that identity; an owned worker continues to use its actual captured startup identity.
Three inert Node/tsx controls pass: export-condition changes, preload reordering and execution-flag
changes invalidate, change the next identity, and accept exact restoration. No compiler runtime or
native fixture is launched. CLI `tsc --noEmit` and focused correctness lint pass. The existing three
integration assertions remain unchanged and still need affected-suite/final acceptance.

Source **`ac45e89a5`** closes two fixture-premise defects. Repository integration reads the external
packs' generated frontend entries, so its existing suite input declaration now includes fixture outputs
and follows `test:external-pack:contract`; the fast half retains its source-only exclusions. The HMR
setup refuses missing generation explicitly and restores its environment override. Passive facade
inspection now builds after the prior case creates the authored report, before capturing the files
it promises not to modify. Production freshness/refusal rules and result assertions are unchanged.
The 105 graph/input checks pass, including removing the fixture dependency through an exclusion
mutation. Scripts, internal-repo-checks and CLI typechecks and focused lint pass. Real HMR/facade execution
remains part of the affected-case run after the repair pass; no broad run was started.

Source **`401ec05be`** fixes watcher fixture ownership in frontend-resources, package-inputs and
watch-publication. Pending startup is retained before awaiting it, uses Vitest's existing cancellation
signal, and settles before directory deletion. Frontend fixtures drain every returned owner before
reporting close failures. Inspection of installed Vitest 3.2.4 confirms `afterEach` precedes
`onTestFinished`, so a late finished hook cannot protect a directory deleted by `afterEach`.
The new mocked regression proves cancellation during startup waits for owner closure before rejecting
without a returned watcher handle. All 19 mocked watcher lifecycle checks pass; the five unchanged
coalescing checks also pass. CLI types and focused lint pass. No event/build/scenario/cleanup deadline
is changed here. Real fixture execution and the three 20s wait failures remain unaccepted until the
affected run; do not treat this source repair as proof that every observed watcher failure is resolved.

Source **`b57d81cc1`** composes 38 named case/setup declarations from their inspected phases, including
the five-build DSL case, four-build diamond setup, shared facade setup, watcher startup plus existing
event waits, and the earlier exit-handler timeout. The existing exception table records each sequence.
Global test/config defaults and all existing `vi.waitFor` calls remain unchanged. Shared-helper overrides
are now inventoried too: helpers have no runnable target budget, so each explicit deadline needs review.
The two public facade-comparison commands are asynchronous, each bounded at 180s with test cancellation;
their owner waits for the active command before deleting inputs. In-process CLI/TypeScript helpers yield
a loop turn after completing their work and restoring globals, allowing pending runner updates through.

The Electron command owner records `error` but settles only after `close`; abort retains its existing
command limit and escalates termination after two seconds. An inert Node control evaluates the actual
command function from old/current source: the old promise rejects while the child remains live
(`closedBeforeRejection: false`, signal null); the repair rejects only after closure with `SIGKILL`.
Both probe children are reaped. This is lifecycle evidence, not native/Electron execution acceptance;
no captured runtime or addon runs locally. The existing exit-handler case now explicitly retains its
builder, uses test cancellation and drains it through the existing fixture owner.

Validation: all **57** timeout-policy, subprocess-inventory and wait checks pass; CLI and internal-repo-checks
`tsc --noEmit` and correctness lint over all 23 changed TypeScript files pass. An AST comparison confirms
the 20 changed CLI specs retain their assertion calls and event waits before the explicit exit-handler
owner adjustment; its refusal, seal, incumbent and staging assertions remain. No normal integration or
strict acceptance is claimed. Next run the affected files and the changed native/worker cases on one
prepared disposable runner with two workers and the committed per-test limits; retain every result.
Then settle normal grouping/aggregate allowance from the complete measurements, pass normal integration
and run the final strict gate. Do not rerun the completed prefix as another diagnostic inventory.

Affected acceptance [39227491937](https://github.com/spankyed/apack/actions/runs/39227491937)
is dispatched on workflow-only **`8036d3014`**, based on main **`1f31d38fd`**. One prepared disposable
macOS checkout runs typecheck records, default-setup and the declared external fixture producer first.
Then three explicit eight-file batches cover all **24 failing files** from the inventory. Selected
native command/search/suffix controls and five changed worker mutation/cancellation cases follow.
All use exactly two workers and committed per-test deadlines, with no private overrides. Batch
cutoffs are 30m; the selected control groups each have 15m. The 150m envelope includes all five
cutoffs and preparation. Later groups run after a failed group; stdout and stderr, JSON and exit/timing
records are retained. YAML, six embedded scripts, exact file coverage, prerequisite gating and the
workflow-only diff are checked before dispatch. This is affected acceptance, not normal integration
or strict `--all`; both remain required after convergence. Prior diagnostic branches are preserved.

1. Validate the committed composition and lifetime repairs against the affected cases. Preserve inner
   event/operation/cleanup limits and never delete live locks or retry through them.
2. Diagnose assertion cases independently: runtime execution-option invalidation, passive facade
   authored-input freshness, external-pack HMR graph membership, and reported watcher errors. Separate
   failures caused by earlier abandoned operations from independently reproducible defects.
3. Inspect the three 20s rebuild waits to distinguish missed subscriptions from an in-progress build;
   retain their event bounds rather than converting them into broader outer timeouts.
4. Use the measured complete file/phase costs to repair normal grouping and its own aggregate budget,
   without changing every suite's class or starting the separate fast-validation refactor.
5. Validate affected cases, pass normal integration, then final strict `--all`. Setup-blocked bodies
   remain required. This diagnostic is neither gate and does not complete the active goal.

### Normal aggregate repair — 2026-10-19

Source **`21ed07fe7`** retains the normal two-worker queue and gives only complete integration the
`acceptance` aggregate class (120 minutes). Its pool runner reads the deadline from its owning chain
step instead of independently hardcoding `suite`; unit pools remain at 600 seconds. The strict job's
180-minute envelope includes preparation and app gates. Individual case, operation, event and cleanup
limits are unchanged by this checkpoint.

The eight earlier completed files contribute 2,024.100 seconds of file work. The remaining 59 reports
contribute 4,367.487 seconds, including zero-duration files with failed setup. Their combined 6,391.587
seconds imply an ideal two-worker floor of 3,195.794 seconds (53 minutes 16 seconds), before blocked
setup and shared preparation. The longest file, 906.983 seconds, does not dominate that floor. Keep the
common queue; the private batches are for diagnosis, not a new normal grouping. The new aggregate is
a backstop with room for required blocked cases, not a measured healthy-run duration. Replacing stale
historical local cost records with CI timings would misrepresent their machine/worker conditions;
the separate validation-feedback proposal remains proposed.

Validation: 167 graph/pool/input tests, scripts and internal-repo-checks typechecks, correctness lint over four
changed TypeScript files, workflow YAML parsing and diff whitespace checks pass. An earlier 217-case
tooling run passed 216 and refused one chain-table metadata import through the existing compiler-runner
guard on this daily-use Mac. It is not a proved regression or an accepted skip: the full disposable
gate must exercise it. No local native/runtime execution or guard bypass was used. Current affected
run `39227491937` predates this aggregate checkpoint and is not normal integration or final strict
acceptance. Inspect its reports before dispatching either remaining gate.

Follow-up **`4750ad766`** closes the preparation boundary: the normal pool previously called
`npm run packages:ensure` through unbounded `execFileSync`, outside its inner suite deadline. It now
uses the existing `boundedSpawn` owner and the preparation step's declared 600s allowance, with an
attributed timeout/failure. The integration aggregate remains separate. The 121 graph/pool/orchestrator
checks pass, as do script types, lint and four existing bounded-process lifecycle checks (ordinary Node
only). An inert Node timer control reaches initialization, times out with code 124, and returns in
3,006ms: its 1,000ms test allowance plus the existing two-second process-group grace. This establishes
the reused timeout/cleanup path; the actual pool preparation still needs normal-gate acceptance.

The normal gate is prepared and pushed on `session/integration-normal-acceptance`: **`2769be3cc`**
differs from exact implementation source `4750ad766` only in its workflow. It invokes the committed
`npm run test:integration -- --all`, after typecheck records, shipped output and external contract
fixtures, with a two-core budget. It retains stderr/stdout, raw pool reports and duration caches even on
failure. Its 190-minute envelope accommodates the 120-minute pool allowance and individually bounded
preparation. It remains undispatched until affected acceptance is inspected and converges; afterward,
the unchanged main strict command remains required. No subset verdict substitutes for either gate.


### Affected acceptance result — 2026-10-19

Run [39227491937](https://github.com/spankyed/apack/actions/runs/39227491937), source **`8036d3014`**
(workflow-only on main `1f31d38fd`), is terminal failure. All 24 selected files report:
**127 passed, 24 failed, zero pending**. Unlike the first inventory, no setup hook blocks bodies.
All **six native controls and five worker controls pass**. Their 30 pending cases are deliberate name-filter
exclusions, not accepted whole-suite coverage. Every group finished before its aggregate cutoff.

| Group | Passed | Failed | Duration |
|---|---:|---:|---:|
| Affected 1 | 54 | 8 | 1,055.397s |
| Affected 2 | 35 | 7 | 858.774s |
| Affected 3 | 38 | 9 | 691.781s |
| Native controls | 6 | 0 | 332.704s |
| Worker controls | 5 | 0 | 123.322s |

Every failed case is classified below. JSON represents the four test timeouts as `STACK_TRACE_ERROR`;
the retained console confirms their unchanged 60s scenario deadline. Event waits remain 20s.

| File | Case | Classification |
|---|---|---|
| `build/build-output-swap.integration.spec.ts` | rebuilds damaged facade data instead of renewing its checksums | Whole-scenario timeout |
| `build/build-output-swap.integration.spec.ts` | rebuilds damaged cache data instead of renewing its checksums | Whole-scenario timeout |
| `build/facade-type-data.integration.spec.ts` | typechecks own and dependency types under moduleResolution bundler | Assertion failure |
| `build/facade-type-data.integration.spec.ts` | typechecks own and dependency types under moduleResolution node16 | Assertion failure |
| `build/facade-type-data.integration.spec.ts` | typechecks own and dependency types under moduleResolution bundler | Assertion failure |
| `build/facade-type-data.integration.spec.ts` | typechecks own and dependency types under moduleResolution node16 | Assertion failure |
| `build/watch-publication.native.spec.ts` | publishes source and manifest edits together and retains the incumbent after refusal | Individual event-wait timeout |
| `build/watch-publication.native.spec.ts` | follows retargeted manifest links through refusal, repair and atomic replacement | Individual event-wait timeout |
| `build/dependency-graph.integration.spec.ts` | still fails when two independent packs declare the same entity | Whole-scenario timeout |
| `build/facade-typing.integration.spec.ts` | typechecks own and dependency types under moduleResolution bundler | Assertion failure |
| `build/facade-typing.integration.spec.ts` | typechecks own and dependency types under moduleResolution node16 | Assertion failure |
| `build/frontend-workers.native.spec.ts` | retains the accepted build after a worker error and publishes its repair | Individual event-wait timeout |
| `build/package-inputs.integration.spec.ts` | automatically rebuilds an undeclared runtime imported by 'TypeScript state' without a type or authored edit | Individual event-wait timeout |
| `build/package-inputs.integration.spec.ts` | automatically rebuilds an undeclared runtime imported by 'Vue canvas' without a type or authored edit | Individual event-wait timeout |
| `commands/scaffold.integration.spec.ts` | fails the build on an unresolvable dependency | Whole-scenario timeout |
| `build/facade-typing-published.integration.spec.ts` | typechecks own and dependency types under moduleResolution bundler | Assertion failure |
| `build/facade-typing-published.integration.spec.ts` | typechecks own and dependency types under moduleResolution node16 | Assertion failure |
| `build/frontend-resources.integration.spec.ts` | recovers a missing nested stylesheet while retaining the accepted build | Individual event-wait timeout |
| `build/frontend-resources.integration.spec.ts` | watches an external css-url asset in a separate directory | Individual event-wait timeout |
| `build/frontend-resources.integration.spec.ts` | watches an external template asset in a separate directory | Individual event-wait timeout |
| `build/frontend-resources.integration.spec.ts` | watches initially empty external Tailwind content through nested directory links | Individual event-wait timeout |
| `build/watch-external-types.native.spec.ts` | rebuilds external contracts and recovers a retargeted missing input without an authored edit | Individual event-wait timeout |
| `build/watch-module-freshness.native.spec.ts` | refreshes flow modules loaded through ordinary imports on the next watched build | Individual event-wait timeout |
| `build/watch-module-freshness.native.spec.ts` | recompiles changed transitive content modules and retains the accepted build on failure | Individual event-wait timeout |

Additional failures: one `frontend-resources` afterAll cleanup refuses `ENOTEMPTY`; two Vitest
`onTaskUpdate` reporting-operation timeouts occur in groups 1 and 3. No batch aggregate cutoff or failed
setup hook occurred. The collector failure follows the nonzero group results; it is not a new product defect.

Finite next work: correct the shared facade fixture's undeclared `base-pack/search` consumption while
preserving its type assertions; compose the four remaining multistep cases; diagnose the 12 event waits
with a small disposable two-case watch proof that distinguishes event receipt, build start and publication.
Trace the retained workspace cleanup and reporting failures to their owners. Do not increase event
waits or launch another broad run to diagnose these groups. Update the prepared normal-gate source
with validated repairs before dispatch; normal integration and final main strict `--all` remain required.

Complete reports and console/status records are retained under
`/private/tmp/apack-affected-39227491937/`; full stdout/stderr job output is
`/private/tmp/apack-affected-39227491937-full.log`. The machine-readable classification is
`/private/tmp/apack-affected-39227491937-classification.json`. The earlier eight-file and six-batch
evidence remains preserved; this affected run is not either remaining gate.

Source **`6e0e52f23`** adds the missing `consumes.services: ['base-pack/search']` to the shared facade
consumer fixture. All eight failing type assertions are retained. Sixteen existing service-selection
checks and CLI types/lint pass. An inert TypeScript-AST control reads the actual base/app fixture
manifests and feeds the common selector: the old declaration exposes no search; the corrected one
selects the declared `base-pack/search`. This is direct declaration/selection evidence, not a claim that
the eight full generated consumer typechecks have already passed.

Source **`55ebfc7bc`** composes the four previously missed whole-case timeouts: both damaged-output
variants perform two builds then verify; the collision case builds a rival before a public CLI refusal;
the unresolved-dependency case runs separate build/archive refusals. Their cases use two 60s operation
allowances plus 20s verification. Auditing default-bound callbacks in all 24 files also finds two
scaffold/regenerate/typecheck sequences (three 60s phases plus 20s verification) and one cold publish
before passive report inspection (60s plus 20s). These are six named declarations covering seven actual
cases. Pure capture checks, immediate preflight refusals and ordinary source-only metadata reports keep
their existing limits; there is no blanket default change. All assertion bodies and event waits remain
unchanged. The 57 policy/inventory/wait checks, CLI/repo types and lint pass. Focused real acceptance
remains required; do not dispatch the prepared normal branch without these validated repairs.

### Watch completion clocks and focused repair evidence — 2026-10-19

The first two-case timeline, [39237809409](https://github.com/spankyed/apack/actions/runs/39237809409)
on private `2fcf5fe85`, reports one pass/one failure. Both filesystem edits are received and start builds;
the frontend delivers at 19.690s, while the backend is cancelled by its original 20s completion wait.
This does not demonstrate missed subscriptions or a hung compiler.

Follow-up [39239365441](https://github.com/spankyed/apack/actions/runs/39239365441), private
`6b204e94d`, retains the original failed assertion and observes the backend for up to 40s more. It
completes successfully using its retained compiler and generation. Measured backend phases are:

| Phase | Duration |
|---|---:|
| Edit request to successful notification | 34.373s |
| Compiler-current verification | 4.570s |
| Hot worker lifetime | 22.099s |
| Parent publication verification | 0.014s |
| Final watcher refresh after builder completion | 3.893s |

The 20s predicate was timing compiler work too. Source `ca68206b6` adds dedicated real-watcher test
support; `4f63277f0` migrates all six affected watcher files. Each edit now proves a request within
20s, bounds the actual build at 60s, then retains its original 20s notification predicate and every
output/incumbent/refusal assertion. Startup stays bounded at 120s and cleanup independently at 20s.
Malformed-manifest preflight refusals keep their direct 20s check. Case allowances compose these
phases through the helper's shared rebuild budget; no production watcher, compiler reuse, freshness
check, global test default or RPC limit changes. AST comparison proves original assertions and
`vi.waitFor` calls unchanged. Seven helper boundary cases plus retry/policy/inventory/wait coverage
pass (83 total), as do CLI/repo types and lint. Real phase acceptance remains required.

The follow-up's independent repair step executes exactly 13 selected cases, including necessary fixture
prefix cases. All 13 assertions pass; 56 other cases are deliberately filtered. Its 574.270s command
still exits 1 for one `onTaskUpdate` reporting timeout, so it is not a passed gate. The long migration
case takes 144.081s and invokes synchronous generation commands directly between resolved awaits.
Source `22aeef628` routes that sequence through the existing yielding `callCli` helper, keeping migration
assertions and adding per-command success guards. Types/lint pass; real reporting acceptance remains.

Source `a2a5a057a` gives the frontend input/cache workspace its actual worker lifetime instead of file
teardown. A small ordinary-Node Jiti control proves that deleting its retained cache directory makes a
later module load fail `ENOENT`. This independently establishes the ownership defect; it does not identify
the concurrent writer behind the earlier `ENOTEMPTY` or certify real cleanup. No captured runtime or
native fixture runs locally. Reports are preserved at `/private/tmp/apack-watch-timeline-39237809409/`,
`/private/tmp/apack-watch-completion-39239365441/`, and `/private/tmp/apack-repair-proof-39239365441/`,
with the full logs alongside them. Early timeline upload permits diagnosis while other selected checks
continue; it does not create another acceptance framework or substitute for normal/strict gates.

Raw evidence is preserved in `/private/tmp/apack-integration-remaining-39214676663-original/` (all JSON/console/
status reports), `/private/tmp/apack-integration-remaining-39214676663-full.log` (complete GHA output,
including stderr), and the run's retained upload. The per-batch `tee` files contain stdout only; use
the full log for failure messages and unhandled errors.

### Committed repair acceptance dispatched — 2026-10-19

Source `7110c2632` routes all scaffold commands in `add-extensions.integration.spec.ts` through
the existing yielding CLI helper, extending `22aeef628` beyond the four-migration sequence. The
adapter requires an explicit pack root and rejects nonzero command status; existing generated-code,
manifest and refusal assertions remain. CLI types/lint and the subprocess/wait checks pass locally;
real reporting acceptance is still required.

[Run 39243953202](https://github.com/spankyed/apack/actions/runs/39243953202), workflow-only
`99ffd7bfa` on that exact source, runs two sequential groups with two workers: 19 watcher/frontend
cache cases across six files, then all 18 scaffold cases plus two workspace dependency typechecks.
Existing source deadlines are unchanged by the workflow. Each group retains JSON, verbose output
and exit status immediately; the second group runs even if the first fails. A passing assertion count
alone does not establish success when Vitest reports an unhandled reporting or cleanup error.

The earlier eight-file results and complete six-batch inventory remain authoritative. This focused
run must converge before normal full integration; final main strict `--all` and requirement-by-requirement
closure remain outstanding. Temporary tracing and extended diagnostic observers are absent from
the acceptance source. No captured runtime/native/watch execution runs on the daily-use Mac.

The watcher group completed in **1017.609s**: **18 passed, one failed**, ten deliberately filtered.
All 19 selected bodies executed; no setup, cleanup, aggregate or unhandled-reporting failure is
reported. External types, both runtime-import variants, both module-freshness cases, all 11 frontend
resource/cache cases and the worker repair pass. The retargeted publication case also passes.
The sole failure is `publishes source and manifest edits together and retains the incumbent after
refusal`: an **individual compiler-operation timeout**, with `AbortError` caused by the helper's
timeout signal, at 147.746s including setup. No output/value assertion fails. The last completed
publication in its console is initial readiness; the timed operation's internal phase is not established.
Do not turn that unknown into a compiler defect or increase all build limits. Preserve the 18 passes;
next diagnose this case with bounded phase observations beside the frontend CSS recovery case that
shared its worker period. The independent scaffold group remains live. Raw JSON, console and status
are saved at `/private/tmp/apack-watch-phase-39243953202/` and in the run's early upload.

The independent reporting group then completes successfully in **417.164s**: **20 passed, zero
failed**, eight deliberately filtered, **exit 0**. All 18 scaffold cases and both workspace dependency
typechecks pass, with no unhandled RPC or cleanup error. This accepts `7110c2632`'s shared CLI
sequencing and the workspace variants of the service-selection fixture repair. It does not reclassify
the other group's operation timeout as a pass. Reporting reports are retained at
`/private/tmp/apack-reporting-phase-39243953202/`; the complete terminal job output is
`/private/tmp/apack-watch-and-reporting-39243953202-full.log`.

After that job becomes terminal, [39247182439](https://github.com/spankyed/apack/actions/runs/39247182439)
starts on isolated `b6b3de3e0`: the single failing publication case beside CSS recovery, two workers.
Temporary phase logging separates package verification, compiler-current/capture, worker lifetime,
observations and publication. The probe observes a rebuild for at most 120s, records crossing the
original 60s boundary and still refuses that original allowance if completion arrives late. No main
deadline changes; no broad diagnostic or overlapping heavy run. This probe is not normal or strict
acceptance. Preserve the 38 passing focused cases while diagnosing this one remaining operation.

Source `dbba1429f` attributes a watched-build deadline error to its pack root and operation allowance,
retaining the original error as `cause`. The existing hung-operation regression now checks that context
and cause. All seven mocked helper cases, CLI typechecking and correctness lint pass. No deadline or
cancellation behavior changes; this improves the generic `AbortError` report, not the underlying timing.

### Publication phase control completed — 2026-10-19

[39247182439](https://github.com/spankyed/apack/actions/runs/39247182439) completes successfully:
**two passed, zero failed, exit 0**, 188.766s. All eight startup/rebuild attempts settle within their
original limits; **zero original-deadline crossings** occur, so the diagnostic's extra observation
allowance does not enable either pass. Publication startup takes 54.736s; its accepted edit,
intentional syntax refusal and accepted repair take **43.465s / 10.712s / 38.742s**. Both accepted
rebuilds retain the compiler and generation. Their worker lifetimes are 36.776s / 30.901s;
compiler-current checks take 4.527s / 5.442s; publication takes 34ms / 50ms. CSS recovery also passes,
including refusal/incumbent retention and cleanup.

This proves the complete publication behavior under the original operation limits beside its observed
concurrent frontend workload. It does **not** attribute the earlier 60s abort or establish a performance
fix. Do not invent one or raise limits from this control. Preserve the earlier failed evidence and
the attribution repair; retain the exact source deadlines for the required normal full-queue acceptance.
Raw reports/events and the full log are at `/private/tmp/apack-publication-phase-39247182439/` and
`/private/tmp/apack-publication-phase-39247182439-full.log`. Diagnostic tracing/extended observation
remain isolated and are not merged. The next broad run is the required normal integration gate,
covering full-queue scheduling and previously filtered variants, rather than another failure inventory.

Normal integration [39248035810](https://github.com/spankyed/apack/actions/runs/39248035810)
is dispatched on `41b9a6c8e`, which differs from main `f1c1052ce` only in its acceptance workflow.
It prepares typecheck records, default-setup and declared external outputs, then runs the unfiltered
`npm run test:integration -- --all` with `APACK_CHAIN_CORES=2`. No selected-file patterns, diagnostic
logging or deadline overrides are present. The committed pool's 120-minute total remains independent
of bounded package preparation and per-case/operation/event/cleanup limits. This is the required normal
gate; final main committed-source strict `--all` still follows only after it passes.

### Normal gate stops at nested Electron-control deadline — 2026-10-19

Run `39248035810` is terminal and failed. Dependency installation, complete typecheck preparation
(363s), default-setup build (423s) and external fixture preparation pass. Normal integration starts
unfiltered, then stops after 35.51s with 350 reported passing assertions, one failure and 26 platform
skips; the rest of the 68-file pool is unreached. Its sole failure is **individual-operation timeout**:
`uses the captured Electron runtime through the shared compiler launcher` exceeds the outer driver's
30s `execFileSync` limit. The driver logs ordinary Electron bootstrap, then performs installation capture,
captured launch (separately bounded at 15s), identity verification and retirement. No value assertion,
whole-scenario/aggregate timeout, reporting error or cleanup error is reported. Do not claim the
unreached native cases or remaining suite pass.

This is a missed nested deadline in the earlier inventory, not evidence of a runtime compiler defect.
Inspect/compose that driver's bounded phases, retaining its 15s launch limit and original assertions,
and verify the actual Electron control beside its normal database-file workload before another broad
gate. Preserve `/private/tmp/apack-normal-integration-39248035810/` (console and pool report) and
`/private/tmp/apack-normal-integration-39248035810-full.log` (complete terminal output).

Source `646abdd3a` bounds capture at 60s, preserves the captured child's 15s launch limit, and composes
the driver as 60+15+20 seconds for capture/launch/verification-retirement. Its 120s case includes fixture
setup and cleanup. The driver uses asynchronous `execFile`, avoiding a synchronous runner block while
these phases execute, and logs capture/launch/verification/retirement completion. Identity, captured
executable, currentness and disposal assertions are unchanged. All 53 timeout/subprocess-inventory
checks, CLI types, correctness lint and generated driver syntax checks pass. The inventory still sees
the same 11 subprocess call sites; no check was weakened. Other native loader/clang/event deadlines
retain their existing limits.

Focused [39250994872](https://github.com/spankyed/apack/actions/runs/39250994872), workflow-only
`5ead60321` over that source, runs the actual Electron control and all 64 database cases together with
two workers, retaining counts, exit status, phases and all assertions. It must pass before another normal
gate. No compiler/runtime production code or general timeout default changes in this checkpoint.

That focused run is terminal but **not accepted**: the Electron control passes in **5.357s**, including
capture/launch/currentness/retirement; five database metadata cases pass and **59 database cases fail
with missing `packages/default-setup/dist`**. All 65 selected bodies run. These are fixture-preparation
assertion failures, not further operation timeouts or demonstrated product failures. The isolated
workflow omitted the pack build consumed by `db.integration.spec.ts:appDataDir`; its concurrency
claim is therefore unproven. Preserve reports at `/private/tmp/apack-electron-driver-39250994872/`
and the full log alongside them.

Workflow-only `0e7ac97da` adds the existing `npm run build:default-setup` prerequisite, and makes the
65-case check conditional on that prerequisite's success. Corrected focused
[39251438405](https://github.com/spankyed/apack/actions/runs/39251438405) is now running on the
same `646abdd3a` product/test repair. No assertion, driver limit or production code changes follow
from the setup omission; successful actual database concurrency remains required before normal.

Corrected `39251438405` **passes all 65 selected cases with exit 0**, 54.218s. The prerequisite pack
build passes; all 64 real database cases execute alongside the captured-Electron control. That control
takes 4.174s, retaining executable identity, currentness and retirement assertions. Its driver reports
capture complete at 2.153s, launch at 2.401s, verification at 2.815s and retirement at 2.854s; no phase,
RPC or cleanup failure is reported. This accepts `646abdd3a` under the required concurrency. The
earlier 30s slowdown is not reproduced or retrospectively attributed. Preserve the failed evidence;
the repair composes explicit bounded work rather than claiming a compiler-performance fix.
Reports are at `/private/tmp/apack-electron-driver-39251438405/`, with the full log alongside.
Resume the required normal unfiltered integration gate on this committed repair, then final strict.

Normal [39253013877](https://github.com/spankyed/apack/actions/runs/39253013877) is dispatched
on workflow-only `92fe30ef6` over main `9783f52e2`. It retains the same complete preparation and
unfiltered `npm run test:integration -- --all`, two cores, source operation/event/cleanup limits and
120-minute pool aggregate. No focused selection or temporary compiler tracing is present. Require
this normal gate, final main strict `--all`, and complete requirement audit/archival before closure.

### Normal gate reaches worker-thread verification — 2026-10-19

Run `39253013877` is terminal and failed after **408 reported passes**, one **whole-scenario 60s
timeout**, and 26 platform skips; integration takes 379.50s. The failure is `records external inputs
read by content compiler worker threads`, reported at 70.922s including completion/cleanup. The
console shows four compiled rows and published output before the refusal, not a value assertion.
All prerequisite stages pass. Both actual Electron controls pass, including build/archive at 189.987s.
The native file's “25 tests” label is its declared population, **not proof all 25 bodies ran** after
global bail. Preserve the reported aggregate and reached controls without counting unreached native
or worker bodies as accepted. Complete earlier eight-file results remain preserved separately.

Raw output and duration records are under `/private/tmp/apack-normal-integration-39253013877/`;
the complete terminal log is `/private/tmp/apack-normal-integration-39253013877-full.log`.

Source `f9cb91f38` gives the demonstrated thread scenario a 120s bounded cold build plus 20s input
verification allowance. Its four thread modes, content/receipt/freshness assertions and other cases'
deadlines remain. A local fixture-build owner registers the four formerly untracked one-shot builds;
they receive test cancellation and close before fixture deletion. Teardown now drains owners before
restoring mocked process/environment state. This closes a source-visible timeout/cleanup race rather
than changing production build APIs. Existing public CLI stop/IPC cases remain intact. All 53
timeout/subprocess-inventory checks, CLI types, correctness lint and diff checks pass.

Focused [39257458780](https://github.com/spankyed/apack/actions/runs/39257458780), workflow-only
`3412e646b` on that source, executes the **entire 16-case worker file** beside four actual native/Electron
counterparts with two workers and bail disabled. This provides the affected file's complete post-repair
inventory before another normal gate; do not repeat broad integration to discover its next boundary.
The existing 60s/15s/etc. native operation/event limits are not changed by this workflow.

The full-file run completes in **767.840s**: **18 passed, two failed**, 21 deliberately filtered.
All 20 selected bodies execute. The repaired thread case passes in **107.986s**, with all four modes,
build completion at 89.190s and final receipt/freshness verification at 107.952s. Observation refusal,
background retirement, exit-handler incumbent retention, source-free frontend paths, IPC shutdown,
bootstrap refusal and the three compiling-phase cancellation variants also pass. Captured Electron
launch and both retained-Vite cases pass. No cleanup or unhandled reporting error is reported.

Both failures are **individual-operation timeouts**: full public watch readiness exceeds its 60s
startup wait (66.620s including cleanup); the real Electron full-build command exceeds 180s
(182.168s including forced-close grace, 259.220s for the case). That command completes content and
backend output and reaches cold frontend compilation before interruption. Init/add finish at
53.064s/23.554s. These are not value assertions or whole-scenario/aggregate timeouts. Reports are
at `/private/tmp/apack-worker-build-39257458780/`, with the full terminal log alongside.

Source `4f20bab39` distinguishes completed cold-build readiness (120s) from merely reaching compiler
entry (unchanged 60s); shutdown/cleanup remain 20s each and the longest case composes to 160s.
Only the full Electron build command combines its backend 180s allowance with cold frontend 120s;
init/add/archive retain 60s, and the total case composes to 540s including verification/retirement.
All 53 policy/inventory checks, CLI types, correctness lint and diff checks pass. Assertions and
production compiler/runtime code are unchanged. This is a scoped phase-budget repair, not a claim
that the broad slowdown has been attributed or that compiler performance improved.

Focused [39260287200](https://github.com/spankyed/apack/actions/runs/39260287200), workflow-only
`bbb5e06b8` over that source, runs exactly the two failed case names read from the preserved report,
two workers, no bail. Preserve the other 18 passes; require both repaired cases before normal and
final strict acceptance. Main source push encountered a transient network timeout; its retry succeeded
at `43fdc6c09`. Both source branches are preserved remotely; validation was not restarted.

### Phase acceptance and remaining fixture-owner audit — 2026-10-19

Run `39260287200` passes **both exact cases with exit 0**, 174.573s. Full public watch readiness,
shutdown and cleanup complete in **88.967s**, confirming that its old 60s full-readiness allowance
was insufficient. The real Electron build/archive case passes in **170.275s**: init 29.736s,
add 22.984s, full build 103.364s, passive archive 13.236s. Executable/runtime/output/disposal and
non-executing archive assertions remain. The earlier slower build is not retrospectively attributed;
no compiler-performance improvement is claimed. Combined with the previous complete affected run's
18 passes, every selected worker/native behavior now has passing evidence. This is not a normal or
strict whole-suite pass. Reports are in `/private/tmp/apack-compiler-phase-39260287200/`, with the
full terminal log alongside.

A static pass over remaining default-bound direct build/capture integration cases identifies ten
cases for inspection. Existing owned lifetimes, intentional early refusals, mocked cancellation and
platform-specific capture controls retain their bounds. One source-visible owner gap remains in
`own-declarations.integration.spec.ts`: an untracked cold backend/frontend build can outlive the
test while unconditional fixture teardown deletes its inputs. Its historical 42.247s pass is preserved;
this is not a newly observed assertion failure.

Source `526255eee` registers that builder with teardown, propagates test cancellation with a 120s
build bound, closes it before source-free inspection, and composes 20s for declaration/runtime
verification. All original owned-key, shape, provenance, source-removal and activation assertions
remain. All 53 policy/inventory checks, CLI types, correctness lint and diff checks pass. Focused
[39261544678](https://github.com/spankyed/apack/actions/runs/39261544678), workflow-only
`b1e703d18`, verifies that exact case beside the accepted compiler-thread case, two workers. This
named concurrency/ownership check must finish before normal; no general test framework, product
compiler change or default deadline increase is introduced.

Run `39261544678` passes **both selected cases with exit 0**, 40.670s: own-declaration build,
source-free inspection and runtime loading **32.033s**, concurrent compiler-thread input capture
**38.328s**. All owned-key/shape/provenance/no-activation/source-removal/runtime assertions pass;
no reporting or cleanup error is reported. This accepts `526255eee`'s fixture ownership repair.
Reports are in `/private/tmp/apack-declaration-build-39261544678/`, with the full log alongside.
The complete affected inventory and both subsequent focused repairs now have passing behavioral
evidence. Return to the required normal unfiltered gate with the combined committed repairs; final
main strict `--all` and requirement audit/archival remain outstanding.

Normal [39262109257](https://github.com/spankyed/apack/actions/runs/39262109257) is dispatched
on workflow-only `8d7776bc1` over exact main `a5e0d89ee`. It includes all accepted worker/phase and
declaration-fixture repairs, preserves complete preparation, and runs the ordinary unfiltered
`npm run test:integration -- --all` with two cores. No diagnostic tracing, filters or private deadline
overrides are merged. Require this normal gate before final main strict acceptance and closure.

## Normal gate: worker-observation refusal deadline — 2026-10-19

Normal run [39262109257](https://github.com/spankyed/apack/actions/runs/39262109257)
uses workflow-only `8d7776bc1` on main source `a5e0d89ee`. All preparation passes: typecheck
374s, default pack 534s and external contract preparation 354s. Integration fails in **505.66s**:
**409 actual passes, one failure, 26 platform skips**. Global bail leaves later cases unexecuted;
passing file labels do not establish their entire declared population ran.

The only failure is a **whole-scenario timeout**: `refuses publication when a compiler worker cannot
return its observations` inherits 60s and reports 65.969s including cancellation/cleanup. No assertion
mismatch, individual-operation timeout, cleanup failure or reporting error is reported. Earlier full
worker acceptance completed this case in 53.701s. The underlying refusal is not newly disproven; its
completion on this combined normal run is unverified. The four-mode thread case now passes in
109.235s, repeated build/archive in 151.688s, actual Electron launch in 4.786s and actual Electron
build/archive in 219.555s. Native watch repair passes in 178.944s, including retirement. Preserve these
reached controls without claiming the unreached native tail passed.

The prior cold-build audit missed the refusal and three remaining same-file cold scenarios: loader
input refusal, background-process cleanup and frontend input reporting. Their focused durations were
53.434s, 44.269s and 49.737s respectively. Repair them together using the same explicit 120s cold-build
operation allowance already used for the thread case, with 20s enclosing verification/cleanup. The
existing test helper requires the test cancellation signal and combines it with that operation bound;
its registered builder still closes before source deletion. The public loader-refusal child receives
a bounded completion wait and an awaited, separately bounded 20s cleanup. All original refusal,
incumbent, value, input-source and process-cleanup assertions remain. Bootstrap/IPC/event waits,
compiling-phase startup, other scenario limits and production code are unchanged.

Local checks pass: 53 timeout-policy/subprocess-inventory cases, CLI TypeScript and correctness lint.
Disposable two-worker affected-file acceptance is required before another normal run; the final main
strict gate remains outstanding. Evidence: `/private/tmp/apack-normal-integration-39262109257/` and
`/private/tmp/apack-normal-integration-39262109257-full.log`.

Repair source **`f93015282`** is pushed. Focused run
[39267061814](https://github.com/spankyed/apack/actions/runs/39267061814) uses workflow-only
`25f51cf98` on that checkpoint: all 16 worker cases beside four existing native compiler controls,
two workers, original assertions, `bail=0` and an explicit 20-case execution check. The private
checkout differs only in its workflow; no dependencies/generated output are shared. This run must
finish before normal integration is attempted again. No acceptance result is claimed at dispatch.

### Remaining worker cold-build cases accepted

Focused **39267061814** succeeds: **20 passes, zero failures, exit 0**, 21 intentionally filtered
native cases, **611.202s** complete invocation. All 16 worker bodies and four selected native controls
execute. The observation refusal passes in 47.452s, loader refusal in 34.407s, background cleanup in
27.468s and frontend input ownership in 26.367s. Repeated build/archive passes in 180.340s, thread
observations in 91.891s, actual Electron build/archive in 285.819s, and all four public-stop variants
pass. No cleanup, reporting or unhandled-runner failure is reported. The earlier normal slowdown is
not attributed or presented as a compiler-performance repair. Source remains `f93015282`; only
validation/doc bookkeeping follows. Raw evidence: `/private/tmp/apack-worker-cold-build-39267061814/`
and `/private/tmp/apack-worker-cold-build-39267061814-full.log`.

The affected source has converged again. Resume the unchanged normal unfiltered integration gate;
final main strict `--all` still follows a passing normal result, not this selected acceptance.

Normal run [39269209929](https://github.com/spankyed/apack/actions/runs/39269209929) is
now dispatched on workflow-only **`e8c813028`**, containing main **`d45a03faf`** and accepted source
**`f93015282`**. The private tree differs only in `.github/workflows/strict-chain.yml`. It uses the
unchanged `npm run test:integration -- --all`, ordinary grouping/bail, two cores, existing per-operation
and case bounds, and the measured 120m aggregate. Its prerequisites and all reports remain preserved.
No second expensive run is active. Wait for this result before the main final strict gate.

## Normal gate: compose native capture and refusal attempts — 2026-10-19

[39269209929](https://github.com/spankyed/apack/actions/runs/39269209929) on workflow-only
`e8c813028` / main `d45a03faf` finishes in **867.55s**: **425 actual passes, one failure, 26 platform
skips**. All prerequisites pass. The complete worker file passes all 16 bodies, including observation
refusal 62.879s, background cleanup 61.599s and frontend input reporting 78.318s. These actual normal
results validate repairing the remaining worker cases together rather than only the first failure.

The sole failure is a **whole-scenario 120s timeout** in native thread capture/refusal. Its phase log
shows the successful build at 73.232s, freshness/restoration at 90.469s, first refusal at 115.035s,
second refusal at 125.310s and owner closure at 126.668s. No assertion mismatch, individual-operation
timeout, cleanup or reporting failure is reported. Completion after the test deadline is useful timing
evidence, not a passed case. Preload passes in 97.002s; actual Electron build/archive and watch repair
also pass. The eight later native cases and other globally bailed files remain unexecuted here.

The earlier 120s native scenario was not properly composed from its three builds. Correct it to one
explicit 120s cold build, two separately bounded 60s refusal attempts, and 60s for native fixture
creation, two existing 10s ordinary-loader controls, freshness/retention verification and cleanup:
300s enclosing allowance. A refusal additionally asserts that its operation signal has not expired,
so a timeout cannot satisfy the existing rejection assertion. Keep every constructor, copy, value,
restoration, incumbent and retirement check. No product/compiler behavior changes.

The same-file audit identifies one remaining cold OS-admission baseline inheriting a 60s whole-case
limit. Its successful baseline now has the same 120s build bound, with 60s for subsequent pre-capture
admission checks and 20s verification/cleanup. Existing search/fallback/suffix scenarios already have
composed bounds; primitive loader and retained-frontend cases keep their current limits. Both native
variants and the unreached tail need complete affected-file acceptance beside the worker file before
another normal gate. Local deadline/inventory checks (53), CLI TypeScript and correctness lint pass.
Raw evidence: `/private/tmp/apack-normal-integration-39269209929/` and
`/private/tmp/apack-normal-integration-39269209929-full.log`. Final strict acceptance remains open.

Source **`f17d2e286`** is committed/pushed. Complete affected-file run
[39275701481](https://github.com/spankyed/apack/actions/runs/39275701481) is dispatched on
workflow-only **`449aac628`**: both entire native/worker files, two workers, `bail=0`, and an explicit
41-body execution check. No test-name filter or per-test default change. The private checkout differs
only in the workflow; package/output isolation remains intact. No acceptance result is claimed yet.

### Complete native and worker commands accepted; GitHub status unresolved

The published report from **39275701481** proves **41 passes, zero failures, zero skips, exit 0**
on `f17d2e286` / workflow-only `449aac628`. Complete command duration is **1199.532s**. All 16 worker
and all 25 native bodies execute. Native preload/thread capture-refusal passes in 102.742s/108.705s,
including pre-deadline refusal and owner closure. The formerly unreached native tail also passes;
OS-admission takes 44.465s. Observation/loader refusal, background cleanup and frontend input ownership
pass in 53.204s/50.583s/49.254s/46.335s. No test cleanup or unhandled reporting failure is reported.

GitHub's run/jobs APIs still say the acceptance step is running, even though the downloaded job log
records command exit, successful result upload, cache save and final runner cleanup at **15:33:38Z**.
The job-log endpoint returned this evidence at 15:49Z. Preserve this discrepancy: the 30m test deadline
was not exceeded, and no timeout/process implementation change is justified by the stale phase label.
Whole-job finalization remains unverified; do not claim a green GitHub job from the report alone.
The completed acceptance command permits the next normal gate on a separate disposable runner;
leave this job intact and recheck its final status. No native work runs on the developer Mac.

Evidence: `/private/tmp/apack-native-worker-39275701481/` and
`/private/tmp/apack-native-worker-39275701481-live-response.txt` (complete retained job log).
The required normal and final main strict gates remain outstanding.

Normal [39281108805](https://github.com/spankyed/apack/actions/runs/39281108805) is dispatched
on workflow-only **`97ea3af4b`**, containing main **`2bdfa9e7a`** and accepted source **`f17d2e286`**.
Only the normal workflow differs from main. The ordinary unfiltered command, two cores, effective
case/operation deadlines, 120m aggregate and prerequisite preparation are unchanged. The earlier
41-case command has exited; its GitHub finalization remains separately unresolved and is not cancelled.
Await the normal command's result before the required main strict gate.

GitHub finalization subsequently resolves: the run API reports **39275701481 completed/success**,
updated **2026-10-19T15:54:31Z**. This agrees with the preserved 41-pass report and completed log.
The earlier discrepancy is historical evidence, not an outstanding cleanup or deadline defect. No
process/tooling repair was made. Normal run **39281108805** remains queued at that observation.

## Normal gate: trigger scaffold scenario deadline — 2026-10-19

Normal run [39281108805](https://github.com/spankyed/apack/actions/runs/39281108805)
on workflow-only `97ea3af4b` / main `2bdfa9e7a` finishes in 1603.52s with 505 actual
passes, one failure and 26 Windows skips. All 16 worker and 25 native bodies pass in this run.
The failure is a **whole-scenario timeout**, not an assertion or reported operation/cleanup failure:
`add-extensions.integration.spec.ts`'s hyphenated-trigger scenario inherits 60s despite initializing
a separate pack, scaffolding a trigger (including generation), and checking its TypeScript program.
Vitest reports 72.300s elapsed. Remaining files/cases skipped by bail are not accepted.

The focused repair assigns only that scenario `3 * 60_000 + 20_000`, matching adjacent
multistep allowances. Helpers, assertions and production code are unchanged. These helpers perform
in-process operations; this allowance does not establish independently cancellable operation bounds.
No general timeout, event-wait or cleanup limit is increased. Same-file review finds the other
multistep scaffolding/generation/typecheck scenarios already have explicit composed allowances.
CLI typecheck, lint and 42 timeout-policy checks pass. Focused full-file runner acceptance is pending.

Preserved evidence: `/private/tmp/apack-normal-integration-39281108805-full.log` and
`/private/tmp/apack-normal-integration-39281108805/`, including the raw pool JSON reports.

Repair checkpoint: `d07ccae99`; all 53 timeout/inventory checks, CLI types and lint pass.
Focused [39288218287](https://github.com/spankyed/apack/actions/runs/39288218287)
is queued on workflow-only `36ea8055a`, whose only difference from the repair checkpoint is
`.github/workflows/strict-chain.yml`. It selects the complete 18-case scaffold file and two
existing facade typecheck controls, two workers, bail disabled and a 20-executed-case assertion.
No test deadline is overridden by the workflow. No real compiler/native integration ran locally.

## Trigger scaffold file and facade controls accepted — 2026-10-19

[39288218287](https://github.com/spankyed/apack/actions/runs/39288218287) finishes
**completed/success** on workflow-only `36ea8055a`, containing source repair `d07ccae99`.
The status report records exit 0, **20 actual passes, zero failures**, 377.704s. All 18 scaffold
bodies execute, including the repaired trigger in **27.020s**. Both selected facade typechecks pass;
eight unselected facade bodies are filtered rather than accepted. Two workers, bail disabled, unchanged
assertions and no workflow deadline overrides. No unhandled or cleanup error is reported.
This focused run proves complete affected-file behavior, not full integration. Resume the normal
unfiltered gate before final strict acceptance.

Raw evidence: `/private/tmp/apack-trigger-scaffold-39288218287/` (`reporting-acceptance.json`,
status JSON and log); full runner log `/private/tmp/apack-trigger-scaffold-39288218287-full.log`.
A current-source delta review also confirms the SDK framework/build declarations, host settings,
default-setup feature implementation and canonical writer are unchanged since consolidation audit
`a74bbd88a`. Subsequent authoring changes use own-key collision checks and validate service claims
before writing files. No new manifest implementation omission is identified; final gates remain open.

Normal integration [39289719265](https://github.com/spankyed/apack/actions/runs/39289719265)
is dispatched on workflow-only `44cbdcdd4` containing main `affcdf644`. Its only source difference
is the existing acceptance workflow: required preparation followed by ordinary
`npm run test:integration -- --all`, two cores, no selected-case filtering or deadline overrides.
Await the existing run, preserving its reports, before final strict `--all`.

### Closeout source review while normal acceptance runs

Reviewed committed source through `b1b09598b`; normal run `39289719265` is still in preparation.
This is source evidence, not a passing gate:

- SDK `framework/data-declaration.ts` normalizes feature/data entity ownership once, rejects duplicate
  homes naming both owners, retains flat entity identities and derives relation constants from wire values.
- SDK `build/generate-entries.ts:entityShapeEntries` skips null shapes, checks exported TypeScript types
  through the shared module reader and emits only type imports for shapes.
- CLI `manifest-writer.ts` derives structural order from the current schema and preserves declaration
  member order; the writer and SDK framework/build declarations have not changed since `a74bbd88a`.
- Host `packs/lifecycle-binding.ts` verifies exact declared hook membership and callable values without
  invoking hooks. Host settings implementation under `features/settings`, its service and frontend
  runtime, and SDK settings handles/drafts are unchanged since that source audit.
- Host settings authority still uses connection-bound issued credentials and accepted runtime identities;
  an event property cannot establish host or another pack's authority.
- `scripts/lib/chain-steps.ts` retains full integration with forced `--all`, external app/runtime/smoke
  checks and both packaged-authoring halves. The author half requires the external readiness/archive
  references; its app half consumes the retained exact archive and compares installed integrity.

No new omission is identified by these checks. Preserve every cross-phase acceptance row and existing
window/platform evidence; final integration, strict acceptance and completed-only archival remain open.

## Normal gate: esbuild captured-declaration scenario and reporting — 2026-10-19

[39289719265](https://github.com/spankyed/apack/actions/runs/39289719265), workflow-only
`44cbdcdd4` / main `affcdf644`, finishes after **1508.04s** with **493 actual passes, one failure,
26 Windows skips**, and one unhandled runner error. All preparation passes. The failure inventory is:

- **Whole-scenario timeout:** `compiler-esbuild-configuration.integration.spec.ts`'s parameterized
  transient **declarations** case inherits 60s and takes 64.214s. It runs a complete backend build
  (generation/runtime/facade), then stages and executes the result. Build-output logging completes;
  post-build assertion completion is not established by that log. No value assertion is reported failed.
- **Reporting failure:** Vitest reports `Timeout calling "onTaskUpdate"`. Keep this independently
  unresolved until the focused runner exits without an unhandled error. The report does not identify
  its exact blocking operation. This is not an established cleanup or compiler-hang diagnosis.
- No individual-operation timeout, whole-pool deadline or explicit cleanup failure is reported.

Scoped repair: only the four full-build transient variants receive `120_000 + 20_000`, allowing
cold build plus staging/runtime verification. These are in-process instrumented builds; replacing
with a worker would bypass the spies that prove the transient-source contract. No independently
cancellable build-operation bound is claimed. The other cases exercise partial native bundlers and
retain their existing limits. Same-file teardown yields once after cleanup, matching the existing
runner-reporting repair for synchronous toolchain tests. No assertion, RPC limit, production compiler
or general suite deadline changes. All 53 policy/inventory checks, CLI types and lint pass.

Required next evidence: complete 15-case file on a disposable runner, bail disabled, two workers,
zero failures and no unhandled reporting error; then normal integration and final strict `--all`.
Raw reports: `/private/tmp/apack-normal-integration-39289719265/`; full log:
`/private/tmp/apack-normal-integration-39289719265-full.log`. Earlier results remain preserved.

Repair `d29612b7a` is committed/pushed. Focused
[39296758415](https://github.com/spankyed/apack/actions/runs/39296758415) is dispatched on
workflow-only `952a6dd02`, whose only difference from that source checkpoint is the acceptance workflow.
It selects all 15 configuration cases, bail disabled, two-worker limits and an explicit 15-executed-case
assertion; no workflow test-timeout override. Normal integration is on hold until affected-file
completion and reporting are accepted.

## Complete esbuild configuration file accepted — 2026-10-19

[39296758415](https://github.com/spankyed/apack/actions/runs/39296758415) finishes
**completed/success** on workflow-only `952a6dd02`, source repair `d29612b7a`.
The actual status report records **15 passes, zero failures, zero pending, exit 0**, 239.315s.
Every file body executes, including all transient-edit cases: configuration 32.603s, sources
30.442s, declarations **26.195s**, resolution 31.320s. The final output contains no unhandled runner
error or reported cleanup failure. Assertions and workflow test deadlines remain unchanged.
This proves affected-file completion and reporting on the focused runner; it does not explain the
normal run's slowdown or certify the whole integration pool. Resume normal integration, then strict.

Preserved reports: `/private/tmp/apack-esbuild-configuration-39296758415/` (JSON, status, console);
full log `/private/tmp/apack-esbuild-configuration-39296758415-full.log`.

Normal [39297729330](https://github.com/spankyed/apack/actions/runs/39297729330) is dispatched
on workflow-only `7582e2a5a`, main `a2465bff1` / source repair `d29612b7a`. The only difference from
main is the existing acceptance workflow: required preparation and ordinary unfiltered
`npm run test:integration -- --all`, two cores, no per-test override. Await the same run before strict.

## Cross-check remaining full-build deadline composition — 2026-10-19

While immutable normal run `39297729330` executes, a read-only TypeScript AST survey identifies
40 test declarations directly calling full-build entry points (helper-only watcher/worker cases remain
covered by their existing ownership audit). Thirteen inherit the integration default. Inspecting their
bodies and the preserved complete-batch reports distinguishes real compilation from early refusal
and a fake-child cancellation test; call names alone are not evidence of equal work.

One concrete composition omission remains: `dsl-snapshot.integration.spec.ts` performs **two real
builds**, then verifies source-free installed discovery, integrity and build-input records, under one
60s outer timer. The preserved batch passes it in **50.806s**. Assign only this scenario
`2 * 60_000 + 20_000`, consistent with neighboring two-build scenarios, with a named policy reason.
No body, assertion, individual wait, cleanup limit, helper or production implementation changes.
This is an overall allowance, not an independently cancellable in-process operation or a measured
speed improvement. All 53 policy/inventory checks, CLI types and lint pass.

The remaining inherited cases inspected here include single successful/late-refusal builds in
`build-output-swap` and shared-fixture rebuilds in `facade-report` (preserved durations about 25–48s),
early generated-code refusals, and a bounded fake-child cancellation check (0.474s). Keep these limits;
this survey does not prove a timeout defect or justify a blanket increase. Full report remains at
`/private/tmp/apack-full-build-scenario-audit.json`; preserved six-batch JSON is unchanged.

Current normal source retains the original stricter DSL deadline. If its unchanged DSL body executes
and passes, use that stronger timing evidence for the focused case; do not repeat normal integration
solely to test a larger outer allowance. If bail leaves it unexecuted, include it in the next necessary
focused run. Final strict `--all` must include the committed correction. The broader validation-budget
restructuring remains after this goal, as clarified by user documentation commit `abbf93853`.

## Normal gate: scaffold composed deadline and recurring reporting — 2026-10-19

[39297729330](https://github.com/spankyed/apack/actions/runs/39297729330) finishes
completed/failure on workflow-only `7582e2a5a`, main `a2465bff1`, after **2016.71s**:
**507 actual passes, one failure, 26 Windows skips**, one unhandled runner error. All preparation
passes. All 15 configuration and all 18 add-extension bodies pass; transient declarations takes
38.658s, and trigger scaffold 96.415s (its old inherited 60s would be insufficient).

Failure classification:
- **Whole-scenario timeout:** scaffold step/service case reaches its already composed **260s**
  limit, 260.734s elapsed. It performs step add, service add, build and TypeScript checking; current
  capture hides individual command timings. The report does not establish which phase timed out,
  whether work completed late, or whether an operation stalled. Do not infer these from the total.
- **Reporting failure:** one `Timeout calling "onTaskUpdate"`. This is not an identified assertion,
  individual-operation timeout or proven cleanup defect. Between-test yielding alone has not closed
  reporting under this normal workload.
- No whole-pool timeout, failed value assertion or explicit cleanup failure is reported.

Preserve the 507 passes and earlier complete inventory; do not use another broad run to diagnose.
Next diagnostic: the complete scaffold and add-extension files together (29 cases, two workers),
unchanged test limits, with scaffold phase timing and memory readings on a separate diagnostic
branch. Determine the blocking/slow operation before choosing an existing async process boundary
or correcting operation composition. This does not begin the deferred validation-budget redesign.
The current normal bail leaves DSL unexecuted; its main-only allowance correction `fc006bcce` remains
pending real acceptance. Required final normal and strict gates remain open.

Raw evidence: `/private/tmp/apack-normal-integration-39297729330/`; full runner log
`/private/tmp/apack-normal-integration-39297729330-full.log`. All earlier reports remain preserved.

Diagnostic [39306120746](https://github.com/spankyed/apack/actions/runs/39306120746)
is dispatched on `be7080780`, branch `session/scaffold-phase-diagnostic`, based on main `3315ce178`.
Its only differences are scaffold phase/start/end/RSS/heap readings and the focused workflow. The
29 selected bodies retain existing per-test deadlines, two-worker limits and bail disabled. Phase
markers sit outside the existing CLI console capture. Runner exit status and unhandled errors remain
part of the result; logging itself is not a repair or acceptance. Main's unrelated staged
`validation-feedback-budget.md` edits are preserved and excluded from these evidence commits.


## Scaffold process-boundary checkpoint — 2026-10-19

Diagnostic [39306120746](https://github.com/spankyed/apack/actions/runs/39306120746)
completes **29 actual passes, zero failed or pending bodies**, but **exit 1** for one unhandled
`Timeout calling "onTaskUpdate"`. The command takes 608.819s. This is a reporting failure, not a
passing acceptance gate. Preserve the unchanged-deadline report and prior normal 260s scenario failure.

Scaffold phase measurements: initialization 13.287s; feature add 21.485s; builds **59.253s,
92.025s and 116.345s**; TypeScript checks **3.322s and 3.398s**; archive 18.243s; step add 23.120s;
service add 49.270s; generated-entry subprocesses 38.401s/16.722s. TypeScript is not the measured
bottleneck. RSS readings alone do not establish a memory leak, GC cause or operating-system fault.
Raw evidence: `/private/tmp/apack-scaffold-phase-39306120746/` and
`/private/tmp/apack-scaffold-phase-39306120746-full.log`.

Replace only this scaffold file's toolchain boundary: actual CLI commands and nested Vitest execute
in asynchronous owned processes, preserving command assertions and shared pack evolution. Each CLI
operation keeps an independent 60s limit; successful full cold builds use 120s. Test cancellation sends
SIGTERM so public build owners drain their compiler workers, escalates after two seconds using the
existing POSIX process-group owner (direct-child termination on Windows), and bounds process closure
at 20s. A deadline or cancellation throws an attributed error rather than returning a nonzero status
that a refusal assertion could accidentally accept. Wait for closure and group retirement before
continuing; a failed operation prevents subsequent shared-fixture cases and preserves the directory.
The existing compiler's Windows Job Object/IPC ownership remains responsible for compiler descendants;
this change does not introduce a general Windows process-tree supervisor for arbitrary nested tools.

Compose affected case limits from these CLI allowances, the existing TypeScript allowance and 20s
verification/cleanup. Keep TypeScript in process: its measured three seconds do not justify moving it.
No product compiler, watcher, settings, input contract or assertion changes. The subprocess inventory
moves its single scaffold spawn site to the scoped helper rather than concealing a new site.
Eight pure mocked lifecycle checks cover refusal versus timeout, cancellation, no spawn after abort,
awaited closure/retirement, escalation, bounded cleanup failure and spawn errors. All 53 policy/inventory
checks, CLI typecheck and changed-file lint pass. No native/compiler execution occurs on the daily Mac.

Next acceptance must run the same complete two scaffold files together, plus the unreached DSL
snapshot case (30 bodies total), with two workers. Require **exit 0**, all bodies and no unhandled
reporting errors. Only after that passes resume the normal unfiltered gate, then committed-source
strict `--all`; the broader validation-budget/Nx proposals remain separate. Real process-boundary
acceptance is pending, including whether the full public cold build fits its independent bound.


Repair **`7c24806e7`** is committed and pushed. Focused acceptance
[39309152812](https://github.com/spankyed/apack/actions/runs/39309152812) runs on
workflow-only **`5956cc394`**, branch `session/scaffold-async-acceptance`, directly based on that
repair. It selects exactly 30 bodies with two workers and unchanged per-operation limits; it requires
30 passes, zero failures/pending and command exit 0. No normal/strict broad replacement is dispatched.


## Focused async acceptance: full-build boundary correction — 2026-10-19

[39309152812](https://github.com/spankyed/apack/actions/runs/39309152812) completes in
552.211s, exit 1: **23 passed, seven reported failed, zero pending**, no unhandled reporting error.
The seven failures are **one individual-operation timeout** plus **six subsequent shared-fixture
setup refusals**; they are not seven assertion defects. The afterAll failure repeats that same rejected
operation to preserve its fixture, not a separately expired cleanup limit. No whole-scenario,
20s cleanup, failed value assertion or reporting timeout is reported.

All 18 add-extension bodies pass. The unchanged DSL body passes in **71.572s**, completing the real
acceptance missing after normal bail and proving its former 60s total insufficient. Preserve that
acceptance; do not repeat DSL merely for another deadline change elsewhere.

Scaffold initialization takes 13.195s, feature add 18.321s, validate 5.826s, doctor 5.006s,
first full public build **108.377s**, archive 10.674s. That entire feature case passes in 150.976s.
The next full public build reaches backend and frontend output, then its **incorrect 120s operation
limit** expires; cancellation/forced closure completes at 122.090s. Subsequent bodies never start.
This demonstrates that the new boundary is responsive to operation cancellation and does not confuse
it with an expected CLI refusal; it does not accept the whole scaffold file or fully prove reporting
under the later successful toolchain phases.

Correction: this boundary runs the **full public CLI**, not the inner backend build. Reuse the existing
full-command composition from the actual Electron authoring proof in
`compiler-native-libraries.native.spec.ts`: **180s captured backend + 120s cold frontend**.
Apply it to all three successful public build calls and compose their enclosing case budgets once.
Other CLI operations stay at 60s; cancellation grace remains 2s and cleanup 20s. No assertion, global
suite limit or compiler implementation changes. The original 120s selection in `7c24806e7` was a
mistake; this is a boundary correction, not evidence of another compiler defect.

Next run both complete scaffold files together (29 bodies, two workers), preserving the independently
accepted DSL result. Require all 29 passes and exit 0 without reporting errors before normal integration.
Raw JSON/status/log: `/private/tmp/apack-scaffold-async-39309152812/`; full runner log:
`/private/tmp/apack-scaffold-async-39309152812-full.log`.


Correction **`14de022f8`** is committed and pushed; 42 timeout-policy cases, CLI types and changed-file
lint pass. Focused [39311095507](https://github.com/spankyed/apack/actions/runs/39311095507)
runs on workflow-only **`4dc9c393d`**, directly based on that correction. Exactly the two complete
scaffold files (29 bodies) run with two workers; DSL's 71.572s acceptance is preserved separately.
No broader run is dispatched. The user's documentation-only `752c7bf32` remains intact.


## Complete scaffold files accepted — 2026-10-19

Focused [39311095507](https://github.com/spankyed/apack/actions/runs/39311095507) on
workflow-only **`4dc9c393d`**, source **`14de022f8`**, accepts **29/29 bodies**, zero failed/pending,
**exit 0**, 604.571s. Both complete files execute with two workers, without an unhandled reporting
or cleanup error. The previously blocked seven scaffold bodies all execute and pass. Source differs
from the main checkpoint only in the focused workflow.

Actual successful public builds take **75.020s, 94.537s and 179.485s**. The step/service case takes
**233.410s**; facade roundtrip 156.527s. This establishes that 120s is insufficient for the full public
build boundary and that the asynchronous process repair survives the complete later sequence without
blocking task reporting. It does not prove normal unfiltered integration or strict `--all`.
Other command limits, cancellation/cleanup limits and every value assertion are unchanged. The separate
DSL acceptance **71.572s** from `39309152812` remains preserved rather than repeated here.
Raw: `/private/tmp/apack-scaffold-full-39311095507/`; full job log:
`/private/tmp/apack-scaffold-full-39311095507-full.log`.

The affected repair has converged. Next run **normal unfiltered `npm run test:integration -- --all`**
on an immutable workflow-only branch from current main, two cores and the committed pool/case limits.
That required gate covers all integration projects, their concurrency and remaining bodies after
previous normal bail; a focused two-file pass cannot substitute for it. If it passes, run main's final
committed-source strict `--all`, then finish the requirement audit and documentation closure. Do not
resume unrelated research or the separate validation redesign.


Normal unfiltered gate [39312954386](https://github.com/spankyed/apack/actions/runs/39312954386)
is dispatched on workflow-only **`cc0ae42b4e0e99e37fbf1a87800530bf2d7f9ced`**, branch
`session/integration-normal-scaffold-acceptance`, directly based on main **`f0405e436`**. The only
difference is its workflow: existing typecheck/pack/external-output prerequisites, then unchanged
`npm run test:integration -- --all` with `APACK_CHAIN_CORES=2`. Committed per-case and pool bounds,
normal fail-fast behavior and report collection are preserved. This covers the required full-pool gap;
no strict run is dispatched concurrently. Main's untracked Wireit plan is unrelated and untouched.

### Normal gate result and focused attribution — 2026-10-19

Run **39312954386** finishes with **741 passed, one failed, 29 skipped, two unhandled reporting
errors**, 3610.59s. The report lists 40 passing files, one failing and two skipped out of 68;
fail-fast leaves other files and bodies unexecuted. This is not normal integration acceptance.
All preparation succeeds. All 11 scaffold cases pass, preserving the focused asynchronous CLI result.

Failure classification:

| Boundary | Evidence | Classification |
|---|---|---|
| Flow-module freshness | `watch-module-freshness.native.spec.ts`, first case, 156.668s; helper attributes an abort to its 60,000ms rebuild signal | Individual-operation timeout |
| Vitest reporting, twice | Final error summary says `Timeout calling "onTaskUpdate"`; no file attribution in the log | Reporting failure; event-loop starvation remains a hypothesis |
| Assertions, scenario and cleanup | No independent value assertion, whole-scenario timeout or cleanup error reported | No demonstrated failure in these categories |

The watched rebuild is requested and runs. Timestamped output records backend compilation at
20:58:42 UTC and frontend emission at 20:59:10, before failure at 20:59:37. This rules out a missing
watch request for this case; it does not establish the duration needed to finish verified publication
or the cause of the reporting errors. No limit or input selection has been changed.

Raw evidence: `/private/tmp/apack-normal-integration-39312954386/_temp/normal-integration.log`,
`/private/tmp/apack-normal-integration-39312954386-full.log`, and its retained
`pool-reports/spec-durations-7VJSgL/apack-cli+internal-repo-checks+internal-publish-checks.json`. The latter records file
durations, not individual test verdicts; the complete log is authoritative for executed bodies.

Focused diagnostic [39325170997](https://github.com/spankyed/apack/actions/runs/39325170997)
uses workflow-only **`e3956518cabaf0c1751347f7157e5ac08a1e228c`**, containing source **`5ce394268`**.
It selects four complete files: module freshness (actual failure), output swap (long direct builds),
feature authoring/validation and database commands (possible long synchronous/microtask sequences).
The last three are suspects, not attributed causes. The existing `loop-sample.mjs` probe records
worker/process identity and loop gaps; JSON and verbose reports retain actual case outcomes. Two
workers, existing per-test/operation/cleanup deadlines, no fail-fast for this explicit diagnostic,
40-minute selected-test envelope. No normal or strict gate runs concurrently. Inspect measured gaps
at the time they grow: a cumulative gap attributed only to a worker's last file would be misleading.

### Watcher operation contract correction — 2026-10-19

Inspection of `createPackBuilder.build()` and `buildWithCompiler()` confirms that every watch build
starts a fresh worker, executes the selected compilation phases, seals its output and verifies
publication. A retained compiler installation can save capture work; it does not remove these phases
or impose a smaller work limit on a source edit. The test helper nevertheless assigned 120s to the
first build and 60s to every later one. The normal run demonstrates that the latter limit expires
after the changed flow and frontend compile, before publication finishes.

Use the **existing 120s build-operation bound for every request**, removing the first/subsequent
branch. This preserves the full input scope and all value assertions. Request/notification bounds
remain 20s each, cleanup remains 20s, and the helper's exported scenario allowance composes those
with the actual operation bound. No default suite limit, RPC timeout or production compiler changes.
The diagnostic remains immutable on the original 60s rebuild bound, to preserve cause/timing evidence.

Local safe validation: all seven mocked watcher ownership/deadline cases, 53 timeout-policy and
subprocess-inventory checks, CLI TypeScript and focused correctness lint pass. The mocked operation
still aborts and reports its own deadline independently of request and cleanup failure checks.
Real affected watcher acceptance remains required after the diagnostic result; no broad pass is claimed.

### Reporting failure attributed to synchronous case sequences — 2026-10-19

Focused **39325170997**, workflow-only **`e3956518c`**, completes all **93/93 bodies in four files**,
zero failed/pending, 586.50s, but exits **1** with one unhandled `onTaskUpdate` error. Its JSON
`success: true` describes the test bodies; it does **not** establish successful process/reporting
acceptance. The two module-freshness cases pass under the original bound in 137.089s and 142.909s;
this focused timing does not erase the normal run's attributed 60s rebuild timeout.

The existing probe attributes long blocks to exact worker processes/files:

| Process/file | Measured loop gap | Interpretation |
|---|---:|---|
| `38267`, feature authoring/validation | 69,728ms | Consecutive synchronous generation/validation cases run without a macrotask turn; each body is under 29s |
| `36646`, output swap | 90,280ms | Gap grows from process wall 226,032ms to 316,312ms, crossing the late facade-replacement and following early-refusal scenarios |
| `36645`, database commands | 9,629ms | No reporting-window block demonstrated; leave this file unchanged |
| `41322`, watched module freshness | 13,303ms | No reporting-window block demonstrated |
| `36641`, Vitest coordinator | 189ms histogram maximum, 1,045ms tick gap | Responsive coordinator; the long blocks are in workers |

The two long blocks exceed Vitest's 60s reply window. This reproduces the worker-starvation condition;
the serialized unhandled error does not identify which individual RPC expired. Add one `setImmediate`
turn **after restoring globals and removing fixture output** in the two affected files' existing
`afterEach`, matching neighboring synchronous-toolchain suites. Do not alter assertions, timeouts,
database tests, production compilation or the runner protocol. All 53 policy/inventory checks, CLI
TypeScript and focused correctness lint pass locally.

Raw evidence: `/private/tmp/apack-watch-reporting-39325170997/_temp/` contains the verbose log,
per-body JSON and `event-loops.jsonl`; full timestamped job log is
`/private/tmp/apack-watch-reporting-39325170997-full.log`. Retain process/file identity and the sample
where a gap grows rather than attributing cumulative maxima to a later worker file.

Required next acceptance: both reporting files and all six actual watcher-helper consumers, two
workers, complete bodies, exit 0 with no unhandled reporting/cleanup error. `frontend-outputs` and
`frontend-globs` only use the resource fixture's consumer creation, never its watcher; their build
behavior is unaffected. The focused runner needs published packages and default-setup output, not
the separate external-contract fixture outputs or all-project typechecks. Final normal and strict
gates retain every original prerequisite.

The two reporting hooks are committed/pushed as **`19c1c9716`**; the watcher operation correction is
**`fa21a17ba`**. Focused acceptance
[39329992884](https://github.com/spankyed/apack/actions/runs/39329992884) on workflow-only
**`3ca1a45fc`** contains both. It selects the eight complete files, two workers, no per-test overrides,
the existing loop probe, verbose/JSON evidence and process exit status. Package preparation and
default-setup compilation have separate bounds. No broad gate runs concurrently. Await this exact
run; its dispatch is not acceptance.

### Complete watcher/reporting repair accepted — 2026-10-19

[39329992884](https://github.com/spankyed/apack/actions/runs/39329992884) is terminal
**completed/success** on **`3ca1a45fcac51dd1f28cae054717dce8db000dab`**, containing main repairs
**`fa21a17ba`** and **`19c1c9716`**. Actual report: **56 passed, zero failed/pending, eight complete
files, exit 0**, 1267.88s, with no unhandled reporting or cleanup error. All original assertions run.

| File | Passed bodies | Duration |
|---|---:|---:|
| Feature authoring/validation | 13 | 125.287s |
| Output swap | 14 | 508.919s |
| Frontend resources | 11 | 480.082s |
| Frontend workers | 4 | 156.544s |
| Package inputs | 9 | 361.343s |
| External types watch | 1 | 178.061s |
| Module freshness watch | 2 | 228.078s |
| Watch publication | 2 | 344.572s |

The same probe measures feature-validation's largest loop gap at **30,860ms**, output-swap at
**36,584ms**, versus 69,728/90,280ms before the yields. No sampled test-worker gap exceeds 36,584ms.
This accepts both affected reporting files and every actual watcher-helper consumer, including refusal,
repair, publication and teardown. Database's 64 unchanged bodies separately pass in the earlier diagnostic;
that earlier run's global error remains recorded rather than being relabeled successful.

Raw: `/private/tmp/apack-watch-reporting-39329992884/_temp/` (verbose/JSON/loop samples) and
`/private/tmp/apack-watch-reporting-39329992884-full.log`. The actual terminal job status and process
exit are accepted alongside the per-body JSON, which alone was insufficient in the preceding diagnostic.

Next run normal unfiltered integration with all normal prerequisites and no probe/filter, two cores,
the committed case/operation/pool bounds and fail-fast behavior. Then run main's committed-source
strict `--all`, finish the requirement audit and archive only completed documents. The focused pass
does not substitute for either gate; do not repeat already accepted focused files independently.

Normal unfiltered [39333769307](https://github.com/spankyed/apack/actions/runs/39333769307)
is dispatched on workflow-only **`06638811d`**, containing accepted main **`1ba85b976`**. The only
difference from main is the same normal acceptance workflow used previously: required typecheck,
default-setup and external-contract preparation, then `npm run test:integration -- --all` with two
cores, committed pool/case bounds and fail-fast. No loop probe, selected-file list or timeout override.
All previous logs and the unrelated untracked Wireit proposal are preserved. Await this immutable run;
the final main strict `--all` follows only after normal acceptance.

### User-approved final acceptance change — 2026-10-19

While normal **39333769307** remains live, the user asks to avoid repeating the entire strict gate
after it passes, explaining that another approximately 90-minute wait repeats accepted validation,
and confirms the revised path. This is an explicit change to this goal's acceptance procedure.
Require the normal unfiltered result, then audit source/requirements against actual preserved evidence,
reuse unchanged accepted checks, and close only genuinely uncovered affected checks before documentation
closure. No new full strict dispatch. Do not relabel an earlier failed strict run successful, omit
unproven behavior, or apply this exception as a general repository policy. The owning goal's live
decision and Phase 7 now state this; older chronological strict-rerun instructions are superseded.

### Normal unfiltered integration accepted — 2026-10-19

[39333769307](https://github.com/spankyed/apack/actions/runs/39333769307) finishes
**completed/success**, exact workflow-only **`06638811d2d7e4162ca50101283aa352b60c48b3`**, main source
**`1ba85b976`**. Every normal prerequisite passes, followed by unchanged
`npm run test:integration -- --all` with two workers: **831 passed, zero failures, 29 declared
platform skips; 66 passed files and two skipped files out of 68**, **exit 0**, **4896.31s** (81m36s).
Complete job time is 1h41m40s including preparation. There are no unhandled reporting errors or
reported cleanup failures. All three integration projects execute; this is the first complete normal
pool acceptance, not an aggregation of filtered runs.

The skips are 26 Windows PE cases, two Linux ELF cases and one Windows retained-dev-server publication
case. Their platform selectors are explicit in source; none is a fail-fast remainder. Preserve their
earlier Windows VM/Linux acceptance in the native input evidence and goal's finite platform register.
Linux ELF ownership/Vue/refusal and runtime-linked pre-initialization controls passed in
`39083763519`/`39085132469`; Windows PE, selection and publication acceptance is recorded in the
platform register. The normal macOS result does not claim to execute those platforms.

Raw: `/private/tmp/apack-normal-integration-39333769307/_temp/normal-integration.log`, the retained
pool-duration JSON, and `/private/tmp/apack-normal-integration-39333769307-full.log`.
The measured complete pool is 9314.39s of file time, 4896.31s wall; earlier partial-file sums were
not complete passing-run measurements. Existing aggregate and individual bounds accommodated it.
No new grouping, orchestration or timeout project is introduced at closeout.

After this source checkpoint only goal/evidence documentation changed. User-approved decision
**`2c790624d`** replaces the repeated final full strict run with this pass plus the requirement/source
evidence audit. Historical failed strict runs remain failed; no additional broad gate is dispatched.
