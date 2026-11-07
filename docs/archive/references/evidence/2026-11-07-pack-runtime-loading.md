# Runtime loading investigation and scenario ownership

The additional action/CLI lazy-loading experiment was evaluated and removed. The retained production
implementation is the [admission refactor](2026-11-07-pack-startup-admission.md); subsequent changes in the dependent PR concern tests and CI.

Retained scalar comparisons and manifests: [startup experiment](pack-runtime-loading-2026-11-07/startup-comparison.json),
[thread opening](pack-runtime-loading-2026-11-07/thread-comparison.json), and
[streaming control](pack-runtime-loading-2026-11-07/streaming-comparison.json).
Selected raw identity records: [startup](pack-runtime-loading-2026-11-07/startup-sha256.json),
[thread](pack-runtime-loading-2026-11-07/thread-sha256.json), and
[streaming](pack-runtime-loading-2026-11-07/streaming-sha256.json).
Full raw trials remain in the linked CI artifacts; failed runs retain logs and available artifacts.
Profiles are not duplicated here.

## Disposition of the runtime hypothesis

The admission candidate's detailed capture still sampled about 64 ms with Zod CommonJS frames in its
ancestry. Static callers included action schema injection and the Claude Code implementation imported
through the CLI service. The experiment deferred these through existing Promise-returning operations.

[Run 42360380114](https://github.com/spankyed/apack/actions/runs/42360380114) passed the complete
recording-disabled comparison, artifact `startup-revision-comparison-42360380114` (13571345440).

| Populated startup | Admission baseline | Experimental deferral |
| --- | ---: | ---: |
| Median | 2,217.90 ms | 2,170.03 ms |
| Range | 1,886.56–3,032.45 ms | 1,921.28–2,621.80 ms |
| Measured passing | 20/20 | 20/20 |
| Warmups passing | 5/5 | 5/5 |

The 47.87 ms (2.16%) pooled difference was inconsistent: six of ten ABBA block means favored the
candidate. First-/second-half medians were 2,276/2,208 ms versus 2,147/2,191 ms. This was insufficient
evidence of a worthwhile user-visible benefit for the additional async boundaries, so they were
removed. Do not compare these absolute times to the admission experiment's different VM/run or add
the percentages. No runtime deferral remains in the final implementation.

Baseline: `a331741c7c9a2ecb83c60528647d027a84c5f283`.
Experimental candidate: `edecce78c01613be0db39b5185155ca6f9aa5f15`.
The maintained reader independently verified raw hashes, lifecycle, balanced observed order and matching
provenance for twenty measured trials per revision. Both separate detailed diagnostic stores passed
one-trial admission; those instrumented trials are excluded from the timing comparison.

## Regression qualification and retained improvements

[Thread comparison 42359842755](https://github.com/spankyed/apack/actions/runs/42359842755), artifact
13570067836, passed all twenty measured and five warmup actions per revision. Its median was
718.2 → 721.3 ms, a 3.1 ms (0.43%) difference. No material median shift was observed; this does not
establish tight non-inferiority, tail bounds or cold first-query latency. The candidate was experimental
source `828d87f41c`; the baseline was the final admission production source `a331741c7c`.

The existing manual CI comparator now selects populated startup, thread opening or streaming, with
independent scenario queue ownership. No new recorder, runtime flags or custom module cache was added.
An existing packaged-boot case now exercises concurrent schema-using actions from the real installed
pack. This preserves deployment-boundary coverage without retaining the rejected optimization's tests.

[Corrected streaming comparison 42365886856](https://github.com/spankyed/apack/actions/runs/42365886856),
artifact `startup-revision-comparison-42365886856` (13573228192), passed all twenty measured actions
and five warmups per variant, including successful process teardown. The maintained reader independently
verified raw hashes, observed balanced order, matching provenance and lifecycle. Medians were
860.15 → 866.50 ms (+6.35 ms / 0.74%); ranges were 817.8–963.0 ms versus 814.3–1,104.0 ms.
Both variants contain identical admission production source and the same fixture-ownership fix, so
this is a control/qualification result, not an optimization claim. The sources are baseline
`f76a2774eb0213e49c99a4e43d768d16fb4ce7b6` and candidate
`659be6717791e3f15074dcf400912ff2e2c021a0`.

## Failures and corrections retained

- The first runtime startup attempt (42358827233) failed during seed preparation before timing:
  twelve imported threads were expected and zero observed. The other variant logged a port collision;
  causality was not established. The seed now retains its import status and thread IDs on failure.
  The diagnostic-qualified retry passed unchanged assertions and deadlines. No product port change
  or timeout increase was made based on this observation.
- An early experimental source used native ESM `import('zod')`, which cannot use the installed pack's
  CommonJS host resolver. Review corrected this through an internal lazy module; the older strict
  run's onboarding failure confirmed the deployment issue. The entire experiment was later removed.
- Streaming run 42359844748 completed its action checks but failed teardown with ENOTEMPTY while
  deleting the working directory. Its run is not admitted as a passing comparison. Scenario cleanup
  ran before the application stopped writing. Fixtures now live under the authoritative Electron test
  profile; its existing owner waits for Electron and the API child to exit before deleting storage.
  Scenario close only saves its journal. No retries, delays or new cleanup framework were introduced.
- Corrected streaming attempt 42364506169 stopped before builds because the unqualified baseline
  branch name was not a local ref in the fresh checkout. The retry pins its immutable full commit SHA.
  Both comparison variants contain exactly the same fixture-ownership correction and unchanged
  admission production source.

- Older strict run [42360703877](https://github.com/spankyed/apack/actions/runs/42360703877)
  found the experimental cold-loading test invoked a CLI service without an accepted host binding.
  This test and the runtime optimization it targeted were removed together. The retained packaged-boot
  case exercises concurrent schema-using actions through the actual accepted installed runtime.

## Source-qualified acceptance

[Final strict acceptance 42364159120](https://github.com/spankyed/apack/actions/runs/42364159120)
passed all six jobs on `9b20ffbbe0`: producer, native 1/2, integration 1/2 and application/rest.
Its production source is identical to admission candidate `a331741c7c`; final helper commit
`659be67177` changes only the private performance fixture ownership. Subsequent changes add focused captured-install regression coverage, archive
this evidence and clarify the maintained suite documentation.
The private warm-scenario helper changed after the production checkpoint; its changed path is validated
by the corrected maintained streaming comparison and a one-file lint check. Unchanged native/application
outputs do not require another broad run solely for that helper. Workflow lint passed.

## Post-qualification review

Review traced fresh/unchanged installs, settings recovery, discovery handoff, changed-build refusal,
live activation/reload, atomic catalog publication and scenario teardown. No additional production
bug was found. The admission PR adds direct captured-update refusal coverage, with a passing focused
suite and a failing counterfactual when the revision check is removed. Archived raw identities were
checked against the qualified downloads. CI guidance now names baseline refs available in a fresh
checkout, and the packaged action test comment no longer implies runtime deferral is retained.
No production implementation or qualification criteria changed; earlier production CI and measurements
remain valid rather than being represented as new runs on these test/docs-only commits.
