# Chat editor construction attribution — 2026-11-01

## Finding and decision

The maintained fifty-message action constructs fifty read-only Tiptap editors. A dedicated viewer
can remove those editors while keeping complete body/control readiness; reducing construction
cost is a larger opportunity than the rejected truncation-scheduling changes.

The older twenty detailed captures remain useful: editor/chat source and dependency versions
match the baseline. They attributed 908.6 MB of 1,719.0 MB sampled allocation to editor-setup
ancestry, including 346.6 MB beneath option factories. These categories overlap. Resolving exact
historical bundle locations identifies Tiptap's recursive extension-field lookup and dynamic
options getter; it returns fresh option objects on repeated accesses. Rewriting private getters or
sharing mutable extension instances is not a suitable application-level optimization. No small
candidate was justified by the evidence; proceed with the approved dedicated-viewer stage.

## Fresh construction probe

Baseline: master `461f7bf2cb`, with the corrected readiness and shared rich-content harness;
frozen baseline commit `02bc0c50d7`. Prototype source: `5e3f4c0700`.
Both use native `f496470679a7bd9764398108b20f62a73333c701` and matching installed Vue, Tiptap,
lowlight and Markdown parser versions. Each owns independent dependencies and build outputs.

A seven-action diagnostic preserves function results and wraps actual editor construction methods.
Every baseline action constructs fifty read-only schemas/views; every prototype action constructs
zero. The displayed fifty bodies and 25 truncation controls remain required by both revisions.

The last two actions, following five warmups, give this baseline attribution:

| Phase | Calls/action | Inclusive ms/action | Exclusive ms/action |
|---|---:|---:|---:|
| Extension options getter | 127,300 | 91.10 | 72.50 |
| Extension manager | 50 | 44.50 | 24.75 |
| Before-create hooks, including Markdown | 50 | 31.60 | 27.50 |
| Document construction | 50 | 5.90 | 5.90 |
| View construction | 50 | 67.55 | 35.15 |
| Node-view construction | 50 | 31.75 | 17.05 |
| Destruction | 50 | 3.95 | 3.95 |

These are instrumented synchronous elapsed times, not production CPU or latency measurements.
Inclusive phases overlap. The Editor-level `createSchema` method is an assignment; schema creation
occurs inside extension-manager setup, so its near-zero duration does not establish free schemas.
Before-create time includes all corresponding hooks, not Markdown alone. Option counts also include
any other editor work during the action. Do not add these rows together as independent costs.

## Prototype outcome, pending final implementation qualification

Fresh unprofiled comparisons use five warmups and twenty measured actions per revision, individually
balanced ABBA, inside the maintained two-CPU, 6 GiB/no-extra-swap, 256 MiB-shm Linux runner.

| Corpus | Baseline median | Prototype median | Difference |
|---|---:|---:|---:|
| Maintained plain messages | 392.80 ms | 188.05 ms | -204.75 ms / -52.13% |
| Rich Markdown, references and commands | 590.55 ms | 281.90 ms | -308.65 ms / -52.26% |

All eighty measured actions passed correctness, including fifty complete bodies and all 25
truncation controls. The rich corpus also checks structure, reference pills, command highlighting
and final completeness markers. Separate fresh detailed runs sampled 1,819,241,396 renderer
allocation bytes for the baseline versus 586,183,000 for the prototype over twenty actions each:
90.96 MB versus 29.31 MB per action, a 67.78% reduction. These are sampled allocations, not retained
heap, peak memory or a profiled latency claim.

The implementation branch additionally fixes parity gaps discovered in code-copy text, table-cell
paragraphs, empty messages and nested lists. Its final-source browser, streaming, allocation,
recording-overhead and strict CI qualifications are tracked separately. The table above certifies
the measured prototype, not subsequent code. No merge or broad claim about all workloads follows.

## Reproduction and retained evidence

Implementation: `session/editor-construction-performance`, worktree
`/private/tmp/apack-performance-optimization.noindex`. Reports live in owned volume
`apack-linux-work-2bd9183070f1`, below `/work/.apack/performance/editor-renderer-v1/`:

- `baseline-construction.json`, `candidate-construction.json`: all seven action diagnostics.
- `attribution-summary.json`: phase data and complete allocation totals.
- `plain-latency/thread-open/comparison.json`, `rich-latency/thread-open/comparison.json`:
  source-qualified twenty-trial comparisons.
- `allocation-profiles/thread-open/`: complete per-trial renderer CPU and heap profiles.
- `dependency-versions.txt`: installed dependency parity.

The owned ignored `qualify-editor-renderer.sh` records exact baseline preparation and commands;
`thread-construction.spec.ts` holds the temporary probe. No diagnostic patch is added to runtime
code. Both comparison manifests record clean source, native identity, resource limits, fixture
identity and readiness contract. Do not pool these runs with historical 24-control readiness.
