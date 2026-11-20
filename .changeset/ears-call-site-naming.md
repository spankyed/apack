---
'@apackdev/ears': minor
---

How a counted call (`admin.calls`), or a watch given no label, names the code that made it is the engine's creator's:
`createEarsEngine`'s `callSites` (`CallSiteNaming`) takes `engineFrames`, a pattern for the paths of the engine's own
frames, and `roots`, the directories a site names a path from. By default the engine's frames are those in the
directory its modules were loaded from, and a path is named from its last `node_modules/` on, or whole, rather than
by the `apack-ears` and `@apackdev/ears` paths and from `packages/` or `packs/`. apack's engines pass those as before
(`_EARS_CALL_SITES`, `@apackdev/sdk/ears`), since its development API bundles the engine and names its modules only
through source maps.
