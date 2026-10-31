# Application performance implementation

Status: implementation, qualification and reviewed-code strict CI passed. Full local acceptance
remains open after a confirmed OrbStack VM hang; a shared tool upgrade awaits user approval.
The approved scope and acceptance remain [the application-performance plan](../plans/application-performance.md).
Evidence, commands, raw-report identities, measurements, failures and limitations are in
[the dated evidence record](../references/evidence/2026-10-30-application-performance.md) and its
[compact canonical reports](../references/evidence/application-performance-2026-10-30/).

Worktree: `/private/tmp/apack-application-performance`, advanced to published review commit
`44d246444a` after the old Linux invocation exited. The source-only review worktree is
`/private/tmp/apack-performance-review`, branch `session/application-performance-review`.
Foundation branch `session/application-performance`,
[draft PR #293](https://github.com/spankyed/apack/pull/293). Qualification branch
`session/application-performance-qualification`, [draft PR #294](https://github.com/spankyed/apack/pull/294).
Application changes remain isolated; the main checkout is now on master. The active native source remains untouched. No release/version/pin changes or automatic CI.

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

## Final validation checkpoint

- Reviewed code: `44d246444a379d27dc217eac0a950bde6990f80a`.
  [Strict CI 41179507375](https://github.com/spankyed/apack/actions/runs/41179507375) passed all six
  jobs, including both integration and native shards. Pre-review strict CI 41177136449 also passed.
- Both review fixes passed 38 focused tests, TypeScript and lint on the actual composed branch.
  All nine archived full comparisons (450 raw trials) pass the stronger capture admission checks.
- The frozen local run `2026-10-31T07-19-26Z-83547` tests snapshot `93b7208b44` (code unchanged
  from `44d246444a`). Package builds, typechecks, lint, both external authoring checks, host/pack
  unit gates and all 60 integration files passed. Integration took 1,854.6 seconds with inputs frozen.
- Seven native files passed, including all 16 worker cases and the previous parent-disconnect failure.
  The shared VM then became unresponsive. OrbStack's own log reports a VM hang, disk-stat health
  timeouts, RCU starvation and Btrfs writeback/virtio stacks. A bounded Docker ping timed out.
  Full local acceptance remains unproven; CI is not substituted for this result.
- Cancellation was requested for this session's runner PID 81448 only. Its acknowledgment/terminal
  state must be confirmed before resuming. No shared VM restart or drive operation was performed.
  Private logs and hashes are preserved in `/private/tmp/apack-orbstack-hang-20261031-0423/`.
- Installed OrbStack is 2.0.5. Approval is pending for a backed-up shared upgrade to 2.2.5 once other
  agents' Docker jobs are stopped. Vendor release notes list relevant freeze/file-sharing/external-disk
  fixes, but do not prove the exact cause or resolution of this hang.
- Original storage and checkpoint backups remain intact. Prior failed runs, their focused dispositions,
  source hashes and raw report archives remain in the dated evidence record.

## Dependency-ordered remaining requirements

1. **Restore the execution host and complete local acceptance.** Keep the shared upgrade question
   pending until the user answers; elapsed time is not approval. If approved and other jobs are quiet,
   preserve the current image offline, upgrade/verify the signed official app, verify volume/image and
   checkpoint identities, then reproduce the interrupted native case before broadening. Confirm the
   old runner is terminal. Do not run another broad native batch on the hung environment or weaken
   assertions/deadlines. Resume the supported cached chain only after focused validation converges:
   `APACK_LINUX_ELMDB_ROOT=/private/tmp/apack-performance-elmdb-pinned npm run chain -- --cores 2`.
   Reuse valid measurements and completed checks; keep tracked inputs frozen during acceptance.
2. **Close acceptance and handoff.** Record the actual local native outcome and mark both dependent
   PRs ready after required acceptance is complete. The implementation and measured evidence are
   already committed and reviewable. No further feature work is planned unless validation exposes
   a material defect.

No full-goal completion is claimed while local native acceptance remains unresolved. Strict native CI
passed, but is not presented as that local result. The original scope and acceptance remain intact.
