// fakeInference runs the AI SDK's real calls on a scripted model and records what the model received
import { describe, expect, expectTypeOf, it } from 'vitest';
import { isStepCount, jsonSchema, Output, tool, type JSONSchema7 } from 'ai';
import { z } from 'zod';
import { fakeInference, startTestRuntime } from '../../src/testing/index.ts';
import { boundHost } from '../../src/runtime/host-runtime.ts';

/** Minimal Standard Schema v1 + Standard JSON Schema v1 implementation (non-Zod) to pin library neutrality. */
function standardObjectSchema<T>(
  json: JSONSchema7,
  validate: (value: unknown) => { value: T } | { issues: readonly { message: string }[] },
) {
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'custom-standard-schema',
      validate,
      jsonSchema: {
        input: () => json as Record<string, unknown>,
        output: () => json as Record<string, unknown>,
      },
      types: undefined as unknown as { readonly input: T; readonly output: T },
    },
  };
}

describe('fakeInference', () => {
  it('answers generateText with its reply and records the call', async () => {
    const inference = fakeInference('Hello from the fake');
    const result = await inference.generateText({ model: 'anthropic:claude-sonnet-4-5', instructions: 'Be brief', prompt: 'Say hello' });
    expect(result.text).toBe('Hello from the fake');
    expect(result.finishReason).toBe('stop');
    expect(inference.calls).toEqual([{ kind: 'text', model: 'anthropic:claude-sonnet-4-5', instructions: 'Be brief', messages: [{ role: 'user', text: 'Say hello' }], tools: [], stream: false }]);
  });

  it('parses structured output from a JSON reply', async () => {
    const inference = fakeInference(JSON.stringify({ intent: 'buy', confidence: 0.9 }));
    const { output } = await inference.generateText({
      model: 'openai:gpt-5',
      prompt: 'Classify: buy milk',
      output: Output.object({ schema: z.object({ intent: z.string(), confidence: z.number() }) }),
    });
    expect(output).toEqual({ intent: 'buy', confidence: 0.9 });
  });

  describe('output given as data', () => {
    const Weather = z.object({ city: z.string(), temperature: z.number() });

    it.each([
      ['object', { type: 'object', schema: Weather }, { city: 'Paris', temperature: 21 }, { city: 'Paris', temperature: 21 }],
      ['array', { type: 'array', element: Weather, minItems: 1 }, { elements: [{ city: 'Paris', temperature: 21 }] }, [{ city: 'Paris', temperature: 21 }]],
      ['choice', { type: 'choice', options: ['bug', 'feature'] }, { result: 'bug' }, 'bug'],
      ['json', { type: 'json' }, { any: ['shape'] }, { any: ['shape'] }],
    ] as const)('parses a %s spec as its Output would', async (_kind, output, reply, expected) => {
      const inference = fakeInference(JSON.stringify(reply));
      const result = await inference.generateText({ model: 'openai:gpt-5', prompt: 'x', output });
      expect(result.output).toEqual(expected);
    });

    it('takes a plain JSON Schema, as stored settings hold one, for an object or array spec', async () => {
      const weather: JSONSchema7 = { type: 'object', properties: { city: { type: 'string' }, temperature: { type: 'number' } }, required: ['city', 'temperature'] };
      const object = await fakeInference(JSON.stringify({ city: 'Paris', temperature: 21 }))
        .generateText({ model: 'openai:gpt-5', prompt: 'x', output: { type: 'object', schema: weather } });
      const array = await fakeInference(JSON.stringify({ elements: [{ city: 'Paris', temperature: 21 }] }))
        .generateText({ model: 'openai:gpt-5', prompt: 'x', output: { type: 'array', element: weather } });
      expect(object.output).toEqual({ city: 'Paris', temperature: 21 });
      expect(array.output).toEqual([{ city: 'Paris', temperature: 21 }]);
    });

    it('takes no schema as an empty object schema and a boolean JSON Schema as a JSON Schema, from stored settings', async () => {
      const inference = fakeInference(JSON.stringify({ city: 'Paris' }));
      const call = (schema: unknown) => inference.generateText({ model: 'openai:gpt-5', prompt: 'x', output: { type: 'object', schema: schema as JSONSchema7 } });
      expect((await call(null)).output).toEqual({ city: 'Paris' });
      expect((await call(true)).output).toEqual({ city: 'Paris' });
    });

    it('takes a schema jsonSchema() from ai built, as ai does', async () => {
      const validated: unknown[] = [];
      const schema = jsonSchema<{ city: string }>({ type: 'object', properties: { city: { type: 'string' } } }, { validate: (value) => { validated.push(value); return { success: true, value: value as { city: string } }; } });
      const result = await fakeInference(JSON.stringify({ city: 'Paris' })).generateText({ model: 'openai:gpt-5', prompt: 'x', output: { type: 'object', schema } });
      expect(result.output).toEqual({ city: 'Paris' });
      expect(validated).toEqual([{ city: 'Paris' }]);
    });

    it('treats a text spec as text', async () => {
      const inference = fakeInference('plain words');
      expect((await inference.generateText({ model: 'openai:gpt-5', prompt: 'x', output: { type: 'text' } })).output).toBe('plain words');
    });

    it('rejects a reply its spec rejects', async () => {
      const inference = fakeInference(JSON.stringify({ result: 'question' }));
      await expect(inference.generateText({ model: 'openai:gpt-5', prompt: 'x', output: { type: 'choice', options: ['bug', 'feature'] } })).rejects.toThrow();
    });

    it('streams partial output for a spec', async () => {
      const inference = fakeInference(JSON.stringify({ city: 'Paris', temperature: 21 }));
      const result = await inference.streamText({ model: 'openai:gpt-5', prompt: 'x', output: { type: 'object', schema: Weather } });
      const partials: unknown[] = [];
      for await (const partial of result.partialOutputStream) partials.push(partial);
      expect(partials.at(-1)).toEqual({ city: 'Paris', temperature: 21 });
      expect(await result.output).toEqual({ city: 'Paris', temperature: 21 });
    });

    it('passes an Output from ai through unchanged', async () => {
      const inference = fakeInference(JSON.stringify({ result: 'feature' }));
      const result = await inference.generateText({ model: 'openai:gpt-5', prompt: 'x', output: Output.choice({ options: ['bug', 'feature'] }) });
      expect(result.output).toBe('feature');
    });
  });

  it('runs the tools a reply calls, then answers the next step', async () => {
    const executed: string[] = [];
    const lookup = tool({ description: 'Look up a word', inputSchema: z.object({ word: z.string() }), execute: async ({ word }) => { executed.push(word); return `${word} means dairy`; } });
    const inference = fakeInference((call) => call.messages.some((m) => m.role === 'tool')
      ? 'Milk is dairy'
      : { toolCalls: [{ toolName: 'lookup', input: { word: 'milk' } }] });

    const result = await inference.generateText({ model: 'openai:gpt-5', prompt: 'What is milk?', tools: { lookup }, stopWhen: isStepCount(3) });

    expect(executed).toEqual(['milk']);
    expect(result.text).toBe('Milk is dairy');
    expect(inference.calls).toHaveLength(2);
    expect(inference.calls[0]).toMatchObject({ kind: 'text', tools: ['lookup'] });
    expect(inference.calls[1]).toHaveProperty('messages', [
      { role: 'user', text: 'What is milk?' },
      { role: 'assistant', text: JSON.stringify({ toolName: 'lookup', input: { word: 'milk' } }) },
      { role: 'tool', text: JSON.stringify({ type: 'text', value: 'milk means dairy' }) },
    ]);
  });

  it('streams its reply through streamText', async () => {
    const inference = fakeInference('Streamed text');
    const result = await inference.streamText({ model: 'google:gemini-2.5-pro', prompt: 'Stream' });
    const deltas: string[] = [];
    for await (const part of result.stream) if (part.type === 'text-delta') deltas.push(part.text);
    expect(deltas.join('')).toBe('Streamed text');
    expect(await result.text).toBe('Streamed text');
    expect(inference.calls).toEqual([expect.objectContaining({ model: 'google:gemini-2.5-pro', stream: true })]);
  });

  it('runs an agent: its instructions, tools and structured output across steps', async () => {
    const searched: string[] = [];
    const search = tool({ description: 'Search notes', inputSchema: z.object({ query: z.string() }), execute: async ({ query }) => { searched.push(query); return ['Buy milk'] } });
    const inference = fakeInference((call) => call.messages.some((m) => m.role === 'tool')
      ? JSON.stringify({ tasks: ['Buy milk'] })
      : { toolCalls: [{ toolName: 'search', input: { query: 'todo' } }] });

    const agent = await inference.createAgent({
      model: 'anthropic:claude-opus-5',
      instructions: 'Find my tasks',
      tools: { search },
      output: { type: 'object', schema: z.object({ tasks: z.array(z.string()) }) },
    });
    const result = await agent.generate({ prompt: 'What do I need to do?' });

    expect(searched).toEqual(['todo']);
    expect(result.output).toEqual({ tasks: ['Buy milk'] });
    expect(inference.calls).toEqual([
      expect.objectContaining({ kind: 'text', model: 'anthropic:claude-opus-5', instructions: 'Find my tasks', tools: ['search'] }),
      expect.objectContaining({ kind: 'text', model: 'anthropic:claude-opus-5' }),
    ]);
  });

  it('streams an agent', async () => {
    const inference = fakeInference('Streamed by the agent');
    const agent = await inference.createAgent({ model: 'openai:gpt-5', instructions: 'Be brief' });
    const result = await agent.stream({ prompt: 'hi' });
    const deltas: string[] = [];
    for await (const delta of result.textStream) deltas.push(delta);
    expect(deltas.join('')).toBe('Streamed by the agent');
    expect(inference.calls).toEqual([expect.objectContaining({ kind: 'text', instructions: 'Be brief', stream: true })]);
  });

  it("runs an agent step on the model its prepareCall or prepareStep names by id", async () => {
    const inference = fakeInference('ok');
    const agent = await inference.createAgent({
      model: 'openai:gpt-5',
      prepareCall: (options) => ({ ...options, model: 'anthropic:claude-haiku-4-5' }),
    });
    await agent.generate({ prompt: 'hi' });
    await inference.generateText({ model: 'openai:gpt-5', prompt: 'hi', prepareStep: () => ({ model: 'google:gemini-flash-latest' }) });
    expect(inference.calls.map((call) => call.model)).toEqual(['anthropic:claude-haiku-4-5', 'google:gemini-flash-latest']);
  });

  it('embeds values with the scripted vectors', async () => {
    const inference = fakeInference('unused', { embedding: (value) => [value.length, 0] });
    expect((await inference.embed({ model: 'openai:text-embedding-3-small', value: 'milk' })).embedding).toEqual([4, 0]);
    expect((await inference.embedMany({ model: 'cohere:embed-v4.0', values: ['a', 'bread'] })).embeddings).toEqual([[1, 0], [5, 0]]);
    expect(inference.calls).toEqual([
      { kind: 'embedding', model: 'openai:text-embedding-3-small', values: ['milk'] },
      { kind: 'embedding', model: 'cohere:embed-v4.0', values: ['a', 'bread'] },
    ]);
  });

  it('generates images, speech and transcripts from the scripted replies, with defaults', async () => {
    const inference = fakeInference('unused', { transcript: 'Buy milk' });

    const { images } = await inference.generateImage({ model: 'openai:gpt-image-1', prompt: 'A carton of milk', n: 2, size: '1024x1024' });
    expect(images.map((image) => image.mediaType)).toEqual(['image/png', 'image/png']);
    const { audio } = await inference.generateSpeech({ model: 'mistral:voxtral-mini-tts-latest', text: 'Buy milk', voice: 'alloy', speed: 1.5 });
    expect(audio.mediaType).toBe('audio/mpeg');
    expect((await inference.transcribe({ model: 'groq:whisper-large-v3', audio: audio.uint8Array })).text).toBe('Buy milk');

    expect(inference.calls).toEqual([
      { kind: 'image', model: 'openai:gpt-image-1', prompt: 'A carton of milk', n: 2, size: '1024x1024' },
      { kind: 'speech', model: 'mistral:voxtral-mini-tts-latest', text: 'Buy milk', voice: 'alloy', speed: 1.5 },
      { kind: 'transcription', model: 'groq:whisper-large-v3', mediaType: 'audio/mpeg' },
    ]);
  });

  it('reranks documents by the scripted relevance', async () => {
    const inference = fakeInference('unused', { relevance: (query, document) => String(document).includes(query) ? 1 : 0 });
    const { rerankedDocuments } = await inference.rerank({ model: 'cohere:rerank-v3.5', query: 'milk', documents: ['bread', 'milk', 'eggs'], topN: 2 });
    expect(rerankedDocuments[0]).toBe('milk');
    expect(inference.calls).toEqual([{ kind: 'reranking', model: 'cohere:rerank-v3.5', query: 'milk', documents: ['bread', 'milk', 'eggs'], topN: 2 }]);
  });

  describe('Standard Schema support (non-Zod)', () => {
    const cityWeather = standardObjectSchema<{ city: string; celsius: number }>(
      { type: 'object', properties: { city: { type: 'string' }, celsius: { type: 'number' } }, required: ['city', 'celsius'] },
      (value) => {
        if (typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).city === 'string' && typeof (value as Record<string, unknown>).celsius === 'number') {
          return { value: value as { city: string; celsius: number } };
        }
        return { issues: [{ message: 'Expected { city: string, celsius: number }' }] };
      },
    );

    const searchInput = standardObjectSchema<{ query: string }>(
      { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      (value) => (typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).query === 'string'
        ? { value: value as { query: string } }
        : { issues: [{ message: 'Expected { query: string }' }] }),
    );

    it('accepts a non-Zod Standard Schema for object and array OutputSpec and infers its output type', async () => {
      const objectResult = await fakeInference(JSON.stringify({ city: 'Lyon', celsius: 19 }))
        .generateText({ model: 'openai:gpt-5', prompt: 'x', output: { type: 'object', schema: cityWeather } });
      expectTypeOf(objectResult.output).toEqualTypeOf<{ city: string; celsius: number }>();
      expect(objectResult.output).toEqual({ city: 'Lyon', celsius: 19 });

      const arrayResult = await fakeInference(JSON.stringify({ elements: [{ city: 'Lyon', celsius: 19 }] }))
        .generateText({ model: 'openai:gpt-5', prompt: 'x', output: { type: 'array', element: cityWeather } });
      expectTypeOf(arrayResult.output).toEqualTypeOf<Array<{ city: string; celsius: number }>>();
      expect(arrayResult.output).toEqual([{ city: 'Lyon', celsius: 19 }]);

      await expect(
        fakeInference(JSON.stringify({ city: 'Lyon', celsius: 'warm' }))
          .generateText({ model: 'openai:gpt-5', prompt: 'x', output: { type: 'object', schema: cityWeather } }),
      ).rejects.toMatchObject({
        message: expect.stringMatching(/response did not match schema/i),
        cause: expect.objectContaining({
          message: expect.stringContaining('Expected { city: string, celsius: number }'),
        }),
      });
    });

    it('streams partial output and runs tools/agents with non-Zod Standard Schemas', async () => {
      const stream = await fakeInference(JSON.stringify({ city: 'Lyon', celsius: 19 }))
        .streamText({ model: 'openai:gpt-5', prompt: 'x', output: { type: 'object', schema: cityWeather } });
      const partials: unknown[] = [];
      for await (const partial of stream.partialOutputStream) partials.push(partial);
      expect(partials.at(-1)).toEqual({ city: 'Lyon', celsius: 19 });
      const streamOutput = await stream.output;
      expectTypeOf(streamOutput).toEqualTypeOf<{ city: string; celsius: number }>();
      expect(streamOutput).toEqual({ city: 'Lyon', celsius: 19 });

      const queries: string[] = [];
      const search = tool({
        description: 'Search',
        inputSchema: searchInput,
        execute: async ({ query }) => {
          expectTypeOf(query).toEqualTypeOf<string>();
          queries.push(query);
          return ['hit'];
        },
      });
      const agent = await fakeInference((call) => call.messages.some((m) => m.role === 'tool')
        ? JSON.stringify({ city: 'Lyon', celsius: 19 })
        : { toolCalls: [{ toolName: 'search', input: { query: 'weather' } }] })
        .createAgent({
          model: 'openai:gpt-5',
          instructions: 'Check weather',
          tools: { search },
          output: { type: 'object', schema: cityWeather },
        });
      const result = await agent.generate({ prompt: 'Lyon?' });
      expectTypeOf(result.output).toEqualTypeOf<{ city: string; celsius: number }>();
      expect(queries).toEqual(['weather']);
      expect(result.output).toEqual({ city: 'Lyon', celsius: 19 });
    });

    it('fails clearly when a Standard Schema lacks JSON Schema conversion', async () => {
      const noJsonSchema = {
        '~standard': {
          version: 1 as const,
          vendor: 'validator-only',
          validate: (value: unknown) => ({ value }),
        },
      };
      await expect(
        fakeInference(JSON.stringify({ ok: true }))
          .generateText({ model: 'openai:gpt-5', prompt: 'x', output: { type: 'object', schema: noJsonSchema } }),
      ).rejects.toThrow(/does not support JSON Schema conversion/);
    });
  });

  it("is what unmocked tests don't have: the test host's inference fails naming the fix", async () => {
    startTestRuntime();
    const hostInference = boundHost().services.inference;
    await expect(hostInference.generateText({ model: 'openai:gpt-5', prompt: 'hi' })).rejects.toThrow('mock inference with mockInference(reply)');
    await expect(hostInference.streamText({ model: 'openai:gpt-5', prompt: 'hi' })).rejects.toThrow('No models in unit tests');
    await expect(hostInference.createAgent({ model: 'openai:gpt-5' })).rejects.toThrow('No models in unit tests');
    await expect(hostInference.embed({ model: 'openai:text-embedding-3-small', value: 'hi' })).rejects.toThrow('No models in unit tests');
    await expect(hostInference.rerank({ model: 'cohere:rerank-v3.5', query: 'hi', documents: ['a'] })).rejects.toThrow('No models in unit tests');
  });
});
