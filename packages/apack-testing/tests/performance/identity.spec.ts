import { expect, it } from 'vitest';
import { classifySourceFiles } from '../../src/performance/identity.ts';

it('separates execution-owner bookkeeping from authored source without hiding edits or other new files', () => {
  const records = ['.apack-run.lock'];
  expect(classifySourceFiles(Buffer.alloc(0), records, records)).toEqual({ dirty: false, authoredUntracked: [], excludedUntracked: records });
  expect(classifySourceFiles(Buffer.alloc(0), [...records, 'src/new.ts'], records)).toMatchObject({ dirty: true, authoredUntracked: ['src/new.ts'] });
  expect(classifySourceFiles(Buffer.from('tracked edit'), records, records).dirty).toBe(true);
  expect(classifySourceFiles(Buffer.alloc(0), records, []).dirty).toBe(true);
});
