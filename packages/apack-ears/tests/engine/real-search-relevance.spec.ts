// Frozen real content and usefulness judgments, independent of backend scores and SQL plans.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { EarsEngine, SearchOptions } from '../../src/index.ts';
import { freshEngine } from './engine-under-test.ts';

interface RealSearchCase {
  name: string;
  query: string;
  options: SearchOptions;
  relevant: string[];
  topK: number;
  highlight?: { field: string; text: string };
}
const corpus: {
  documents: Array<{ id: `Document-${string}`; name: string; body: string; source: string; section: string }>;
  cases: RealSearchCase[];
} = JSON.parse(readFileSync(new URL('../fixtures/real-search-relevance.json', import.meta.url), 'utf8'));
let e: EarsEngine;
beforeAll(() => {
  e = freshEngine({ types: ['Document'], relationKinds: [], roles: [], rowRules: {
    Document: { required: [], search: { fields: { name: 3, body: 1 } } },
  } });
  e.transact(() => { for (const document of corpus.documents) e.create('Document', document); });
});

describe('real repository-content search relevance', () => {
  it.each(corpus.cases)('$name', test => {
    const query = e.query('Document').search(test.query, test.options).limit(test.topK);
    const ids = query.ids();
    expect(ids.some(id => test.relevant.includes(id)), `${test.query}: ${JSON.stringify(ids)}`).toBe(true);
    if (test.highlight) {
      const wanted = test.highlight;
      const hit = query.hits({ highlights: true }).find(hit => test.relevant.includes(hit.id));
      expect(hit).toBeDefined();
      const document = corpus.documents.find(document => document.id === hit!.id)!;
      const source = wanted.field === 'body' ? document.body : document.name;
      const ranges = hit!.highlights?.[wanted.field] ?? [];
      expect(ranges.length).toBeGreaterThan(0);
      const highlighted = ranges.map(([element, start, end]) => {
        expect(element).toBe(0);
        expect(Number.isInteger(start) && Number.isInteger(end) && start! >= 0 && end! > start! && end! <= source.length).toBe(true);
        return source.slice(start, end);
      });
      expect(highlighted.join(' ').toLowerCase()).toContain(wanted.text.toLowerCase());
    }
  });
});
