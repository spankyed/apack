// The correctness harness, model-based: random workloads run against the engine and a reference model (model.ts).
// After every write the engine holds what the model holds and refuses what it refuses; on an LMDB store, reopening
// the files gives back exactly what memory held, whatever the store refused on the way.
//
// @slow: each LMDB run opens and reopens a real environment in a temp dir of its own
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { createEarsEngine, noopSink, type EarsEngine, type PersistenceSink } from '../../src/index.ts';
import { sameValue } from '../../src/utils.ts';
import { openLmdbStore } from '../../src/lmdb/index.ts';
import { Model, applyTo, stateOf } from './model.ts';
import { workload } from './workload.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ears-harness-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const TYPES = new Set(['Task', 'Note']);
const newEngine = (persistence: PersistenceSink) =>
  createEarsEngine({ persistence, isEntityType: (name) => TYPES.has(name), isRelationKind: () => true, isRole: () => true });

/** A sink that refuses the next unit it is asked to commit when told to, as a full disk would, and otherwise passes on */
function refusable(sink: PersistenceSink): { sink: PersistenceSink; refuseNext: () => void } {
  let refusing = false;
  return {
    refuseNext: () => { refusing = true; },
    sink: {
      ...sink,
      onUnitEnd(options) {
        if (refusing) {
          refusing = false;
          // The unit's writes were collected; the sink drops them as a refused transaction would
          sink.onUnitStart();
          throw new Error('disk full');
        }
        sink.onUnitEnd(options);
      },
    },
  };
}

describe('the engine against the model', () => {
  it('holds what the model holds after every write, and refuses what it refuses', () => {
    fc.assert(fc.property(workload(), (ops) => {
      const { sink, refuseNext } = refusable(noopSink);
      const engine = newEngine(sink);
      const model = new Model();
      for (const op of ops) {
        const refused = applyTo(engine, op, refuseNext);
        expect(refused, JSON.stringify(op)).toBe(model.apply(op) !== undefined);
        expect(stateOf(engine)).toEqual(model.state());
      }
    }), { numRuns: 300 });
  });
});

describe('subscriptions against the engine', () => {
  it('are called back after exactly the writes that change what they read', () => {
    fc.assert(fc.property(workload(), (ops) => {
      const { sink, refuseNext } = refusable(noopSink);
      const engine = newEngine(sink);
      // Reads of each kind a subscription makes: an entity, a type, a value index lookup, relations from an end and of
      // a kind, and everything
      const reads: Array<() => unknown> = [
        () => engine.getRow('Task-1' as never),
        () => engine.query('Task').ids(),
        () => engine.query('Note').where('a', 1).ids(),
        () => engine.findRelations({ source: 'Task-2' as never }).map((r) => r.target),
        () => engine.findRelations({ kind: 'blocks' }).map((r) => `${r.source}>${r.target}`).sort(),
        () => stateOf(engine),
      ];
      const calls = reads.map(() => 0);
      reads.forEach((read, i) => engine.subscribe(read, () => { calls[i]++; }));
      for (const op of ops) {
        const before = reads.map((read) => read());
        const counted = [...calls];
        applyTo(engine, op, refuseNext);
        reads.forEach((read, i) => {
          // Each op is one unit, so one commit at most: called once when its result changed, else never
          expect(calls[i] - counted[i], `read ${i} after ${JSON.stringify(op)}`).toBe(sameValue(read(), before[i]) ? 0 : 1);
        });
      }
    }), { numRuns: 200 });
  });
});

describe('the files against memory', () => {
  let run = 0;
  it('reopen to exactly what memory held, whatever the store refused on the way', async () => {
    await fc.assert(fc.asyncProperty(workload(30), async (ops) => {
      const dir = path.join(root, `run-${run++}`, 'ears-db');
      let engine: EarsEngine;
      const store = openLmdbStore({ path: dir, engine: () => engine.admin, log: () => {} });
      const { sink, refuseNext } = refusable(store.sink);
      engine = newEngine(sink);
      const model = new Model();
      for (const op of ops) {
        model.apply(op);
        applyTo(engine, op, refuseNext);
      }
      const held = stateOf(engine);
      expect(held).toEqual(model.state());
      store.close();

      let reopened: EarsEngine;
      const again = openLmdbStore({ path: dir, engine: () => reopened.admin, log: () => {} });
      reopened = newEngine(again.sink);
      await again.hydrate();
      expect(stateOf(reopened)).toEqual(held);
      again.close();
    }), { numRuns: 60 });
  });
});
