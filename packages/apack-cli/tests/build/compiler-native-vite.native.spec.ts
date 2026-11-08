import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it, vi } from 'vitest';
import { packFixture } from '@apackdev/sdk/testing/pack-fixture';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { createPackBuilder } from '../../src/build/build-process.ts';
import { formatNodeOptions, parseNodeOptions } from '@apackdev/host/build/source-resolution';
import type { CompilerInstallation } from '../../src/build/compiler-installation.ts';
import { startPackFrontend, type PackFrontend } from '../../src/build/frontend-process.ts';
import { startPackBuildWatcher } from '../../src/build/watch.ts';
import { createCompilerWatchMatcher, mergeCompilerWatchPaths, type CompilerWatchPaths } from '../../src/build/compiler-watch.ts';
import { nativeFixture, nativeLoad } from '../_support/native-libraries.ts';
import { shareCompilerInstallation } from '../_support/shared-compiler.ts';
import { cpuBudget } from '@apackdev/testing/vitest';

/** A ceiling for what's on its way on a machine with two cores and a build running: a wait ends as soon as it's met, and a dev server transforms a view in its own time */
const SETTLES_MS = 60_000;

// The native-library proofs are split by subject so the native half's shards can spread them; this one is
// retained Vite's native inputs and process ownership.

const sharedCompiler = shareCompilerInstallation();

it('tracks retained Vite ESM preload and loader inputs without freezing Vue sources', { meta: cpuBudget(120_000) }, async () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-vite-esm-inputs-')));
  const pack = path.join(root, 'pack');
  const previous = process.env.NODE_OPTIONS;
  let compiler: CompilerInstallation | undefined;
  let frontend: PackFrontend | undefined;
  const signal = new AbortController().signal;
  try {
    packFixture({ at: pack, nodeModules: path.join(REPO_ROOT, 'node_modules'), manifest: { features: {} },
      files: { 'src/pack-entry-fe.ts': "export { default } from './View.vue';", 'src/View.vue': '<template>VITE_ESM_BEFORE</template>' } });
    const dependency = path.join(root, 'node_modules/preload-dependency');
    fs.mkdirSync(dependency, { recursive: true });
    const metadata = path.join(dependency, 'package.json');
    const declaration = JSON.stringify({ name: 'preload-dependency', type: 'module', exports: './first.mjs' });
    fs.writeFileSync(metadata, declaration);
    fs.writeFileSync(path.join(dependency, 'first.mjs'), "export default 'FIRST';");
    fs.writeFileSync(path.join(dependency, 'second.mjs'), "export default 'SECOND';");
    const child = path.join(root, 'sub/child.mjs');
    fs.mkdirSync(path.dirname(child));
    const childSource = "export { default } from 'preload-dependency';";
    fs.writeFileSync(child, childSource);
    const payload = path.join(root, 'loader-input.txt');
    fs.writeFileSync(payload, 'LOADER');
    const proof = path.join(root, 'preload-proof.json');
    const imported = path.join(root, 'preload.mjs');
    fs.writeFileSync(imported, `import value from './sub/child.mjs'; import fs from 'node:fs';
      import { isMainThread } from 'node:worker_threads';
      if (globalThis[Symbol.for('apack.compiler.frontend')] && isMainThread)
        fs.writeFileSync(${JSON.stringify(proof)}, JSON.stringify({ value, required: globalThis.requiredValue, loader: globalThis.loaderValue,
          loaderDependency: globalThis.loaderDependency, loaderCommonJS: globalThis.loaderCommonJS, origin: import.meta.url }));`);
    const loader = path.join(root, 'loader/sub/loader.mjs');
    fs.mkdirSync(path.dirname(loader), { recursive: true });
    const loaderDependency = path.join(root, 'node_modules/loader-dependency');
    const declareLoaderDependency = (directory: string, value: string) => {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"module","exports":"./index.mjs"}');
      fs.writeFileSync(path.join(directory, 'index.mjs'), `export default ${JSON.stringify(value)};`);
    };
    declareLoaderDependency(loaderDependency, 'LOADER_DEP');
    const commonjsDependency = path.join(root, 'node_modules/loader-cjs-dependency');
    const declareCommonJS = (directory: string, source: string) => {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'package.json'), '{"main":"index.cjs"}');
      fs.writeFileSync(path.join(directory, 'index.cjs'), source);
    };
    declareCommonJS(commonjsDependency, "module.exports = require('loader-cjs-child');");
    declareCommonJS(path.join(root, 'node_modules/loader-cjs-child'), "module.exports = 'LOADER_CJS';");
    fs.writeFileSync(loader, `import fs from 'node:fs'; import dependency from 'loader-dependency';
      import { createRequire } from 'node:module'; const commonjs = createRequire(import.meta.url)('loader-cjs-dependency');
      const value = fs.readFileSync(${JSON.stringify(payload)}, 'utf8');
      export async function load(url, context, next) {
        const result = await next(url, context);
        return url === ${JSON.stringify(pathToFileURL(imported).href)}
          ? { ...result, source: 'globalThis.loaderValue = ' + JSON.stringify(value) + ';globalThis.loaderDependency = ' + JSON.stringify(dependency)
            + ';globalThis.loaderCommonJS = ' + JSON.stringify(commonjs) + ';\\n' + result.source } : result;
      }`);
    const required = path.join(root, 'sub/required');
    fs.mkdirSync(required);
    fs.writeFileSync(path.join(required, 'package.json'), '{"main":"preferred.js"}');
    fs.writeFileSync(path.join(required, 'index.js'), "module.exports = require('startup-cjs-dependency');");
    const cjsDependency = path.join(root, 'node_modules/startup-cjs-dependency');
    fs.mkdirSync(cjsDependency);
    fs.writeFileSync(path.join(cjsDependency, 'index.js'), 'module.exports = 42;');
    const nearerCjs = path.join(required, 'node_modules/startup-cjs-dependency');
    fs.mkdirSync(nearerCjs, { recursive: true });
    const requireEntry = path.join(root, 'node_modules/startup-require-fixture');
    fs.mkdirSync(requireEntry);
    fs.writeFileSync(path.join(requireEntry, 'package.json'), '{"main":"index.cjs"}');
    fs.writeFileSync(path.join(requireEntry, 'index.cjs'), `globalThis.requiredValue = require(${JSON.stringify(required)});`);
    const importEntry = path.join(root, 'node_modules/startup-import-fixture');
    fs.mkdirSync(importEntry);
    fs.writeFileSync(path.join(importEntry, 'package.json'), '{"type":"module","exports":"./index.mjs"}');
    fs.writeFileSync(path.join(importEntry, 'index.mjs'), `import ${JSON.stringify(pathToFileURL(imported).href)};`);
    await new Promise<void>(resolve => setImmediate(resolve));
    compiler = await sharedCompiler.installation({ cwd: pack });
    process.env.NODE_OPTIONS = formatNodeOptions([...parseNodeOptions(previous), '--require', 'startup-require-fixture',
      '--import', 'startup-import-fixture', '--experimental-loader', pathToFileURL(loader).href]);
    let observed: CompilerWatchPaths = new Map();
    frontend = await startPackFrontend(pack, compiler, signal, inputs => {
      observed = mergeCompilerWatchPaths(observed, inputs.paths);
    });
    expect(JSON.parse(fs.readFileSync(proof, 'utf8'))).toEqual({ value: 'FIRST', required: 42, loader: 'LOADER', loaderDependency: 'LOADER_DEP', loaderCommonJS: 'LOADER_CJS', origin: pathToFileURL(imported).href });
    expect(await frontend.isCurrent(signal)).toBe(true);
    for (const [file, original, changed] of [
      [payload, 'LOADER', 'CHANGED'],
      [path.join(loaderDependency, 'index.mjs'), 'export default "LOADER_DEP";', "export default 'CHANGED';"],
      [child, childSource, "export default 'CHANGED';"],
      [path.join(dependency, 'first.mjs'), "export default 'FIRST';", "export default 'CHANGED';"],
      [metadata, declaration, JSON.stringify({ name: 'preload-dependency', type: 'module', exports: './second.mjs' })],
    ] as const) {
      expect(createCompilerWatchMatcher(observed)(file, 'change'), `Missing startup subscription: ${file}`).toBe(true);
      fs.writeFileSync(file, changed);
      expect(await frontend.isCurrent(signal), file).toBe(false);
      fs.writeFileSync(file, original);
      expect(await frontend.isCurrent(signal), file).toBe(true);
    }
    for (const candidate of [required + '.js', path.join(required, 'preferred.js'), path.join(nearerCjs, 'index.js')]) {
      expect(createCompilerWatchMatcher(observed)(candidate, 'rename'), candidate).toBe(true);
      fs.writeFileSync(candidate, 'module.exports = 43;');
      expect(await frontend.isCurrent(signal), candidate).toBe(false);
      fs.rmSync(candidate);
      expect(await frontend.isCurrent(signal), candidate).toBe(true);
    }
    const nearerLoader = path.join(path.dirname(loader), 'node_modules/loader-dependency');
    expect(createCompilerWatchMatcher(observed)(path.join(nearerLoader, 'package.json'), 'rename')).toBe(true);
    declareLoaderDependency(nearerLoader, 'NEARER_LOADER');
    expect(await frontend.isCurrent(signal), 'New nearer loader dependency must invalidate startup resolution').toBe(false);
    fs.rmSync(path.join(path.dirname(loader), 'node_modules'), { recursive: true });
    expect(await frontend.isCurrent(signal)).toBe(true);
    const nearerCommonJS = path.join(commonjsDependency, 'node_modules/loader-cjs-child');
    expect(createCompilerWatchMatcher(observed)(path.join(nearerCommonJS, 'package.json'), 'rename')).toBe(true);
    declareCommonJS(nearerCommonJS, "module.exports = 'NEARER_CJS';");
    expect(await frontend.isCurrent(signal), 'New nearer CommonJS loader dependency must invalidate startup resolution').toBe(false);
    fs.rmSync(path.join(commonjsDependency, 'node_modules'), { recursive: true });
    expect(await frontend.isCurrent(signal)).toBe(true);
    const nearer = path.join(root, 'sub/node_modules/preload-dependency');
    expect(createCompilerWatchMatcher(observed)(path.join(nearer, 'package.json'), 'rename')).toBe(true);
    fs.mkdirSync(nearer, { recursive: true });
    fs.writeFileSync(path.join(nearer, 'package.json'), declaration);
    fs.writeFileSync(path.join(nearer, 'first.mjs'), "export default 'NEARER';");
    expect(await frontend.isCurrent(signal), 'New nearer package must invalidate startup resolution').toBe(false);
    declareLoaderDependency(nearerLoader, 'NEARER_LOADER');
    declareCommonJS(nearerCommonJS, "module.exports = 'NEARER_CJS';");
    const registration = path.join(root, 'register-loader.mjs');
    fs.writeFileSync(registration, `import { register } from 'node:module'; register(${JSON.stringify(pathToFileURL(loader).href)});`);
    process.env.NODE_OPTIONS = formatNodeOptions([...parseNodeOptions(previous), '--require', 'startup-require-fixture',
      '--import', pathToFileURL(registration).href, '--import', 'startup-import-fixture']);
    const replacement = await startPackFrontend(pack, compiler, signal);
    try {
      expect(JSON.parse(fs.readFileSync(proof, 'utf8'))).toMatchObject({ value: 'NEARER', loaderDependency: 'NEARER_LOADER', loaderCommonJS: 'NEARER_CJS' });
      expect(await replacement.isCurrent(signal)).toBe(true);
    }
    finally { await replacement.close(); }
    fs.rmSync(path.join(commonjsDependency, 'node_modules'), { recursive: true });
    fs.rmSync(path.join(path.dirname(loader), 'node_modules'), { recursive: true });
    fs.rmSync(path.join(root, 'sub/node_modules'), { recursive: true });
    expect(await frontend.isCurrent(signal)).toBe(true);
    const view = `http://localhost:${frontend.address.port}/src/View.vue`;
    expect(await (await fetch(view)).text()).toContain('VITE_ESM_BEFORE');
    fs.writeFileSync(path.join(pack, 'src/View.vue'), '<template>VITE_ESM_AFTER</template>');
    await vi.waitFor(async () => expect(await (await fetch(view)).text()).toContain('VITE_ESM_AFTER'), { timeout: SETTLES_MS });
    expect(await frontend.isCurrent(signal)).toBe(true);
  } finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previous;
    try { await frontend?.close(); }
    finally { await compiler?.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
  }
});

it('retains independent captured Vite owners through replacement and close', async () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-vite-owners-')));
  const pack = path.join(root, 'pack');
  const proof = path.join(root, 'children.jsonl');
  const previous = process.env.NODE_OPTIONS;
  let compiler: CompilerInstallation | undefined;
  const frontends: PackFrontend[] = [];
  const signal = new AbortController().signal;
  try {
    packFixture({ at: pack, nodeModules: path.join(REPO_ROOT, 'node_modules'), manifest: { features: {} },
      files: { 'src/pack-entry-fe.ts': "export { default } from './View.vue';", 'src/View.vue': '<template>VITE_OWNED</template>' } });
    const preload = path.join(pack, 'descendant.cjs');
    fs.writeFileSync(preload, `if (globalThis[Symbol.for('apack.compiler.frontend')] && require('node:worker_threads').isMainThread) {
      const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio:'ignore'});
      child.unref();
      require('node:fs').appendFileSync(${JSON.stringify(proof)}, JSON.stringify({root:process.pid, child:child.pid})+'\\n');
    }`);
    compiler = await sharedCompiler.installation({ cwd: pack });
    process.env.NODE_OPTIONS = formatNodeOptions([...parseNodeOptions(previous), '--require', preload]);
    frontends.push(await startPackFrontend(pack, compiler, signal));
    frontends.push(await startPackFrontend(pack, compiler, signal));
    const children = fs.readFileSync(proof, 'utf8').trim().split('\n').map(line => JSON.parse(line)) as { root: number; child: number }[];
    expect(children.map(child => child.root)).toEqual(frontends.map(frontend => frontend.address.pid));
    await frontends[0]!.close();
    await vi.waitFor(() => expect(() => process.kill(children[0]!.child, 0)).toThrow(), { timeout: SETTLES_MS });
    expect(frontends[1]!.alive()).toBe(true);
    expect(() => process.kill(children[1]!.child, 0)).not.toThrow();
    expect(await frontends[1]!.isCurrent(signal)).toBe(true);
    expect(await (await fetch(`http://localhost:${frontends[1]!.address.port}/src/View.vue`)).text()).toContain('VITE_OWNED');
    await frontends[1]!.close();
    await vi.waitFor(() => expect(() => process.kill(children[1]!.child, 0)).toThrow(), { timeout: SETTLES_MS });
  } finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previous;
    try { await Promise.all(frontends.map(frontend => frontend.close())); }
    finally { await compiler?.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
  }
});

it.runIf(process.platform === 'darwin')('watches external Vite native changes and repairs a failed generation through newly discovered inputs', { meta: cpuBudget(300_000) }, async ({ onTestFinished }) => {
  const fixture = await nativeFixture('relative');
  const builder = createPackBuilder(fixture.pack, { captureCompiler: sharedCompiler.capture });
  const previous = process.env.NODE_OPTIONS;
  let watcher: Awaited<ReturnType<typeof startPackBuildWatcher>> | undefined;
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const addresses: { port: number; pid: number }[] = [];
  const publications = vi.fn(async () => {});
  const builds = vi.spyOn(builder, 'build');
  const current = vi.spyOn(builder, 'isFrontendCurrent');
  const proof = path.join(fixture.root, 'watch-native-proof.jsonl');
  const preload = path.join(fixture.root, 'vite-preload.cjs');
  const started = performance.now();
  const checkpoint = (phase: string) => console.info(`Native watch: ${phase} (${Math.round(performance.now() - started)}ms)`);
  let completed = false;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    if (previous === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previous;
    let closed = false;
    try {
      try { await watcher?.close(); } finally { await builder.close(); }
      closed = true;
    } finally {
      errors.mockRestore();
      if (completed && closed) fs.rmSync(fixture.root, { recursive: true, force: true });
      else console.info(`Retained native watch fixture: ${fixture.root}`);
      checkpoint(closed ? 'owners closed' : 'owner teardown failed');
    }
  })();
  onTestFinished(close);
  try {
    packFixture({ at: fixture.pack, nodeModules: path.join(REPO_ROOT, 'node_modules'), manifest: { features: {} },
      files: { 'src/pack-entry-fe.ts': "export { default } from './View.vue';", 'src/View.vue': '<template>NATIVE_WATCH</template>',
        'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true } }) } });
    fs.writeFileSync(preload, `if (globalThis[Symbol.for('apack.compiler.frontend')]) { ${nativeLoad(fixture, proof)} }`);
    process.env.NODE_OPTIONS = formatNodeOptions([...parseNodeOptions(previous), '--require', preload]);
    watcher = await startPackBuildWatcher(fixture.pack, { builder, buildArgs: ['--skip-fe'], onBuilt: publications,
      place: { env: 'test', userDataDir: path.join(fixture.root, 'profile') } });
    checkpoint('watch ready');
    await builder.serveFrontend(address => { if (address) addresses.push(address); });
    checkpoint('frontend ready');
    const view = `http://localhost:${addresses[0]!.port}/src/View.vue`;
    expect(await (await fetch(view)).text()).toContain('NATIVE_WATCH');
    await vi.waitFor(() => expect(current).toHaveBeenCalled(), { timeout: SETTLES_MS });
    await current.mock.results.at(-1)!.value;
    current.mockClear();
    const touched = new Date(Date.now() + 2_000);
    fs.utimesSync(fixture.library, touched, touched);
    await vi.waitFor(() => expect(current).toHaveBeenCalled(), { timeout: SETTLES_MS });
    expect(await current.mock.results.at(-1)!.value).toBe(true);
    expect(publications).not.toHaveBeenCalled();
    checkpoint('unchanged touch checked');

    const staging = path.join(fixture.root, 'replacement');
    const helper = path.join(staging, 'libhelper.dylib');
    const replacement = path.join(staging, 'libvalue.dylib');
    await fixture.buildLibrary(helper, 'int helper_value(void) { return 22; }', '@loader_path/new/libhelper.dylib');
    await fixture.buildLibrary(replacement, 'extern int helper_value(void); int native_value(void) { return helper_value(); }',
      '@loader_path/../lib/libvalue.dylib', [helper]);
    builds.mockClear();
    fs.rmSync(fixture.marker);
    fs.renameSync(replacement, fixture.library);
    await vi.waitFor(() => expect(builds).toHaveBeenCalled(), { timeout: SETTLES_MS });
    // Wait for the detected rebuild itself, rather than timing compilation through a console spy.
    await expect(builds.mock.results[0]!.value).rejects.toThrow('Pack frontend exited before readiness');
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('Build/reload failed'));
    checkpoint('missing dependency refused');
    expect(fs.existsSync(fixture.marker)).toBe(false);
    expect(addresses).toHaveLength(1);
    expect(await (await fetch(view)).text()).toContain('NATIVE_WATCH');

    // Repair only the new dependency, outside the authored pack and the incumbent's inputs.
    const repaired = path.join(fixture.native, 'lib/new/libhelper.dylib');
    fs.mkdirSync(path.dirname(repaired), { recursive: true });
    builds.mockClear();
    fs.copyFileSync(helper, repaired);
    checkpoint('new dependency repaired');
    await vi.waitFor(() => expect(builds).toHaveBeenCalled(), { timeout: SETTLES_MS });
    checkpoint('repair rebuild started');
    await expect(builds.mock.results[0]!.value).resolves.toBeUndefined();
    checkpoint('repair rebuild completed');
    await vi.waitFor(() => expect(publications).toHaveBeenCalledTimes(1), { timeout: SETTLES_MS });
    checkpoint('repair published');
    expect(addresses).toHaveLength(2);
    expect(() => process.kill(addresses[0]!.pid, 0)).toThrow();
    const results = fs.readFileSync(proof, 'utf8').trim().split('\n').map(line => JSON.parse(line))
      .filter(row => row.thread === 0).map(row => row.value);
    expect(results).toEqual([11, 22]);
    completed = true;
  } catch (error) {
    console.info('Native watch refusals:', errors.mock.calls);
    throw error;
  } finally { await close(); }
});

it.runIf(process.platform === 'darwin').each(['preload', 'thread'] as const)(
  'owns retained Vite native %s inputs while authored Vue sources stay live', async site => {
    const fixture = await nativeFixture('relative');
    const refused = await nativeFixture('absolute');
    const previous = process.env.NODE_OPTIONS;
    let compiler: CompilerInstallation | undefined;
    let frontend: PackFrontend | undefined;
    const signal = new AbortController().signal;
    try {
      // Put the addon inside the authored pack itself: capturing its whole package would freeze Vue.
      fs.cpSync(fixture.native, fixture.pack, { recursive: true });
      const native = { ...fixture, native: fixture.pack, library: path.join(fixture.pack, 'lib/libvalue.dylib') };
      packFixture({ at: fixture.pack, nodeModules: path.join(REPO_ROOT, 'node_modules'), manifest: { features: {} },
        files: { 'src/pack-entry-fe.ts': "export { default } from './View.vue';", 'src/View.vue': '<template>VITE_NATIVE_BEFORE</template>' } });
      const proof = path.join(fixture.root, 'vite-native-proof.jsonl');
      const preload = path.join(fixture.pack, 'vite-native.cjs');
      const load = nativeLoad(native, proof);
      const writePreload = (load: string) => fs.writeFileSync(preload, `if (globalThis[Symbol.for('apack.compiler.frontend')] && require('node:worker_threads').isMainThread) {
        ${site === 'preload' ? load : `const worker = new (require('node:worker_threads').Worker)(${JSON.stringify(load + ';setInterval(() => {}, 1000);')}, { eval: true, execArgv: [] });
        worker.on('error', error => { console.error(error); process.exit(1); });`}
      }`);
      writePreload(load);
      compiler = await sharedCompiler.installation({ cwd: fixture.pack });
      process.env.NODE_OPTIONS = formatNodeOptions([...parseNodeOptions(previous), '--require', preload]);
      frontend = await startPackFrontend(fixture.pack, compiler, signal);
      await vi.waitFor(() => expect(fs.existsSync(proof)).toBe(true), { timeout: SETTLES_MS });
      const loaded = JSON.parse(fs.readFileSync(proof, 'utf8').trim()) as { value: number; thread: number; libraries: string[] };
      expect(loaded.value).toBe(11);
      expect(loaded.thread > 0).toBe(site === 'thread');
      expect(loaded.libraries).not.toContain(native.library);
      expect(loaded.libraries.some(file => file.includes('apack-vite-') && file.endsWith('/lib/libvalue.dylib'))).toBe(true);
      expect(await frontend.isCurrent(signal)).toBe(true);
      const initializedPreload = fs.readFileSync(preload, 'utf8');
      fs.appendFileSync(preload, '\n// changed preload bytes');
      expect(await frontend.isCurrent(signal)).toBe(false);
      fs.writeFileSync(preload, initializedPreload);
      expect(await frontend.isCurrent(signal)).toBe(true);
      const view = `http://localhost:${frontend.address.port}/src/View.vue`;
      expect(await (await fetch(view)).text()).toContain('VITE_NATIVE_BEFORE');
      fs.writeFileSync(path.join(fixture.pack, 'src/View.vue'), '<template>VITE_NATIVE_AFTER</template>');
      await vi.waitFor(async () => expect(await (await fetch(view)).text()).toContain('VITE_NATIVE_AFTER'), { timeout: SETTLES_MS });
      expect(await frontend.isCurrent(signal)).toBe(true);
      fs.writeFileSync(native.library, 'CHANGED');
      expect(await frontend.isCurrent(signal)).toBe(false);
      expect(frontend.alive()).toBe(true);
      writePreload(nativeLoad(refused, path.join(refused.root, 'refused-proof.jsonl')));
      await expect(startPackFrontend(fixture.pack, compiler, signal)).rejects.toThrow('Pack frontend exited before readiness');
      expect(fs.existsSync(refused.marker)).toBe(false);
      expect(frontend.alive()).toBe(true);
      expect(await (await fetch(view)).text()).toContain('VITE_NATIVE_AFTER');
    } finally {
      if (previous === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previous;
      try { await frontend?.close(); }
      finally {
        await compiler?.dispose();
        for (const { root } of [fixture, refused]) fs.rmSync(root, { recursive: true, force: true });
      }
    }
  },
);
