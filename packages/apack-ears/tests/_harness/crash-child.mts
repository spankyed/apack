// The crash harness's child: runs a seeded workload against an LMDB store and acknowledges each write on stdout once
// it has returned, until it is killed. Run as: node --import tsx crash-child.mts <dir> <seed> <length>
import * as fs from 'node:fs';
import fc from 'fast-check';
import { createEarsEngine, type EarsEngine } from '../../src/index.ts';
import { openLmdbStore } from '../../src/lmdb/index.ts';
import { applyTo } from './model.ts';
import { crashWorkload } from './workload.ts';

const [dir, seed, length] = process.argv.slice(2);
const [ops] = fc.sample(crashWorkload(Number(length)), { seed: Number(seed), numRuns: 1 });

let engine: EarsEngine;
const store = openLmdbStore({ path: dir, engine: () => engine.admin, log: () => {} });
engine = createEarsEngine({ persistence: store.sink, isEntityType: (name) => name === 'Task' || name === 'Note', isRelationKind: () => true, isRole: () => true });
for (let i = 0; i < ops.length; i++) {
  applyTo(engine, ops[i], () => {});
  // Written straight to the descriptor, so the acknowledgement is out before the next write starts
  fs.writeSync(1, `${i + 1}\n`);
}
fs.writeSync(1, 'done\n');
// Waits to be killed, so a run that finishes its workload still ends by a kill rather than a close
setInterval(() => {}, 1000);
