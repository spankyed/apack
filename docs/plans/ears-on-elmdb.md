# EARS on elmdb

Status: planned, 2026-10-24. Not started.

EARS's engine moves out of JavaScript into elmdb, an embedded graph database written in Rust on LMDB, in its own
repository (`elmdb`, checked out beside this one; design in its `docs/`). `@apackdev/ears` stays in apack and keeps
its API: it becomes the typed facade and the builders that compile to elmdb's plans and batches. Packs, the SDK and
the typed facades don't change. apack drops lmdb-js.

## Why

- **lmdb-js is a fork of LMDB, not a binding to it.** Its vendored `mdb.c` carries about 3,000 lines stock LMDB
  doesn't, and a crash in them is why compaction is off (`COMPACT_COPIES`,
  `docs/references/evidence/lmdb-compacted-copy-crash.md`). elmdb runs on heed's LMDB: upstream plus one reported
  patch.
- **Search needs indexes that commit with the data.** apack's draft message search (#148, MiniSearch) rebuilds in
  memory on every boot, and the dormant library index (usearch) keeps files beside the database that backups copy on
  their own. In elmdb, text and vector indexes are kinds of index on a field.
- **Live queries need change sets,** which an engine that applies a whole batch knows without extra work.
- **The engine's cost is crossings.** A create makes 18 reads and 12 writes through the seam, and a long scan is mostly
  per-entry crossings and key decoding. A plan or a batch crosses once.

## The boundary

elmdb's public API is its protocol: schemas, plans, batches, results, change sets and error codes, as data, with
TypeScript types generated from its Rust ones. The fluent API stays here, where it changes with apack's vocabulary.

**Stays in `@apackdev/ears`** (about 1,100 of today's 4,300 lines in `src/`):

| Module | Becomes |
|---|---|
| `entities.ts`, `runtime.ts`, `typed.ts` | unchanged: the typed contract (`TYPED-EARS.md` still governs them) |
| `query.ts`, `write.ts` | the builders, compiling to a plan and a batch; a step holding a caller's function ends the plan, and the builder runs the rest |
| `engine.ts`, `index.ts` | `createEarsEngine` over an elmdb `Database`, with the same faces (`Ears`, `admin`) |
| `errors.ts` | `EarsError`, carrying elmdb's codes |
| `lmdb/` | `openDatabase`, opening an elmdb database with the schema the registered packs declare |
| `tests/` | the black-box engine specs, the vocabulary rules, the model and crash harnesses, run against elmdb |

**Moves into elmdb** (about 2,400 lines): `kv.ts`, `store-access.ts`, `attribute-storage.ts`, `relations.ts`,
`journal.ts`, `numbering.ts`, `hierarchy.ts`, `names.ts`, `lmdb/store.ts`, `lmdb/kv-backend.ts`, `lmdb/stamp.ts`, and
the execution half of `query.ts` and `write.ts`.

**Goes away:** `records.ts` and `lmdb/record-store.ts` (the run history becomes entity types in a second database,
`runs`), `lmdb/convert.ts` (formats 1–3 retire with lmdb-js), `createMemoryKV` (tests open a database in a temporary
directory), `COMPACT_COPIES` (elmdb's copy compacts).

## What changes in apack

- **Composition.** `openAppStore()` (`packages/api/src/runtime/index.ts`) and `openDatabaseStore`
  (`@apackdev/host/database`) open elmdb's `main` and `runs` databases with the schema built from the registered
  packs' declarations, which codegen already writes as row rules (required fields, short-code prefixes, indexes).
- **Host services.** `appData` (reset, backup export and import, `@apackdev/host/backup`) uses elmdb's `reset`,
  `backup` and `replaceWith`; `runHistory` reads and writes the `runs` database through an engine instead of a
  `RecordStore`.
- **The SDK's test runtime.** `startTestRuntime` and `memory-run-history.ts` open temporary databases. Values a read
  hands out are the reader's own copies already, since the facade decodes them; the frozen values `freeze` gives today
  become the facade freezing on decode in tests.
- **Tooling.** `apack db` and the CLI's backup command open read-only through `openDatabase`; `scripts/ears-convert.ts`
  and `scripts/short-codes-convert.ts` retire with the formats they convert.
- **Guards.** `findLmdbImports` (`check:specifiers`) becomes a rule over `elmdb` imports: only `@apackdev/ears/lmdb`
  loads it.
- **Packaging.** The packaged app ships elmdb's prebuilt `.node` for each platform, as it ships `@napi-rs/keyring`.

## Steps

Each follows elmdb's roadmap (`elmdb/docs/roadmap.md`).

1. **The spike** (elmdb). Measures encoding a result and decoding it here against today on the converted production
   copy. Nothing changes in apack.
2. **Parity.** The builders compile to plans and batches, and `createEarsEngine` runs on elmdb.
   - The model harness drives today's JavaScript engine and elmdb with the same workloads, comparing each with the
     model and with each other; the crash harness runs against elmdb. Switch when they agree.
   - The last release on lmdb-js converts every database to format 4; elmdb's upgrade reads format 4.
   - Then lmdb-js, `convert.ts`, the memory backend and `COMPACT_COPIES` go.
3. **The `runs` database.** `RecordStore` and `openRecordStore` go; the run history's indexes become value indexes.
4. **Text search.** A pack declares `index: 'text'` on a field in `apack.json`; the query builder gains `search`.
   #148 is closed in favour of it.
5. **Change sets and watch.** Systems that broadcast a view's data after a write subscribe to a watched plan instead.
6. **Vector and hybrid search.** The library's search index (`library/be/search-index/`) moves onto `index: 'vector'`,
   and `fastembed`'s and `usearch`'s native modules are no longer needed for the index itself.

## Developing across two repositories

During parity the protocol is still taking shape, so a change often spans both repositories. apack develops against a
local elmdb checkout (`file:../elmdb/crates/elmdb-node`, built from source), and moves to a pinned elmdb release once
parity lands. The Linux test container builds the local checkout too, which needs a Rust toolchain in its image until
then.

## What this supersedes

- `docs/plans/ears-value-compression.md`: compression moves into elmdb's value format (`elmdb/docs/format.md`).
- kriszyp/lmdb-js#381 stops mattering to apack, though it is still worth landing upstream.
- `ears-compaction`'s `COMPACT_COPIES`: elmdb's backup is compacted.

## Open questions

- **Test speed.** Every engine spec opens a database in a temporary directory instead of using the memory backend.
  Measured at step 2; if it is too slow, elmdb gains an in-memory backend inside the engine, which keeps one
  implementation.
- **String order.** `orderBy` compares strings with `new Intl.Collator()`, which follows the system's locale. elmdb
  sorts with ICU's root collation. The two agree for most text; where they differ, pack-visible order changes once,
  at the switch.
- **A caller's function in a plan.** `where(fn)` and the other steps that take a function split a plan, and everything
  after them runs here. The builder warns past a size, as `UNINDEXED_WALK_WARNING` does.
