---
'@apackdev/sdk': minor
'@apackdev/cli': minor
'@apackdev/testing': minor
---

A pack names only `@apackdev/sdk`, which brings the `@apackdev/ears` it was built with. `@apackdev/sdk/ears` exports
what packs and their generated code use of EARS: `defineEars`, `RESERVED_ATTRIBUTES`, and the types `EarsSchema`,
`UntypedSchema`, `ShapeOf`, `ShortCode`, `BaseEntity`, `QueryBuilder`, `WriteBuilder`, `RelationRow`,
`RelationMatch`, `RelationStats` and `QueryExplanation`. The generated `#generated/ears` and `#generated/services`
import from the SDK alone, taking `EntityId`, `AttrKind` and the rest from the SDK's `EARS` namespace.

`apack pack init` no longer adds `@apackdev/ears` to a new pack's dependencies, and a pack's own can be removed:
replace its imports of `@apackdev/ears` with `@apackdev/sdk/ears` (or `@apackdev/sdk` for `EARS`).
`apack pack build` compiles a pack's frontend against the EARS its SDK resolves, reads what the generated modules import
as it reads what the pack's own sources do, so a facade's types stay typed when only generated code names `@apackdev/sdk/ears`, and the test harness accepts a pack
that resolves no `@apackdev/ears` of its own, refusing only one whose copy isn't its SDK's.
