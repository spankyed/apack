// @slow: each case copies the selected Node runtime and a compiler into an installation and runs it
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, fork } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { COMPILER_STORE_ENTRIES, captureCompilerInstallation, compilerStoreEntries, removeCompilerStoreDirectory, removeCompilerStoreEntry, type CompilerInstallation } from '../../src/build/compiler-installation.ts';
import { isCompilerLocationPath } from '../../src/build/compiler-installation-inputs.ts';
import { cliBin } from '../../src/utils.ts';
import { _byDeadline } from '@apackdev/sdk/testing/waiting';

const roots: string[] = [];
const installations: CompilerInstallation[] = [];
const stores: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(installations.splice(0).map(installation => installation.dispose()));
  await Promise.all(stores.splice(0).map(store => removeCompilerStoreDirectory(store)));
  roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-compiler-fixture-'));
  roots.push(root);
  const write = (file: string, contents: string) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  };
  write('package.json', JSON.stringify({ name: 'compiler', type: 'module', dependencies: { helper: '*' } }));
  write('bin/apack.mjs', 'import helper from "helper"; console.log(helper);');
  write('node_modules/helper/package.json', JSON.stringify({ name: 'helper', main: 'index.cjs', dependencies: { nested: '*' } }));
  write('node_modules/helper/index.cjs', 'module.exports = require("nested");');
  write('node_modules/helper/node_modules/nested/package.json', JSON.stringify({ name: 'nested', main: 'index.cjs' }));
  write('node_modules/helper/node_modules/nested/index.cjs', 'module.exports = "captured";');
  return { root, write, async capture() {
    const installation = await captureCompilerInstallation(root);
    installations.push(installation);
    return installation;
  } };
}

function esbuildFixture() {
  const compiler = fixture();
  const require = createRequire(import.meta.url);
  const dependency = path.dirname(require.resolve('esbuild/package.json'));
  const executable = createRequire(path.join(dependency, 'package.json')).resolve(`@esbuild/${process.platform}-${process.arch}/${process.platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild'}`);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-external-esbuild-'));
  roots.push(outside);
  const file = path.join(outside, path.basename(executable));
  const bytes = fs.readFileSync(executable);
  compiler.write('package.json', JSON.stringify({ type: 'module', dependencies: { esbuild: '*' } }));
  fs.symlinkSync(dependency, path.join(compiler.root, 'node_modules/esbuild'), 'dir');
  compiler.write('bin/apack.mjs', `import {transformSync} from 'esbuild'; console.log(transformSync('let value = 1', {minify:true}).code.trim());`);
  const options = { cwd: compiler.root, env: { ESBUILD_BINARY_PATH: path.relative(compiler.root, file) } };
  const run = (installation: CompilerInstallation) => execFileSync(process.execPath, [installation.bin], {
    cwd: compiler.root, encoding: 'utf8', timeout: 2_000, env: { ...process.env, ...installation.environment },
  }).trim();
  const capture = async () => {
    const installation = await captureCompilerInstallation(compiler.root, options);
    installations.push(installation);
    return installation;
  };
  return { ...compiler, options, file, bytes, capture, run };
}

it('executes its owned runtime and refuses a damaged, aliased or missing copy', async () => {
  const compiler = fixture();
  const installation = await compiler.capture();
  expect(installation.executable).not.toBe(fs.realpathSync(process.execPath));
  expect(execFileSync(installation.executable, [installation.bin], { encoding: 'utf8', timeout: process.platform === 'win32' ? 10_000 : 5_000 }).trim()).toBe('captured');
  expect(installation.isCurrent(compiler.root)).toBe(true);
  fs.chmodSync(installation.executable, 0o755);
  fs.writeFileSync(installation.executable, 'damaged runtime');
  expect(installation.isCurrent(compiler.root)).toBe(false);
  fs.chmodSync(path.dirname(installation.executable), 0o755);
  fs.rmSync(installation.executable);
  fs.symlinkSync(process.execPath, installation.executable, 'file');
  expect(installation.isCurrent(compiler.root)).toBe(false);
  fs.rmSync(installation.executable);
  expect(installation.isCurrent(compiler.root)).toBe(false);
});

it.skipIf(process.platform === 'win32' || !!process.versions.electron)('retains runtime execution after its selected source is replaced', () => {
  const compiler = fixture();
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-selected-runtime-'));
  roots.push(runtime);
  const executable = path.join(runtime, path.basename(process.execPath));
  fs.copyFileSync(process.execPath, executable, fs.constants.COPYFILE_FICLONE);
  const script = `
    import fs from 'node:fs';
    import {execFileSync} from 'node:child_process';
    import {captureCompilerInstallation} from ${JSON.stringify(new URL('../../src/build/compiler-installation.ts', import.meta.url).href)};
    const captured = await captureCompilerInstallation(process.argv[1]);
    try {
      fs.unlinkSync(process.execPath);
      fs.writeFileSync(process.execPath, 'replaced runtime');
      console.log(JSON.stringify({
        current: captured.isCurrent(process.argv[1]),
        output: execFileSync(captured.executable, [captured.bin], {encoding:'utf8', timeout:5000}).trim(),
      }));
    } finally { await captured.dispose(); }
  `;
  const output = execFileSync(executable, ['--import', 'tsx', '--conditions=@apackdev/source', '--input-type=module', '-e', script, compiler.root], {
    encoding: 'utf8', timeout: 10_000,
  });
  expect(JSON.parse(output)).toEqual({ current: false, output: 'captured' });
});

it('owns a relative external esbuild executable and detects changed selection and bytes', async () => {
  const compiler = esbuildFixture();
  fs.writeFileSync(compiler.file, compiler.bytes, { mode: 0o755 });
  const first = await compiler.capture();
  const same = await compiler.capture();
  expect(first.hash).toBe(same.hash);
  expect(first.isCurrent(compiler.root, compiler.options)).toBe(true);
  expect(compiler.run(first)).toBe('let value=1;');
  fs.writeFileSync(compiler.file, 'CHANGED');
  expect(first.isCurrent(compiler.root, compiler.options)).toBe(false);
  const changed = await compiler.capture();
  expect(changed.hash).not.toBe(first.hash);
  fs.rmSync(compiler.file);
  expect(compiler.run(first)).toBe('let value=1;');
  fs.writeFileSync(compiler.file, compiler.bytes, { mode: 0o755 });
  expect(first.isCurrent(compiler.root, { ...compiler.options, env: {} })).toBe(false);
  expect(first.isCurrent(compiler.root, compiler.options)).toBe(true);
}, 2 * 15_000 + 5_000);

it('detects damage to its captured external esbuild executable', async () => {
  const compiler = esbuildFixture();
  fs.writeFileSync(compiler.file, compiler.bytes, { mode: 0o755 });
  const first = await compiler.capture();
  expect(first.isCurrent(compiler.root, compiler.options)).toBe(true);
  const captured = first.environment.ESBUILD_BINARY_PATH!;
  fs.chmodSync(captured, 0o755);
  fs.writeFileSync(captured, 'DAMAGED');
  expect(first.isCurrent(compiler.root, compiler.options)).toBe(false);
  fs.chmodSync(path.dirname(captured), 0o755);
  fs.rmSync(captured);
  fs.symlinkSync(compiler.file, captured, 'file');
  expect(first.isCurrent(compiler.root, compiler.options)).toBe(false);
});

it('keeps the package-native fallback when a missing external override appears after capture', async () => {
  const compiler = esbuildFixture();
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const installation = await compiler.capture();
  expect(warning).toHaveBeenCalledWith(expect.stringContaining('Ignoring bad configuration: ESBUILD_BINARY_PATH='));
  expect(installation.isCurrent(compiler.root, compiler.options)).toBe(true);
  fs.writeFileSync(compiler.file, 'LATE INVALID EXECUTABLE', { mode: 0o755 });
  expect(compiler.run(installation)).toBe('let value=1;');
  expect(installation.isCurrent(compiler.root, compiler.options)).toBe(false);
});

it('executes captured nested dependencies after their original files are removed', async () => {
  const compiler = fixture();
  const installation = await compiler.capture();
  compiler.write('node_modules/helper/node_modules/nested/index.cjs', 'throw new Error("live compiler escaped");');
  fs.rmSync(compiler.root, { recursive: true, force: true });
  expect(execFileSync(process.execPath, [installation.bin], { encoding: 'utf8' }).trim()).toBe('captured');
  // The store entry is shared and outlives its holders; disposing one releases it without removing it
  await installation.dispose();
  expect(fs.existsSync(installation.bin)).toBe(true);
});

it.each(['executable', 'addon'] as const)('executes a captured platform %s after its source package is removed', async kind => {
  const require = createRequire(import.meta.url);
  const compiler = fixture();
  let source: string;
  let expected: string;
  let file: string;
  if (kind === 'executable') {
    const esbuild = createRequire(require.resolve('esbuild/package.json'));
    source = esbuild.resolve(`@esbuild/${process.platform}-${process.arch}/${process.platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild'}`);
    expected = require('esbuild/package.json').version;
    file = process.platform === 'win32' ? 'native.exe' : 'native';
    compiler.write('node_modules/helper/index.cjs', `module.exports = require('node:child_process').execFileSync(require('node:path').join(__dirname, '${file}'), ['--version'], {encoding: 'utf8'}).trim();`);
  } else {
    require('rollup/parseAst');
    const addon = Object.keys(require.cache).find(file => file.endsWith('.node') && path.basename(file).startsWith('rollup.'));
    if (!addon) throw new Error('Rollup did not load its platform addon');
    source = addon;
    expected = 'function';
    file = 'native.node';
    compiler.write('node_modules/helper/index.cjs', `module.exports = typeof require('./native.node').parse;`);
  }
  fs.copyFileSync(source, path.join(compiler.root, 'node_modules/helper', file));
  const installation = await compiler.capture();
  fs.rmSync(compiler.root, { recursive: true, force: true });
  expect(execFileSync(process.execPath, [installation.bin], { encoding: 'utf8' }).trim()).toBe(expected);
});

it('preserves workspace links, file-link module resolution, cycles and executable permissions', async () => {
  const compiler = fixture();
  compiler.write('workspace/package.json', JSON.stringify({ name: 'helper', main: 'entry.cjs', dependencies: { compiler: '*' } }));
  compiler.write('workspace/actual/index.cjs', 'module.exports = require("./value.cjs");');
  compiler.write('workspace/actual/value.cjs', 'module.exports = "linked";');
  fs.symlinkSync('actual/index.cjs', path.join(compiler.root, 'workspace/entry.cjs'));
  fs.rmSync(path.join(compiler.root, 'node_modules/helper'), { recursive: true });
  fs.symlinkSync('../workspace', path.join(compiler.root, 'node_modules/helper'), 'dir');
  fs.symlinkSync(compiler.root, path.join(compiler.root, 'node_modules/compiler'), 'dir');
  fs.renameSync(path.join(compiler.root, 'package.json'), path.join(compiler.root, 'metadata.json'));
  fs.symlinkSync('metadata.json', path.join(compiler.root, 'package.json'));
  fs.chmodSync(path.join(compiler.root, 'workspace/actual/index.cjs'), 0o755);
  const executable = fs.statSync(path.join(compiler.root, 'workspace/actual/index.cjs')).mode & 0o111;
  const installation = await compiler.capture();
  fs.rmSync(compiler.root, { recursive: true, force: true });
  expect(execFileSync(process.execPath, [installation.bin], { encoding: 'utf8' }).trim()).toBe('linked');
  const helper = fs.realpathSync(path.join(path.dirname(path.dirname(installation.bin)), 'node_modules/helper'));
  expect(fs.statSync(path.join(helper, 'entry.cjs')).mode & 0o111).toBe(executable);
  expect(fs.statSync(path.join(helper, 'entry.cjs')).mode & 0o222).toBe(0);
});

/**
 * One input, one installation: a second capture reuses the store's entry, so its executables keep one path —
 * which is what lets macOS assess them once rather than per build. New bytes get a new entry, and the old one
 * stays usable by whoever holds it.
 */
it('shares one installation per input and gives changed bytes their own', async () => {
  const compiler = fixture();
  const first = await compiler.capture();
  const second = await compiler.capture();
  expect(second.hash).toBe(first.hash);
  expect(second.bin).toBe(first.bin);
  expect(second.executable).toBe(first.executable);
  compiler.write('node_modules/helper/node_modules/nested/index.cjs', 'module.exports = "new compiler";');
  const changed = await compiler.capture();
  expect(changed.hash).not.toBe(first.hash);
  expect(changed.bin).not.toBe(first.bin);
  expect(execFileSync(process.execPath, [first.bin], { encoding: 'utf8' }).trim()).toBe('captured');
  expect(execFileSync(process.execPath, [changed.bin], { encoding: 'utf8' }).trim()).toBe('new compiler');
});

it('preserves a dangling package link without reading outside the captured installation', async () => {
  const compiler = fixture();
  fs.symlinkSync('not-installed.cjs', path.join(compiler.root, 'node_modules/helper/optional.cjs'));
  const installation = await compiler.capture();
  const link = path.join(path.dirname(path.dirname(installation.bin)), 'node_modules/helper/optional.cjs');
  expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  expect(fs.existsSync(link)).toBe(false);
});

it('captures dependencies resolved through NODE_PATH and executes without their live global directory', async () => {
  const compiler = fixture();
  const global = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-global-dependency-'));
  roots.push(global);
  fs.renameSync(path.join(compiler.root, 'node_modules/helper'), path.join(global, 'helper'));
  const script = `
    import fs from 'node:fs';
    import {execFileSync} from 'node:child_process';
    import {captureCompilerInstallation} from ${JSON.stringify(new URL('../../src/build/compiler-installation.ts', import.meta.url).href)};
    const captured = await captureCompilerInstallation(process.argv[1]);
    try {
      fs.rmSync(process.argv[2], {recursive: true, force: true});
      console.log(execFileSync(process.execPath, [captured.bin], {encoding: 'utf8', env: {...process.env, NODE_PATH: ''}}).trim());
    } finally { await captured.dispose(); }
  `;
  expect(execFileSync(process.execPath, ['--import', 'tsx', '--conditions=@apackdev/source', '--input-type=module', '-e', script, compiler.root, global], {
    encoding: 'utf8', env: { ...process.env, NODE_PATH: global },
  }).trim()).toBe('captured');
});

/** An interrupted capture leaves no entry behind, and nothing a later reuse could mistake for a whole one */
it('removes an incomplete installation when capture fails', async () => {
  const compiler = fixture();
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-compiler-store-'));
  roots.push(store);
  vi.stubEnv('APACK_COMPILER_STORE', store);
  vi.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw new Error('capture write failed'); });
  await expect(compiler.capture()).rejects.toThrow('capture write failed');
  expect(compilerStoreEntries(store)).toEqual([]);
});

/** A store of this case's own, resolved as the store resolves its root, and removed with its read-only entries */
function temporaryStore(): string {
  const store = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-compiler-store-')));
  stores.push(store);
  vi.stubEnv('APACK_COMPILER_STORE', store);
  return store;
}

/** A checkout makes a new entry per compiler rebuild; the store keeps the most recently used ones */
it('keeps the most recently used entries when a capture grows the store past its size', async () => {
  const store = temporaryStore();
  const captured: string[] = [];
  for (let version = 0; version <= COMPILER_STORE_ENTRIES; version++) {
    const compiler = fixture();
    compiler.write('version.txt', String(version));
    const installation = await compiler.capture();
    captured.push(path.dirname(installation.inputsFile));
    await installation.dispose();
  }
  expect(compilerStoreEntries(store).sort()).toEqual(captured.slice(1).sort());
});

/** An entry a live process holds survives pruning however old it is, and goes once released */
it('never removes an entry a live process is using', async () => {
  const store = temporaryStore();
  const held = await fixture().capture();
  const heldEntry = path.dirname(held.inputsFile);
  for (let version = 1; version <= COMPILER_STORE_ENTRIES; version++) {
    const compiler = fixture();
    compiler.write('version.txt', String(version));
    await (await compiler.capture()).dispose();
  }
  expect(compilerStoreEntries(store)).toContain(heldEntry);
  expect(execFileSync(process.execPath, [held.bin], { encoding: 'utf8' }).trim()).toBe('captured');
  await held.dispose();
  expect(await removeCompilerStoreEntry(heldEntry)).toBe(true);
  expect(compilerStoreEntries(store)).not.toContain(heldEntry);
});

/** A damaged entry is never reused: the next capture finds it differs and captures it again */
it('captures a damaged entry again rather than reusing it', async () => {
  const compiler = fixture();
  const first = await compiler.capture();
  const nested = path.join(path.dirname(path.dirname(first.bin)), 'node_modules/helper/node_modules/nested/index.cjs');
  fs.chmodSync(path.dirname(nested), 0o755);
  fs.chmodSync(nested, 0o644);
  fs.writeFileSync(nested, 'module.exports = "damaged";');
  const second = await compiler.capture();
  expect(second.bin).toBe(first.bin);
  expect(execFileSync(process.execPath, [second.bin], { encoding: 'utf8' }).trim()).toBe('captured');
});

it('refuses captured bytes that differ from the captured package graph', async () => {
  const compiler = fixture();
  const write = fs.writeFileSync;
  vi.spyOn(fs, 'writeFileSync').mockImplementation((file, bytes, options) => {
    write(file, bytes, options);
    if (typeof file === 'string' && file.endsWith(path.join('nested', 'index.cjs'))) {
      fs.chmodSync(file, 0o644);
      write(file, 'module.exports = "corrupted copy";');
    }
  });
  await expect(compiler.capture()).rejects.toThrow('Captured compiler installation differs from its inputs');
});

it('keeps an owned worker in its captured compiler instead of handing off to the project CLI', async () => {
  const compiler = fixture();
  compiler.write('package.json', JSON.stringify({ name: '@apackdev/cli', type: 'module', dependencies: { tsx: '*' } }));
  compiler.write('bin/apack.mjs', fs.readFileSync(cliBin(), 'utf8'));
  compiler.write('dist/cli.js', 'throw new Error("Public dispatcher must not run");');
  compiler.write('dist/build-worker.js', 'process.send({ compiled: true }); process.disconnect();');
  compiler.write('node_modules/tsx/package.json', JSON.stringify({ name: 'tsx', type: 'module', exports: { './esm/api': './api.mjs' } }));
  compiler.write('node_modules/tsx/api.mjs', 'export function register() {}');
  compiler.write('project/package.json', '{"name":"pack"}');
  compiler.write('project/node_modules/@apackdev/cli/package.json', '{"name":"@apackdev/cli","type":"module"}');
  compiler.write('project/node_modules/@apackdev/cli/bin/apack.mjs', 'throw new Error("Escaped to the project compiler");');
  const installation = await compiler.capture();
  const child = fork(installation.bin, ['pack', 'build'], {
    cwd: path.join(compiler.root, 'project'), env: { ...process.env, APACK_BUILD_WORKER: '1' }, execArgv: [],
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const messages: unknown[] = [];
  let errors = '';
  child.on('message', message => messages.push(message));
  child.stderr!.on('data', chunk => { errors += chunk; });
  const closed = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  try {
    expect(await _byDeadline(closed, 'captured compiler worker', 2_000), errors).toBe(0);
    expect(messages).toEqual([{ compiled: true }]);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await _byDeadline(closed, 'captured compiler cleanup', 2_000);
  }
});

it('treats lookups along the installation\'s location as the compiler\'s, and the pack\'s own as inputs', () => {
  const home = path.join(path.parse(process.cwd()).root, 'home', 'author');
  const installation = path.join(home, 'Library', 'Caches', 'apack-cli', 'compilers', '0123456789abcdef');
  const pack = path.join(home, 'projects', 'pack');
  const located = (file: string) => isCompilerLocationPath(file, installation, pack);

  expect(located(path.join(home, 'Library', 'Caches', 'apack-cli'))).toBe(true);
  expect(located(path.join(home, 'Library', 'Caches', 'apack-cli', 'node_modules'))).toBe(true);
  expect(located(path.join(home, 'Library', 'Caches', 'package.json'))).toBe(true);
  // The pack's own walk upward reaches the same home directory, and what it finds there is an input
  expect(located(home)).toBe(false);
  expect(located(path.join(home, 'node_modules'))).toBe(false);
  expect(located(path.join(pack, 'src', 'index.ts'))).toBe(false);
  expect(located(path.join(home, 'projects', 'package.json'))).toBe(false);
});
