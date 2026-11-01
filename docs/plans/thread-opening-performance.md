# Thread-opening performance

Status: resumed after rebase onto master `984f1b4aca`, 2026-11-01.
Native pin: `f496470679a7bd9764398108b20f62a73333c701`.

## Outcome and scope

Improve the maintained fifty-message thread-opening action using measured editor-construction or
layout savings. Preserve full message rendering, Markdown safety, formatting, selection/copy,
links, images, code-copy controls, truncation/expansion, streaming updates and contributed editor
lifecycle. Do not substitute viewport-only readiness, remove completion assertions, or share mutable
editor/parser state between messages. Do not rewrite the viewer before demonstrating a need.

Work in `session/thread-opening-performance` in the existing isolated performance worktree;
keep the main development checkout available. Reuse its independent dependencies, Linux volume,
frozen native source and valid outputs. Inspect existing jobs before expensive execution; never
cancel another run. Repeated app execution stays in the maintained two-CPU, 6 GiB/no-extra-swap,
256 MiB-shared-memory Linux runner, with disk-backed fixtures.

## Investigation before implementation

1. Reuse the previous action profiles where UI source is unchanged. Attribute construction and
   allocation to extension configuration, schema/parser setup, editor/view creation and initial
   transactions. Attribute layout reads to editor selection, truncation checks and scroll handling.
   Profile elapsed/idle time is not action CPU; sampled allocation is not retained heap.
2. Collect focused phase/call-count diagnostics only where those profiles cannot distinguish causes.
   Use existing profiling/report admission and temporary diagnostic probes; avoid permanent tracing
   in runtime components. Confirm actual construction/measurement counts per displayed message.
3. Record a mechanism and predicted benefit before prototyping at most two localized candidates.
   Reject candidates too small to matter or requiring unsafe shared state. Keep a frozen original
   implementation and use the maintained cross-revision runner for balanced comparisons.

## Acceptance

The primary outcome is disabled-recording thread-opening readiness, with all fifty complete message
bodies and the existing work/readiness checks. Use five warmups and twenty measured actions per
revision in observed balanced order, matching native, fixtures and resource conditions. Acceptance
requires at least **5% and 20 ms** less median latency, with correctness unchanged. A construction
candidate must also demonstrate at least **10% less sampled renderer allocation**; a layout-only
candidate may instead establish fewer forced/redundant measurements. Do not infer latency from a
profiled run or claim a speedup from an insignificant/noisy result.

Retain every failed or rejected result. Preserve deadlines, trial counts, report integrity and the
existing 5% lightweight recording-overhead budget. No more than 5% median regression is acceptable
on an affected streaming action; investigate rich/long Markdown and editable-editor paths whenever
the shared editor changes. If no safe candidate qualifies, report that outcome rather than ship one.

## Implementation, validation and delivery

Keep behavior in its owning editor or thread component, with a small private helper only when it
clarifies ownership or scheduling. Reuse the existing editor-composition, Markdown and thread
cases; add only demonstrated missing contracts, and show a meaningful guard failing against the
original implementation. Preserve extension replacement, refusal/cleanup and per-editor ownership.

Run focused checks while developing, then the repository gate at a stable checkpoint. Qualify final
thread-opening recording overhead and affected streaming behavior. Reuse valid build/check results;
documentation-only edits do not require another broad run. Finish with a correctness/completeness
review, fix material findings, and deliver a committed/pushed PR with compact source-qualified
measurements, exact provenance, limitations and required strict CI. Keep raw reports/probes in the
owned ignored report volume. No merge is included in this work.

## Initial findings and comparison contract

The earlier twenty detailed renderer captures are reusable for attribution: the lockfile, Tiptap
source and chat source are identical between `54007b7094` and this baseline. Their 17.05 seconds
of elapsed sampling include program/idle/GC. Application truncation ancestors account for 988 ms;
the 1,722 ms in `getClientRects` belong to the readiness checker. Those are not application-widget
measurements. Editor setup ancestors contain 908.6 MB of the 1,719.0 MB allocation sample; phase
ancestry can overlap and is not retained heap.

A diagnostic-only seven-action run produced fifty message editor roots per action and exactly
25 bubble reads before editor DOM existed. Total bubble reads ranged from 76 to 100. A second
probe found the existing completion boundary consistently had only 24/25 user truncation controls;
the remaining control could arrive after completion. Raw records remain in the owned report volume
under `thread-investigation-8b6e43317e/` and `thread-ready-8b6e43317e/`. These are contract probes,
not timing qualifications.

Before changing runtime behavior, strengthen thread completion to require all 25 long user bubbles'
controls as well as fifty complete bodies. Declare runtime contract
`threadReadiness=full-bodies-and-user-truncation-v1`; existing manifest compatibility compares the
entire runtime record, so older readiness protocols cannot be pooled with it. Both revisions in the
performance comparison must use this stricter contract. Trial counts and deadlines stay unchanged.

Candidate 1 removes the synchronous measurement at observer registration, retaining the observer's
initial notification and the existing update checks. The predicted opportunity is the redundant
pre-editor reads (442 ms of the old profile's truncation ancestry, about 22 ms per captured action).
Only an unprofiled comparison can establish the actual saving. Verify controls are settled at the
stronger completion boundary and after paint; reject a result that merely shifts required work.

## Paused checkpoint

- Worktree: `/private/tmp/apack-performance-optimization.noindex`; branch
  `session/thread-opening-performance`. Runtime candidate commit: `35da6ecab3`.
- No Docker job remains running. Both preparation runs completed; nothing was cancelled.
- The frozen independent app baseline is in owned volume `apack-linux-work-2bd9183070f1`, at
  `/work/.apack/performance/thread-baseline-8b6e43317e`. It still has original commit `8b6e43317e`
  and the **old readiness checker**. Its dependencies and generated output are independent copies.
- The stronger readiness baseline is committed at `15f695db2e`: it changes the test contract and
  metadata, not the application. Scripts/E2E type checks and focused lint passed. A pure admission
  check proves old/new runtime readiness contracts cannot be compared.
- Candidate 1 (`35da6ecab3`) removes only the synchronous `checkTruncation()` at observer
  registration. Observer and update checks remain. **It has not been benchmarked or accepted.**
- Native execution uses `APACK_LINUX_ELMDB_ROOT=/private/tmp/apack-performance-elmdb-1849f68`.
  Keep the existing image, work volume and compiler outputs; do not copy compiler targets.
- One stale derived `src/__generated__/ears.ts` in the host worktree was repeatedly overwriting
  Linux's current generated source. It has been refreshed from the main checkout, whose generator
  inputs are identical; this is ignored derived source, not a runtime API change.

Resume by updating the baseline checkout **only to `15f695db2e`** (fetch that commit from `/work`,
then detach there), so it retains original runtime behavior with the same stricter harness as the
candidate. Keep its root/path and installed outputs. Then build the candidate via the maintained
graph, run a two-trial contract comparison, and run the twenty-trial disabled-recording comparison
with `scripts/compare-performance-revisions.ts`. Verify all fifty bodies and 25 truncation controls
in both revisions, apply the unchanged 5%/20 ms acceptance, and retain rejected results.

Owned ignored helpers are under `.apack/`: `prepare-thread-baseline.sh`,
`prepare-thread-comparison.sh`, `run-thread-ready-probe.sh`, `thread-probe.config.ts`,
`thread-ready-probe.config.ts`, `thread-probes/`, and `analyze-thread-phases.mjs`. The comparison
script still needs the explicit baseline checkout update above; it currently prepares the old
baseline and runs diagnostics only. No accepted paired timing run or new PR exists yet.

Raw reports: volume paths `thread-investigation-8b6e43317e/` and
`thread-ready-8b6e43317e/` under `.apack/performance`. Host summaries/logs: relative to
`/private/tmp/`, `apack-thread-phase-attribution.json`, `apack-thread-baseline-phase-counts.json`,
`apack-thread-baseline-preparation.log`, and `apack-thread-comparison-preparation.log`.

## Rebased resumption

The branch rebased cleanly onto `984f1b4aca`. Chat/editor source and the root lockfile are
unchanged from the original baseline; upstream changes include the native revision and application
startup/test infrastructure. Historical attribution remains useful, but historical latency is not
a comparison against this revision. The independent native checkout now matches the new pin.

Use baseline `84be38849d` (new master plus the stronger harness, original application behavior)
against candidate `218903c3af`; checkpoint HEAD `4d3a7f6356` adds documentation only. The existing
Linux baseline directory and independent dependencies are retained, with its source explicitly
updated before either comparison. The owned `.apack/resume-thread-comparison.sh` runs candidate
preparation, the readiness diagnostic, a two-trial contract check, then twenty measured actions per
revision. Evidence goes under `.apack/performance/thread-resumed-4d3a7f6356/`. None of these
resumed measurements has yet completed; candidate acceptance remains pending.
