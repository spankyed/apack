# Measuring real application actions

Status: proposed implementation plan, 2026-10-29. No implementation or performance acceptance is
claimed. Surveyed on `master` at `98386b36a18d244c19ffb501830b990ed49f7653`.

## Outcome

Build a repeatable application performance suite backed by reusable runtime diagnostics. It must
answer which user action slowed, where its time went, and what additional work caused it. Use the
real application, representative disposable data and explicit user-visible completion conditions.
Database microbenchmarks remain useful diagnostics; they do not establish application responsiveness.

The first deliverable is one complete populated-thread-open scenario, from renderer input through
backend execution and database reads to the expected message page being applied to the view. Extend
that working foundation to streaming replies, search and populated startup.

Instrument application and EARS contracts so measurements separate application work from engine
execution and remain useful as elmdb evolves.

## Existing foundations and ownership

Inspect current source before implementation; the survey is a starting point, not a frozen layout.

| Existing owner | Foundation and intended responsibility |
|---|---|
| [Host services](../../packages/apack-host/src/services/index.ts) | Compose diagnostics with each runtime and own recorder lifecycle. |
| [Host runtime contract](../../packages/apack-sdk/src/runtime/host-runtime.ts) | Expose runtime diagnostics without global exporter configuration in libraries. |
| [EARS call accounting](../../packages/apack-ears/src/calls.ts) | Reuse operation accounting; separate cheap attribution from optional stack capture. |
| [EARS connection](../../packages/apack-ears/src/database.ts) | Observe backend-neutral read, write, unit and watch boundaries. |
| [Renderer transport](../../packages/renderer/src/transport/client.ts) | Carry action context across transport and correlate view delivery. |
| [E2E guidance](../../tests/e2e/CLAUDE.md) | Reuse owned Electron processes, Playwright and disposable profiles. |
| Existing loop measurement utilities under `scripts/` | Reuse event-loop measurement lessons, with application-specific lifecycle and overhead validation. |

The current call-counting start/report/stop window is useful for investigations but does not isolate
overlapping actions. Its enabled path captures stacks. Neither a process-global counting window nor
per-call stack collection should become the foundation of lightweight action attribution.

Keep the recorder and exporters in host/tooling ownership. EARS must not depend on the SDK or host.
Choose the smallest shared instrumentation contract compatible with that dependency direction;
introduce a new workspace only if actual cross-package needs justify it. Regenerate public API reports
when exported contracts change.

## Scenario contracts

Each scenario declares fixture identity, preparation, start event, completion milestone, correctness
assertions, measured interval, expected work and cleanup. Completion must identify the requested
action and resulting view revision; an unrelated update or stale search result cannot finish it.

| Scenario | Completion | Principal measurements |
|---|---|---|
| Open a populated thread | Expected bounded message page applied to its view | Input-to-view-ready duration, read work, returned bytes, renderer stalls |
| Stream a deterministic reply | Final scripted chunk displayed and persisted under the declared persistence contract | First visible chunk, update gaps, backlog, commits and watch runs |
| Search | Correct results for the current query applied | Input-to-results duration, stale-result suppression, database and renderer work |
| Start with populated data | Initial declared view usable | Process startup, pack/index admission, initial queries and view readiness |

Call a Vue state/DOM-flush milestone **view-ready**. It does not prove a frame was painted. A backend
acknowledgment also does not establish view readiness. Any paint claim requires separate browser
evidence; do not equate a requestAnimationFrame callback with measured paint.

Use deterministic inference through the existing service boundary, with fixed output, chunk timing
and controlled failure cases. Live-provider runs are separately labeled diagnostics because network
and provider variation cannot establish application regressions.

## Causal tracing and work accounting

Use OpenTelemetry tracing and context APIs rather than inventing a tracing protocol. Initialize
providers at process composition roots; libraries emit observations without choosing recording,
sampling or export policy. The scenario runner selects the mode for its owned process tree.

Trace the causal path from renderer input through dispatch, transport, backend/actor execution,
repository and EARS operations, watch delivery, renderer application and view-ready completion.
Propagate context explicitly across WebSocket messages, worker messages and actor queues. Node
AsyncLocalStorage alone cannot carry context across these boundaries.

Carry tracing metadata in execution/transport envelopes, separate from persisted entity and business
payloads. Validate and bound incoming metadata. Context must not survive accidentally into unrelated
later actions. A watch update caused by several coalesced commits uses causal links to the contributing
operations rather than inventing a single parent. Record background work as background work, with
links where causality is known; do not charge every operation during an action's time window to it.

Use monotonic clocks for local durations. Record process identity and clock metadata, and establish
how cross-process timestamps align before presenting a merged timeline. Explicit causal relationships
remain valid even where clock alignment is approximate; report that uncertainty.

Maintain separate kinds of evidence:

- Action spans describe elapsed time, waits and causal relationships.
- Work counters describe calls, rows/results, bytes, commits and watch runs where the boundary can
  actually observe them. Do not claim rows scanned from returned-row counts; backend-specific scan
  diagnostics must identify their source and availability.
- Process observations describe CPU, memory, garbage collection and event-loop delay. Concurrent
  process totals are not precise per-action resource attribution.
- Detailed profiles identify CPU/allocation hotspots and query plans in a separate diagnostic mode.

Do not add overlapping or nested span durations to estimate total latency. Binding elapsed time
includes its surrounding work and is not pure native/database execution time.

## Recording modes and safety contracts

Provide disabled, lightweight and detailed modes. Lightweight mode uses explicit operation names,
cheap counters and bounded spans. Detailed mode may add stack capture, query plans, CPU/allocation
profiles and Playwright tracing. Measure each mode's overhead rather than assuming it is negligible.

The recorder must satisfy these invariants:

- Disabled instrumentation performs no stack capture, payload serialization or export work.
- Buffers have explicit byte/span bounds. Reports expose dropped observations and truncation.
- Export failures preserve the application's original result or error and cannot block its hot path.
- Recording writes outside the application's database, avoiding recursive instrumentation.
- Attributes are allowlisted. Prompts, message bodies, tokens, query parameters and other sensitive
  payloads are excluded by default; fixture identifiers and operation names suffice for normal runs.
- Action/context lifecycle is bounded, including cancellation, errors, disconnects and shutdown.
- Missing completion markers produce incomplete/failed outcomes, never fabricated success durations.

Detailed mode can distort the application; report its mode alongside every result. Capture ordinary
latency in lightweight mode and use detailed runs to explain it, without treating them as interchangeable.

## Runner, fixtures and reports

Use Playwright against built application output. Own all launched processes and a disposable profile
per run; terminate only owned processes. Build and seed outside measured intervals except where a
scenario explicitly measures startup, admission or import. Never use the developer's active database.
Follow the repository's [execution and validation rules](../../CLAUDE.md#keep-validation-bounded).

Fixtures are deterministic generators with a version, seed and declared distributions: thread/message
counts, body sizes, relation density and search corpus where applicable. Include realistic large
fields so projections and paging are exercised. Store generator source and provenance, not a private
developer database or a committed timing golden. Define warmup and cache policy explicitly: a fresh
process does not imply a cold filesystem cache.

Give persistent scenarios an owned suite location distinct from ignored exploratory `drive/` scripts.
Reuse existing application fixtures where appropriate, but do not assume their worker-shared profile
provides isolation between performance trials. Keep lightweight contract tests separate from the
expensive application runner.

Each run writes an ignored report directory containing:

| File | Contract |
|---|---|
| `manifest.json` | Schema version, source revision/dirty state, build and native dependency identities, fixture identity, runtime versions, machine/resources, recording mode, cache/warmup policy and trial order |
| `results.json` | Raw trial samples, correctness outcomes, counters, failures, exclusions and derived summaries |
| `trace.json` | Bounded process timeline, causal relationships and recording completeness |
| `playwright-trace.zip` | Optional UI diagnostic capture, labeled with its additional overhead |

Validate report schemas. Keep raw samples and unsuccessful trials; do not silently remove outliers
or pool incompatible manifests. Comparison rejects or clearly identifies incompatible source/build,
fixture and execution conditions. Preserve numerator, denominator and units for derived values.

Implement a small exporter to Chrome Trace Event JSON for inspection in Perfetto; OpenTelemetry
records need conversion, not a claim that Perfetto directly reads OTLP. Use existing viewers rather
than building a custom performance dashboard. Detailed evidence selected for a decision belongs in
dated [evidence records](../references/evidence/), with source, commands and limitations.

## Regression policy

Ordinary checks enforce deterministic correctness and work bounds: opening a page does not
materialize every message, projections omit large unused bodies, watch bursts obey their declared
coalescing/work contract, and cancelled or superseded searches cannot publish stale results. Set bounds
from the scenario's intended behavior, with comments explaining them, rather than blessing today's count.

Follow the repository rule that CI may fail a check, never a clock. Do not add timing thresholds to
the ordinary strict chain or enable automatic CI. Performance qualification is a controlled manual
comparison with pinned resources, balanced A/B trial order and a declared sample/analysis policy.
Define decision budgets before tuning. Report absolute durations and work, effect sizes, variability
and sample counts; do not claim reliable tail percentiles from a handful of trials.

Budgets should distinguish user responsiveness, resource use and acceptable measurement overhead.
Their numerical values are implementation decisions informed by baseline trials, not facts established
by this proposal. A diagnostic timeout marks an incomplete run and preserves evidence; it is not a
performance acceptance threshold.

## Delivery checkpoints

### 1. Complete populated-thread-open slice

**Deliverable:** a deterministic populated fixture, real input-to-view-ready scenario, explicit
cross-process action context, EARS work accounting and a local report/comparison path. Implement the
minimum recorder needed for this slice before generalizing it.

**Dependencies:** inspect current transport, actor scheduling, host diagnostics, view delivery and
test fixtures; define the exact view revision and readiness milestone. Freeze the fixture and report
contracts and identify instrumentation owners before changing public exports.

**Done when:** the correct bounded page is asserted in the real UI; its causal path can be inspected;
two runs can be compared from raw reports; failures and missing finish markers remain visible; and
the checks in checkpoint 2 validate the measurement before its numbers support optimization decisions.

### 2. Prove the measurement is trustworthy

**Deliverable:** focused contract checks plus controlled application counterfactuals and an overhead
comparison on the first slice.

**Dependencies:** checkpoint 1's executable slice and recording contracts.

**Done when:** an intentionally added full-dataset read trips the work guard; an injected block is
observed in the correct process; overlapping actions retain separate attribution; coalesced delivery
retains its causal links; cancellation and missing completion cannot pass; bounded-buffer overflow
is reported; and an exporter failure preserves the original application outcome. Remove deliberate
defects after proving the guards. Measure disabled/lightweight/detailed overhead under matched conditions.

### 3. Extend to streaming, search and startup

**Deliverable:** the remaining scenario contracts using the same context, runner and reports.

**Dependencies:** a trusted recorder and the relevant fixture/service seams; no dependency on a
particular storage backend's adoption.

**Done when:** streaming asserts intermediate progress and final persistence, search exercises
supersession/cancellation and correct current results, and startup measures the declared usable view
including admission work. Each scenario has finite correctness/work checks and reproducible raw trials.

### 4. Establish the maintained workflow

**Deliverable:** documented local diagnosis and controlled comparison workflows, cheap regression
checks integrated at the appropriate existing test boundaries, and reference documentation for the
implemented instrumentation and report format.

**Dependencies:** implemented scenarios and measured overhead/results from the preceding checkpoints.

**Done when:** a developer can reproduce and explain a comparison from a clean checkout using the
documented fixture; public reports are regenerated where needed; affected focused checks and required
integrated validation pass on recorded source; and remaining evidence limitations are explicit.
Archive this plan only after all required deliverables are accounted for. Keep checkpoint history in
evidence rather than appending competing handoffs here.

## Current handoff

Only this design document exists. No instrumentation, scenario runner, benchmark result or acceptance
claim has been added. Next: implement checkpoint 1 after inspecting current source and concurrent work;
choose exact module locations and readiness markers from that inspection. Preserve independently owned work in both repositories.

## Upstream contracts

- [OpenTelemetry JavaScript context](https://opentelemetry.io/docs/languages/js/context/)
- [Node 23.11.1 performance APIs](https://nodejs.org/download/release/v23.11.1/docs/api/perf_hooks.html)
- [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer)
- [Perfetto supported external formats](https://perfetto.dev/docs/getting-started/other-formats)
