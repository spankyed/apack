# Content

Content sources `apack pack build` compiles to JSON, as `apack.json` `content.formats` and `content.sources` describe them. `writers/` holds the content writer for Note; Documents and Collections are the SDK's, compiled and written by its `commands` key. Actions and prompts run in a sandboxed scope at runtime: no module system, their function bodies are extracted (with inlined helpers). Flows compile to Flow/Node graphs.

## Actions

- Export `meta: ActionMeta` and `async function action(params, services)` (add `z` / `flowId` parameters when the action body reads them). Both the flow action step and `services.action` run it with `runActionCode` (`extensions/steps/action/sandbox.ts`), which passes `params`, `services`, `z`, and `flowId` (`flowId` only from a flow step) and gives `services.logger` the name `action:<label>`
- Import types: `import type { ActionMeta } from '@apackdev/sdk/build'` and `import type { Services } from '#generated/services'` (and `import type { z as Zod } from 'zod'` with `z: typeof Zod` when typing the injected `z` parameter)
- Bare package imports fail the build, except `@apackdev/sdk/actions`, an allowlisted sandbox-safe module whose source is inlined into the compiled body (`INLINABLE_PACKAGE_IMPORTS` in `apack-sdk/src/build/compile-utils.ts`). Type-only imports (`import type`) are erased before bundling and are always fine. References to Node-only globals in the bundle are reported as warnings, not errors
- Relative imports (`./_helpers/...`) are bundled in. A `.ts` file without `export const meta` is a helper, not an action, whatever its name; `.example.ts` files are skipped
- Reference: `docs/public-facing/content.md`

## Prompts

- Export `meta: PromptMeta` and `function template(params, usePrompt)` (synchronous, returns string)
- Import types: `import type { PromptMeta } from '@apackdev/sdk/build'`
- Helper detection is the same as for actions (no `export const meta`)

## Flows

- Default export a `FlowDSL` object (`export default { ... } satisfies FlowDSL`), `import type { FlowDSL } from '@apackdev/sdk/build'`
- Import helpers from `#generated/flow-helpers` (generated from the step definitions in `apack.json`)
- Files prefixed with `_` (and `.example.ts` files) aren't compiled; the `_` rule applies only to flows

## Settings

Each feature declares JSON Schema and explicit defaults in `apack.json` under `features.<id>.settings`. The registry keeps values under `<packId>/<featureId>`; navigation defaults live in `features.<id>.surface.defaultVisible`.

**Settings are declarations, not content.** Pack groups live in `apack.json` `extensions.settings`,
feature preferences in `features.<id>.settings`, and app preferences belong to the host. The host
composes declared defaults beneath explicit user overrides. Content import does not write settings;
reset removes the addressed owner's overrides so current defaults apply.

**`content.sources` is for entries that import rows into the database.** Settings definitions and
help articles are manifest contributions, not content datasets. Help lives in `src/extensions/help`
and is bundled from `extensions.help.path`.

Onboarding, versions and content hashes belong to the host's `AppState`, not preferences. Feature
navigation visibility is declared in `features.<id>.surface.defaultVisible`; user visibility choices
also belong to `AppState`. A feature with only navigation visibility needs no settings definition.

## Notes

Markdown under `notes/` (the welcome note), compiled with the `notes` format (`markdown-tree`, entity `Note`) and written through `hooks/notes.ts`. Frontmatter (YAML): `title` (default: the file name, dashes as spaces), `type` (`document` | `tasklist` | `task`), `icon`, `favorite`, `hideCompletedChildren`, `completed`. A directory is a parent note, its `index.md` giving the parent's frontmatter and content.

## Documents

This pack ships no documents but its commands. Documents are the SDK's: a pack's go under the SDK's `documents` key, which compiles a directory of markdown into Collections and Documents and writes them with nothing of this pack's ([Documents and commands](../../../../docs/public-facing/content.md#documents-and-commands)).

## Content writers

`writers/notes.ts` (`noteWriter`) is a `ContentWriter` from `@apackdev/sdk/content`, registered through `apack.json` `content.writers` (`"Note": "src/content/writers/notes.ts#noteWriter"`). An entity type's writers come from the pack that declares it, so Document's and Collection's are the SDK's (`sdkContentWriters`). Collection sets `container: true`, so a folder one pack wrote is written into by other packs, not copied; both document `find`s match a name within `parentId`. Every member is optional; without one the format applier does it directly:

- `find(record, ctx)` — the existing row for a record (`{ id, contentHash }`), replacing the entry's `identity` match. The applier first looks up the row by its content key and only falls back to `find` for rows no apply has claimed
- `create(record, ctx)` — creates the row, returns its id (call the feature's repository commands, so written entities match app-created ones)
- `update(id, record, ctx)` — writes the record's fields, and resets `ctx.clearedFields` to what `create` gives a record that doesn't set them
- `remove(id)` — deletes a row whose media copy or stamping failed after `create`

`ContentWriteContext` is `{ parentId?, index, clearedFields }`: the parent entity for tree children, the record's position among its siblings, and on update the fields the last apply set that the record no longer does (empty for `find` and `create`, and empty for an item the apply has no record of). The writer stamps `contentHash` and `contentKey` itself after `create`/`update` and records a hash per field in the pack's applied content, so hooks needn't store any of it.

## Re-applying

Written entities keep their item's `contentHash` and `contentKey`, and the app records a hash per part of what each apply wrote in the pack's applied content. A later apply writes an item only when the hash changed and every part still holds what we wrote; it leaves an edited item alone and names the parts that differ, leaves an entity with no stored hash (the user's) alone, and adopts one we wrote but have no parts for. An update resets the fields the last apply set that the item no longer sets (the Note hooks reset them to a new note's values); fields no apply set, like a user's favorite, stay. Entities are found by `contentKey`: `<packId>:<entry key>/<item identity>`, with each tree child's identity appended to its parent's key, so a renamed entity is not written again. A flow's parts are its own fields, one per node and one for its wiring. Flow and node ids come from the flow's name, so a flow whose name another pack's flow has (or whose ids a user's flow has) is not written and the apply reports it. Content this pack stops shipping is removed, unless the user has edited it. `keep-existing` skips what exists, `wipe-and-replace` first removes every entity of the entry's types, the user's and other packs' included. See `docs/public-facing/content.md`.

## Commands

Slash commands (`/name` in chat) are content, in `commands/internal/` (`chat.md`, `claude-code.md`, `codex.md`, which the directory nests in an `internal` Library folder), compiled by the SDK's `commands` key, which defaults each one to `documentType: 'commands'` — so a file here need not declare it, a file that declares another type is what it says, and a document under a `documents` key declaring `type: commands` is served as one too. A `<!-- section:field -->` block of `**name**: placeholder` lines is the whole of one. One source, so there is nothing to merge; a name two documents define keeps the first. The app serves the list from whatever command documents are in the database, so a user can edit any of them from the Library, and it publishes the list to every window. To add one:

1. Create the action (its `category` only groups it in the Actions UI)
2. Add an `on("user.command", ...)` branch in a flow (`command-listener-flow.ts` for standalone, the Claude Code and Codex flows for `cc-*`/`cdx-*`)
3. Add `**name**: placeholder` to the matching file under `commands/internal/` — `chat.md` for the app's own, `claude-code.md` or `codex.md` for a CLI's
