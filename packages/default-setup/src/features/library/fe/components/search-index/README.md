# Search index views (dormant)

The library's search index editor and tester. **The feature is switched off:** nothing renders these components. `fe/canvas.vue` has their imports and the `create-index`, `edit-index` and `test-index` views commented out with `[SEARCH_INDEX_FF]` tags, as do `fe/state.ts`, `fe/panel.vue` and the backend. `be/search-index/README.md` explains why it's off, lists every call site (`git grep SEARCH_INDEX_FF`) and how to turn it back on.

## Components

| File | What it is |
|---|---|
| `CreateIndexView.vue` | The create/edit view: a header, three tabs (Details, Scope, Sections) over one `SearchIndexFormData`, and save/cancel. Props `editMode?`, `initialData?: SearchIndex`. Emits `SAVE_SEARCH_INDEX(config)`, `UPDATE_SEARCH_INDEX({ indexId, config })`, `CANCEL_CREATE_INDEX`, `CANCEL_EDIT_INDEX` |
| `DetailsSection.vue` | Details tab: name and description |
| `ScopeSection.vue` | Scope tab: excluded documents and excluded folders, each added through an autocomplete input, and an "exclude all subfolders" toggle |
| `SectionsConfig.vue` | Sections tab: a toggle for section-based indexing, segment rules (type Text Block, List or Field; an occurrence; a key for fields; combined or separate indexing for lists and fields), and a `{{segment N}}` template with a preview |
| `TestIndexView.vue` | Runs test searches against an index through the library surface's state (`UPDATE_TEST_QUERY`, `EXECUTE_TEST_SEARCH`; reads `testingIndex`, `testQuery`, `testResults`, `isSearching`) and shows results grouped by document, with similarity scores and copyable chunks |
| `form/OccurrenceInput.vue` | Occurrence input with quick picks (`first`, `last`, `all`, `N`, `N-X`) |
| `form/ToggleSwitch.vue` | Boolean toggle |

The three tab sections take `modelValue: SearchIndexFormData` and emit `update:modelValue`. The form types are in `fe/types/search-index.ts`.

## Embedding model

An index has no model of its own: every index's chunks are embedded with the one model `IndexedDoc`'s vector index
names in default-setup's `apack.json` (`embed.model`), through `services.inference` with the user's key for its
provider.
