---
'@apackdev/sdk': minor
'@apackdev/cli': minor
'@apackdev/testing': minor
---

A pack names only `@apackdev/sdk`, which brings the EARS it was built with (`@elmdb/ears`). `@apackdev/sdk/ears`
re-exports all of EARS, so packs and their generated code take what they use of it from there: `defineEars`,
`RESERVED_ATTRIBUTES`, `EarsSchema`, `ShapeOf`, `BaseEntity`, `QueryBuilder`, `WriteBuilder` and the rest. The
generated `#generated/ears` and `#generated/services` import from the SDK alone, taking `EntityId`, `AttrKind` and the
rest from the SDK's `EARS` namespace.

`apack pack init` no longer adds an EARS package to a new pack's dependencies, and a pack's own can be removed:
replace its imports of `@apackdev/ears` with `@apackdev/sdk/ears` (or `@apackdev/sdk` for `EARS`). `apack pack build`
compiles a pack's frontend against the EARS its SDK resolves and reads what the generated modules import as it reads
what the pack's own sources do, so a facade's types stay typed when only generated code names `@apackdev/sdk/ears`.
