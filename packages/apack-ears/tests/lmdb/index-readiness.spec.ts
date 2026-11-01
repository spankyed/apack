import { afterEach, expect, it, vi } from 'vitest';
import { adaptDatabase, type BinaryDatabase } from '../../src/lmdb/adapter.ts';

type FixtureSchema = { types: Record<string, { indexes: Record<string, object> }> };

function fixture() {
  const source = {
    isOpen: true, readOnly: false,
    schema: { types: { Task: { indexes: { rank: {} } }, Other: { indexes: { name: {} } } } } as FixtureSchema,
    indexStatus: vi.fn(() => [
      { type: 'Task', index: 'rank', built: false, failure: null as string | null },
      { type: 'Other', index: 'name', built: false, failure: null as string | null },
    ]),
    setSchema: vi.fn((schema: object) => { source.schema = schema as FixtureSchema; return []; }),
    reset: vi.fn(), replaceWith: vi.fn(),
    close: vi.fn(() => { source.isOpen = false; }),
    begin: vi.fn(() => ({ isOpen: true, abort() { this.isOpen = false; } })),
  };
  return { source, db: adaptDatabase(source as unknown as BinaryDatabase) };
}
afterEach(() => { vi.useRealTimers(); });

it('waits for the native builder without blocking foreground turns and releases its timer', async () => {
  vi.useFakeTimers();
  const { source, db } = fixture();
  let completed = false;
  const ready = db.indexesReady().then(() => { completed = true; });
  await Promise.resolve(); expect(completed).toBe(false);
  expect(source.indexStatus).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(1);
  source.indexStatus.mockReturnValue(source.indexStatus().map(index => ({ ...index, built: true })));
  await vi.advanceTimersByTimeAsync(10); await ready;
  expect(completed).toBe(true); expect(vi.getTimerCount()).toBe(0);
});

it('scopes readiness and failures to the requested type', async () => {
  const { source, db } = fixture();
  source.indexStatus.mockReturnValue([
    { type: 'Task', index: 'rank', built: true, failure: null },
    { type: 'Other', index: 'name', built: false, failure: 'duplicate values' },
  ]);
  await expect(db.indexesReady(['Task'])).resolves.toBeUndefined();
  await expect(db.indexesReady()).rejects.toMatchObject({ code: 'INDEX_FAILED', message: 'duplicate values' });
});

it('rejects superseded scoped declarations even if changed back before the timer runs', async () => {
  vi.useFakeTimers();
  const { source, db } = fixture(), original = source.schema;
  const ready = db.indexesReady(['Task']);
  const rejected = expect(ready).rejects.toMatchObject({ code: 'CANCELLED' });
  db.setSchema({ types: { Other: original.types.Other } });
  db.setSchema(original);
  await rejected; expect(vi.getTimerCount()).toBe(0);
});

it('keeps a scoped wait through an unrelated type declaration', async () => {
  vi.useFakeTimers();
  const { source, db } = fixture();
  const ready = db.indexesReady(['Task']);
  db.setSchema({ types: { Task: source.schema.types.Task, Other: { indexes: { changed: {} } } } });
  source.indexStatus.mockReturnValue([{ type: 'Task', index: 'rank', built: true, failure: null }]);
  await vi.advanceTimersByTimeAsync(10); await ready;
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['reset', 'replaceWith', 'close'] as const)('settles pending waits when %s changes ownership', async operation => {
  vi.useFakeTimers();
  const { db } = fixture();
  const rejected = expect(db.indexesReady(['Task'])).rejects.toMatchObject({ code: operation === 'close' ? 'CLOSED' : 'CANCELLED' });
  if (operation === 'replaceWith') db.replaceWith('owned-test-source'); else db[operation]();
  await rejected; expect(vi.getTimerCount()).toBe(0);
});

it('refuses open units, closed handles and unfinished read-only builds', async () => {
  const { source, db } = fixture();
  const unit = db.begin();
  await expect(db.indexesReady()).rejects.toMatchObject({ code: 'UNIT_OPEN' });
  unit.abort(); source.readOnly = true;
  await expect(db.indexesReady()).rejects.toMatchObject({ code: 'INDEX_BUILDING' });
  db.close(); await expect(db.indexesReady()).rejects.toMatchObject({ code: 'CLOSED' });
});
