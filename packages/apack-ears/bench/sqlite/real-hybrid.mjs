// Private paired-corpus correctness probe. Reports never contain source text, IDs or vectors.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, createReadStream, existsSync, mkdtempSync, openSync, readFileSync, readdirSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { isAbsolute, join } from 'node:path';
import { cpus, tmpdir } from 'node:os';
import { createEarsEngine } from '../../src/index.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { loadedNativeBindings, startHeartbeat } from './load-metrics.ts';
import { getLoadablePath } from 'sqlite-vec';
import { startVectorModels, waitForNativeModels } from '../../src/sqlite/index.ts';
import { resolveNativeVectorExtension } from '../../src/sqlite/native-extension.ts';
import { prepareEmptyNativeVectorCursor } from '../../src/sqlite/vector-cursor.ts';
import { SqliteVectorIndex } from '../../src/sqlite/vector-index.ts';
import { EXACT_VECTOR_CHUNK_LIMIT } from '../../src/sqlite/vector-policy.ts';
import { compareNativeProbes } from './native-probe-diagnostic.mjs';

const [root, output, sizeArg = '1000', modelMode = 'fallback', candidateFloorArg = 'production', diagnosticBuild = 'packaged', ...extra] = process.argv.slice(2);
assert(root && output && !existsSync(output) && extra.length === 0);
assert(['fallback', 'managed'].includes(modelMode));
assert(['production', '1024', '2048'].includes(candidateFloorArg));
assert(candidateFloorArg === 'production' || modelMode === 'managed');
const nativeCandidateFloor = candidateFloorArg === 'production' ? null : Number(candidateFloorArg);
let activeCandidateFloor = nativeCandidateFloor;
const matchedCandidateWidths = nativeCandidateFloor === 2048 ? ['production', '1024', '2048'] : null;
// Diagnostic query perturbation only; the ordinary candidate policy and training/admission are unchanged.
const ordinaryCandidates = SqliteVectorIndex.prototype.candidates;
if (nativeCandidateFloor) SqliteVectorIndex.prototype.candidates = function (generation, vector, limit, ...rest) {
  return ordinaryCandidates.call(this, generation, vector, Math.max(limit, activeCandidateFloor ?? 0), ...rest);
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let nativeExtension = modelMode === 'managed' ? resolveNativeVectorExtension() : undefined;
let nativeDiagnostic = null;
if (diagnosticBuild !== 'packaged') {
  assert.equal(modelMode, 'managed'); assert.equal(candidateFloorArg, 'production');
  assert(isAbsolute(diagnosticBuild), 'Diagnostic code path must be explicitly supplied by the benchmark owner');
  const bytes = readFileSync(join(diagnosticBuild, 'provenance.json')), provenance = JSON.parse(bytes);
  assert.equal(provenance.completed, true); assert.equal(provenance.source, process.env.GITHUB_SHA);
  assert.equal(provenance.platform, 'linux'); assert.equal(provenance.arch, 'x64');
  assert.equal(provenance.baseline.sourceSha256, '04043ede29b2998b2cd0e7735cc696dba2158554a0bf9036e2a77849dec0425a');
  assert.equal(sha(readFileSync(join(diagnosticBuild, 'vec1.c'))), provenance.baseline.sourceSha256);
  assert.equal(sha(readFileSync(nativeExtension)), provenance.baseline.extensionSha256,
    'Diagnostic baseline must match this run’s actual packaged artifact');
  nativeExtension = join(diagnosticBuild, 'vec1.so');
  assert.equal(sha(readFileSync(nativeExtension)), provenance.extensionSha256);
  nativeDiagnostic = { kind: 'upstream-x64-runtime-dispatch', provenanceSha256: sha(bytes),
    baselineExtensionSha256: provenance.baseline.extensionSha256 };
}
assert.equal(process.platform, 'linux');
const limits = Object.fromEntries(['cpu.max', 'memory.max', 'memory.swap.max'].map(name =>
  [name, readFileSync('/sys/fs/cgroup/' + name, 'utf8').trim()]));
assert.deepEqual(limits, { 'cpu.max': '200000 100000', 'memory.max': '6442450944', 'memory.swap.max': '0' });
const manifestBytes = readFileSync(join(root, 'manifest.json')), manifest = JSON.parse(manifestBytes);
assert.equal(manifest.revision, '0d5fd00fbc5a9c0c836d70cd409f7e461255e572');
const size = Number(sizeArg), dimensions = 1536, width = dimensions * 4;
const truthBytes = readFileSync(join(root, 'hybrid-vector-truth.json')), truth = JSON.parse(truthBytes);
assert.equal(truth.protocol, 'ears-hybrid-vector-truth/1');
assert.equal(truth.completed, true);
assert.equal(truth.manifestSha256, sha(manifestBytes));
assert.equal(truth.k, 64);
const truthCohorts = truth.cohorts.filter(row => row.size === size);
assert.equal(truthCohorts.length, 3);
assert.equal(truth.recipeSha256, sha(readFileSync(new URL('./hybrid-vector-oracle.py', import.meta.url))));
assert.deepEqual(truth.limits, limits);
const independentAnswers = new Map();
for (const [name, stride] of [['all-live', 1], ['candidate-10-percent', 10], ['candidate-1-percent', 100]]) {
  const cohorts = truthCohorts.filter(row => row.cohort === name);
  assert.equal(cohorts.length, 1);
  const cohort = cohorts[0];
  assert.equal(cohort.eligible, Math.ceil(size / stride));
  assert.equal(cohort.answers.length, 200);
  for (const answer of cohort.answers) {
    assert(['held-out-title', 'corpus-lexical-control'].includes(answer.family));
    assert(Number.isInteger(answer.query) && answer.query >= 0 && answer.query < 100);
    assert.equal(answer.ordinals.length, Math.min(64, cohort.eligible));
    assert.equal(new Set(answer.ordinals).size, answer.ordinals.length);
    assert(answer.ordinals.every(ordinal => Number.isInteger(ordinal) && ordinal >= 0 && ordinal < size && ordinal % stride === 0));
    const key = `${name}/${answer.family}/${answer.query}`;
    assert(!independentAnswers.has(key));
    independentAnswers.set(key, answer.ordinals.map(ordinal => `Row-${ordinal}`));
  }
}
assert.equal(independentAnswers.size, 600);
assert([1000, 10000, 99900].includes(size));
// Verify the sealed complete inputs without retaining the unused 99k vector rows.
for (const name of ['corpus.f32', 'queries.f32']) {
  const digest = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(join(root, name))) { digest.update(chunk); bytes += chunk.length; }
  assert.equal(digest.digest('hex'), manifest.files[name].sha256);
  assert.equal(bytes, manifest.files[name].bytes);
}
const vectors = Buffer.alloc(size * width), queries = readFileSync(join(root, 'queries.f32'));
const descriptor = openSync(join(root, 'corpus.f32'), 'r');
try { let offset = 0; while (offset < vectors.length) {
  const read = readSync(descriptor, vectors, offset, vectors.length - offset, offset);
  assert(read > 0); offset += read;
} } finally { closeSync(descriptor); }
async function rows(name, limit) {
  const stream = createReadStream(join(root, name));
  const lines = createInterface({ input: stream, crlfDelay: Infinity }), result = [];
  try { for await (const line of lines) { result.push(JSON.parse(line)); if (result.length === limit) break; } }
  finally { lines.close(); stream.destroy(); }
  assert.equal(result.length, limit); return result;
}
const documents = await rows('corpus-text.jsonl', size), questions = await rows('queries-text.jsonl', 100);
const vector = (buffer, row) => Array.from(new Float32Array(buffer.buffer, buffer.byteOffset + row * width, dimensions));
const report = { protocol: 'ears-private-real-hybrid/1', completed: false, qualification: false,
  source: process.env.GITHUB_SHA, limits, cpuModels: [...new Set(cpus().map(cpu => cpu.model))], vectorRecallReference: 'independent-float64-canonical-f32', oracleSha256: sha(truthBytes), oracleRecipeSha256: truth.recipeSha256, oracleScalarChecks: truth.scalarChecks.filter(row => row.size === size), node: process.version, arch: process.arch, manifestSha256: sha(manifestBytes), size, queries: 200, queryFamilies: { heldOut: 100, lexicalControls: 100 },
  scope: 'Selected real paired prefix; exact fusion correctness and warm timings, not relevance judgments or resource qualification',
  nativeDiagnostic, nativeExtensionSha256: nativeExtension ? sha(readFileSync(nativeExtension)) : null,
  containsPayload: false, fusionPolicy: 'global-vector-window-max-40-4k', fusionVectorDepth: 40, vectorPolicy: 'adaptive-native-owner-pool', nativeOwnerTargets: { through32: 256, through40: 1024, through64: 2048 }, fallbackOwnerTarget: 256, nativeModelOwnerStarted: false, modelMode, nativeCandidateFloor, matchedCandidateWidths, timing: 'Warm query after independent reference reads; 2CPU/6GiB/no-swap disposable container', samples: [] };
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
const save = () => {
  writeFileSync(output + '.next', JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  renameSync(output + '.next', output);
};
const directory = mkdtempSync(join(tmpdir(), 'ears-real-hybrid-'));
let db;
// Sample outside timed queries. These are whole-process cumulative peaks and file-size snapshots,
// not per-query allocations, peak disk use, allocated blocks or an isolated engine memory cost.
const sampleResources = () => {
  const files = { mainBytes: 0, walBytes: 0, shmBytes: 0, otherBytes: 0, totalBytes: 0 };
  const visit = path => { for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) { visit(full); continue; }
    assert(entry.isFile(), 'Owned benchmark directory must contain ordinary files');
    const bytes = statSync(full).size;
    const category = entry.name === 'data.sqlite3' ? 'mainBytes' :
      entry.name.endsWith('-wal') ? 'walBytes' : entry.name.endsWith('-shm') ? 'shmBytes' : 'otherBytes';
    files[category] += bytes; files.totalBytes += bytes;
  } };
  visit(directory);
  return { memory: process.memoryUsage(), usage: process.resourceUsage(), files };
};
try {
  db = new SqliteDatabase({ path: directory, syncs: true, nativeVectorExtension: nativeExtension, schema: toElmdbSchema({ types: {
    Row: { required: [], search: { fields: { title: 3, body: 1 } },
      embed: { from: ['title', 'body'], model: 'public-fixture', dims: dimensions, chunk: 'whole' } },
  }, relations: {}, roles: [] }) });
  if (nativeExtension) assert(prepareEmptyNativeVectorCursor(db));
  let e = createEarsEngine({ database: db });
  const started = performance.now();
  for (let offset = 0; offset < size; offset += 64) e.transact(() => {
    for (let i = offset; i < Math.min(size, offset + 64); i++) {
      assert.equal(documents[i].row, i);
      e.create('Row', { id: `Row-${i}`, title: documents[i].title, body: documents[i].text });
    }
  });
  await db.indexesReady();
  let stored = 0;
  for (;;) {
    const pending = e.pendingEmbeddings('Row', { limit: 64 });
    if (!pending.count) break;
    assert(pending.chunks.length);
    const batch = pending.chunks.map(chunk => ({ ...chunk, model: pending.model,
      vector: vector(vectors, Number(chunk.id.slice(4))) }));
    assert.equal(e.embed(batch).stored, batch.length); stored += batch.length;
  }
  assert.equal(stored, size);
  report.loadMs = performance.now() - started;
  if (nativeExtension) {
    const admission = performance.now(), pulse = startHeartbeat(1);
    try {
      await startVectorModels(db);
      report.nativeModelOwnerStarted = true;
      await waitForNativeModels(db);
    } finally {
      pulse.stop();
      report.nativeAdmission = { ms: performance.now() - admission, heartbeatDelaysMs: pulse.delaysMs };
      save();
    }
    const training = db.get("SELECT state,samples,model_sha256,extension_sha256,native_version,worker_sha256 FROM vector_training");
    const required = size > EXACT_VECTOR_CHUNK_LIMIT;
    if (required) assert.equal(training?.state, 'ready');
    else assert.equal(training, undefined);
    assert.equal(db.get("SELECT count(*) n FROM vector_indexes WHERE state='ready'").n, required ? 1 : 0);
    report.nativeModel = training ?? null;
    report.nativeModelRequired = required;
    report.nativeModelReady = required;
    report.exactVectorChunkLimit = EXACT_VECTOR_CHUNK_LIMIT;
  }
  report.resourceSnapshots = { afterAdmission: sampleResources() };
  report.nativeVectorRuntime = nativeExtension ? db.get('SELECT vec1_info() value').value : null;
  report.sqlite = db.get('SELECT sqlite_version() version').version;
  report.synchronous = db.sql.pragma('synchronous', { simple: true });
  assert.equal(report.synchronous, 2);
  const cohorts = [{ name: 'all-live', ids: null, query: () => e.query('Row') }];
  for (const stride of [10, 100]) {
    const ids = documents.flatMap((_, i) => i % stride === 0 ? [`Row-${i}`] : []);
    cohorts.push({ name: `candidate-${100 / stride}-percent`, ids, query: () => e.query.ids(ids) });
  }
  const inputs = questions.map((question, q) => {
    assert.equal(question.row, q);
    return { family: 'held-out-title', ordinal: q, text: question.title, embedding: vector(queries, q), anchor: undefined };
  });
  // Separate coverage controls, not held-out relevance judgments: both rankings must be populated.
  for (let q = 0; q < 100; q++) {
    const ordinal = Math.floor(q * size / 100), document = documents[ordinal];
    const tokens = (document.title + ' ' + document.text).match(/[\p{L}\p{N}]+/gu) ?? [];
    assert(tokens.length);
    inputs.push({ family: 'corpus-lexical-control', ordinal: q, text: tokens.slice(0, 3).join(' '),
      embedding: vector(vectors, ordinal), anchor: `Row-${ordinal}` });
  }
  const reopenOrdinals = [0, 37, 99], reopenAnswers = new Map();
  for (const cohort of cohorts) for (const input of inputs) {
    const { text, embedding } = input, options = { fuzzy: false };
    const textIds = cohort.query().search(text, options).ids();
    const vectorIds = cohort.query().near(embedding, { k: size }).ids();
    if (input.anchor && cohort.name === 'all-live') {
      assert(textIds.includes(input.anchor), 'Lexical control must retrieve its corpus owner');
      assert(vectorIds.includes(input.anchor), 'Vector control must retrieve its corpus owner');
    }
    const fuse = rankedVectors => {
      const scores = new Map();
      for (const ranked of [textIds, rankedVectors]) ranked.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (61 + rank)));
      return [...scores].sort((a, b) => b[1] - a[1]).slice(0, 10);
    };
    const candidateVectors = cohort.query().near(embedding, { k: 40 }).ids();
    const vectorRecall = {};
    for (const depth of [10, 40, 64]) {
      const selected = depth === 40 ? candidateVectors : cohort.query().near(embedding, { k: depth }).ids();
      const exact = independentAnswers.get(`${cohort.name}/${input.family}/${input.ordinal}`);
      assert(exact);
      const wanted = new Set(exact.slice(0, depth));
      assert.equal(selected.length, wanted.size);
      vectorRecall[depth] = selected.filter(id => wanted.has(id)).length / wanted.size;
    }
    let candidateWidths;
    if (matchedCandidateWidths) {
      candidateWidths = {};
      const order = [...matchedCandidateWidths.slice(input.ordinal % 3), ...matchedCandidateWidths.slice(0, input.ordinal % 3)];
      const previousFloor = activeCandidateFloor;
      try {
        for (const width of order) {
          activeCandidateFloor = width === 'production' ? null : Number(width);
          const measurements = candidateWidths[width] = {};
          for (const depth of [10, 40, 64]) {
            const started = performance.now(), selected = cohort.query().near(embedding, { k: depth }).ids();
            const ms = performance.now() - started;
            const wanted = new Set(independentAnswers.get(`${cohort.name}/${input.family}/${input.ordinal}`).slice(0, depth));
            assert.equal(selected.length, wanted.size);
            measurements[depth] = { recall: selected.filter(id => wanted.has(id)).length / wanted.size, ms };
          }
        }
      } finally { activeCandidateFloor = previousFloor; }
    }
    const fullRanking = fuse(vectorIds), expected = fuse(candidateVectors);
    const pulse = startHeartbeat(1), at = performance.now();
    let actual, ms;
    try {
      actual = cohort.query().hybrid(text, embedding, { ...options, k: 10 }).hits();
      ms = performance.now() - at;
    } finally { pulse.stop(); }
    assert.deepEqual(actual.map(hit => hit.id), expected.map(([id]) => id));
    actual.forEach((hit, i) => assert(Math.abs(hit.score - expected[i][1]) < 1e-12));
    assert.equal(new Set(actual.map(hit => hit.id)).size, actual.length);
    if (reopenOrdinals.includes(input.ordinal)) reopenAnswers.set(`${cohort.name}/${input.family}/${input.ordinal}`,
      actual.map(hit => ({ id: hit.id, score: hit.score })));
    const fullRankingIds = new Set(fullRanking.map(([id]) => id));
    const fullRankingOverlapAt10 = actual.filter(hit => fullRankingIds.has(hit.id)).length / fullRanking.length;
    report.samples.push({ cohort: cohort.name, family: input.family, query: input.ordinal, ms, vectorRecall, ...(candidateWidths ? { candidateWidths } : {}), fullRankingOverlapAt10, heartbeatDelaysMs: pulse.delaysMs, textMatches: textIds.length, vectorMatches: vectorIds.length, returned: actual.length });
    if (report.samples.length % 25 === 0) save();
  }
  report.resourceSnapshots.afterQueriesAndReferences = sampleResources();
  report.maxRssKiB = report.resourceSnapshots.afterQueriesAndReferences.usage.maxRSS;
  report.memoryAfterQueries = report.resourceSnapshots.afterQueriesAndReferences.memory;
  save();
  // Separate actual-plan pass; no bindings, query text, returned IDs or vectors enter the receipt.
  const diagnostic = inputs.find(input => input.family === 'corpus-lexical-control');
  report.diagnostics = cohorts.map(cohort => {
    const explained = cohort.query().hybrid(diagnostic.text, diagnostic.embedding, { fuzzy: false, k: 10 }).explain();
    assert.equal(explained.backend, 'sqlite');
    return { cohort: cohort.name, statementCount: explained.statementCount,
      statements: explained.statements.map(statement => ({ sqlSha256: sha(statement.sql),
        distanceScoring: statement.sql.includes('vec_distance_cosine'), returnedRows: statement.returnedRows,
        ms: statement.ms, plan: statement.plan })) };
  });
  // Run after main timings: a sampled parameter diagnostic cannot qualify full-corpus recall.
  if (nativeExtension && report.nativeModelReady && nativeCandidateFloor === null)
    report.nativeProbeComparison = compareNativeProbes(db, cohorts, inputs, independentAnswers, size, EXACT_VECTOR_CHUNK_LIMIT);
  // Matched native projection diagnostic: same model/query/filter, no corpus IDs in receipts.
  if (nativeExtension && report.nativeModelReady) {
    const current = db.get("SELECT id FROM vector_indexes WHERE state='ready'");
    assert(Number.isSafeInteger(current.id) && current.id > 0);
    const length = Math.sqrt(diagnostic.embedding.reduce((sum, value) => sum + value * value, 0));
    const query = Buffer.from(Float32Array.from(diagnostic.embedding, value => value / length).buffer);
    report.ownerProjection = [];
    for (const cohort of cohorts) {
      if ((cohort.ids?.length ?? size) <= EXACT_VECTOR_CHUNK_LIMIT) continue;
      const filter = cohort.ids ? 'owner IN (SELECT e.seq FROM entities e WHERE e.id IN (SELECT value FROM json_each(?)) AND e.id!=?)' : 'active=1';
      for (const limit of [256, 1024, 2048]) {
        const result = { cohort: cohort.name, limit, samples: [] };
        report.ownerProjection.push(result);
        for (let trial = 0; trial < 3; trial++) {
          const bindings = [query, JSON.stringify({ K: limit, nprobe: 32 }), ...(cohort.ids ? [JSON.stringify(cohort.ids), ''] : [])];
          const source = `FROM ann_${current.id}(?,?) WHERE ${filter}`;
          let owners, rowids, mapped, ownerMs, rowidMs, mappingMs;
          const owner = () => { const at = performance.now(); owners = db.all('SELECT owner ' + source, bindings); ownerMs = performance.now() - at; };
          const rows = () => {
            let at = performance.now(); rowids = db.all('SELECT rowid embedding_id ' + source, bindings); rowidMs = performance.now() - at;
            at = performance.now(); mapped = db.all(`SELECT v.id embedding_id,e.seq owner FROM embedding_values v JOIN entities e ON e.id=v.entity_id
              WHERE v.id IN (SELECT value FROM json_each(?))`, [JSON.stringify(rowids.map(row => row.embedding_id))]);
            mappingMs = performance.now() - at;
          };
          if (trial % 2) { rows(); owner(); } else { owner(); rows(); }
          const byEmbedding = new Map(mapped.map(row => [row.embedding_id, row.owner]));
          assert.equal(mapped.length, rowids.length);
          assert.deepEqual(rowids.map(row => byEmbedding.get(row.embedding_id)), owners.map(row => row.owner));
          result.samples.push({ trial, returned: owners.length, ownerMs, rowidMs, mappingMs });
        }
      }
    }
  }
  report.nodeSha256 = sha(readFileSync(process.execPath));
  report.nativeBindings = loadedNativeBindings([getLoadablePath(), ...(nativeExtension ? [nativeExtension] : [])]);
  report.resourceSnapshots.afterDiagnostics = sampleResources();
  // Close the owner before independent read-only opens. OS page cache is deliberately uncontrolled:
  // this measures reopen behavior, not cold-disk latency or a repeated full 600-query qualification.
  report.reopen = { scope: 'Three read-only reopen passes, OS cache uncontrolled; sampled warm-answer parity', passes: [] };
  for (let pass = 0; pass < 3; pass++) {
    let at = performance.now();
    await db.drainBackground(); db.close();
    const closeAndDrainMs = performance.now() - at;
    at = performance.now();
    db = new SqliteDatabase({ path: directory, readOnly: true, nativeVectorExtension: nativeExtension });
    e = createEarsEngine({ database: db });
    const openMs = performance.now() - at;
    assert.equal(db.readOnly, true);
    assert.equal(db.get('SELECT count(*) n FROM entities').n, size);
    const result = { pass, closeAndDrainMs, openMs, samples: [] };
    report.reopen.passes.push(result);
    for (const cohort of cohorts) for (const input of inputs.filter(input => reopenOrdinals.includes(input.ordinal))) {
      const pulse = startHeartbeat(1), started = performance.now();
      let actual, ms;
      try {
        actual = cohort.query().hybrid(input.text, input.embedding, { fuzzy: false, k: 10 }).hits();
        ms = performance.now() - started;
      } finally { pulse.stop(); }
      const expected = reopenAnswers.get(`${cohort.name}/${input.family}/${input.ordinal}`);
      assert.deepEqual(actual.map(hit => hit.id), expected.map(hit => hit.id));
      actual.forEach((hit, index) => assert(Math.abs(hit.score - expected[index].score) < 1e-12));
      result.samples.push({ cohort: cohort.name, family: input.family, query: input.ordinal, ms,
        heartbeatDelaysMs: pulse.delaysMs, returned: actual.length, matchesWarm: true });
    }
    result.resources = sampleResources();
    save();
  }
  reopenAnswers.clear();
  report.completed = true;
} finally {
  try {
    try { if (report.nativeModelOwnerStarted) await db?.drainBackground(); }
    finally { try { db?.close(); } finally { SqliteVectorIndex.prototype.candidates = ordinaryCandidates; } }
  } finally {
    rmSync(directory, { recursive: true, force: true });
    report.databaseScratchRemoved = !existsSync(directory);
    save();
  }
}
