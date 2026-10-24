// The correctness harness, model-based: random workloads run against the engine and a reference model (model.ts).
// After every write the engine holds what the model holds and refuses what it refuses, and a subscription is called
// back after exactly the writes that change its result. The files' half, on LMDB, is tests/lmdb/reopen.integration.spec.ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { noopSink } from '../../src/index.ts';
import { sameValue } from '../../src/utils.ts';
import { Model, applyTo, stateOf } from '../_harness/model.ts';
import { newEngine, refusable } from '../_harness/engines.ts';
import { workload } from '../_harness/workload.ts';

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
