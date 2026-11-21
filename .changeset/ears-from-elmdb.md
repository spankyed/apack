---
'@apackdev/sdk': minor
'@apackdev/cli': minor
'@apackdev/testing': minor
---

EARS is `@elmdb/ears`, elmdb's package, built and versioned in elmdb's repository; `@apackdev/ears` is no longer
published. `@apackdev/sdk` depends on `@elmdb/ears` and declares `elmdb` as a peer at exactly the version EARS takes,
so one binding is installed beside both. Its database entry is `@elmdb/ears/database` (it was `@apackdev/ears/lmdb`),
with the same exports. EARS' changes made in apack and not yet released ship with it: EARS is typed by elmdb's
generated protocol, `createEarsEngine`'s `callSites` and `warn`'s `EarsWarning`, and the port's `read` (no longer
`readSync`).

A pack names only `@apackdev/sdk`, as before, and its code reaches EARS through `@apackdev/sdk/ears`. The test
harness no longer checks that a pack's own `@elmdb/ears` is its SDK's copy, since a pack declares none.
