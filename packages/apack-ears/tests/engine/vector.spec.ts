// Vector search through the builder: a type's `embed` declaration as elmdb's vector index, chunks pending until
// `embed` stores their vectors, `near`, `like` and `hybrid` ranked and combined with the steps around them. How elmdb
// chunks, files and ranks is its own specs' (elmdb/crates/elmdb/src/engine/vector/tests.rs); these hold the builder
// and the engine's members to sending what they mean.
import { describe, expect, it } from 'vitest';
import { EarsError, type EarsEngine } from '../../src/index.ts';
import { freshEngine } from './engine-under-test.ts';

const engine = () => freshEngine({
  types: ['Note', 'Plain'],
  relationKinds: ['in'],
  roles: [],
  rowRules: {
    Note: { required: [], search: { fields: { title: 1 } }, embed: { from: ['title', 'body'], model: 'openai:test-embedding', dims: 3 } },
  },
});

/** A fixed corpus's vectors: each text's meaning, as an axis of three */
const MEANINGS: Record<string, readonly number[]> = {
  apples: [1, 0, 0],
  pears: [0.9, 0.1, 0],
  boats: [0, 1, 0],
  ships: [0.1, 0.9, 0],
  stars: [0, 0, 1],
};
const vectorOf = (text: string) => MEANINGS[text.split('\n\n').at(-1)!] ?? [1, 1, 1];

/** Embeds every pending chunk of Note with its corpus vector */
function embedAll(e: EarsEngine) {
  const { model, chunks } = e.pendingEmbeddings('Note');
  return e.embed(chunks.map((chunk) => ({ ...chunk, model, vector: vectorOf(chunk.text) })));
}

describe('vector search', () => {
  it.each([
    ['zero', [0, 0, 0]], ['negative zero', [-0, 0, -0]],
    ['Float32 underflow to zero', [Number.MIN_VALUE, -Number.MIN_VALUE, 0]],
    ['positive Float32 overflow', [Number.MAX_VALUE, 0, 0]],
    ['negative Float32 overflow', [-Number.MAX_VALUE, 0, 0]],
    ['NaN', [NaN, 0, 0]], ['infinity', [Infinity, 0, 0]], ['wrong dimensions', [1, 0]],
  ] as const)('refuses %s cosine embeddings and queries without changing pending work', (_name, vector) => {
    const e = engine(); e.create('Note', { title: 'pending' });
    const { model, chunks } = e.pendingEmbeddings('Note'), before = e.lastCommit();
    expect(() => e.embed(chunks.map(chunk => ({ ...chunk, model, vector })))).toThrow(expect.objectContaining({ code: 'VALUE_INVALID' }));
    expect(e.pendingEmbeddings('Note').count).toBe(1); expect(e.lastCommit()).toBe(before);
    expect(() => e.query('Note').near(vector).ids()).toThrow(expect.objectContaining({ code: 'VALUE_INVALID' }));
    expect(embedAll(e)).toEqual({ stored: 1, stale: 0 });
    expect(() => e.query('Note').near(vector).ids()).toThrow(expect.objectContaining({ code: 'VALUE_INVALID' }));
  });

  it('refuses another model or invalid vector before answering an obsolete chunk stale', () => {
    const e = engine(), id = e.create('Note', { title: 'before' }).id();
    const { model, chunks: [chunk] } = e.pendingEmbeddings('Note');
    e.write(id).set('title', 'after'); const before = e.lastCommit();
    expect(() => e.embed([{ ...chunk!, model: 'another:model', vector: [1, 0, 0] }])).toThrow(expect.objectContaining({ code: 'VALUE_INVALID' }));
    expect(() => e.embed([{ ...chunk!, model, vector: [0, 0, 0] }])).toThrow(expect.objectContaining({ code: 'VALUE_INVALID' }));
    expect(e.lastCommit()).toBe(before); expect(e.pendingEmbeddings('Note').count).toBe(1);
    expect(e.embed([{ ...chunk!, model, vector: [1, 0, 0] }])).toEqual({ stored: 0, stale: 1 });
  });

  it('rolls back the whole embedding batch and publishes no watch result on invalid input', async () => {
    const e = engine(); e.create('Note', { title: 'one' }); e.create('Note', { title: 'two' });
    const { model, chunks } = e.pendingEmbeddings('Note'), before = e.lastCommit();
    const seen: number[] = [], watching = e.watch(() => e.query('Note').near([1, 0, 0]).count(), count => seen.push(count));
    try {
      await e.admin.watchesSettled(); expect(seen).toEqual([0]);
      expect(() => e.embed(chunks.map((chunk, i) => ({ ...chunk, model, vector: i ? [0, 0, 0] : [1, 0, 0] }))))
        .toThrow(expect.objectContaining({ code: 'VALUE_INVALID' }));
      await e.admin.watchesSettled(); expect(seen).toEqual([0]); expect(e.lastCommit()).toBe(before);
      expect(e.pendingEmbeddings('Note').count).toBe(2);
      expect(e.embed(chunks.map(chunk => ({ ...chunk, model, vector: [1, 0, 0] })))).toEqual({ stored: 2, stale: 0 });
      await e.admin.watchesSettled(); expect(seen).toEqual([0, 2]);
    } finally { watching.stop(); }
  });

  it('holds a written entity pending until its vectors are stored, and again when its text changes', () => {
    const e = engine();
    const a = e.create('Note', { title: 'fruit', body: 'apples' }).id();
    const pending = e.pendingEmbeddings('Note');
    expect(pending).toEqual({ model: 'openai:test-embedding', dims: 3, count: 1, chunks: [{ id: a, chunk: 0, hash: expect.any(String), text: 'fruit\n\napples' }] });
    expect(e.query('Note').near([1, 0, 0]).ids()).toEqual([]);

    expect(embedAll(e)).toEqual({ stored: 1, stale: 0 });
    expect(e.pendingEmbeddings('Note').count).toBe(0);
    expect(e.query('Note').near([1, 0, 0]).ids()).toEqual([a]);

    e.write(a).set('body', 'boats');
    expect(e.pendingEmbeddings('Note').chunks.map(({ text }) => text)).toEqual(['fruit\n\nboats']);
    expect(e.query('Note').near([1, 0, 0]).ids()).toEqual([]);
    // A field the index doesn't read changes nothing
    embedAll(e);
    e.write(a).set('color', 'red');
    expect(e.pendingEmbeddings('Note').count).toBe(0);
  });

  it('refuses a vector whose chunk changed since it was pending, leaving the chunk pending under its new text', () => {
    const e = engine();
    const a = e.create('Note', { title: 'x', body: 'apples' }).id();
    const { model, chunks } = e.pendingEmbeddings('Note');
    e.write(a).set('body', 'pears');
    expect(e.embed(chunks.map((chunk) => ({ ...chunk, model, vector: [1, 0, 0] })))).toEqual({ stored: 0, stale: 1 });
    expect(e.pendingEmbeddings('Note').chunks.map(({ text }) => text)).toEqual(['x\n\npears']);
  });

  it('counts a vector for an entity deleted since it was pending as stale, and stores the rest of the batch', () => {
    const e = engine();
    const gone = e.create('Note', { title: 'x', body: 'pears' }).id();
    e.create('Note', { title: 'y', body: 'boats' });
    const { model, chunks } = e.pendingEmbeddings('Note');
    e.write(gone).destroy();
    expect(e.embed(chunks.map((chunk) => ({ ...chunk, model, vector: vectorOf(chunk.text) })))).toEqual({ stored: 1, stale: 1 });
    expect(e.pendingEmbeddings('Note').count).toBe(0);
  });

  it('ranks the nearest first, combines with the steps before it, and finds more like an entity', () => {
    const e = engine();
    const [apples, pears, boats, ships] = ['apples', 'pears', 'boats', 'ships'].map((body) => e.create('Note', { title: 'a note', body }).id());
    embedAll(e);
    expect(e.query('Note').near([1, 0, 0], { k: 2 }).ids()).toEqual([apples, pears]);
    expect(e.query('Note').near([0, 1, 0]).limit(1).ids()).toEqual([boats]);
    expect(e.query.ids([pears!, ships!]).near([1, 0, 0]).ids()).toEqual([pears, ships]);
    expect(e.query('Note').like(boats!, { k: 1 }).ids()).toEqual([ships]);
    const [hit] = e.query('Note').near([1, 0, 0], { k: 1 }).hits();
    expect(hit).toEqual({ id: apples, score: expect.any(Number), terms: [] });
    expect(hit!.score).toBeCloseTo(1, 5);
  });

  it('searches global and filtered vector sets containing unindexed types', () => {
    const e = engine();
    const found = e.create('Note', { title: 'needle', body: 'apples', category: 'selected' }).id();
    e.create('Plain', { title: 'needle', category: 'selected' });
    embedAll(e);
    expect(e.query.all().near([1, 0, 0]).ids()).toEqual([found]);
    expect(e.query(['Note', 'Plain']).where('category', 'selected').near([1, 0, 0]).ids()).toEqual([found]);
    expect(e.query.all().hybrid('needle', [1, 0, 0], { fuzzy: false }).ids()).toEqual([found]);
    expect(e.query('Plain').where('category', 'selected').near([1, 0, 0]).ids()).toEqual([]);
    expect(() => e.query('Plain').near([1, 0, 0]).ids()).toThrow(expect.objectContaining({ code: 'UNKNOWN_INDEX' }));
  });

  it('fuses independently indexed types in a global hybrid search', () => {
    const e = freshEngine({ types: ['Text', 'Vector', 'Plain'], relationKinds: [], roles: [], rowRules: {
      Text: { required: [], search: { fields: { title: 1 } } },
      Vector: { required: [], embed: { from: ['title'], model: 'fixture:scope', dims: 3, chunk: 'whole' } },
    } });
    const text = e.create('Text', { title: 'needle' }).id();
    const vector = e.create('Vector', { title: 'semantic match' }).id();
    e.create('Plain', { title: 'needle' });
    const pending = e.pendingEmbeddings('Vector');
    expect(e.embed(pending.chunks.map(chunk => ({ ...chunk, model: pending.model, vector: [1, 0, 0] }))))
      .toEqual({ stored: 1, stale: 0 });
    const hits = e.query.all().hybrid('needle', [1, 0, 0], { fuzzy: false }).hits();
    expect(hits.map(hit => hit.id).sort()).toEqual([text, vector].sort());
    for (const hit of hits) expect(hit.score).toBeCloseTo(1 / 61, 8);
  });

  it('resolves a like reference before an empty candidate set or unindexed candidate type', () => {
    const e = engine();
    const plain = e.create('Plain', { title: 'no reference index' }).id();
    const pending = e.create('Note', { title: 'pending reference' }).id();
    expect(() => e.query.ids([]).like(plain).ids()).toThrow(expect.objectContaining({ code: 'UNKNOWN_INDEX' }));
    expect(() => e.query('Note').where('title', 'absent').like(plain).ids())
      .toThrow(expect.objectContaining({ code: 'UNKNOWN_INDEX' }));
    expect(e.query('Plain').like(pending).ids()).toEqual([]);
    expect(e.query.ids([]).like(pending).ids()).toEqual([]);
    embedAll(e);
    expect(e.query.ids([]).like(pending).ids()).toEqual([]);
    expect(() => e.query('Plain').like(pending).ids()).toThrow(expect.objectContaining({ code: 'UNKNOWN_INDEX' }));
  });

  it('preserves native owner scopes through filters, earlier limits, graph traversal and like', () => {
    const e = engine(), root = e.create('Plain', { title: 'root' }).id();
    const [a, b, c, reference] = [
      { title: 'a', body: 'boats', category: 'selected' },
      { title: 'b', body: 'ships', category: 'selected' },
      { title: 'c', body: 'apples', category: 'selected' },
      { title: 'reference', body: 'apples', category: 'reference' },
    ].map(row => e.create('Note', row).id());
    for (const id of [a!, b!, c!]) e.write(root).link('in', id);
    embedAll(e);
    expect(e.query('Note').where('category', 'selected').limit(2).near([1, 0, 0], { k: 1 }).ids()).toEqual([b]);
    expect(e.query('Note').where('category', 'selected').near([1, 0, 0], { k: 1 }).ids()).toEqual([c]);
    expect(e.query.ids(root).out('in', 'Note').where('category', 'selected').limit(2).like(reference!, { k: 1 }).ids()).toEqual([b]);
    expect(e.query.ids(root).descendants('in').where('category', 'selected').limit(2).near([1, 0, 0], { k: 1 }).ids()).toEqual([b]);
  });

  it('ranks own embeddings in a unit and restores them across nested and outer rollback', () => {
    const e = engine();
    const first = e.create('Note', { title: 'first', body: 'apples' }).id();
    const second = e.create('Note', { title: 'second', body: 'boats' }).id();
    const { model, chunks } = e.pendingEmbeddings('Note');
    const firstChunk = chunks.find(chunk => chunk.id === first)!;
    const secondChunk = chunks.find(chunk => chunk.id === second)!;
    e.embed(chunks.map(chunk => ({ ...chunk, model, vector: chunk.id === first ? [1, 0, 0] : [0, 1, 0] })));
    const nearest = () => e.query('Note').near([1, 0, 0], { k: 1 }).ids();
    const before = e.lastCommit();
    expect(nearest()).toEqual([first]);
    const outerRollback = new Error('rollback outer embeddings');
    const nestedRollback = new Error('rollback nested embeddings');
    try { e.transact(() => {
      e.embed([{ ...firstChunk, model, vector: [0, 0, 1] }, { ...secondChunk, model, vector: [1, 0, 0] }]);
      expect(nearest(), 'outer unit sees its embedding replacement').toEqual([second]);
      try { e.transact(() => {
        e.embed([{ ...firstChunk, model, vector: [1, 0, 0] }, { ...secondChunk, model, vector: [0, 1, 0] }]);
        expect(nearest(), 'nested unit sees its embedding replacement').toEqual([first]);
        throw nestedRollback;
      }); } catch (error) {
        if (error !== nestedRollback) throw error;
      }
      expect(nearest(), 'nested rollback restores outer embeddings').toEqual([second]);
      e.write(second).trash();
      expect(nearest(), 'unit read excludes its trashed owner').toEqual([first]);
      throw outerRollback;
    }); } catch (error) {
      if (error !== outerRollback) throw error;
    }
    expect(nearest()).toEqual([first]);
    expect(e.lastCommit()).toBe(before);
    expect(e.query('Note').ids()).toEqual([first, second]);
  });

  it('merges the text and vector rankings on a fixed corpus: what both find ranks above what one finds first', () => {
    const e = engine();
    const [ships, pears, stars, boats] = [['stars', 'ships'], ['stars', 'pears'], ['stars', 'stars'], ['boats', 'boats']]
      .map(([title, body]) => e.create('Note', { title, body }).id());
    embedAll(e);
    // Every note is in the vector ranking, the boat's first; the text ranking holds the three titled "stars"
    expect(e.query('Note').near([0, 1, 0]).ids()).toEqual([boats, ships, pears, stars]);
    expect(new Set(e.query('Note').search('stars').ids())).toEqual(new Set([ships, pears, stars]));
    const merged = e.query('Note').hybrid('stars', [0, 1, 0], { k: 4 }).ids();
    expect(merged).toHaveLength(4);
    expect(new Set(merged.slice(0, 3))).toEqual(new Set([ships, pears, stars]));
    expect(merged[3]).toBe(boats);
    expect(e.query('Note').hybrid('stars', [0, 1, 0], { k: 3 }).ids()).not.toContain(boats);
  });

  it('fuses the global vector window rather than every eligible owner', () => {
    const e = engine();
    e.transact(() => { for (let i = 0; i < 60; i++)
      e.create('Note', { id: `Note-${i}`, title: i === 59 ? 'needle' : 'other', body: 'fixture' });
    });
    const pending = e.pendingEmbeddings('Note', { limit: 64 });
    expect(pending.chunks).toHaveLength(60);
    expect(e.embed(pending.chunks.map(chunk => ({ ...chunk, model: pending.model,
      vector: [1, Number(chunk.id.slice(5)) / 60, 0] }))).stored).toBe(60);
    expect(e.query('Note').near([1, 0, 0], { k: 60 }).ids().at(-1)).toBe('Note-59');
    const hit = e.query('Note').hybrid('needle', [1, 0, 0], { k: 1, fuzzy: false }).hits()[0];
    expect(hit?.id).toBe('Note-59');
    expect(hit?.score).toBeCloseTo(1 / 61, 12);
  });

  it('retains lexical source highlights when hybrid fusion also finds the vector', () => {
    const e = engine();
    const id = e.create('Note', { title: 'stars', body: 'stars' }).id(); embedAll(e);
    const hit = e.query('Note').hybrid('stars', [0, 0, 1], { k: 1 }).hits({ highlights: true })[0];
    expect(hit?.id).toBe(id);
    expect(hit?.highlights?.title).toEqual([[0, 0, 5]]);
  });

  it('applies vector k and hybrid reciprocal ranks across types globally', () => {
    const definition = { required: [], search: { fields: { title: 1 } },
      embed: { from: ['title'], model: 'fixture', dims: 3 } };
    const e = freshEngine({ types: ['First', 'Second'], relationKinds: [], roles: [],
      rowRules: { First: definition, Second: definition } });
    e.create('First', { id: 'First-one', title: 'needle' });
    e.create('Second', { id: 'Second-one', title: 'needle' });
    for (const type of ['First', 'Second']) {
      const pending = e.pendingEmbeddings(type);
      e.embed(pending.chunks.map(chunk => ({ ...chunk, model: pending.model,
        vector: type === 'First' ? [0, 1, 0] : [1, 0, 0] })));
    }
    expect(e.query(['First', 'Second']).near([1, 0, 0], { k: 1 }).ids()).toEqual(['Second-one']);
    expect(e.query('First').like('Second-one', { k: 1 }).ids()).toEqual(['First-one']);
    const text = e.query(['First', 'Second']).search('needle', { fuzzy: false }).ids();
    const vector = e.query(['First', 'Second']).near([1, 0, 0], { k: 2 }).ids();
    const ranks = new Map<string, number>();
    for (const list of [text, vector]) list.forEach((id, rank) => ranks.set(id, (ranks.get(id) ?? 0) + 1 / (61 + rank)));
    const hits = e.query(['First', 'Second']).hybrid('needle', [1, 0, 0], { k: 2, fuzzy: false }).hits();
    expect(hits).toHaveLength(2);
    for (const hit of hits) expect(hit.score).toBeCloseTo(ranks.get(hit.id)!, 12);
    expect(e.query(['First', 'Second']).hybrid('needle', [1, 0, 0], { k: 1 }).ids()).toHaveLength(1);
  });

  it('updates a like watch when a reference in another type is re-embedded', async () => {
    const definition = { required: [], embed: { from: ['title'], model: 'fixture', dims: 3 } };
    const e = freshEngine({ types: ['First', 'Second'], relationKinds: [], roles: [],
      rowRules: { First: definition, Second: definition } });
    for (const id of ['First-east', 'First-north', 'Second-reference'] as const)
      e.create(id.startsWith('First') ? 'First' : 'Second', { id, title: id });
    for (const type of ['First', 'Second']) {
      const pending = e.pendingEmbeddings(type);
      e.embed(pending.chunks.map(chunk => ({ ...chunk, model: pending.model,
        vector: chunk.id === 'First-north' ? [0, 1, 0] : [1, 0, 0] })));
    }
    const seen: Array<string | undefined> = [];
    const watch = e.watch(() => e.query('First').like('Second-reference', { k: 1 }).first(), id => seen.push(id));
    try {
      await e.admin.watchesSettled(); expect(seen).toEqual(['First-east']);
      e.write('Second-reference').set('title', 'updated reference');
      await e.admin.watchesSettled(); expect(seen.at(-1)).toBeUndefined();
      const pending = e.pendingEmbeddings('Second');
      e.embed(pending.chunks.map(chunk => ({ ...chunk, model: pending.model, vector: [0, 1, 0] })));
      await e.admin.watchesSettled(); expect(seen.at(-1)).toBe('First-north');
    } finally { watch.stop(); }
  });

  it('refuses the vector steps on a type with no vector index, and names the types holding one', () => {
    const e = engine();
    expect(e.embeddedTypes()).toEqual(['Note']);
    expect(() => e.query('Plain').near([1, 0, 0]).ids()).toThrow(expect.objectContaining({ code: 'UNKNOWN_INDEX' }));
    expect(() => e.pendingEmbeddings('Plain')).toThrow(EarsError);
    expect(() => e.query('Note').limit(2).hits()).toThrow(expect.objectContaining({ code: 'NO_SEARCH' }));
  });
});
