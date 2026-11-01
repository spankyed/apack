# Read-only chat renderer qualification — 2026-11-01

Supported chat messages now render Markdown directly instead of constructing fifty Tiptap editors
when opening a thread. Editable inputs and documents retain their editor. Unknown contributions
retain the existing viewer; supported-adapter failures are visible. Profiling and the decision
against speculative extension caches are recorded in [the attribution report](https://github.com/spankyed/apack/pull/310)
(PR #310).

## Results

Five warmups and twenty measured actions per variant; balanced ABBA order. Every measured action
passed correctness and retained the fifty full bodies and all 25 user truncation controls. No trial
or outlier was excluded. Latency runs have recording disabled; allocation profiles are separate.

| Requirement | Baseline | Candidate | Result |
| --- | ---: | ---: | --- |
| Plain thread readiness median | 395.90 ms | 185.65 ms | 210.25 ms / 53.11% lower; exceeds 20 ms and 5% gates |
| Rich thread readiness median | 572.40 ms | 289.60 ms | 282.80 ms / 49.41% lower |
| Sampled renderer allocation/action | 87,743,084 bytes | 28,749,585 bytes | 67.23% lower; exceeds 10% gate |
| Streaming median | 771.15 ms | 763.50 ms | 0.99% lower; within 5% regression gate |
| Lightweight recording overhead | 183.20 ms | 184.30 ms | 0.60% higher; final twenty-trial run is within 5% |

Allocation totals over twenty measured profiles: 1,754,861,680 versus 574,991,696 bytes. Sum the
sampling heap profile's recursive `selfSize`, excluding the five warmups. These are sampled
allocations, not retained heap, peak memory or CPU time. The earlier constructor probe established
fifty schema/view constructions versus zero per opening; clipboard serialization is a separate,
on-demand operation. The rich baseline includes a 2,479 ms outlier, retained in the comparison.

## Correctness and review

Real-browser checks compare exact selected text, actual Markdown clipboard contents, code text and
reference labels against the frozen viewer. They also exercise expansion/collapse, short/empty/long
content replacement and resizing. The rich fixture includes headings, emphasis, block quotes, nested
block structure, lists, tables, code, commands and references. Inline Markdown images remain absent
as in the old chat schema; attachment presentation is unchanged.

Review found and fixed table-cell paragraphs, nested list wrapping, empty-message line boxes,
code-copy text, reference boundary markers, adapter callback capture and cleanup, and preservation
of adapter root classes. Clipboard checks exposed a real Markdown-versus-plain-text difference:
copy now reuses the existing serializer in a temporary detached editor, always destroyed afterward.
Partial marked text, code and references have focused copy coverage. Final review additionally
caught stale serializer bindings when an extension changes but its read-only adapter does not. Copy
now reads the current accepted registry rather than the DOM-rendering dependency snapshot. A real
clipboard regression fails with the retired serializer and passes with its replacement, while the
rendered DOM stays identical. This changes only the copy event path; opening/streaming do not execute
it. Their valid qualifications are reused. Rendering owns no editor.

Unknown contributions use the original viewer; accepted adapters are validated without executing
them and their callbacks are captured. Replacement/removal disposes subscriptions and timers,
including error paths. Unrelated editing-only changes preserve DOM and selection targets.

All 43 UI cases pass, as do the 45 frontend-admission and 45 code-generation cases. The additional
foregrounding cases cover both gated and ungated execution; fifteen performance coordination cases,
relevant type checks and repository lint pass. Strict CI for the final code is [run 41352291011](https://github.com/spankyed/apack/actions/runs/41352291011), queued behind the earlier strict run. Results will be recorded on completion.

## Recording-overhead investigation

The first final overhead run failed: disabled 735.55 ms versus lightweight 838.80 ms, +14.04%.
Retain it as a failed qualification. Its renderer task time was much shorter than elapsed readiness.
Source review found test windows start hidden, while only revision comparisons showed/focused them.
A diagnostic confirmed native `visible=false` and `focused=false` even though the page reported
`document.hasFocus()=true` and visibility `visible`. Showing/focusing the native window yielded
196.60 versus 196.00 ms in the unchanged twenty-trial diagnostic. The diagnostic's post-processing
failed for lack of the standard invocation record; it is not accepted qualification evidence.

The existing trial gate now shows/focuses interactive windows with or without a revision coordinator,
before recording/readiness timing. Fresh warm-scenario manifests record `interactiveWindow=focused-v1`.
Revision trials already used that focus behavior, so their valid latency/allocation/streaming results
are reused. Startup runs without an interactive target are unchanged. The standard qualification
command completed all trials but measured 167.40 versus 176.40 ms, +5.38%: still over budget.
A predeclared single confirmation, with unchanged code, limits, twenty trials and assertions, measured
183.20 versus 184.30 ms (+0.60%) and passed the maintained qualification. Both results remain visible;
this is a passing final run, not evidence that every repetition stays below 5%. An attempted pooled
analysis refused the different container machine identities. That provenance assertion was preserved;
the two sessions are not pooled. No thresholds, deadlines or byte/completeness checks changed.

A proposed reusable UTF-8 encoding buffer saved only 0.036 ms per action when replaying the 169
observations from a retained trial (0.216 versus 0.180 ms, exact report equality). It and an unqualified
empty-attribute shortcut were reverted; neither became application code.

The first foregrounded verification failed before the scenario: no application state appeared within
the existing startup limit, followed by an API readiness timeout and bounded worker teardown timeout.
A focused API-only probe of the same build reached readiness in 6.93 seconds and exited cleanly;
startup failure did not reproduce. The subsequent standard attempt and confirmation both launched
successfully. No runtime startup change or weakened timeout was made.

## Provenance and reproduction

Production measurements: clean candidate `d7e63c7678795f2734b80741577905b7bf58b465` versus clean
baseline `02bc0c50d744a81870fce956f740693f094b4a5e`. The baseline is master `461f7bf2cb` plus only
the shared corpus/readiness harness. Subsequent changes are a test lint fix, benchmark foregrounding and a copy-only registry lookup fix;
the measured opening/streaming rendering path is unchanged. Final overhead source: `b7b7af330f933384f8f3288bc4f4687f0ba0dd8d`.

All runs use native pin `f496470679a7bd9764398108b20f62a73333c701`, binary SHA-256
`176e439110468bf2855b836a50d5a0ce7e7c0cdbfd43215eeef2b202546cc463`. Linux arm64, Electron
37.2.4 / Chromium 138.0.7204.157, Node 23.11.1 driver. The maintained runner enforces two CPUs,
6 GiB RAM, no additional swap and 256 MiB shared memory. Dependencies, fixture identities, source
cleanliness and build hashes are retained in each comparison manifest.

Evidence is in owned volume `apack-linux-work-2bd9183070f1`, beneath
`/work/.apack/performance/editor-renderer-final-copy-v2/`:

- `baseline-browser.json`, `candidate-browser.json`: exact browser parity and behavior results.
- `plain-latency/thread-open/comparison.json`, `rich-latency/thread-open/comparison.json`.
- `allocation-profiles/thread-open/{A,B}/trial-*.renderer.heapprofile`: raw allocation samples.
- `streaming/streaming/comparison.json`.
- `recording-overhead/thread-open/`: rejected hidden-window qualification.
- `focused-overhead-diagnostic/`: diagnostic visibility records and raw trials.
- `recording-overhead-focused-v1/`: failed startup and teardown evidence; no timing qualification.
- `api-start-probe.log`: successful isolated API readiness/shutdown diagnostic.
- `recording-overhead-focused-v2/thread-open/comparison.json`: first foregrounded run, +5.38%.
- `recording-overhead-confirmation/thread-open/comparison.json`: final standard run, +0.60%.

The independent baseline and owned diagnostics remain under `.apack/performance/` and `.apack/`
in the isolated worktree `/private/tmp/apack-performance-optimization.noindex`. Reproduce with the
maintained Linux runner, frozen native checkout, and independent installed/built baseline:

```sh
xvfb-run -a node scripts/with-source.mjs tsx scripts/compare-performance-revisions.ts \
  --baseline "$BASELINE" --candidate /work --scenario thread-open --mode disabled \
  --trials 20 --output "$OUTPUT/plain"
# Repeat with APACK_PERFORMANCE_CORPUS=rich, then --mode detailed for separate allocation profiles.
# Use --scenario streaming --mode disabled for the streaming regression guard.
xvfb-run -a node scripts/with-source.mjs tsx scripts/qualify-performance.ts \
  --scenario thread-open --mode disabled --compare lightweight --trials 20 \
  --output "$OUTPUT/overhead"
```

These are warmed synthetic app actions, not certification of every device, workload or filesystem.
Copy latency is not measured. Unsupported contributions keep the former construction cost. No data
migration or native source change is required. Earlier import timeout and local runtime stall are
retained in the logs; neither required a weakened guard or cancelled job.
