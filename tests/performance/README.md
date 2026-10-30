# Application performance qualification

This is a manual suite against built application output, separate from the ordinary E2E gate. It
owns a disposable test profile. Never set `E2E_DATA_DIR` to a developer's profile for qualification.
Thread-open has passed a built-app run of five warmups and twenty measured trials; overhead and A/B qualification remain open.

Build with the normal repository commands, then run from the checkout root:

```sh
npm run build:default-setup
npm run build:runtime -- --cores 1
npm run test:e2e -- --config tests/performance/playwright.config.ts
```

Use the repository's bounded Linux runner for repeated native/runtime qualification. Electron needs
an available display there (for example Xvfb). Each invocation selects one scenario and owns a fresh process/profile; `APACK_PERFORMANCE_SCENARIO=thread-open` is the default `search` selects the search corpus, and `streaming` selects deterministic CLI replies. `APACK_PERFORMANCE_MODE` selects `disabled`,
`lightweight` (default), or `detailed`. `APACK_PERFORMANCE_TRIALS=1` is a contract/debug run;
it cannot establish latency variability or overhead. The default is five warmups followed by twenty
measured trials in a warmed process. This is not cold disk or fresh-process startup evidence.

The thread scenario imports two deterministic synthetic threads outside the measured interval,
then alternates opening them. Its start is renderer surface-event dispatch, not a physical input
measurement. Completion requires the requested thread, its correlated subscription delivery, all
fifty requested message bodies in the DOM, and a Vue flush. It proves view readiness, not paint.
The display/driver, fixed fixture, and completion checks are common to all recording modes.

Search imports 1,200 synthetic large messages across twelve threads, with exactly twenty known matches
for each of two queries. Each action supersedes one query with the requested query. Completion requires
the current query, its correlated delivery, the complete expected timestamp/thread set, twenty unique
rows and laid-out result snippets for that query. Start is surface-event dispatch and excludes the
input control's debounce; it is not keyboard-to-results latency. This scenario does not certify ranking
of a truncated larger result set or an independent late-response fault injection.

Streaming configures a fixture CLI through normal Settings, then exercises the actual Claude Code
chat flow, process protocol, throttled writer and message views. A fresh twenty-message conversation
per trial keeps history size constant. The fixture emits twenty-four chunks at fixed intervals.
Completion requires visible intermediate progress and the complete reply plus completion timestamp in
its database-backed view and DOM. Reports retain first-visible and maximum visible-update-gap timings;
backlog reports additionally retain bounded producer-enqueue and database-backed-view receipt
progress. Pending UTF-16 code units at receipt use approximate epoch alignment; clock-order mismatches
remain explicit. This is pipeline backlog, not database commit latency. Missing/incomplete progress
fails the scenario. No overhead has been established. No network/model service is called.

Reports go to ignored `.apack/performance/thread-open-<mode>-<timestamp>/`:

- `manifest.json` identifies source/dirty state, actual build/native output hashes and checkout identity, fixture distributions, runtimes,
  machine, recording mode, cache policy and warmups.
- `results.json` is a compact format-2 index: ordered raw-trial paths, byte counts, SHA-256 hashes,
  scalar samples, lifecycle status and median/range/count. It never duplicates full profiles.
- `trial-N.json` retains each warmup, failure/incomplete trial and its complete process records once.
  A raw trial is limited to 128 MiB; generated raw/viewer files have a 4 GiB per-store budget.
  Run admission reads one trial at a time and verifies hashes, summaries, order, modes and lifecycle.
- `trial-N.trace.json` is Chrome Trace Event JSON for Perfetto. Detailed recordings additionally export
  each process's `.cpuprofile` and `.heapprofile` for existing V8 profile viewers. Durations are local monotonic measurements;
  cross-process epoch placement is approximate. Parent ids/links live in event arguments.

Capture integrity (`complete`) does not certify instrumentation coverage. Coalesced watch re-reads
have no action parent and link affected commits, with explicit unknown/dropped causes. Root actor queues restore explicitly carried event context; untagged internal events are not covered.
Enabled Node recordings include aggregate process CPU, sampled RSS/heap maxima, GC and event-loop
observations. These process totals are not per-action attribution, and sampled maxima are not true peak
memory. Disabled mode starts no sampler; sample failures invalidate capture. Detailed Node and renderer recordings include V8 CPU and sampled JS allocation profiles. Renderer
recordings also retain named CDP task/layout/heap metrics and long-task aggregates. Profiles record sampling settings and a requested 30-second window (timers can be delayed
by synchronous work), cap serialized CPU/allocation output at 4 MiB each, and reserve those bytes within
the 16 MiB recording budget. Protocol failures or oversized output invalidate capture. These are V8
isolate/JS-heap profiles; process totals cover a broader resource scope. No overhead or performance improvement is established yet.
Cross-revision orchestration and overhead qualification remain in the goal.

Populated startup uses a separate controller, `node scripts/with-source.mjs tsx tests/performance/startup-run.ts`.
It owns profile paths, finishes real onboarding, imports the fixture and opens its declared chat outside
measurement. It closes the seed process, copies the profile, then launches and closes a fresh process
for each warmup/trial. The measured boundary is parent-process launch through the actual initial
usable restored chat (correct fifty full message bodies, corpus and matching chat revision), including backend admission. This is a warm-filesystem experiment, not cold disk.

Before comparing reports, run `node scripts/with-source.mjs tsx tests/performance/verify-run.ts RUN`
(or `RUN_A RUN_B` for compatibility and median/range comparison). The default requires all five
warmups and twenty measured trials; a comparison does not itself certify balanced order or quiet
resources. The command rejects missing/unsuccessful/inconsistent trials and oversized input reports.
Startup additionally requires successful process invocations and matching per-launch manifests/results.
For native isolation, set `APACK_LINUX_ELMDB_ROOT` to a clean frozen checkout at `vendor/elmdb.rev`;
never qualify timings against another agent's changing native tree.

Controlled manual counterfactuals: `APACK_PERFORMANCE_SCENARIO=search-supersession` delivers real old
results directly to the actor after supersession/cancellation (transport guards are separately tested).
`APACK_PERFORMANCE_SCENARIO=backend-block` runs a bounded CPU workload through the actual database
console and requires its returned CPU charge in backend process totals. These are correctness proofs,
not latency samples. Inside the runner-owned `/work` copy only, `bash tests/performance/counterfactuals/thread-open.sh full-read`
injects an actual full-dataset query, requires a newly written failed work-budget report, and restores
its source on exit. Deliberate defects never enter the authored checkout.

`bash tests/performance/counterfactuals/thread-open.sh missing-completion` withholds the correlated
completion signal while the actual fifty-message view arrives. It requires an incomplete trial with
no duration/success marker and complete process captures; source is restored on exit.

Profile protocol references: [Node Inspector](https://nodejs.org/download/release/v23.11.1/docs/api/inspector.html)
and [V8 heap sampling](https://chromedevtools.github.io/devtools-protocol/tot/HeapProfiler/).
Allocation sampling includes objects discarded by major/minor GC; it does not request heap object values.

`APACK_PERFORMANCE_SCENARIO=query-plans` runs explicit native `explain()` probes against the search
fixture outside all measured actions. It retains stage/index names, visited/kept counts, durations and
result counts, with the source/build manifest; it excludes result ids and payloads. The ids terminal
explains filtering/traversal, not projection/codec work. Native visited counts are not unique-row counts.

Detailed profiles reserve 8 MiB of the existing 16 MiB recording budget, leaving 8 MiB for spans.
The measured startup CPU/allocation exports were 2.83/3.54 MB, which exceeded the original 2 MiB
per-profile allocation. Sampling frequency is unchanged. Allocation stacks use the shipped protocol's
128-frame default; the older runtime ignores an attempted `stackDepth: 32` parameter. Renderer profile
transport uses a non-flattened CDP session over the existing debugger so deeply nested responses travel
as strings past Electron's shallow JSON parser, then are decoded in JS. Its response admission is bounded
at 16 MiB; deadlines and cleanup remain enforced. See the shipped
[V8 implementation](https://github.com/v8/v8/blob/13.8.258/src/inspector/v8-heap-profiler-agent-impl.cc#L550)
and [Electron debugger parser](https://github.com/electron/electron/blob/v37.2.4/shell/browser/api/electron_api_debugger.cc#L41).

Before qualification, make runtime output current with the existing chain's `build:runtime` step
(after its required producers). Recording source and output hashes alone does not certify that an old
bundle was built from the current source. Keep all captured inputs frozen while producers execute.
