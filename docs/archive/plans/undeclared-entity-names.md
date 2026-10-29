# An undeclared name must not answer with the database

> Archive: this records earlier design and behavior. Examples use current EARS names; descriptions of former behavior are historical, not current guarantees.

Status: implemented, in the order Part 3 (`5c178411a`), Part 2 (`ef68c3f3f`), Part 1 (`644471264`). Parts 3
and 2 make the console answer correctly; Part 1 is the message naming the known types and `--schema-from`,
which the engine cannot write once [`ears-public-api.md`](ears-public-api.md) makes it refuse `undefined`
itself. The numbers in
here were measured on a real production data dir on 2026-10-01, not estimated.

Session: `a2585c25-7f98-46bf-ad7f-4120dc9a6f60` — where the measurements were taken and the rejected
approaches were tested, if the reasoning below needs its working shown.

> **The tree moved under this on 2026-10-17, and three claims below have lost their subject.** Paths, line
> numbers and the manifest filename are corrected; these four are not, because what replaces them is a design
> decision rather than a citation:
>
> - **`builtIn: true` is gone from source.** `goal-one-kind-of-pack` retired the distinction, so the Context's
>   "the only `builtIn: true` manifest in the tree" argues from a field that no longer exists. The conclusion
>   it supports — a second built-in pack is not a constraint — may now be moot rather than true.
> - **The `host-packs` row in Part 3 names a directory and a writer that are both gone**, along with
>   `publishHostPackOutput`. Part 3 generalises over "three shapes in the wild"; on this tree there are two.
> - **`builtInManifests` is `installedManifests`** (same line), and `InstalledSchema` carries `packs` rather
>   than a `builtIn` array, so "`builtIn` is already typed as an array and folded over" names nothing. The
>   point it makes — N manifests need no further change — is worth re-establishing against `packs`.
>
> What still holds: `consoleEars`, `consoleScope`, `namedManifest`, `discoverPacks`, `readBackup`,
> `getAllEntityTypes`, `resolveStart`'s id fall-through, and the measured numbers, which were taken from data
> rather than from code.

## Context

This started as a smaller observation — "`--schema-from` isn't repeatable, one snapshot, one pack" — and
investigating it says that is the wrong thing to fix, and that something worse is already shipped.

**The repeatability gap is about packs that do not exist.** `default-setup` is the only `builtIn: true`
manifest in the tree, and this repo deliberately *notes* where to look when a second arrives
([`goal-pack-apply-order-and-retry.md:117-119`](../../archive/goals/goal-pack-apply-order-and-retry.md), and
`resolveFromRemoteRegistry` for third-party packs) rather than designing for it. A plan that treats a
hypothetical second built-in pack as a constraint should say so out loud so the claim can be checked; this
one says it is not a constraint.

**What is real is that an undeclared entity name returns the whole database.** `consoleEars`
(`apack-sdk/src/database-console/index.ts:95`) builds the console's `EARS` namespace by spreading plain
objects, so a name nobody declared reads `undefined` — and `query(undefined)` means "every entity", which is a
declared, documented feature (`apack-ears/src/query.ts:287`), used by eight callers and by the console's own
shipped examples. Measured against a data dir with its `host-packs/` removed:

| | result |
|---|---|
| `query(EARS.Entity.Note).pickAll().length`, as the app wrote the dir | `2` |
| the same, with no pack snapshots to declare `Note` | **`607`** — every row in the database |
| the same, with `--schema-from` naming a snapshot | `2` |

A wrong answer, not an error. Three things make it worse than it first looks:

- **It is not just the CLI.** The same namespace reaches `db query/exec/repl/script`, default-setup's
  Database surface, and the **LLM `query` step** (`default-setup/src/extensions/steps/query/runtime.ts:65`),
  which inspects the result only for `"<name> is not defined"` and so records 607 rows as a success.
- **One click produces it.** The Database surface's Schema panel lists entity types from the *data*
  (`getAllEntityTypes`), and selecting one generates `query(EARS.Entity.<thatName>)`
  (`default-setup/src/features/database/fe/constants.ts:19`). Any type present on disk that no registered
  pack declares is one click from a whole-database query.
- **the former query shorthand is not where this plan fixes it.** `query('Note')` with `Note` undeclared returns `[]` — harmless,
  because `resolveStart` falls through to the id branch (`query.ts:66-68`). Only `undefined` returns
  everything. There are two defects behind that: the namespace hands back `undefined`, which this plan
  removes, and the engine accepts it, which
  [`ears-public-api.md`](ears-public-api.md#2-one-argument-one-meaning) removes by splitting the
  no-argument form into `query.all()`. They are complementary — the namespace is where a usable message can be
  written, the engine is the backstop — and this plan lands first (see
  [Deliberately not doing](#deliberately-not-doing)).

**Why observation cannot replace declaration.** The appealing idea is that the data describes itself: after
hydrating, the entity types present are derivable from id prefixes, so no schema need be supplied at all.
That is right for entity *names* and unsound as a replacement, on three counts:

1. **Relation-kind aliases are unrecoverable.** `EARS.RelKind.PARENT_OF` is `'parent_of'`; the data holds
   only the value. No amount of observation produces the alias.
2. **An observed set can never hold a type with zero rows**, and `create(type)` on a name the engine does not
   know writes a row literally named after the type (`transaction.ts:28-38`) — so the first entity of any
   type could never be created. That is the corruption the write refusal already blocks, not a degradation.
3. **Observation launders corruption into declaration.** `getAllEntityTypes` is prefix-derived
   (`attribute-storage.ts:16`), so a junk row named `Note` — exactly what the bug in (2) produces — comes
   back as the entity type `Note`.

So observation **widens a read**; it never replaces a declaration. That is the shape below.

**Outcome:** a name the database cannot account for is an error rather than a number; a legacy data dir is
readable without anyone naming a snapshot; and `--schema-from` names a *place* rather than a list, which
retires the repeatability question without building for a pack that does not exist.

## Part 1 — `EARS` refuses a name it cannot account for

`consoleEars` returns `Entity` and `RelKind` as `Proxy` objects that throw on an unknown property, naming
what is known and how to supply the rest:

```
Error: "Note" is not an entity type this database can account for.
  Known: AppState, Settings, Flow, Node, TNode, Action, Prompt
  This data dir publishes no pack snapshots — name one with --schema-from to read its types.
```

The traps have to pass through what legitimate code does with the object. There is exactly one consumer that
receives the namespace itself rather than as a `new Function` parameter — `db script`
(`apack-cli/src/commands/db/script.ts:129`, `DbScriptContext.EARS`) — so `ownKeys` and
`getOwnPropertyDescriptor` are required for a script that enumerates or spreads it, and symbols plus
`then`/`toJSON`/`inspect` must read as absent rather than throw.

Nothing else in `src` enumerates it, which is what makes this safe: the Schema panel reads live engine data
(`default-setup/src/features/database/be/repository/schema.ts:9`), and Monaco's types come from
`default-setup/src/defs/database.ts`, not from the runtime value.

**This part lands first**, because it is what makes part 2 safe.

## Part 2 — observed names widen the console, not the schema

`InstalledSchema` keeps meaning **declared**. The merge happens in `consoleScope`
(`apack-cli/src/commands/db/target.ts:152`), which already holds the open database:

```ts
const observed = Object.fromEntries(db.query.getAllEntityTypes().map((t) => [t, t]));
return { EARS: consoleEars({ entities: { ...observed, ...db.schema.entities }, relKinds: db.schema.relKinds }) };
```

Declared wins on a collision, so a pack's name keeps its declared value. `db.query.getAllEntityTypes()` and
`getAllRelationKinds()` are already on the face `openAppDatabase` installs — no engine change, no new
capability, and nothing in the open sequence has to move (`isEntityType` is a live closure re-consulted per
call, `apack-host/src/database/open.ts:42`).

**`relKinds` is deliberately not widened**, because an alias cannot be observed. On a dir with no snapshots
`EARS.RelKind.PARENT_OF` therefore throws with the message above, which is the honest answer and points at
the flag.

**`getRegisteredEntityTypes` stays declared too.** It is tempting to add observed types, but
`readBackup(dir, known)` uses it as the yardstick for `unknownEntityTypes`
(`apack-cli/src/commands/db/destructive.ts:204`), and an observed yardstick would report a backup's only
`Bookmark` rows as "no installed pack declares this" while the pack is installed. Four of its six consumers
already filter to types with rows, so they are unaffected either way.

## Part 3 — `--schema-from` names a place

`namedManifest` (`apack-host/src/database/schema.ts:96`) resolves one pack. It gains a directory-of-packs
case, which is what retires the repeatability gap: you name the app or the checkout, not each pack.

The three shapes in the wild each supply a different file, so the walk probes in order per entry —
`<id>/types/snapshot.json`, `<id>/dist/snapshot.json`, `<id>/apack.json`:

| directory | has | written by |
|---|---|---|
| `<data dir>/abuddy/host-packs/` | `types/snapshot.json` only, **no `apack.json`** | `publishHostPackOutput` |
| a repo's `packages/` | both | the checkout |
| a packaged app's `Resources/app/packages/` | both | `electron-builder.mjs:122` ships them |

`installedManifests` (`schema.ts:68`) already walks the first; `discoverPacks`
(`apack-host/src/packs/discovery.ts:54`) already walks the others and returns the manifest. Neither covers
all three, so the walk is a small generalisation of `builtInManifests` taking a directory and the three
candidates. `builtIn` is already typed as an array and folded over (`schema.ts:152,170,174`), so N manifests
need no further change.

Also report what is observed against what is declared, in the shape `readBackup` already uses (declared ∩
observed, declared-only, observed-only, with counts from `getSchemaStats`). "These types are present with
these counts, and nothing declares them" is more use than today's one-paragraph `degraded` warning.

## Files

- `packages/apack-sdk/src/database-console/index.ts` — the two Proxies and the message
- `packages/apack-cli/src/commands/db/target.ts` — merge observed names in `consoleScope`; report the split
- `packages/apack-host/src/database/schema.ts` — `namedManifest` takes a directory of packs
- `packages/apack-sdk/tests/database-console/database-console.spec.ts` — the firing cases below
- `packages/apack-cli/tests/commands/db.integration.spec.ts` — end to end on a dir with no snapshots
- `packages/apack-sdk/CLAUDE.md` (the `database-console/` entry), `packages/apack-cli/CLAUDE.md` (the `db` row)
- `npm run api:update` if the console's exported types move

## Verification

1. **The firing case, which does not exist today.** `database-console.spec.ts:111` already creates `Note-1`
   while deliberately *not* registering `Note`, and `:117` carries a comment stating the bug as though it
   were behaviour — *"A name the console doesn't know reads as undefined, which queries everything"*. Nothing
   asserts it. Assert that it throws, and delete that comment. Reverting the Proxy must fail the test.
2. **The 607, end to end.** On a copy of a data dir with `host-packs/` removed,
   `query(EARS.Entity.Note).pickAll().length` must error naming `--schema-from` rather than answering `607`;
   with `--schema-from` it answers `2`.
3. **Observed widening.** The same dir without the flag: `EARS.Entity.Note` resolves, because `Note` rows
   exist, while `EARS.RelKind.PARENT_OF` throws, because an alias cannot be observed.
4. **`db script` still works** on the raw object: a script doing `Object.keys(EARS.Entity)`,
   `{ ...EARS.Entity }` and `JSON.stringify(EARS)` must not throw. It is the one consumer that holds it.
5. **A directory of packs**: `--schema-from <a packaged app>/Contents/Resources/app/packages` and
   `--schema-from <repo>/packages` both resolve default-setup; `--schema-from <data dir>/abuddy/host-packs`
   resolves it from the snapshot alone, with no `apack.json` present.
6. `npm run spec` while working; `npm run chain` at the end.

## Deliberately not doing

- **Not making `--schema-from` repeatable.** A directory covers N packs with one flag, and the case
  repeatability was for — a second built-in pack — does not exist. `multiple: true` has precedent one file
  away (`apack-cli/src/commands/db/export.ts:9`) if that changes.
- **Not making the former query shorthand reject `undefined` _here_.** `query.all()` with no start is a declared overload, documented,
  and used by eight callers and by the console's shipped examples, so retiring it is a public-API change
  with its own call-site migration. [`ears-public-api.md`](ears-public-api.md#2-one-argument-one-meaning)
  owns it, splitting the no-argument form into `query.all()` so that `query(undefined)` is an unregistered type
  and throws. Nothing about the former query shorthand prevents that: `setIds` re-enters with `start === undefined` on every
  chained step (`query.ts:74-75`), but it re-enters the internal `qxImpl` with `known` already resolved,
  and the public the former query shorthand is a one-argument wrapper over it (`query.ts:276`), so the chained path never reaches
  the public entry. What decides the layer is sequencing, not capability — this plan fixes a wrong answer
  that ships today, in two files; that one rewrites every the former query shorthand/the former write shorthand call site in 59 files behind four
  phases.
- **Not swapping `getRegisteredEntityTypes` or `readBackup`'s yardstick to observed** — the regression is
  concrete and named in part 2.

## Two adjacent bugs, recorded here rather than fixed

Same family, each deserving its own change:

- **`TypedQx` accepts `undefined` as a start by design** (`apack-ears/src/typed.ts:32-33`, "Starts that may
  be undefined at the call site"), so typed pack code can reach the whole database with no compile error.
  That is a wider surface than the console and the namespace fix does not touch it.
  [`ears-public-api.md`](ears-public-api.md#2-one-argument-one-meaning) closes it as a consequence of the
  same split, so it needs no change of its own.
- **Monaco types `EARS` as the SDK-only namespace** (`default-setup/dist/defs/monaco/database-defs.d.ts`,
  members Relation/Flow/Node/TNode/Action/Prompt) while the runtime object carries all 17. So the editor
  flags `EARS.Entity.Thread` — the shipped default example (`features/database/fe/constants.ts:3`) — as
  missing, and fails to flag a name that really is undeclared. The type surface and the runtime value
  disagree in both directions.
