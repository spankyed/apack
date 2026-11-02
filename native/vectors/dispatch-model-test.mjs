// Diagnostic cross-backend model/file compatibility; each extension owns a fresh process.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const sha = data => createHash('sha256').update(data).digest('hex');
const [mode, ...args] = process.argv.slice(2);
const self = fileURLToPath(import.meta.url);
const vector = (dimensions, i) => Buffer.from(Float32Array.from({ length: dimensions },
  (_, j) => Math.sin((i + 1) * (j + 1) * 1.71) + Math.cos((i + 3) * (j + 1) * .19)).buffer);
const queries = (db, dimensions) => {
  const samples = []; let maximumOracleError = 0;
  const cosine = (left, right) => {
    const a = new Float32Array(left.buffer, left.byteOffset, dimensions);
    const b = new Float32Array(right.buffer, right.byteOffset, dimensions);
    let dot = 0, aa = 0, bb = 0;
    for (let i = 0; i < dimensions; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
    return 1 - dot / Math.sqrt(aa * bb);
  };
  const canonical = Array.from({ length: 512 }, (_, i) => vector(dimensions, i));
  for (const query of [0, 17, 511, 981]) for (const scope of ['all', 'active', 'sparse']) {
    const where = scope === 'active' ? ' WHERE active=1' : scope === 'sparse' ? ' WHERE owner IN (1,17,39,41,63,127,255,511)' : '';
    const input = vector(dimensions, query);
    const rows = db.prepare('SELECT rowid,distance approximateDistance,vec1_cos_distance(v,?) canonicalDistance FROM corpus(?,?)' + where + ' ORDER BY rowid').all(
      input, input, JSON.stringify({ K: 512, nprobe: 100 }));
    assert.equal(rows.length, scope === 'all' ? 512 : scope === 'active' ? 256 : 8);
    assert(rows.every(row => Number.isSafeInteger(row.rowid) && Number.isFinite(row.approximateDistance) && Number.isFinite(row.canonicalDistance)));
    for (const row of rows) maximumOracleError = Math.max(maximumOracleError,
      Math.abs(row.canonicalDistance - cosine(input, canonical[row.rowid - 1])));
    assert(maximumOracleError <= 1e-5, 'Canonical cosine must match independent Float64 accumulation');
    samples.push({ query, scope, rows });
  }
  return { samples, maximumOracleError };
};
if (mode === 'write' || mode === 'read') {
  const [extension, file, dimensionsArgument, expectedFile, output] = args;
  assert(extension && file && expectedFile && output && args.length === 5 && !existsSync(output));
  const dimensions = Number(dimensionsArgument); assert([128, 1536].includes(dimensions));
  const report = { completed: false, mode, dimensions, source: process.env.GITHUB_SHA,
    extensionSha256: sha(readFileSync(extension)), node: process.version };
  let db, failed = false, failure;
  try {
    const before = mode === 'read' ? sha(readFileSync(file)) : null;
    db = new Database(file, { readonly: mode === 'read', fileMustExist: mode === 'read' });
    db.loadExtension(extension);
    report.runtime = db.prepare('SELECT vec1_info() value').get().value;
    if (mode === 'write') {
      db.exec('CREATE TABLE training(v); CREATE VIRTUAL TABLE corpus USING vec1(v,owner,active)');
      const insert = db.prepare('INSERT INTO training VALUES(?)');
      const digest = createHash('sha256');
      db.transaction(() => { for (let i = 0; i < 512; i++) {
        const bytes = vector(dimensions, i); digest.update(bytes); insert.run(bytes);
      } })();
      report.fixtureSha256 = digest.digest('hex');
      const model = db.prepare('SELECT vec1_train(v,?) model FROM training').get(JSON.stringify({
        distance: 'cos', quantizer: 'bq', nbucket: 4, nthread: 1,
      })).model;
      report.modelSha256 = sha(model);
      db.prepare("INSERT INTO corpus(cmd,arg) VALUES('rebuild',?)").run(model);
      const put = db.prepare('INSERT INTO corpus(rowid,v,owner,active) VALUES(?,?,?,?)');
      db.transaction(() => { for (let i = 0; i < 512; i++) put.run(i + 1, vector(dimensions, i), BigInt(i), BigInt(i % 2)); })();
      const answer = queries(db, dimensions); report.maximumOracleError = answer.maximumOracleError;
      writeFileSync(expectedFile, JSON.stringify(answer.samples), { flag: 'wx' });
    } else {
      const expected = JSON.parse(readFileSync(expectedFile, 'utf8')), answer = queries(db, dimensions), actual = answer.samples;
      report.maximumOracleError = answer.maximumOracleError;
      assert.equal(actual.length, 12); assert.equal(expected.length, 12);
      let maximumDistanceDifference = 0, maximumCanonicalDistanceDifference = 0, worstApproximate;
      for (let i = 0; i < actual.length; i++) {
        assert.equal(actual[i].query, expected[i].query); assert.equal(actual[i].scope, expected[i].scope);
        assert.equal(actual[i].rows.length, expected[i].rows.length);
        for (let j = 0; j < actual[i].rows.length; j++) {
          const a = actual[i].rows[j], b = expected[i].rows[j]; assert.equal(a.rowid, b.rowid);
          const difference = Math.abs(a.approximateDistance - b.approximateDistance);
          if (difference > maximumDistanceDifference) {
            maximumDistanceDifference = difference;
            worstApproximate = { query: actual[i].query, scope: actual[i].scope, rowid: a.rowid,
              writer: b.approximateDistance, reader: a.approximateDistance };
          }
          maximumCanonicalDistanceDifference = Math.max(maximumCanonicalDistanceDifference,
            Math.abs(a.canonicalDistance - b.canonicalDistance));
        }
      }
      report.maximumApproximateDistanceDifference = maximumDistanceDifference;
      report.worstApproximate = worstApproximate ?? null;
      report.maximumCanonicalDistanceDifference = maximumCanonicalDistanceDifference;
      // EARS uses ANN owners only; hidden BQ distance is an approximate transformed-space value.
      // Canonical cosine remains separately checked, with the original explicit tolerance.
      assert(maximumCanonicalDistanceDifference <= 1e-5, 'Canonical cross-backend cosine must remain within explicit float tolerance');
      report.queriesChecked = actual.length;
    }
    db.close(); db = undefined;
    if (mode === 'read') { report.sourceUnchanged = sha(readFileSync(file)) === before; assert(report.sourceUnchanged); }
  } catch (error) { failed = true; failure = error; }
  finally {
    try { db?.close(); }
    catch (cleanup) { failure = failed ? new AggregateError([failure, cleanup], 'Cross-backend probe and close failed', { cause: failure }) : cleanup; failed = true; }
    report.completed = !failed;
    if (failed) report.failure = { message: failure?.message ?? String(failure), stack: failure?.stack };
    writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  if (failed) throw failure;
} else {
  assert.equal(mode, 'compare');
  const [genericArgument, dispatchArgument, output] = args; assert(args.length === 3 && !existsSync(output));
  const variants = { generic: resolve(genericArgument), dispatch: resolve(dispatchArgument) };
  const root = mkdtempSync(join(tmpdir(), 'ears-vector-dispatch-model-'));
  const report = { completed: false, source: process.env.GITHUB_SHA, trials: [], scratchRemoved: false,
    scope: '512-vector BQ model/file compatibility, both writer/reader directions at 128/1536 dimensions; not recall, latency or CPU fallback qualification' };
  const child = (operation, extension, file, dimensions, expected, result) => {
    const execution = spawnSync(process.execPath, [self, operation, extension, file, String(dimensions), expected, result],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    const receipt = existsSync(result) ? JSON.parse(readFileSync(result, 'utf8')) : null;
    const outcome = { operation, exit: { code: execution.status, signal: execution.signal }, receipt,
      logTail: (execution.stderr ?? '').slice(-8192) };
    report.trials.push(outcome);
    if (execution.error) throw execution.error;
    assert.equal(execution.status, 0, outcome.logTail); assert.equal(execution.signal, null);
    assert.equal(receipt?.completed, true); return receipt;
  };
  let failed = false, failure;
  try {
    for (const writer of ['generic', 'dispatch']) for (const dimensions of [128, 1536]) {
      const prefix = join(root, `${writer}-${dimensions}`), file = prefix + '.sqlite3', expected = prefix + '.expected.json';
      const reader = writer === 'generic' ? 'dispatch' : 'generic';
      child('write', variants[writer], file, dimensions, expected, prefix + '.write.json');
      child('read', variants[reader], file, dimensions, expected, prefix + '.read.json');
    }
    assert.equal(report.trials.length, 8);
  } catch (error) { failed = true; failure = error; }
  finally {
    try { rmSync(root, { recursive: true }); report.scratchRemoved = !existsSync(root); assert(report.scratchRemoved); }
    catch (cleanup) { failure = failed ? new AggregateError([failure, cleanup], 'Cross-backend probe and cleanup failed', { cause: failure }) : cleanup; failed = true; }
    report.completed = !failed;
    if (failed) report.failure = { message: failure?.message ?? String(failure), stack: failure?.stack };
    writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  if (failed) throw failure;
}
