# Application performance implementation

Status: implemented and controlled qualification complete; required final gates pending.
The approved scope and acceptance remain [the application-performance plan](../plans/application-performance.md).
Evidence, commands, raw-report identities, measurements, failures and limitations are in
[the dated evidence record](../references/evidence/2026-10-30-application-performance.md) and its
[compact canonical reports](../references/evidence/application-performance-2026-10-30/).

Worktree: `/private/tmp/apack-application-performance`. Foundation branch `session/application-performance`,
[draft PR #293](https://github.com/spankyed/apack/pull/293). Qualification branch
`session/application-performance-qualification`, [draft PR #294](https://github.com/spankyed/apack/pull/294).
The main checkout and active native source remain untouched. No release/version/pin changes or automatic CI.

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

## Dependency-ordered remaining requirements

1. **Finish local validation.** Inspect/reproduce the renderer compiler timeout alone with verbose
   diagnostics and the unchanged deadline, then complete the broad local chain. The isolated macOS
   static compiler passed in 16.75 seconds; it does not establish the Linux cause. Docker currently refuses
   admission: 1.5 GiB free against its 8 GiB minimum. Storage assistance is requested; no foreign volumes
   are removed. A timeout alone is not a compiler defect or a passed check.
2. **Finish strict acceptance.** Track checkpoint `41150926172` to completion. Its two catalogue failures
   are fixed and focused-tested. Dispatch the final strict run on the frozen corrected tip after that fix;
   preserve and address material failures. The queued superseded run `41153331076` was cancelled.
3. **Close the evidence and handoff.** Record actual final check results, reconcile the plan/README/PR
   status, commit/push the reviewable checkpoints and mark the dependent PRs ready only when required
   acceptance is complete. No further feature work is planned unless validation finds a material issue.

No full-goal completion follows from passing individual scenarios or capture integrity alone. Keep the
original scope intact, reuse valid source-qualified results and do not change deadlines/assertions to pass.
