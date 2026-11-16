# A name carries the operation; structure carries the rest

> Archive: this records earlier design and behavior. Examples use current EARS names; descriptions of former behavior are historical, not current guarantees.

**Status:** done: phases 0 (the rule, in `packages/apack-ears/CLAUDE.md`), 1 (no ambient engine: the binding and the operations over it are `@apackdev/sdk/ears`), 2 (the engine is `Ears` with `admin` beside it), 3 (the former query shorthand is `query`, kept as the console's injected name) and 4 (`store.read(partition)` → `LmdbReader`, `db.ears`, `findEntities*`; `packages/apack-host/tests/query-vocabulary.spec.ts` holds `query` to the operation). **The chain is green at each phase**, `npm run chain -- --no-native` on a 10-core budget, 2026-10-22: phase 1 before `dd64090d0`, 2 before `be15e554f`, 3 before `4e9fecf98` (phase 0 is prose no step reads), and phase 4 at `e9649ec60` once the disk had room — while it was full, `test:integration` failed with ENOSPC at the default width and passed at `--cores 2`. It lands after [`ears-public-api.md`](ears-public-api.md), whose change 4
it **supersedes** on one point (see [What this supersedes](#what-this-supersedes)).
Source read at `886c11bd5` (2026-10-22). Call-site figures are text searches over `packages` for
`*.ts`/`*.vue`, excluding `dist/`, `publish/` and `__generated__/`; each is an upper bound on the work and
the typecheck is the exact count once a name moves.
**Scope:** what the engine's operations are *called* and where each fact about them is carried. What they
*do* is [`ears-public-api.md`](ears-public-api.md)'s subject, and this changes none of it.

Session: `a2585c25-7f98-46bf-ad7f-4120dc9a6f60` — where the counts were taken.

## Why

The API reads as though it were named by four different rules, because it was. Four independent facts about
an operation got welded into names, one at a time, and every weld was locally reasonable:

| axis | what it says | carried today by |
|---|---|---|
| **capability** | who may do this — anyone, or the engine's creator | the face: `engine.query` vs `engine.admin` |
| **operation** | read or write | the former query shorthand vs `create`/`upsert`/`write` |
| **checkedness** | checked against a pack's shapes, or not | the `untyped` prefix |
| **binding** | which engine — one you hold, or the ambient installed one | nothing names it |

Three of those do not belong in a name. The one that is not named at all — binding — is what makes the
surface sprawl: an operation needs an `untyped` twin for no reason except to mean *on the ambient engine*,
which is 92 `untypedQuery` sites, 168 `untyped{Create,Upsert,Write}` and 133 `installedEngine()`.

**The sharpest symptom is that "query" names three things, none of which is a query.**

| what | where | sites |
|---|---|---|
| the engine's pack-facing face | `engine.query`, `EarsQuery` | 374, with 37 naming the type |
| the LMDB partition reader | `store.query(partition)`, `LmdbQuery` | 26 |
| a data dir's open engine | `db.ears` (`AppDatabase`) | 28 |
| four lookups that are `find`s | `findEntitiesByAttribute`, `…ByRole`, `…InRelationTo`, `…ByRelationTo` | 39 |

Meanwhile the operation that *is* a query is the former query shorthand: 476 sites in 68 files. The word is spent three times on
things that are not queries and never on the thing that is.

This matters beyond taste for the reason that plan opens with — EARS is the most reusable thing in the tree,
and the part a newcomer cannot use without reading the source. A two-letter name beside `create`, `write`
and `transact` is that problem in one line.

## The design

**One rule: a name carries the operation. Structure carries everything else.** Each axis below says where it
goes and why a name is the wrong place for it.

### Binding is carried by who you ask

`engine.create(...)` says it: you hold the engine. Nothing further is needed, and no free function means no
twin per operation. This is [`ears-public-api.md`](ears-public-api.md#4-the-package-holds-no-ambient-engine)'s
change 4 unchanged, and it is the whole of this plan's leverage — it removes about four hundred call sites
from the question before a single name is reconsidered.

### Capability is carried by one sub-object, not two peer faces

**The face called `query` has no good name because it is not a category — it is the engine.** It holds reads,
writes, transactions, the finders, graph walks and the repository registry; the only thing it excludes is the
creator's privileges. A set defined by what it excludes gets its name from the exclusion, so the engine's
members become the operations and `admin` sits beside them:

```ts
engine.query(type)        engine.create(type)   engine.write(id)   engine.transact(fn)
engine.admin.clear()      engine.admin.bulkLoadAttr(...)
```

`EarsQuery` becomes `Ears`: the operations a program is handed (`HostRuntime.ears`, `runtime.ears.query(…)`),
with `EarsEngine` staying the creator's object, `Ears` plus `admin`.

**What this gives up, deliberately.** Today `engine.query` is a separate object that genuinely lacks `admin`,
and after this the type excludes it while the value carries it, so a cast reaches it. That is acceptable
because this repo already says so: *"The trust model: packs run in-process. The faces define the contract,
not a security boundary"* (`packages/apack-ears/CLAUDE.md`). A contract the compiler enforces is what was
being bought; the runtime nicety was never load-bearing, and a pack that casts past the type has a dozen
easier ways in.

**And it is what frees the word `query`** for the operation, which no rename of the former query shorthand can do while the face
holds it.

### Checkedness stays a prefix

It is the one axis a call site cannot otherwise show: whether the compiler checked this name against a
pack's shapes is invisible in `create('Memo')`. The root `CLAUDE.md`'s rule already states it
(*"One name per concern, `untyped` for the unchecked half"*), and after the binding axis moves it applies in
exactly one place — the SDK's pack-facing surface — instead of shadowing every engine member.

### Terseness is carried by the console's scope

> **Superseded (2026-10-22):** the console takes `query` too. Keeping the former query shorthand there saved three characters and cost
> a second name for one operation, an alias (the retired console alias) to keep it alive, and console code that read
> unlike pack code — while everything around it (`apack db query`, the `query` step, `runQueryCode`) already
> said `query`. The console's injected names are the library's now, and `query-vocabulary.spec.ts` checks
> `READ_HELPER_NAMES` so the exception can't return. What follows is the reasoning as it was.

The former query shorthand is short for a real reason: people type it by hand in `db repl`, `db query` and the Database surface.
That is a genuine requirement and it should not name the library. The console already injects a deliberate,
enumerated vocabulary (`readHelpers`/`READ_HELPER_NAMES`, `apack-sdk/src/database-console/index.ts:46`), so
The former query shorthand lives on there as the console's name for `query`, which is what an injected vocabulary is for. Terse
where it is typed, explicit where it is read.

That split is also why renaming the API is affordable at all: the one population that benefits from two
characters keeps them.

## Phases

Each is one commit and leaves the chain green. The order is not preference — **each step strictly shrinks the
next**, and any other order touches the same lines twice.

| phase | what | sites | why here |
|---|---|---|---|
| 0 | The rule above, in `packages/apack-ears/CLAUDE.md` | — | It is the deliverable the renames only follow from, and it makes the rest reviewable |
| 1 | No ambient engine (that plan's change 4) | 92 + 168 + 133 | It **deletes** the names the later phases would otherwise rename. Anything before it renames functions into existence and then removes them |
| 2 | Flatten the face: `engine.query.X` → `engine.X`; `EarsQuery` → `Ears` | 374 + 37 | Frees `query`. Before phase 1 it would touch every free function's body twice |
| 3 | the former query shorthand → `query`, with the former query shorthand kept as the console's injected name | 476 in 68 files | Mechanical, and the typecheck names every site |
| 4 | Every other "query": `store.query(partition)` → `store.read(partition)` and `LmdbQuery` → `LmdbReader`; `db.ears` → `db.ears` (beside its `db.admin`); `queryEntities*` → `findEntities*` | 26 + 28 + 39 | Last, so that when it lands the word means one thing |

Phase 1 is the leverage and it is already planned and owned. Phases 2–4 are worth nothing until it lands.

**Phase 4's targets are the repo's own rules applied, not inventions.** `read` reads disk (root
`CLAUDE.md`, Naming), and `LmdbQuery` is exactly that — the partition read straight from the files without
hydrating — so it is `store.read(partition)` returning an `LmdbReader`. `AppDatabase` holds a field per thing
it owns, and after phase 2 that field holds `Ears`, so it is `db.ears` beside the `db.admin` already there.
And `find` is reserved for *"searches and domain queries"*, which is what the four `queryEntities*` lookups
are: they become `findEntities*` and join the family they belonged to all along.

**What the `untyped` prefix is attached to afterwards**, since it is the pack-facing surface and a pack's
code names it: `untypedQuery`, `untypedCreate`, `untypedUpsert`, `untypedWrite`. Phase 3 renames
`untypedQuery` with the former query shorthand; the other three keep their names throughout.

## Verification

Renames are proved by the typecheck, so the cases worth writing are the ones a rename cannot prove:

1. **Phase 2:** `Ears` does not admit `admin` — a spec that fails to compile if it does, which is an
   assertion with a comment naming the edit that would make it fire, per the repo's rule for a check that
   cannot fail today.
2. **Phase 3:** the console still answers `query(...)`, and `READ_HELPER_NAMES` still lists it. The console
   vocabulary is spelled out precisely so that moving a name through it is deliberate.
3. **Phase 3:** a pack's `#generated/ears` exports `query`. Codegen writes that export list literally
   (`apack-sdk/src/build/generate-entries.ts:1240`, `query, create, upsert, write, transact, findById, …`), so
   the name is in the generated facade of every pack: `build:default-setup` regenerates, the type fixture
   moves (`apack-cli/tests/_support/facade-packs.ts`) and `facade:update -w @app/default-setup` re-records.
   This is the one place [`ears-public-api.md`](ears-public-api.md#7-everything-that-teaches-the-api-moves-with-it)'s
   inventory does not already cover, because renaming the former write shorthand left that line's other entries alone.
4. **Phase 4:** `query` names one thing. Asserted over the exported declarations of `@apackdev/ears`,
   `/sdk` and `@apackdev/host` rather than grepped, so it cannot look at nothing, and it fails today —
   four populations answer to the word (the table in [Why](#why)), which is what makes the case worth
   having rather than a gate that cannot fire.
5. `npm run spec` while working, `npm run chain` per phase. Phase 3 moves a public export of
   `@apackdev/ears` and `@apackdev/sdk`, so it runs `api:update` and `facade:update -w @app/default-setup`
   and the diff is read. **`api:update` writes CRLF where the committed reports are LF** (measured
   2026-10-22 on `etc/database-console.api.md`: a two-line change arrived as 55 insertions), so normalise
   the file before reading the diff or the real change is invisible in it.

**What teaches the API moves in the same commit**, and that inventory is already written:
[`ears-public-api.md`](ears-public-api.md#7-everything-that-teaches-the-api-moves-with-it) lists the console
globals, the query step's refusal list, the in-app prompts and examples whose compiled hashes move with
them, the CLI's help text and the public docs. Phase 3 is a second pass over that same list rather than a
new one; nothing here restates it.

## What makes it stick

**The four axes written down are the deliverable; the renames are what follows from them.** Without the rule,
a fifth fact gets welded into a name next quarter and this is rewritten. It goes in
`packages/apack-ears/CLAUDE.md` in imperative form with one citation, which is this repo's stated rule for
where a lesson lives.

A gate is available and should wait: `check:specifiers` already enforces the `_` host-only prefix by name,
and could refuse a new `untyped*` **free** export. It is worth adding only after phase 1, because until then
it has no firing case — and a check that cannot fail is a gate or an assertion, not a check.

## What this supersedes

[`ears-public-api.md`](ears-public-api.md#4-the-package-holds-no-ambient-engine)'s change 4 reads
*"everything that reads or writes data is a member of `engine.query` or `engine.admin`."* **There is no
`engine.query`.** Phase 2 replaces that clause: the operations are the engine's own members, with `admin`
beside them. The same direction one level further, and it is named here rather than absorbed quietly only so
that whoever reads that plan afterwards knows which of the two is current.

Keeping the two faces is what this plan exists to rule out, because it leaves `query` spent on a set that is
not a category and the operation that is a query still called the former query shorthand.

## Deliberately not doing

- **Not renaming anything for symmetry.** the former write shorthand was retired because it promised atomicity it did not have and
  one argument meant three things; the former query shorthand has neither defect since it refuses an unregistered type and `.ids`
  and `.all` carry the other meanings. The case for phase 3 is that the word is free and the current name is
  opaque, which is a different argument, and the weaker one is the reason that plan orders its changes by
  damage rather than by consistency.
- **Not touching the `find*` family.** The root `CLAUDE.md` reserves `find` for *"searches and domain
  queries"*, which reads like a collision with `query` and is not one: `find*` are terminal readers that hand
  back entities, and `query(type)` returns a chainable builder. A builder beside finder shorthands is the
  ordinary shape for this, and naming them alike would lose the distinction that one of them is the
  mechanism.
- **Not giving the API a terse alias.** Two names for one operation is the thing this plan is against, and
  the console scope already covers the population that wants the short one.
- **Not reopening `admin`.** It names its axis correctly and nothing here improves it.
