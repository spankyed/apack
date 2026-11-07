import { FIXTURE_ENTITY } from '@apackdev/sdk/testing/pack-fixture';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nativeAddonSource } from './native-addon.ts';
import { execFileWhileWorking } from '@apackdev/host/build/process-progress';

const execFileAsync = execFileWhileWorking;
const COMPILE_MS = 60_000;

// The fixtures the native-library proofs share: a pack beside a compiled addon whose library is placed by `mode`,
// and the loads that run it inside and outside a captured compiler.
export async function nativeFixture(mode: 'relative' | 'absolute' | 'transitive' | 'fallback' | 'framework' | 'runpath', sdk?: string) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-native-libraries-')));
  try {
    const pack = path.join(root, 'pack');
    const native = path.join(root, 'native-package');
    const macho = process.platform === 'darwin';
    const library = path.join(native, mode === 'framework' ? 'Value.framework/Versions/A/Value' : `lib/libvalue.${macho ? 'dylib' : 'so'}`);
    fs.mkdirSync(pack);
    fs.mkdirSync(path.dirname(library), { recursive: true });
    fs.mkdirSync(path.join(native, 'binding'));
    fs.writeFileSync(path.join(native, 'package.json'), JSON.stringify({ name: 'native-fixture', version: '1.0.0', main: 'binding/addon.node' }));
    const marker = path.join(root, 'initialized');
    const outside = path.join(root, `outside/liboutside.${macho ? 'dylib' : 'so'}`);
    const architecture = macho ? ['-arch', process.arch === 'arm64' ? 'arm64' : 'x86_64'] : ['-fPIC'];
    async function buildLibrary(file: string, source: string, installName: string, dependencies: string[] = []) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const input = file + '.c';
      fs.writeFileSync(input, source);
      await execFileAsync(macho ? 'clang' : 'cc', [...architecture, macho ? '-dynamiclib' : '-shared', input, ...dependencies,
        (macho ? '-Wl,-install_name,' : '-Wl,-soname,') + installName, '-o', file], { timeout: COMPILE_MS });
    }
    if (mode === 'transitive') await buildLibrary(outside, 'int outside_value(void) { return 11; }', outside);
    await buildLibrary(library, mode === 'transitive'
      ? 'extern int outside_value(void); int native_value(void) { return outside_value(); }'
      : 'int native_value(void) { return 11; }',
    mode === 'absolute' ? library : mode === 'fallback' || mode === 'runpath' ? path.basename(library)
      : (macho ? '@loader_path/../' : '$ORIGIN/../') + path.relative(native, library), mode === 'transitive' ? [outside] : []);
    const addonSource = path.join(native, 'binding/addon.c');
    fs.writeFileSync(addonSource, nativeAddonSource(marker));
    await execFileAsync(macho ? 'clang' : 'cc', [...architecture, ...(macho ? ['-bundle', '-undefined', 'dynamic_lookup'] : ['-shared']),
      '-I', path.resolve(path.dirname(process.execPath), '../include/node'), addonSource, library,
      ...(mode === 'runpath' ? ['-Wl,-rpath,$ORIGIN/../lib'] : []),
      ...(sdk ? ['-mmacosx-version-min=11.0', `-Wl,-platform_version,macos,11.0,${sdk}`] : []),
      '-o', path.join(native, 'binding/addon.node')], { timeout: COMPILE_MS });
    fs.writeFileSync(path.join(pack, 'package.json'), '{"type":"commonjs"}');
    fs.writeFileSync(path.join(pack, 'tsconfig.json'), '{"compilerOptions":{"noLib":true,"types":[]}}');
    if (mode === 'absolute' || mode === 'transitive') {
      fs.writeFileSync(path.join(native, 'package.json'), JSON.stringify({ name: 'native-fixture', version: '1.0.0', main: 'binding/addon.node', exports: './fallback.cjs' }));
      fs.writeFileSync(path.join(native, 'fallback.cjs'), 'module.exports = "JS_FALLBACK";');
      fs.mkdirSync(path.join(pack, 'node_modules'));
      fs.symlinkSync(native, path.join(pack, 'node_modules/native-fixture'), 'dir');
      fs.writeFileSync(path.join(pack, 'fallback.cjs'), 'module.exports = require("native-fixture");');
    }
    const entry = path.join(pack, 'compiler.cjs');
    // Extensionless file resolution must capture the selected native image's package too.
    fs.writeFileSync(entry, "module.exports = require('../native-package/binding/addon');");
    return { root, pack, native, library, marker, outside, entry, buildLibrary };
  } catch (error) { fs.rmSync(root, { recursive: true, force: true }); throw error; }
}

export type NativeFixture = Awaited<ReturnType<typeof nativeFixture>>;

export async function ordinaryNativeLoad(fixture: NativeFixture, env: NodeJS.ProcessEnv) {
  return JSON.parse((await execFileAsync(process.execPath, ['-e', `const addon = require(${JSON.stringify(path.join(fixture.native, 'binding/addon.node'))});
console.log(JSON.stringify({ value: addon.read(), libraries: process.report.getReport().sharedObjects.map(file => require('node:path').normalize(file)) }));`], {
    encoding: 'utf8', env, timeout: 10_000,
  })).stdout) as { value: number; libraries: string[] };
}

export function nativeLoad(fixture: NativeFixture, proof: string) {
  return `const addon = require(${JSON.stringify(path.join(fixture.native, 'binding/addon.node'))});
require('node:fs').appendFileSync(${JSON.stringify(proof)}, JSON.stringify({ thread: require('node:worker_threads').threadId, value: addon.read(), libraries: process.report.getReport().sharedObjects }) + '\\n');`;
}

export function nativeWorkerCompiler(load: string) {
  return `import { Worker } from 'node:worker_threads';
export default () => new Promise((resolve, reject) => {
  const worker = new Worker(${JSON.stringify(`if (!globalThis[Symbol.for('apack.compiler.startup')]) throw new Error('Native worker has no input owner');
${load}
require('node:worker_threads').parentPort.postMessage('NATIVE');`)}, { eval: true });
  worker.once('message', name => resolve([{ entity: ${JSON.stringify(FIXTURE_ENTITY)}, name }]));
  worker.once('error', reject);
  worker.once('exit', code => { if (code) reject(new Error('Native compiler worker exited with code ' + code)); });
});`;
}
