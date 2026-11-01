// Linux/x64 diagnostic only. Ordinary package production continues to use build.mjs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
const [baselineArgument, outputArgument, ...extra] = process.argv.slice(2);
assert(baselineArgument && outputArgument && extra.length === 0,
  'Usage: node native/vectors/dispatch-build.mjs <generic-build-directory> <new-diagnostic-directory>');
const baseline = resolve(baselineArgument), output = resolve(outputArgument);
assert(!existsSync(output), 'Diagnostic output must be new');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const provenance = JSON.parse(readFileSync(join(baseline, 'provenance.json'), 'utf8'));
const source = readFileSync(join(baseline, 'vec1.c'));
assert.equal(provenance.platform, 'linux'); assert.equal(provenance.arch, 'x64');
assert.equal(provenance.sourceSha256, '04043ede29b2998b2cd0e7735cc696dba2158554a0bf9036e2a77849dec0425a');
assert.equal(sha(source), provenance.sourceSha256);
assert.equal(sha(readFileSync(join(baseline, 'vec1.so'))), provenance.extensionSha256);
// Use exactly the checked patched source and upstream's own multi-object dispatch.
// AVX2 has no FMA flag: the upstream GNU/Clang branch uses separate multiply/add.
// The scalar object contains the CPU/OS admission check and the exported entry point.
const require = createRequire(import.meta.url);
const manifest = require.resolve('better-sqlite3/package.json');
assert.equal(JSON.parse(readFileSync(manifest, 'utf8')).version, provenance.headersPackage);
const headers = join(dirname(manifest), 'deps/sqlite3');
const commands = [
  ['-O3', '-DNDEBUG', '-Werror=implicit-function-declaration', '-fPIC', '-I' + headers,
    '-DVEC1SIMD=SCALAR', '-c', 'vec1.c', '-o', 'scalar.o'],
  ['-O3', '-DNDEBUG', '-Werror=implicit-function-declaration', '-fPIC', '-I' + headers,
    '-DVEC1SIMD=AVX2', '-mavx2', '-mno-fma', '-c', 'vec1.c', '-o', 'avx2.o'],
  ['-shared', 'scalar.o', 'avx2.o', '-lm', '-o', 'vec1.so'],
];
mkdirSync(output, { mode: 0o700 }); writeFileSync(join(output, 'vec1.c'), source, { flag: 'wx' });
const report = { completed: false, source: process.env.GITHUB_SHA, platform: process.platform,
  arch: process.arch, node: process.version, baseline: provenance, compiler: 'cc', commands,
  scope: 'Diagnostic upstream x64 runtime dispatch; not a promoted package or hardware-baseline qualification' };
try {
  report.compilerVersion = execFileSync('cc', ['--version'], { encoding: 'utf8' });
  for (const args of commands) execFileSync('cc', args, { cwd: output, stdio: 'inherit' });
  report.extensionSha256 = sha(readFileSync(join(output, 'vec1.so')));
  report.completed = true;
} catch (error) {
  report.failure = { message: error?.message ?? String(error), code: error?.code, status: error?.status };
  throw error;
} finally {
  writeFileSync(join(output, 'provenance.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
