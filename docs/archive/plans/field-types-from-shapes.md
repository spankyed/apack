# Field types from shapes

Status: done, 2026-10-27, as Phase 5 of elmdb's `goal-elmdb-next.md` (Outcome, below).

A pack's shapes stay the one place a row's fields are described. Codegen already reads each shape with the TypeScript
checker to write its row rules (`rowRulesOf`, `packages/apack-sdk/src/build/module-exports.ts`); it goes on to read each
field's type, and the schema the host declares to elmdb carries it. elmdb then checks every write's values against the
shape, including the writes the compiler never sees.

## Why

- **The compiler checks only typed calls.** `apack db exec` and `repl`, a migration, a script, `untyped*` calls, a pack
  built without generated types and an action's untyped writes all write rows the compiler never checks. elmdb refuses a
  value its field's type doesn't take (`FIELD_TYPE`), on every write, from every writer — but only for a field the schema
  types, and apack types none: required fields go as `any`, and every other field is undeclared
  (`toElmdbSchema`, `packages/apack-ears/src/schema.ts`).
- **One source, derived everywhere.** The shapes generate the typed facades, the row rules and the manifest's checks; the
  schema joins them as one more derivation, so a field's type is written once. The other directions were weighed and
  set aside: generating the shapes from elmdb's schema makes two sources while the move happens and gives up the
  shapes' TypeScript (elmdb's `docs/archive/roadmap/typed-schema.md`), and slimming elmdb's schema to what apack sends today
  removes the checks this plan puts to use.
- **The mismatches stop.** D25 and D26 in elmdb's goal were the schema and the shapes disagreeing — entity names elmdb
  can't hold, and text indexes that had to read `any` fields because no type reached the schema.

## What a shape's field becomes

Codegen maps what the checker says of each property; anything it can't map stays `any`, so a field is never typed more
narrowly than its shape says.

| Shape's property | elmdb field |
|---|---|
| `string` | `string` |
| `number` | `number` |
| `boolean` | `boolean` |
| a union of string literals | `enum` with those values |
| `EARS.EntityId<'T'>` (an id tagged with its types) | `ref` to those types |
| `T[]`, `T` one of the above | `list` of it |
| `T \| null` | that type, `nullable` |
| optional (`?`) | `optional` |
| anything else: an object, a record, `unknown`, `Date`, a mixed union | `any` |

The type stays `additionalFields: allow`: a field written without being in the shape (an untyped write, an entity with no
shape) is still taken, as today.

## Steps

1. **The mapping.** `rowRulesOf` answers each field's type beside the required list, as data codegen can write into the
   pack's registration (`RowRules`). `RowRules` lives in `@apackdev/ears`' `runtime.ts`, part of the typed EARS contract,
   so the change follows `packages/apack-sdk/TYPED-EARS.md`'s checklist. Specs: each row of the table, from a fixture
   shape; a property the checker can't read stays `any`.
2. **The schema.** `toElmdbSchema` declares each typed field; an untyped entity, and a field typed `any`, declare as
   they do today. elmdb's `FIELD_TYPE` joins `EarsErrorCode`, mapped with the others (`CODES`,
   `packages/apack-ears/src/database.ts`). Specs in `@apackdev/ears`: a write of the wrong type is refused with
   `FIELD_TYPE`, from a typed engine and from `untypedWrite`; a field outside the shape is still taken.
3. **The audit, on a copy.** Before the change ships, run `check()` over a copy of production-shaped data with the new
   schema: every row it reports breaks a rule a shape already claimed. Each finding is a bug in the code that wrote it,
   fixed there; stored developer data is not migrated by the app (apack's `CLAUDE.md`, Backward compatibility). The
   findings and their fixes are recorded with the change.
4. **The writers the compiler can't see.** Run default-setup's flows and actions, the console's examples and the
   migrations against the typed schema (their specs and `npm run chain`), and fix what elmdb now refuses.

## What it changes for a pack author

A write the shape doesn't allow is refused at runtime where it used to be stored: in `apack db exec`, a migration, an
action. The error names the entity, the field and the type it takes. Nothing changes for a write the compiler already
checked.

## Out of scope

- Slimming elmdb's schema. What apack still doesn't use after this — relation endpoints, cardinalities other than
  many-to-many, compound value indexes — is decided separately, once this shows what is left.
- Field-level checks a type can't say (ranges, formats): the shapes don't hold them either.

## Outcome

Built as the steps say, with what building them found:

- **The mapping** (`rowRulesOf`, `packages/apack-sdk/src/build/module-exports.ts`) answers each field's `FieldRule`,
  which codegen writes into the pack's `rowRules` (`RowRules.fields`, `@apackdev/ears`). Two things the table didn't say:
  a pack that doesn't check nulls (no `strictNullChecks`) has its `| null` erased, so every one of its fields is held
  nullable rather than refusing a write its own types allow; and a shape names its ids' types through the pack's
  `#generated/ears`, which codegen writes after reading the shapes and which a clean checkout doesn't have, so the shape
  reader is handed the one the run will write. Without it a first build typed every id `any` and a second `ref`.
- **The schema** (`toElmdbSchema`): a `ref` names only the types the schema declares, and one left with none is a
  string; a field a text or vector index reads is held to text or anything; `FIELD_TYPE` is an `EarsErrorCode`. The
  SDK's own entity types keep their hand-written row rules and are not typed by this change.
- **The audit**, on a copy of G8's production-shaped data (elmdb's `docs/evidence/next-phase-5.md`): no derived
  differences; the 17 duplicate short codes G8 recorded; 280 Notes without `hideCompletedChildren` and 154 Messages
  holding `forkable: null`. A Note is created with the field since `a86972a9d6`, after the backup; no writer in apack's
  history wrote a `null` forkable, and each writes a boolean today. The data is not migrated.
- **The writers the compiler can't see**, run through their specs and the chain: the notes system cleared a note's
  saved order by writing `null`, which its shape doesn't hold, and now removes the field; forking a thread copied a
  stored `null` across, and now copies only what the shape holds; and the onboarding action ended onboarding by clearing
  its thread's `forcedMode` with `null`, which stalled onboarding once refused (the external pack's onboarding E2E),
  so the threads repository's `update` takes a `null` as clearing the field, none of the shape's fields holding one.

