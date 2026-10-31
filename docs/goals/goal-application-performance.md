# Application performance implementation

Status: implementation, controlled qualification, strict CI and local non-native gate passed;
local native acceptance remains pending after verified external-storage migration.
The approved scope and acceptance remain [the application-performance plan](../plans/application-performance.md).
Evidence, commands, raw-report identities, measurements, failures and limitations are in
[the dated evidence record](../references/evidence/2026-10-30-application-performance.md) and its
[compact canonical reports](../references/evidence/application-performance-2026-10-30/).

Worktree: `/private/tmp/apack-application-performance`. Foundation branch `session/application-performance`,
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

- Code tip: `2ede06275df49ec066eae7c7d241fedd014bc306`.
- [Strict CI 41162244468](https://github.com/spankyed/apack/actions/runs/41162244468): all six jobs
  passed, including both integration and both native shards.
- Supported host chain: 6,072 host/tooling tests, 976 pack tests and 788 integration tests passed.
  Runtime build, external-app, smoke and both packaged-authoring checks passed. The concluding
  `chain --no-native --cores 2` passed in 347.4 seconds, reusing 25 valid steps.
- Capacity admission is resolved: OrbStack migrated to the external APFS volume. All 22 Docker
  volumes, seven image identities and preserved checkpoint hashes verified; original storage is retained.
- Two subsequent local native runs failed at subprocess deadlines. Focused process sampling observed
  the content-load subprocess blocked in `write_all_supers` for 34 seconds with negligible CPU work.
  The unchanged three-case sequence passed using bounded 3 GiB RAM scratch within the existing 6 GiB
  memory cap. Immutable compiler copies are now kept on disk to avoid accumulating them in RAM.
- The maintained scratch policy and native cache inputs passed 179 focused repository checks,
  scripts/repository and CLI typechecks and lint. The maintained Linux three-case regression passed
  (worker build 19.465 s; verification 22.661 s). The full cached local chain and
  [strict CI 41177136449](https://github.com/spankyed/apack/actions/runs/41177136449) are running
  on code composition `595754a674`; their final outcomes remain unproven.
- The stale procfs receipt was diagnosed and fixed in both startup and compilation data readers.
  Fresh Linux build/facade replay, focused regressions, mutation checks and strict CI passed.
  The original renderer timeout and the Linux-root/macOS-host unit failures remain retained,
  with their separate focused dispositions in the evidence record.
- Complete raw evidence is preserved in verified compressed archives under the ignored
  `.apack/performance/` directory; no foreign volumes, images or caches were removed.

## Dependency-ordered remaining requirements

1. **Complete local native acceptance.** Track the already-running full host chain (run
   `2026-10-31T06-32-57Z-1997`) and strict CI 41177136449. The local run uses the frozen native checkout
   `/private/tmp/apack-performance-elmdb-pinned`. Keep valid prior results cached; do not repeat
   application qualification or weaken admission/deadlines. The full command is
   `APACK_LINUX_ELMDB_ROOT=/private/tmp/apack-performance-elmdb-pinned npm run chain -- --cores 2`.
2. **Close acceptance and handoff.** Record the actual local native outcome and mark both dependent
   PRs ready after required acceptance is complete. The implementation and measured evidence are
   already committed and reviewable. No further feature work is planned unless validation exposes
   a material defect.

No full-goal completion is claimed while local native acceptance remains unresolved. Strict native CI
passed, but is not presented as that local result. The original scope and acceptance remain intact.
