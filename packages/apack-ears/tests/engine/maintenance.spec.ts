import { describe, expect, it } from 'vitest';
import { createEarsEngine } from '../../src/index.ts';
import { openTestDatabase } from './engine-under-test.ts';

const schema = { types: { Row: { required: [] } }, relations: {}, roles: [] };
function held() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
function fixture() {
  const database = openTestDatabase(schema);
  return { database, engine: createEarsEngine({ database }) };
}

describe('maintenance write exclusion', () => {
  it('allows owner writes across awaits and nested scopes while refusing competing mutations', async () => {
    const { database, engine } = fixture(), gate = held();
    const owner = database.withExclusiveWrites(async () => {
      engine.create('Row', { id: 'Row-before' });
      await gate.promise;
      await database.withExclusiveWrites(async () => { engine.create('Row', { id: 'Row-after' }); });
    });
    try {
      expect(engine.query('Row').ids()).toEqual(['Row-before']);
      for (const mutation of [
        () => engine.create('Row', { id: 'Row-outsider' }),
        () => database.begin(), () => database.reset(), () => database.bulkLoad([]),
        () => database.setSchema(database.schema as object), () => database.close(),
      ]) expect(mutation).toThrow(expect.objectContaining({ code: 'WRITE_PAUSED' }));
      await expect(database.withExclusiveWrites(async () => {})).rejects.toMatchObject({ code: 'WRITE_PAUSED' });
    } finally { gate.release(); await owner; }
    expect(engine.query('Row').ids().sort()).toEqual(['Row-after', 'Row-before']);
    engine.create('Row', { id: 'Row-released' });
  });

  it('releases ownership after failure and refuses maintenance while a unit is open', async () => {
    const { database, engine } = fixture(), failure = new Error('maintenance failed');
    await expect(database.withExclusiveWrites(async () => { throw failure; })).rejects.toBe(failure);
    engine.create('Row', { id: 'Row-available' });
    const unit = database.begin(); let entered = false;
    try {
      await expect(database.withExclusiveWrites(async () => { entered = true; })).rejects.toThrow();
      expect(entered).toBe(false);
    } finally { unit.abort(); }
    await database.withExclusiveWrites(async () => { engine.create('Row', { id: 'Row-maintained' }); });
  });

  it('does not let a descendant from an expired owner borrow a later lease', async () => {
    const { database, engine } = fixture(), stale = held(), current = held();
    let descendant!: Promise<void>;
    await database.withExclusiveWrites(async () => {
      descendant = stale.promise.then(() => {
        expect(() => engine.create('Row', { id: 'Row-stale' })).toThrow(expect.objectContaining({ code: 'WRITE_PAUSED' }));
      });
    });
    const owner = database.withExclusiveWrites(async () => { await current.promise; });
    try { stale.release(); await descendant; }
    finally { current.release(); await owner; }
    expect(engine.query('Row').ids()).toEqual([]);
  });

  it('prevents watch reads and observers created by the owner from borrowing write authority', async () => {
    const { database, engine } = fixture();
    let reads = 0, deliveries = 0;
    await database.withExclusiveWrites(async () => {
      const watch = engine.watch(() => {
        reads++;
        expect(() => engine.create('Row', { id: 'Row-read' })).toThrow(expect.objectContaining({ code: 'WRITE_PAUSED' }));
        return engine.query('Row').ids();
      }, () => {
        deliveries++;
        expect(() => engine.create('Row', { id: 'Row-observer' })).toThrow(expect.objectContaining({ code: 'WRITE_PAUSED' }));
      });
      try {
        await engine.admin.watchesSettled();
        expect(reads).toBe(1); expect(deliveries).toBe(1);
        engine.create('Row', { id: 'Row-owner' });
        await engine.admin.watchesSettled();
        expect(reads).toBe(2); expect(deliveries).toBe(2);
      } finally { watch.stop(); }
    });
    expect(engine.query('Row').ids()).toEqual(['Row-owner']);
  });

  it('strips nested maintenance authority at observer boundaries for both stores', async () => {
    const first = fixture(), second = fixture();
    await first.database.withExclusiveWrites(() => second.database.withExclusiveWrites(async () => {
      for (const observed of [first, second]) {
        observed.database.withoutWriteAuthority(() => {
          for (const target of [first, second]) {
            expect(() => target.engine.create('Row', { id: 'Row-observer' }))
              .toThrow(expect.objectContaining({ code: 'WRITE_PAUSED' }));
          }
        });
      }
      first.engine.create('Row', { id: 'Row-owner' });
      second.engine.create('Row', { id: 'Row-owner' });
    }));
    expect(first.engine.query('Row').ids()).toEqual(['Row-owner']);
    expect(second.engine.query('Row').ids()).toEqual(['Row-owner']);
  });
});
