// The correctness harness, model-based: random workloads (tests/_harness/) run against the selected backend and a
// reference model. After every op the engine refuses what the model refuses and holds what it holds, a rolled-back unit
// and savepoint included, and every derived read — a type's entities, count and trash, an index lookup, a role, an
// edge's far ends — answers as the model does; and a watch on every one of those reads delivers what the read answers
// afresh, after every op. A store refusing a commit is no op here, since nothing in front of
// elmdb can inject one: elmdb's own model harness covers that (elmdb/crates/elmdb/src/engine/tests/model.rs)
import fc from 'fast-check';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { toElmdbSchema, type EngineSchema } from '../../src/schema.ts';
import { createEarsEngine } from '../../src/index.ts';
import { openDatabase } from '../../src/lmdb/index.ts';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INDEXED, KINDS, Model, ROLES, TYPES, applyTo, derivedOf, stateOf, watchedReads, type Op } from '../_harness/model.ts';
import { workload } from '../_harness/workload.ts';

let directory: string | undefined;
const disposals = new Set<() => void>();
const disposeAll = () => {
  for (const dispose of disposals) dispose();
  if (directory) rmSync(directory, { recursive: true, force: true });
};
process.once('exit', disposeAll);
afterAll(() => { process.off('exit', disposeAll); disposeAll(); });
beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'ears-model-'));
  const schema: EngineSchema = {
    types: Object.fromEntries(TYPES.map((type) => [type, { required: [], indexes: [INDEXED] }])),
    relations: Object.fromEntries(KINDS.map((kind) => [kind, {}])), roles: [...ROLES],
  };
  const path = join(directory, 'source');
  const seed = process.env.EARS_EVALUATION_BACKEND === 'sqlite'
    ? new SqliteDatabase({ path, syncs: false, schema: toElmdbSchema(schema) })
    : openDatabase({ path, syncs: false, schema });
  try {
    if (seed instanceof SqliteDatabase) await seed.indexesReady();
    seed.backup(join(directory, 'seed'));
  } finally { seed.close(); }
});

/** Each workload gets independent files and a native handle; only empty, closed bootstrap data is copied. */
function harnessEngine() {
  const own = mkdtempSync(join(directory!, 'case-'));
  const sqlite = process.env.EARS_EVALUATION_BACKEND === 'sqlite';
  const file = sqlite ? 'data.sqlite3' : 'data.mdb';
  copyFileSync(join(directory!, 'seed', file), join(own, file));
  const database = sqlite ? new SqliteDatabase({ path: own, syncs: false }) : openDatabase({ path: own, syncs: false });
  const dispose = () => {
    disposals.delete(dispose);
    if (database.isOpen) database.close();
    rmSync(own, { recursive: true, force: true });
  };
  disposals.add(dispose);
  try { return { engine: createEarsEngine({ database }), database, dispose }; }
  catch (error) { dispose(); throw error; }
}

it('runs the model against the selected real backend and independent empty stores', () => {
  const first = harnessEngine(), second = harnessEngine();
  try {
    expect(first.database instanceof SqliteDatabase).toBe(process.env.EARS_EVALUATION_BACKEND === 'sqlite');
    expect(second.database instanceof SqliteDatabase).toBe(process.env.EARS_EVALUATION_BACKEND === 'sqlite');
    expect(first.engine.query.all().ids()).toEqual([]);
    expect(second.engine.query.all().ids()).toEqual([]);
    const type = TYPES[0]!;
    first.engine.create(type).id();
    expect(first.engine.query.all().ids()).toHaveLength(1);
    expect(second.engine.query.all().ids()).toEqual([]);
  } finally { first.dispose(); second.dispose(); }
});

it('refuses, holds and answers what the model does', () => {
  fc.assert(fc.property(fc.integer({ min: 10, max: 60 }).chain((length) => workload(length)), (ops: Op[]) => {
    const { engine, dispose } = harnessEngine();
    const model = new Model();
    try {
      expect(stateOf(engine)).toEqual(model.state());
      for (const op of ops) {
        const where = JSON.stringify(op);
        expect(applyTo(engine, op), where).toBe(model.apply(op) !== undefined);
        expect(stateOf(engine), where).toEqual(model.state());
        expect(derivedOf(engine, model), where).toEqual(model.derived());
      }
    } finally {
      dispose();
    }
  }), { numRuns: 120 });
});

it('keeps every watch at what its read answers afresh, after every write, whatever wrote', async () => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: 10, max: 60 }).chain((length) => workload(length)), async (ops: Op[]) => {
    const { engine, dispose } = harnessEngine();
    const stops: Array<() => void> = [];
    try {
      expect(engine.query.withTrashed.all().exists()).toBe(false);
      const latest = new Map<string, unknown>();
      for (const [name, read] of Object.entries(watchedReads(engine, ops))) {
        const watching = engine.watch(read, {
          next: (value) => { latest.set(name, value); },
          error: (error) => { latest.set(name, { threw: String(error) }); },
        });
        stops.push(() => watching.stop());
      }
      const reads = watchedReads(engine, ops);
      for (const op of ops) {
        applyTo(engine, op);
        await engine.admin.watchesSettled();
        for (const [name, read] of Object.entries(reads)) {
          let fresh: unknown;
          try { fresh = read(); } catch (error) { fresh = { threw: String(error) }; }
          expect(latest.get(name), `${name} after ${JSON.stringify(op)}`).toEqual(fresh);
        }
      }
    } finally {
      for (const stop of stops) stop();
      dispose();
    }
  }), { numRuns: 40 });
});
