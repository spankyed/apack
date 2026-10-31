import { expect, it } from 'vitest';
import { classifySourceFiles } from '../../src/performance/identity.ts';

it('separates execution-owner bookkeeping from authored source without hiding edits or other new files', () => {
  const records = ['.apack-run.lock'];
  expect(classifySourceFiles(Buffer.alloc(0), records, records)).toEqual({ dirty: false, authoredUntracked: [], excludedUntracked: records });
  expect(classifySourceFiles(Buffer.alloc(0), [...records, 'src/new.ts'], records)).toMatchObject({ dirty: true, authoredUntracked: ['src/new.ts'] });
  expect(classifySourceFiles(Buffer.from('tracked edit'), records, records).dirty).toBe(true);
  expect(classifySourceFiles(Buffer.alloc(0), records, []).dirty).toBe(true);
});

it('samples renderer identity without retaining its main-process handle', async () => {
  const { rendererProcessId } = await import('../../src/performance/identity.ts');
  const handle = { evaluate: async () => 42, dispose: async () => { disposed++; } };
  let disposed = 0;
  const application = { browserWindow: async () => handle } as unknown as Parameters<typeof rendererProcessId>[0];
  const page = {} as Parameters<typeof rendererProcessId>[1];
  expect(await rendererProcessId(application, page)).toBe(42);
  expect(disposed).toBe(1);
  handle.evaluate = async () => 0;
  await expect(rendererProcessId(application, page)).rejects.toThrow('unavailable');
  expect(disposed).toBe(2);
});

it('retains the captured result and explicit loss if renderer identity fails', async () => {
  const { attachRendererProcessIdentity } = await import('../../src/performance/identity.ts');
  const application = { browserWindow: async () => { throw Error('target closed'); } } as unknown as Parameters<typeof attachRendererProcessIdentity>[0];
  const page = {} as Parameters<typeof attachRendererProcessIdentity>[1];
  const report = { complete: true, rendererResourceFailures: 2, observations: ['retained'] };
  await attachRendererProcessIdentity(application, page, report);
  expect(report).toEqual({ complete: false, rendererResourceFailures: 3, observations: ['retained'] });
});
