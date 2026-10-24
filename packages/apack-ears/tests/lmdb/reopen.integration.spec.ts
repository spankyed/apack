// The correctness harness, the files against memory: random workloads (tests/_harness/) run on an LMDB store, which
// is then opened again — and gives back exactly what memory held, whatever the store refused on the way.
//
// @slow: each run opens and reopens a real environment in a temp dir of its own
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import type { EarsEngine } from '../../src/index.ts';
import { openLmdbStore } from '../../src/lmdb/index.ts';
import { Model, applyTo, stateOf } from '../_harness/model.ts';
import { newEngine, refusable } from '../_harness/engines.ts';
import { workload } from '../_harness/workload.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ears-harness-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

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
