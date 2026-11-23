# Monaco DSL Definitions

Monaco editor intellisense for the action, prompt and database DSLs comes from one declaration file per DSL, built by `apack pack build` and carried as static snapshot/catalog data.

## Pipeline

```
src/defs/{action,prompt,database}.ts            (1) Hand-authored type source
        ↓  apack pack build (bundleDslDefs)
dist/defs/monaco/{action,prompt,database}-defs.d.ts  (2) Bundled declarations
        ↓
dist/types/snapshot.json: dslDefinitions        (3) Verified built data
        ↓  shared host/window catalog
getDslDeclaration() → Monaco TypeScript worker  (4) Owned live libraries, independent of activation
```

| Stage | File | Produced by | Purpose |
|-------|------|-------------|---------|
| 1 | `src/defs/action.ts` | Hand-authored | The types and values in scope in the action DSL (services, params, z, entity types) |
| 1 | `src/defs/prompt.ts` | Hand-authored | Prompt DSL types (`usePrompt`, params, `PromptEntity`) |
| 1 | `src/defs/database.ts` | Hand-authored | the Database console's names (`query`, `create`, `upsert`, `write`, the finders and relation helpers) |
| 2 | `dist/defs/monaco/*-defs.d.ts` | `apack pack build` | Each entry's types bundled into one declaration file, wrapped as `declare module "@app/defs/<name>"` |
| 3 | `dist/types/snapshot.json` | `apack pack build` | Records each Monaco target's compiled text, including targets without globals; snapshot/native validation requires exact declared coverage |
| 4 | Common catalog / `dsl-reader.ts` | Host/window projections | Returns metadata and compiled text without loading modules; source previews may have metadata only |

Every pack gets this: `apack pack build` bundles each `apack.json` `extensions.dsl` entry whose `targets` include `monaco` (`packages/apack-cli/src/build/dsl-defs.ts`, covered by `packages/apack-cli/tests/build/dsl-defs.integration.spec.ts`).

## What is inlined

The editor loads no `node_modules`, so a declaration Monaco can't resolve is a silently missing completion. The bundler inlines the pack's own modules and every `@apackdev/*` package, plus the packages listed in the entry's `inline` field; everything else stays an import. default-setup's `action` entry inlines `ai`, `@ai-sdk/provider`, `@ai-sdk/provider-utils`, `@ai-sdk/gateway` and `@standard-schema/spec`, the packages `services.inference`'s types reach into.

## When they are rebuilt

Anything that builds the pack rebuilds them, because they are part of `apack pack build`:

| Trigger | Rebuilds `dist/defs/` |
|---|---|
| `npm run dev` (dev launcher → `apack pack build --skip-fe`) | Yes |
| `apack pack build` in the default-setup checkout | Yes |
| `npm run build:server` | No — builds only the API |
| `npm run build:production` (`build/build.sh`) | Yes |
| Branch switch on its own | No — `dist/` is gitignored; the next build refreshes it |

The declaration files are generated output: never edit them, and edit `src/defs/*.ts` instead.

Builds assemble these definitions in `.apack/build/defs` alongside the other output, then copy their
text into the candidate snapshot. Cached phases copy the same staged bytes into that snapshot. A
successful build publishes the complete sealed output; a failed build retains the incumbent. Archives
retain `dslDefinitions` while omitting standalone definition files and authored modules.

Monaco consumers acquire shared libraries per Monaco instance, language and DSL. Catalog updates replace
changed module/global text and remove unavailable definitions. The last editor releasing a library
disposes its handles; the last library releases the catalog subscription. Prefix inference chooses a
unique longest nonempty prefix. Explicit DSL selection works without a prefix. Disabled packs' type
data remains useful for editing saved content; an unbuilt or ambiguous owner cannot supply completions.
