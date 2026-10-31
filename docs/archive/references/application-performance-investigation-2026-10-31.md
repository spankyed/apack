# Application performance investigation archive

Historical investigation and checkpoint diary. Current architecture and commands live in the
[recording reference](../../references/application-performance.md); the
[evidence index](../../references/evidence/2026-10-30-application-performance.md) owns the concise result inventory.

# Application performance qualification evidence

2026-10-30. Delivery checkpoints: [#293](https://github.com/spankyed/apack/pull/293) and
[#294](https://github.com/spankyed/apack/pull/294). Compact canonical comparisons, observed-order journals and actual invocation records are checked in
under `application-performance-2026-10-30/`. These retain raw scalar samples and full manifests without
committing large profiles or application logs. Complete raw reports remain in ignored
`.apack/performance/linux-evidence/`; the maintained reproduction workflow is
`tests/performance/README.md`. This record distinguishes functional proofs, controlled measurements
and incomplete/superseded evidence.

## Scope and method

The four actions use the real built application and deterministic disposable data. A comparison has
five warmups and twenty measured actions per variant, individually balanced ABBA execution, actual
child exit evidence, clean source, matching fixture/runtime/machine/native identities and bounded raw
records. Each pair uses identical source/app outputs. Different checkpoint runs below are not pooled.
Electron runs in the bounded Linux runner (two CPUs, 6 GiB), Node 23.11.1. Native source is a separate
clean checkout at unchanged repository pin `95615ed8d493f9a7c2789eaf1f4c847ae375eb32`.
Filesystem caches are warm; fresh processes are not cold disk. These are one-machine observations,
not certified hardware/OS performance or reliable tail estimates.

Warm action clocks exclude recorder setup/export; startup includes recording initialization during
launch. Readiness means the requested database-backed view, full laid-out DOM contents and Vue flush,
not physical input or paint. Process observations are totals, not exact per-action attribution.

## Warm-action mode comparisons

Source `d391acfaef656427fe4920f928f5bd4116070926`. Each row has twenty measured actions per mode;
all correctness/capture checks passed. Duration units are milliseconds. Ranges retain every sample.
The declared lightweight median-overhead budget is 5%; detailed mode has no low-overhead budget.

| Action | Compared with disabled | Disabled median | Enabled median | Median change | Disabled / enabled ranges |
|---|---|---:|---:|---:|---|
| thread-open | lightweight | 373.50 | 384.85 | +3.04% | 342.00–552.60 / 347.90–421.80 |
| search | lightweight | 11.40 | 11.80 | +3.51% | 10.50–14.50 / 10.50–20.20 |
| streaming | lightweight | 755.95 | 739.90 | -2.12% | 722.30–781.30 / 720.40–813.30 |
| thread-open | detailed | 393.90 | 397.60 | +0.94% | 356.20–444.80 / 374.80–470.30 |
| search | detailed | 14.70 | 16.15 | +9.86% | 11.60–16.70 / 12.80–18.60 |
| streaming | detailed | 749.70 | 727.30 | -2.99% | 734.90–773.40 / 700.60–752.60 |

Raw roots: `qualification-disabled-vs-lightweight-1793406874704` and
`qualification-disabled-vs-detailed-1793407476606`. Negative differences are measured variation,
not an instrumentation speedup claim. A prior full search comparison at `e903d33ac0` missed the budget:
10.60 ms disabled versus 11.65 ms lightweight (+9.91%), retained in
`qualification-disabled-vs-lightweight-1793402846262/search`. No tuning change explains the later
within-budget result. The evidence does not establish universal sub-5% overhead for very short searches.

## Startup measurement correction

The first full startup comparison passed correctness/capture but measured 4,065.42 ms disabled versus
8,367.36 ms lightweight (+105.82%). Review found that `findMainWindow` checked existing windows once,
then waited up to five seconds for a new window before checking them again. Readiness arriving in an
existing window emitted no new window event. Recording increased the chance of taking this path;
spans showed the corresponding delay after backend admission and frontend pack readiness.
These values include a harness artifact and cannot establish application instrumentation overhead.
The remaining detailed startup run was explicitly cancelled; completed warm comparisons were retained.

Correction `e0d1a0e3a4` rechecks existing windows while listening for new ones. Its fake-clock regression
test rejects the restored five-second delay. A fourteen-launch contract run passed
(`qualification-disabled-vs-lightweight-1793408022421`), without the five-second wait. Two measured
medians were 4,058.64 ms disabled and 4,067.05 ms lightweight; these are contract evidence only.
Full corrected startup qualification passed all forty measured launches per comparison, with complete
required captures and verified per-child lifecycle/manifests. No samples were excluded.

| Compared with disabled | Disabled median (ms) | Enabled median (ms) | Median change | Disabled / enabled ranges (ms) |
|---|---:|---:|---:|---|
| lightweight | 3938.70 | 3981.67 | +1.09% | 3838.57–6055.55 / 3910.13–6076.25 |
| detailed | 4028.98 | 4298.94 | +6.70% | 3907.62–4464.20 / 4152.75–11157.89 |

Raw roots: `qualification-disabled-vs-lightweight-1793408130509` and
`qualification-disabled-vs-detailed-1793408480945`, source `e0d1a0e3a4`. Lightweight passes the
5% budget; detailed has no low-cost budget. The 11.16-second detailed outlier remains in the range.
The warm-action evidence above is reused: the correction changes test window discovery and paired
handshake publication, outside their measured action intervals; no application instrumentation was tuned.

## Recording and comparison integrity

The recorder caps starts/observations/metadata, encodes only allowlisted scalar attributes and exposes
loss. Detailed profiles reserve 8 MiB within the existing 16 MiB process budget; spans retain the other
8 MiB. Per-profile CPU/allocation outputs are limited to 4 MiB; oversized output fails capture.
The shipped V8 sampling depth is 128. Standard nested CDP messages avoid Electron 37's shallow JSON
response parser; actual startup profiles reach depth 124. Protocol deadlines and debugger ownership
remain enforced. Combined CPU profiles include profiler setup/heap-stop work, not pure application self time.

Run retention writes each bounded raw trial once plus viewer files and a hash-verified compact index.
Admission requires actual distinct process identities, successful invocations, consistent startup
manifests, complete required counts/order and native checkout equal to its pin. A successful short run
cannot qualify overhead. Failures, cancellations and unsuccessful samples remain explicit.

Four-scenario paired A/A execution passed at `d391acfaef` with two measured actions per worker
(`revisions-lightweight-1793406515074`). Warm workers foreground the permitted window outside action
timing; startup launches/closes a separate copied profile for each permission. Final release prevents
one worker's teardown from interfering with its peer's last action. Review then fixed a second race:
ready/permit/done/release files now publish completed JSON atomically. An interleaved-reader regression
rejects the original visible-empty-file behavior and checks failure cleanup. The full-length thread A/A control then passed twenty measured actions per worker at `e0d1a0e3a4`
(`revisions-lightweight-1793408884962`): 459.20 versus 460.45 ms median (+0.27%). Both are the same
revision, so this validates maintained execution and admission, not an optimization speedup.

## Functional and counterfactual evidence

- Thread: exact fifty full message bodies and correlated delivery; 25 correct/complete trials on
  `c3ac8b6fde` (`thread-open-lightweight-1793392911873`). Initial scroll positioning caused unsolicited
  pagination; generation-owned positioning suppresses automatic paging until settled. Seven pack tests
  cover this behavior. This is a demonstrated work-bound fix, not an asserted speedup.
- Full-read mutation: fifty correct visible rows still fail the 164,809-byte action-window work budget
  with 533,750 returned bytes (`thread-open-lightweight-1793393476165`). Aggregate window work is not
  exact causal attribution. Missing-completion mutation preserves the view but produces incomplete/no
  duration/no success marker (`thread-open-lightweight-1793393806852`, `5b305de133`).
- Streaming: real CLI/chat flow, fresh twenty-message histories, 24 scripted chunks, intermediate DOM
  progress and complete final text/timestamp in a persisted view. Twenty-five trials passed at
  `e78bacdcd5` (`streaming-lightweight-1793393644130`). Bounded producer/receipt progress measures pending
  UTF-16 units with approximate epoch alignment, not database commit latency. Missing/ambiguous logs fail.
- Search: exact current twenty-hit timestamp/thread set and snippets; old results delivered after
  supersession/cancellation are rejected. Transport callback generations have separate contract tests;
  actor delivery is not a forced late wire packet. Wrong-identity results fail despite the correct count.
- Actual backend CPU/PID proof passed at `d391acfaef`
  (`backend-block-1793406828850`); an earlier 200,000-microsecond CPU charge retained 209,995 microseconds
  in backend totals. Renderer stall proof at `1f81f60c4e` recorded a 200.5 ms block, 202 ms long task and
  210.6 ms renderer task time (`renderer-block-1793399847469`).
- Query probes (`query-plans-1793400901200`, `f1769741a5`) retain native stages/indexes/visited/kept counts
  for the 54-entry traversal and twenty-hit search. Counters are stage-defined, not exhaustive physical
  work or unique rows; the ids terminal does not measure projection/codec work.
- Detailed startup functional proof (`populated-startup-detailed-1793401461359`, `d90a8240e6`) includes
  complete backend/renderer CPU/allocation profiles. Startup provenance hashing was subsequently moved
  outside readiness and resource windows; that earlier run is functional evidence, not final latency evidence.

Focused faults cover observer/export outcome preservation, overflow/unfinished/loss reporting, queued
contexts and coalesced commit links, disconnect/admission ownership, debugger replacement, deep profile
replies and bounded protocol failures. Root actor queues restore carried context; untagged internal
XState events are not certified. Capture integrity does not certify universal instrumentation coverage.

## Validation and disposition

48 affected testing/fixture contracts, types and lint passed at `e0d1a0e3a4`. Both readiness and marker
regression tests fail when their respective defects are restored. Manual strict checkpoint
[41150926172](https://github.com/spankyed/apack/actions/runs/41150926172), `d391acfaef`: producers,
integration-2 and native-2 passed. App-and-rest passed 6,063 tests and failed two catalogue checks because
`performance-qualification.spec.ts` lacked its required row in `packages/repo-checks/CLAUDE.md`.
Adding that row passes all 115 focused catalogue/runner checks; six documentation checks also pass.
Both integration shards and both native shards subsequently passed.
The queued `e0d1a0e3a4` run was cancelled before repeating this diagnosed catalogue omission.

The local `chain --no-native --cores 2` passed API reports, package checks and API typechecking,
then hit the renderer compiler's unchanged 60-second deadline without a compiler diagnostic. Its retained
run is `2026-10-31T01-11-53Z-178`; this is not a passed gate. The isolated static renderer check passed
all three projects on macOS in 16.75 seconds and subsequently on Linux in 20.40 seconds. These results
do not establish the cause of the original timeout. No budget or assertion was weakened.

Final strict run [41155455025](https://github.com/spankyed/apack/actions/runs/41155455025) completed
successfully on `d141d8d253`: all six jobs passed. The isolated Linux static renderer check also passed
all three projects in 20.40 seconds under the unchanged deadline. A subsequent serialized broad local
chain (`2026-10-31T01-59-09Z-180`) exposed a separate facade-validation failure: a compiler receipt
retained `/proc/344/exe` after that process exited. Focused diagnosis and local acceptance remain open;
the strict result does not certify a subsequent uncommitted compiler fix. Complete session-owned
Linux reports were archived, compared against their originals and only then removed from the Linux
volume to reclaim duplicate storage. No foreign work or admission minimum was changed.

Focused procfs diagnosis identified `detect-libc` opening `/proc/self/exe` through the compilation
reader, separately from startup's reader. Both now resolve only self-executable **data** to the captured
ELF executable when it belongs to the verified compiler installation. Explicit metadata queries and
other processes retain their original observation contracts; mutable `process.execPath` is not authority.
Thirteen focused ownership/compilation tests pass (two Windows-only cases skip on macOS), CLI typechecking
and four-file lint pass, and removing each alias fix fails its regression. A fresh bounded Linux build
passed in 65.3 seconds (`2026-10-31T02-53-33Z-92`) and the exact facade replay passed in 3.1 seconds
(`2026-10-31T02-54-47Z-502`). Full local validation including native checks is running; these focused
results do not substitute for that gate. Application timing/capture code and its qualified results are unchanged.

The attempted full Linux chain (`2026-10-31T02-55-02Z-182`) passed the renderer/API/package/tooling
checks and 6,027 unit tests, then failed twelve cases across seven suites. Ten rely on permission
denial that root bypasses; the remaining two assume macOS `open`/bundle metadata. Every affected suite
passes on the intended non-root macOS host: 229 tests, seven files, 10.30 seconds. No application or
assertion change was made for these host assumptions. The supported host `chain --cores 2`, which
routes native execution to bounded Linux, is the remaining local gate. Strict run `41162135573` was
cancelled after a test-only POSIX admission correction; replacement
[41162244468](https://github.com/spankyed/apack/actions/runs/41162244468) targets `2ede06275d`.

## Final checkpoint disposition

Code tip `2ede06275df49ec066eae7c7d241fedd014bc306` passed all six strict jobs in
[41162244468](https://github.com/spankyed/apack/actions/runs/41162244468): producers, app-and-rest,
both integration shards and both native shards. The procfs regression is scoped to POSIX paths;
the original early dispatch was cancelled before being superseded, not counted as a passing gate.

The supported local host chain (`2026-10-31T03-09-03Z-53571`) passed 6,072 host/tooling tests
(eight skipped), 976 pack tests (two skipped) and 788 integration tests (one skipped, sixty files).
Native admission then refused before any test ran: Docker had 4.1 GiB free against the unchanged
8 GiB minimum. The concluding `chain --no-native --cores 2` passed in 347.4 seconds
(`2026-10-31T03-44-30Z-5853`, twenty-five of thirty-one steps cached), completing runtime build,
external-app acceptance, smoke and packaged-authoring author/app checks. This completes the ordinary
local gate; it does not claim the compiler change's required local native execution passed.

Subsequent Docker capacity recovered to about 7.5 GiB, still below admission, with another session's
Linux matrix active. Only session-owned duplicate evidence was reclaimed: the Linux reports were
archived and compared against their originals, and 4,756 retained host entries were archived and
verified by file set, SHA-256 contents and symlink targets before originals were removed. Raw reports
and earlier failures remain in `.apack/performance/linux-evidence-complete.tar.gz` and
`.apack/performance/linux-evidence-host.tar.gz`; diagnostic/fix and failed Linux-chain logs also have
separate archives there. No foreign work, image, volume or cache was removed. Archive entries preserve
the original report paths and can be restored to an owned directory for inspection.

Implementation review is complete. The diagnosed compiler fix preserves explicit procfs metadata and
foreign-process observations and trusts captured ELF ownership rather than mutable process globals.
The only remaining acceptance item is the supported local native gate when storage and execution
ownership permit it. Both PRs remain draft until that result is recorded. No application measurements
were repeated for compiler bookkeeping or documentation changes; their original source-qualified
manifests, earlier failures and limitations remain authoritative.

## External storage and native scratch checkpoint (2026-10-31)

OrbStack migration was verified by 22 volume metadata records, seven image identity tuples and
checkpoint hashes. Original internal storage remains intact. Capacity admission is resolved.
Migration receipts live outside Git under the Seagate Development/MigrationRecords directory.

Two full local native attempts then failed at different subprocess deadlines:
`2026-10-31T04-57-43Z-46429` (captured Electron pack) and
`2026-10-31T05-20-32Z-66644` (content compiler worker external inputs). Focused isolated cases
passed. Replaying the worker case with its two predecessors passed, but its build took 93.470 s.
One content-load subprocess spent 34.21 s with negligible CPU, sampled 35 times blocked in
`write_all_supers`. This establishes a filesystem wait, not a persistent JavaScript exit hang.

The same original-source sequence with 3 GiB executable tmpfs scratch passed: the slow build took
15.447 s, sampled scratch peaked at 962,887,680 bytes and sampled cgroup anon+file+kernel usage
peaked at 3,115,945,984 bytes. The existing two CPU, 6 GiB memory and no-extra-swap bounds,
subprocess deadlines and assertions were unchanged. This is diagnostic evidence, not a new
application performance comparison. Raw diagnostics remain in the owned Linux work volume at
`.apack/performance/worker-sequence-diagnostic` and `worker-sequence-tmpfs-diagnostic`.

The maintained policy selects tmpfs for the native suite or an explicit leading `--native-scratch`
runner flag. Generic Linux commands remain disk-backed. Immutable compiler copies use a per-run
checkout `.temp` directory, removed on normal teardown; exclusive source synchronization reclaims
interrupted run directories. Both outer and per-project native cache inputs include the policy.
The composed source passed 179 focused checks, scripts/repository typechecks, CLI typecheck and
changed-file lint. Maintained-policy native execution and the final broad gate remain pending.

The maintained runner regression then passed all three cases with thirteen unrelated cases excluded:
repeat build/replay/archive 16.869/17.600/18.950 s; second build 33.182 s; external-input worker build
19.465 s and verification 22.661 s. Raw source receipts and samples are in
`.apack/performance/worker-sequence-maintained-scratch-diagnostic`. No original-source or deadline
changes were introduced. The complete local cached chain is now running as
`2026-10-31T06-32-57Z-1997`; strict CI 41177136449 tests composition `595754a674`.

Final artifact audit read all nine full compact comparisons: 450 retained samples, five warmups
and twenty successful measured trials per variant, clean source/native identity, matching repository
native pin and matched fixture/machine within every pair. This validates the compact evidence;
raw-report admission and its hash checks remain the maintained runner's separate responsibility.
The implemented recording contracts now have a maintained reference page, linked from the suite guide
and documentation index. The plan's trace filename was reconciled with the implemented per-trial export.

## Review findings and fixes (2026-10-31)

Two additional qualification defects were reproduced before fixing them:

- Run admission trusted `complete` while allowing the captures promised by a mode to be absent.
  A detailed run without any profiles or resource observations was admitted as successful. Both
  whole-run and format-2 admission now require each role's observations, detailed profiles, the
  renderer's core metrics, and disabled-mode absence of enabled instrumentation.
- The revision coordinator accepted a successful worker exit before final release, allowing an
  early worker's teardown to overlap its peer's final action. A real file-handshake regression
  reproduced the successful premature release. Any observed exit before release now aborts
  coordination and prevents granting the final peer action.

Because the original local gate was still consuming its source, fixes and regressions were first
validated in an ignored isolated source copy using the existing worktree's own dependencies. All
38 focused reporting/comparison/protocol checks, the corresponding TypeScript check and changed-file
lint passed. Removing the capture guards fails all eight new capture regressions; the early-exit
regression fails on the original coordinator. The separate source worktree contains byte-identical
production fixes and equivalent tests (only relative import paths differ). Integrated validation
on the composed branch remains required.

All nine original full comparisons were re-admitted from their archived raw reports under the
stronger capture rules: 450 trials passed, including per-launch startup provenance and process
lifecycle checks. The [admission receipt](../../references/evidence/application-performance-2026-10-30/review-capture-admission.json)
retains the archive and validator hashes. The temporary extraction was removed after checking;
original archives remain intact. No timings, collectors or scenario behavior were changed.

The local gate passed the 54 changed integration files in 1,033 seconds, then the Docker connection
stalled during native preparation. OrbStack's host log records Docker-forwarding timeouts; macOS
reported an interrupted OrbStack server connection while the external APFS volume remained mounted.
This does not establish corruption or its cause. Cancellation was requested for this session's
runner only; its terminal state must be confirmed before resuming. No shared VM restart, drive
ejection or foreign-container termination was performed. Native acceptance remains open.

The original local run is now terminal (`test:native` failed after 712.1 s; complete chain 1,849.7 s).
The failing worker-disconnect case surfaced a 2 s cleanup deadline, which can mask its original
20 s readiness/exit failure; no root cause is asserted. Ten preceding worker cases passed, including
the earlier external-input case in 20.071 s. Tracked docs changed while the documentation-sensitive
outer host/integration steps ran, so the chain correctly refused their cache stamps. These are not
presented as a final passing gate. Subsequent gates must keep tracked inputs frozen.

Docker later answered a bounded ping and the old runner/client PIDs were gone. The original checkout
was fast-forwarded to reviewed code `44d246444a`. All 38 focused tests then passed on that actual
branch, together with the testing workspace's TypeScript check and lint. Final strict CI 41179507375
is queued on this code behind the existing strict run, whose cancellation policy preserves it.

With no other containers active, the exact failed native case was executed with temporary test-only
spawn/exit/original-error diagnostics, restored afterward. It passed (one case, fifteen excluded),
with the expected worker SIGKILL. Readiness, cleanup and outer deadlines and assertions were unchanged.
Raw source receipt, log and process/I/O samples are preserved at
`.apack/performance/parent-disconnect-diagnostic` in the owned Linux volume. Its unchanged producer
prelude rebuilt packages in 17.5 s and default-setup in 275.3 s; the latter was active compilation,
not evidence of an idle worker hang. The next full local run covers the order/suite gap that this
isolated case cannot prove. No further application code changes were identified in the review.

A possible source of avoidable I/O was identified: about 0.5 GB of archived reports was temporarily
extracted beneath the host checkout's ignored scratch directory, which the Linux runner syncs.
The extraction was removed after admission checking; its actual contribution to the VM stall is
unproven. Future archive extraction belongs outside the synchronized source checkout. No data loss
or filesystem corruption was established by the interrupted-share alert.

## Reviewed-code CI and repeated VM hang (2026-10-31)

[Strict CI 41179507375](https://github.com/spankyed/apack/actions/runs/41179507375), source
`44d246444a379d27dc217eac0a950bde6990f80a`, passed all six jobs. Both integration and native
shards, producers and app/rest passed. The earlier pre-review strict run also passed all six.

The frozen local snapshot `93b7208b44` passed package/type/lint/authoring gates, host/pack units and
all 60 integration files (1,854.6 s). Before the interruption, these seven native files passed:

- `compiler-native-runtime`: seven cases, six platform skips.
- `build-worker`: all sixteen cases, including parent-disconnect (3.269 s).
- `compiler-native-vite`: five cases, three platform skips.
- `compiler-native-libraries`: six cases, three platform skips.
- `watch-publication`: both cases.
- `compiler-elf-libraries`: both cases.
- `frontend-watch`: all fourteen cases.

Docker then stopped answering. OrbStack's own 04:19–04:20 local log records `sampling stacks due
to VM hang`, failed disk-stat health checks and Docker-forwarding timeouts. Guest kernel dumps
show RCU starvation and `virtio_queue_rq` / `btrfs_writepages` writeback stacks. The Docker API
ping timed out after three seconds. This is positive evidence of a host-VM execution failure, not
a completed local native gate or proof of a specific application defect, hardware fault or corruption.

Private full logs and their SHA-256 receipts are preserved at
`/private/tmp/apack-orbstack-hang-20261031-0423/`; they are not uploaded or committed because they
may include unrelated workloads. Cancellation was requested only for the identified session runner
PID 81448. No global restart, drive operation or foreign-container termination was performed.

Installed OrbStack is 2.0.5. Its [official release notes](https://docs.orbstack.dev/release-notes) list
newer fixes for freezes, inaccessible shared files and external data-drive handling. Related vendor
reports include [RCU/NFS hangs on 2.0.5](https://github.com/orbstack/orbstack/issues/2352) and
[a whole-VM hang during host file sharing](https://github.com/orbstack/orbstack/issues/2593).
These are similar failure classes, not proof of the same root cause. Approval is pending for an
offline-backed-up shared upgrade to current 2.2.5 after other agents stop their Docker workloads.
Current disk preservation and post-upgrade verification remain necessary; no guarantee that the
upgrade cures this precise hang is asserted. Full local acceptance and PR readiness remain open.

## Final integrated acceptance (2026-10-31)

The interrupted run `2026-10-31T07-19-26Z-83547` ultimately completed every native assertion:
15 files passed, two platform files skipped; 56 cases passed and 45 platform cases skipped.
The outer native command returned 130 after this session requested cancellation during the VM hang;
that outer result is not a pass. The native project cache was nevertheless saved by the completed
suite. A read-only probe using the repository's normal `freshnessSweep`, `poolUnitFor` and
`poolStampFor` returned an existing chain-provenance native stamp with `staleReason: null`.
No stamp was fabricated or edited.

The supported command was then resumed normally with tracked inputs frozen at `93b7208b44`:

```sh
APACK_LINUX_ELMDB_ROOT=/private/tmp/apack-performance-elmdb-pinned npm run chain -- --cores 2
```

It passed in 619.0 seconds, reusing 25 of 32 valid step results. Run
`2026-10-31T08-46-38Z-67326` records successful native acceptance (134.4 s, normal project-cache
reuse), runtime build (62.8 s), external-pack app acceptance (188.3 s), smoke (7.1 s), packaged
authoring author (208.8 s) and app (14.9 s), plus package admission. The earlier frozen run supplies
the actual full native execution and all 60 integration files; the resumed chain verifies their
cache validity and finishes the remaining end-to-end checks. The outer full chain returned zero.
Assertions, deadlines, CPU/RAM/swap policy and native source pin were unchanged. The native pin is
`95615ed8d493f9a7c2789eaf1f4c847ae375eb32`.

All six strict CI jobs in 41179507375 passed on reviewed code `44d246444a`. Later commits through
this closure only change documentation. The actual composed branch's 38 focused reporting/protocol
tests, TypeScript and lint passed; all 450 raw trials re-admitted under the stronger capture rules.
The completed goal contains the requirement audit. No repeated performance experiment was needed:
the review changes enforce admission/lifecycle and do not alter valid collection or scenario timing.

OrbStack recovered without a shared restart or upgrade. Optional shared VM maintenance still awaits
user approval; it is no longer an application acceptance dependency. Its hang's cause remains
unproven. Original disk preservation and other agents' data remain untouched.


## Runtime separation review — 2026-10-31

Cleanup checkpoint `0ca8217459` separates runtime execution from observation across the combined
#293/#294 tree. The [ownership table](../../references/application-performance.md#runtime-integration-boundaries)
names the adapters. View resolution/sharing, transaction execution, invalidation, routing,
authorization and reconnect lifetimes remain with their runtime owners. Diagnostic policy owns
context restoration, spans, receipt sequences, startup receipts and bounded commit causes. The
six SDK boundary helpers are internal exports; generated API reports were regenerated normally.

The normal local gate, `npm run chain -- --no-native --cores 2`, passed in 2032.5 seconds:
31 steps, nine valid cache hits, run `2026-10-31T12-40-32Z-43939`. Host units passed 541 files /
6,124 tests (eight skipped), pack units passed 148 files / 988 tests (two skipped), and integration
passed 60 files / 788 tests (one skipped). Runtime builds, external-pack contract/fork/application
acceptance, smoke and both packaged-authoring checks passed. Native acceptance was explicitly
omitted from this local command. The local engine checkout was `214517addf`, whose only differences
from inherited pin `d33f859b0f` are two roadmap documents; this is not a pin-exact timing trial.
Focused regressions also cover original application errors, independent watch contexts, fresh
reconnect causes, disabled startup completion receipts and visible receipt overflow.

[Strict run 41197944979](https://github.com/spankyed/apack/actions/runs/41197944979) passed all six
jobs on earlier source `a075fe1c41`. [Strict run 41202958789](https://github.com/spankyed/apack/actions/runs/41202958789)
was dispatched for exact cleanup source `0ca8217459` and remains pending at this documentation
checkpoint. Strict concurrency disables cancellation; the earlier run was allowed to finish.
The later documentation commit does not change the tested runtime implementation.

Current-code Linux application qualification remains open. [Run 41203505748](https://github.com/spankyed/apack/actions/runs/41203505748)
failed before scenario execution because the renderer never exposed `applicationState`. A focused
probe found JavaScript asset requests failing with `net::ERR_FAILED`; sampled files exist, are
readable with mode 0644, and Electron's open-file limit is 65,536. The renderer build is retained.
[Probe 41204498413](https://github.com/spankyed/apack/actions/runs/41204498413) loaded those retained
bytes with the same Electron version in a minimal bounded Linux harness and reported no failed
requests. That probe does not exercise full application startup and is not passing application
qualification. The full-app-only loading failure's cause is unproven; the next diagnostic should
compare full-app launch/session/protocol setup against that minimal harness using retained outputs.
No deadlines, assertions or resource bounds were weakened, and no application startup refusal is
presented as a passing trial. The diagnostic workflows exist only on the isolated validation branch.
Historic measurements above remain source-qualified and are not claims about this cleanup's overhead.


The historical requirement audit remains available at
[closure checkpoint 9382e3c53d](https://github.com/spankyed/apack/blob/9382e3c53d14bdc8bbc33e2f5ab7346edd3ed4a6/docs/archive/goals/goal-application-performance.md).
