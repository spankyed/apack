---
'@apackdev/ears': minor
---

EARS is typed by elmdb's generated protocol. Its declarations import types from `elmdb/protocol/…`, so a consumer
compiling against them needs `elmdb` installed, which EARS already depends on; the imports are types alone, so a
frontend bundle holds nothing more.

The database port takes the binding's types where its own were wider: `EarsDatabase.schema` is elmdb's `Schema` or
`null` (it was `unknown`), `setSchema` takes a `Schema` (it took any `object`), and `stats()` answers elmdb's `Stats`
whole. `SchemaChange` and `OpenReport` are elmdb's, so a schema change's `change` and `effect` are their unions
(`'added' | 'removed' | 'changed'`, `'applied' | 'builds' | …`) rather than `string`. An object standing in for a
database is held to the same types.

`query(type).search(text, options)` and `hybrid` send the options `SearchOptions` names (`prefix`, `fuzzy`, `any`,
`fields`, `recency`) and nothing else.
