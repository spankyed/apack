# Import/Export — Technical Reference

How library docs, notes, actions, prompts, and flows move between the filesystem and the database.

## Two export formats

**JSON** — full-fidelity. Preserves all typed content sections, nested structure, and media references. Single `.json` file + `media/` directory.

**Markdown** — human-readable. Each document becomes a `.md` file with YAML frontmatter. Collections become directories. Media flattened to a single `media/` folder.

## Library

### Markdown export (`export-markdown.ts`)

```
library-YYYYMMDD-HHMMSS/
├── _meta.md                  # collection metadata (if root is a collection)
├── document-name.md          # document files
├── collection-name/          # collection directories
│   ├── _meta.md              # name + description preserved here
│   └── child-doc.md
└── media/
    └── flat-filename.png     # all media flattened
```

**Document `.md` format:**
```markdown
---
name: "Original Document Name"
tags: [tag1, tag2]
---

<!-- section:field -->
**key1**: value1
**key2**: value2

<!-- section:markdown -->
Regular markdown content here.

<!-- section:code:python -->
```python
print("hello")
```
```

Key details:
- Filenames are slugified (`toSlug`): lowercased, non-alphanumeric → dashes
- Original name preserved in frontmatter `name` field (survives slug roundtrip)
- Tags preserved in frontmatter `tags` field
- Content sections use `<!-- section:TYPE -->` HTML comment markers to preserve type semantics (field, list, code, text, markdown)
- `_meta.md` in collection directories stores `name` and optional `description`
- Media references rewritten from `media://entityId/filename` → `media/flat-filename`

### Markdown import (`import-library.ts`)

Detection logic:
1. Check for `exported-library.json` → JSON import
2. Check for `.md` files or subdirectories (excluding `media/`) → markdown import
3. Otherwise → error

Processing:
- Directories → collections. Reads `_meta.md` for name/description if present, otherwise `toDisplayName(dirname)`
- `.md` files → documents. Reads frontmatter for name/tags, otherwise `toDisplayName(basename)`
- `_meta.md` files → skipped (reserved for collection metadata)
- `media/` directory → skipped during traversal, media refs restored per-document
- Frontmatter is stripped before parsing body into `ContentSection[]` via `parseDocumentSections()` (`@apackdev/sdk/content`)
- Backward compatible: files without frontmatter or section markers import as a single markdown section

### JSON export (`export-library.ts`)

Writes `exported-library.json` with full `ExportedLibrary` structure:
```json
{
  "version": 1,
  "items": [
    { "type": "document", "name": "...", "content": [...], "tags": [...] },
    { "type": "collection", "name": "...", "description": "...", "children": [...] },
    { "type": "symlink", "name": "...", "symlinkPath": "..." }
  ]
}
```

Media copied to `media/{entityId}/{filename}` preserving entity structure.

### JSON import

Reads `exported-library.json`, recursively creates collections/documents via `processItems()`. Media refs restored from `media/{entityId}/{filename}`.

## Notes

### Markdown export (`export-notes.ts`)

```
notes-YYYYMMDD-HHMMSS/
├── note-title.md             # leaf notes
├── parent-note/              # notes with children
│   ├── index.md              # parent's own content + metadata
│   ├── child-note.md
│   └── nested-parent/
│       ├── index.md
│       └── grandchild.md
└── media/
```

**Note frontmatter:**
```markdown
---
title: "Original Note Title"
type: document
icon: "bookmark"
favorite: true
---
```

Key details:
- Notes with children → subdirectory with `index.md` for parent content
- Leaf notes → standalone `.md` files
- `index.md` is pre-reserved in `childUsedNames` — a child named "index" exports as `index-2.md`
- `title` in frontmatter preserves original name through slug roundtrip

### Markdown import (`import-notes.ts`)

- Directories → notes with children. Reads `index.md` for parent metadata/content
- `.md` files (except `index.md`) → leaf notes
- Frontmatter `title` preferred over `toDisplayName(filename)`
- `index.md` skipped when processing directory children (treated as parent content)

## Actions & Prompts

Actions and prompts only support JSON import/export.

### Import

Each feature settings page has a "Select JSON File..." button. The JSON is an array:

**Actions:**
```json
[{ "label": "...", "actionFn": "...", "input": {...}, "description": "...", "category": "...", "output": {...} }]
```

**Prompts:**
```json
[{ "label": "...", "templateFn": "...", "inputs": {...}, "description": "...", "category": "...", "outputSchema": {...} }]
```

Import uses upsert logic: existing items (matched by label) are updated, new items are created.

## Flows

Flows import via a compiled DSL JSON file. The DSL is validated against available action/prompt labels before import. Invalid references cause the flow to be skipped.

## Import Pack Content

Settings → General → "Import Pack Content" imports a pack's compiled content from a directory (any pack's `runtime/content/` — `dist/runtime/content/` in a workspace pack after `npm run build:default-setup`). The settings system previews it with `previewPackContent(dir)` (`@apackdev/sdk/content`), then calls `importCompiledContent({ compiledDir, include, mode })` (`@apackdev/sdk/utils`), which runs the pack's registered applier for each `<key>.content.json` listed in `content.json` (actions, prompts, flows, documents, commands, notes, …), with media from `media/`.

## Content pipeline

At boot, the host content every pack's compiled content (`applyPacks`, `@apackdev/host/packs/runtime`) from its
`runtime/content` directory, in dependency order so a pack's content can reference what the packs it depends on
written. A SHA-256 hash of those files is recorded per pack as its applied content's revision
(`appliedContent`, `@apackdev/host/app-state`). If it matches on the next startup, writing is skipped; changed
data triggers a re-apply. A pack whose last content failed is retried when a pack it depends on has written since
(`AppState.failedAgainst` holds what that attempt faced). Beside the revision, that record holds one entry per
row the pack has written — a hash per part of what was written — which is what makes a boot apply a three-way
merge: it tells a later run that a row it cannot find was deleted by the user rather than never imported,
which parts of a row the user has since changed, and which rows the pack has stopped shipping.
Every key a pack declares is imported: there is no policy saying otherwise, because `content.sources` holds only
entries that import rows, and what a run leaves alone it decides from that merge.

**The hash is over content alone** — the bytes and the file names holding them. File times are not in them: a pack's files are replaced wholesale by every install (`placePack` renames a fresh directory into place), so hashing their mtimes made a reinstall of the identical pack read as changed data, and a `touch` re-apply. Putting a pack's data back on purpose is `IMPORT_PACK_CONTENT`, which the Settings view drives with a preview, a per-key selection and a collision mode.

## Media handling

Two media URL formats:
- **Internal**: `media://entityId/filename` — used in the database, references entity-specific media directory
- **Relative**: `media/filename` — used in markdown exports, flat structure

On export: internal → relative (with deduplication via `uniqueFilename`)
On import: relative → internal (copies files to new entity directory, rewrites URLs)

JSON exports preserve the entity-based structure: `media/{entityId}/{filename}`.

## Reserved filenames

- `_meta.md` — collection metadata marker in library exports. Skipped during import. Safe from collision because `toSlug` strips leading underscores.
- `index.md` — parent note content in notes exports. Pre-reserved during export to prevent child note collisions. Skipped during child import.

## Key functions

| Function | Location | Purpose |
|---|---|---|
| `toSlug(name)` | `@apackdev/sdk/utils` (`utils/export.ts`) | Name → filesystem-safe slug (lowercase, dashes) |
| `toDisplayName(str)` | `@apackdev/sdk/utils` (`utils/shared.ts`) | Slug → display name (replace dashes with spaces) |
| `uniqueFilename(name, used)` | `@apackdev/sdk/utils` (`utils/export.ts`) | Dedup filenames (`foo.md` → `foo-2.md`) |
| `buildFrontmatter(tags, name?)` | `library/be/utils.ts` | Build YAML frontmatter string |
| `parseFrontmatter(content)` | `library/be/utils.ts` | Extract `{ tags, name?, description?, body }` |
| `parseDocumentSections(body)` | `@apackdev/sdk/content` | Parse `<!-- section:TYPE -->` markers into `ContentSection[]` |
| `serializeDocumentSections(sections)` | `@apackdev/sdk/content` | `ContentSection[]` → markdown with section markers |
| `importCompiledContent(options)` | `@apackdev/sdk/utils` (`utils/apply.ts`) | Run the registered appliers over a compiled content directory |
| `computeManifestContentRevision(dir, files)` | `@apackdev/host/packs/runtime` (`apply.ts`, internal) | SHA-256 hash of a boot apply's compiled files |
