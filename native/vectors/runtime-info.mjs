// Metadata-only probe of the trusted built extension; not a performance or recall benchmark.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import NativeDatabase from 'better-sqlite3';
import { resolveNativeVectorExtension } from '../../packages/apack-ears/dist/sqlite/native-extension.js';

const [output] = process.argv.slice(2); assert(output && !existsSync(output)); assert(/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? ''));
const report = { completed: false, source: process.env.GITHUB_SHA, node: process.version,
  platform: process.platform, arch: process.arch, cpuModels: [...new Set(cpus().map(cpu => cpu.model))],
  scope: 'Trusted extension runtime backend metadata only; no latency, recall or CPU-baseline qualification' };
let db, failed = false, failure;
try {
  const file = resolveNativeVectorExtension();
  report.extensionSha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
  db = new NativeDatabase(':memory:'); db.loadExtension(file);
  report.runtime = db.prepare('SELECT vec1_info() value').get().value;
  assert.equal(typeof report.runtime, 'string');
  report.simd = report.runtime.match(/\((Scalar|AVX2|NEON), /)?.[1]; assert(report.simd);
  report.sqlite = db.prepare('SELECT sqlite_version() value').get().value;
  if (process.platform === 'linux') {
    const flags = new Set((readFileSync('/proc/cpuinfo', 'utf8').match(/^flags\s*:\s*(.+)$/m)?.[1] ?? '').split(/\s+/));
    report.exposedInstructionFlags = ['avx', 'avx2', 'fma', 'sse4_2', 'xsave', 'osxsave'].filter(flag => flags.has(flag));
  }
} catch (error) { failed = true; failure = error; }
finally {
  try { db?.close(); }
  catch (cleanup) { failure = failed ? new AggregateError([failure, cleanup], 'Native metadata probe and close failed', { cause: failure }) : cleanup; failed = true; }
  report.completed = !failed;
  if (failed) report.failure = { name: failure?.name, message: failure?.message ?? String(failure), code: failure?.code };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
if (failed) throw failure;
