// Shared useful-result expectations; backend-specific scores and complete ranking equality are not required.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { EarsEngine, SearchOptions } from '../../src/index.ts';
import { freshEngine } from './engine-under-test.ts';

interface RelevanceCase {
  name: string; type: string; query: string; options: SearchOptions;
  required: string[]; forbidden: string[]; first?: string;
  highlights?: { id: string; field: string; ranges: number[][] };
}
const fixture: { documents: Array<{ id: string; name: string; body: unknown; tags: unknown[]; at?: number }>; cases: RelevanceCase[] } =
  JSON.parse(readFileSync(new URL('../fixtures/search-relevance.json', import.meta.url), 'utf8'));
let e: EarsEngine;
beforeAll(() => {
  e = freshEngine({ types: ['Document', 'English'], relationKinds: [], roles: [], rowRules: {
    Document: { required: [], search: { fields: { name: 3, body: 1, tags: 1 } } },
    English: { required: [], search: { fields: { body: 1 }, stem: 'en' } },
  } });
  e.transact(() => {
    for (const row of fixture.documents) e.create('Document', row);
    e.create('English', { id: 'English-run', body: 'The job runs nightly.' });
  });
});
describe('repository-domain search relevance', () => {
  it.each(fixture.cases)('$name', test => {
    const query = e.query(test.type).search(test.query, test.options), ids = query.ids();
    for (const id of test.required) expect(ids, test.name).toContain(id);
    for (const id of test.forbidden) expect(ids, test.name).not.toContain(id);
    if (test.first) expect(ids[0], test.name).toBe(test.first);
    if (test.highlights) {
      const { id, field, ranges } = test.highlights;
      expect(query.hits({ highlights: true }).find(hit => hit.id === id)?.highlights?.[field]).toEqual(ranges);
    }
  });
});
