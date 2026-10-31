// Exercise the existing packaged-runtime probe on the two shipped non-macOS architectures.
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

assert(process.env.GITHUB_ACTIONS === 'true' && process.arch === 'x64');
assert(['linux', 'win32'].includes(process.platform));
const output = resolve(process.argv[2]);
assert(!existsSync(output), 'Refuse existing evidence');
mkdirSync(output, { recursive: true });
const app = resolve('dist/preview', process.platform === 'win32' ? 'win-unpacked' : 'linux-unpacked', 'resources/app');
const report = { source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  platform: process.platform, arch: process.arch, qualification: false,
  scope: 'Unpacked unsigned Preview native/API runtime; not renderer, installer, signature or physical power-loss qualification' };
try {
  const manifest = JSON.parse(readFileSync(join(app, 'build-manifest.json'), 'utf8'));
  assert.equal(manifest.channel, 'preview');
  report.build = manifest;
  const child = spawnSync(process.execPath, ['build/prod/smoke-native.mjs', app], {
    encoding: 'utf8', timeout: 75000, maxBuffer: 4 * 1024 * 1024,
  });
  writeFileSync(join(output, 'native.log'), (child.stdout ?? '') + (child.stderr ?? ''));
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const stdout = child.stdout;
  for (const witness of [
    'elmdb: wrote, closed, reopened and read back',
    'EARS SQLite: claimed ownership, trained a native model in a worker, queried and reopened read-only with FTS/regex',
    'node-pty: spawned a shell, which exited 0',
    '@napi-rs/keyring: binding loaded',
    'Packaged native modules: each one loads in ',
  ]) assert(stdout.includes(witness), 'Missing actual packaged witness: ' + witness);
  const record = prefix => {
    const lines = stdout.split(/\r?\n/).filter(line => line.startsWith(prefix));
    assert.equal(lines.length, 1, 'Expected one packaged provenance record: ' + prefix);
    return JSON.parse(lines[0].slice(prefix.length));
  };
  report.native = record('Packaged native provenance: ');
  report.sqlite = record('EARS SQLite provenance: ');
  assert.equal(report.sqlite.graphManifest?.leidenVersion, '0.8.1');
  assert(/^[a-f0-9]{64}$/.test(report.sqlite.graphManifest.wasmSha256));
  assert(/^[a-f0-9]{64}$/.test(report.sqlite.graphManifest.loaderSha256));
  assert.equal(report.native.platform, process.platform);
  assert.equal(report.native.arch, 'x64');
  assert(report.native.versions.electron, 'Probe must run inside the packaged Electron executable');
  assert(report.native.addons.length >= 4);
  assert(report.native.addons.every(addon => /^[a-f0-9]{64}$/.test(addon.sha256)));
  report.completed = true;
} catch (error) {
  report.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
