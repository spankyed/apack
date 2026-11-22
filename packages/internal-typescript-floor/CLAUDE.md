# @app/internal-typescript-floor

A private workspace that installs nothing but `typescript@5.7.3`, the oldest TypeScript `@apackdev/sdk` and `@apackdev/ui` support. The SDK's and UI's `typescript` peer is `>=5.7`, the version `ai` 7's declarations need. It has no source.

## Who uses it

`packages/apack-cli/tests/helpers/published-packages.ts` points `TSC_VERSIONS['5.7']` at `packages/internal-typescript-floor/node_modules/typescript/bin/tsc`, next to the workspace compiler (`current`). `CONSUMER_MATRIX` crosses both compilers with `node16` and `bundler` module resolution, and these specs compile a consumer against the built packages for every combination:

- `published-sdk-types.integration.spec.ts` (through the SDK's `@elmdb/ears`, whose own floor elmdb checks)
- `published-ui-types.integration.spec.ts`
- `published-exports.integration.spec.ts`

All three are in `@app/internal-publish-checks`.

They need `npm run packages:build` first; without `dist/` they skip, except in CI, where they fail.

## Changing the floor

The pinned version, the `typescript` peer ranges in `packages/apack-sdk/package.json` and `packages/apack-ui/package.json`, and the `'5.7'` key in `TSC_VERSIONS` move together. Update the root `CLAUDE.md` and `docs/public-facing` wherever they name the version. Pin an exact version, not a range, so the specs test the actual floor.
