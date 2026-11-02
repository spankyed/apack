# @app/publish-checks

What a consumer gets when they install the published `@apackdev` packages — and the fixture that finds out.

Nothing here ships. It is a workspace for one reason: the fixture it owns is needed by two packages, and a
workspace is how two packages share a module by name.

## Why it exists

These specs lived in `@apackdev/cli`, and none of them is about the CLI. They npm-pack `@apackdev/ears`, the
SDK and UI into a temporary consumer and compile it across the TypeScript matrix, which is a property of
the *publish*, owned by no single package: `published-exports` and `published-declarations` install all
three at once, so there is no one package they could move to.

The packed consumer links external dependencies from the installed workspace graph, including each package's
private `node_modules` overrides. Flattening those onto the repository root can silently select another major
version (for example Ajv 6 instead of EARS' Ajv 8). Packed `@apackdev` packages remain the consumer's tarballs;
private workspace links must not shadow them. The exports suite checks owner-specific dependency resolution.

The fixture decided the shape. Three `@apackdev/cli` specs — `facade-typing`, `fe-bundler-host-registry`,
`types-bundler-determinism` — use a packed consumer to test the CLI's own bundlers, and they stay there.
So `installPublishedPackages` has to be reachable from two packages without a relative path across one,
and the alternatives all cost more: putting it in `@apackdev/testing` ships repo-internal packing tooling to
pack authors, and distributing the specs gives `@apackdev/sdk` and `@apackdev/ui` an expensive
pack-and-compile half each where both suites are pure and fast.

**Not everything named `published-*` belongs here.** `published-imports` is in `@app/repo-checks`, because its
subject is `scripts/lib/published-imports.ts` — a module five build scripts use, so it cannot leave `scripts/`.
`published-sdk-peers` came the other way, from there to here, once its subject was read as the published SDK
rather than the script it borrows from. The family is split by subject, not by accident.

## What is here

| Spec | Subject |
|---|---|
| `published-exports`, `published-declarations` | what a consumer can import, and that the declarations resolve, across all three packages at once |
| `published-sdk-any`, `published-sdk-types` | the SDK's published surface: no `any`, and it compiles for a consumer |
| `published-ui-types` | `@apackdev/ui`'s declarations compile for a consumer |
| `published-specifiers`, `published-ui-dist` | what the built `dist` trees contain: declared bare imports, no SFC source shipped, no relative CSS `@import` left |
| `published-manifest-paths` | that each of the **five** published trees names only files its tarball holds, publishes no `scripts` and ships no `src/`. The only spec here that covers `@apackdev/cli` and `@apackdev/testing` too, because their manifests are generated and their shape is not the other three's |

`src/published-packages.ts` is the fixture: `installPublishedPackages()` (npm-packs the three into a temp
`node_modules`), `packedFiles()` (one `npm pack --dry-run`, for a check that needs the file list and not a
consumer), `compileConsumer()` over `CONSUMER_MATRIX` (the workspace TypeScript and the 5.7 floor
from `packages/typescript-floor`, × `node16`/`bundler`), `PACKED_PACKAGES`, and `PACKAGES_BUILT`.
`@apackdev/cli` imports it as `@app/publish-checks`.

What it packs is each package's **staged** tree (`publishedTreeDirs()`), never the workspace directory: no
published package carries its workspace manifest, because that manifest resolves `src/` under the
`@apackdev/source` condition and no tarball ships `src/`. `@apackdev/host/build/published-manifest` derives what
is published; a consumer fixture reads the derived manifest, as a consumer does.

## Tests

Two halves, as every suite with an expensive one has: the integration half gives a spec 60s per test and a worker pool capped at half the cores. Which half a spec is in is its filename, decided when it is written rather than re-derived from a measurement.

- **`npm test -w @app/publish-checks`** — each spec reads the built `dist` and packs nothing.
- **`npm run test:integration -w @app/publish-checks`** — each packs, and most compile, so the config caps
  worker threads; the comment there has the reason.

How many specs each half holds and what they cost is `npm run spec:dry -- packages/publish-checks/tests`,
dated. Written out here it drifted, and the paragraph below is what that cost.

**Packing is the line between them**, and `published-manifest-paths` was on the wrong side of it until
2026-10-06. It was kept in the fast half on the strength of its five `npm pack --dry-run` calls costing
~1.5s; measured 2026-10-06 it was **3.74s of that half's 4.5s** — 83% of it — so the half was one packing
spec beside three near-instant ones, and the figure the decision rested on was 2.5x stale. The date is on
it for that reason: a measurement a decision cites cannot be derived and cannot be dropped, so it carries
its conditions instead. The spec's own header
records the move. Nothing re-derives a half: the filename is the decision.

Both halves have a `pretest` that builds the packages, because `npm run test:integration` fires no `pretest`
hook of its own — npm only runs `pre<script>` for the script named. Without it the standalone command tests
whichever `dist` happens to be on disk.
