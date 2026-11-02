import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const require = createRequire('/seed/package.json'), Database = require('better-sqlite3'), file = process.argv[2], output = process.argv[3];
const db = new Database(':memory:'); db.loadExtension(file);
const report = { binary: { file, sha256: createHash('sha256').update(readFileSync(file)).digest('hex'), debug: db.prepare('SELECT vec_debug() info').get().info },
  probeSha256: createHash('sha256').update(readFileSync('/range.mjs')).digest('hex'), cases: [] };
try {
  for (const dimensions of [8, 35, 1568]) for (const scale of [90, 127]) {
    const a = new Int8Array(dimensions), b = new Int8Array(dimensions); a[0] = scale; b[0] = -scale;
    const expected = 2 * scale, actual = db.prepare('SELECT vec_distance_l2(vec_int8(?),vec_int8(?)) d').get(Buffer.from(a.buffer),Buffer.from(b.buffer)).d;
    report.cases.push({ dimensions, scale, expected, actual, passed: actual !== null && Math.abs(actual - expected) < 1e-5 });
  }
} finally { db.close(); writeFileSync(output,JSON.stringify(report,null,2)); }
