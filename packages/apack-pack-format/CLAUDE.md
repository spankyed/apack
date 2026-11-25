# `@apackdev/pack-format`

Workers-safe, pure-JS pack format contracts: Zod manifest, snapshot, content index, help, and native declaration schemas; `PACK_LAYOUT`; `semver` host compatibility (`isHostCompatible`); dependency parsing; service selection; pure-JS SHA-256 declaration revisions; and `apack.schema.json`.

## Invariants

- **Zero `node:*` builtins and zero `ajv`:** `src/` must remain Cloudflare Workers–safe and pure JS (`tests/workers-safe.spec.ts` asserts `esbuild` bundles `src/index.ts` for `platform: 'neutral'` with zero Node builtins and zero `ajv`).
- **Exact type lock with `@apackdev/sdk`:** `src/declaration-schema.ts` maintains compile-time `_Exact` / `_ExactReadonly` locks against the plain TypeScript interfaces in `@apackdev/sdk/framework` so schemas and plain types cannot drift.
- **Generated JSON Schema:** Run `npm run schema:update` after changing `src/declaration-schema.ts` and verify with `npm run schema:check`.
