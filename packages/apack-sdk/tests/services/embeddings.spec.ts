// embedPending: the chunks a write leaves pending in a vector index, embedded through services.inference with the
// model the index names, and found by near; a change to a field the index reads leaves the entity pending again.
import { describe, expect, it } from 'vitest';
import { boundEars } from '../../src/ears/index.ts';
import { embedPending, embedSearchText } from '../../src/services/index.ts';
import { fakeInference, startTestRuntime } from '../../src/testing/index.ts';

/** Each text's meaning, as an axis of three */
const meaning = (text: string) => (text.includes('apple') ? [1, 0, 0] : text.includes('boat') ? [0, 1, 0] : [0, 0, 1]);
/** What a test does as each value is embedded, while the model call is in flight */
let whileEmbedding: (() => void) | undefined;
const inference = fakeInference('', {
  embedding: (text) => {
    whileEmbedding?.();
    return meaning(text);
  },
});

startTestRuntime({
  entityTypes: ['Card', 'Other'],
  rowRules: {
    Card: { required: [], embed: { from: ['text'], chunk: 'paragraph', model: 'openai:text-embedding-3-small', dims: 3 } },
    Other: { required: [], embed: { from: ['text'], model: 'cohere:embed-english-v3.0', dims: 3 } },
  },
  serviceOverrides: new Map([['inference', inference]]),
});

describe('embedPending', () => {
  it('embeds what a write left pending with the index\'s model, then near finds it, until its text changes', async () => {
    const ears = boundEars();
    const card = ears.create('Card', { text: 'an apple\n\na boat' }).id();
    const other = ears.create('Other', { text: 'stars' }).id();
    expect(ears.query('Card').near([1, 0, 0]).ids()).toEqual([]);

    expect(await embedPending()).toEqual({ stored: 3, stale: 0 });
    expect(inference.calls.filter((call) => call.kind === 'embedding')).toEqual([
      { kind: 'embedding', model: 'openai:text-embedding-3-small', values: ['an apple', 'a boat'] },
      { kind: 'embedding', model: 'cohere:embed-english-v3.0', values: ['stars'] },
    ]);
    expect(ears.query('Card').near([0, 1, 0]).ids()).toEqual([card]);
    expect(ears.query('Other').near([0, 0, 1]).ids()).toEqual([other]);

    ears.write(card).set('text', 'stars\n\na boat');
    // The paragraph that changed is pending; the one that didn't keeps its embedding
    expect(ears.pendingEmbeddings('Card').chunks.map(({ chunk, text }) => [chunk, text])).toEqual([[0, 'stars']]);
    expect(await embedPending({ types: ['Card'] })).toEqual({ stored: 1, stale: 0 });
    expect(ears.query('Card').near([0, 0, 1], { k: 1 }).ids()).toEqual([card]);
    expect(await embedPending()).toEqual({ stored: 0, stale: 0 });
  });

  it('embeds a search\'s text with the model the type\'s vector index names', async () => {
    expect(await embedSearchText('Other', 'a boat')).toEqual([0, 1, 0]);
    expect(inference.calls.at(-1)).toEqual({ kind: 'embedding', model: 'cohere:embed-english-v3.0', values: ['a boat'] });
  });

  it('embeds again a chunk whose text changed while its batch was being embedded', async () => {
    const ears = boundEars();
    const card = ears.create('Card', { text: 'an apple' }).id();
    whileEmbedding = () => {
      whileEmbedding = undefined;
      ears.write(card).set('text', 'a boat');
    };
    expect(await embedPending({ types: ['Card'] })).toEqual({ stored: 1, stale: 1 });
    // Its embedding is the boat's, made from its new text
    expect(ears.query.ids([card]).near([0, 1, 0]).hits()[0]!.score).toBeCloseTo(1, 5);
  });
});
