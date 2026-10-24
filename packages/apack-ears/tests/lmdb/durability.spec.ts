// When a commit reaches the disk: a durable unit before it returns, every other one at the next sync — once writes
// pause, and within SYNC_INTERVAL_MS at the latest — and `durable()` waits for a sync that began after the last
// commit. The environment's own flush is observed (its `sync` and the flags each commit is made with), since a
// power loss cannot be had on this machine; what the observation proves is which flush each promise waits for.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEarsEngine, type EARS, type EarsEngine } from '../../src/index.ts';
import { openLmdbStore, SYNC_IDLE_MS, SYNC_INTERVAL_MS, type LmdbStore } from '../../src/lmdb/index.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ears-durability-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const id = (name: string) => name as EARS.EntityId;
let store: LmdbStore;
let engine: EarsEngine;
/** The syncs the store started, each finished by the spec: `finish()` flushes for real, `fail()` reports an error */
let syncs: Array<{ finish: () => void; fail: (message: string) => void }>;
/** The flags each commit was made with */
let commits: number[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  store = openLmdbStore({ path: path.join(fs.mkdtempSync(path.join(root, 'case-')), 'ears-db'), engine: () => engine.admin, log: () => {} });
  engine = createEarsEngine({ persistence: store.sink, isEntityType: (name) => name === 'Note', isRelationKind: () => true, isRole: () => true });
  syncs = [];
  commits = [];
  const env = store.env.root as unknown as {
    sync(done: (error?: Error) => void): void;
    transactionSync(fn: () => unknown, flags?: number): unknown;
  };
  const sync = env.sync.bind(env);
  vi.spyOn(env, 'sync').mockImplementation((done) => {
    syncs.push({ finish: () => sync(done), fail: (message) => done(new Error(message)) });
  });
  const transactionSync = env.transactionSync.bind(env);
  vi.spyOn(env, 'transactionSync').mockImplementation((fn, flags) => {
    commits.push(flags ?? 3);
    return transactionSync(fn, flags);
  });
});
afterEach(() => {
  store.close();
  vi.useRealTimers();
});

/** Whether a promise has settled, once the microtasks queued before asking have run */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  promise.then(() => { done = true; }, () => { done = true; });
  await Promise.resolve();
  await Promise.resolve();
  return done;
}

describe('durable()', () => {
  it('resolves at once when nothing was committed since the last sync', async () => {
    await expect(engine.durable()).resolves.toBeUndefined();
    expect(syncs).toHaveLength(0);
  });

  it('waits for a sync started after the write, and a write made while that sync runs waits for the next', async () => {
    engine.create('Note', { id: id('Note-1') });
    const first = engine.durable();
    expect(syncs, 'a sync starts for it at once, not at the timer').toHaveLength(1);
    expect(await settled(first)).toBe(false);

    engine.create('Note', { id: id('Note-2') });
    const second = engine.durable();
    expect(syncs, 'one sync at a time').toHaveLength(1);

    syncs[0].finish();
    await first;
    expect(await settled(second), 'the running sync started before Note-2 was committed').toBe(false);
    await vi.waitUntil(() => syncs.length === 2);
    syncs[1].finish();
    await second;
    await expect(engine.durable()).resolves.toBeUndefined();
    expect(syncs).toHaveLength(2);
  });

  it('rejects when the sync fails, and a later call tries again', async () => {
    engine.create('Note', { id: id('Note-1') });
    const waiting = engine.durable();
    syncs[0].fail('disk gone');
    await expect(waiting).rejects.toThrow('disk gone');
    const again = engine.durable();
    expect(syncs).toHaveLength(2);
    syncs[1].finish();
    await again;
  });

  it('resolves once the store closes, whose last write is flushed', async () => {
    engine.create('Note', { id: id('Note-1') });
    const waiting = engine.durable();
    store.close();
    await waiting;
    expect(commits.at(-1), 'the closing write waits for the disk').toBe(3);
  });
});

describe('a durable unit', () => {
  it('commits flushed, and leaves nothing for durable() to wait for', async () => {
    engine.create('Note', { id: id('Note-1') });
    engine.transact(() => { engine.create('Note', { id: id('Note-2') }); }, { durable: true });
    expect(commits).toEqual([0x10003, 3]);
    await expect(engine.durable()).resolves.toBeUndefined();
    expect(syncs, 'the flushed commit flushed the one before it too').toHaveLength(0);
  });

  it('makes the unit it is inside durable', () => {
    engine.transact(() => {
      engine.create('Note', { id: id('Note-1') });
      engine.transact(() => { engine.create('Note', { id: id('Note-2') }); }, { durable: true });
    });
    expect(commits).toEqual([3]);
  });

  it('stores nothing when it throws', () => {
    expect(() => engine.transact(() => {
      engine.create('Note', { id: id('Note-1') });
      throw new Error('stop');
    }, { durable: true })).toThrow('stop');
    expect(commits).toEqual([]);
  });
});

describe('the background sync', () => {
  it('flushes a burst of writes with one sync once they pause', () => {
    for (let n = 0; n < 50; n++) engine.create('Note', { id: id(`Note-${n}`) });
    vi.advanceTimersByTime(SYNC_IDLE_MS - 1);
    expect(syncs).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(syncs).toHaveLength(1);
  });

  it('flushes writes that never pause within SYNC_INTERVAL_MS of the first', () => {
    const step = SYNC_IDLE_MS / 2;
    for (let elapsed = 0; elapsed < SYNC_INTERVAL_MS; elapsed += step) {
      engine.create('Note', { id: id(`Note-${elapsed}`) });
      vi.advanceTimersByTime(step);
    }
    expect(syncs).toHaveLength(1);
  });

  it('starts no sync when nothing was committed', () => {
    vi.advanceTimersByTime(SYNC_INTERVAL_MS * 3);
    expect(syncs).toHaveLength(0);
  });
});
