// Build the candidate's pinned SQLite vector extension for the current platform.
// Stored database metadata never chooses this source, patch or executable path.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const upstream = {
  commit: '814fd8ef4d42d6567f1613a66f556c8194764d06',
  sha256: 'b341c15fe10e41a9b96981ff3a9c217ea0774b4e04932b5acf3dac1320aeceb1',
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const [directory, localSource] = process.argv.slice(2);
assert(directory, 'Usage: node native/vectors/build.mjs <new-output-directory> [pinned-source-file]');
const output = resolve(directory);
assert(!existsSync(output), 'Native output must be new');
const url = `https://raw.githubusercontent.com/sqlite/sqlite/${upstream.commit}/ext/vec1/vec1.c`;
const response = localSource ? null : await fetch(url);
if (response) assert(response.ok, `Pinned native source download refused: ${response.status}`);
const source = localSource ? readFileSync(localSource) : Buffer.from(await response.arrayBuffer());
assert.equal(sha(source), upstream.sha256, 'Pinned native source hash must match before compilation');
const patchFile = fileURLToPath(new URL('./vec1-membership.patch', import.meta.url));
const patch = readFileSync(patchFile);
// The patch digest is recorded alongside the independently pinned upstream and resulting source.
mkdirSync(output, { recursive: true, mode: 0o700 });
const file = join(output, 'vec1.c');
writeFileSync(file, source, { flag: 'wx' });
execFileSync('git', ['apply', '--no-index', '--unsafe-paths', patchFile], { cwd: output, stdio: 'inherit' });
const require = createRequire(import.meta.url), manifest = require.resolve('better-sqlite3/package.json');
const headers = join(dirname(manifest), 'deps/sqlite3');
assert(existsSync(join(headers, 'sqlite3ext.h')));
const extension = join(output, process.platform === 'win32' ? 'vec1.dll' : process.platform === 'darwin' ? 'vec1.dylib' : 'vec1.so');
const compiler = process.platform === 'win32' ? 'cl.exe' : process.platform === 'darwin' ? 'clang' : 'cc';
const args = process.platform === 'win32'
  ? ['/nologo', '/O2', '/DNDEBUG', '/LD', '/I' + headers, file, '/link', '/OUT:' + extension]
  : ['-O3', '-DNDEBUG', '-Werror=implicit-function-declaration', process.platform === 'darwin' ? '-dynamiclib' : '-shared', '-fPIC', '-I' + headers, file, '-lm', '-o', extension];
execFileSync(compiler, args, { cwd: output, stdio: 'inherit' });
writeFileSync(join(output, 'provenance.json'), JSON.stringify({
  upstream: { ...upstream, url }, patchSha256: sha(patch), sourceSha256: sha(readFileSync(file)),
  compiler, args, headersPackage: JSON.parse(readFileSync(manifest, 'utf8')).version,
  extension, extensionSha256: sha(readFileSync(extension)), node: process.version,
  platform: process.platform, arch: process.arch,
}, null, 2) + '\n');
console.log(extension);
