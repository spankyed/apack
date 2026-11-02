// Produce a pinned, synchronous graph core; database opens never compile or download anything.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const source = dirname(fileURLToPath(import.meta.url));
const output = resolve(process.argv[2] ?? '');
assert(process.argv[2] && !existsSync(output), 'Usage: graph build requires a new output directory');
assert(existsSync(join(source, 'Cargo.lock')), 'Graph dependency lockfile must be committed');
const toolchain = '1.99.1', bindgenVersion = '0.2.105';
const cache = join(source, '.temp');
mkdirSync(cache, { recursive: true }); mkdirSync(output, { recursive: true });
const run = (name, args, options = {}) => execFileSync(name, args, { cwd: source, stdio: 'inherit', ...options });
run('rustup', ['toolchain', 'install', toolchain, '--profile', 'minimal']);
run('rustup', ['target', 'add', '--toolchain', toolchain, 'wasm32-unknown-unknown']);
const tools = join(cache, 'bindgen-tools');
const bindgen = join(tools, 'bin', process.platform === 'win32' ? 'wasm-bindgen.exe' : 'wasm-bindgen');
if (!existsSync(bindgen)) run('cargo', [`+${toolchain}`, 'install', 'wasm-bindgen-cli', '--version', bindgenVersion, '--locked', '--root', tools],
  { env: { ...process.env, CARGO_TARGET_DIR: join(cache, 'bindgen-target') } });
assert.equal(execFileSync(bindgen, ['--version'], { encoding: 'utf8' }).trim(), `wasm-bindgen ${bindgenVersion}`);
const target = join(cache, 'target');
const cargoHome = resolve(process.env.CARGO_HOME ?? join(homedir(), '.cargo'));
const flags = ['--cfg', 'getrandom_backend="wasm_js"', `--remap-path-prefix=${source}=/ears-graph`,
  `--remap-path-prefix=${join(cargoHome, 'registry')}=/cargo/registry`];
run('cargo', [`+${toolchain}`, 'build', '--locked', '--release', '--target', 'wasm32-unknown-unknown'],
  { env: { ...process.env, CARGO_TARGET_DIR: target, CARGO_ENCODED_RUSTFLAGS: flags.join('\x1f') } });
run(bindgen, ['--target', 'nodejs', '--out-dir', output, '--out-name', 'ears_graph',
  join(target, 'wasm32-unknown-unknown', 'release', 'ears_graph.wasm')]);
writeFileSync(join(output, 'package.json'), JSON.stringify({ type: 'commonjs' }) + '\n');
const sha = value => createHash('sha256').update(value).digest('hex');
const inputs = ['Cargo.toml', 'Cargo.lock', '.cargo/config.toml', 'rust-toolchain.toml', 'src/lib.rs'];
const digest = createHash('sha256');
for (const file of inputs) digest.update(file + '\0').update(readFileSync(join(source, file))).update('\0');
writeFileSync(join(output, 'manifest.json'), JSON.stringify({ format: 1, leidenVersion: '0.8.1',
  toolchain, bindgenVersion, sourceSha256: digest.digest('hex'),
  loaderSha256: sha(readFileSync(join(output, 'ears_graph.js'))),
  wasmSha256: sha(readFileSync(join(output, 'ears_graph_bg.wasm'))),
}, null, 2) + '\n');
const metadata = JSON.parse(execFileSync('cargo', [`+${toolchain}`, 'metadata', '--locked', '--format-version', '1',
  '--filter-platform', 'wasm32-unknown-unknown'], { cwd: source, encoding: 'utf8' }));
const notices = [];
for (const pkg of metadata.packages.filter(pkg => pkg.source).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
  const root = dirname(pkg.manifest_path);
  const licenses = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isFile() && /^(licen[cs]e|copying|notice)/i.test(entry.name)).map(entry => entry.name).sort();
  assert(licenses.length, `Missing license text for ${pkg.name}@${pkg.version}`);
  notices.push(`${pkg.name}@${pkg.version} (${pkg.license ?? 'see license'})`,
    ...licenses.map(file => readFileSync(join(root, file), 'utf8')));
}
writeFileSync(join(output, 'LICENSES.txt'), notices.join('\n\n') + '\n');
console.log(join(output, 'manifest.json'));
