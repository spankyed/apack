# Application performance implementation

Status: completed 2026-10-31. Implementation and qualification are delivered in
[foundation PR #293](https://github.com/spankyed/apack/pull/293) and dependent
[qualification PR #294](https://github.com/spankyed/apack/pull/294).
The approved scope is preserved in [the completed plan](../plans/application-performance.md).
The [maintained reference](../../references/application-performance.md) and
[dated evidence](../../references/evidence/2026-10-30-application-performance.md) own the resulting
contracts and source-qualified results. Application work used isolated worktrees; concurrent work,
release metadata, the native pin and automatic CI policy were preserved.

## Completed requirements

- **Opt-in recording and EARS accounting:** development/test admission, connection ownership, bounded
  OpenTelemetry recording and metadata; disabled mode creates no provider/context manager/sampler.
  Request/result byte counts, sequences and committed-not-durable outcomes preserve business results.
  Limits remain 10,000 observations and 16 MiB per recording; detailed profiles reserve 8 MiB within it.
- **Execution context and attribution:** W3C carriers outside business data/cache keys, Node ALS,
  explicit browser restoration and carried root actor events. Coalesced reads link commits rather than
  inventing an action parent. Unknown/dropped causes are explicit. Internal untagged events are not certified.
- **All four real-app actions:** exact bounded thread page and full bodies, deterministic CLI streaming
  with intermediate/final persisted progress, current-query search correctness and supersession,
  populated startup through admission to the actual restored usable chat. Readiness is not paint.
- **Resources and detailed diagnostics:** real Node/renderer CPU and sampled allocation profiles,
  aggregate process CPU/memory/GC/event-loop statistics, renderer metrics/long tasks, actual PIDs and
  separately executed native query plans. Deadlines, byte caps, ownership and cleanup are verified.
- **Maintained reports and comparison:** immutable bounded raw trials, compact hash-verified indices,
  Perfetto/V8 exports, clean source/build/native/machine identity and actual process exits. Five warmups
  plus twenty measured actions per mode, observed serial ABBA execution and explicit cache policy.
- **Measurement proofs:** full-read work-bound failure, withheld completion, actual backend PID/CPU
  charge, renderer stall, outcome-preserving observer/export failures, overflow and queued/coalesced causes.
- **Application improvement:** initial thread positioning suppresses unsolicited automatic pagination;
  seven pack tests and real-app work-bound evidence support the change. No speedup is asserted.
- **Full mode qualification:** all four lightweight comparisons satisfy the declared 5% median budget
  in their recorded runs (thread +3.04%, search +3.51%, streaming −2.12%, startup +1.09%). Detailed mode
  also completed all prescribed counts/captures; it has no low-cost budget. All raw ranges remain.
  An earlier search run at +9.91% is retained; universal sub-5% overhead is not established.
- **Paired execution:** short A/A execution covers all four actions; a full thread A/A control passes
  twenty measured actions per worker (+0.27% median difference). This is execution proof, not a speedup.
- **Review fixes:** startup discovery now rechecks existing windows; the prior five-second wait artifact
  is superseded. Handshakes publish complete JSON atomically. Forty-eight focused tests, types and lint
  pass; both reverted defects fail their regression tests. Catalogue/runner/documentation completion passes 121 focused checks.

## Outcome (2026-10-31)

All four delivery checkpoints and their acceptance requirements are complete. The final review
fixed missing-capture admission and premature revision-worker exit handling; all 450 archived raw
trials pass the stronger admission rules. No further application defect remained from that review.

| Requirement | Implementation and authoritative evidence | Acceptance |
|---|---|---|
| Isolated work; preserve concurrent work and release policy | Dedicated application/review worktrees; separate dependencies; PR diffs leave release metadata, native pin and automatic CI triggers unchanged | Verified |
| Opt-in dev/test recording | API/main admission and connection/window ownership; host controller/session; disabled factory/sampler and disconnect tests | Verified |
| Bounded, outcome-preserving observations | Host buffer/spans/profile limits; EARS observer failure tests; incomplete/loss counters and profile protocol faults | Verified |
| Explicit causal context | W3C carriers outside business payloads, Node ALS, browser restoration and root actor event tests; coalesced reads use links, unknown causes remain explicit | Verified within documented coverage |
| Bounded populated-thread completion | Exact requested 50 full bodies and correlated revision in thread-open scenario; full-read and missing-completion counterfactual records | Verified |
| Deterministic streaming | Actual fixture CLI/chat pipeline, intermediate DOM progress, final persisted body/timestamp, bounded producer/view progress | Verified |
| Current-query search | Exact 20-hit identity set and snippets; supersession/cancellation fault tests and actual actor counterfactual | Verified |
| Populated startup | Owned closed seed/profile copies, fresh actual launches, backend index admission and requested restored chat readiness; per-child provenance/lifecycle | Verified |
| Actual resource evidence | Node/renderer CPU and allocation profiles; real PIDs; backend CPU and renderer long-task counterfactuals; explicit native explain probes | Verified within stated clock/counter limits |
| Bounded reports and comparison | Format-2 hashes/scalars/raw trials, Perfetto/V8 exports, source/build/native/machine checks; 38 reporting/protocol tests; 450 raw trials re-admitted | Verified |
| Controlled overhead and revision execution | Eight full mode comparisons and full thread A/A: five warmups and twenty measured per variant, ABBA order and actual exits; earlier failures retained | Verified; no universal/tail claim |
| One justified application improvement | Generation-owned initial thread positioning prevents unsolicited paging; seven pack tests and real work-bound evidence | Verified; no speedup claim |
| Maintained documentation and exports | Current reference, suite commands, public API/facade checks, documented limits; goal/plan archive after acceptance | Completed; archived goal/plan and maintained reference |
| Final integrated validation | Frozen snapshot 93b7208b44; passing full chain 2026-10-31T08-46-38Z-67326; reviewed-code strict CI 41179507375 at 44d246444a | Passed |
| Dependent reviewable PR checkpoints | Foundation #293 and qualification #294, review fixes pushed; final handoff recorded | Acceptance complete; delivered as dependent review checkpoints |

The normal full local command, with the frozen native checkout at the repository pin, passed in
619.0 seconds on a two-core budget (25 of 32 steps reused valid cache results). Run
`2026-10-31T08-46-38Z-67326` includes successful native acceptance, runtime build, external-pack
application acceptance, smoke and both packaged-authoring phases. Source was frozen at `93b7208b44`.
All six strict CI jobs passed on reviewed code `44d246444a`; subsequent changes are documentation.
The evidence record distinguishes the interrupted earlier outer run from its completed native tests
and the successful normal cache reuse. No assertion, deadline or resource bound was weakened.

Shared OrbStack maintenance is separate: the VM hang's root cause remains unproven and an upgrade
awaits user approval. No upgrade/restart was performed or needed to finish this acceptance run.
Measurement limits remain explicit: view readiness is not paint, process totals are not exact action
attribution, and the recorded overhead comparisons do not certify universal overhead or tail latency.
