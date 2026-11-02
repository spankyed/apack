# Conversation viewer qualification — 2026-11-02

Archived qualification evidence. Results apply to the recorded revisions.

## Implementation and acceptance

Conversation message bodies share one read-only Tiptap editor, its schema and its view. Identified
message block nodes use supported Vue node views to compose the existing message controls around
ProseMirror-owned content. Changed Markdown goes through the existing contributed `setContent`
command; unchanged parsed bodies and row views are retained. Extensions, references, command
decoration, code copying and Markdown clipboard serialization keep their existing owners.

The declared acceptance is at least 5% and 20 ms improvement for plain thread opening, at least 10%
less sampled renderer allocation, no rich-content latency regression, at most 5% streaming regression,
and the maintained recording-overhead budget of 5%. Each latency scenario checks its business result.

## Revisions and method

- Candidate: `cf55bed96c23d93639439acb8ded5cd5c7986379`; runtime implementation last changed in
  `a483f5d6dc`. Later documentation does not change these outputs.
- Baseline: `49f4e9110155875167e292f40bdd2de660395826`, preserving per-message editors and adding
  the identical measurement harness. Its independent checkout and dependencies are retained.
- Native pin and built checkout: `f496470679a7bd9764398108b20f62a73333c701` in both revisions.
- Linux arm64, Electron 37.2.4 / Chromium 138.0.7204.157, Node 23.11.1 for orchestration;
  Tiptap 3.32.0, Vue 3.5.44, tiptap-markdown 0.9.0, markdown-it 14.3.3,
  prosemirror-markdown 1.13.4 and lowlight 3.3.0 are identical between revisions.
- One maintained Linux runner, two CPUs, 6 GiB memory with no additional swap and 256 MiB shared
  memory. Measurements use ordinary disk-backed `/tmp` (`overlayfs`), with persistent Docker data
  on the external drive. Bounded RAM scratch was used only while building, before app measurements.
- Five warmups and 20 measured trials per revision, individually balanced ABBA actions, focused
  interactive windows, warm processes and filesystem cache. Separate serial arms cover plain and
  rich opening, allocation profiles and streaming. Recording overhead compares disabled and
  lightweight modes using the maintained alternating-mode suite.
- The 10-core host also ran native workloads. The captured process snapshot records that contention;
  this is not a quiet-host or cross-platform certification. No source, machine identity or manifest was
  rewritten, and no samples were pooled across runs.

## Correctness and integration

The final actual-app check passes all 50 complete rich bodies and 25 user truncation controls,
expansion/collapse, short/empty/long source replacement and viewport resizing. Baseline and candidate
agree exactly on selected text, native Electron Markdown clipboard, code text and reference text.
Candidate-specific checks prove one conversation view, retained body DOM through aside collapse,
cross-thread message focus fully inside the viewport, and 100 rows after loading older messages within
the original five-second assertion while preserving the original anchor within three pixels.

Focused tests cover unchanged row identity, prepend/reorder/removal, selection mapping, rich Markdown
tables, contribution and popup replacement, subscription cleanup, parser-refusal recovery, duplicate
identity refusal, command boundaries and actual interaction bindings through conversation node views.
No alternate Markdown rendering or manifest adapter contract remains.

## Profile-supported fixes

A paging profile identified repeated synchronous truncation reads during Vue node-view updates as a
main-thread layout bottleneck. Truncation now observes unconstrained natural content and uses dimensions
already delivered by ResizeObserver. Search focus and prepend restoration run after mounted views,
through the existing scroll-positioning helper. Prepend restoration uses an absolute position to remain
stable across its repeated frame callbacks.

Diagnostic paging samples before and after the initial layout fix were 5.554 s and 2.206 s; the latter
preserved the anchor within 0.1875 px and passed full-viewport focus. Those are attribution samples,
not qualified latency comparisons. The final observer-dimension refinement is covered by the final
actual-app check and the fresh qualification below.

## Results

| Scenario | Baseline median | Candidate median | Change |
| --- | ---: | ---: | ---: |
| Plain thread opening | 458.4 ms | 375.2 ms | −83.2 ms (−18.15%) |
| Rich thread opening | 689.0 ms | 549.4 ms | −139.6 ms (−20.26%) |
| Streaming completion | 766.9 ms | 803.6 ms | +36.7 ms (+4.79%) |
| Recording: disabled vs lightweight | 370.6 ms | 372.2 ms | +1.6 ms (+0.43%) |

All latency arms have 20 successful measured trials per revision/mode. The allocation arm has 20
measured renderer profiles per revision: 1,739,804,836 sampled bytes in the baseline and 601,029,884
in the candidate, a **65.45% reduction**. All original acceptance thresholds pass. Streaming is close
to its 5% regression limit; this work establishes no streaming speed improvement.

### Streaming failure and focused investigation

The initial full streaming attempt stopped at candidate trial 9: final text was delivered, but the test
observed only one progress update (`missing-intermediate-progress`). The backend log records the query
handle at 18:32:02.643, the first event at 18:32:03.742 and all 31 events drained by 18:32:03.751.
The final 864 characters arrived together, so the renderer had no intermediate delivery to display.
This observation localizes the symptom before rendering; it does not identify the cause of the delay.

A focused paired run with backend and renderer CPU profiles passed all seven actions per revision
(five warmups and two measured diagnostic trials). It did not reproduce the failure or identify a
production fix. Its two-trial timing is not used for qualification. The subsequent full streaming
invocation in `conversation-streaming-qualification-v3` passed all 25 actions per revision with the
unchanged intermediate-progress assertion. No samples from the failed or diagnostic invocations are
included in its comparison. The intermittent burst remains an explicitly retained observation,
not a claimed fix; a recurrence should be investigated from its producer/backend delivery evidence.

## Evidence and limitations

Raw evidence is retained in `apack-linux-work-2bd9183070f1`, under
`/work/.apack/performance/conversation-viewer-qualification-v2`; final browser behavior is in
`conversation-validation-v4`. The accepted streaming invocation is
`/work/.apack/performance/conversation-streaming-qualification-v3`; the failed attempt stays in
the v2 root. Manifests include actual build hashes, clean source/native revisions,
runtime, corpus and resource identity. Each arm retains individual trial reports and any captured
profiles. The independent archive includes these reports, both failed/refused attempts, diagnostic profiles,
the exact probe/checker scripts and a Git bundle of the baseline commits above `461f7bf2cb`.

Archive: `.apack/performance/conversation-viewer-2026-11-02.tar.gz` in the owning worktree and
`/work/.apack/performance/` in the volume. SHA-256, independently checked after copying to the host:

```text
77fcd0ae280aaaaceecb7fa8585aed7d642e337b406123c1ed9ccd5f7f84f95f
```

The archive is local evidence, not a published download. Successful reports are retained independently
of the live runner. Inspect the exact invocations and original thresholds in its
`qualify-conversation-viewer-v2.sh` and `check-conversation-qualification.mjs`; the checker takes the
v2 root and the explicit v3 streaming root. The latter records a separate complete comparison rather
than combining samples across attempts.

The refused `conversation-viewer-qualification-v1` attempt is retained separately. It completed plain
trials but failed the clean-source guard because documentation was stale in the container and the
resumed command lacked the maintained runner's execution-record declarations. No result from that
attempt is accepted or mixed with v2. The committed documentation was synchronized and the runner's
exact lock-record environment restored before the fresh run; its source and native manifests are clean.

Sampled allocation bytes describe the heap sampler's observations, not peak RSS or total live memory.
Warm action results do not establish cold-start, very large conversation or other-platform performance.


## Validation and review

Final lint passes with zero warnings/errors. Typed UI/pack checks and the focused editor, reference,
command-boundary and message-consumer suites pass. The final actual browser run is
`conversation-validation-v4/browser.log` (one passed test).

All six strict jobs passed on the earlier `054467ae45` checkpoint:
[earlier strict CI](https://github.com/spankyed/apack/actions/runs/41490081660).
The required final code gate targets `cf55bed96c`:
[final strict CI](https://github.com/spankyed/apack/actions/runs/41499186813).
All six required jobs passed: producers, app-and-rest, native-1, native-2, integration-1 and
integration-2. Subsequent changes only finalize and archive documentation; the repository guide
requires no code rebuild or repeated gate for those edits. The completed
[implementation plan](../../plans/conversation-viewer.md) records delivery.

The final source review checked document/cache publication, capture-error recovery, contribution
lifetime, unchanged selection/row identity, stable content DOM, clipboard ownership and scroll
coordination. No further material code defect was identified. The incomplete first host broad run is
not counted as a pass; the final strict gate supplies broad acceptance.


## Paging-check follow-up — 2026-11-02

A clean, matching-pin reproduction on the merged implementation reproduced the missing-button
failure. After search focus, the page limit grew from 50 to 100; all 100 bodies rendered,
`hasMore` became false and the manual button correctly disappeared. The supplemental check had
incorrectly coupled search/automatic paging to a later manual click. Its original failure remains
retained; it is not relabeled a pass.

Independent manual and automatic cases then exposed a separate restoration defect: the visible
anchor moved 7.8125 and 9.8125 pixels. In the measured manual case, container position, container
height, anchor height and loaded fonts were unchanged. Total scroll height grew 27,946 pixels,
but the content before the anchor grew 27,938.1875 pixels. Restoring the total-height delta therefore
overscrolled by 7.8125 pixels. Runtime correction `08b9ad0aee` instead captures the first visible
message's screen position and restores that point through the existing positioning helper, falling
back to the captured scroll position if the anchor is absent. Paging policy and public APIs are unchanged.

The maintained [paging UI spec](../../../../tests/e2e/ui/conversation-paging.spec.ts), finalized at
`03209c364d`, separates manual paging, automatic paging and cross-thread search focus. It checks complete,
ordered, unique rows, the original five-second completion and three-pixel anchor bounds, and loaded/older
search targets remaining fully visible after the next page renders. Both anchor cases fail before the
correction. All three final cases pass; the retained rich-content, native clipboard, replacement,
collapse and focus check also passes. UI-test TypeScript, pack Vue TypeScript and focused correctness
lint pass. Accepted browser runs use the maintained disk-backed Linux runner with two CPUs, 6 GiB
memory and native source exactly matching pin `e5ecfec8894c0f32d243c7d5b18245b35b018fdc`.

The fix-forward is [PR #312](https://github.com/spankyed/apack/pull/312).
[Strict CI](https://github.com/spankyed/apack/actions/runs/41533371482) covers runtime correction
`08b9ad0aee` and is pending at this evidence checkpoint; subsequent edits strengthen only UI coverage
and record evidence. These correctness checks do not requalify the earlier performance measurements.

Raw failed/passing reports, geometry, traces and exact probe sources are retained in owned volume
`apack-linux-work-2bd9183070f1`, under `/work/.apack/performance/`, and independently copied into the
owning worktree as `.apack/performance/conversation-paging-2026-11-02-final.tar.gz`. Its SHA-256 matches
between container and host:

```text
1db640ee87044364aa24e9f42f1f43813727920ef743e0153b69f7254acdca0f
```
