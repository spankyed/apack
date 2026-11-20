---
'@apackdev/ears': minor
---

`createEarsEngine`'s `warn` is told what it warns of as data too, its second argument an `EarsWarning`: an
`unindexedWalk` (the types and field of a `where` that filtered their rows for want of a value index, the rows it
visited and the code that made the query) or a `slowWatch` (the watch's label, its cost a run and how many runs in a
row cost more than a flush's slice).

The unindexed walk's message names the fix in the engine's own terms, a value index in the type's row rules
(`"indexes": ["field"]`), and no longer an `apack.json` entry: a creator whose declarations hold the row rules says
where, from the data. apack's database store does, so the app's development warning still names the pack manifest
entry to declare the index in.
