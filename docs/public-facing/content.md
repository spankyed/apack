# Content

A pack's content is source files compiled to JSON at build time and written into the database when the pack is installed or updated. `apack.json` `content.sources` names each one.

A declared specialty source (`actions`, `prompts`, `flows`, `documents` or `commands`) must exist; a missing path fails the build.
Completed builds validate the content index against the manifest: compiled sources are written entries,
datasets are non-written entries, and each has its compiled JSON file. Applier-only sources read their
own data and have no compiled index entry. Build publication, staging and installation refuse missing
or contradictory inventories without executing pack modules.

## The four stages

A pack's content passes through four, and each has its own vocabulary. **The content is the noun. The two verbs are `apply`, which the app does, and `import`, which the user asks for.**

| Stage | What happens | Named |
|---|---|---|
| **author** | you write the sources | `src/content/`, `content.sources`, `content.formats`, `content.writers` |
| **compile** | `apack pack build` turns them into items and hashes each one | `dist/runtime/content/*.content.json`, `content.json`, `contentHash` |
| **apply** | the app writes those items into the database, and converges them on every upgrade | `applyPacks()`, a `ContentApplier`'s `apply()`, `ApplyResult` |
| **import** | the user asks for the content back, which reads none of the record below | `importContent()`, `ImportMode`, `ImportResult` |
| **record** | the app remembers what it last wrote, part by part, so your edits survive the next import | `contentKey`, the pack's applied content |

Three things follow from the split that are easy to conflate. Editing a content source changes its `contentHash` at
**compile**, and that is what makes the next **apply** rewrite the entity — so a change with no visible effect on
the content still reaches every user who has not edited that entity. **Apply and import are different operations**:
an apply never overwrites the user's work, and an import is the user asking for the content back and does. And this
repo's `content-parity` goldens record what an apply *produces*: re-recording them
(`npm run content-parity:update -w @app/default-setup`) rewrites a test expectation and no user data.

The SDK compiles three content keys itself:

- **Actions** — async functions that do work (call LLMs, query data, emit events)
- **Prompts** — parameterized text templates for LLM calls
- **Flows** — declarative event-driven workflows that orchestrate actions

A feature's default settings go in `features.<id>.settings` (see [Feature settings](manifest.md#feature-settings)); the settings entity and its content are default-setup's (its `settings` entry and format).

Any other entity type — yours, a dependency's, or the SDK's — is written from markdown or JSON with a format and a content source in `apack.json`, and no SDK code (see [Writing entities](#writing-entities)).

## Actions

An action is an async function with typed metadata. Actions are invoked by flow steps or directly by the runtime.

### Scaffolding

```bash
apack pack add action analyze-text --category analysis
```

Creates `src/content/actions/analysis/analyze-text.ts`.

### Structure

```typescript
import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, Z } from '#generated/services.ts';

export const meta: ActionMeta = {
  label: 'Analyze Text',
  description: 'Summarizes text and classifies its intent',
  category: 'analysis',
  input: {
    text: {
      type: 'string',
      description: 'The text to analyze',
      required: true,
      placeholder: 'e.g. I need help setting up my account',
    },
  },
};

export async function action(
  params: Record<string, any>,
  services: Services,
  z: Z,
  flowId: string,
) {
  const { text } = params;

  // Use a prompt template
  const summaryPrompt = services.prompt.usePrompt('Summarize Text', {
    text,
    maxSentences: 2,
  });

  // Generate text with a model (provider:model id)
  const result = await services.inference.generateText({
    model: 'anthropic:claude-sonnet-4-5',
    instructions: 'Answer in two sentences.',
    prompt: summaryPrompt || text,
  });

  // Generate structured output with the injected zod
  const { output: classified } = await services.inference.generateText({
    model: 'openai:gpt-5-mini',
    prompt: `Classify the intent of this text: ${text}`,
    output: { type: 'object', schema: z.object({ intent: z.string(), confidence: z.number() }) },
  });

  // Log results
  services.logger.info('Analysis complete', { summary: result.text });

  return {
    summary: result.text,
    intent: classified.intent,
  };
}
```

### How an action runs

The compiled body of `action` runs in one sandbox, whether a flow's action step runs it or another action calls it through `services.action` (`executeAction`, `executeIfFound`). It receives:

- `params`: the step's resolved input (or the params the caller passed)
- `services`: the object below, with `services.logger` named `action:<label>`, so the Logs view shows which action logged
- `z`: zod, for schemas
- `flowId`: the running flow's run node id when a flow step runs it; `undefined` otherwise

### Available services

Actions receive the accepted service view supplied by their executing pack, with an attributed logger and emitter. The default-setup action runner supplies its own declared services and selected host APIs. The tables below describe that runner.

Ordinary pack source imports its own `services` and `Services` from `#generated/services.ts`: own services and the SDK baseline are implicit, while host/dependency APIs require `consumes.services`. Depending on default-setup alone does not grant its services. See [service selection](services-and-data.md#services).

**default-setup's services**

| Service | Description |
|---|---|
| `services.chat` | Chat messages and blocks (`sendBlockMessage`, `sendSystemMessage`, `sendChoiceBlock`, `sendQuestionBlock`, `createThreadAndNotify`, …) |
| `services.threads` | Thread chat state (`updateChatState`) |
| `services.artifact` | Artifact creation and updates (`createAndNotify`, `updateAndNotify`, `findOrCreateByType`) |
| `services.library` | Library documents and folders (`find`, `findByCode`, `findByName`, `findByPath`, `getText`, `list`, `create`, `update`, `createFolder`, `rename`, `move`, `remove`). The chat's slash commands are not here: they are a derivation over stored documents, read with `getCommands()` (see [Slash commands](#slash-commands)) |
| `services.prompt` | Prompt templates (`usePrompt`, `findByLabel`) |
| `services.action` | Look up and run actions (`findByLabel`, `executeAction`, `executeIfFound`) |
| `services.brain` | Ad-hoc brain event listeners (`listen`, `unlisten`) |
| `services.scheduler` | Cron schedules for flow triggers (`registerSchedule`, `unregisterByPrefix`, `clearAllSchedules`) |
| `services.database` | Live-data schema and topology context for AI query generation (`buildQueryContext`) |
| `services.cli` | CLI tools: `git`, `github` (pull requests, with the app's GitHub sign-in), `claudeCode`, `codex`, plus `testCli` |
| `services.codex` | The Codex app-server (threads, turns, approvals, sessions) |

**Host services**

| Service | Description |
|---|---|
| `services.inference` | Model calls (`generateText`, `streamText`, `createAgent`, `embed`/`embedMany`, `generateImage`, `generateSpeech`, `transcribe`, `rerank`) with the user's provider keys; see [Inference](services-and-data.md#inference) |
| `services.repository` | The pack's declared repositories (queries and commands); actions read and write data through them |
| `services.settings` | Caller-bound preferences: `get(target)`, `set(target, path, value, condition?)`, `reset(target)` and `onChange(listener)`. Targets identify host app, pack-group or feature preferences; target mutation policy still applies |
| `services.logger` | Structured logging, named `action:<label>` |
| `services.emitter` | Typed sends to surfaces and systems (`broadcastToSurface`, and `sendToSystem` naming a system `<pack>/<feature>`, such as `'my-pack/bookmarks'`, or a role, `{ role: 'brain' }`) |
| `services.appData` | Reset, export and import app data, and inspect backup metadata |
| `services.onboarding` | Read and complete onboarding (`isComplete`, `complete`) without granting whole-data administration |
| `services.runHistory` | Flow runs: each run's tree of nodes, recorded while it runs and kept after |
| `services.secrets` | The user's API keys as metadata (`list`, `select`, `rename`, `delete`, `status`); never values |
| `services.filesystem` | Files and folders on disk, as UTF-8 text (`readFile`, `writeFile`, `readDir`, `mkdir`, `stat`, `exists`, `rename`, `remove`) |

### Metadata

`ActionMeta` (`@apackdev/sdk/build`):

| Field | Type | Description |
|---|---|---|
| `label` | `string` | The action's name: flow `action` steps and `services.action.findByLabel` find it by label. Two actions with one label fail the build |
| `description` | `string?` | Shown in the Actions UI |
| `category` | `string?` | Groups the action in the Actions UI (`apack pack add action --category`, default the pack id) |
| `input` | `Record<string, ActionParameter>` | The parameters, by name |
| `output` | `unknown?` | A description of the result, stored with the action |

`ActionParameter`: `type` (`'string' \| 'number' \| 'boolean' \| 'object' \| 'array' \| 'any'`), `description?`, `required?`, `default?`, `placeholder?`. These describe the parameters; nothing validates `params` against them or fills in `default` when the action runs.

### Parameters

The build keeps only the function's body, and the runtime calls it with fixed parameter names, so keep them named `params`, `services`, `z` and `flowId`:

| Parameter | From a flow `action` step | From `services.action.executeAction(actionFn, params)` / `executeIfFound(label, params)` |
|---|---|---|
| `params` | The step's `params`, overridden by its resolved `map` (see [Mappings](#mappings)) | `params` |
| `services` | The app's `services` | The app's `services` |
| `z` | zod | `undefined` |
| `flowId` | The running flow's run node id | `undefined` |

The function's return value is the step's result (`$.lastStep.result`).

### Rules

The build bundles each action file with esbuild and extracts its `meta` and the body of `action`:

- **Imports**: a relative import is bundled into the action. The only package import allowed is `@apackdev/sdk/actions` (`formatProviderError(error, provider, alternatives?)`, `buildTranscript(messages, { maxMessages?, maxChars? })`); any other package, `node:` modules included, fails the build. Type-only imports (`ActionMeta`, `Services`, `Z`) are erased and always allowed.
- **Node globals** (`require`, `process`, `__dirname`, `__filename`, `Buffer`, `global`) in the bundled code only produce a build warning, but the action runs in the app's backend without them.
- **`meta` is evaluated on its own**: write it as an object literal that references no imports or other variables.
- **Top-level helpers** (functions and constants next to `action`) are inlined into the action. A helper function whose only uses are direct calls can declare a `services` parameter: the build removes it and the helper uses the action's `services`.
- **Model calls need no imports**: `output` is data (`{ type: 'object', schema }`, `{ type: 'choice', options }`, …), tools are plain `{ description, inputSchema, execute }` objects, and `stopWhen` is a function. Agents, embeddings, images and speech work the same way (`services.inference.createAgent`, `embed`, `generateImage`, …). See [Inference](services-and-data.md#inference).
- **Scanning**: every `.ts` file under the directory, subdirectories included, is compiled when it has a line starting `export const meta`. Other files (shared helpers) and `*.example.ts` files are skipped. A `_` prefix doesn't skip an action file.

## Prompts

A prompt is a synchronous template function with typed inputs.

### Scaffolding

```bash
apack pack add prompt summarize-text
```

Creates `src/content/prompts/summarize-text.ts`.

### Structure

```typescript
import type { PromptMeta } from '@apackdev/sdk/build';

export const meta: PromptMeta = {
  label: 'Summarize Text',
  description: 'Generates a concise summary of the provided text',
  category: 'analysis',
  inputs: {
    text: {
      name: 'text',
      type: 'string',
      required: true,
      description: 'The text to summarize',
    },
    maxSentences: {
      name: 'maxSentences',
      type: 'number',
      defaultValue: 3,
      description: 'Maximum sentences in summary',
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'The generated summary' },
    },
  },
};

export function template(params: Record<string, any>) {
  const maxSentences = params.maxSentences || 3;

  return `Summarize the following text in ${maxSentences} sentence(s) or fewer.

Text:
${params.text}`;
}
```

### Metadata

`PromptMeta` (`@apackdev/sdk/build`): `label` (unique; a duplicate fails the build), `description?`, `category?`, `inputs: Record<string, TemplateInput>`, `outputSchema?`.

`TemplateInput`: `name`, `type` (`'string' \| 'number' \| 'boolean' \| 'object' \| 'array' \| 'any'`), `description?`, `required?`, `defaultValue?`, `example?`. Like an action's parameters, these describe the inputs; the template applies its own defaults.

### Rules

- `template(params, usePrompt)` must be **synchronous** and return a string. Keep the parameters named `params` and `usePrompt`: the build keeps only the body.
- `usePrompt(label, params)` renders another prompt by label (up to 10 levels deep), returning `undefined` when there's none.
- Prompt files are scanned and bundled like actions: `export const meta`, relative imports, `@apackdev/sdk/actions` as the only package import, no `*.example.ts`.
- Prompts are rendered by label with `services.prompt.usePrompt('Summarize Text', params)`, or by a flow's `llm` step.

## Flows

A flow is a declarative workflow composed of steps. Flows use a DSL with typed helpers generated from your pack's step definitions.

### Scaffolding

```bash
apack pack add flow onboarding
```

Creates `src/content/flows/onboarding.ts`.

### Structure

```typescript
import type { FlowDSL } from '@apackdev/sdk/build';
import { entry, on, keepAlive, action, fire, branch, subflow } from '#generated/flow-helpers.ts';

export default {
  // Linear: entry -> action -> fire
  'Analysis Flow': [
    entry([
      action('Analyze Text', { label: 'analyze' }),
      fire('analysis.complete', { label: 'notify' }),
    ]),
  ],

  // Long-running: init + keep alive + event listeners
  'Monitor Flow': [
    entry([
      action('Initialize', { label: 'init' }),
      keepAlive(),
    ]),
    on('user.message', [[
      action('Process', { label: 'process' }),
      fire('message.processed'),
    ]], 'Handle Message'),
  ],

  // Branching: action -> conditional branches
  'Support Flow': [
    entry([
      action('Classify', { label: 'classify' }),
      branch(
        [
          // A bare key reads the previous step's result: Classify returned { intent }
          { if: "intent == 'question'", steps: [
            action('Lookup', { label: 'lookup', map: { question: '$.event.data.payload.text' } }),
          ]},
          { if: "intent == 'request'", steps: [
            action('Process Request', { label: 'process' }),
          ]},
        ],
        [fire('support.escalated', { label: 'escalate' })],
      ),
    ]),
  ],

  // Parallel entry branches
  'Setup Flow': [
    entry(
      [action('Load Config', { label: 'config' })],
      [action('Warm Cache', { label: 'cache' })],
      [keepAlive()],
    ),
  ],

  // Sub-flow delegation
  'Orchestrator Flow': [
    entry([
      subflow('Analysis Flow', { label: 'run analysis' }),
      fire('orchestration.complete'),
    ]),
  ],
} satisfies FlowDSL;
```

### Flow definitions

A flow file's default export is a `FlowDSL` (`@apackdev/sdk/build`): flow name → a `Track[]`, or a `FlowConfig`.

| Type | Fields |
|---|---|
| `FlowConfig` | `tracks: Track[]`; `root?: boolean` marks the root flow, which the brain starts when the app starts (at most one; default-setup's `Root Flow` is the app's); `contentHash?` is written by the build, a hash of `tracks` and `root` |
| `Track` | One trigger field (`event` for a listener, `schedule` for a schedule), `label?`, `description?`, `exits: DSLStepNode[][]` (each exit a chain of steps, run in parallel) |
| `DSLNodeBase` | Options every step helper takes: `label?`, `description?`, `final?`, `next?` |

Every other flow runs as a subflow that a running flow spawned: default-setup's `Root Flow` spawns its long-running work modes from its entry track. An event reaches every running flow (see `fire`'s `scope`).

The root also receives `client.ready` once per run after this pack's frontend has become available.
If the frontend was already seen when a root starts or restarts, that new root receives readiness too.
This is a lifecycle signal to that root actor, not a broadcast or a count of live connections. Reconnects
and additional windows do not repeat it in the same run. A paused root defers the signal; replacing or
stopping the root discards its pending delivery. A data restore leaves the root stopped until explicitly
started. Default-setup's authored root uses readiness to check host onboarding completion and start or
resume its onboarding workflow; a custom root need not do so. Backend flow entry can run before any
frontend exists, when frontend sends are ignored, so presentation-dependent startup belongs behind
readiness rather than an unconditional entry track.

**A worked example of the exported form** lives in the apack repo at
`packages/default-setup/tests/extensions/steps/__golden__/exported-flows.json` — what
`exportFlowsToDSL` writes for a flow that uses every step default-setup registers, including a
`FlowConfig` with `root`, the `exits` nesting and a `subflow` reference. It is recorded by the spec
beside it rather than kept by hand, so it cannot drift from the types: re-record it with
`npm run flow-export:update -w @app/default-setup`, and never edit it.

A step's options:

| Option | Effect |
|---|---|
| `label` | The node's label. Defaults per step (the action or prompt name, the event, the flow name, `Create <entity>`, `Switch <index>`, …). Labels are unique within a flow, across its tracks, branches and track labels: a duplicate fails the build (`Duplicate step label`), so label repeated steps, and give a step an explicit label when its default matches an `on()` track's (`fire('x')` beside `on('x', …)`) |
| `description` | Stored on the node, shown in the editor |
| `final` | When this step completes, the flow completes with the step's result (a subflow's result becomes its step's result in the parent) |
| `next` | Continues at the node with this label in the same flow instead of the next step in the chain; an unknown label fails validation |

A flow without a `final` step completes when all its tracks drain, unless it has a `schedule` track. `keepAlive()` never completes, so its track never drains.

### Flow helpers

`#generated/flow-helpers` exports `entry` and `on` from the SDK, a helper per step with a `dsl` entry in the manifest, and a track builder per trigger other than `event` (see [Flow helpers](extensions.md#flow-helpers)). A pack gets its dependencies' flow helpers re-exported too: `generate-entries` writes each dependency's as `src/__generated__/deps/<id>.flow-helpers.{js,d.ts}` from its snapshot. Each helper's `opts` is typed from its step's `DSL…Node` interface.

default-setup's helpers:

| Helper | Step type | Options (besides `label`, `description`, `final`, `next`) | Does |
|---|---|---|---|
| `entry(...exits)` | `listener` track | — | The `flow.entry` track, run when the flow starts. Each argument is a chain; several run in parallel. Needs at least one (`entry([keepAlive()])`) |
| `on(event, exits, label?)` | `listener` track | — | Runs `exits` when the flow receives `event`. `label` defaults to the event |
| `schedule(cron, exits, label?)` | `schedule` track | — | Runs `exits` on a cron schedule (5 or 6 fields, checked at build) while the flow runs. `label` defaults to `Schedule (<cron>)`. The flow doesn't complete when its tracks drain |
| `action(action, opts?)` | `action` | `map?: Record<string, string>`, `params?: Record<string, any>` | Runs the action with this label; the result is its return value. The label must be an action this pack's `actions` content compiles |
| `llm(prompt, opts?)` | `llm` | `map?`, `model?: ModelId` (`provider:model`, default `anthropic:claude-opus-5`), `temperature?`, `maxTokens?`, `systemPrompt?` | Renders the prompt with this label with the mapped params and calls `services.inference.generateText`. Result `{ text, usage, finishReason, warnings? }`. The label must be a prompt this pack's `prompts` content compiles |
| `fire(event, opts?)` | `fire` | `scope?: 'local' \| 'global'` (default `local`), `payload?: unknown` | Sends `event` with `payload`: its `$.` strings are resolved at any depth of objects and arrays (`'$.lastStep.result'` gives the value itself), other values are literal. `local` sends to the flow running the step, `global` to every running flow; `services.brain` listeners get it in either scope, with `targetFlowId` set for `local`. Result `{ eventFired, eventScope, targetFlowId, payload }` |
| `subflow(flow, opts?)` | `subflow` | `inherit?: boolean` (default `true`), `map?` | Starts the flow with this name and completes when it does. Its `flow.entry` event data holds the mapped fields (`$.event.data.<target>`). With `inherit` it also holds the parent track's event data (a mapped field wins), and the entry track starts with the parent track's steps, so `$.lastStep` and `$.steps[label=…]` read the parent's until the subflow runs its own |
| `branch(conditions, else?, label?)` | `switch` | — | `conditions: { if: string; steps: DSLStepNode[] }[]`, `else?: DSLStepNode[]`. Runs the steps of the first condition that matches (see [Switch conditions](#switch-conditions)), else `else`; with no match and no `else` the chain ends. After a branch's steps, the chain continues with the step after the switch |
| `keepAlive(label?)` | `keep_alive` | — | Never completes: keeps its track, and the flow, running |
| `kill(label = 'Kill Flow')` | `kill` | — | Stops the flow running the step |
| `query(prompt, opts?)` | `query` | `as?: string` (default `rows`, not `query`), `model?: ModelId` (default `anthropic:claude-opus-5`) | The model turns `prompt` into a read-only EARS query, instructed by the `DB Query System` prompt with `services.database.buildQueryContext()`, and the step runs it with the database console's read-only executor. Result `{ query, [as]: value }`. Fails when the model can't be called, returns no query, or the query fails or writes |
| `create(entity, opts?)` | `create` | `map?`, `params?: Record<string, unknown>` (literal fields; mapped fields win), `inferLabel?: boolean` (default `true`) | Creates an entity of type `entity`, which must be registered in the running app (`isEntityType`: the SDK's or any registered pack's). Without a `label` field, the label comes from `title`, `name` or `topic`, else `New <Entity> <n>`. Result the created row |
| `update(target, opts?)` | `update` | `map?`, `params?`, `onMissing?: 'fail' \| 'ignore' \| 'create'` (default `fail`), `entity?: string` | Writes the fields to the entity with id `target`: a `$.` path resolved when the step runs (`$.lastStep.result.id` after a `create`; `$.lastStep.id` is the step's run-history node, not an entity, so an update to it finds none) or a literal id. A `null` field drops it. Result the row with `updated: true`. With no such entity, `fail` errors naming the id, `ignore` results `{ updated: false }`, and `create` creates an `entity` (required at build) with the fields, result the row with `updated: false, created: true` |
| `transform(script, opts?)` | `transform` | `outputType?: 'json' \| 'text' \| 'custom'` (default `json`), `map?` | `script` is an async function body run as an action runs (`services.action.executeAction`), with `services` and `params`: `params.input` is the previous step's result, then the mapped fields (a mapped `input` replaces it). Result: `json` the returned value round-tripped through JSON (fails if it isn't serializable), `text` `String(value)`, `custom` the value as returned. A script error fails the step with `Transform step "<label>" script failed: <message>` |

`action`, `llm`, `fire`, `subflow`, `create` and `update` option names come from their `DSL…Node` interfaces in `packages/default-setup/src/extensions/steps/<step>/types.ts`.

### Mappings

A step's `map` is `{ target: source }`. Each source is resolved when the step runs:

- A string starting `$.` is a path into the step's execution context. `[field=value]` picks an array item.
- Any other string is parsed as JSON when it parses (`'3'` → `3`, `'true'` → `true`), otherwise used as a literal string.
- A value that resolves to `undefined` is passed as `undefined`.

An `action` step's `params`, and a `create` or `update` step's fields, are the step's `params` with the mapped values over them; `llm` renders its prompt with the mapped values.

| Path | Value |
|---|---|
| `$.event.type` | The event that started the track (`flow.entry`, `user.command`, `schedule.<node id>`) |
| `$.event.data` | The event's data |
| `$.event.data.payload` | A sent event's payload: what `fire`'s `payload` holds, or what a client or `runFlow` sent (`$.event.data.payload.text`) |
| `$.event.data.<target>` | In a subflow's `flow.entry` track, the subflow step's mapped field, or, when it inherits, the parent event's field |
| `$.lastStep.result` | The result of the step that ran before this one in the track (`$.lastStep.label` its label) |
| `$.steps[label=<label>].result` | The result of an earlier step in this track, by label (`$.steps[id=<run node id>]` by run node) |

`$.steps` holds only the track's own steps, in the order they completed (a subflow that inherits starts its entry track with the parent track's).

### Switch conditions

A condition's `if` is `<key> <operator> <value>`:

- **Key**: a `$.` path into the execution context, or a bare key read from the previous step's result (`intent` is `$.lastStep.result.intent`). An `if` with no operator is `<key> == true`.
- **Value**: a `$.` path, `true`/`false`, a number, a quoted string (`'question'`), or otherwise the rest of the text as a string.

| Operator | Matches when |
|---|---|
| `==`, `===` | loosely equal (`==`) |
| `!=`, `!==` | loosely not equal |
| `>`, `<`, `>=`, `<=` | both sides compared as numbers |
| `contains`, `starts_with`, `ends_with` | the key's value as a string contains, starts or ends with the value |
| `matches` | the value, as a regular expression (up to 500 characters), matches the key's value |
| `is_empty` | the key's value is `null`, `undefined`, `''`, `[]` or `{}` (takes no value) |
| `is_null` | the key's value is `null` or `undefined` (takes no value) |

### Rules

- The default export is the `FlowDSL` object (`export default { ... } satisfies FlowDSL`). Flow files run at build time in Node, so they can import anything; import step helpers from `#generated/flow-helpers`.
- Only the `.ts` files directly in the flows directory are read, not subdirectories. Files starting with `_` and `*.example.ts` files are skipped, so shared flow pieces can live in `_helpers.ts`.
- A flow name defined twice, or more than one `root: true`, fails the build.
- At build time, `action` and `llm` steps must name actions and prompts this pack's own `actions` and `prompts` content compile. At apply time a flow is checked again against every action and prompt in the database; a flow that fails is reported and not written.

## Manifest configuration

Point your manifest at the content directories:

```json
{
  "content": {
    "sources": {
      "actions": "src/content/actions",
      "prompts": "src/content/prompts",
      "flows": "src/content/flows",
      "documents": "src/content/documents",
      "commands": "src/content/commands"
    }
  }
}
```

A specialty key takes its path as a string or `{ "path": … }`; any other key is a [content source](#writing-entities). `apack pack build` compiles each key into `<key>.content.json` (media into `media/<key>/`) and writes `content.json`, which names the pack and indexes the keys and their items for Settings → Import Pack Content. Writing runs at boot and when a pack is installed or reloaded, in `replace-on-collision` mode, and is skipped when the compiled output's hash hasn't changed. The hash covers every written key's compiled file, so changing one key's source re-runs the pack's boot apply, its other rows still being skipped by their own hashes. At boot, packs content in dependency order, so a pack's content can reference what a pack it declares a dependency on written. An apply that reports errors fails: an external pack's error is recorded on its installed-packs entry, and the same output isn't retried until it changes — or until one of the packs it depends on content, since that is the other thing that can change the outcome. Installing the pack again is also a fresh attempt, even at the version already installed: an install replaces the compiled files, and what was last written is remembered as the files and not only their contents.

### Documents and commands

`documents` and `commands` compile a directory of markdown into the SDK's document model, so any pack ships
documents with no format, writer or dependency of its own. A directory is a `Collection` (its `_meta.md`
frontmatter gives `name` and `description`); a file is a `Document` (frontmatter `name`, `tags: [a, b]` and
`type`). A `<!-- section:<type>[:<param>] -->` marker starts a section — `markdown`, `text`, `code:<language>`,
`field` (`**key**: value` lines) or `list` (`- item` lines) — and a body with no marker is one markdown section.
A `media/` directory at the source's root is copied beside the records, and a document's `media/<file>` links
become its media. `parseDocumentSections` and `serializeDocumentSections` (`@apackdev/sdk/content`) read and
write that syntax for code that imports or exports documents. The two keys differ in one default:
under `commands` a document is a [command list](#slash-commands) unless its `type` says otherwise.

### Include sets

ContentAppliers take an include set per key (`ContentSelection = true | ReadonlySet<string>`, from `@apackdev/sdk/utils`). `true` or no entry content every item; a set content only the top-level items it names, and an empty set skips the key. The boot apply includes every key; Import Pack Content builds them from the items the user picks. Items are named as `content.json` lists them:

| Key | Item name |
|---|---|
| `actions`, `prompts` | The label |
| `flows` | The flow name |
| `documents`, `commands` | The top-level document's or folder's name |
| A content source | The record's first `identity` field other than `parent`, else its `name`, `title` or `label` |

## Writing entities

Content rows of an entity type from markdown or JSON in two parts of `apack.json`:

- **A format** in `content.formats` says how a source becomes records: a built-in format (`markdown-tree` or `json`) or a compiler module, and the settings it uses.
- **A content source** in `content.sources` names a source and the format that compiles it: `{ "path", "format" }`. The entry key is yours to name.

```json
{
  "features": {
    "memos": {
      "description": "Short notes the pack ships.",
      "entities": { "Memo": { "shape": "src/features/memos/be/types.ts#MemoAttributes" } }
    }
  },
  "content": {
    "formats": {
      "memos": {
        "format": "markdown-tree",
        "entity": "Memo",
        "identity": ["title", "parent"],
        "tree": { "branch": "index.md", "relKind": "contains" },
        "fields": {
          "title": { "from": "frontmatter.title", "default": "filename", "type": "string" },
          "pinned": { "from": "frontmatter.pinned" },
          "text": { "from": "body" }
        },
        "media": "media"
      }
    },
    "sources": {
      "memos": { "path": "src/content/memos", "format": "memos" }
    }
  }
}
```

An entry can't set or change any format settings; a pack that needs different settings defines its own format. Format names are lowercase with hyphens.

| Format field | Description |
|---|---|
| `format` / `compiler` | Exactly one: `markdown-tree`, `json`, or a compiler module path (see [Compiler modules](#compiler-modules)) |
| `entity` | The entity type the items are written as, or an array of types. Each record's `entity` must be one of them (and `tree.branchEntity`); a built-in format tags records with `entity` only when it's a single string. Omitted, the source is a dataset: compiled and never written, so it belongs under `content.datasets`. Each type must be declared by the pack, a dependency or the SDK |
| `identity` | Fields matched to find an existing row. `"parent"` also requires the row to be linked from the record's tree parent by `tree.relKind`. Required unless the entity type has a `find` hook: writing a record without either fails |
| `tree.branch` | A directory's own file (`index.md`) giving the directory's frontmatter and body |
| `tree.branchEntity` | The entity type directories become; defaults to `entity` |
| `tree.relKind` | The relation from a parent row to each child row; defaults to `contains` |
| `fields` | `markdown-tree` only (the manifest rejects it elsewhere): record field → `{ from, default?, type? }` |
| `media` | A relative directory under an entry's `path` (no `.` or `..` segments), copied with the content |

### Markdown

- Each `.md` file is a record, and `entity` is a single type (`tree.branchEntity` gives directories theirs). Frontmatter is YAML 1.2 (CRLF line endings and a byte order mark are fine), so `title: 2024` reads as a number; `"type": "string"` coerces it back.
- `fields` maps record fields to a source: `body` (the markdown after the frontmatter), `filename` (the file or directory name with dashes as spaces), `path` (relative to the entry's `path`) or `frontmatter.<name>`. `default` applies when the source is absent, `null` or an empty string (`title:` or `title: ""`); `"filename"` as a default means the display name. A field with no value and no `default` is left out of the record. Content track the fields a record sets (see [Change tracking](#change-tracking)), so leave defaults a user may change, like flags, to the entity's defaults or a `create` hook.
- With `tree`, each subdirectory is a parent record (its `branch` file gives its frontmatter and body, `branchEntity` its type) and its files are children, linked with `relKind`. Without `tree`, only the top-level files are read.
- `media` is a directory under the entry's `path`, copied with the content and not read as records (no other directory is skipped); `![alt](media/pic.png)` links in any of a record's text fields (nested values included) are rewritten to the row's `media://<id>/pic.png`.

### JSON

```json
"content": {
  "formats": { "tags": { "format": "json", "entity": "Tag", "identity": ["name"] } },
  "sources": { "tags": { "path": "src/content/tags.json", "format": "tags" } }
}
```

The file holds an array of records (or `{ "records": [...] }`); a record may carry its own `entity` and `children`.

### Compiler modules

When a source needs parsing that field sources can't express, give the format a `compiler` module instead of a built-in `format`. Its default export gets a `ContentCompileContext` (`key`, `path`: the entry's absolute path, `packDir`: the writing pack's directory, `format`) and returns records, or a promise of them, each tagged with its `entity`:

```typescript
// src/content/compilers/glossary.ts
import { compileMarkdownTree, type ContentCompileContext, type ContentItem } from '@apackdev/sdk/build';

export default function compileGlossary({ path, format }: ContentCompileContext): ContentItem[] {
  // Skip the format's media directory, if it has one
  return compileMarkdownTree(path, { media: format.media }).map((item) => ({
    entity: 'Term',
    term: String(item.frontmatter.term ?? item.displayName),
    definition: item.body.trim(),
  }));
}
```

```json
"content": {
  "formats": { "glossary": { "compiler": "src/content/compilers/glossary.ts", "entity": "Term", "identity": ["term"] } },
  "sources": { "glossary": { "path": "src/content/glossary", "format": "glossary" } }
}
```

The build loads TypeScript compiler modules itself, and bundles every compiler module your formats name into `dist/build/content-compilers.mjs` so packs depending on yours can use those formats. A record's `contentHash` defaults to a hash of its fields (and its children's hashes); set it yourself to decide what counts as a change. A format without `entity` is compiled but not written: pack code reads `<key>.content.json` (default-setup's FAQs work this way).

### ContentApplier modules

An entry `{ "applier": "src/content/custom.ts" }` (no `path` or `format`) replaces the format and the format applier with the module's named export `apply`, which the generated `appliers.ts` puts in the pack's registration under the content key. The build compiles nothing for it, so the module brings its own data.

An entry with all three, `{ "path", "format", "applier" }`, is compiled with the format, and the module's `content` content the compiled `<key>.content.json` instead of the format applier, even when the format names no entity — for content whose rows the format applier cannot place, where the compiler still does the reading.

```typescript
// src/content/custom.ts
import type { ApplyContext, ApplyResult } from '@apackdev/sdk/utils';

export function apply(ctx: ApplyContext): ApplyResult {
  ctx.log('  custom content');
  return { created: 0, updated: 0, skipped: 0 };
}
```

| `ApplyContext` | Description |
|---|---|
| `compiledDir` | The pack's compiled content directory |
| `include?` | This key's include set (see [Include sets](#include-sets)) |
| `mode?` | `'keep-existing' \| 'replace-on-collision' \| 'wipe-and-replace'` (see [Change tracking](#change-tracking)) |
| `log(...args)` | Logs when writing is verbose |

`apply` is synchronous and returns `ApplyResult`: `created`, `updated`, `skipped`, and `errors?: string[]`, where a non-empty list fails the run.

### A dependency's formats

An entry can name a format of a pack it depends on as `"<pack id>:<name>"`. It compiles your sources with that pack's settings and compiler module, so you get the same records it would:

```json
{
  "dependencies": { "default-setup": "*" },
  "content": {
    "sources": {
      "team-notes": { "path": "src/content/notes", "format": "default-setup:notes" }
    }
  }
}
```

default-setup's formats:

| Format | Content | Sources |
|---|---|---|
| `notes` | `Note` | Markdown notes; frontmatter `title`, `type` (`document`, `tasklist`, `task`), `icon`, `favorite`, `hideCompletedChildren`, `completed`. A directory is a parent note, its `index.md` giving the parent's frontmatter and content |
| `faqs` | none (compiled only) | The Help tab's FAQs; not useful to other packs |

Any pack can define a format for any entity type it can write (its own, a dependency's or the SDK's). Only the pack that declares an entity type defines its content writers.

### Content writers

Without hooks, the applier writes rows directly: it matches existing rows on the format's `identity`, creates new ones with their fields, and links children with `tree.relKind`. When an entity type needs more — shortCodes, ordering, validation, derived links — the pack that declares the type registers content writers for it:

```json
{
  "features": {
    "memos": {
      "description": "Short notes the pack ships.",
      "entities": { "Memo": { "shape": "src/features/memos/be/types.ts#MemoAttributes" } }
    }
  },
  "content": {
    "writers": { "Memo": "src/content/writers/memos.ts#memoContentWriter" }
  }
}
```

```typescript
// src/content/writers/memos.ts
import type { ContentWriter, ContentItem } from '@apackdev/sdk/content';
import { repository } from '#generated/repository.ts';

export const memoContentWriter: ContentWriter<ContentItem & { title: string; text: string; pinned?: boolean }> = {
  find: (record) => repository.memoQueries.byTitle(record.title),       // { id, contentHash } | undefined
  create: (record, { parentId, index }) => repository.memoCommands.add({ title: record.title, text: record.text, pinned: record.pinned }).id,
  // clearedFields: fields the last apply set that the item no longer sets, reset to a new memo's
  update: (id, record, { clearedFields }) => repository.memoCommands.update(id, {
    title: record.title,
    text: record.text,
    pinned: record.pinned ?? (clearedFields.includes('pinned') ? false : undefined),
  }),
  remove: (id) => repository.memoCommands.delete(id),
};
```

| `ContentWriter<R>` member | Called | Returns |
|---|---|---|
| `container?: boolean` | Not called: it marks the entity a holder of other records (a folder) | — |
| `find?(record, context)` | To match a record that no row's `contentKey` matches; replaces `identity` | `{ id, contentHash? }` or `undefined` |
| `create?(record, context)` | For a record with no row | The new row's id |
| `update?(id, record, context)` | For a changed record whose row isn't edited | — |
| `remove?(id)` | By `wipe-and-replace`, and to undo a create whose media copy or stamping failed | — |

`container` is how two packs share a folder. An entity another item's apply claimed (another pack's, or another entry's of your pack) is normally not yours, whatever its name, so your item writes an entity of its own beside it. When the entity's hooks set `container: true`, your record's `find` match is reused as the parent instead: its children are written under it in every mode (`keep-existing` skips only the children that exist), and the row itself is never updated, stamped or re-keyed — it stays the item that wrote it. The run counts it as skipped. Whichever item creates the entity first owns it: the fields another item sets on it (a folder's description) are dropped. The entity is found by `find` on every apply, so if the user renames or moves it, the next apply creates the folder again where your records expect it. The SDK sets it on `Collection`, so a pack writing `internal/commands/mine.md` under its `documents` or `commands` key puts its document in the existing folders rather than forking them. Its `find` hooks match a name within `parentId`, so a folder of the same name elsewhere is a different entity.

`ContentWriteContext`: `parentId?` (the tree parent's entity), `index` (the record's position among its siblings), `clearedFields: string[]` (on `update`, the fields the last apply set that the item no longer sets; empty for `find` and `create`). A missing hook falls back to the format applier's behavior. A hook that throws fails that record (reported in the run's errors) and writing moves on.

`create` and `update` store the record's fields under their names, as the record gives them, and `update` writes every field the record sets: change tracking records those fields' stored values. `update` also resets the fields in `clearedFields` to what `create` gives a record that doesn't set them (see [Change tracking](#change-tracking)). Hooks are keyed by entity type, not by format, so every pack that writes `Memo` — with your format, its own, or one depending on yours — goes through them. A `find` hook replaces the format's `identity`. default-setup registers hooks for `Note`. `Document` and `Collection` are the SDK's entities, and so are their hooks — a pack declares hooks only for entity types it owns, so these need no registration and are always present. Either way, entities written with those formats get the same shortCodes, display order and links as rows created in the app.

### Change tracking

Written entities store their item's `contentHash`, and the app keeps, per pack, one entry per entity it has written: a hash per **part** of what it wrote. A part is one addressable piece of the item — a field's name for an ordinary entity; a flow's own fields, each of its nodes, and its wiring. A part is edited when it no longer holds what the applier wrote, whatever changed it (the app's editors, the database console, a flow). Fields an item doesn't set aren't parts: a user can favorite a written note and it still takes updates.

Parts rather than one hash per item is what keeps an edit from spreading. A thirty-step flow has thirty-two parts, so editing one step's description marks that step edited and says so, rather than marking the flow edited with nothing to say what — which used to freeze all thirty of its rows against every later version, silently and for good.

When a changed item no longer sets a field the last apply set (the source dropped `completed: true`), updating the entity resets that field: without hooks the applier drops it from the row, and an `update` hook gets it in `clearedFields` to reset (default-setup's Note hooks reset it to a new note's value). A field no apply of the entity ever set, like a user's favorite, isn't touched.

Written entities also store a `contentKey`: the writing pack's id, the entry key and the record's identity in the source (for a tree, its ancestors' too). An apply finds a row by its `contentKey` first, so a row the user renamed is still found, left as renamed (a renamed row is edited), and not written again as a copy. Two packs' records with the same entry key and identity content a row each. A row without a `contentKey` that matches a record's identity (a user's row with the same name) isn't written again beside it. The pack id comes from `content.json`, which `apack pack build` writes; writing compiled content without it fails until the pack is rebuilt.

Flows follow the same rules, with the parts above: its row's fields, each node's values, and its wiring (independent of the relations' order). Editing a node marks that node, adding or removing one marks it and the wiring, and renaming the flow marks its fields. Moving nodes in the editor doesn't mark anything.

Unlike other entities, a flow's id and its nodes' ids come from the flow's name, so flows can't share a name: a pack's flow isn't written when another pack has already written a flow with its name, or a user's flow has the ids it would write. The existing flow is left as it is and the run reports an error (`Flow "X": a flow with this name already exists (written by <pack>)`, or `(created by the user)`). A user's flow with the name (and its own ids) is left alone as user-owned, as for other entities.

A subflow step naming a flow the same pack writes runs that flow, however the user renamed it, and never another flow with its name. When the pack's apply left a user's or another pack's flow with that name in place of its own, the step runs that flow. Other names run the flow with that label.

Re-applying follows the same rules for every entry:

| Import mode | Existing row |
|---|---|
| `replace-on-collision` (and the boot apply) | Updated only when the stored hash differs and the row isn't edited. A row with no stored hash is treated as user-created, and an edited row is left as it is. Children are still visited. |
| `keep-existing` | Left alone, with its children. |
| `wipe-and-replace` | Every row of the entry's entity types (its format's `entity`) is removed first, whoever created it: the user's rows and other packs' rows of those types too, even when the entry has no records of a type. Then all records are created. |

Rows without a stored `contentHash` (rows users created) stay user-owned, in every mode. A row the app wrote but has no parts for — one written by a version from before it recorded them — is **adopted**: written once and recorded, after which its edits are honoured. That overwrites an edit made before the record existed, which is the trade for not freezing every such row for good.

**A written entity the user threw away is not written again, and nor are its children.** An apply finds its own entity by `contentKey` whether or not it is in the trash (`query.withTrashed`), so a trashed entity (`write(id).trash()`) is one the user has taken ownership of: it is left alone, and its children are not visited — they would be created under a deleted parent. This is the same rule as the ones above, and it means a pack needs no policy to say "write this only on a first run".

**An entity deleted outright is not written again either, because the app remembers writing it.** Nothing is left of it, so what answers for it is the pack's record of what it wrote: a key it wrote with no entity behind it now is one the user removed. The rule holds whatever your feature's delete does — a trashed entity is read directly, a destroyed one through the record.

### Theirs or offer: what happens to an item the user edited

Every outcome above leaves the user's edit alone. What `onUserEdit` decides is whether anyone is **told** — and the line is whether editing the item meant adoption or customisation.

```json
{
  "content": {
    "sources": {
      "prompts": { "path": "src/content/prompts" },
      "actions": { "path": "src/content/actions", "onUserEdit": "offer" }
    }
  }
}
```

- **`theirs`** (the default) — the item is the user's from the first edit, and the app never mentions it again. Where your content is a starting point for their own writing, this is what you want: no badge about their own prose.
- **`offer`** — the item is yours, customised. The app records that a newer version is waiting, and the Packs view puts it to the user with the parts they changed. They still get your bug fixes if they want them.

The default is the conservative one, so the option that interrupts someone is the one you have to type. default-setup declares `offer` for its `actions`, `prompts` and `flows`, and nothing else.

Neither value overwrites what the user wrote, and neither makes a second copy of anything — there is one entity either way. The pair is named for whose the item is, because the only thing that differs is whether your pack goes on offering its version.

**What an offer looks like to the user.** The pack's row in the Packs list carries a count of the items waiting on them; opening it gives *Your changes to this pack's content*, one row per item: what it is, which parts of it they changed, and what the pack's version would do. Two choices for a newer version —

- **Take the new version**, which writes the pack's item over theirs. There is nothing stored to restore from, and the button says so.
- **Keep mine**, which records the version they declined. A later release that leaves this item alone is then silent, and one that changes the item asks again.

— and for an item you have stopped shipping, **keep it** (it becomes plainly theirs, and the row moves to *Items you keep your own version of*) or **delete it**.

An item the user kept their own version of also gets **Reset to factory**, which is the same write as taking an offered version: one item, overwritten, because they asked.

### Content you stop shipping

**A record your content no longer holds is removed from the user's database — unless they edited it.** The same rule as everything above: ours to remove while it is still ours, theirs to decide once they have touched it. Nothing has to be declared: the app holds an entry per row it wrote, so the removals are the entries your new content no longer names.

Three things it will not do. A content key whose compiled file it could not read contributes no removals, because a key that said nothing cannot be diffed against. A removal follows the parent chain, so keeping an edited child keeps the rows above it. And a `container` another pack's rows (or the user's) are filed under is never removed, since removing the folder would take their content with it.

An edited item you stopped shipping is kept, and under an `offer` entry it is named: the user is asked whether to keep it or delete it. Under `theirs` it is simply kept, which is what `theirs` means.

**Removal is per entry key.** Each entry diffs only the keys under its own prefix, so content whose *whole entry* you stop declaring has no writer left to remove it — and renaming an entry key orphans what the old one wrote, leaving the new key's rows beside them.

### What an import does differently

**Settings → Import Pack Content reads none of that record.** Asking for a pack's data back is asking for the rows to come back, so an import creates a row the user deleted, writes over a row they edited, and removes nothing. It leaves rows with no hash of the pack's alone — a row the user created themselves is never the pack's to replace — and it records what it wrote, so the next boot does not read its writes as the user's edits.

`wipe-and-replace` is blunter still, and is not about the record at all: it removes every row of the entry's types first, trashed ones and other packs' included, and creates them all again.

## Slash commands

A slash command is a `/name` an editor's command popup offers. **A command is content**, like an action, a
prompt or a flow: a pack ships them in a content source, the apply writes them into the user's data, and the
user edits them afterwards — with the three-way merge and the offers every other content entry gets. There is
no manifest key that lists commands, and nothing to merge: one source, so a name cannot shadow another.

A command lives in a document whose field section is `**name**: placeholder` lines, and what makes it one is
the document's own `documentType`. **A command is only a document with a type**, so any document that says it
is a command list is served as one, and a document that says nothing is just a document.

A file declares it in frontmatter (`type: commands`), and the **content key** supplies a default where a whole
source is one kind — so a file in a `commands` source cannot fail to be a command list by saying nothing, while
a file that declares something else is what it says:

| source's key | the file's `type:` | `documentType` |
|---|---|---|
| `commands` | absent | `commands` |
| `commands` | `type: notes` | `notes` |
| `documents` | absent | none — just a document |
| `documents` | `type: commands` | `commands`, served with the rest |

default-setup's are `src/content/commands/internal/*.md`, under its `commands` key. Any pack declares the same
key (`"commands": "src/content/commands"`) and gets the same rows, with no dependency. A name two documents
define keeps the first.

**No feature owns them: the app reads its own rows.** `Document` is an SDK entity, so the commands are a
derivation over the stored documents whose `documentType` is `commands` — there is no role to claim, no provider
to declare and nothing for a pack to serve. A pack *ships* commands by writing content, and a pack *edits* them
by editing documents. In default-setup the editor is `library`, so the documents are the user's library and they
edit them there; a second editor would need no wiring at all.

**Every window holds the list, whatever surface is open.** The app publishes it to the shell — beside which
tabs show and which surface was last open — so an editor's popup reads it from there and never from a feature's
surface. Frontend code that needs it reads `useShell().commands` (`@apackdev/sdk/fe`), or `getCommands()`
(`@apackdev/sdk/commands`) where there is no scope to follow it in. The app republishes whenever it is asked to
publish: on each connection, and after a pack is installed, updated, enabled, disabled, uninstalled or rebuilt
(the bus's `PACK_CHANGED`), or the data is replaced. Beyond that it follows the documents themselves: the SDK's
document repository announces every write and the app compares the derived list, so storing or editing a command
publishes it. One apply is one publication however many documents it wrote.

`/` is the chat input's affordance: the popup is in the `input:chat` editor and nowhere else, so a slash in a
note or a document is ordinary text.

Uninstalling a pack does not remove the commands it wrote: those documents are the user's now, so their
commands stay listed, with no flow handling them, until the user deletes them.

### Declaring commands in the manifest

```json
"extensions": {
  "commands": {
    "list": { "pr2md": { "placeholder": "PR number or GitHub URL (optional)" } },
    "onUserEdit": "offer"
  }
}
```

A command name is lowercase letters, digits and hyphens. The names are nested under `list` so that
`onUserEdit` has somewhere to sit that is not also a command name; it is optional and means here what it
means for every other entry, so leave it out for the default.

**The build desugars this into ordinary content**, compiled under the reserved key `declared-commands` as one
document holding one field per command, named after your pack id. So everything the rest of this page
describes applies unchanged: the three-way merge, removal when you stop shipping a command, offers, and the
import dialog. There is no second path for a command, and no second way the app serves one.

Your own `content.sources` keys are untouched — including the `commands` key, which is why the reserved one
is spelled differently. A pack may use both: a directory for the commands it wants to lay out as documents,
and the manifest for one or two more.

**Two things to know, because this key is weaker than it looks:**

- **It seeds commands; it does not provide them.** What a user gets is a document they own. They may edit a
  placeholder, move the document, or delete it — and a deleted one is not written back on the next boot. This
  is unlike a step type or an artifact, which exist because your pack is installed and vanish when it is not.
  If you need a command that cannot be edited away, you need a flow that handles an event, not a listed command.
- **A name another pack already uses is not refused.** Documents dedupe first-wins and silently: whichever
  document defines the name first keeps it, and yours is simply not listed. The build *does* refuse a name one
  of your **dependencies** declares, because that one is knowable while you build — across packs that know
  nothing of each other, nothing can see both, so first-wins stands.

Sending `/name args` fires a `user.command` event (`$.event.data.payload.command` is the name); there's no routing from a name to an action. To add a command:

1. Write the action that does the work (its `category` only groups it in the Actions UI).
2. Handle it in a flow: an `on("user.command", ...)` branch whose switch compares `payload.command` (`command-listener-flow.ts` for standalone commands; the Claude Code and Codex flows route `cc-*` and `cdx-*`).
3. List it, either way:
   - **a command document** — `**name**: placeholder` in one of your pack's `commands` content files, or, in the running app, one in the Library; or
   - **`extensions.commands` in your manifest** — [the shorthand](#declaring-commands-in-the-manifest), for a pack that wants a command or two without a content directory.

A command listed without a handler does nothing, and a handled command that isn't listed is sent as a plain message.

### Inspecting compiled references

`apack pack info` reads verified compiled content without activating a pack or importing authored
modules. Its JSON output includes each collection's `references` when its compiler supports analysis.
Flow analysis uses step declarations: `extensions.steps.<type>.dsl.references` maps a DSL field to a
compiled content key, for example `"references": { "prompt": "prompts" }`. This also works for custom
steps and nested branches exposed by their build facet.

The index records literal targets and marks computed targets as dynamic. Human-readable inspection
reports whether a literal target is indexed. A target missing from this index may still exist in user
data or be created by an applier. Analysis is static and non-exhaustive; an omitted `references` field
means analysis is unavailable, while an empty list means no known references were found. Action and
prompt JavaScript bodies are not analyzed yet.

Build tooling can use `inspectContentReferences` and `findContentDependents` from `@apackdev/sdk/build`
for missing-target and rename/removal review. These operate on index data only and never execute a
pack. Known incoming references do not rule out additional computed or runtime dependencies.
