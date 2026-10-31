# SQLite feasibility evaluation for EARS

Status: feasibility checkpoint documented, 2026-10-27. Execution has moved to the
[SQLite implementation goal](../goals/goal-ears-sqlite.md); this plan preserves the completed evaluation scope. App baseline: `5838145675`; elmdb baseline: `9359949`.
Branch/worktree: `session/sqlite-evaluation`, `monorepo-worktrees.noindex/sqlite-evaluation`.
Production retains elmdb. The active agent's app and engine checkouts were not edited.

## Decision and evidence

The [dated evaluation](../references/evidence/ears-sqlite-evaluation-2026-10-27.md) contains the capability matrix,
algorithmic/maintenance critique, raw measurements and principal-engineer recommendation. The
[reproduction guide](../../packages/apack-ears/bench/sqlite/README.md) describes the opt-in prototype and commands.

SQLite supports the broad EARS contract in an isolated implementation. The current adapter does not establish
a performance or ownership advantage over elmdb. Text search is near parity after avoiding unnecessary work;
other measured API paths favor elmdb, with vector results qualified as exact scan versus ANN. No migration is justified.

## Authorized scope and disposition

- Implement a private SQLite database/unit port; retain existing public builders, typed facades and observer code:
  done under `packages/apack-ears/bench/sqlite`, selected explicitly in the test harness. No production EARS source change.
- Test existing contracts and independent models, preserving assertions: 200 existing cases pass against SQLite.
  Twelve added operational probes cover recovery, schema changes, concurrency and final-review correctness fixes.
- Evaluate text/vector needs beyond the package tests: done as differential probes. Tokenization, field syntax,
  phrase boundaries, languages, fuzzy scalability and vector execution remain explicit gaps, not silently waived requirements.
- Compare complete API operations: three fresh-process paired trials per backend, five timing rounds each; separately
  match durable commits with macOS full-device flushes. Preserve samples/ranges and distinguish primitive diagnostics.
- Exercise host integration: opening works; 18/22 host probe cases pass. Four backup-import cases fail at production's
  hard-coded `data.mdb` preflight. This is a concrete integration finding; the prototype is not a drop-in replacement.
- Assess all needs: map current EARS, host open/backup/run-history, raw elmdb maintenance features and platform/failure
  guarantees. Unimplemented or unqualified capabilities remain in the dated matrix. No production parity claim.
- Document a path forward: done. A further SQLite checkpoint needs a structured internal transport, idiomatic SQL
  pushdown, explicit search/recall requirements, host storage descriptors and failure/platform qualification before a cutover.

## Isolation and validation

Private app worktree, dependencies and generated output; synthetic data only. Reuse the existing isolated elmdb
release addon. No Rust source/build change or additional multi-gigabyte target copy was needed.
Pinned experimental dependencies live under the benchmark directory and are not production workspace dependencies.
No production switch, real-data conversion, release or new remote branch/PR is part of this checkpoint.

The initial routed-spec run exposed missing private workspace dependencies/generated pack artifacts and placement
errors in the new experimental directory. Complete workspace-local dependency copies and the repository's existing
`bench/` plus `tests/engine/` conventions resolved those setup/placement issues. Targeted repository guards passed 82 cases.

The first full gate stopped at the compiler's Ajv dependency resolution. After restoring private workspace-local
copies, a retry used a session-specific compiler store and passed app/external-pack builds, API/package checks,
all typecheck legs, lint and the fast suite (506 files passed; 5,909 tests passed, 19 skipped).
The gate was interrupted after noticing the fast suite still includes captured-compiler tests under `--no-native`.
Those ran inadvertently, contrary to the earlier local-testing constraint. Do not rerun broad/compiler tests on
this Mac for this evaluation; use disposable Linux/CI if a complete gate is later required. Remaining validation is
EARS-only and static. This checkpoint does not claim a complete local gate or CI pass.

## Current handoff

The prototype checkpoint is complete at `4a3fe698f8`, preserved on `session/sqlite-evaluation`.
Final EARS-only checks passed: SQLite 212/212; default elmdb 200 passed with 12 opt-in tests skipped;
EARS typecheck passed; five disposable negative proofs detected their mutations.

The user authorized a full SQLite draft attempt and flexibility in search scoring/ranking subject to usefulness
and explicit feature requirements. Continue implementation through the [new goal](../goals/goal-ears-sqlite.md)
on `session/ears-sqlite`. The historical evidence remains unchanged; adoption still follows a complete candidate
and a recorded decision. All missing capabilities transfer to the new goal rather than becoming exclusions.
