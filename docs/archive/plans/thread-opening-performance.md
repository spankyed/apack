# Thread-opening performance

Status: complete. Both bounded runtime candidates rejected and reverted; retained harness correction qualified.
Base: master `984f1b4aca`; native pin `f496470679a7bd9764398108b20f62a73333c701`.

## Outcome and scope

Improve the maintained fifty-message thread-opening action using measured editor-construction or
layout savings. Preserve full bodies, Markdown safety/formatting, selection/copy, links, images,
code-copy, truncation/expansion, streaming and contributed editor lifecycle. Do not substitute
viewport-only readiness, share mutable editor/parser state or rewrite the viewer speculatively.

Work in `session/thread-opening-performance` at
`/private/tmp/apack-performance-optimization.noindex`; leave the main checkout available. Reuse
independent dependencies, generated outputs and the owned Linux volume. Check existing jobs before
expensive execution and never cancel another run. Use the maintained two-CPU, 6 GiB/no-extra-swap,
256 MiB-shared-memory Linux runner with disk-backed fixtures. Do not merge this work.

## Investigation and acceptance

Attribute editor construction/allocation and layout work using existing profiles where source is
unchanged. Use temporary scalar/call-count probes when attribution is ambiguous. Do not mistake
sampling elapsed/idle time for CPU or sampled allocation for retained heap. Record the mechanism
before each of at most two localized prototypes, compare against the original implementation and
retain rejected results.

Use disabled recording, five warmups and twenty measured actions per revision in observed balanced
order, with matching fixture, native build and resource conditions. Require at least **5% and 20 ms**
less median readiness latency, with all fifty complete, visible message bodies. A construction
candidate must also save at least **10% sampled renderer allocation**; a layout candidate may instead
demonstrate fewer redundant measurements. Preserve all deadlines, trial counts and work assertions.

Before shipping a runtime change, verify affected behavior and rich/long Markdown, no more than 5%
median streaming regression, and the unchanged 5% lightweight recording-overhead budget. Use focused
checks during development, the repository gate at a stable checkpoint, required final strict CI and
a correctness/completeness review. Reuse valid results; documentation-only updates need no repeated
broad run. If neither candidate qualifies, restore runtime code and report that outcome.

## Findings and readiness correction

The earlier twenty renderer captures (`54007b7094`) remain useful for attribution: chat/editor source
and the lockfile are unchanged. Their 17.05 seconds of elapsed sampling include program/idle/GC.
Truncation ancestors account for 988 ms; the 1,722 ms in `getClientRects` are the readiness checker,
not application-widget measurements. Editor setup ancestors contain 908.6 MB of 1,719.0 MB sampled
allocation; ancestry categories overlap.

Seven-action diagnostics found exactly 25 bubble reads before editor DOM existed. They also found
that completion consistently had only 24 of 25 user truncation controls; the last could arrive later.
The retained harness change requires all 25 controls in addition to the existing fifty complete,
visible bodies. Runtime identity records `threadReadiness=full-bodies-and-user-truncation-v1`;
comparison admission rejects pooling that protocol with historical readiness. No ordinary test
cases or application instrumentation are added.

## Candidate results

Both revisions use the stronger readiness contract. Baseline `84be38849d` contains the new master
and harness, retaining original application behavior. Its dependencies/output are independent.

| Candidate | Mechanism | Baseline median | Candidate median | Change | Disposition |
|---|---|---:|---:|---:|---|
| 1 (`218903c3af`; measured at `e7629acd08`) | Remove synchronous measurement at observer registration | 473.35 ms | 493.80 ms | +20.45 ms / +4.32% | Rejected |
| 2 (`e921d42427`) | Also replace broad component-update measurement with a post-flush delivered-row watch | 512.35 ms | 600.00 ms | +87.65 ms / +17.11% | Rejected |

Each comparison completed twenty measured actions per revision, all passing correctness. Candidate 1
removed all pre-editor reads; candidate 2 reduced total bubble measurements from 75 to 50 per action.
Both diagnostics rendered fifty editors and all 25 controls at completion and afterward. Neither
established a latency benefit. Their favorable two-trial contract runs were not qualifications.

Candidate 2's first full attempt failed during baseline Electron setup, before Playwright attachment.
It remains invalid setup evidence, excluded from timings. One unchanged retry produced the table's
result. The launch failure's root cause is unestablished; no deadlines or assertions were changed.

Both prototypes are reverted in `9a66361766`; `message.vue` is byte-identical to master. There is no
application-runtime change or claimed speedup to ship. A streaming regression comparison is not
needed for the retained harness-only change. Do not reroll rejected candidates for favorable results
or add a third prototype under this bounded investigation.

## Evidence and delivery

Owned volume: `apack-linux-work-2bd9183070f1`, under `/work/.apack/performance/`:

- `thread-investigation-8b6e43317e/`, `thread-ready-8b6e43317e/`: original diagnostic records.
- `thread-resumed-4d3a7f6356/qualification/`: candidate 1's full comparison.
- `thread-candidate2-e921d42427/qualification/`: invalid baseline setup attempt.
- `thread-candidate2-e921d42427/qualification-retry1/`: candidate 2's full comparison.
- `thread-ready-e7629acd08/`, `thread-ready-e921d42427/`: candidate diagnostics.
- `thread-final-9a66361766/recording-overhead/`: final readiness-contract overhead qualification.

Frozen native checkout: `/private/tmp/apack-performance-elmdb-1849f68`, updated to the pin above.
Linux binding SHA-256:
`176e439110468bf2855b836a50d5a0ce7e7c0cdbfd43215eeef2b202546cc463`.

[PR #309](https://github.com/spankyed/apack/pull/309) retains the readiness correction and evidence.
[Required strict CI](https://github.com/spankyed/apack/actions/runs/41285486170) targets `9a66361766`.
All six required strict jobs passed on `9a66361766`: producers, both native legs, both integration
legs and app-and-rest. Focused scripts/E2E type checks, lint and old/new runtime-contract admission
checks passed during development.

The extra Linux broad-gate attempt retained logs at
`node_modules/.cache/apack-chain/runs/2026-11-01T08-02-05Z-1188/`. Both unit pools exhausted
their existing 600-second suite limits. The saved host log also has six permission-test failures
whose `chmod` assumptions do not apply to this root container, and one captured-runtime execution
timeout. This local run did **not** pass; the unchanged tests passed in required non-root strict CI.
No test, timeout or assertion was weakened to accommodate it.

Final overhead attempts are retained separately: `recording-overhead/` failed during application
setup; `recording-overhead-retry1/` exhausted the whole-test budget after thirty of forty measured
actions, all completed actions correct. Neither is a qualification. A host-native maintenance job
and substantial background activity were observed during this period; their causal contribution
is unestablished. `recording-overhead-quiet/` runs only after the competing native job and this
session's local gate ended, with unchanged counts, resources, assertions and deadlines.
The final full run qualified: twenty measured actions per mode, all forty passed. Disabled median
973.65 ms, lightweight median 953.65 ms (-20.00 ms / -2.05%); assessment `within-budget` against
the unchanged 5% recording-overhead budget. The negative difference is not a speedup claim.
This same-process mode comparison has a different execution policy from the two-worker revision
comparisons; do not pool or directly compare their absolute medians.

Final review found no material correctness/completeness defect in the retained harness changes.
The remaining diff contains only this plan and the two performance-harness files. Application
runtime code, public contracts and dependency pins are unchanged. The follow-up commit records
documentation only; the strict result above covers the final code. Nothing is merged.
