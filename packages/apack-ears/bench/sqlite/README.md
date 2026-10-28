# Private SQLite feasibility experiment

This is an opt-in prototype on `session/sqlite-evaluation`, based on apack `5838145675` and elmdb `9359949`.
It does not select a backend for the app, change the published EARS API, or migrate data.
The implementation refuses directories containing `data.mdb`. Use synthetic data and separate directories.

The [evaluation plan](../../../../docs/plans/ears-sqlite-evaluation.md) and
[dated findings](../../../../docs/references/evidence/ears-sqlite-evaluation-2026-10-27.md) describe scope and limits.

## Reproduce

Use a separate worktree with its own dependencies and output. Install normal repository dependencies first.
From the repository root, install the two pinned experimental dependencies:

```sh
npm ci --prefix packages/apack-ears/bench/sqlite/extensions --ignore-scripts --no-audit --no-fund
npm run typecheck -w @apackdev/ears
```

The tested macOS arm64 packages supply prebuilt native binaries. Other platforms and packaged Electron are unverified.
The Node 23.11.1 `node:sqlite` build here has no FTS5; this experiment uses `better-sqlite3` 13.0.3 and
`sqlite-vec` 0.1.9. The experimental install is separate from the workspace lockfile and production dependencies.
Ordinary EARS tests do not load it.

From `packages/apack-ears`:

```sh
EARS_EVALUATION_BACKEND=sqlite ../../node_modules/.bin/vitest run --config vitest.config.ts --maxWorkers 1 --no-file-parallelism
../../node_modules/.bin/vitest run --config vitest.config.ts --maxWorkers 1 --no-file-parallelism
```

The first runs existing EARS contracts and the additional operational tests against SQLite. The second retains
elmdb and skips the opt-in operational tests. No assertions in the existing contracts are weakened.

From the repository root, run one expensive task at a time:

```sh
python3 packages/apack-ears/bench/sqlite/run-bench.py /private/tmp/ears-sqlite-api-trials
python3 packages/apack-ears/bench/sqlite/run-bench.py /private/tmp/ears-sqlite-durable-trials --durable
node --import tsx packages/apack-ears/bench/sqlite/capabilities.ts
node --import tsx packages/apack-ears/bench/sqlite/primitive-bench.ts
node --import tsx packages/apack-ears/bench/sqlite/explain.ts
python3 packages/apack-ears/bench/sqlite/mutations.py
```

`run-bench.py` alternates backend order, uses fresh processes, and preserves every timing sample and stderr.
`bench.ts` measures the EARS API, including its existing MessagePack port, over the same synthetic fixture.
`primitive-bench.ts` is deliberately separate: native exact vector search without EARS overhead, not an application benchmark.
The synthetic sine-generated vectors are low-rank; these timings do not establish ANN recall or real embedding quality.

From `packages/apack-host`, the evaluation-only alias runs the existing host suites:

```sh
../../node_modules/.bin/vitest run --config ../apack-ears/bench/sqlite/host.vitest.config.ts
```

This currently reports four backup-import failures: production backup preflight explicitly requires `data.mdb`.
Keep that result visible. The alias does not manufacture a compatibility file or patch production backup code.
The database-opening suite and the import-transaction coordinator suite pass; the latter uses mocked stores.
These are integration probes, not proof of a production cutover.

## Implementation boundaries

`database.ts` implements the current structural database/unit port. It stores authoritative MessagePack rows,
JSON projections, normalized value indexes, relations and metadata in SQLite WAL transactions. `query.ts`
compiles selection into SQL, with explicit JavaScript fallbacks for mixed-value sorting and graph-order semantics.
`search.ts` adapts native FTS5 and sqlite-vec distance functions to EARS text, embedding and hybrid operations.
Existing EARS builders, transactions, typed facades and observers are reused.

The prototype is intentionally unfinished: its schema validator and error translation are partial; index admission
is synchronous; fuzzy expansion scans the vocabulary; vector queries use exact scalar scans; backup publication,
OS I/O failure semantics, permissions, migration and cross-platform packaging are not qualified. It is not a
second production backend. A passing EARS suite is a feasibility signal, not complete elmdb feature parity.
