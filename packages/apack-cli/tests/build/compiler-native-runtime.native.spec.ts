import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { expect, it, onTestFinished } from 'vitest';
import { ManifestSchema } from '@apackdev/sdk/build';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { readPackBuild } from '@apackdev/host/packs';
import { formatNodeOptions } from '@apackdev/host/build/source-resolution';
import { compilerPackageDirectory } from '../../src/build/compiler-installation.ts';
import { assertCapturedMachOLibraries, captureMachOLibraryEnvironment } from '../../src/build/compiler-native-libraries.ts';
import { spawnCompilerWorker } from '../../src/build/compiler-process.ts';
import { readCompilerRuntimeInputs } from '../../src/build/compiler-runtime.ts';
import { nativeFixture } from '../_support/native-libraries.ts';
import { cpuBudget } from '@apackdev/testing/vitest';
import { describeRefusal, execFileWhileWorking, processWork, watchWork } from '@apackdev/sdk/progress';

// The native-library proofs are split by subject so the native half's shards can spread them; this one is
// the captured Electron runtime, runtime-linked Mach-O libraries and default-fallback lookup.

const execFileAsync = execFileWhileWorking;

const electronRuntimes: Array<[string, string | undefined]> = [['captured', undefined]];
if (process.env.APACK_TEST_SIGNED_ELECTRON) electronRuntimes.push(['strictly signed captured', process.env.APACK_TEST_SIGNED_ELECTRON]);

it.runIf(process.platform === 'darwin').each(electronRuntimes)('uses the %s Electron runtime through the shared compiler launcher', { meta: cpuBudget(2 * 60_000) }, async (_label, executable) => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-electron-runtime-')));
  try {
    const require = createRequire(import.meta.url);
    const electron = executable ?? (require('electron') as string);
    const version = (require('electron/package.json') as { version: string }).version;
    const compiler = path.join(root, 'compiler');
    fs.mkdirSync(path.join(compiler, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(compiler, 'package.json'), JSON.stringify({ name: 'runtime-control', version: '1.0.0', type: 'module' }));
    fs.writeFileSync(path.join(compiler, 'bin/apack.mjs'), 'console.log(JSON.stringify({electron:process.versions.electron,executable:process.execPath}));');
    const driver = path.join(root, 'driver.mjs');
    fs.writeFileSync(driver, `import fs from 'node:fs';
import path from 'node:path';
const started = Date.now();
const phase = name => console.error('[electron runtime]', name, Date.now() - started);
console.error('[electron runtime] ordinary bootstrap', JSON.stringify({electron:process.versions.electron,report:typeof process.report?.getReport}));
const {captureCompilerInstallation} = await import(${JSON.stringify(new URL('../../src/build/compiler-installation.ts', import.meta.url).href)});
const {spawnCompilerWorker} = await import(${JSON.stringify(new URL('../../src/build/compiler-process.ts', import.meta.url).href)});
phase('capture');
const installation = await captureCompilerInstallation(${JSON.stringify(compiler)}, {signal:AbortSignal.timeout(60000)});
phase('captured');
let output;
try {
  if (process.env.APACK_TEST_SIGNED_ELECTRON) {
    const {execFile} = await import('node:child_process');
    const {promisify} = await import('node:util');
    await promisify(execFile)('codesign', ['--verify','--strict','--verbose=4',installation.executable], {encoding:'utf8',timeout:60000})
      .catch(error => { throw new Error('Captured runtime signature failed: ' + (error.stdout ?? '') + (error.stderr ?? error.message)); });
  }
  const child = spawnCompilerWorker(installation, [installation.bin], {cwd:${JSON.stringify(compiler)},
    env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:undefined},stdio:['ignore','pipe','pipe','ipc'],signal:AbortSignal.timeout(15000)}, ${JSON.stringify(root)});
  let stdout = '', stderr = '';
  child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
  await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => code === 0 ? resolve() : reject(new Error('Captured Electron exited with ' + (signal ?? code) + ': ' + stderr)));
  });
  phase('launched');
  output = {value:JSON.parse(stdout),captured:installation.executable,current:installation.isCurrent(${JSON.stringify(compiler)})};
  phase('verified');
} finally { await installation.dispose(); }
phase('retired');
console.log(JSON.stringify({...output,stored:installation.executable.startsWith(fs.realpathSync.native(process.env.APACK_COMPILER_STORE)+path.sep)}));`);
    const stdout = await new Promise<string>((resolve, reject) => {
      execFileWhileWorking(electron, ['--import', 'tsx', '--conditions=@apackdev/source', driver], {
        // Capture, launch and verification/retirement have distinct work; the driver bounds their sum.
        cwd: REPO_ROOT, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 60_000 + 15_000 + 20_000,
      }).then(({ stdout, stderr }) => {
        if (stderr) console.error(stderr.trim());
        resolve(stdout);
      }, (error: { stderr?: string }) => {
        if (error.stderr) console.error(error.stderr.trim());
        reject(error);
      });
    });
    const result = JSON.parse(stdout) as { value: { electron: string; executable: string }; captured: string; current: boolean; stored: boolean };
    expect(result.value.electron).toBe(version);
    expect(result.value.executable).toBe(result.captured);
    expect(result.captured).not.toBe(fs.realpathSync.native(electron));
    expect(result.current).toBe(true);
    // The captured runtime is the store's shared copy, kept for the next capture rather than retired with this one
    expect(result.stored).toBe(true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

it.runIf(process.platform === 'darwin' || process.platform === 'linux').each(electronRuntimes)('builds and archives a real pack under the %s Electron runtime', { meta: cpuBudget(60_000 + 60_000 + (180_000 + 120_000) + 60_000 + 60_000) }, async (_label, executable) => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-electron-pack-')));
  const require = createRequire(import.meta.url);
  const electron = executable ?? (require('electron') as string);
  const version = (require('electron/package.json') as { version: string }).version;
  const runtimeDirectory = readCompilerRuntimeInputs(electron, true).directory;
  const proof = path.join(root, 'runtime.json');
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  const bin = path.join(compilerPackageDirectory(), 'bin/apack.mjs');
  const stop = new AbortController();
  let closed: Promise<void> = Promise.resolve(), completed = false;
  onTestFinished(async () => {
    stop.abort();
    await closed.catch(() => {});
    if (completed) fs.rmSync(root, { recursive: true, force: true });
    else console.error(`Retained Electron pack control: ${root}`);
  });
  const command = async (cwd: string, args: string[], { runtime = { executable: electron, runtimeDirectory }, timeoutMs = 60_000 } = {}) => {
    const started = Date.now();
    console.log('Electron pack phase started', args[0]);
    // A phase is ended when it stops working or spins past `timeoutMs` of CPU, never because a busy machine made
    // it slow (`watchWork`), and on the clock only where its CPU cannot be read
    const ended = new AbortController();
    const signal = AbortSignal.any([stop.signal, ended.signal]);
    const child = spawnCompilerWorker({ ...runtime, bin }, [bin, 'pack', ...args], {
      cwd, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1',
        NODE_OPTIONS: formatNodeOptions(['--conditions=@apackdev/source']) },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], signal,
    }, root);
    const watch = child.pid === undefined ? undefined : watchWork({
      work: processWork(child.pid), ceilingMs: timeoutMs, fallbackMs: timeoutMs,
      onRefused: (refusal) => ended.abort(new Error(`pack ${args[0]} ${describeRefusal(refusal)}`)),
    });
    let output = '';
    child.stdout!.on('data', bytes => { output += bytes; });
    child.stderr!.on('data', bytes => { output += bytes; });
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const abort = () => { escalation = setTimeout(() => child.kill('SIGKILL'), 2_000); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    closed = new Promise((resolve, reject) => {
      let failure: Error | undefined;
      child.once('error', error => { failure = error; });
      child.once('close', (code, received) => {
        watch?.stop();
        clearTimeout(escalation);
        signal.removeEventListener('abort', abort);
        if (failure) reject(failure);
        else if (code === 0) resolve();
        else reject(new Error(`pack ${args.join(' ')} exited ${received ?? code}: ${output}`));
      });
    });
    try { await closed; }
    catch (error) {
      console.error(`Electron pack phase failed: ${args[0]} (${Date.now() - started}ms)\n${output}`);
      throw error;
    }
    console.log('Electron pack phase completed', JSON.stringify({ phase: args[0], ms: Date.now() - started }));
  };
  const pack = path.join(root, 'electron-proof');
  await command(root, ['init', 'electron-proof']);
  const manifestFile = path.join(pack, 'apack.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.content.formats['runtime-proof'] = { compiler: 'src/runtime-proof.ts', entity: 'ElectronProof', identity: ['name'] };
  manifest.content.sources['runtime-proof'] = { path: 'src/runtime-proof.ts', format: 'runtime-proof' };
  fs.writeFileSync(manifestFile, JSON.stringify(ManifestSchema.parse(manifest)));
  fs.writeFileSync(path.join(pack, 'src/runtime-proof.ts'), `import fs from 'node:fs';
    export default () => {
      fs.writeFileSync(${JSON.stringify(proof)}, JSON.stringify({versions:process.versions,executable:process.execPath}));
      return [{entity:'ElectronProof',name:'runtime'}];
    }`);
  await command(pack, ['add', 'feature', 'sample', '--description', 'Verify Electron compilation.']);
  // This command includes both the captured backend and the cold frontend build.
  await command(pack, ['build'], { timeoutMs: 180_000 + 120_000 });
  const runtime = JSON.parse(fs.readFileSync(proof, 'utf8')) as { versions: { electron: string; node: string }; executable: string };
  expect(runtime.versions.electron).toBe(version);
  expect(runtime.executable).not.toBe(fs.realpathSync.native(electron));
  expect(runtime.executable.startsWith(fs.realpathSync.native(process.env.APACK_COMPILER_STORE!) + path.sep)).toBe(true);
  const built = readPackBuild(path.join(pack, 'dist'));
  expect(built.snapshot.manifest.id).toBe('electron-proof');
  for (const file of ['runtime/index.cjs', 'runtime/fe.js']) expect(fs.statSync(path.join(pack, 'dist', file)).size).toBeGreaterThan(0);
  fs.rmSync(proof);
  // Passive inspection uses the recorded build context, even under a different Node runtime.
  await command(pack, ['archive', '--out', path.join(root, 'archive')], {
    runtime: { executable: process.execPath, runtimeDirectory: path.dirname(process.execPath) },
  });
  expect(fs.statSync(path.join(root, 'archive/electron-proof-0.1.0.tgz')).size).toBeGreaterThan(0);
  expect(fs.existsSync(proof), 'archive must not execute the content compiler').toBe(false);
  console.log('Electron pack compilation accepted', JSON.stringify({ runtime, revision: built.revision }));
  completed = true;
// Four command bounds, followed by output verification and owned process disposal.
});

it.runIf(process.platform === 'darwin')('refuses outside runtime-linked Mach-O constructors and accepts contained runtime libraries', async () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-macho-runtime-')));
  try {
    const runtime = path.join(root, 'runtime');
    const outside = path.join(root, 'outside');
    fs.mkdirSync(runtime); fs.mkdirSync(outside);
    const marker = path.join(root, 'initialized');
    const library = path.join(outside, 'libvalue.dylib');
    const executable = path.join(runtime, 'compiler');
    fs.writeFileSync(library + '.c', `#include <stdio.h>
__attribute__((constructor)) static void initialize(void) {
  FILE *marker = fopen(${JSON.stringify(marker)}, "w"); if (marker) fclose(marker);
}
int native_value(void) { return 11; }`);
    fs.writeFileSync(executable + '.c', '#include <stdio.h>\nextern int native_value(void);\nint main(void) { printf("%d\\n", native_value()); return 0; }');
    const compile = (args: string[]) => execFileAsync('clang', args, { timeout: 15_000 });
    await compile(['-dynamiclib', library + '.c', '-Wl,-install_name,' + library, '-o', library]);
    await compile([executable + '.c', library, '-o', executable]);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('DYLD_')));
    expect((await execFileAsync(executable, [], { env, encoding: 'utf8', timeout: 5_000 })).stdout.trim()).toBe('11');
    expect(fs.existsSync(marker)).toBe(true);
    fs.rmSync(marker);
    // A minimal executable exercises the real shared launch boundary without another Node copy.
    const launch = () => spawnCompilerWorker({ executable, runtimeDirectory: runtime, bin: path.join(root, 'bin/apack.mjs') }, [],
      { cwd: root, env, stdio: 'ignore', timeout: 5_000 }, root);
    expect(launch).toThrow(library);
    expect(fs.existsSync(marker)).toBe(false);
    const contained = path.join(runtime, 'libvalue.dylib');
    await compile(['-dynamiclib', library + '.c', '-Wl,-install_name,@executable_path/libvalue.dylib', '-o', contained]);
    await compile([executable + '.c', contained, '-o', executable]);
    expect((await execFileAsync(executable, [], { env, encoding: 'utf8', timeout: 5_000 })).stdout.trim()).toBe('11');
    expect(fs.existsSync(marker)).toBe(true);
    fs.rmSync(marker);
    const child = launch();
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject); child.once('close', resolve);
    });
    expect(code).toBe(0);
    expect(fs.existsSync(marker)).toBe(true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

it.runIf(process.platform === 'darwin').each([
  ['fallback', '13.0'], ['fallback', '14.0'], ['framework', '13.0'], ['framework', '14.0'],
] as const)(
  'matches native default-fallback lookup for %s / SDK %s without touching system directories', async (mode, sdk) => {
    const fixture = await nativeFixture(mode, sdk);
    try {
      fs.rmSync(fixture.library);
      const entry = path.join(fixture.native, 'binding/addon.node');
      const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_OPTIONS' && !key.startsWith('DYLD_')));
      const fallback = mode === 'framework' ? '/Library/Frameworks/Value.framework/Versions/A/Value' : '/usr/local/lib/libvalue.dylib';
      const variable = mode === 'framework' ? 'DYLD_FALLBACK_FRAMEWORK_PATH' : 'DYLD_FALLBACK_LIBRARY_PATH';
      for (const setting of [undefined, '']) {
        const env = { ...environment, [variable]: setting };
        const actual = (await execFileAsync(process.execPath, ['-e', `try { require(${JSON.stringify(entry)}) } catch (error) { console.log(error.message) }`], {
          encoding: 'utf8', env, timeout: 60_000,
        })).stdout;
        const probes: string[] = [];
        assertCapturedMachOLibraries(entry, fixture.native, { arch: process.arch,
          environment: captureMachOLibraryEnvironment(env), realpath: file => fs.realpathSync.native(file),
          read(file) { probes.push(file); return fs.statSync(file, { throwIfNoEntry: false })?.isFile() ? fs.readFileSync(file) : undefined; },
        });
        const usesFallback = sdk === '13.0' && setting === undefined;
        expect(actual).toContain('Library not loaded:');
        expect(actual.includes(fallback)).toBe(usesFallback);
        expect(probes.includes(fallback)).toBe(usesFallback);
      }
      expect(fs.existsSync(fixture.marker)).toBe(false);
    } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
  },
);
