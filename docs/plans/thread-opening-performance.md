# Thread-opening performance

Status: approved for execution, 2026-10-31. Baseline code: merged master `8e2d334e2b`;
native pin `1849f6899e3d707ac8e25e7f81fa52b472b2a9a0`.

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
