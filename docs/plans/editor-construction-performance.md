# Editor construction and read-only chat rendering

Status: implementation started. Base: master `461f7bf2cb`; #309 is merged.

## Delivery

Profile construction first, implement at most two measured small candidates, then build and qualify
a dedicated read-only chat renderer if small changes do not qualify. Deliver reviewable PRs; no merge.
Keep the main checkout untouched; reuse the independent performance worktree and owned Linux caches.

## Attribution and small changes

Separate extension configuration, Markdown parsing, schema, state/view construction, node views,
initial transactions and destruction. Record exclusive costs, overlapping ancestry, allocation
samples and invocation counts. Use the maintained fifty-message fixture and a fixed rich-content
corpus. Temporary probes belong in ignored diagnostics, not application runtime instrumentation.
Implement only opportunities supported by profiles. Never share mutable editor, extension, parser
or document state. Preserve rejected results and do not repeat the archived layout experiments.

## Dedicated viewer

If neither small candidate qualifies, commit a design before implementation. Render supported chat
messages without Tiptap Editor or ProseMirror state/view construction. Keep parsing, rendering,
interaction and lifetime ownership separate. Use markdown-it at the installed version with existing
application-owned rules/helpers; do not depend on private tiptap-markdown internals or fork them.
Keep chat raw HTML disabled, validate elements/attributes/URLs, and reuse navigation/image handlers.

Add an explicit read-only capability to editor contributions: false means editing-only; an adapter
provides parser configuration and DOM enhancement with cleanup; absence means unknown and uses the
existing viewer. Migrate built-in contributions in the same change, preserving references and command
highlighting. Each message owns mutable state. Replace/dispose adapters on registry changes; surface
supported-renderer failures rather than silently hiding them. Keep editable inputs/documents intact.

## Verification and acceptance

Preserve formatting, whitespace, tables, code highlighting/copy, safe HTML/URLs, text selection/copy,
references, image interactions, streaming, truncation/expansion and resizing. Test contribution
replacement/removal, cleanup, independent message state and unsupported-extension fallback. Extend
owning tests rather than duplicating suites or adding implementation-mirroring assertions.

Use five warmups and twenty measured actions per revision in balanced order, matching fixture,
native build and resources. Require at least 5% AND 20 ms lower median readiness latency, plus 10%
lower sampled renderer allocations. Retain fifty complete bodies and all 25 truncation controls,
existing work budgets, deadlines and trial counts. Require streaming median regression <=5% and
final lightweight recording overhead <=5%. Check rich-content correctness and performance too.
Never qualify partial runs or infer latency from profiles. Retain every rejection/failure.

Use the maintained Linux runner (two CPUs, 6 GiB, no extra swap, 256 MiB shm); check conflicts before
expensive runs. Reuse valid outputs and refresh matching ignored generated files to avoid repeated
rebuilds. Permission-sensitive tests require a non-root context. Run focused checks, required strict
CI and final correctness review. Record exact provenance, limitations and outcomes; archive when done.
If the dedicated renderer cannot preserve behavior or meet acceptance, revert production integration
and report the evidence and obstacles. No stored-data migration is required.

## Initial attribution

The twenty retained `54007b7094` profiles have matching editor/chat source and lockfile. They show
908.6 MB of 1,719.0 MB sampled allocation under editor-setup ancestry, including 346.6 MB under
extension option factories. Categories overlap; these are not exclusive or retained-heap figures.

Exact historical bundle offsets resolve `v` to Tiptap's recursive extension-field lookup, `M` to its
function/value dispatcher, and the sampled options getter to a fresh object built from `addOptions`
on every access. This is library-level construction work; caching mutable extension instances is
not a justified application fix. The old zero named Markdown samples do not establish zero parsing
cost: minified parser frames still require attribution. Raw profiles remain in owned volume
`apack-linux-work-220c5d355e10`, under
`.apack/performance/optimization-baseline-54007b7094/detailed-thread-open/thread-open/B/`.

No runtime candidate is implemented or accepted yet. New timing runs await completion of the
observed competing host-native heap benchmark; no work has been cancelled.

## Renderer design

The supported chat path parses Markdown once into detached DOM, enhances it with owned viewer
helpers, then replaces the displayed fragment. It constructs no editor/state/view. Keep existing
CSS classes and navigation/image behavior. Each component owns its parser and DOM cleanup; failed
adapter setup tears down the candidate fragment and displays the existing error UI. Contributions
are checked before choosing this path; unknown capabilities use the existing viewer for the whole
message. Registry changes invalidate rendering and dispose old callbacks before replacing DOM.

Expose `readOnly: false | ReadOnlyTextRenderer` on text-editor groups. The adapter has optional
`transformMarkdown(source): string` and `decorate(root): void | (() => void)`. The first runs before
the viewer's HTML-disabled parser; the second owns DOM enhancements and returns cleanup. This keeps
the parser library out of SDK contracts while supporting contributed syntax and behavior. Missing
capabilities mean unsupported, not editing-only. Declare false or an exported adapter in manifests,
including code generation, target discovery and declaration/binding validation. Built-in suggestions
are editing-only; command highlighting and reference pills have explicit read-only adapters.

Markdown code is escaped by the parser; code highlighting uses DOM/text nodes, never untrusted HTML.
Links/images use the parser's URL validation and existing interaction handlers. Code-copy buttons
and reference rendering share helpers with the existing editor. No mutable extension object or
parser is cached across messages. Extract existing application Markdown rules first, then implement
the viewer and migrate built-ins together. No small cache candidate is justified merely by the
upstream option-getter allocation profile; avoid modifying or forking Tiptap internals.
