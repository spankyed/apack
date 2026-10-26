# Library search index (dormant)

Semantic search over library documents: documents are split into chunks (whole documents, or the sections and list items `segmentRules` pick), and each chunk is an `IndexedDoc` row whose text the engine's vector index embeds. It's switched off: the code is typechecked and tested, and nothing calls it.

## What it is

| Part | Where |
|---|---|
| The vector index: the model every index's chunks are embedded with, and its dimensions | `apack.json`, `IndexedDoc`'s `embed` |
| Splitting a document into chunk texts | `chunks.ts` |
| Filling an author's `{{segment N}}` template | `../../segment-template.ts` (shared with the index editor) |
| Index and chunk rows, indexing, search | `repository.ts` (`SearchIndex` and `IndexedDoc` entities, declared in `apack.json`) |
| Types | `types/search-index.ts` (backend), `../../fe/types/search-index.ts` (index editor form) |
| Index editor views | `../../fe/components/search-index/` |
| Specs | `tests/features/library/be/search-index.spec.ts` |

Indexing writes rows and nothing else: a chunk whose text changed, or a new one, is pending in the vector index until `embedIndexedDocs()` embeds it through `services.inference`, and a search (`searchInIndex`) doesn't find a pending chunk. A caller that indexes runs `embedIndexedDocs()` after.

## Why it's off

It hasn't been brought onto the current pack structure or driven in the app since it moved onto the engine's vector index. Every place that would use it is commented out with a `[SEARCH_INDEX_FF]` tag:

- `be/system.ts`: search index events and actions (list, create, update, delete, search)
- `be/repository/commands.ts`: indexing a document when it's created or updated, and removing it from indices when it or its folder is deleted
- `fe/canvas.vue`, `fe/panel.vue`, `fe/state.ts`, `fe/components/FileSystemBrowser.vue`: the index views, the panel's index list and the Create Index button
- `features/database/fe/components/BackupRestore.vue`: the search indices checkbox; the index is in the app's database now, so a backup holds it and this option goes rather than returns

`git grep SEARCH_INDEX_FF` lists them.

## Turning it on

1. Restore the `[SEARCH_INDEX_FF]` call sites, each indexing action followed by `embedIndexedDocs()`.
2. Register the index's functions as repositories in `apack.json` (`searchIndexQueries`/`searchIndexCommands`), used through `repository`, instead of the module functions `be/repository/commands.ts` and `be/system.ts` import directly.
3. Drive it in the app (`drive/`) with a key for the model's provider.
