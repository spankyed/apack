# SQLite candidate harness

This directory began as the opt-in feasibility experiment preserved at `4a3fe698f8` on `session/sqlite-evaluation`
(apack `5838145675`, elmdb `9359949`). The current implementation follows
[the SQLite goal](../../../../docs/goals/goal-ears-sqlite.md) on `session/ears-sqlite`, with its pinned native baseline
and exact evidence recorded there. It does not select SQLite for normal app boot or migrate daily-use data.
Use synthetic/copied data and separate directories; elmdb directories are refused.

The [original evaluation plan](../../../../docs/plans/ears-sqlite-evaluation.md) and
[dated findings](../../../../docs/references/evidence/ears-sqlite-evaluation-2026-10-27.md) describe historical results,
not acceptance of the changing implementation.

## Reproduce

Use a separate worktree with private dependencies/output. Run broad checks in disposable Linux/CI, one expensive
owner at a time. From the repository root:

```sh
npm run test:linux -- bash -lc 'npm run typecheck -w @apackdev/ears && EARS_EVALUATION_BACKEND=sqlite npm test -w @apackdev/ears'
npm run test:linux -- npm test -w @apackdev/ears
```

SQLite uses pinned `better-sqlite3` 13.0.3 and `sqlite-vec` 0.1.9 from the normal workspace lockfile. The adapter
lives in `src/sqlite/` and its app-only entry is `@apackdev/ears/sqlite`; this directory now holds harnesses rather
than another implementation. Packaged Electron/native loading still needs qualification.
Ordinary tests select elmdb and skip SQLite-only cases. Targeted driver checks have run on macOS arm64 and
Linux; this is not Electron/Windows qualification. The SQLite suite currently has the documented explain gap;
do not report its remaining passing cases as a completely passing suite.

From the repository root, run one expensive task at a time:

```sh
python3 packages/apack-ears/bench/sqlite/run-bench.py /private/tmp/ears-sqlite-api-trials
python3 packages/apack-ears/bench/sqlite/run-bench.py /private/tmp/ears-sqlite-durable-trials --durable
node --import tsx packages/apack-ears/bench/sqlite/capabilities.ts
node --import tsx packages/apack-ears/bench/sqlite/primitive-bench.ts
node --import tsx packages/apack-ears/bench/sqlite/explain.ts
```

`run-bench.py` alternates backend order, uses fresh processes, and preserves every timing sample and stderr.
`bench.ts` measures the actual EARS facade over the same synthetic fixture; SQLite transport is structured, while
MessagePack remains at the native elmdb boundary. Rerun comparisons on pinned current source before making claims.
`primitive-bench.ts` is deliberately separate: native exact vector search without EARS overhead, not an application benchmark.
`mutations.py` targets the original prototype and belongs to its preserved checkpoint; current safeguards have
negative-proof evidence linked from the goal. The synthetic sine-generated vectors are low-rank; these timings do not establish ANN recall or real embedding quality.

Run the evaluation-only host alias in a disposable environment, from `packages/apack-host`:

```sh
../../node_modules/.bin/vitest run --config ../apack-ears/bench/sqlite/host.vitest.config.ts
```

This currently reports four backup-import failures: production backup preflight explicitly requires `data.mdb`.
Keep that result visible. The alias does not manufacture a compatibility file or patch production backup code.
The database-opening suite and the import-transaction coordinator suite pass; the latter uses mocked stores.
These are integration probes, not proof of a production cutover.

## Implementation boundaries

`src/sqlite/database.ts` implements the structured database/unit port. Authoritative attributes live in native scalar columns
and out-of-row values through `src/sqlite/values.ts`; entities no longer hold a whole-row payload or JSON document.
Catalog metadata, derived scalar/list membership and relations use SQLite WAL transactions. `src/sqlite/query.ts` compiles
selection, projection and one-hop traversal into SQL. Mixed-value sorting remains a JavaScript fallback, and deep
traversal retains a JavaScript seen set with batched SQL frontiers.
`src/sqlite/search.ts` adapts native FTS5 and sqlite-vec distance functions to EARS text, embedding and hybrid operations.
Existing EARS builders, transactions, typed facades and observers are reused.

The prototype is intentionally unfinished: its schema validator and error translation are partial; index admission
is synchronous; fuzzy expansion scans the vocabulary; vector queries use exact scalar scans; backup publication,
OS I/O failure semantics, permissions, migration and cross-platform packaging are not qualified. It is not a
second production backend. A passing EARS suite is a feasibility signal, not complete elmdb feature parity.
