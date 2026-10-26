# Run history leaves the engine — its own store, one engine environment

Status: done, 2026-10-23, on `run-history-store` (cut from `ears-engine-overhaul`; see Outcome). Raised in the review of the EARS API cleanup (items 7, 8 and 12).

## Context

Run history (TNode rows: a flow run's flow, event and step records) is an EARS entity today. It lives in the
in-memory engine while a run happens and is persisted by a sharded router to a second LMDB environment
(`volatileBackup`, dir `ears-trace`). That one choice causes three problems raised in the PR review:

- **7 — two query languages:** live runs are read from the engine (`brainQueries`), past runs from LMDB
  (`traceStore` → `trace-query.ts`, which also duplicates descendants in its tree).
- **8 — non-atomic units:** a unit touching a node and its TNode spans two environments, two commits.
- **12 — router complexity:** keep-as-history rule, relation caches, unknown-relation fallbacks, `unload`, all
  because one engine spans two stores linked by relations.

Run history is an execution log (append, immutable once done, read by run, unbounded, disposable), not the
system of record. It moves to its own append-only store with a domain API; TNodes stop being entities; the
engine persists to one environment. Inventory finding that makes this safe: **execution never reads a TNode
back from the engine to route** — routing uses the blueprint, XState context and an actor registry keyed by
`flowTNodeId`; step handlers get the in-memory object `create` returns.

**Decided with the user:** keep runs **30 days** (prune whole runs at store open); **drop** the old
`ears-trace` history (never read again; deleted by an explicit one-off, never at boot); **add `apack db runs`**
in place of `--volatile`. Commits continue on `ears-engine-overhaul`, one per step, no attribution, nothing pushed.

## Design (the target state)

- **Record store, `@apackdev/ears/lmdb`** (`lmdb/record-store.ts`): `openRecordStore({ path, indexes, readOnly? })`
  → `get`, `put` (whole record, index entries maintained), `delete`, `findBy(index, value, { reverse, limit, before })`,
  `close`, `reopen`, `reset`, `copyTo(dir)`. A numbered `format` stamp like an EARS environment's, and a `kind` stamp
  beside it that tells the two apart (each refuses the other's files),
  `noSync`, one `transactionSync` per write (read-your-writes, no buffer). Time order from ids (time-sortable,
  monotonic tie-break), so index ranges come back in creation order. Generic: no SDK names (layer rule;
  host may not import `lmdb`).
- **SDK contract `services.runHistory`** (`apack-sdk/src/services/run-history.ts`), replacing `traceStore`:
  `add(node)`, `update(id, patch)` (no-op on a missing id), `get(id)`, `findChildren(id, { limit, before })`,
  `tree(id)`, `findRuns({ flowId?, limit?, before? })`, `stopActive()`, `prune({ before })`. `add`/`update`
  make values storable (`truncateResult` on `result`, `nodeAttributes`, `resolvedParams`); `add` with a missing
  parent is dropped and logged.
- **`TNode` is a record type, not an entity** (renamed from `TNodeEntity`; `TNodeId` type; `RunStatus` =
  `active | completed | failed | stopped`, dropping the never-written `paused`). Relations become fields:
  `parentId`, `rootId` (denormalised), `flowId` (the Flow this run walks), `nodeId` (the step/trigger/subflow
  node it ran). `result` is a field. `_parentFlowTNodeId`, `blueprint` and `instance_of`/`tracked`/`spawned`
  links go; the parent flow is derived by walking `parentId` to the nearest flow node.
- **Host** (`apack-host/src/services/run-history.ts`): the store at `<appDir>/run-history`, indexes `parentId`,
  `rootId`, `status`, plus a flow-run index for `findRuns`; on open/reopen `stopActive()` then prune runs whose
  root is not active and ended (`completedAt ?? startedAt`) before `RUN_HISTORY_RETENTION_MS` (30 days).
- **Brain:** writes via `runHistory`; a generated session root id held in brain context (no fixed
  `'TNode-Root'`, no `root_trace_node` role); `clearVolatileData` deleted; kill, restart and pack `onShutdown`
  call `stopActive()`.
- **Engine:** one environment — no partitions, router, `includeVolatile`, `unload` or `destroyed` sink arg.
  Primary env path and format unchanged: no conversion of user data.

## Commits

**C1 `feat(ears/lmdb)`: a format-stamped record store.** `packages/apack-ears/src/lmdb/record-store.ts` (reuse
the format-stamp helpers in `lmdb/envs.ts`), `lmdb/index.ts`. Specs `tests/lmdb/record-store.spec.ts`: put/get/
delete; index maintained when a field changes; same-millisecond ids keep creation order; reverse/before/limit;
an EARS env refused by its stamp; reopen/reset/copyTo; reader-slot leak (200 `findBy` with early `break`;
mutation: take the iterator by hand → `MDB_READERS_FULL`).

**C2 `feat(sdk,host)`: `services.runHistory`, beside `traceStore`.** SDK: `services/run-history.ts`,
`services/index.ts`, `runtime/host-runtime.ts`, `framework/service-consumption.ts` (`_HOST_SERVICE_NAMES`),
`apack.schema.json` (`schema:update`), `utils/paths.ts` (`runHistory: 'run-history'`), `testing/host.ts`
(`memoryRunHistory`, exported `testRunHistory()` like `testRootEvents`, replaced by `resetTestData`). Host:
`services/run-history.ts`, `services/index.ts`, `tests/boundaries.spec.ts` (`HOST_SERVICE_KEYS`). API:
`runtime/index.ts` opens it, `transport/websocket.ts` shutdown closes it. Spec
`apack-host/tests/services/run-history.spec.ts` — **one case table run against the host store and
`memoryRunHistory`** (keeps the double honest): tree has no duplicate descendants (firing case: event→s1→s2→s3,
which today's `getDescendants` duplicates); creation-order children; `findRuns` filters; open marks `active`
→ `stopped`; orphan `add` dropped; a BigInt result stored.

**C3 `refactor(brain)`: runs written and read through `runHistory`** (one commit: brain and harness must switch
together). default-setup: `apack.json` (`consumes.services` `host/runHistory`), `features/brain/be/repository/index.ts`
(add/update; pass flow/node ids instead of scanning every flow at `:339-350,417-428`; hierarchy from `parentId`),
`brain/be/system.ts` (`rootRunId` assigned where `createFlowNodeSystem` is called; `stopActive`),
`brain/be/flow-system.ts:221-231`, `features/hooks.ts` (`onShutdown` → `stopActive`), `brain/fe/canvas.vue`
(`canGoBack` = `flowHierarchy.length > 1`), `brain/fe/components/StepNodeDetails.vue` (`result`, `stopped`),
every step runtime's handler type. SDK: `logger/report-error.ts` → `runHistory.update`; delete
`repositories/tnode-repository.ts`; `steps/types.ts` (handler, `TrackTree`, `TNodeId` in `ExecutionContext`/
`StepRuntimeError`/trigger context). Testing: `apack-testing/src/app.ts` (read `testRunHistory()`,
`FlowStepTrace.result`, labels from `flowId`, no fixed root, no `tNodeRows` fallback). UI: `TNodeListItem`
(`stopped` style). `tests/packs/external-pack/src/extensions/steps/stamp/runtime.ts`. Code-fence docs:
`docs/public-facing/testing.md`, `content.md` (`$.lastStep.id` no longer an entity). Specs: brain repository,
`flow-children`, `flow-runs`, `subflow-fire`, `trigger-dedupe`, step specs (`nodeAttributes.result` → `result`),
sdk `report-error`, `repositories`. New: restart starts a new root and stops the old one's active nodes; kill
stops active nodes; go-back climbs through a subflow with no stored parent pointer.

**C4 `fix(database)`: the trace viewer reads `runHistory`.** `database/be/repository/trace-query.ts` (thin:
`findRuns`/`tree`/`findChildren`; `getDescendants` deleted), `be/types.ts`, `be/system.ts`, `fe/state.ts` (drop the
root-first sort at `:337`), `fe/contract.ts`, `fe/components/trace/*`. Spec: no duplicate descendants through the
viewer; events paged through `findChildren`.

**C5 `refactor(sdk)`: TNode is no longer an entity.** `types/sdk-entities.ts` (remove TNode from `SDK_ENTITIES`,
`SDK_SHAPED_ENTITIES`, `SDK_ROW_RULES`, `SdkEntityShapes`; delete `SDK_EXCLUDED_ENTITY_TYPES`; remove
`SPAWNED`, `TRACKED`), `types/index.ts`, `src/index.ts`; delete `services/trace-store.ts`, `memoryTraceStore`, host
`services/trace-store.ts`; default-setup `apack.json` drops `root_trace_node`; regenerate default-setup and fixture
packs' `__generated__`; `apack-cli/tests/_support/facade-packs.ts`; `TYPED-EARS.md` (follow its checklist).
Specs: `entity-shape-registry`, `generate-entries/shapes` (SDK-owned TNode case), host `partition-policy` TNode
cases. Confirm the codegen snapshot-format case needs no `PACK_SNAPSHOT_FORMAT` bump (never edit it).

**C6 `refactor(ears)`: one environment.** Delete `persistence/policy.ts`, `persistence/sharded-router.ts`;
`lmdb/{store,envs,hydrate,index}.ts` take one `path` (`read()`, `copyTo(dir)`, `hydrate()`); `attribute-storage.ts`
and `write.ts` lose `unload` and the `destroyed` sink argument; `runtime.ts` (change-controlled), `index.ts`.
Host `database/{open,layout,settings}.ts` (require only `ears-db`). API `runtime/index.ts`. SDK `utils/paths.ts`
(drop `volatileLmdb`). CLI `commands/db/target.ts` (drop `--volatile`). `scripts/ears-convert.ts`. Specs: delete the
router and cross-partition cases (`ears/tests/lmdb/persistence.spec.ts`, `store.spec.ts` history cases,
host `partition-policy.spec.ts`), update `engine/persistence`, `transact`, `vocabulary` (the `unload` exception
fails as stale — remove it), host `open-app-database`, api `app-database-parity`, `restart-persistence`,
`bound-runtime`, CLI `db.integration`. Ears bench within +10%.

**C7 `feat(backup)`: run history as its own backup store.** Host `backup/index.ts` (a list of stores, each
`{ path, copyTo, close, reopen }`; per-store format in metadata), `services/app-data.ts` (reset and import cover
both; the `includeVolatile` reload goes). SDK `services/app-data.ts` (`'lmdb' | 'runHistory'`). CLI
`db/backup.ts`, `db/destructive.ts`. default-setup `BackupRestore.vue`. Specs: host `backup/import*`, api
`host-data-services`, CLI `backup.spec`; new: import of a history holding `active` nodes leaves them `stopped`;
reset empties the history. Pre-change backups carry `volatileLmdb`, an unknown database (`--skip-unknown`): no
compat, documented.

**C8 `feat(host)`: retention.** `RUN_HISTORY_RETENTION_MS` (30 days) in host `services/run-history.ts`, pruned at
open. Specs: a whole old run (subflows included) goes; active roots and recent runs stay. Mutation: prune by node
`startedAt` instead of by root → the whole-run case fails.

**C9 `feat(cli)`: `apack db runs`.** `packages/apack-cli/src/commands/db/runs.ts` + command-tree entry: lists runs
(`findRuns`, newest first) and prints one run's tree as JSON (`--run <id>`), opening the data dir's history store
read-only. Spec in `tests/commands/db.integration.spec.ts`. `docs/public-facing/cli.md`.

**C10 `docs`.** `docs/plans/ears-persistence-and-history.md` (drop two environments and cross-partition
retention), `docs/goals/goal-lmdb-only.md` (trace decisions), `docs/plans/deferred/ears-memory-bound.md`;
`docs/public-facing/{architecture,services-and-data,cli,content,manifest,extensions,getting-started}.md`;
CLAUDE.md files of ears, sdk, host, api, testing, default-setup and the root guide (services list, persistence,
"the host keeps TNode out of persistence"). Write this plan as `docs/plans/run-history-store.md` in C1 and mark
it done here.

**After merge (operational, with your go-ahead):** delete `ears-trace` from your data dirs by hand.

## Rules per commit

`npm run packages:ensure` → `npm run typecheck` → `npm run spec` → `npm run build:default-setup` where pack code
moved → reports via `api:update`/`facade:update`/`schema:update`, reading every line → `content-parity:check`
(should not move) → out-of-graph suites the commit touches (`spec:full`, `test:external-pack:contract`, CLI
`db.integration`). Never edit while a chain runs. No compat shims; mutation-check each new rule on a backed-up
copy (restore with `cp`, never `git stash`).

## Verification

- Per commit: the checks above; the new specs' firing/mutation cases (duplicate descendants, whole-run prune,
  stale `active` on open, reader-slot leak, stale `unload` exception).
- End: `npm run chain -- --no-native` green with the tree untouched; `npm run bench -w @apackdev/ears` within +10%.
- In the app: `npm run dev`, run a flow, check the Brain surface shows the live run, kill the brain (nodes go
  `stopped`), restart (new root), and the Database trace viewer lists past runs without duplicated children;
  `apack db runs --profile <name>` lists them.

## Outcome

Nine commits on `run-history-store`, which holds C1 and C2 picked off `ears-engine-overhaul`:

| Step | Commit | Where it departed from the plan |
|---|---|---|
| C1 record store | `d3e3625f0e` | Its format is a number with a `kind` stamp beside it, so it and an EARS environment each refuse the other's files |
| C2 `services.runHistory` | `0db8f8846f` | — |
| C3 + C4 brain, steps, viewer | `e471092b7a` | C4 (the Database viewer) landed with C3: the viewer read the trace store C3 stopped writing. A value is bounded once, when written, and a step is handed the node as built, not the stored copy |
| C5 TNode not an entity | `2deba4e475` | — |
| C6 one environment | `96bf0e71a1` | A backup held `lmdb` only between C6 and C7. Ears bench within +10% of the commit before on every case |
| C7 backups | `a457bd5269` | — |
| C8 retention | `343729ea73` | A session the app stopped at open (a crash, a quit mid-run) ended then, and is kept 30 days from there |
| C9 `apack db runs` | `066aa4d6a2` | Plus `npm run db:runs` |
| C10 docs | `40a98e81f2` | `docs/goals/goal-lmdb-only.md` gets a note that its trace parts are superseded, rather than a rewrite |

### After the plan

A review of the result found the run history's API was still a record store's, with its meaning in its callers.
These followed on the same branch:

| Change | Commit |
|---|---|
| The packaged-authoring spec reads a step's `result` field (the chain caught it) | `f19ec39cd7` |
| One `RecordStore` interface in the ears root with an in-memory twin; indexes are functions, so `runOf` and `isRoot` are computed rather than stored; one format/kind stamp check for both environments | `e08d633f22` |
| A backup's stores are one table, each with its format and its check | `0869fc3f44` |
| The run history owns a node's lifecycle (`start`, `update`, `finish`); the brain's pass-through commands go | `a410ba3701` |
| A run's tree is one read by its root; a flow run's events are its tree's children; `trace-query.ts` goes | `4db4321d95` |
| `TNode` is `RunNode`, `tNodeType` is `kind` | `8e7f6cfe6b` |
| "Run", not "trace", for what a flow run leaves behind, in names, files, events and copy | `63706fa0c6` |
| **A step runs on its input whole** (`StepInput`), never on the run node's bounded copy: an llm step had been sending a cut-off prompt past 10 KB | `f1f6842a40` |
| `RunNode` is a union by kind, with one recorded `input` (flows, steps) or `payload` (events) in place of `nodeAttributes` and `resolvedParams` | `b922adc916` |
| `start` returns a run node as stored, nothing running on one any more | `4df7a5bf82` |
| `step-input.ts` and `execute-step.ts` (`executeStep`), named for what they hold | `0f09bde4a4`, `3468ab96a9` |

The `ears-trace` stores in the apack data dirs were deleted by hand on 2026-10-23, once no app held them. Older
`abuddy*` data dirs, from the app's previous name, still hold theirs.

