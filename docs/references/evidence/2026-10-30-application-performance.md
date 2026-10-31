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
Integration-1 subsequently passed; native-1 is still running.
The queued `e0d1a0e3a4` run was cancelled before repeating this diagnosed catalogue omission.

The final local `chain --no-native --cores 2` passed API reports, package checks and API typechecking,
then hit the renderer compiler's unchanged 60-second deadline without a compiler diagnostic. Its retained
run is `2026-10-31T01-11-53Z-178`; this is not a passed gate. A focused compiler-progress diagnostic was
subsequently refused before execution because Docker had 1.5 GiB free against the runner's 8 GiB minimum.
The same static renderer check on macOS, isolated under the unchanged deadline, completed all three
compiler projects without errors in 16.75 seconds (about 1.69 GiB reported memory). This does not prove
the cause of the Linux timeout or replace the local broad gate. No budget or assertion was weakened.
Final local/integrated validation remains pending; both PRs remain
drafts until those requirements are satisfied.
