// Literal Unicode retrieval and UTF-16 source spans; this does not assert language-specific stemming.
import { beforeAll, describe, expect, it } from 'vitest';
import type { EarsEngine } from '../../src/index.ts';
import { freshEngine } from './engine-under-test.ts';

const cases = [
  { name: 'Spanish', text: 'Recuperación de documentos', query: 'Recuperación' },
  { name: 'German', text: 'Wiederherstellung gespeicherter Daten', query: 'Wiederherstellung' },
  { name: 'Greek', text: 'Επαναφορά βάσης δεδομένων', query: 'βάσης' },
  { name: 'Cyrillic', text: 'Восстановление базы данных', query: 'базы' },
  { name: 'Arabic', text: 'استعادة قاعدة البيانات', query: 'قاعدة' },
  { name: 'Chinese', text: '数据库恢复', query: '数据库恢复' },
  { name: 'Japanese', text: 'データベース復元', query: 'データベース復元' },
  { name: 'Korean', text: '데이터베이스 복원', query: '데이터베이스' },
];
let e: EarsEngine;
beforeAll(() => {
  e = freshEngine({ types: ['Document'], relationKinds: [], roles: [], rowRules: {
    Document: { required: [], search: { fields: { body: 1 } } },
  } });
  e.transact(() => cases.forEach((test, i) => {
    e.create('Document', { id: `Document-${i}`, body: `😀 ${test.text}` });
  }));
});
describe('literal multilingual search', () => {
  it.each(cases)('finds $name with source-correct highlights after an astral character', test => {
    const id = `Document-${cases.indexOf(test)}`, source = `😀 ${test.text}`;
    const hits = e.query('Document').search(test.query, { fuzzy: false }).hits({ highlights: true });
    expect(hits.map(hit => hit.id)).toEqual([id]);
    const ranges = hits[0]!.highlights?.body ?? [];
    expect(ranges.length).toBeGreaterThan(0);
    const marked = ranges.map(([element, start, end]) => {
      expect(element).toBe(0);
      expect(Number.isInteger(start) && Number.isInteger(end) && start! >= 3 && end! > start! && end! <= source.length).toBe(true);
      return source.slice(start, end);
    });
    expect(marked).toContain(test.query);
  });
});
