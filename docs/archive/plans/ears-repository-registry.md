# The repository registry leaves the engine

Status: done, 2026-10-23. Item 12 of the EARS API cleanup on `ears-engine-overhaul`.

## Why

`@apackdev/ears` is storage, queries, writes and units. The repository registry is none of those: it is pack
plumbing. It holds what each pack's `features.<id>.repositories` exports, under the names
`#generated/repository` types. It sits on the engine anyway, as `engine.repository`, `registerRepository`,
`unregisterRepository` and `admin.repositories()`. Three costs follow:

- **A test engine can't be replaced without carrying the packs' plumbing across.** `resetTestData` does
  `installFreshEngine(testEngine().admin.repositories())`.
- **Two things hold "which pack provides `noteQueries`".** The host's pack registry already keeps each pack's
  repositories in its own table (`tables.repositories`, `packs/registry.ts`), and `publishRepositories` copies the
  difference into the engine one name at a time, with a hand-written rollback for a copy that fails part way.
- **The engine's public face exposes members that only the composition root calls.** `registerRepository`
  also has an SDK export, which a pack rule and a `check:specifiers` rule exist only to refuse.

## What the code answered

- **No tool binds only an engine and reads a repository.** The one engine-only binding outside tests is
  `openAppDatabase` (`apack db`), and none of the console's helpers, `db script`, `packages/apack-host/src/database`
  or the CLI's `db` commands read one. A tool with no host bound gets "no app bound" from `repository` instead
  of "not registered", on a line nothing reaches.
- **Replacement stays atomic by construction.** The registry swaps `tables` as a whole with the rest of a pack's
  contributions. With the engine's copy gone, `publishRepositories` and its rollback go too.
- **The view needs a lookup, not the map.** The SDK's `repository` proxy reads one name at a time, so the view
  gets `repository(name)`, throwing the same "is not registered" message.

## The move

- The host registry's `PackRegistryView` gets `repository(name)`, read from `tables.repositories`.
- The SDK's `repository` proxy and `services.repository` read `boundHost().packs.repository(name)` instead of
  `boundEars().repository`.
- The test runtime keeps repositories in `testPacks`, so `resetTestData` creates an engine and copies nothing
  into it. The harness registers a pack's repositories through its registry, as it does its services.
- **Deleted:**
  - From the engine: `engine.repository`, `registerRepository`, `unregisterRepository`, `admin.repositories()`
    and `createRepositoryRegistry` (`apack-ears/src/repository.ts`). `RepositoryError` stays.
  - From the SDK: the `registerRepository`/`unregisterRepository` exports, and the pack rule and
    `check:specifiers` rule that refuse them.
  - From the host: `publishRepositories` and its rollback.

## Callers to move

- **Host:** `packs/registry.ts`, and its specs `registration`, `replacement` and `content-binding`.
  `replacement.spec.ts`'s spy on `registerRepository`, which fails a swap half way, has no subject once the
  copy is gone, so it goes with it.
- **SDK:** the `ears/index.ts` proxy, `testing/index.ts`, and the specs `bound-ears`, `test-host` and `unbound`.
- **API:** `tests/runtime/bound-runtime.spec.ts`.
- **Ears:** the repository registry cases in `tests/engine/queries.spec.ts` (which move to the host) and
  `tests/engines.spec.ts`.
- **Tooling and docs:** `pack-rules.ts`, `scripts/check-import-specifiers.ts` and their spec, both CLAUDE.md
  files and `services-and-data.md`.
- **Not changing:** pack code, which reads `repository` from `#generated/repository` with the same type.

## Done when

- No `@apackdev/ears` member or export mentions a repository, other than `RepositoryError`.
- `resetTestData` creates an engine and copies nothing into it.
- `publishRepositories` is gone, and a pack's replacement swaps its repositories with its other contributions.
- Pack code is unchanged.
- `npm run chain -- --no-native` is green.
