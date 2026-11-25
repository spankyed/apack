# `@apackdev/pack-build`

Node-only pack compiler kernel: entry/facade TypeScript codegen (`generatePackFiles`), content compilers (`compilePack`, markdown/documents/flows/items), help compilation (`compileHelp`), settings type generation (`generateSettingsTypes`), and source validation (`validateManifest`, `validatePackSources`).

## Invariants

- **Private workspace package inlined into `@apackdev/cli` and `@apackdev/testing`:** Depends only on `@apackdev/sdk` and `@apackdev/pack-format` (never `@apackdev/host`).
- **Compiler dependencies stay here:** `esbuild`, `typescript`, `yaml`, `mdast-util-from-markdown`, `mdast-util-to-markdown`, and `json-schema-to-typescript` live here rather than in `@apackdev/sdk` or `@apackdev/pack-format`.
- **Ajv stays in `@apackdev/host`:** Callers that validate settings schemas pass `{ validate }` / `validateSettings` callbacks (`@apackdev/host/settings`) into `generateSettingsTypes` and `generatePackFiles`.
