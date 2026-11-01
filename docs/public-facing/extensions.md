# Extensions — Steps, Artifacts, Blocks & FE Extension Points

Packs can extend the host's flow editor, artifact system, message UI, rich-text editor and app shell.

## Steps

A step definition adds a new node type to the visual flow editor. A `StepDefinition` (`@apackdev/sdk/steps`) has these fields:

| Field | Type | Description |
|---|---|---|
| `type` | `string` | Node type id (`node.nodeType`) and DSL `type` |
| `node` | `StepNodeFacet` | Inline manifest labels/defaults emitted into both registrations |
| `kind` | `'step' \| 'trigger'` | Omitted means `'step'`. Trigger nodes start tracks and never run as steps |
| `build` | `StepBuildFacet` | Compile/validate/decompile DSL nodes |
| `runtime` | `StepRuntimeFacet` | Execute the step |
| `fe` | `StepFEFacet` | Palette, canvas node and form |
| `trigger` | `TriggerFacet` | For `kind: 'trigger'` |
| `dsl` | `StepDSLMeta` | Same shape as the manifest entry's `dsl`; codegen reads the manifest's (see [Flow helpers](#flow-helpers)) |

Declare initial values once in `apack.json`:

```json
{
  "extensions": {
    "steps": {
      "my-step": {
        "node": {
          "label": "My Step",
          "defaults": {
            "enabled": true
          }
        },
        "build": {
          "compile": "src/extensions/steps/my-step/build.ts#compile",
          "validate": "src/extensions/steps/my-step/build.ts#validate",
          "getLabel": "src/extensions/steps/my-step/build.ts#getLabel"
        }
      }
    }
  }
}
```

`node.defaults` contains JSON data and must satisfy the step's validation. New nodes receive independent
copies, so editing a nested field does not change the next node's baseline. No node-data export is needed.

### Scaffolding

```bash
apack pack add step my-step
apack pack add step my-trigger --trigger   # scaffolds a TriggerFacet and inline initial node values
```

Creates:

```
src/extensions/steps/my-step/
  build.ts      # Named compiler callbacks; no FE or runtime imports
  layout.ts     # optional calculated layout function exports
  types.ts      # DSL and compiled node types
  form.vue      # Step configuration form
```

It writes the manifest entry under `extensions.steps` naming those two facets, and regenerates `__generated__/`. Add a
`runtime.ts` and name it in the entry to give the step something to run. A type the manifest already
declares is refused.

### Reading step declarations and implementations

Backend code reads `getStepDeclaration(type)` or `getStepDeclarations()` from
`@apackdev/sdk/steps` for labels, defaults and declared capabilities. These reads do not load pack
modules and remain available when a pack is disabled or its implementation is unavailable.
`stepRegistry.createNodeDefaults(type)` copies the declared defaults, so editing a node cannot mutate
the catalog.

Creating a node through `flowRepository` requires `getStepBinding(type)` to identify an enabled,
accepted backend matching the current declaration and build. The repository checks that binding again
after trigger validation and before writing. Missing or replaced providers refuse creation without
persisting a node. `stepRegistry.getRuntime`, `getBuild` and `getTrigger` read active providers for
execution, compilation and retirement; they do not establish eligibility for new work.

Updating a node keeps its type fixed and reads its declared relation and validation policy. A declared
trigger validator requires a matching eligible backend, checked again after validation before any write.
Missing, stale or replaced providers refuse the update. Edits with no declared validator can proceed
without activating a backend; an unknown declaration cannot establish an editing policy.

Frontend code uses `getStepDeclarations`, `getStepDeclaration` and `getStepBinding` from
`@apackdev/sdk/fe`. Frontend metadata comes from the catalog; executable views additionally require the
current frontend binding. Backend and frontend implementations have separate lifetimes.

### Build facet (build.ts)

```typescript
import type { StepBuildFacet, StepCompileResult, StepValidationError } from '@apackdev/sdk/steps';
import { EARS } from '@apackdev/sdk';
import type { DSLMyStepNode } from './types.ts';

export const compile: StepBuildFacet['compile'] = (node, nodeId, ts, ctx): StepCompileResult => {
    const step = node as unknown as DSLMyStepNode;
    return {
        entity: { id: nodeId, entityType: EARS.Entity.Node, createdAt: ts, nodeType: 'my-step', label: step.label ?? 'My Step' },
        relations: [],
    };
};

export const validate: StepBuildFacet['validate'] = (step, path, ctx): StepValidationError[] => {
    return [];
};

export const getLabel: StepBuildFacet['getLabel'] = (step, index) => {
    return typeof step.label === 'string' ? step.label : `My Step ${index}`;
};
```

| Member | Signature | Description |
|---|---|---|
| `compile` | `(node, nodeId, ts, ctx) => { entity, relations }` | DSL node → `Node` entity. `ctx` (`StepCompileContext`) maps `actions`, `prompts` and `flows` names to ids. `relations` are `{ source, kind, target, info? }` |
| `validate` | `(step, path, ctx) => StepValidationError[]` | Each error is `{ path, message }`. `ctx` has `actions`, `prompts`, `flowNames`, `nodeLabels` (sets), `path`, `skipReferenceCheck?` |
| `getLabel` | `(step, index) => string` | Label for a DSL step at `index` |
| `decompile?` | `(node, ctx) => dslNode` | Entity → DSL (reverse of `compile`). `ctx` has `actionMap`, `promptMap`, `flowMap` and `resolveBranch?(sourceNodeId, sourceHandle)`. Omitted → `{ type, label }` |
| `relation?` | `{ field, targetEntity }` | The node field holding an id linked by an `instance_of` relation to a `targetEntity` row (the `action` step: `{ field: 'actionId', targetEntity: 'Action' }`); flow editing and export fill the field from the link |
| `branches?` | `(dslNode) => { key, steps }[]` | Inline step lists nested in the node. The compiler compiles each and wires branch `i` from this node with `sourceHandle: 'branch-<i>'`, continuing to the next step afterwards |

### Runtime facet

```typescript
// runtime.ts
import type { ExecutionContext, StepInput } from '@apackdev/sdk/steps';

export async function handler(input: StepInput, node: unknown, ctx: ExecutionContext, actor: unknown) {
  const a = actor as { send(event: unknown): void };
  a.send({ type: 'COMPLETE', result: { ok: true } });
}
```

```json
{ "runtime": { "handler": "src/extensions/steps/my-step/runtime.ts#handler", "isAsync": true } }
```

The handler is named rather than imported, so its module — and whatever it reaches, models, the filesystem,
a terminal — loads on the step's first run and not at pack load. The flags beside it are data, because the
brain reads them before it decides how to run the step; `sync` is the one that changes the loading.

| Member | Description |
|---|---|
| `handler(input, node, executionContext, actor)` | Runs the step. `input` (`StepInput`) is what it runs on, whole: `settings`, the node's settings with its field mappings applied, `params`, its own params and the mapped ones, and `runNodeId`, its node in the run history (`services.runHistory`) to report against — which keeps only a bounded copy, so a step never reads its input back from there. `node` is the compiled entity, `executionContext` has `flowRunNodeId`, `event`, `steps` (earlier runs), `lastStep` and `runtime` (`getFlowActor`, `servicesForAction(label)`). Finish with `actor.send({ type: 'COMPLETE', result })`, or `actor.send({ type: 'ERROR', error })` with the error `reportError({ error, source, step: { phase, runNodeId, … } })` (`@apackdev/sdk/logger`) returns. A type without a handler completes with `{ executed: true }` |
| `isAsync` | The handler returns a promise; a rejection is reported and sent as `ERROR` |
| `sync` | The handler's module is imported with the pack entry rather than on the step's first run, so its sends land in the brain's own dispatch. For a handler whose sends have to be ordered with the transition that called it — `kill` ends the flow *and* completes itself, and a tick's delay leaves the step reading as still running. Exclusive with `isAsync` |
| `spawnsSubflow` | The brain spawns a sub-flow machine for the node instead of a step machine (the `subflow` step) |
| `waits` | The step never completes on its own (keep-alive). `runFlow` in `@apackdev/testing` treats such a step as settled |

Conventions the brain reads from a `COMPLETE` result and the node:

| Convention | Effect |
|---|---|
| `result.sourceHandle: 'branch-N'` | Continues along the outgoing edge with that handle (what `switch` does) |
| `result.noMatch: true` | Ends the current chain |
| `final: true` on the compiled node | The flow completes when this step completes |
| Never sending `COMPLETE` | The step stays executing (set `waits: true`) |
| `KILL_FLOW` sent to `ctx.runtime.getFlowActor(flowRunNodeId)` | Kills the flow |

### Trigger facet

A trigger (`kind: 'trigger'`) compiles a DSL track, not a step:

| Member | Description |
|---|---|
| `trackField` | The DSL track field this trigger owns (`'schedule'`); the compiler detects the trigger from it |
| `compile(track, trackId, ts, trackKey)` | Track → trigger node entity |
| `decompile(node)` | Node → track fields (`{ schedule: '0 * * * *' }`) |
| `persistent?` | Keeps the flow alive after all tracks drain |
| `register?(node, ctx)` | Runtime hooks per trigger node when the flow actor registers (cron jobs). `ctx` has `flowRunNodeId` and `sendToSystem({ role: 'brain' }, { type: 'TRIGGER_BRAIN_EVENT', eventType, payload?, targetFlowId? })` |
| `queryFields?` | Extra entity fields loaded with the trigger's nodes (`['cronExpression']`) |
| `validateTrack?(track)` | `{ valid, errors }` before compiling |
| `validate?(node)` | `{ valid, errors }` for a compiled node on persist |

`trigger` declares track metadata inline and each callback as a `"path#export"` reference. Compiler
callbacks are checked and loaded for compilation. `trigger.register` stays lazy: its module is loaded
when the trigger is first registered at runtime. Static discovery imports none of these modules.

### Frontend declaration

`extensions.steps.<type>.fe` contains presentation data and explicit bindings. Discovery can read it
without importing components or layout code. Codegen assembles the checked `StepFEFacet` at build time.

```json
{
  "nodeConfig": {
    "icon": "Box",
    "isImplemented": true,
    "connectionRules": { "inputs": -1, "outputs": -1 },
    "category": "logic"
  },
  "colorKey": "indigo",
  "components": { "form": { "entry": "src/extensions/steps/my-step/form.vue", "load": "lazy" } },
  "layout": { "hasInput": true, "getHeight": "src/extensions/steps/my-step/layout.ts#getHeight" }
}
```

| Field | Description |
|---|---|
| `nodeConfig` | Palette category, icon, connection rules and availability flags (below) |
| `components?` | Optional `node` and `form` targets: a component path or `{ entry, load?: "lazy" }`. A script component may name `path#export`; Vue SFCs use their default export. `node` replaces the default canvas node; `form` replaces the default form |
| `colorKey?` | Node style color: `purple`, `blue`, `amber`, `cyan`, `orange`, `emerald`, `indigo`, `neutral`, `red` or `yellow` |
| `handlePrefix?` | Multi-output steps: outgoing handles are `<prefix>-0`, `<prefix>-1`, … |
| `layout?` | Inline `hasInput`/`usesExitCount` flags and named `getHeight`/`getPorts` function references. Functions receive `(node, { exitCount })`; omitted layout uses one input and one output |

All paths are pack-root-relative. An icon is a Lucide export name or a component target object.
Components and layout functions are validated without invoking them. Layout exports use
`StepLayoutDescriptor` from `@apackdev/sdk/steps` for their callback types. Labels and initial node
fields belong to the separate inline `node` declaration, shared by frontend and backend.

The form component receives `node` and `resources` (`{ actions, flows, models, prompts }`) and emits `update-node` (the changed fields), `reindex-branches` (`{ type: 'inserted' \| 'removed', index }`) and `close`. The scaffolded `form.vue` declares `node` and `resources` and wraps `BaseForm` (`@apackdev/ui/components/BaseForm`), re-emitting its `update-node` and `close`.

#### Node config fields

| Field | Type | Description |
|---|---|---|
| `icon` | `string` or component target object | Lucide export name or explicit component binding |
| `connectionRules` | `{ inputs, outputs }` | Max connections (-1 = unlimited) |
| `category` | `'trigger' \| 'action' \| 'logic' \| 'data' \| 'ai'` | Palette category |
| `isImplemented` | `boolean` | Palette items not implemented are disabled |
| `isDisabled` | `boolean` | Disables the palette item |

### Reading step declarations and frontend bindings

`getStepDeclarations()` and `getStepDeclaration(type)` from `@apackdev/sdk/fe` return catalog entries:
owner, origin, enablement, identities and declaration data. They read no executable pack modules.
A unique installed/native owner takes precedence over authoring previews; ambiguous owners are not
selected. Disabled or disconnected declarations remain readable.

`getStepBinding(type)` returns the current eligible frontend binding, or `undefined`. It requires a ready
catalog, enabled runtime owner and matching accepted declaration/build identities. Native bindings also
match their captured declaration data without invented version stamps. This read never starts a pack.
`getStepFrontendBindings()` is the lower-level inventory of admitted frontends; admission alone does not
establish current catalog readiness.

In Vue, call `useStepDeclarations()` inside setup or an effect scope. Its computed list refreshes for
both declaration and frontend changes, including readiness changes with unchanged metadata. Disposal
releases both subscriptions. Imperative observers can use `onStepsChanged(callback)` and call its disposer.

For flow UI, `useNodeStyles()` from `@apackdev/ui/components/node-styles` supplies reactive node/palette
helpers in the same scope. The standalone helper exports read current data on each call. Unavailable
steps retain presentation and a fallback icon, with creation disabled. Custom components and calculated
layouts require an eligible binding; static layout flags remain readable without one.

### Types (types.ts)

```typescript
import type { NodeBase } from '@apackdev/sdk';
import type { DSLNodeBase } from '@apackdev/sdk/build';

export interface DSLMyStepNode extends DSLNodeBase {
  type: 'my-step';
  label?: string;
}

export interface MyStepNode extends NodeBase {
  nodeType: 'my-step';
}
```

`generate-entries` re-exports every definition's `types.ts` from `#generated/step-types`, and each `export interface … extends NodeBase` joins the pack's `Node` row union.

### Manifest

A step is declared in `apack.json` under `extensions.steps`, keyed by its type, with each facet named where its code is:

```json
{
  "extensions": {
    "steps": {
      "my-step": {
        "build": {
          "compile": "src/extensions/steps/my-step/build.ts#compile",
          "validate": "src/extensions/steps/my-step/build.ts#validate",
          "getLabel": "src/extensions/steps/my-step/build.ts#getLabel"
        },
        "fe": {
          "nodeConfig": {
            "icon": "Box",
            "isImplemented": true,
            "category": "logic",
            "connectionRules": {
              "inputs": -1,
              "outputs": -1
            }
          },
          "colorKey": "indigo",
          "components": {
            "form": {
              "entry": "src/extensions/steps/my-step/form.vue",
              "load": "lazy"
            }
          }
        },
        "runtime": {
          "handler": "src/extensions/steps/my-step/runtime.ts#handler",
          "isAsync": true
        },
        "dsl": {
          "primaryField": "action"
        },
        "node": {
          "label": "My Step"
        },
        "types": "src/extensions/steps/my-step/types.ts"
      },
      "my-trigger": {
        "kind": "trigger",
        "trigger": {
          "trackField": "myTrigger",
          "compile": "src/extensions/steps/my-trigger/build.ts#compile",
          "decompile": "src/extensions/steps/my-trigger/build.ts#decompile",
          "register": "src/extensions/steps/my-trigger/runtime.ts#register"
        },
        "fe": {
          "nodeConfig": {
            "icon": "Radio",
            "isImplemented": true,
            "category": "trigger",
            "connectionRules": {
              "inputs": 0,
              "outputs": -1
            }
          },
          "colorKey": "blue",
          "components": {
            "form": {
              "entry": "src/extensions/steps/my-trigger/form.vue",
              "load": "lazy"
            }
          }
        },
        "node": {
          "label": "My Trigger"
        },
        "types": "src/extensions/steps/my-trigger/types.ts"
      }
    }
  }
}
```

| Field | What it is |
|---|---|
| `kind` | `step` (the default) or `trigger` |
| `build` | An object declaring compile/validate/getLabel references, optional decompile/branches references and inline relation metadata. A trigger declares `trigger` instead |
| `trigger` | Track metadata (`trackField`, optional `persistent`/`queryFields`) and compile/decompile references, with optional validation/register references |
| `node` | Inline labels and initial JSON node fields |
| `fe` | Inline frontend declaration (above) |
| `types` | Explicit module declaring node and DSL types |
| `runtime` | `{ handler?, isAsync?, waits?, spawnsSubflow? }` |
| `dsl` | DSL configuration for flow-helper generation (below) |

Codegen sends each facet where it is used, so no barrel keeps them in step with each other: `build` and
`runtime` to the pack's backend registration, `fe` to its frontend one, and `build` (or `trigger`) alone to
`src/__generated__/steps-build.ts`, which `apack pack build` bundles to `dist/build/steps.build.mjs` — the
module a *dependent* pack's build loads to validate its flows with your step code. A dependency's step types
are loaded that way too, and a type this pack and a dependency both define fails the build.

Step `types` and `dsl.helpers` explicitly name pack-root-relative modules. No contribution is inferred
from neighboring files or the directory of another facet.

### Flow helpers

`generate-entries` writes `#generated/flow-helpers`: `entry` and `on`, a helper for each definition that has `dsl`, trigger track builders, and the flow helpers of dependencies (re-exported from the modules their builds ship, skipping names already exported).

| `dsl` | Helper |
|---|---|
| none | No helper |
| `{}` | `ping(label?)` (type `ping`) |
| `{ defaultLabel: 'Kill Flow' }` | `kill(label = 'Kill Flow')` |
| `{ primaryField: 'action' }` | `action(action, opts?)`: `opts` takes the other fields of the first `export interface DSL…Node` in the declared `types` module; `generate-entries` fails when there is none |
| `{ helpers: "src/helpers.ts" }` | Re-exports the custom helpers from that module |

A `kind: 'trigger'` entry declaring `trigger.trackField: '<name>'` (other than `event`) gets a camelCase helper named after that field, returning a track. Codegen reads the manifest, without scanning implementation source.

The helper is named after `type` in camelCase, with `-` and `_` separating words (`keep_alive` → `keepAlive`, `my-step` → `myStep`). The scaffolded `types.ts` names its DSL interface `DSL<Type>Node` (`DSLMyStepNode`), which `primaryField` reads.

---

## Artifacts

An artifact is a typed content item (code, image, markdown, …) shown in a thread's artifact panel. An `ArtifactDefinition` (`@apackdev/sdk/artifacts`) is `{ type, fe? }`:

| `fe` field | Required | Description |
|---|---|---|
| `icon` | yes | The icon shown in the artifact list |
| `component` | no | The viewer. Without one, the host shows the text viewer |

Frontend code reads `getArtifactDeclaration(type)` or `getArtifactDeclarations()` from
`@apackdev/sdk/fe` for declared icon names and viewer paths without loading the pack. Use
`getArtifactBinding(type)` for an executable viewer: it is available only while the current enabled
owner and accepted declaration/build agree. `useArtifactDeclarations()` observes both metadata and
binding readiness inside a Vue effect scope, so mounted lists and viewers follow pack changes.
Unavailable viewers display the text fallback; declared icons remain available independently.

### Scaffolding

```bash
apack pack add artifact chart --icon BarChart3
```

Writes the manifest entry under `extensions.artifacts` and creates `src/extensions/artifacts/viewers/chart-artifact.vue`. A type the manifest already declares is refused.

### Viewer component

The viewer receives `artifact: ArtifactItem`:

```vue
<script setup lang="ts">
import type { ArtifactItem } from '@apackdev/sdk/artifacts';

defineProps<{ artifact: ArtifactItem<{ points: number[] }> }>();
</script>

<template>
  <div class="p-4">
    <h3 class="text-sm font-medium">{{ artifact.title }}</h3>
    <pre class="text-xs text-neutral-400">{{ artifact.content }}</pre>
  </div>
</template>
```

`ArtifactItem<TContent>` is `{ id, type, title, content: TContent, color?, metadata?: { createdAt, updatedAt?, … } }`. The scaffolded viewer declares `artifact` and shows its title and content.

### Manifest

An artifact is declared in `apack.json` under `extensions.artifacts`, keyed by its type:

```json
{
  "extensions": {
    "artifacts": {
      "chart": { "icon": "BarChart3", "fe": "src/extensions/artifacts/viewers/chart-artifact.vue" }
    }
  }
}
```

| Field | Required | What it is |
|---|---|---|
| `icon` | yes | The name of a `lucide-vue-next` export. That is the icon set the host provides every pack's frontend, so a pack names one rather than shipping a component; a name lucide doesn't export fails the pack's typecheck |
| `fe` | no | The viewer that opens it — a `.vue` file, taken by its default export |

Both of an artifact's facets are frontend ones, so the backend registration carries the type alone and the
icon set never reaches a pack's backend bundle.

### Creating artifacts from the backend

default-setup's threads feature provides `services.artifact` (declare `default-setup` in `dependencies` for its types):

| Call | Does |
|---|---|
| `createAndNotify({ artifactType, title, content, threadId?, color? })` | Creates the `Artifact` row, links it to the thread and sends `ARTIFACT_ADDED` to the threads surface when `threadId` is given. Returns `{ artifactId }` |
| `updateAndNotify(artifactId, { title?, content?, threadId? })` | Patches it; sends `ARTIFACT_UPDATED` when `threadId` is given |
| `findOrCreateByType(threadId, artifactType, { title, content, color? })` | At most one artifact of the type per thread. Returns `{ artifactId, created }` |

`color` is one of `blue`, `purple`, `emerald`, `amber`, `red`, `cyan` (the list pill's color).

### default-setup's artifact types

`text`, `code`, `review`, `image`, `slack`, `todo`, `project`, `json`, `graph`, `table`, `markdown`,
`claude-session`, `codex-session`, `diff`, `plan`, `note` — each with its own viewer under
`src/extensions/artifacts/viewers/`.

---

## Blocks

A block is an inline UI widget inside a chat message. A `BlockDefinition` (`@apackdev/sdk/blocks`) is `{ type, kind?, fe?, be? }`:

- **Display blocks** (`kind` omitted or `'display'`) render data (markdown, code, tool activity).
- **Input blocks** (`kind: 'input'`) collect a response (text, choices, approvals).

Frontend code reads `getBlockDeclaration(type)` or `getBlockDeclarations()` from
`@apackdev/sdk/fe` for input/display kind and declared facet paths. `getBlockBinding(type)` supplies
only a frontend matching the current enabled owner and accepted declaration/build.
`useBlockDeclarations()` observes independent metadata and binding updates within a Vue effect scope.
The thread UI does not render missing, disabled or stale components. Backend transcript callbacks
remain execution-facing lookups with their runtime lifetime.

### Scaffolding

```bash
apack pack add block rating                # display block
apack pack add block color-picker --input  # input block
```

Writes the manifest entry under `extensions.blocks` and creates `src/extensions/blocks/display/RatingBlock.vue` or `src/extensions/blocks/input/ColorPickerInput.vue`. The scaffolded display block declares an example `text` prop; the input block declares `label`, `disabled` and `response` and emits `submit` and `cancel`. A type the manifest already declares is refused.

### Block components

A message's blocks are `{ type, props }[]`. The host renders each block's component with:

| Receives | Display | Input |
|---|---|---|
| `props` spread as component props | yes | yes |
| `disabled` (the message has been answered) | | yes |
| `response` (the stored response) | | yes |

Components answer by emitting `submit` (the response value) or `cancel` (sent as `{ cancelled: true }`). The response is stored on the message and fires the flow event `interactive.message.response` with `{ messageId, threadId, response }`.

```vue
<!-- src/extensions/blocks/input/ColorPickerInput.vue -->
<script setup lang="ts">
defineProps<{ label: string; disabled?: boolean; response?: { color: string } | null }>();
defineEmits<{ submit: [value: { color: string }]; cancel: [] }>();
</script>

<template>
  <div class="p-2">
    <input type="color" :disabled="disabled" @change="$emit('submit', { color: ($event.target as HTMLInputElement).value })" />
    <button :disabled="disabled" @click="$emit('cancel')">Cancel</button>
  </div>
</template>
```

### Manifest

A block is declared in `apack.json` under `extensions.blocks`, keyed by its type. Each entry names where its code lives, and codegen
splits the two facets between the entries: the component goes into the pack's frontend bundle, the backend
facet into its runtime, so a backend process never loads a Vue component to know a block exists.

```json
{
  "extensions": {
    "blocks": {
      "rating": { "fe": "src/extensions/blocks/display/RatingBlock.vue" },
      "color-picker": { "kind": "input", "fe": "src/extensions/blocks/input/ColorPickerInput.vue" }
    }
  }
}
```

| Field | Required | What it is |
|---|---|---|
| `kind` | no | `display` (the default) or `input` |
| `fe` | no | The component that draws it — a `.vue` file, taken by its default export. The host renders it |
| `be` | no | `"path#exportName"` of its `BlockBEFacet` |

The key is the type, so a pack cannot declare one twice, and a path naming no file fails the build naming
the block and the path.

### Backend facet

`be.generateAsideText(block, response, context)` returns the one-line summary shown when an auto-hidden (`autoHide`) message collapses after its response, or `null` for the default. `context` is `' — <label>'` or `''`. The threads service consults it only when the message's primary interactive block is one of `approval`, `choice`, `text`, `question`, `file-picker`, `project-select` or `button-group`.

### Sending blocks from the backend

default-setup's threads feature provides `services.chat.sendBlockMessage({ threadId, text, blocks, forkable?, autoHide?, asUser?, asideContext? })`: it adds an assistant message with the blocks and sends `MESSAGE_ADDED` to the threads surface, returning `{ messageId }`. `autoHide: true` requires `asUser` (boolean); `asideContext` overrides the label used in the aside text.

```typescript
services.chat.sendBlockMessage({
  threadId,
  text: 'Pick a color',
  blocks: [{ type: 'color-picker', props: { label: 'Accent' } }],
});
```

#### Pairing a prompt with an input

A message's `blocks` array is rendered in order, so the convention for asking a question is two blocks: a `prompt` display block carrying the question text, followed by the input block that collects the answer. The message's own `text` is what shows in thread summaries; the `prompt` block is what the user reads above the control.

```typescript
services.chat.sendBlockMessage({
  threadId,
  text: 'Choose a project directory',
  blocks: [
    { type: 'prompt', props: { content: 'Which directory should I work in?' } },
    { type: 'file-picker', props: { fileType: 'directory', allowMultiple: false, displayText: 'Selected project:' } },
  ],
});
```

The same shape covers the other input types. Each row below is one `blocks` array:

| Asking for | Blocks |
|---|---|
| A file or directory | `prompt`, then `file-picker` with `{ fileType: 'file' \| 'directory' \| 'both', allowMultiple, displayText }` |
| Free text | `prompt`, then `text` with `{ placeholder, multiline, required, displayText, suggestions }` |
| One of several options | `prompt`, then `choice` |
| Confirmation | `prompt`, then `approval` |
| An action to run | `prompt` (optional), then `button-group` with `{ buttons, keepInteractive, displayText }` |

A `link` block needs no input block — it is a display block listing navigation targets, and the leading `prompt` is optional:

```typescript
services.chat.sendBlockMessage({
  threadId,
  text: 'Opening settings',
  blocks: [{ type: 'link', props: { links } }],
});
```

#### Button groups

`button-group` is the one input block the backend drives after the first response, so it has two modes. Both follow the same path: frontend → backend → database → `UPDATE_MESSAGE_STATE` → frontend.

- **`toggleStates`** — an on/off pair. The backend flips `state` between the two itself.
- **`states`** — a map of named states, where a flow decides which one comes next.

Each `ButtonConfig` (`@apackdev/sdk/blocks`) is `{ id, label, state }` plus one of those two maps; every state entry carries its own `label`, optional `variant` and optional `disabled`. Pass `keepInteractive: true` to leave the buttons live after a response instead of disabling them.

```typescript
services.chat.sendBlockMessage({
  threadId,
  text: 'Quick toggles:',
  blocks: [{
    type: 'button-group',
    props: {
      buttons: [
        // Auto-cycling: the backend flips between on and off
        {
          id: 'watch',
          label: 'Watch',
          state: 'off',
          toggleStates: {
            on: { label: 'Watching', variant: 'primary' },
            off: { label: 'Watch' },
          },
        },
        // Manual control: a flow sets the next state
        {
          id: 'deploy',
          label: 'Deploy',
          state: 'idle',
          states: {
            idle: { label: 'Deploy' },
            deploying: { label: 'Deploying…', disabled: true },
            deployed: { label: 'Deployed' },
          },
        },
      ],
      keepInteractive: true,
    },
  }],
});
```

The block answers with a `ButtonGroupResponse` — `{ buttonId, state }`. Responses reach flows as `interactive.message.response` with `{ messageId, threadId, response }`.

### default-setup's block types

| Kind | Types |
|---|---|
| Display | `prompt`, `note`, `markdown`, `link`, `tool-activity`, `thinking`, `tool-input`, `context-usage`, `session-list` |
| Input | `actions`, `toggles`, `file-picker`, `choice`, `text`, `approval`, `button-group`, `question`, `project-select` |

---

## Other frontend extension points

### Text editor extensions

`extensions.textEditor` declares named editor groups. Each group names its extensions,
popups and optional suggestion predicate without importing executable code:

```json
{
  "extensions": {
    "textEditor": {
      "suggestions": {
        "extensions": {
          "mention": "src/editor/mention.ts#Mention"
        },
        "popups": {
          "mentions": "src/editor/MentionPopup.vue"
        },
        "isSuggestionActive": "src/editor/suggestions.ts#isSuggestionActive"
      }
    }
  }
}
```

Extension keys must match the exported Tiptap objects' names. Popup IDs belong to their group.
The predicate receives an editor state and returns `true` while suggestions should handle Escape.
Codegen imports each target and assembles keyed `TextEditorExtensions` bindings (`@apackdev/sdk/fe`);
there is no registration module or aggregate array export. Binding admission checks exact group/member
names and executable shapes without calling components or predicates. Conflicting active extension
names are refused with both owners. Catalog metadata remains available for disabled packs.

`textEditorExtensionsRegistry.getAll()` returns accepted `{ packId, groupId, binding }` rows in pack/group
registration order. Each row is immutable and its binding holds captured extension/popup membership.
The returned list is detached. `onChanged(listener)` observes committed frontend changes and returns
an unsubscribe function; reread the projection to distinguish relevant editor changes from unrelated
pack changes. Discovery and unavailable groups remain in the catalog, separate from these bindings.

Read-only chat messages use `ChatMessageViewer` without constructing an editor when every active
editor group declares support. Set `readOnly: false` for editing-only groups, or name an exported
`ReadOnlyTextRenderer` object with `"readOnly": "src/viewer.ts#Viewer"`. An adapter can transform
Markdown with `transformMarkdown(source): string` and enhance the rendered root with
`decorate(root): void | (() => void)`. The parser always disables raw HTML. Return cleanup for DOM
listeners or subscriptions; it runs before replacement and on unmount. Adapters are checked without
executing them. An absent declaration uses the existing editor viewer; a failing supported adapter
shows an error instead of silently falling back. Contribution changes rebuild affected viewers.

Open editors follow accepted contribution changes. Popup/predicate-only updates preserve the editor
and undo history. Extension changes replace its executable editor after retiring the previous popups;
pending document data, selection and focus survive when the new schema represents them exactly.
Undo history resets on that replacement. An unavailable or incompatible schema suspends the editor
without saving altered content; restoring a compatible pack restores the pending document. Switching
to another document explicitly discards that suspended editor state.

The app's native frontend owns the `reference` node used by saved `apack-ref://` links. It is present
without default-setup or a reference provider. Default-setup adds `referenceSuggestion`, its picker
popups and command behavior; disabling it removes those tools while preserving stored references.
Packs cannot claim the native node name. Reference type/category metadata and eligible navigation
bindings still determine presentation and click behavior independently of parsing.

### App extensions

`extensions.appExtensions` maps a slot name to a Vue component file: `{ "welcome": "src/extensions/app/Welcome.vue" }`. The app renders one slot, `welcome`: an overlay shown to first-time users during onboarding. Slot names have one active pack owner; conflicting registrations are refused.

### PackFERegistration

The generated FE entry (`__generated__/pack-entry-fe.ts`) default-exports a `PackFERegistration` built from the manifest:

| Field | Source |
|---|---|
| `features` | Each feature with a `surface`: its generated binding from declared state/views/presentation, its `designation`, and `default: true` on the one whose `surface` sets `default`. Bindings must match the accepted declaration; startup selection follows the [declared default policy](manifest.md#features), independently of frontend delivery. Duplicate designation ownership refuses the pack |
| `steps` / `artifacts` / `blocks` | each entry's `fe` facet, imported into the generated frontend entry (an artifact's `icon` with it) |
| `textEditor` | `extensions.textEditor` |
| `appExtensions` | `extensions.appExtensions` |

The renderer registers it for your pack; nothing in your frontend registers anything itself.

`features.<id>.references` declares reference identities and presentation for any pack. Catalog metadata is independent of activation; item providers and navigation bind when the frontend is accepted.

## DSL editor assistance

DSL editor assistance is static catalog data. `getDslDeclarations()` / `getDslDeclaration(type)` from
`@apackdev/sdk/fe` expose declarations and available compiled definition text, including disabled packs.
`useDslDeclarations()` observes catalog updates in a Vue effect scope; `onDslDeclarationsChanged()`
returns an explicit unsubscribe function. Ambiguous owners are unavailable. Unbuilt source entries may
lack compiled definitions. Monaco replaces or removes libraries and globals when catalog data changes,
sharing them until the last editor releases them. `setupMonacoForFile()` returns that release function;
call it when a direct consumer changes files or disposes its editor. `UnifiedMonacoEditor` owns this
lifecycle automatically. These data reads import no pack or compiler modules.

### Navigation discovery

The shell lists enabled surfaces from their declarations before loading their frontend. Labels, pinning,
visibility defaults and order come from the catalog; source-only previews are not app destinations.
Native host tabs follow pack tabs within each pinned/unpinned group. Frontend delivery order cannot
reorder tabs. User visibility choices override `features.<id>.surface.defaultVisible` (which defaults
to visible). Hidden destinations remain in the toolbar visibility menu.

Accepted frontend bindings supply icons and executable behavior. Until an icon is available, the shell
shows its own placeholder. Opening a declared destination still uses the shell's checked loading and
readiness path; listing a tab does not activate its pack. Disabled packs retain discoverable metadata
in the pack catalog but are omitted from app navigation.
