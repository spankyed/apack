import { describe, expect, it } from 'vitest';
import { parseContentIndex } from '../src/content-index.ts';

const entry = { key: 'memos', written: true, count: 1, items: [{ key: 'memo-one', description: 'A compiled memo', childCount: 2 }] };
const index = { version: 1, packId: 'fixture-pack', entries: [entry] };

describe('compiled content index data', () => {
  it('preserves compiled identities, descriptions and counts without registered providers', () => {
    expect(parseContentIndex(index)).toEqual(index);
  });
  it.each([
    [{ ...index, entries: undefined }, 'entries'],
    [{ ...index, packId: undefined }, 'packId'],
    [{ ...index, entries: [{ ...entry, count: -1 }] }, 'count'],
    [{ ...index, entries: [{ ...entry, items: {} }] }, 'items'],
    [{ ...index, entries: [entry, entry] }, 'declared twice'],
  ])('refuses malformed or ambiguous inventory: %j', (raw, message) => {
    expect(() => parseContentIndex(raw)).toThrow(message);
  });
});
