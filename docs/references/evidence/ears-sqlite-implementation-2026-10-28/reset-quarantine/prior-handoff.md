## Current handoff

The full goal remains active, with all phases and original acceptance budgets required. Deliverable:
[draft PR #286](https://github.com/spankyed/apack/pull/286), `session/ears-sqlite`. Production stays elmdb.
No master merge, release, production adoption, implicit daily-profile conversion or version-only PR is authorized.

Source work stays in `/private/tmp/ears-sqlite-query-integration`; the clean publisher is
`monorepo-worktrees.noindex/integration-3AEBRl`. Canonical `sqlite-evaluation` remains at earlier green
`6cf6c8349e`; do not infer it contains later published work. The integrated committed master snapshot is
`dc67febcce3f3a28e8b2bc75b867f0374d4f4610`, retaining native pin
`2441af4658d961f547c7094cd041c2ac246668c5`. Inspect actual Git and workflow state before continuing.

The published [graph checkpoint `836d3d1d1f`](../graph-contract-62f1798c9b/README.md)
implements master's graph contract in the structured port and SQLite. It includes managed directory-lifetime
claims for writable/read-only handles, scoped quarantine/recovery, stale-publication refusal and retained
claims when failed opens cannot close. [Strict CI 41095887025](https://github.com/spankyed/apack/actions/runs/41095887025)
is terminal failure with only the app shard failing the signing unit's canonical-path assertion. Producers,
both integration shards, both native shards and all three SQLite platforms pass. Its original failure is
retained; this is not whole-run success. [Signed installed Preview 41095894244](https://github.com/spankyed/apack/actions/runs/41095894244)
passes on `836d3d1d1f`: cold build, unsigned/signed native smoke, strict Developer ID bundle verification and
all six actual executable cases including the two-store/model-ownership witness. That qualifies macOS ARM64
at that parent, before the following changes.

The [current identity/signing checkpoint](../format-identity/README.md)
refuses foreign/mismatched SQLite identities before initialization, preserves foreign committed WALs through
read-only inspection, atomically publishes new identity/primary storage, and refuses missing primary tables.
Probe cleanup preserves uncertain-connection authority. It fixes the signing fixture and the independently
reproduced outer-app alias defect. The installed witness now requires persisted EARS identity in both stores;
that additional witness passes in the signed installed app at `f731a4a549`. A new signed run remains required
after the native pin change.

Current local gates pass 720 native-enabled EARS cases with zero skips, 1,929 host cases with one existing
Windows-only skip, 38 storage cases, matching five normal package builds, three API reports, EARS/host and
exact scripts/repo/publish/E2E types, changed lint, three reverted safeguards/restored 19 identity cases and
10 signing cases. The resource-paused failed host run and unchanged-source successful rerun are both retained.
No assertion or deadline was relaxed. Compiler/full checks stay in private disposable environments capped at
two CPU/six GiB/no swap with dropped capabilities; focused checks use half a CPU/768 MiB. A quiet admission
window avoids starting a broad suite between the other agent's builds. Published checkpoint `f731a4a549`
completed [full strict CI 41106571398](https://github.com/spankyed/apack/actions/runs/41106571398) and
[signed installed Preview 41106578424](https://github.com/spankyed/apack/actions/runs/41106578424).
Signed installed acceptance passes on `f731a4a549`, including both persisted-identity assertions. Strict
runtime steps pass on all three SQLite hosts, but their final case verifier fails; Linux exposes its stale
27-case count. Integration-1 independently times out at the original 200-second deadline in the refused
replacement facade-cache test. Producers, app-and-rest, both native shards and integration-2 pass.
The timeout remains unresolved; do not raise its deadline or call the whole run green.
The published [named-inventory fix `9fbea37d0d`](../format-identity/verification-inventory/README.md)
requires all 29 publication and 19 identity cases and passes eight real-report positive/negative controls.
No passing additional case can mask a missing/skipped invariant. Its retained platform run
[41112243866](https://github.com/spankyed/apack/actions/runs/41112243866) has Linux success; macOS and Windows
remain active at this snapshot. Recheck the same run rather than replacing its pending work.

The [native 2441 integration](../native-2441-integration/README.md)
adapts the structured edge terminal and SQLite executor to master's direction field, preserving both public
edge directions. A private matching binding/CLI build, typecheck, 56 query/relation cases per backend,
five normal package builds, API reports and 720 full SQLite-selected EARS cases pass with no skips.
Those checks do not replace final host, integration, platform, installed and performance acceptance.
The [file ownership admission](../file-ownership/README.md)
refuses main/sidecar aliases, nonregular files and orphan sidecars before any native inspection or open;
backups require an empty four-file namespace. Its 42 new ownership and 19 existing identity cases pass
without skips. The unchanged parent fails 37 of the original 38 ownership cases, including external
shared-memory target corruption. This is cooperative namespace admission, not atomic native no-follow
opening or protection against arbitrary concurrent namespace replacement.
Broader isolated validation passes typechecking, changed-file lint, five normal package builds, 762 full
SQLite-selected EARS cases (zero skips), and 1929 host cases (1 existing platform skip).
The exact CLI case passes in 28.6 seconds on Linux under its unchanged 200-second deadline, with the other
13 cases intentionally unselected. Its earlier macOS CI timeout remains unexplained and final integration
acceptance is still required. The retained run is terminal success; reports and original/fixed evidence are
in the linked file-ownership evidence. No assertion or deadline was relaxed.
The next implementation checkpoint is store-excluded reset and quarantine-parent durability; final
platform/installed qualification and all performance/relevance requirements remain active.
No previous result certifies arbitrary filesystems or completes the remaining goal.

Earlier [full strict 41056724109](https://github.com/spankyed/apack/actions/runs/41056724109) is green at
`3333361c3c`, including every required shard and all three SQLite hosts. Retained native audit/repair receipts
verify all 25 maintenance cases per host at that source. The original bundled-editor intermittent failure
remains unexplained despite ten later unchanged repetitions passing. This handoff's history and prior source
boundaries are preserved in the [prior snapshot](../format-identity/prior-handoff.md),
[earlier checkpoints](../checkpoint-history.md) and
linked evidence. Source checks, partial CI and smoke cases are not whole-app or performance acceptance.
