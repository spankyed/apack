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
- `results.json` retains warmups, failures/incomplete trials, raw process records and median/range/count.
- `trace.json` is Chrome Trace Event JSON for Perfetto. Durations are local monotonic measurements;
  cross-process epoch placement is approximate. Parent ids/links live in event arguments.

Capture integrity (`complete`) does not certify instrumentation coverage. Coalesced watch re-reads
have no action parent and link affected commits, with explicit unknown/dropped causes. Root actor queues restore explicitly carried event context; untagged internal events are not covered.
Enabled Node recordings include aggregate process CPU, sampled RSS/heap maxima, GC and event-loop
observations. These process totals are not per-action attribution, and sampled maxima are not true peak
memory. Disabled mode starts no sampler; sample failures invalidate capture. Detailed mode still needs
CPU/allocation profiles and renderer resource observations. No overhead or performance improvement is established yet.
Populated startup, cross-revision orchestration and qualification remain in the goal.

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
not latency samples. Inside the runner-owned `/work` copy only, `bash tests/performance/counterfactuals/thread-full-read.sh`
injects an actual full-dataset query, requires a newly written failed work-budget report, and restores
its source on exit. Deliberate defects never enter the authored checkout.
