```
# Goal: services.inference on AI SDK 7, with a TypeScript 5.7 floor

Implement docs/archive/goals/goal-inference-ai-sdk-7.md on a branch cut from
AS/test-harness-system-deps: Background, Decisions, Phases, Constraints. Read it first.
Decisions are final: implement them, don't reopen them or stop to ask. Where a detail
isn't specified, pick the conventional option, note it in the final summary, and keep
going. No backward compatibility: the model code is prototype code with no real users.
Change signatures, delete what the design drops, migrate every in-repo caller, test,
fixture, template and doc in the same change, and fix forward.

Finished when:
- Phases 1–5 are implemented and each meets its "Done when"; every new guard, helper
  or test is mutation-checked.
- Packs call models only through `services.inference` with `provider:model` ids, and
  import only pure pieces (`tool`, `Output`, `isStepCount`, types) from `ai` 7.
- No test outside `@apackdev/sdk` builds a model, imports `ai/test` or registers a model
  host module; tests mock `inference` with `fakeInference` through `mockService`.
- `@apackdev/sdk` and `@apackdev/ui` declare TypeScript >=5.7, and the published-types
  specs run at 5.7, including a library-checked case for `ai`'s types.
- `npm run typecheck`, `schema:check` and `api:check` (sdk), `packages:build` +
  `packages:check`, and the api, sdk, host, cli, default-setup and renderer unit
  suites pass.
- `npm run build`, the monorepo E2E suite, `npm run test:external-pack`,
  `npm run test:packaged-authoring` and the example pack's
  `apack test --app-root <repo>` pass.
- You give a final summary: phase → done/deferred, evidence, and the conventional
  choices you made.

Never:
- push or tag. Commit as you go in logical chunks (conventional messages, no
  Co-Authored-By or session lines). Commit with `git commit -- <paths>` and check
  `git diff --cached` first: something outside the session stages files.
- npm publish, create GitHub releases, or trigger workflows (dry runs only).
- pkill/killall Electron or node; launch the app outside the test env without an
  isolated APACK_USER_DATA_DIR.
- run bare tsc on packages/preload, `npm install` in the example pack, or edit
  version/release metadata.
- change the typed EARS types (packages/apack-sdk/TYPED-EARS.md) to make a call
  site compile.
- call a real model provider from a test, or set `globalThis.AI_SDK_DEFAULT_PROVIDER`.
- loosen a failing assertion instead of investigating.
```

## Background

Pack code gets models from an `@apackdev/sdk/inference` module on AI SDK 4, through a global host-module seam. That seam mixes three concerns: credentials and providers, inference calls, and the AI SDK's pure pieces.

- **The current seam** (from `7e240b02c`):
  - `@apackdev/sdk/inference` (`apack-sdk/src/services/inference.ts`) wraps `ai` 4's `generateText`/`streamText`/`generateObject`/`streamObject`. It resolves `{ provider, model }` through `getHostModule('model-provider')` and re-exports `tool`, `webSearchTool` and `CoreMessage`.
  - The app registers `api/src/core/inference/model-provider.ts` (`api/src/setup/sdk-host-init.ts:41`). It holds the provider table and the key lookup (since replaced: keys now come only from the host's encrypted store, entered in Settings → Secrets; see step 6). Cohere throws "not implemented".
  - Unit tests swap that host module globally. `fakeModel` (`apack-sdk/src/testing/fake-model.ts`) hand-implements the model spec, the test host re-registers a throwing `noModel` (`testing/host.ts:126`), and the harness restores it after each test.
- **The callers are prototype code.**
  - The only in-repo model call that runs is the `llm` step (`default-setup/src/extensions/steps/llm/runtime.ts:69-81`).
  - default-setup's `llm` service (`features/brain/be/services/llm.ts`) only re-exports the inference module.
  - The model client (`extensions/services/model-client/`, about 1,200 lines) and ChatGPT OAuth (`extensions/services/openai-auth/`, `extensions/services/auth.ts`) have no callers: nothing reaches them through `services`, imports them, or references them from a content action or the UI.
  - The model catalog (`@apackdev/sdk/models`, `apack-sdk/src/services/models.ts`) has ids like `gpt-4-turbo`, which the `llm` form stores as the node's `model` (`steps/llm/form.vue:357-360`). The runtime splits it on `:` and defaults to `anthropic:claude-3-haiku-20240307`, so a model picked in the editor doesn't resolve.
- **AI SDK 7** (`ai@7.0.100`; providers `@ai-sdk/{anthropic,openai,google,groq,mistral,cohere}` 4.x):
  - `generateObject`/`streamObject` are deprecated in favour of `generateText({ output: Output.object({ schema }) })`.
  - `maxSteps` became `stopWhen: isStepCount(n)`; `ToolLoopAgent` exists.
  - `tool()` takes `inputSchema`; `CoreMessage` became `ModelMessage`; `system` became `instructions`; `maxTokens` became `maxOutputTokens`.
  - `result.fullStream` became `result.stream`, with new part shapes.
  - `LanguageModel` accepts string ids, resolved through the process-global `globalThis.AI_SDK_DEFAULT_PROVIDER`, or the Vercel AI Gateway when it's unset.
  - `createProviderRegistry` takes providers built with their keys; there is no per-call credential hook.
  - `openai(id)` uses the Responses API. `createGoogleGenerativeAI` is now `createGoogle`, with the old name kept as an alias.
  - `ai/test` has `MockLanguageModelV4` and `simulateReadableStream`.
  - Requires Node ≥22 and zod `^3.25.76 || ^4.1.8`. ESM only.
  - Sources: the migration guides shipped in the package (`docs/08-migration-guides/`), and its `dist/index.d.ts`.
- **The TypeScript floor.**
  - `@apackdev/sdk` and `@apackdev/ui` declare `typescript: ">=5.3"`. `goal-review-fixes.md` Decision 2 chose 5.3 as the lowest version that compiles `@apackdev/ui`'s vue-tsc declarations (`import("vue", { with: { "resolution-mode": "import" } })`).
  - `packages/internal-typescript-floor` pins 5.3.3, and `apack-cli/tests/helpers/published-packages.ts:15` runs the published-types specs with it.
  - The published-types specs compile with `skipLibCheck: true` (`published-sdk-types.spec.ts:22`, `published-ui-types.spec.ts:19`).
  - The rule appears in `CLAUDE.md` and `apack-sdk/TYPED-EARS.md:53`. `ears/runtime.ts:60` keeps a `NoInfer` workaround for 5.3.
- **Zod and Node.**
  - The workspace has zod 3.25.76, but `apack-sdk` and `default-setup` declare `^3.24.0` and `api` `^3.24.4`.
  - Packs are documented as Node ≥20.6 (`docs/public-facing/getting-started.md`), and `@apackdev/testing` declares `engines.node >=20.6.0`.

## Spike results (2026-09-14)

**TypeScript floor.**
- **Published types pass at every candidate floor.** The published-types, no-`any` and facade-typing specs (26 tests) pass with the floor pointed at 5.3.3, 5.4.5 and 5.7.3. That covers `@apackdev/ui`'s Vue component props, emits, slots and composables under `node16` and `bundler`.
- **No tool in the pipeline needs an older TypeScript:**
  - Monaco bundles 5.9.3, vue-tsc 3.2 needs ≥5.0, and API Extractor uses the workspace 5.9.3.
  - `@vue/compiler-sfc` and `@vitejs/plugin-vue` state no requirement.
  - `apack init` and the example pack install `^5.8.3`.
- **`ai` 7 sets the floor at 5.7.**

  | TypeScript | Library-check errors | With `skipLibCheck` |
  |---|---|---|
  | 5.3.3 | 145 (`NoInfer`, …) | — |
  | 5.4.5, 5.5.4, 5.6.3 | 6 (`Type 'Uint8Array' is not generic`: `Uint8Array<ArrayBuffer>` in `ai`'s own `.d.ts`) | 0 |
  | 5.7.3, 5.9.3 | 0 | 0 |

**Runtime.** Under Electron 37's Node (v22.17.1, `ELECTRON_RUN_AS_NODE`, as the API runs), a CommonJS `require()` of `ai@7`, `ai/test`, `@ai-sdk/openai`, `@ai-sdk/anthropic` and `@ai-sdk/google` works. The API and CommonJS pack runtimes can load them.

**Contract.** A draft of Decision 4's contract compiled against `ai@7.0.100`'s real types on 5.7.3 and 5.9.3, with library checks on and 0 errors. It kept:
- `output` typed from `Output.object({ schema })`;
- tool `input` typed from `inputSchema`;
- `stream` parts typed;
- an unknown provider prefix and a model object rejected.

Findings that shape the implementation:
- **Output types:** `Output` is a value namespace. The type is exported as `OutputInterface`.
- **Runtime context:** `ai` doesn't export its `Context` type; derive it from `generateText`'s parameters.
- **Generics:** `generateText<TOOLS, RUNTIME_CONTEXT, OUTPUT>` and `streamText<…>` take `model: LanguageModel`. `Omit<…, 'model'> & { model: ModelId }` over an instantiation expression (`typeof generateText<TOOLS, CONTEXT, OUTPUT>`) keeps inference of every generic.

## Decisions

Final.

1. **TypeScript floor 5.7.**
   - `@apackdev/sdk` and `@apackdev/ui` declare `typescript: ">=5.7"`, and `packages/internal-typescript-floor` pins 5.7.3.
   - The published-types specs name the floor `'5.7'`.
   - `CLAUDE.md`, `TYPED-EARS.md`'s compatibility line and `getting-started.md` say 5.7.
   - The typed EARS `NoInferType` workaround stays: those types are change-controlled.
2. **Node 22 and zod 3.25.76 for packs.**
   - `@apackdev/sdk`, `@apackdev/cli` and `@apackdev/testing` declare `engines.node >=22`, and `getting-started.md` says Node 22. Node 20 is past end-of-life, and `ai` 7 needs 22.
   - Every workspace declaring zod uses `^3.25.76`, as does the SDK's zod peer.
3. **AI SDK 7, owned by the app.**
   - The API depends on `ai@^7` and `@ai-sdk/{anthropic,openai,google,groq,mistral,cohere}@^4`.
   - `@apackdev/sdk` keeps `ai` as an optional peer (`^7`) for the contract's types and `fakeInference`.
   - default-setup depends on neither `ai` nor any `@ai-sdk/*` package.
   - Nothing sets `globalThis.AI_SDK_DEFAULT_PROVIDER` or uses the AI Gateway.
   - *Amended after implementation:* the provider packages are `@apackdev/host` dependencies (Decision 6), and `ai` is a required peer of `@apackdev/sdk`: an optional peer a pack hasn't installed turns the contract's types into `any` (`published-sdk-peers.spec.ts`).
4. **One service: `services.inference`.** In `HostServices`, next to `appData` and `traceStore`, delegating to host module `inference`.
   ```ts
   import type { generateText, streamText, ToolSet, OutputInterface } from 'ai';
   type WithModelId<T> = Omit<T, 'model'> & { model: ModelId };

   export interface InferenceService {
     generateText<TOOLS extends ToolSet = {}, CONTEXT extends Context = Context, OUTPUT extends OutputInterface = OutputInterface<string, string>>(
       options: WithModelId<Parameters<typeof generateText<TOOLS, CONTEXT, OUTPUT>>[0]>,
     ): ReturnType<typeof generateText<TOOLS, CONTEXT, OUTPUT>>;
     streamText<TOOLS extends ToolSet = {}, CONTEXT extends Context = Context, OUTPUT extends OutputInterface = OutputInterface<string, string, never>>(
       options: WithModelId<Parameters<typeof streamText<TOOLS, CONTEXT, OUTPUT>>[0]>,
     ): Promise<ReturnType<typeof streamText<TOOLS, CONTEXT, OUTPUT>>>;
   }
   ```
   - **Two calls.** Structured output is `output: Output.object(...)`. There is no `languageModel`, `generateObject`, `streamObject`, web search or agent API.
   - *Amended after implementation:* the service also has `createAgent` (an async `ToolLoopAgent` whose model and key resolve on each call), `embed`/`embedMany`, `generateImage`, `generateSpeech`, `transcribe` and `rerank`. Each takes ids from providers that give its kind (`providerCapabilities`, `ModelIdOf<K>`), and the model `prepareStep` or `prepareCall` picks is an id too, so no call reaches `ai`'s global provider.
   - **No overrides.** Options take no `apiKey`, `baseURL` or `headers`: keys belong to the app.
   - **The host service names include `inference`** (`apack-host/src/packs/pack-registration.ts:21`), so no pack can register a service with that name.
5. **Model ids.**
   - `@apackdev/sdk/models` exports `ProviderName` (`'anthropic' | 'openai' | 'google' | 'groq' | 'mistral' | 'cohere'`, the SDK's `SecretProvider` without `custom`) and `ModelId = \`${ProviderName}:${string}\``.
   - Catalog entries carry `id: ModelId` and `provider: ProviderName`, so the `llm` form stores ids the runtime resolves.
   - *Amended after implementation:* entries carry only `id`; the provider comes from `parseModelId(id)`.
   - `@apackdev/sdk/services` imports the types from there.
6. **The app's implementation** (`api/src/core/inference/inference.ts`, registered as host module `inference`):
   - *Amended after implementation:* it moved to `@apackdev/host/services/inference.ts`, next to `appData` and `traceStore`, with the settings view in `@apackdev/host/settings` and the provider packages as `@apackdev/host` dependencies. The API registers all three with `registerHostServices()`.
   ```ts
   const PROVIDERS = { anthropic: createAnthropic, openai: createOpenAI, google: createGoogle,
                       groq: createGroq, mistral: createMistral, cohere: createCohere } satisfies Record<ProviderName, …>;
   ```
   - It splits the id at the first `:` and builds the provider with the key selected for it at call time: keys come only from Settings → Secrets, where each provider holds several labelled keys with one selected, in the host's encrypted store (`@apackdev/host/secrets`, read with `secretsStore.keyFor(provider)`), never from environment variables. It returns `.languageModel(modelId)` and calls `ai`'s `generateText`/`streamText` with it.
   - An unknown provider or a missing key throws, naming the provider (and, for a key, where to set it).
   - `openai.responses` and `model-provider.ts` are removed.
7. **Pure pieces come from `ai` directly.** Packs import `tool`, `Output`, `isStepCount`, `ModelMessage` and result types from `ai`. The SDK re-exports none of them, and `@apackdev/sdk/inference` is removed.
   - *Amended after implementation:* `output` also takes plain data (`OutputSpec`: `{ type: 'text' | 'json' | 'object' | 'array' | 'choice', … }`), translated to the matching `Output.*` by the SDK's `_createInferenceService`, which the host's implementation and `fakeInference` share. Sandboxed actions can't import `ai`, and a data form can be stored. An `Output` instance still passes through unchanged, so nothing from `ai` is lost.
8. **Tests mock the service; only the SDK fakes a model.**
   - **Default:** the test host (`@apackdev/sdk/testing`) registers an `inference` whose calls throw, naming `mockService('inference', fakeInference(…))`.
   - **`fakeInference(reply)`** (`@apackdev/sdk/testing`) returns an `InferenceService & { calls: FakeInferenceCall[] }`:
     - It runs `ai`'s real `generateText`/`streamText` on `MockLanguageModelV4`, so steps, `output` parsing, tool execution and stream parts behave as in the app.
     - `reply` is a string, `{ text?, toolCalls?: [{ toolName, input }] }`, or a function of the call returning either. A function sees every step, so a tool loop can reply with tool calls and then text.
     - Each call records `{ model: ModelId, prompt, tools: string[], stream: boolean }`, where `prompt` is the messages the model received.
     - *Amended after implementation:* calls record `{ kind: 'text', model, instructions, messages, tools, stream }`, and the fake answers every kind (`kind: 'embedding' | 'image' | 'speech' | 'transcription' | 'reranking'`) from per-kind replies with defaults.
     - It loads `ai` and `ai/test` lazily, so `@apackdev/sdk/testing` still loads in a pack without `ai`.
   - **The harness** (`@apackdev/testing/harness`) has no inference code. Tests call `mockService<Services, 'inference'>('inference', fakeInference(…))`, or mock a single function.
     - *Amended after implementation:* the harness has `mockInference(reply, replies?)`, that call in one line.
9. **Deleted.**
   - `@apackdev/sdk/inference` (`services/inference.ts`, the export, `etc/inference.api.md`, the API's `SDK_BRIDGE` entry).
   - `testing/fake-model.ts` and its spec, and `noModel`/`restoreModelProvider`.
   - `api/src/core/inference/model-provider.ts` and its spec.
   - default-setup's `llm` service and manifest entry, `extensions/services/model-client/`, `extensions/services/openai-auth/` and `extensions/services/auth.ts`, with their manifest entries and registry specs.
10. **Scope.**
    - In: text generation, streaming, structured output and tool loops through `services.inference`; the `llm` step and form; the catalog's id format.
    - Out:
      - agents (`ToolLoopAgent`) — *done since*
      - embeddings and images — *done since*
      - who owns secret selection — *done since*
      - refreshing the catalog's models and the `llm` step's default model content

## Phases

### Phase 1 — TypeScript floor

- Pin `packages/internal-typescript-floor` to 5.7.3 and set the `typescript` peers to `>=5.7` (Decision 1).
- Rename the floor in `published-packages.ts` to `'5.7'`.
- Update `CLAUDE.md`, `TYPED-EARS.md`'s compatibility line and `getting-started.md`.
- Raise `engines.node` and the zod ranges (Decision 2).

**Done when:** the published-types, no-`any` and facade-typing specs pass at 5.7 under `node16` and `bundler`, `packages:check` passes, and the example pack's `apack test --app-root <repo>` passes.

### Phase 2 — AI SDK 7 and `services.inference`

The contract, the app implementation and the callers depend on each other. They land as one change, so every commit in this phase typechecks.
- Dependencies (Decision 3); remove `ai` 4 and its transitive packages from the lockfile.
- SDK: the contract, `ModelId`/`ProviderName` and `services.inference` (Decisions 4, 5, 7).
- SDK testing: the test host's failing `inference` and `fakeInference` (Decision 8).
- App: `inference.ts` and its registration (Decision 6).
- default-setup:
  - The `llm` step calls `services.inference.generateText({ model: node.model, instructions: node.systemPrompt, prompt, temperature, maxOutputTokens })`.
  - The node's `model` defaults to a `ModelId`, and a model that isn't one fails the step naming the node.
- Delete everything in Decision 9, regenerate default-setup's entries, and run `api:update`.
- Add a published-types case that compiles a consumer of `@apackdev/sdk/services` at the floor with `skipLibCheck: false`.
- Tests:
  - `@apackdev/sdk/testing` spec for `fakeInference`:
    - text
    - `Output.object`
    - a tool call that runs `execute`, then text
    - streaming parts
    - the recorded calls
    - the unmocked default's error
  - app spec, using a local HTTP server standing in for OpenAI and Anthropic:
    - each provider's id resolves to that provider's model
    - an unknown provider and a missing key throw naming the provider
    - the stored key is the one sent
  - `llm` step spec: the prompt, instructions, temperature and model id reach `fakeInference`, the step completes with its text, and an invalid id fails the step;
  - `sdk-type-safety`, `service-registry` and `registries` specs name `inference` and no `llm`, `modelClient` or `openaiAuth`.

**Done when:**
- Every check in the goal's "Finished when" passes except `test:external-pack`, `test:packaged-authoring` and the docs.
- Mutation checks each fail a test:
  - removing the test host default
  - a wrong entry in the provider table
  - `fakeInference` not recording
  - the `llm` step dropping `instructions`
  - pointing the library-checked case at TypeScript 5.6

### Phase 3 — Model ids in the editor

- Catalog entries use `ModelId` ids and `ProviderName` providers (Decision 5). The `llm` form groups by provider and stores the entry's id.
- The flows FE and backend types that import `ModelCatalogEntry` follow.

**Done when:** a spec shows every catalog id resolving through the app's provider split, and an `llm` node saved from the form's selection runs under `fakeInference` with that id. Mutation: an id without a provider prefix fails the type check.

### Phase 4 — Packs

- The fixture pack's isolation spec and any flow spec that runs an `llm` step use `fakeInference`.
- `test-packaged-authoring.sh`:
  - its digest service calls `services.inference.generateText` with `output: Output.object(...)` and installs `ai@^7`;
  - its notes-summary flow spec mocks `inference` with `fakeInference` and asserts the recorded prompt;
  - its unit test count stays checked.
- `apack init`'s scaffold pins TypeScript `^5.8.3`; its `@types/node` becomes `^22`.

**Done when:** `test:external-pack` and `test:packaged-authoring` pass, from the packed tarballs for the latter, and a freshly scaffolded pack's tests pass.

### Phase 5 — Docs

- `docs/public-facing/services-and-data.md`: an Inference section with the two calls, `provider:model` ids and the providers, structured output with `Output`, tools with `tool` and `stopWhen`, and what comes from `ai`.
- `docs/public-facing/content.md`: actions use `services.inference`; the services table drops `llm`.
- `docs/public-facing/testing.md`: models are mocked with `fakeInference`.
- `docs/public-facing/getting-started.md`: Node 22 and TypeScript 5.7, and `ai` for packs that write tools or structured output.
- The CLAUDE.md files: root (services, floor), `apack-sdk/TYPED-EARS.md`, default-setup (services list, no model client), `apack-testing`.

**Done when:** no doc, template or CLAUDE.md mentions `@apackdev/sdk/inference`, `services.llm`, `services.models`, `fakeModel`, `modelClient` or TypeScript 5.3.

## Deferred

- Video generation (`generateVideo`): few of the providers give it.
- The library's search index (`library/be/search-index`, behind `SEARCH_INDEX_FF`) names its API embedding models by `provider:model` id and embeds through `services.inference`, but stays dormant: its `fastembed` and `usearch` dependencies aren't installed. Its `README.md` lists the call sites and the steps to turn it on.
- *Done since:* the model catalog and the `llm` step's default model were refreshed (`fb06e736a`); agents, embeddings, images, speech, transcription and reranking run through `services.inference` (`createAgent`, `embed`/`embedMany`, `generateImage`, `generateSpeech`, `transcribe`, `rerank`); secret selection belongs to the host, which keeps several keys per provider, encrypted, with one selected (`services.secrets`).

## Constraints

- Commit as you go in logical chunks, with conventional messages and no Co-Authored-By or Claude-Session lines. Check `git diff --cached` before each commit and commit with `git commit -- <paths>`. Never push or tag.
- Cut the branch from `AS/test-harness-system-deps`. The uncommitted `AS/models-service` work (`services.models`, `@apackdev/testing/mock-model`) is superseded. Don't carry it over; read it only for reference.
- Never publish externally: no `npm publish` (use `npm pack` and `--dry-run`), no real GitHub releases. CI workflows may be written, not triggered.
- Never use broad pkill/killall on Electron or node. E2E runs alongside the user's dev and prod apps in the `apack-test` namespace.
- Don't launch the app outside the test environment without isolating `APACK_USER_DATA_DIR`.
- Never run bare tsc on `packages/preload`. Don't run `npm install` in the example pack. Don't edit monorepo version/release metadata.
- Pack code and pack tests import only `@apackdev/sdk`, `@apackdev/ui`, `@apackdev/testing` and pure `ai` pieces; `@apackdev/host` stays host-only. The typed EARS types are change-controlled (`packages/apack-sdk/TYPED-EARS.md`).
- `@apackdev/sdk/services`, `@apackdev/sdk/models` and `@apackdev/sdk/testing` are published: no `any` (`published-sdk-any.spec.ts`), TypeScript 5.7 (`packages/internal-typescript-floor`), `api:update` after export changes.
- The CLI suite requires `npm run packages:build` after SDK source changes. default-setup's runtime (`node packages/default-setup/dev-build.mjs`) must be rebuilt before the API suites and E2E.
- Investigate failing tests before changing assertions; mutation-check every new guard, helper and test.
- No tests reach a real provider: no API keys in test environments. The app spec uses a local HTTP server.
- External packs are first-class. Keep the in-repo fixture pack, the example pack (`/Users/spankyed/Develop/Projects/apack-external/example-pack`) and `test:packaged-authoring` passing throughout.
