# Initial chat renderer performance

Status: proposed implementation plan. Creating this document does not start implementation.

## Outcome and scope

Reduce the time from application launch to a usable restored chat by loading and constructing less
renderer work before it is needed. Preserve complete message rendering, an immediately usable composer,
pack contributions and the existing readiness contract.

This covers renderer dependencies, initial chat construction and optional rich-content capabilities.
API launch ordering and backend pack admission are separate work. No language rewrite, alternative
message renderer, new performance framework or unrelated cleanup is included.

Surveyed on 2026-11-07: main checkout `b71d0033151008288e64d92d59020118171987a3`, with compiler-boundary
PR [369](https://github.com/spankyed/apack/pull/369) at `ced857edf8`. The earlier startup stack is
PRs [351](https://github.com/spankyed/apack/pull/351), [350](https://github.com/spankyed/apack/pull/350)
and [355](https://github.com/spankyed/apack/pull/355). Inspect their actual integration state before
branching; use a baseline containing the accepted changes rather than repeating their work.

## Evidence and limits

The candidate diagnostic retained by
[qualification run 42344106422](https://github.com/spankyed/apack/actions/runs/42344106422),
`startup-diagnostic/candidate/trial-5`, recorded:

| Observation | Reading | Interpretation |
| --- | ---: | --- |
| Renderer startup span | 1,268.6 ms | Includes waiting and overlapping work; not a recoverable CPU budget. |
| Sampled CPU with editor-related frames in its ancestry | About 199 ms | Investigation target, not an independent wall-clock saving. |
| Renderer GC self-time | About 81 ms | Attribute allocations before changing ownership or adding caches. |
| Initial backend view read | About 5.5 ms | Does not justify shifting this work into database optimization. |

The editor figure counts each sample once when its ancestry names Tiptap or ProseMirror. It includes
descendants and must not be added to their self-times. These are one instrumented trial's observations,
not representative latency estimates. The recording-disabled comparison and exact source limitations
are in the [compiler-boundary evidence](https://github.com/spankyed/apack/blob/ced857edf839f1a05cca1088ecdd56fd6edcbbac/docs/archive/references/evidence/2026-11-07-compiler-startup-boundary.md).

## Design decisions

- Keep `ConversationViewer` and the existing editor schema, Markdown interpretation and contribution
  lifecycle authoritative. Do not introduce a second HTML/Markdown renderer or hand-maintained
  read-only extension registry to obtain faster startup.
- Separate lightweight declarations from optional executable implementations only where the measured
  import graph requires it. Use existing manifest loading contracts and Vue/module loading mechanisms.
  Keep Vue, SDK and editor dependencies shared through the host import map.
- Classify work by when it is required: initial visible content and composer, a particular content
  capability, or an explicit user action. An optional capability needed by the restored conversation
  must load before that content is considered ready. Do not defer required work merely past the timer.
- Keep loading and lifecycle ownership with the component or resource that uses the capability.
  Reuse the existing contributed-editor lifecycle; avoid application-wide loader registries, bespoke
  promise caches and performance branches sprinkled through runtime code.
- Optimize repeated parsing, editor transactions, node-view creation or subscriptions only when a
  profile or count demonstrates unnecessary repetition. Prefer removing work over caching it. Any
  retained cache must have a concrete owner, invalidation rule and bounded lifetime.

## Entry points to inspect

- `packages/renderer/src/main.ts` and `packages/renderer/vite.config.ts`: initial imports, import-map
  entries, emitted chunks and module execution. Published entries need not all execute at startup.
- `packages/default-setup/apack.json` and its generated frontend entry: which declarations pull optional
  implementations into the initial graph. Change the generator or declaration, never generated files.
- `packages/default-setup/src/features/threads/fe/`: restored chat, message wrappers and composer.
- `packages/apack-ui/src/components/tiptap/ConversationViewer.vue`, `extensions.ts`,
  `internal/conversation-document.ts` and `internal/use-contributed-editor.ts`: document construction,
  extension admission, editor lifetime and render acknowledgments.
- `tests/performance/scenarios/populated-startup.spec.ts` and the maintained thread-open/streaming
  scenarios: correctness boundaries, diagnostics and regression qualification.

## Execution order

### 1. Attribute the current renderer path

**Deliverable:** a short evidence record tying the largest renderer costs to source and a proposed
boundary. Reuse valid captures first; capture the current integrated source where changed inputs or
missing early coverage require it.

Trace navigation, initial static imports, pack frontend imports, editor/composer creation, initial
content conversion, transactions, Vue node views and final usable-view acknowledgment. Distinguish
CPU from backend/network waits, style/layout and GC. Inspect the emitted static graph alongside CPU
stacks; bytes alone do not establish a latency saving. Count repeated work only in the selected path.
Use existing diagnostics and source maps; any temporary probes stay out of normal application behavior.

**Done when:** the leading controllable costs have source attribution, their place on the critical path
is established, and each proposed change names the work it removes or delays and its closing check.
Record uncertainty explicitly. If the earlier editor hypothesis is disproved, select the actual leading
renderer cost within this scope rather than forcing an editor redesign.

### 2. Remove unnecessary initial dependency loading

**Dependencies:** phase 1 identifies modules executed before their capabilities are needed.

**Deliverable:** a focused PR moving those implementations behind existing loading boundaries. Examples
to investigate include optional rich-content views, editor menus and inactive contribution implementations;
none is presumed unnecessary before the import graph and restored-content requirements are checked.

**Done when:** emitted graph and runtime loading evidence show the selected implementations absent from
the initial path; their first use succeeds with external HTTP blocked; errors are visible and retry or
recovery follows existing contracts. Pack replacement and popout windows retain correct ownership.
Initial content and composer behavior remain complete. Do not repeat Monaco or inactive-surface
deferral already delivered by the startup stack.

### 3. Reduce demonstrated construction and update work

**Dependencies:** phase 1 identifies unnecessary operations; integrate phase 2 first if it changes the
profiled path. Skip this implementation only if the evidence finds no justified change, recording why.

**Deliverable:** a focused PR removing demonstrated duplicate conversion, editor recreation, redundant
transactions or avoidable node-view/reactivity work through the existing rendering architecture.
Use phase 2's PR instead if the same boundary owns both changes and separate delivery would obscure it.

**Done when:** operation counts or profiles show the selected work reduced, with stable message identity,
ordering, selection, scroll anchoring, contribution replacement and disposal. Check restored messages,
opening another thread, older-message paging and streaming updates. Any optimization must also behave
correctly with richer content than the representative startup fixture.

### 4. Review and qualify the integrated result

**Deliverable:** reviewed, ready PRs with correctness checks and a matched recording-disabled comparison
against the baseline from phase 1. Follow the maintained
[performance workflow](../references/application-performance.md) and repository execution rules.

- Extend existing tests at the changed boundary. Cover actual failure modes and first-use behavior;
  avoid tests that merely mirror an import list or private implementation.
- Exercise ordinary messages plus relevant code blocks, links/references, images, commands and pack
  extensions. Preserve existing browser coverage for selection/copy, link actions and composer input.
  Add cases only where changed behavior lacks meaningful coverage.
- Run focused validation during development and the required full strict acceptance on stable source.
  Use existing jobs through completion; do not duplicate expensive builds or cancel another session's work.
- Compare populated startup with recording disabled: five warmups and twenty measured trials per
  revision, balanced ABBA order, matching fixture/native/runtime/machine identities and private outputs.
  Preserve the correct fifty complete visible messages and matching revision boundary. Verify composer
  readiness as well; amend the maintained boundary symmetrically on both revisions if it misses that work.
- Check maintained thread opening and streaming for regressions. Use matched evidence when claiming
  either improved, rather than presenting a single instrumented trial as qualification.
- Use separate diagnostic captures to explain results; do not substitute bundle bytes or CPU samples
  for launch-to-usable latency. Retain failures, variability, source identities and limitations.

**Done when:** changed behavior and lifecycle checks pass, full integrated acceptance passes, and the
disabled-mode comparison establishes the result. Do not retain added complexity solely because a
microbenchmark improves: if the user-visible result is inconclusive, investigate the measured cause
within this scope or remove the unsupported optimization. State what was and was not demonstrated.

## Delivery and closure

Suggested PR boundaries are dependency loading, demonstrated construction reductions, and a final
evidence-only update where needed. Avoid a separate PR for each small extraction. Open implementation
PRs ready for review, documenting parent dependencies; do not merge without authorization.

Archive the completed plan and its evidence with repaired links after delivery. Update current reference
documentation only where loading or lifecycle contracts actually changed. The work is complete when
the implementation, correctness review and qualification are delivered together, not when profiling
infrastructure or a smaller bundle exists.
