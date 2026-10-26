# Typed EARS: type contract and change control

The typed EARS helpers are the main way pack authors touch data, so their types are a product surface, not an implementation detail. Their behavior was specified deliberately and is pinned by tests. **Don't change them to make a single call site compile.**

## Files covered

The engine's types moved to `@apackdev/ears` (`packages/apack-ears`); the SDK keeps the names and shapes it adds, and codegen the pack's.


- `packages/apack-ears/src/entities.ts`: the core `EARS` namespace (`EARS.EntityId`), `BaseEntity`, `ShapeOf`, `EntityNameArg`
- `packages/apack-ears/src/runtime.ts`: `QueryBuilder`, `WriteBuilder`, `FieldValue`, `FieldValues`
- `packages/apack-ears/src/typed.ts`: `defineEars` and the `Typed*` helper signatures behind `#generated/ears` (the functions it returns act on the engine its getter returns, `boundEars` for a pack; `src/engine.ts`'s `Ears` is untyped)
- `packages/apack-sdk/src/types/entities.ts`: the SDK's `EARS`, aliasing the engine's types and adding the SDK's entity types and relation kinds
- `packages/apack-sdk/src/types/sdk-entities.ts`: `SdkEntityShapes` and the SDK-owned entity shapes (the flow model: Flow, Node, Action, Prompt, and the document model: Document, Collection; a flow run is a run-history record, not an entity). Preferences use the host settings contract, without a pack-owned `Settings` entity; the host's `AppState` isn't in any pack's `EntityName`
- `packages/apack-sdk/src/build/generate-entries.ts` (`generateEars`): the generated `PackShapes`, `EntityName` and `Node` override

## The contract

**No `any`.**
- Nothing pack-facing exposes `any`. `published-sdk-any.integration.spec.ts` in `@app/publish-checks` enforces it.
- An entity type without a declared shape reads as `BaseEntity & Record<string, unknown>`, so its values need narrowing.

**Shapes.**
- `ShapeOf` is deliberately non-distributive (see its comment).
- `PackShapes['Node']` is the pack's step node union: its own and its dependencies' `XNode extends NodeBase` types. It's `NodeBase` when no step defines one.

**One schema parameter.**
- A builder is typed by an entity type and a schema: `QueryBuilder<E, D>`, `WriteBuilder<E, D>`, and `TypedEars<D>`
  from `defineEars<D>()`. `D extends EarsSchema` carries the four facts by name — `shapes`, `names`, `relKinds`,
  `roles` — so a hover or an error reads `QueryBuilder<"Thread", PackSchema>` rather than spelling out four types.
- A pack's `#generated/ears` declares its own `PackSchema` as an interface (an interface keeps its name in
  messages, where an alias would be expanded), and the SDK's `SdkSchema` types its own entities. `UntypedSchema`
  (`shapes: {}`, every name a `string`) is the default, and what the untyped operations use; a one-off schema in a
  spec is `UntypedSchema & { shapes: …; names: … }`.
- A field position reads the schema by indexed access (`D['shapes']`), never through a conditional or mapped type
  (Incidents).

**Field parameters.**
- They're typed as `keyof ShapeOf<D['shapes'], E> & string`, and picked rows as `Pick<ShapeOf<D['shapes'], E>, K>`. This covers `where`, `pick`, `pickOne`, `orderBy`, `distinct`, `groupBy`, `search`'s and `hybrid`'s `fields` and `recency.field`, `hits`' `fields` and `getAttr`. `where` takes one value type (`WhereValue`): the field's, one element of a list field, which the value index answers, or a predicate.
- This form is what gives editors field-name completions and makes a typo's error list the valid fields.
- `pickOne()` with no fields is the first whole row, `ShapeOf<S, E> | null`, as a write builder's `row()` is its entity's. The no-field overload is declared after the fields one, so `pickOne(['|'])` keeps its completions; `query.ids(id).pickOne()` is the row with an id, typed by a branded id or by `.ofType(type)`, which checks the entity rather than asserting a shape.
- For a union shape, such as `Node` rows, only the fields every member has are accepted.
- A query whose fields vary by member, or are only known at runtime, uses `untypedQuery` from `@apackdev/ears` on purpose. The brain trigger queries in default-setup are the example. (It's the same untyped `query` an engine has, `createEarsEngine(...).query`.)

**Entity names.**
- A literal entity name must be one the pack, its dependencies or the SDK declares (`EntityName`). A name typed `string` passes unchecked (`EntityNameArg`).
- A generic helper constrains its name to `EntityName`, or opts out with `as string`.
- A name and an id go to different functions: `query(type)`/`create(type)`/`upsert(type, { id })` take a name,
  `query.ids(id)`/`write(id)` an id. An id passed where a name is meant is a compile error (it is no declared
  name), and in the untyped twins too, whose name parameters are `TypeName<E>`: a dashed literal or an
  `EntityId`-typed value becomes `never`. A name typed `string` passes, and the runtime refuses it when it
  isn't a registered type.
- Overload order in `typed.ts` is part of the contract wherever a function still has more than one.

**Relation kinds.**
- The generated `EARS.RelKind` is closed: `(typeof RELATION_KINDS)[number]`, the pack's kinds, its dependencies'
  and the SDK's, with no open `string` member and no `Custom`. The schema's `relKinds` (`PackSchema`, below) carries it to
  `QueryBuilder` and `WriteBuilder`, so `link`, `unlink`, `out`, `in`, `outEdges`, `inEdges`, `linkedTo`,
  `linkedFrom` and `LinkOptions.acyclicIn` take only those kinds, complete them, and list them in a typo's error.
- A kind that arrives as data is narrowed with the generated `EARS.isRelKind`; the untyped twins and an engine's
  own operations take any string (`UntypedSchema`'s `relKinds` is `string`), and the engine refuses an undeclared one at runtime.

**Roles.**
- The same as relation kinds: the generated `EARS.RoleKind` is `(typeof ROLES)[number]`, closed over the pack's
  roles (`data.roles`), its dependencies' and the SDK's, with no `Custom`. The schema's `roles`
  carries it to `grant`, `revoke`, `grantExclusive` and `withRole`; `EARS.isRole` narrows a role that arrives as data,
  and the engine refuses an undeclared role at runtime.

**Ids.**
- Typed queries return ids tagged with their entity type (`ids()`, `first()`, `pick`'s `id`, a row's `id`).
- A plain `EARS.EntityId` carries no tag and is accepted wherever a tagged id is, including `includes` and `Set.has`. Only an id tagged with a different entity type is rejected.
- Link ids use `NoInferType`, so a result passed straight into a generic function keeps its shape.
- **`query('user-note')` is a compile error**, now that no entry point takes a name *or* an id (Incidents
  below has why the type alone could not fix it).

**Writes.**
- `create`, `upsert` and `write` from `#generated/ears` check a write when they know the entity: started from a declared name or a tagged id.
- Such a write names only the shape's declared fields (`WritableField`), and stores each one's declared type.
  `set`, `append`, `merge`, `delete`, `removeAt` and `removeValue` take `K extends WritableField<S, E>`, which keeps
  field completions and makes a typo's error list the fields; `setMany` takes the declared fields as an object
  with no index signature, so a misspelled key is an excess property.
- `create(type, row)` takes the whole row (`CreateFields & RowIdentity & ShortCodeIdentity`): every field the shape requires
  (`RequiredField`), any optional one, and the `id`, `createdAt` and `updatedAt` an import keeps — and its `shortCode`,
  typed as the shape's own `ShortCode<prefix>`, so another type's code fails to compile, with no such key for a shape
  that has none. The row argument
  is required exactly when the shape requires a field, so an incomplete row doesn't compile; `upsert(type, { id, ...row })`
  is held to the same row, its id always given. `shortCode` is one of the engine's own attributes, never a field of
  the row: `create` numbers it from the prefix the type's manifest entry declares (`shortCode`). A pack's shape
  declares no `shortCode` — codegen refuses one — and the generated `PackShapes` intersects a numbered entity's shape
  with `{ shortCode: ShortCode<prefix> }`, so the prefix is written once. `ShortCodeOf<E>` (`#generated/ears`) reads
  the field back for a pack's own types, covering its entities, its dependencies' and the SDK's (whose hand-written
  shapes take their prefixes from `SDK_SHORT_CODES`); it is `never` for an entity that isn't numbered or has no shape.
  The engine holds every write to the same rules at runtime: codegen reads each pack shape's required fields with the
  TypeScript checker (`rowRulesOf`) and each type's prefix from the manifest into its registration
  (`PackEARS.rowRules`), the SDK lists its own (`SDK_ROW_RULES`, its prefixes from `SDK_SHORT_CODES`, compiler-checked
  against its shapes), and `create` numbers a short code, refuses a row without a required field and `delete` one of
  them (`REQUIRED_FIELD`) — the untyped twins, content writers and the console included.
- `delete` takes only an optional field (`OptionalField`): removing a required one would leave a row its shape
  misdescribes, so a required field is replaced with `set`. `removeAt` and `removeValue` edit a list and remove
  no field, so they take any writable one.
- The engine's own attributes (`id`, `entityType`, `shortCode`, `createdAt`, `updatedAt`, `role`, `trashedAt`) are not
  writable fields, so the type refuses them as the runtime does.
- A plain id leaves every write unchecked. EARS stores attributes a shape need not declare; code writing one
  says so with `untypedWrite`/`untypedCreate`/`untypedUpsert` (`@apackdev/sdk/ears`), or declares the field.

**Which `EARS` to import.**
- Pack code imports `EARS` from its `#generated/ears` by default.
- The SDK's `EARS` (`@apackdev/sdk`) is fine for `EntityId`, the SDK-owned constants and the shared EARS types (`AttrKind`, `RoleKind`…). That covers build facets and SDK-level code. Its `EntityId` is the same type the generated one aliases, and a pack's name (`EARS.Entity.Note`) doesn't exist on it, so a wrong import fails to compile.
- The one hazard is the SDK's `EARS.Entity` as a type. It's open (any string), so a value annotated with it passes the entity-name check unchecked, reads with the generic shape, and compiles with a typo. Use it only when an open name is intended, as in default-setup's create step (`entityTypeTarget`, any entity type a flow names); otherwise annotate with the generated `EARS.Entity` or `EntityName`, which are closed.

**Defaults.**
- `QueryBuilder<E = string, D = UntypedSchema>` and `WriteBuilder<E = string, D = UntypedSchema>` keep the untyped operations (`untypedQuery`, `untypedWrite`, … from `@apackdev/sdk/ears`, and an engine's own) unchecked.

**Compatibility.**
- `@apackdev/ears` and `@apackdev/sdk` support TypeScript 5.7 and later (`packages/typescript-floor`). These types keep their `NoInferType` workaround from when the floor was 5.3.

## Before changing any of these types

0. **Check Incidents first.** The thing most often reported as a bug here — `query('user-note')` compiling — has
   been investigated and measured, with two failed fix attempts recorded with their blast radius. Do not
   re-derive it.
1. **Treat it as a design change.** Get agreement on the new behavior first. If a call site doesn't fit the contract, change the call site instead:
   - an explicit shape
   - an `EntityName` constraint
   - a runtime name typed `string`
   - the untyped twins (`untypedQuery`, `untypedCreate`, `untypedUpsert`, `untypedWrite`)
2. **Run the type tests** that pin the contract:
   - default-setup: `tests/typed-query-builder.spec.ts`, `branded-entity-id.spec.ts`, `entity-shape-registry.spec.ts`, `sdk-type-safety.spec.ts`, and `npm run typecheck:pack`
   - `@apackdev/cli`: `packages/apack-cli/tests/build/facade-typing.integration.spec.ts` (a real dependent pack under bundler and node16, against both the workspace source and the packed `@apackdev/ears` and `@apackdev/sdk`) and `packages/publish-checks/tests/published-sdk-any.integration.spec.ts`
3. **Mutation-check every rule you touch.** Break it on purpose and confirm a test fails.
4. **Check editor completions and error messages.** `packages/apack-cli/tests/build/facade-typing.integration.spec.ts` in `@apackdev/cli` checks the positions below with the TypeScript language service, under both module resolutions and against the published package. Extend it when you add a field or name parameter, and still look at anything it doesn't cover.
   - Field positions should list the entity's fields: `query(EARS.Entity.X).pick(['|'])`, `.where('|')`, , `.orderBy('|')` and `getAttr(id, '|')`.
   - Entity-name positions should list entity names: `query('|')`, `newId('|')`, `.out(kind, '|')`, `.ofType('|')`.
   - Relation-kind positions should list the pack's, its dependencies' and the SDK's kinds: `.out('|')`, `.link('|', id)`, `.linkedTo('|', id)`.
   - Role positions should list the pack's, its dependencies' and the SDK's roles: `.grant('|')`, `.withRole('|')`.
   - A created row should list the shape's fields and the identity it may bring, never the engine's other fields: `create(type, { | })`.
   - A typo (`where('titel')`) should produce an error that lists the valid fields.
   - Compare against the previous version with the TypeScript language service (`getCompletionsAtPosition`), not just by compiling.
5. **Update the API reports** (`npm run api:update` in `packages/apack-ears` and `packages/apack-sdk`) and review the `apack-ears/etc/index.api.md` and `apack-sdk/etc/types.api.md` diffs as part of the change.

## Incidents

- **Union field typing (2026-09-14).**
  - What happened: to make brain's trigger queries compile against the new `Node` union, the field parameters were rewritten as conditional and mapped types (`FieldArg`, `FieldsArg`, `PickedOf`). That added runtime field names and union-member fields to every field-keyed API.
  - Why tests missed it: everything compiled and every type test passed. But field completions disappeared from `pick`, `pickOne`, `linksPick`, `getAttr` and `findWithFields`, and typo errors became "not assignable to type 'never'".
  - Resolution: reverted, and the two queries use the untyped `untypedQuery` (`@apackdev/ears`). The completions test in `facade-typing.integration.spec.ts` now guards these positions.
- **`query('user-note')` compiled: the dash heuristic (investigated 2026-09-18; resolved by the split below).**
  - What it was: `EntityId<E>` is `` `${string}-${string}` `` with an *optional* `__entity` brand. The query and
    write entry points each took a name *or* an id, and the dash was the only thing telling those apart. So a misspelled
    entity name containing a dash fails the name check and lands on the id overload.
  - **Four things depend on that one shape**, which is why it looks fixable and isn't: the dash
    discriminates name from id; the *optional* brand is what lets `E` infer from a tagged id; the
    looseness is what lets real literal ids be written (`id === 'TNode-Root'`, `'Settings-app' as
    EntityId<'Settings'>`); and a plain `string` is *already* rejected, which is why `as EARS.EntityId`
    casts are everywhere. The hole and the ergonomics are the same property.
  - **Attempt 1 — check the literal's prefix in the overload** (`Id & IdArg<N, Id>`, where `IdArg` maps a
    literal prefix that isn't a declared name to `never`). Correct in isolation; **10 type errors** in the
    repo, all legitimate calls. Cause: to check the literal you must capture it at an inference site, but
    `E` must come from the brand, and the two cannot both infer from one argument — so `E` collapsed and
    rows lost their shapes (`brain/be/repository/index.ts`, `brain/be/system.ts`).
  - **Attempt 2 — make the id marker required** (`& { readonly __earsId: true }`, entity tag left
    optional). Passes every documented property in isolation — `E` still infers, a plain id still goes
    where a tagged one is expected, casts still work, `'user-note'` is rejected. **17 type errors** in the
    repo: `id === 'TNode-Root'` comparisons (`database/be/repository/trace-query.ts`,
    `database/fe/state.ts`), literal ids passed in `browser/be/repository/commands.ts`, and an array cast
    in `apack-ears/tests/engine/persistence.spec.ts`. All correct code.
  - **Conclusion: there is no type-level fix that leaves current behaviour unchanged.** Anything that
    stops `'user-note'` being an id also stops `'TNode-Root'` being one.
  - **The design that gets both properties** is to stop overloading, and that is what landed
    ([`ears-public-api.md`](../../docs/archive/plans/ears-public-api.md)): `query(type)` beside `query.ids(id)`, and
    `create(type)` beside `write(id)`. The `EntityId` template stays, so literal ids still compile.
- **No entity names in `query('…')` (found 2026-09-14).** `query`'s id overloads came before its name overloads, so editors offered no names there. Fixed by putting the name overloads first, and moot since ids moved to `query.ids`; the completions test still guards the position.
