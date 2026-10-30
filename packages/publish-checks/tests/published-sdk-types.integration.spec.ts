import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { publishedManifest } from '@apackdev/host/build/published-manifest';
import { CONSUMER_MATRIX, PACKAGES_BUILT, PACKED_PACKAGES, REPO_ROOT, compileConsumer, installPublishedPackages, workspacePackList, type TscVersion } from '../src/published-packages.ts';

const execFileAsync = promisify(execFile);

/** Dependency directories added by installation are not files shipped in the npm tarball. */
function packedRoots(directory:string):string[] {
  return [...new Set([...workspacePackList(directory)].map(file=>file.split('/')[0]))].sort();
}

let consumer: string | undefined;
beforeAll(() => {
  if (PACKAGES_BUILT) consumer = installPublishedPackages();
});
afterAll(() => {
  if (consumer) fs.rmSync(consumer, { recursive: true, force: true });
});

function typecheck(tsc: TscVersion, moduleResolution: 'node16' | 'bundler') {
  // Barrels that re-export from relative modules, as consumers use them
  return compileConsumer(consumer!, tsc, moduleResolution, { 'index.ts': [
    "import { compareVersions } from '@apackdev/sdk/utils/pure';",
    "import type { StepDefinition } from '@apackdev/sdk/steps';",
    "import type { ActionMeta } from '@apackdev/sdk/build';",
    "export const newer: number = compareVersions('1.0.0', '0.9.0');",
    "export const step: StepDefinition | undefined = undefined;",
    "export type Meta = ActionMeta;",
    // @apackdev/sdk/fe declares the preload bridge on window
    "import '@apackdev/sdk/fe';",
    "export const popout = window.electronAPI?.surfaces.popout;",
    // Typed data access and events come only from the factories a pack's facade uses
    "import { defineEars, type UntypedSchema } from '@apackdev/ears';",
    "import { boundEars } from '@apackdev/sdk/ears';",
    "import { defineEvents } from '@apackdev/sdk/events';",
    "import type { EARS } from '@apackdev/sdk';",
    "type IsAny<T> = 0 extends 1 & T ? true : false;",
    "interface MemoEntity { entityType: 'Memo'; text: string }",
    "const { query } = defineEars<UntypedSchema & { shapes: { Memo: MemoEntity }; names: 'Memo' }>(boundEars);",
    "declare const memoId: EARS.EntityId<'Memo'>;",
    "const memo = query.ids(memoId).pickOne()!;",
    "export const text: string = memo.text;",
    "export const textNotAny: IsAny<typeof memo.text> = false;",
    "const { broadcastToSurface, sendToSystem } = defineEvents<{ memos: { type: 'MEMO_ADDED'; id: string } }, { memos: { type: 'ADD_MEMO'; text: string } }>('demo');",
    "sendToSystem('memos', { type: 'ADD_MEMO', text: 'x' });",
    "// @ts-expect-error ADD_MEMO needs its text",
    "sendToSystem('memos', { type: 'ADD_MEMO' });",
    "broadcastToSurface('memos', { type: 'MEMO_ADDED', id: 'm1' });",
    "// @ts-expect-error the memos surface doesn't receive this event",
    "broadcastToSurface('memos', { type: 'MEMO_REMOVED' });",
    "// @ts-expect-error untyped query helpers aren't pack-facing",
    "export { findAll } from '@apackdev/ears';",
    // An engine is an instance a test or tool creates over a database; its admin face comes only with it
    "import { createEarsEngine } from '@apackdev/ears';",
    "import { openDatabase } from '@apackdev/ears/lmdb';",
    "const database = openDatabase({ path: 'memos', schema: { types: { Memo: { required: [] } }, relations: {}, roles: [] } });",
    "const engine = createEarsEngine({ database });",
    "engine.create('Memo').set('title', 'held');",
    "engine.admin.clear();",
    // Host-only modules live in the private @apackdev/host
  ] });
}

/**
 * A pack calling models: `services.inference` typed with the AI SDK's own types. Compiled with
 * library checks, since `skipLibCheck` would hide an `ai` release that needs a newer TypeScript
 * than the packages' floor (ai 7 needs 5.7: `Uint8Array<ArrayBuffer>`).
 */
function typecheckInference(moduleResolution: 'node16' | 'bundler') {
  return compileConsumer(path.join(consumer!, `inference-${moduleResolution}`), '5.7', moduleResolution, { 'index.ts': [
    "import { isStepCount, Output, tool } from 'ai';",
    "import { z } from 'zod';",
    "import type { HostServices, InferenceService } from '@apackdev/sdk/services';",
    "import type { ModelId } from '@apackdev/sdk/models';",
    "declare const services: HostServices;",
    "const inference: InferenceService = services.inference;",
    "const model: ModelId = 'anthropic:claude-sonnet-4-5';",
    "export const text: Promise<string> = inference.generateText({ model, instructions: 'Be brief', prompt: 'hi' }).then((r) => r.text);",
    "export const count: Promise<number> = inference.generateText({ model, prompt: 'x', output: Output.object({ schema: z.object({ n: z.number() }) }) }).then((r) => r.output.n);",
    "const lookup = tool({ description: 'look up', inputSchema: z.object({ q: z.string() }), execute: async ({ q }) => q.length });",
    "export const looked = inference.generateText({ model, prompt: 'x', tools: { lookup }, stopWhen: isStepCount(2) });",
    "export const streamed = inference.streamText({ model: 'openai:gpt-5', prompt: 'hi' }).then((r) => r.text);",
    // output as data, typed as the Output it stands for
    "const Weather = z.object({ city: z.string(), temperature: z.number() });",
    "export const city: Promise<string> = inference.generateText({ model, prompt: 'x', output: { type: 'object', schema: Weather } }).then((r) => r.output.city);",
    "export const temps: Promise<number[]> = inference.generateText({ model, prompt: 'x', output: { type: 'array', element: Weather } }).then((r) => r.output.map((w) => w.temperature));",
    "export const label: Promise<'bug' | 'feature'> = inference.generateText({ model, prompt: 'x', output: { type: 'choice', options: ['bug', 'feature'] } }).then((r) => r.output);",
    "export const partial = inference.streamText({ model, prompt: 'x', output: { type: 'object', schema: Weather } }).then(async (r) => { for await (const p of r.partialOutputStream) { const c: string | undefined = p.city; void c; } });",
    // an Output from ai types as it does in ai's own generateText
    "export const viaOutput: Promise<number> = inference.generateText({ model, prompt: 'x', output: Output.object({ schema: Weather }) }).then((r) => r.output.temperature);",
    "// @ts-expect-error a choice spec's output is one of its options",
    "export const notLabel: Promise<'question'> = inference.generateText({ model, prompt: 'x', output: { type: 'choice', options: ['bug'] } }).then((r) => r.output);",
    "// @ts-expect-error an object spec needs a schema",
    "void inference.generateText({ model, prompt: 'x', output: { type: 'object' } });",
    // agents, embeddings, images, speech and transcription, each from providers that give them
    "export const tasks: Promise<string[]> = inference.createAgent({ model, instructions: 'List tasks', tools: { lookup }, output: { type: 'object', schema: z.object({ tasks: z.array(z.string()) }) } }).then((agent) => agent.generate({ prompt: 'x' })).then((r) => r.output.tasks);",
    "export const vector: Promise<number[]> = inference.embed({ model: 'openai:text-embedding-3-small', value: 'x' }).then((r) => r.embedding);",
    "export const vectors: Promise<number[][]> = inference.embedMany({ model: 'cohere:embed-v4.0', values: ['x'] }).then((r) => r.embeddings);",
    "export const png: Promise<Uint8Array> = inference.generateImage({ model: 'google:imagen-4.0-generate-001', prompt: 'x' }).then((r) => r.image.uint8Array);",
    "export const audio: Promise<Uint8Array> = inference.generateSpeech({ model: 'mistral:voxtral-mini-tts-latest', text: 'x' }).then((r) => r.audio.uint8Array);",
    "export const transcript: Promise<string> = inference.transcribe({ model: 'groq:whisper-large-v3', audio: new Uint8Array() }).then((r) => r.text);",
    "export const ranked: Promise<string | undefined> = inference.rerank({ model: 'cohere:rerank-v3.5', query: 'x', documents: ['a', 'b'] }).then((r) => r.rerankedDocuments[0]);",
    "export const plain: Promise<string> = inference.createAgent({ model }).then((agent) => agent.generate({ prompt: 'x' })).then((r) => r.text);",
    // models a callback picks are ids too, resolved with the user's keys
    "void inference.generateText({ model, prompt: 'x', prepareStep: ({ stepNumber }) => stepNumber > 0 ? { model: 'openai:gpt-5' } : undefined });",
    "void inference.createAgent({ model, callOptionsSchema: z.object({ fast: z.boolean() }), prepareCall: ({ options, ...rest }) => ({ ...rest, model: options.fast ? 'anthropic:claude-haiku-4-5' : rest.model }) });",
    "// @ts-expect-error prepareStep names a model by id",
    "void inference.generateText({ model, prompt: 'x', prepareStep: () => ({ model: 'gpt-5' }) });",
    "// @ts-expect-error prepareCall names a model by id",
    "void inference.createAgent({ model, prepareCall: (options) => ({ ...options, model: 'claude-haiku-4-5' }) });",
    "// @ts-expect-error only Cohere gives reranking models",
    "void inference.rerank({ model: 'openai:gpt-5', query: 'x', documents: ['a'] });",
    "// @ts-expect-error the AI SDK's test hooks aren't part of the service",
    "void inference.embed({ model: 'openai:text-embedding-3-small', value: 'x', _internal: {} });",
    "// @ts-expect-error Anthropic gives no embedding models",
    "void inference.embed({ model: 'anthropic:claude-opus-5', value: 'x' });",
    "// @ts-expect-error Groq gives no image models",
    "void inference.generateImage({ model: 'groq:llama-3.3-70b-versatile', prompt: 'x' });",
    "// @ts-expect-error a provider inference doesn't run",
    "void inference.generateText({ model: 'nope:x', prompt: 'hi' });",
    "// @ts-expect-error a model id without its provider",
    "void inference.generateText({ model: 'gpt-5', prompt: 'hi' });",
  ] }, { skipLibCheck: false, types: ['node'] });
}

describe.skipIf(!PACKAGES_BUILT)('published @apackdev/sdk', () => {
  it.each(CONSUMER_MATRIX)('typecheck for consumers using TypeScript $tsc, moduleResolution $moduleResolution', async ({ tsc, moduleResolution }) => {
    const result = await typecheck(tsc, moduleResolution);
    expect(result.code, result.output).toBe(0);
  });

  it("types inference with the AI SDK's own types at the TypeScript floor, with library checks, under node16 and bundler", async () => {
    // Each compile checks ai's full declarations: run both at once
    for (const result of await Promise.all([typecheckInference('node16'), typecheckInference('bundler')])) {
      expect(result.code, result.output).toBe(0);
    }
  });

  it('ships no host-only module', async () => {
    const sdk = path.join(consumer!, 'node_modules', '@apackdev', 'sdk');
    // A plain Node process, as a pack's runtime resolves (test workers run with extra conditions)
    const resolveFromConsumer = async (specifier: string) => (await execFileAsync(
      process.execPath,
      ['--input-type=module', '-e', `process.stdout.write(import.meta.resolve(${JSON.stringify(specifier)}))`],
      { cwd: consumer!, env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
    )).stdout;
    expect(await resolveFromConsumer('@apackdev/sdk/repositories')).toBe(pathToFileURL(fs.realpathSync(path.join(sdk, 'dist', 'repositories', 'index.js'))).href);
    const ears = path.join(consumer!, 'node_modules', '@apackdev', 'ears');
    expect(await resolveFromConsumer('@apackdev/ears')).toBe(pathToFileURL(fs.realpathSync(path.join(ears, 'dist', 'index.js'))).href);
    const shipped = fs.readdirSync(path.join(sdk, 'dist'), { recursive: true }).map(String);
    expect(packedRoots(PACKED_PACKAGES.sdk!)).toEqual(['apack.schema.json', 'dist', 'package.json']);
    // Source maps would point at src, which isn't published
    expect(shipped.filter((f) => f.endsWith('.map'))).toEqual([]);
  });

  it('loads the SDK on the installed @apackdev/ears', async () => {
    // The SDK's EARS namespace and its repositories import the engine: a plain Node process resolves it from the consumer
    const earsRoot = path.join(consumer!, 'node_modules', '@apackdev', 'ears');
    const matcher = pathToFileURL(path.join(earsRoot, 'dist', 'sqlite', 'regex.js')).href;
    const { stdout: output } = await execFileAsync(
      process.execPath,
      ['--input-type=module', '-e', `const { EARS } = await import('@apackdev/sdk/types'); const { flowRepository } = await import('@apackdev/sdk/repositories'); const {createRegexCompiler}=await import(${JSON.stringify(matcher)});const pattern=createRegexCompiler().compile('(?i)^hello');try{process.stdout.write(EARS.Entity.Flow + ' ' + EARS.RelKind.CONTAINS + ' ' + typeof flowRepository + ' ' + pattern.matches('HELLO'))}finally{pattern.close()}`],
      { cwd: consumer!, env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
    );
    expect(output).toBe('Flow contains object true');
    expect(packedRoots(PACKED_PACKAGES.ears!)).toEqual(['dist', 'package.json', 'vendor']);
    expect(fs.readdirSync(path.join(earsRoot, 'vendor'))).toEqual(['rregex']);
    expect(fs.readdirSync(path.join(earsRoot, 'vendor', 'rregex')).sort())
      .toEqual(['LICENSE', 'README.md', 'provenance.json', 'rregex.cjs', 'rregex_bg.wasm']);
  });

  /**
   * It used to publish the workspace manifest byte for byte, which is how 99 exports targets came to name
   * `./src/**` that `files` does not ship. What a consumer installs is that manifest through
   * `publishedManifest` and nothing else: a field it does not derive is one the workspace still decides.
   */
  it.each(['ears', 'sdk', 'ui'])('publishes the workspace package.json of @apackdev/%s, derived', (name) => {
    const published = JSON.parse(fs.readFileSync(path.join(consumer!, 'node_modules', '@apackdev', name, 'package.json'), 'utf-8'));
    const dir = path.join(REPO_ROOT, 'packages', `apack-${name}`);
    const workspace = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
    expect(published).toEqual(publishedManifest(workspace, dir));
    expect(JSON.stringify(published)).not.toContain('@apackdev/source');
  });
});
