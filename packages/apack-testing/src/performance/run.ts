import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { chromeTrace, manifestSchema, summarize, trialSchema, type PerformanceManifest, type PerformanceTrial } from './report.ts';

// One parsed/encoded trial at a time; full profiles never accumulate in the run index.
export const PERFORMANCE_TRIAL_BYTES = 128 * 1024 * 1024;
export const PERFORMANCE_RUN_BYTES = 4 * 1024 * 1024 * 1024;
const INDEX_BYTES = 1024 * 1024;

/** Child process lifecycle retained independently of successful application assertions. */
export interface PerformanceInvocation {
  phase: string;
  index?: number;
  exitCode: number | null;
  signal: string | null;
}
const sampleSchema = z.object({ scenario: trialSchema.shape.scenario, index: z.number().int().nonnegative(), warmup: z.boolean(),
  outcome: trialSchema.shape.outcome, durationMs: z.number().finite().nonnegative().optional(),
  correct: z.boolean(), completion: z.enum(['view-ready', 'missing']), failure: z.string().max(128).optional() });
const recordSchema = z.object({ file: z.string().regex(/^trial-[0-9]+\.json$/), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive().max(PERFORMANCE_TRIAL_BYTES), sample: sampleSchema });
const indexSchema = z.object({ format: z.literal(2), status: z.enum(['incomplete', 'passed', 'failed']),
  measured: z.number().int().min(1).max(100), records: z.array(recordSchema).max(105),
  invocations: z.array(z.object({ phase: z.string().max(32), index: z.number().int().nonnegative().optional(), exitCode: z.number().int().nullable(), signal: z.string().max(32).nullable() })).max(106).optional(),
  summary: z.unknown() });
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function read(file: string, maximum: number) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size > maximum) throw Error(`Invalid or oversized performance report: ${file}`);
  const data = readFileSync(file);
  if (data.byteLength !== stat.size || data.byteLength > maximum) throw Error('Performance report changed during admission');
  return data;
}
function sample(trial: PerformanceTrial) { return sampleSchema.parse(trial); }

/** Immutable raw trials and per-trial viewer exports, with only scalar samples retained in memory. */
export function createPerformanceRunStore(directory: string, manifestInput: unknown, measured: number) {
  const manifest = manifestSchema.parse(manifestInput);
  if (!Number.isSafeInteger(measured) || measured < 1 || measured > 100 || manifest.warmups !== 5) throw Error('Invalid qualification trial count');
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  const records: z.infer<typeof recordSchema>[] = [];
  let bytes = 0;
  let scenario: PerformanceTrial['scenario'] | undefined;
  let exportFailed = false;
  let exportPending = false;
  function save(invocations?: readonly PerformanceInvocation[]) {
    const lifecycleFailed = invocations?.some(item => item.exitCode !== 0) ?? false;
    const complete = records.length === manifest.warmups + measured;
    const failed = exportFailed || records.some(record => record.sample.outcome !== 'passed') || lifecycleFailed;
    const lifecycleComplete = scenario !== 'populated-startup' || invocations?.length === measured + 6;
    const summary = summarize(records.map(record => record.sample));
    const result = indexSchema.parse({ format: 2, measured, records, summary, invocations,
      status: failed ? 'failed' : complete && !exportPending && lifecycleComplete ? 'passed' : 'incomplete' });
    const encoded = JSON.stringify(result, null, 2);
    if (Buffer.byteLength(encoded) > INDEX_BYTES) throw Error('Performance index exceeds budget');
    const temporary = path.join(directory, 'results.json.tmp');
    writeFileSync(temporary, encoded);
    renameSync(temporary, path.join(directory, 'results.json'));
  }
  save();
  return {
    save,
    append(input: unknown) {
      const trial = trialSchema.parse(input);
      if (trial.index !== records.length || trial.index >= measured + manifest.warmups || trial.warmup !== (trial.index < manifest.warmups)
        || scenario && trial.scenario !== scenario) throw Error('Invalid trial order, scenario or warmup classification');
      scenario = trial.scenario;
      const processes = Object.keys(trial.processes);
      if (processes.length > 3 || processes.some(name => !['driver', 'backend', 'renderer'].includes(name))) throw Error('Unexpected performance process');
      const encoded = JSON.stringify(trial);
      const size = Buffer.byteLength(encoded);
      if (size > PERFORMANCE_TRIAL_BYTES || bytes + size > PERFORMANCE_RUN_BYTES) throw Error('Performance report exceeds retention budget');
      const file = `trial-${trial.index}.json`;
      writeFileSync(path.join(directory, file), encoded, { flag: 'wx' });
      bytes += size;
      records.push({ file, bytes: size, sha256: hash(encoded), sample: sample(trial) });
      exportPending = true;
      // Publish the raw evidence first. A failed viewer export must never erase the trial.
      save();
      try {
        const trace = JSON.stringify(chromeTrace(Object.entries(trial.processes).map(([process, report]) => ({ process, report }))));
        // Viewer copies have an independent bound; the run budget includes every generated copy.
        const exports: Array<[string, string]> = [[`trial-${trial.index}.trace.json`, trace]];
        for (const [process, report] of Object.entries(trial.processes)) {
          if (report.profiles?.cpu) exports.push([`trial-${trial.index}.${process}.cpuprofile`, report.profiles.cpu]);
          if (report.profiles?.allocation) exports.push([`trial-${trial.index}.${process}.heapprofile`, report.profiles.allocation]);
        }
        for (const [name, value] of exports) {
          const size = Buffer.byteLength(value);
          if (size > PERFORMANCE_TRIAL_BYTES || bytes + size > PERFORMANCE_RUN_BYTES) throw Error('Performance viewer exports exceed retention budget');
          writeFileSync(path.join(directory, name), value, { flag: 'wx' }); bytes += size;
        }
        exportPending = false;
        save();
      } catch (error) { exportFailed = true; save(); throw error; }
      return sample(trial);
    },
  };
}

/** Admit one raw trial at a time, verifying the compact index against immutable bytes and provenance. */
export function readPerformanceRun(directory: string, measured = 20) {
  const index = indexSchema.parse(JSON.parse(read(path.join(directory, 'results.json'), INDEX_BYTES).toString()));
  const manifest = manifestSchema.parse(JSON.parse(read(path.join(directory, 'manifest.json'), INDEX_BYTES).toString()));
  if (index.measured !== measured || manifest.warmups !== 5 || index.status !== 'passed'
    || index.records.length !== measured + manifest.warmups) throw Error('Incomplete performance run');
  let bytes = 0;
  let scenario: PerformanceTrial['scenario'] | undefined;
  for (const [position, record] of index.records.entries()) {
    if (record.file !== `trial-${position}.json`) throw Error('Invalid trial file order');
    bytes += record.bytes;
    if (bytes > PERFORMANCE_RUN_BYTES) throw Error('Performance run exceeds admission budget');
    const encoded = read(path.join(directory, record.file), PERFORMANCE_TRIAL_BYTES);
    if (encoded.byteLength !== record.bytes || hash(encoded) !== record.sha256) throw Error('Trial digest or size mismatch');
    const trial = trialSchema.parse(JSON.parse(encoded.toString()));
    if (!isDeepStrictEqual(record.sample, sample(trial))) throw Error('Index differs from raw trial');
    if (trial.index !== position || trial.warmup !== (position < manifest.warmups) || trial.outcome !== 'passed'
      || scenario && trial.scenario !== scenario) throw Error('Invalid or unsuccessful trial');
    scenario = trial.scenario;
    if (scenario === 'populated-startup') {
      const own = path.join(directory, `trial-${position}`);
      const ownManifest = JSON.parse(read(path.join(own, 'manifest.json'), INDEX_BYTES).toString());
      const ownResult = JSON.parse(read(path.join(own, 'results.json'), PERFORMANCE_TRIAL_BYTES).toString()) as { trials?: unknown };
      if (!isDeepStrictEqual(ownManifest, manifest) || !isDeepStrictEqual(ownResult.trials, [trial])) throw Error('Startup trial provenance or raw evidence differs');
    }
    const required = scenario === 'populated-startup' ? ['driver', 'renderer', 'backend'] : ['renderer', 'backend'];
    if (Object.keys(trial.processes).length !== required.length || required.some(name => !trial.processes[name])
      || Object.values(trial.processes).some(report => report.mode !== manifest.mode)) throw Error('Missing processes or mixed modes');
  }
  if (scenario === 'populated-startup' && (!index.invocations || index.invocations.length !== measured + 6
    || index.invocations.some((item, position) => item.exitCode !== 0 || item.signal !== null || item.phase !== (position ? 'populated-startup' : 'seed')
      || item.index !== (position ? position - 1 : undefined)))) throw Error('Incomplete startup process lifecycle');
  const summary = summarize(index.records.map(record => record.sample));
  if (!isDeepStrictEqual(summary, index.summary)) throw Error('Index summary differs from raw trials');
  return { manifest: manifest as PerformanceManifest, scenario: scenario!, samples: index.records.map(record => record.sample), summary };
}
