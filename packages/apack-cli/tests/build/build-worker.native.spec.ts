import { readPackBuildInputs, assertPackBuildInputsCurrent, PACK_BUILD_INPUTS_FILE } from '@apackdev/host/build/pack-build-inputs';
import { COMPILER_INPUTS_ENV } from '../../src/build/compiler-installation-inputs.ts';
import { buildPackArchive } from '../../src/commands/archive.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile, fork, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import { FIXTURE_DATA, FIXTURE_ENTITY, packFixture } from '@apackdev/sdk/testing/pack-fixture';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { readPackBuild } from '@apackdev/host/packs';
import { formatNodeOptions, parseNodeOptions } from '@apackdev/host/build/source-resolution';
import { cliBin } from '../../src/utils.ts';
import { _byDeadline } from '@apackdev/sdk/testing/waiting';

vi.mock('../../src/build/be-bundler', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/build/be-bundler')>(),
  bundlePackRuntime: vi.fn(() => { throw new Error('Supervisor retained its old compiler'); }),
}));
import { bundlePackRuntime } from '../../src/build/be-bundler';
import { createPackBuilder, type PackBuilder, type PackBuilderOptions, type PackBuildOptions } from '../../src/build/build-process.ts';
import { compilerStartupOptions, COMPILER_NODE_OPTIONS_ENV } from '../../src/build/compiler-startup-options.ts';
import type { BuildWatchInputs } from '../../src/build/build-watch-inputs.ts';
import { readPhaseCache } from '../../src/build/phase-cache.ts';
import { ensureCheckoutPackages } from '../../src/build/checkout-packages.ts';
import { BUILD_INPUTS_DIRECTORY_ENV, removeCompilerReadTree } from '../../src/build/compiler-read-tree.ts';
import { COMPILER_PROCESS_GROUP_ENV, stopCompilerProcessGroup } from '../../src/build/compiler-process-group.ts';
import { compilerPackageDirectory } from '../../src/build/compiler-installation.ts';
import { compilerEnvironmentIdentity } from '../../src/build/compiler-environment.ts';
import { shareCompilerInstallation } from '../_support/shared-compiler.ts';

const roots: string[] = [];
const sharedCompiler = shareCompilerInstallation();
const execFileAsync = promisify(execFile);

/** A process's `ps` state, or '' once it has gone (`ps` exits 1 for a pid it cannot find) */
async function processState(pid: number): Promise<string> {
  try { return (await execFileAsync('/bin/ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8', timeout: 10_000 })).stdout.trim(); }
  catch (error) { if ((error as { code?: unknown }).code !== 1) throw error; return ''; }
}
const builders: PackBuilder[] = [];
afterEach(async () => {
  for (const root of roots) {
    const record = path.join(root, '.apack/compiler-child-pid');
    if (fs.existsSync(record)) {
      try { process.kill(Number(fs.readFileSync(record, 'utf8')), 'SIGKILL'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    }
  }
  await Promise.all(builders.splice(0).map(builder => builder.close()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
});

async function buildFixture(root: string, options: PackBuildOptions & { signal: AbortSignal }, builderOptions: PackBuilderOptions = {}): Promise<void> {
  const builder = createPackBuilder(root, builderOptions);
  builders.push(builder);
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(120_000)]);
  try { await builder.build({ ...options, signal }); }
  finally { await builder.close(); }
}

function fixture(files: Record<string, string> = {}, content = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-build-worker-'));
  roots.push(root);
  packFixture({ at: root, nodeModules: path.join(REPO_ROOT, 'node_modules'),
    manifest: { id: 'fresh-worker', name: 'Fresh worker', features: {}, data: FIXTURE_DATA, content }, files });
  return root;
}

it('captures native launch identity and authored bytes before user preload changes, and dependency bytes at first read', async () => {
  vi.stubEnv('APACK_TEST_STARTUP_ENV', 'ORIGINAL');
  const root = fixture();
  fs.rmSync(path.join(root, 'node_modules'), { recursive: true, force: true });
  const dependencyDir = path.join(root, 'node_modules/owned-dependency');
  fs.mkdirSync(dependencyDir, { recursive: true });
  const metadataFile = path.join(root, 'package.json');
  const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
  fs.writeFileSync(metadataFile, JSON.stringify({ ...metadata, dependencies: { 'owned-dependency': '*' } }));
  fs.writeFileSync(path.join(dependencyDir, 'package.json'), '{"name":"owned-dependency","main":"index.cjs"}');
  const dependencyFile = path.join(dependencyDir, 'index.cjs');
  const dependencySource = `module.exports = 'DEPENDENCY_ORIGINAL';`;
  fs.writeFileSync(dependencyFile, dependencySource);
  const workspace = path.join(root, '.apack/native-inputs');
  fs.mkdirSync(workspace, { recursive: true });
  const inputsFile = path.join(workspace, 'compiler-inputs.json');
  fs.writeFileSync(inputsFile, JSON.stringify({ hash: '0'.repeat(64), packages: [root], paths: [] }));
  const valueFile = path.join(root, 'value.txt');
  fs.writeFileSync(valueFile, 'ORIGINAL');
  const preload = path.join(root, 'preload.cjs');
  fs.writeFileSync(preload, `process.env.NODE_OPTIONS = ''; process.execArgv.splice(0); process.env.APACK_TEST_STARTUP_ENV = 'CHANGED';
    if (Object.keys(require.cache).some(file => /typescript[\\/]lib/.test(file))) throw new Error('Compiler activated before preload');
    require('node:fs').writeFileSync(${JSON.stringify(valueFile)}, 'CHANGED');
    require('node:fs').writeFileSync(${JSON.stringify(dependencyFile)}, "module.exports = 'DEPENDENCY_CHANGED';");`);
  const entry = path.join(root, 'entry.cjs');
  fs.writeFileSync(entry, `const startup = globalThis[Symbol.for('apack.compiler.startup')];
    const identity = startup.executionIdentity;
    const fs = require('node:fs');
    const value = fs.readFileSync(${JSON.stringify(valueFile)}, 'utf8');
    const dependency = require('owned-dependency');
    let refusal;
    try { startup.view.assertCurrent(); } catch (error) { refusal = error.message; }
    fs.writeFileSync(${JSON.stringify(valueFile)}, 'ORIGINAL');
    startup.view.assertCurrent();
    startup.stopReads(); startup.view.dispose();
    process.send({ identity, value, dependency, refusal }, () => process.exit(0));`);
  const options = compilerStartupOptions(path.join(compilerPackageDirectory(), 'bin/apack.mjs'), formatNodeOptions(['--require', preload]));
  const child = fork(entry, [], { cwd: root, execArgv: ['--conditions=launch-probe'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: { ...process.env, APACK_BUILD_WORKER: '1', [COMPILER_INPUTS_ENV]: inputsFile,
      [BUILD_INPUTS_DIRECTORY_ENV]: workspace, [COMPILER_NODE_OPTIONS_ENV]: options.user, NODE_OPTIONS: options.worker } });
  let result: unknown, errors = '';
  child.on('message', message => { result = message; });
  child.stderr!.on('data', chunk => { errors += chunk; });
  const closed = finished(child);
  try {
    expect(await _byDeadline(closed, 'native launch identity', 2_000), errors).toBe(0);
    // The dependency was first read after the preload changed it, so its changed bytes are the input
    expect(result).toMatchObject({ value: 'ORIGINAL', dependency: 'DEPENDENCY_CHANGED', refusal: expect.stringContaining('Compiler resolution namespace changed') });
    const identity = (result as { identity: string }).identity;
    const execution = JSON.parse(identity);
    expect(execution[3]).toEqual(['--conditions=launch-probe']);
    expect(execution[4]).toEqual(['--require', preload]);
    expect(execution[5]).toBe(compilerEnvironmentIdentity());
    expect(identity).not.toContain('compiler-startup.cjs');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
    removeCompilerReadTree(workspace);
  }
});

// Includes two fresh compiler installations, builds and final input/output verification.
it('uses the captured compiler and retains unchanged build/cache identity on repeat builds', async () => {
  const started = performance.now();
  const checkpoint = (phase: string) => {
    console.info(`Repeated worker: ${phase} (${Math.round(performance.now() - started)}ms)`);
  };
  const require = createRequire(import.meta.url);
  const esbuild = createRequire(require.resolve('esbuild/package.json'));
  const binary = esbuild.resolve(`@esbuild/${process.platform}-${process.arch}/${process.platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild'}`);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-worker-executable-'));
  roots.push(outside);
  const executable = path.join(outside, path.basename(binary));
  fs.copyFileSync(binary, executable);
  vi.stubEnv('ESBUILD_BINARY_PATH', executable);
  const root = fixture({
    'src/compiler.cjs': `module.exports = () => {
      const fs = require('node:fs');
      fs.readdirSync(process.cwd(), { withFileTypes: true });
      const executable = process.env.ESBUILD_BINARY_PATH;
      if (!executable || executable === ${JSON.stringify(executable)} || !fs.existsSync(executable)
        || (fs.statSync(executable).mode & 0o222)) throw new Error('Compiler did not receive its owned executable');
      return [{entity: ${JSON.stringify(FIXTURE_ENTITY)}, name: 'Paths', source: __filename, directory: __dirname}];
    };`,
    'src/value.txt': 'OWNED',
  }, { formats: { rows: { compiler: 'src/compiler.cjs', entity: FIXTURE_ENTITY, identity: ['name'] } },
    sources: { rows: { path: 'src/value.txt', format: 'rows' } } });
  const build = async () => {
    const builder = createPackBuilder(root);
    builders.push(builder);
    try { await builder.build({ args: ['--skip-fe'] }); }
    finally { await builder.close(); }
  };
  const workspaces: string[] = [];
  const mkdtemp = fs.mkdtempSync;
  vi.spyOn(fs, 'mkdtempSync').mockImplementation(prefix => {
    const directory = mkdtemp(prefix);
    if (String(prefix).includes('apack-build-inputs-')) workspaces.push(fs.realpathSync.native(directory));
    return directory;
  });
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  await build();
  checkpoint('build completed');
  expect(bundlePackRuntime).not.toHaveBeenCalled();
  expect(readPackBuild(path.join(root, 'dist')).snapshot.manifest.id).toBe('fresh-worker');
  expect(fs.existsSync(path.join(root, 'dist/runtime/fe.js'))).toBe(false);
  const content = JSON.parse(fs.readFileSync(path.join(root, 'dist/runtime/content/rows.content.json'), 'utf8'));
  expect(fs.realpathSync.native(content.records[0].source)).toBe(path.join(fs.realpathSync.native(root), 'src/compiler.cjs'));
  expect(fs.realpathSync.native(content.records[0].directory)).toBe(path.join(fs.realpathSync.native(root), 'src'));
  const inputs = readPackBuildInputs(path.join(root, 'dist'));
  expect(inputs.options).toEqual(['--skip-fe']);
  expect(inputs.observations.length).toBeGreaterThan(0);
  expect(fs.readFileSync(path.join(root, 'dist', PACK_BUILD_INPUTS_FILE), 'utf8')).not.toContain(workspaces[0]);
  assertPackBuildInputsCurrent(root, inputs);
  checkpoint('input replay completed');
  const archived = await buildPackArchive(root);
  expect(fs.existsSync(archived.checksumFile)).toBe(true);
  checkpoint('archive completed');
  const stamp = readPhaseCache(root).stamps.types;
  const revision = readPackBuild(path.join(root, 'dist')).revision;
  expect(stamp).toBeDefined();
  await build();
  checkpoint('build completed');
  expect(readPhaseCache(root).stamps.types).toEqual(stamp);
  expect(readPackBuild(path.join(root, 'dist')).revision).toBe(revision);
  expect(workspaces).toHaveLength(2);
  for (const workspace of workspaces) expect(fs.existsSync(workspace)).toBe(false);
}, 360_000);

it('records external inputs read by content compiler worker threads', async ({ signal }) => {
  const started = performance.now();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-worker-input-'));
  roots.push(outside);
  const modes = ['terminated', 'natural', 'nested', 'background'];
  const values = modes.map(mode => path.join(outside, `${mode}.txt`));
  values.forEach((file, index) => fs.writeFileSync(file, modes[index]!));
  const root = fixture({
    'src/value.txt': 'rows',
    'src/compiler.cjs': `const {Worker} = require('node:worker_threads');
      const {once} = require('node:events');
      module.exports = async () => {
        const rows = [];
        const read = "const {parentPort, workerData} = require('node:worker_threads'); parentPort.postMessage(require('node:fs').readFileSync(workerData, 'utf8'));";
        for (const [index, mode] of ${JSON.stringify(modes)}.entries()) {
          const code = mode === 'nested'
            ? "const {Worker, parentPort, workerData} = require('node:worker_threads'); const child = new Worker(" + JSON.stringify(read) + ", {eval: true, workerData}); child.once('message', value => parentPort.postMessage(value));"
            : read + (mode === 'background' ? 'setInterval(() => {}, 1000);' : '');
          const worker = new Worker(code, {eval: true, workerData: ${JSON.stringify(values)}[index],
            ...(mode === 'natural' ? {execArgv: [], env: {WORKER_CUSTOM: 'present'}} : {})});
          const exited = once(worker, 'exit');
          try {
            const [name] = await once(worker, 'message');
            rows.push({entity: ${JSON.stringify(FIXTURE_ENTITY)}, name});
            console.info('Worker input mode completed', mode);
          } finally {
            if (mode === 'natural') await exited;
            else if (mode !== 'background') await worker.terminate();
          }
        }
        return rows;
      };`,
  }, { formats: { rows: { compiler: 'src/compiler.cjs', entity: FIXTURE_ENTITY, identity: ['name'] } },
    sources: { rows: { path: 'src/value.txt', format: 'rows' } } });
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  await buildFixture(root, { args: ['--skip-fe'], signal }, { captureCompiler: sharedCompiler.capture });
  console.info('Worker input build completed', Math.round(performance.now() - started));
  const content = JSON.parse(fs.readFileSync(path.join(root, 'dist/runtime/content/rows.content.json'), 'utf8'));
  expect(content.records.map((record: {name: string}) => record.name)).toEqual(modes);
  const inputs = readPackBuildInputs(path.join(root, 'dist'));
  assertPackBuildInputsCurrent(root, inputs);
  for (const [index, file] of values.entries()) {
    fs.writeFileSync(file, 'CHANGED_WORKER_INPUT');
    expect(() => assertPackBuildInputsCurrent(root, inputs), modes[index]).toThrow(/changed/i);
    fs.writeFileSync(file, modes[index]!);
  }
  console.info('Worker input verification completed', Math.round(performance.now() - started));
}, 120_000 + 20_000);

it('refuses publication when a compiler worker cannot return its observations', async ({ signal }) => {
  const root = fixture({
    'src/value.txt': 'rows',
    'src/compiler.cjs': `const {Worker} = require('node:worker_threads');
      const {once} = require('node:events');
      module.exports = async () => {
        const worker = new Worker("require('node:worker_threads').parentPort.postMessage('started'); while (true) {}", {eval: true});
        await once(worker, 'message');
        await worker.terminate();
        return [{entity: ${JSON.stringify(FIXTURE_ENTITY)}, name: 'unverified'}];
      };`,
  }, { formats: { rows: { compiler: 'src/compiler.cjs', entity: FIXTURE_ENTITY, identity: ['name'] } },
    sources: { rows: { path: 'src/value.txt', format: 'rows' } } });
  const marker = path.join(root, 'dist', 'incumbent.txt');
  fs.mkdirSync(path.dirname(marker));
  fs.writeFileSync(marker, 'KEEP');
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  await expect(buildFixture(root, { args: ['--skip-fe'], signal }, { captureCompiler: sharedCompiler.capture })).rejects.toThrow(/Pack build process exited/);
  expect(fs.readFileSync(marker, 'utf8')).toBe('KEEP');
  expect(fs.readdirSync(path.dirname(marker))).toEqual(['incumbent.txt']);
}, 120_000 + 20_000);

it('compiles content through the captured worker and invalidates changed loader inputs', async () => {
  const root = fixture({
    'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', jsx: 'react', jsxFactory: 'h', skipLibCheck: true }, include: ['src/**/*'] }),
    'src/compiler.tsx': `import fs from 'node:fs'; const h = () => 'JSX';
      export default ({path}: {path: string}) => {
        const payload = Reflect.get(globalThis, 'apackPayloadPath') as string;
        const original = Reflect.get(globalThis, 'apackPayload') as string;
        const cachedRead = Reflect.get(globalThis, 'apackCachedRead') as typeof fs.readFileSync;
        fs.writeFileSync(payload, 'TRANSIENT');
        let value;
        try { value = cachedRead(payload, 'utf8'); } finally { fs.writeFileSync(payload, original); }
        if (value !== original) throw new Error('Cached preload read escaped its compiler frame');
        return [{entity: ${JSON.stringify(FIXTURE_ENTITY)}, name: [fs.readFileSync(path, 'utf8'), <marker />, Reflect.get(globalThis, 'apackPreloadProbe'), Reflect.get(globalThis, 'apackImportProbe'), Reflect.get(globalThis, 'apackLoaderProbe')].join(':'), source: import.meta.filename, origin: import.meta.url, requireSource: Reflect.get(globalThis, 'apackRequireSource'), importSource: Reflect.get(globalThis, 'apackImportSource')}];
      }`,
    'src/value.txt': 'OWNED',
  }, { formats: { rows: { compiler: 'src/compiler.tsx', entity: FIXTURE_ENTITY, identity: ['name'] } },
    sources: { rows: { path: 'src/value.txt', format: 'rows' } } });
  const preload = path.join(root, '.apack/pre load  file.cjs');
  const imported = path.join(root, '.apack/preload.mjs');
  const loader = path.join(root, '.apack/loader.mjs');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-worker-preload-'));
  roots.push(outside);
  const payload = path.join(outside, 'payload.txt');
  fs.writeFileSync(payload, 'LOADED');
  fs.mkdirSync(path.dirname(preload), { recursive: true });
  const trace = path.join(root, '.apack/preload-order.jsonl');
  fs.writeFileSync(trace, '');
  fs.writeFileSync(preload, `const threads = require('node:worker_threads');
  if (process.env.APACK_BUILD_WORKER === '1' || threads.getEnvironmentData('apack.compiler.thread')?.pid === process.pid) {
    if (!globalThis[Symbol.for('apack.compiler.startup')]) throw new Error('Preload has no input owner');
    if (Object.keys(require.cache).some(file => /typescript[\\/]lib/.test(file))) throw new Error('Compiler activated before preload');
  }
  if (globalThis[Symbol.for('apack.compiler.startup')]) require('node:fs').appendFileSync(${JSON.stringify(trace)}, JSON.stringify({thread: threads.threadId, internal: threads.isInternalThread, event: 'require'}) + '\\n');
  globalThis.apackCachedRead = require('node:fs').readFileSync;
  globalThis.apackPayloadPath = ${JSON.stringify(payload)}; globalThis.apackPayload = globalThis.apackCachedRead(globalThis.apackPayloadPath, 'utf8');
  globalThis.apackPreloadProbe = 'PRELOADED'; globalThis.apackRequireSource = __filename;`);
  fs.writeFileSync(path.join(root, '.apack/preload-child.mjs'), `export default 'IMPORTED';`);
  fs.writeFileSync(imported, `import value from './preload-child.mjs'; import {threadId, isInternalThread} from 'node:worker_threads';
    if (!globalThis.apackPreloadProbe) throw new Error('Preload order changed');
    if (globalThis[Symbol.for('apack.compiler.startup')]) (await import('node:fs')).appendFileSync(${JSON.stringify(trace)}, JSON.stringify({thread: threadId, internal: isInternalThread, event: 'import'}) + '\\n');
    globalThis.apackImportProbe = value; globalThis.apackImportSource = import.meta.url;`);
  fs.writeFileSync(loader, `import fs from 'node:fs'; import {threadId, isInternalThread} from 'node:worker_threads'; const marker = fs.readFileSync(${JSON.stringify(payload)}, 'utf8');
    if (globalThis[Symbol.for('apack.compiler.startup')]) fs.appendFileSync(${JSON.stringify(trace)}, JSON.stringify({thread: threadId, internal: isInternalThread, event: 'loader'}) + '\\n');
    export async function load(url, context, next) {
      const result = await next(url, context);
      return url === ${JSON.stringify(pathToFileURL(fs.realpathSync(imported)).href)}
        ? {...result, source: 'globalThis.apackLoaderProbe = ' + JSON.stringify(marker) + ';\\n' + result.source} : result;
    }`);
  vi.stubEnv('NODE_OPTIONS', formatNodeOptions([...parseNodeOptions(process.env.NODE_OPTIONS), '--require', preload, '--import', pathToFileURL(imported).href, '--experimental-loader', pathToFileURL(loader).href]));
  const builder = createPackBuilder(root, { captureCompiler: sharedCompiler.capture });
  builders.push(builder);
  await builder.build({ args: ['--skip-fe'] });

  const output = JSON.parse(fs.readFileSync(path.join(root, 'dist/runtime/content/rows.content.json'), 'utf8'));
  expect(output.records[0].name).toBe('OWNED:JSX:PRELOADED:IMPORTED:LOADED');
  expect(output.records[0].requireSource).toBe(fs.realpathSync(preload));
  expect(output.records[0].importSource).toBe(pathToFileURL(fs.realpathSync(imported)).href);
  expect(output.records[0].source).toBe(path.join(fs.realpathSync.native(root), 'src/compiler.tsx'));
  expect(output.records[0].origin).toBe(pathToFileURL(path.join(fs.realpathSync.native(root), 'src/compiler.tsx')).href + '?tsx-namespace=apack-build-1');
  const realms = new Map<number, { internal: boolean; events: string[] }>();
  for (const line of fs.readFileSync(trace, 'utf8').trim().split('\n')) {
    const entry = JSON.parse(line) as { thread: number; internal: boolean; event: string };
    const realm = realms.get(entry.thread) ?? { internal: entry.internal, events: [] };
    expect(realm.internal).toBe(entry.internal);
    realm.events.push(entry.event);
    realms.set(entry.thread, realm);
  }
  expect(realms.get(0)?.events).toEqual(['require', 'import']);
  expect([...realms.values()].some(realm => realm.internal)).toBe(true);
  for (const realm of realms.values()) expect(realm.events).toEqual(['require', realm.internal ? 'loader' : 'import']);
  const revision = readPackBuild(path.join(root, 'dist')).revision;
  fs.writeFileSync(payload, 'UPDATED');
  await builder.build({ args: ['--skip-fe'] });
  const rebuilt = JSON.parse(fs.readFileSync(path.join(root, 'dist/runtime/content/rows.content.json'), 'utf8'));
  expect(rebuilt.records[0].name).toBe('OWNED:JSX:PRELOADED:IMPORTED:UPDATED');
  expect(readPackBuild(path.join(root, 'dist')).revision).not.toBe(revision);
}, 180_000);

it('refuses publication when a loader-only external input changes during compilation', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-loader-input-'));
  roots.push(outside);
  const payload = path.join(outside, 'payload.txt');
  fs.writeFileSync(payload, 'ORIGINAL');
  const root = fixture({
    'src/compiler.cjs': `const fs = require('node:fs'); module.exports = () => {
      fs.writeFileSync(${JSON.stringify(payload)}, 'CHANGED'); return [{entity: ${JSON.stringify(FIXTURE_ENTITY)}, name: 'Changed'}];
    };`,
    'src/value.txt': 'DATA',
  }, { formats: { rows: { compiler: 'src/compiler.cjs', entity: FIXTURE_ENTITY, identity: ['name'] } },
    sources: { rows: { path: 'src/value.txt', format: 'rows' } } });
  const loader = path.join(outside, 'loader.mjs');
  fs.writeFileSync(loader, `import fs from 'node:fs'; fs.readFileSync(${JSON.stringify(payload)}, 'utf8');
    export async function load(url, context, next) { return next(url, context); }`);
  const child = spawn(process.execPath, [cliBin(), 'pack', 'build', '--skip-fe'], { cwd: root,
    env: { ...process.env, NODE_OPTIONS: formatNodeOptions([...parseNodeOptions(process.env.NODE_OPTIONS), '--experimental-loader', pathToFileURL(loader).href]) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const closed = finished(child);
  try {
    expect(await _byDeadline(closed, 'loader-input build refusal', 120_000), output).toBe(1);
    expect(output).toContain(`Compiler resolution namespace changed during discovery: ${fs.realpathSync(payload)}`);
    expect(fs.readFileSync(payload, 'utf8')).toBe('CHANGED');
    expect(fs.existsSync(path.join(root, 'dist'))).toBe(false);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await _byDeadline(closed, 'loader-input build cleanup', 20_000);
  }
}, 120_000 + 20_000);

it('terminates pack-created background work before accepting its candidate', async ({ signal }) => {
  const root = fixture({
    'src/compiler.ts': `import fs from 'node:fs'; import {spawn} from 'node:child_process';
      if (process.platform !== 'win32') {
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'});
        fs.writeFileSync('.apack/compiler-child-pid', String(child.pid));
        child.unref();
      }
      setInterval(() => {}, 1000);
      export default () => [{entity: ${JSON.stringify(FIXTURE_ENTITY)}, name: 'COMPLETE'}];`,
    'src/value.txt': 'DATA',
  }, { formats: { rows: { compiler: 'src/compiler.ts', entity: FIXTURE_ENTITY, identity: ['name'] } },
    sources: { rows: { path: 'src/value.txt', format: 'rows' } } });
  await buildFixture(root, { args: ['--skip-fe'], signal }, { captureCompiler: sharedCompiler.capture });
  const output = JSON.parse(fs.readFileSync(path.join(root, 'dist/runtime/content/rows.content.json'), 'utf8'));
  expect(output.records[0].name).toBe('COMPLETE');
  if (process.platform !== 'win32') {
    const pid = Number(fs.readFileSync(path.join(root, '.apack/compiler-child-pid'), 'utf8'));
    const state = await processState(pid);
    expect(state === '' || state.startsWith('Z'), `Compiler subprocess ${pid} is still ${state}`).toBe(true);
  }
}, 120_000 + 20_000);

it('refuses candidate output changed by a compiler exit handler and retains the incumbent', async ({ signal }) => {
  const root = fixture({
    'src/compiler.ts': `import fs from 'node:fs';
      process.on('exit', () => {
        fs.writeFileSync('.apack/exit-state', fs.existsSync('.apack/build/integrity.json') ? 'SEALED' : 'UNSEALED');
        fs.writeFileSync('.apack/build/runtime/content/rows.content.json', 'LATE EXIT WRITE');
      });
      export default () => [{entity: ${JSON.stringify(FIXTURE_ENTITY)}, name: 'COMPLETE'}];`,
    'src/value.txt': 'DATA',
  }, { formats: { rows: { compiler: 'src/compiler.ts', entity: FIXTURE_ENTITY, identity: ['name'] } },
    sources: { rows: { path: 'src/value.txt', format: 'rows' } } });
  fs.mkdirSync(path.join(root, 'dist'));
  fs.writeFileSync(path.join(root, 'dist/incumbent.txt'), 'ACCEPTED');
  const builder = createPackBuilder(root, { captureCompiler: sharedCompiler.capture });
  builders.push(builder);
  await expect(builder.build({ args: ['--skip-fe'], signal })).rejects.toThrow();
  await builder.close();
  expect(fs.readFileSync(path.join(root, '.apack/exit-state'), 'utf8')).toBe('SEALED');
  expect(fs.readFileSync(path.join(root, 'dist/incumbent.txt'), 'utf8')).toBe('ACCEPTED');
  expect(fs.readdirSync(path.join(root, 'dist'))).toEqual(['incumbent.txt']);
  expect(fs.existsSync(path.join(root, '.apack/build'))).toBe(false);
}, 180_000 + 20_000);

it('reports frontend inputs that remain available after its compiler installation is removed', async ({ signal }) => {
  const root = fixture({
    'src/pack-entry-fe.ts': 'import "./Panel.vue"; export { default } from "./__generated__/pack-entry-fe.ts";',
    'src/Panel.vue': '<script setup lang="ts">import { computed } from "vue"; const label = computed(() => "Hello");</script><template><div>{{ label }}</div></template>',
  });
  const reports: BuildWatchInputs[] = [];
  await buildFixture(root, { signal, onInputs: inputs => { reports.push(inputs); } });
  expect(reports.some(report => report.successful && report.files.some(file => file.endsWith('Panel.vue')))).toBe(true);
  // The compiler's own installation is never a pack input: nothing reported or recorded is inside the store
  const store = fs.realpathSync.native(process.env.APACK_COMPILER_STORE!);
  const inStore = (file: string) => path.resolve(fs.realpathSync(root), file).startsWith(store + path.sep);
  for (const report of reports) {
    expect([...report.files, ...report.directories, ...(report.probes?.map(([file]) => file) ?? [])]
      .filter(inStore)).toEqual([]);
    for (const file of report.files) expect(fs.existsSync(file), file).toBe(true);
  }
  const reads = JSON.parse(fs.readFileSync(path.join(root, '.apack/reads.json'), 'utf8')) as { phases: Record<string, string[]> };
  for (const file of Object.values(reads.phases).flat()) {
    expect(inStore(file), file).toBe(false);
    expect(fs.existsSync(path.resolve(fs.realpathSync(root), file)), file).toBe(true);
  }
}, 120_000 + 20_000);

function finished(child: ChildProcess, event: 'exit' | 'close' = 'close'): Promise<number | null> {
  return new Promise((resolve, reject) => { child.once('error', reject); child.once(event, resolve); });
}

it.skipIf(process.platform === 'win32')('confirms natural group shutdown when signaling is denied during exit', async () => {
  const child = spawn(process.execPath, ['-e', 'process.stdout.write("READY"); setTimeout(() => {}, 100);'], {
    detached: true, stdio: ['ignore', 'pipe', 'ignore'],
  });
  const closed = finished(child);
  const originalKill = process.kill;
  try {
    await new Promise<void>((resolve, reject) => { child.once('error', reject); child.stdout.once('data', () => resolve()); });
    const kill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === -child.pid!) throw Object.assign(new Error('signal denied'), { code: 'EPERM' });
      return originalKill(pid, signal);
    });
    await stopCompilerProcessGroup(child.pid!);
    expect(await closed).toBe(0);
    expect(kill).toHaveBeenCalledWith(-child.pid!, 'SIGKILL');
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await closed; }
});

it('terminates a compiling worker when its parent IPC disconnects without publishing', async () => {
  const root = fixture({
    'src/compiler.ts': `import fs from 'node:fs'; import {spawn} from 'node:child_process';
      export default async function() {
        if (process.platform !== 'win32') {
          const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'});
          fs.writeFileSync('.apack/compiler-child-pid', String(child.pid)); child.unref();
        }
        fs.writeFileSync('ready', 'ready'); await new Promise(() => {}); return [];
      }`,
    'src/data.ts': 'export default [];',
  }, { formats: { waiting: { compiler: 'src/compiler.ts', entity: FIXTURE_ENTITY } }, sources: { waiting: { path: 'src/data.ts', format: 'waiting' } } });
  ensureCheckoutPackages(REPO_ROOT);
  const compiler = await sharedCompiler.installation();
  const inputs = path.join(root, '.apack/compiler-inputs');
  fs.mkdirSync(inputs, { recursive: true });
  const grouped = process.platform !== 'win32';
  const nodeOptions = compilerStartupOptions(compiler.bin, process.env.NODE_OPTIONS);
  const child = fork(compiler.bin, ['pack', 'build', '--skip-fe'], { cwd: root, detached: grouped, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, [BUILD_INPUTS_DIRECTORY_ENV]: inputs, [COMPILER_PROCESS_GROUP_ENV]: grouped ? '1' : undefined, APACK_BUILD_WORKER: '1', [COMPILER_INPUTS_ENV]: compiler.inputsFile,
      [COMPILER_NODE_OPTIONS_ENV]: nodeOptions.user, NODE_OPTIONS: nodeOptions.worker } });
  // Node can omit close after a parent-initiated IPC disconnect; assert exit and drained streams.
  const stopped = finished(child, 'exit');
  let output = '';
  child.stdout?.on('data', chunk => { output += chunk; });
  child.stderr?.on('data', chunk => { output += chunk; });
  try {
    await vi.waitFor(() => expect(fs.existsSync(path.join(root, 'ready')), output).toBe(true), { timeout: 20_000 });
    child.disconnect();
    expect(await _byDeadline(stopped, 'worker exit after parent loss', 2_000)).toBe(grouped ? null : 1);
    if (grouped) {
      expect(child.signalCode).toBe('SIGKILL');
      const pid = Number(fs.readFileSync(path.join(root, '.apack/compiler-child-pid'), 'utf8'));
      await vi.waitFor(async () => {
        const state = await processState(pid);
        expect(state === '' || state.startsWith('Z')).toBe(true);
      }, { timeout: 2_000 });
    }
    await vi.waitFor(() => expect(child.stdout?.readableEnded && child.stderr?.readableEnded).toBe(true), { timeout: 2_000 });
    expect(fs.existsSync(path.join(root, 'dist'))).toBe(false);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    try { await _byDeadline(stopped, 'worker cleanup', 2_000); }
    finally { child.stdout?.destroy(); child.stderr?.destroy(); removeCompilerReadTree(inputs); }
  }
});

it('refuses private worker bootstrap without a parent IPC channel', async () => {
  const child = spawn(process.execPath, [cliBin(), 'pack', 'build'], {
    cwd: fixture(), env: { ...process.env, APACK_BUILD_WORKER: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stderr?.on('data', chunk => { output += chunk; });
  expect(await _byDeadline(finished(child), 'private bootstrap refusal', 2_000)).toBe(1);
  expect(output).toContain('Pack build worker requires its parent IPC channel');
});

it.each([
  { name: 'watch is ready', watch: true, phase: 'ready', release: false },
  { name: 'watch is compiling', watch: true, phase: 'compiling', release: false },
  { name: 'one-shot is compiling', watch: false, phase: 'compiling', release: false },
  { name: 'release verification is compiling', watch: false, phase: 'compiling', release: true },
] as const)('removes its worker when the public build command is stopped while $name', async ({ watch, phase, release }) => {
  // Shutdown removes the worker's complete file tree, unlike the IPC-only exit checks above. The compiler it ran may
  // be the machine-wide store's entry, which outlives every build by design.
  const cleanupDeadlineMs = 20_000;
  const startupDeadlineMs = phase === 'ready' ? 120_000 : 60_000;
  const root = fixture({
    'src/compiler.ts': `import fs from 'node:fs'; export default async function() {
      fs.writeFileSync('.apack/compiler-inputs-path', process.env.${COMPILER_INPUTS_ENV}!);
      fs.writeFileSync('.apack/compiler-pid', String(process.pid));
      if (fs.existsSync('hold-build')) { console.log('APACK_TEST_COMPILER_STARTED'); await new Promise(() => {}); }
      return [];
    }`,
    'src/data.ts': 'export default [];',
  }, { formats: { tags: { compiler: 'src/compiler.ts', entity: FIXTURE_ENTITY } }, sources: { tags: { path: 'src/data.ts', format: 'tags' } } });
  if (phase === 'compiling') fs.writeFileSync(path.join(root, 'hold-build'), '');
  const args = release ? ['pack', 'release', '--dry-run', '--skip-tests', '--skip-e2e'] : ['pack', 'build', ...(watch ? ['--watch'] : [])];
  const child = fork(cliBin(), args, { cwd: root, execArgv: [],
    env: { ...process.env, APACK_BUILD_WORKER: undefined, [COMPILER_INPUTS_ENV]: undefined }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = '';
  child.stderr?.on('data', chunk => { output += chunk; });
  const closed = finished(child);
  const ready = new Promise<void>((resolve, reject) => {
    child.stdout?.on('data', chunk => {
      output += chunk;
      if (phase === 'compiling' && output.includes('APACK_TEST_COMPILER_STARTED')) resolve();
    });
    child.on('message', message => { if (phase === 'ready' && (message as { type?: string }).type === 'ready') resolve(); });
    child.once('close', () => reject(new Error(`Watch stopped before ready: ${output}`)));
  });
  try {
    await _byDeadline(ready, `public watcher startup (${phase})`, startupDeadlineMs);
    const inputs = fs.readFileSync(path.join(root, '.apack/compiler-inputs-path'), 'utf8');
    const worker = Number(fs.readFileSync(path.join(root, '.apack/compiler-pid'), 'utf8'));
    expect(fs.existsSync(inputs)).toBe(true);
    const stored = fs.realpathSync.native(inputs).startsWith(fs.realpathSync.native(process.env.APACK_COMPILER_STORE!) + path.sep);
    child.kill('SIGTERM');
    await _byDeadline(closed, 'public watcher shutdown', cleanupDeadlineMs);
    expect(child.signalCode, output).toBe('SIGTERM');
    expect(fs.existsSync(inputs), inputs).toBe(stored);
    expect(() => process.kill(worker, 0)).toThrow();
    if (phase === 'compiling') expect(fs.existsSync(path.join(root, 'dist'))).toBe(false);
    if (release) expect(fs.existsSync(path.join(root, '.apack/release'))).toBe(false);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await _byDeadline(closed, 'public watcher cleanup', cleanupDeadlineMs);
  }
}, 120_000 + 20_000 + 20_000);
