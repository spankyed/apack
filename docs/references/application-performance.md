# Application performance recording

The manual application suite measures real thread opening, deterministic reply streaming, current-query
search and populated startup. [The suite guide](../../tests/performance/README.md) owns the commands,
fixtures, completion conditions, report format and comparison workflow. The
[qualification evidence](evidence/2026-10-30-application-performance.md) records measured results and
limitations; it is not a timing golden or a promise about other machines.

## Ownership and admission

`packages/apack-host/src/diagnostics/` owns recording, context managers, EARS adapters, process
statistics and Node profiles. Each recording owns its OpenTelemetry provider; libraries do not install
a global provider or exporter. EARS exposes a backend-neutral observer without depending on host/SDK.

Recording is available only in development and test. The authenticated API recording belongs to the
connection that started it; disconnect and shutdown release its resources. Renderer capture belongs
to its window. The scenario runner owns the application process tree and disposable profiles and
never opens the developer's active database.

Modes are disabled, lightweight and detailed. Disabled mode creates no provider, context manager,
resource sampler or profiles. Lightweight mode records bounded spans/counters and process observations.
Detailed mode adds CPU and sampled allocation profiles; its overhead is measured separately.

## Attribution and limits

Standard W3C trace context travels in execution/transport envelopes, outside persisted business data.
Node async context and explicit browser/actor restoration preserve carried causes. Coalesced watch
reads have no invented action parent: they link contributing commits and expose unknown/dropped causes.
Untagged internal actor events are not certified. Process CPU/memory totals are recording-window
observations, not precise per-action attribution.

Each process recording permits at most 10,000 observations and 16 MiB of encoded recording data.
Detailed mode reserves 8 MiB of that budget for profiles, with 4 MiB per profile. Rejections, overflow,
unfinished spans and capture failures remain visible and invalidate completeness. Allowlisted attributes
exclude message bodies, prompts, credentials and query parameters. Observation/export failures preserve
the business operation's original result or error.

`@apackdev/testing/performance` validates reports and admits comparisons. Format-2 run indices refer
to immutable hash-verified raw trials; a trial is limited to 128 MiB and generated raw/viewer output to
4 GiB per store. Every warmup, failure and incomplete outcome is retained. Missing completion never
becomes a successful duration. Trace exports use Chrome Trace Event JSON for Perfetto; detailed V8
profiles use existing CPU/heap viewers.

Local durations use monotonic clocks. Cross-process epoch placement is approximate, with process and
clock identity retained. A Vue/DOM flush proves view readiness, not paint. Native query-plan counters
identify their source and stage semantics; returned rows are not treated as physical rows scanned.

## Maintained validation

Ordinary unit/integration checks enforce correctness, work bounds, context isolation, ownership,
recording limits and failure handling. They do not gate wall-clock performance. Controlled manual
qualification uses five warmups and twenty measured actions per mode/revision, balanced ABBA order,
matched provenance and an explicit cache policy. Lightweight overhead has a declared 5% median budget;
detailed mode has no assumed low-cost guarantee. Twenty observations do not establish tail latency.

Source/build/native identity, clean checkouts, actual process exits, fixture identity and machine/cache
compatibility are checked before qualification. A new process does not imply a cold filesystem cache.
Storage changes require a distinct asserted machine identity; see the
[Docker storage guide](guides/docker-storage.md#performance-evidence). Keep historic measurements
source-qualified rather than repeating them for unrelated documentation or runner changes.
