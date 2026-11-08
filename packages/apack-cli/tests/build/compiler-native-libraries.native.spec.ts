import fs from 'node:fs';
import path from 'node:path';
import { expect, it, onTestFinished } from 'vitest';
import { captureCompilationInputs } from '../../src/build/compilation-inputs.ts';
import { createCompilerModuleLoader } from '../../src/build/compiler-modules.ts';
import { FIXTURE_DATA, FIXTURE_ENTITY, packFixture } from '@apackdev/sdk/testing/pack-fixture';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { readPackBuild } from '@apackdev/host/packs';
import { readPackBuildInputs, assertPackBuildInputsCurrent } from '@apackdev/host/build/pack-build-inputs';
import { createPackBuilder } from '../../src/build/build-process.ts';
import { formatNodeOptions, parseNodeOptions } from '@apackdev/host/build/source-resolution';
import { withCompilerFileReads } from '@apackdev/host/build/compiler-inputs';
import { nativeFixture, ordinaryNativeLoad, nativeLoad, nativeWorkerCompiler, type NativeFixture } from '../_support/native-libraries.ts';
import { shareCompilerInstallation } from '../_support/shared-compiler.ts';
import { cpuBudget } from '@apackdev/testing/vitest';
import { fromNow, processWork, workSignal } from '@apackdev/sdk/progress';

// The native-library proofs are split by subject so the native half's shards can spread them; this one is
// native libraries checked before addon initialization, in preloads, threads and launch search paths.

const sharedCompiler = shareCompilerInstallation();

it.runIf(process.platform === 'darwin').each(['relative', 'absolute', 'transitive'] as const)('checks %s native libraries before addon initialization', async mode => {
  const { root, pack, library, marker, outside, entry } = await nativeFixture(mode);
  let compilation: ReturnType<typeof captureCompilationInputs> | undefined;
  let modules: ReturnType<typeof createCompilerModuleLoader> | undefined;
  try {
    compilation = captureCompilationInputs(pack);
    modules = createCompilerModuleLoader(compilation);
    const load = () => withCompilerFileReads({ compilation: compilation! }, () => modules!.importModule(entry));
    if (mode !== 'relative') {
      const dependency = mode === 'absolute' ? library : outside;
      // Preparing a package's unused native main must not refuse its selected JavaScript export.
      const fallback = await withCompilerFileReads({ compilation }, () => modules!.importModule(path.join(pack, 'fallback.cjs')));
      expect(fallback.default).toBe('JS_FALLBACK');
      await expect(load()).rejects.toThrow(`references "${dependency}" outside its captured package`);
      await expect(load()).rejects.toThrow(`references "${dependency}" outside its captured package`);
      expect(fs.existsSync(marker)).toBe(false);
      expect((process.report.getReport() as { sharedObjects: string[] }).sharedObjects).not.toContain(dependency);
      return;
    }
    const loaded = await load();
    expect(fs.existsSync(marker)).toBe(true);
    const addon = loaded.default as { read(): number };
    expect(addon.read()).toBe(11);
    const shared = (process.report.getReport() as { sharedObjects: string[] }).sharedObjects;
    expect(shared).toContain(compilation.readTree().path(library));
    expect(shared).not.toContain(library);
    compilation.assertCurrent();
    fs.writeFileSync(`${library}.replacement`, 'CHANGED');
    fs.renameSync(`${library}.replacement`, library);
    expect(addon.read()).toBe(11);
    expect(() => compilation!.assertCurrent()).toThrow(/changed/i);
  } finally {
    try { await modules?.dispose(); }
    finally { compilation?.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
  }
});

it.runIf(process.platform === 'darwin' || process.platform === 'linux').each(['preload', 'thread'] as const)('captures native %s libraries and retains the incumbent after outside-library refusal', { meta: cpuBudget(120_000 + 2 * 60_000 + 60_000) }, async site => {
  const started = performance.now();
  const checkpoint = (phase: string) => console.info(`Native ${site}: ${phase} (${Math.round(performance.now() - started)}ms)`);
  const supported = await nativeFixture('relative');
  const refused = [await nativeFixture('absolute'), await nativeFixture('transitive')];
  const builder = createPackBuilder(supported.pack, { captureCompiler: sharedCompiler.capture });
  const previous = process.env.NODE_OPTIONS;
  const preload = path.join(supported.pack, 'native-preload.cjs');
  const proof = path.join(supported.root, 'preload-proof.json');
  const writeLoader = (fixture: NativeFixture) => {
    const load = nativeLoad(fixture, proof);
    if (site === 'preload') fs.writeFileSync(preload, `if (globalThis[Symbol.for('apack.compiler.startup')]) { ${load} }`);
    else fs.writeFileSync(path.join(supported.pack, 'src/compiler.ts'), nativeWorkerCompiler(load));
  };
  let completed = false;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    if (previous === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previous;
    let closed = false;
    try { await builder.close(); closed = true; }
    finally {
      if (completed && closed) for (const fixture of [supported, ...refused]) fs.rmSync(fixture.root, { recursive: true, force: true });
      else console.info(`Retained native ${site} fixtures:`, [supported, ...refused].map(fixture => fixture.root));
      checkpoint(closed ? 'owner closed' : 'owner teardown failed');
    }
  })();
  onTestFinished(close);
  checkpoint('fixtures ready');
  try {
    packFixture({ at: supported.pack, nodeModules: path.join(REPO_ROOT, 'node_modules'), manifest: { features: {},
      ...(site === 'thread' ? { data: FIXTURE_DATA, content: { formats: { rows: { compiler: 'src/compiler.ts', entity: FIXTURE_ENTITY, identity: ['name'] } },
        sources: { rows: { path: 'src/value.txt', format: 'rows' } } } } : {}) },
      files: { 'src/value.txt': 'input', 'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true } }) } });
    writeLoader(supported);
    if (site === 'preload') process.env.NODE_OPTIONS = formatNodeOptions([...parseNodeOptions(previous), '--require', preload]);
    checkpoint('initial build started');
    const bounded = workSignal({ work: fromNow(processWork(process.pid)), ceilingMs: 120_000, fallbackMs: 120_000 });
    try { await builder.build({ args: ['--skip-fe'], signal: bounded.signal }); } finally { bounded.stop(); }
    checkpoint('initial build completed');
    const results = fs.readFileSync(proof, 'utf8').trim().split('\n').map(line => JSON.parse(line)) as { thread: number; value: number; libraries: string[] }[];
    for (const result of results) {
      if (site === 'thread') expect(result.thread).toBeGreaterThan(0);
      expect(result.value).toBe(11);
      expect(result.libraries).not.toContain(supported.library);
      expect(result.libraries.some(file => file.includes('apack-inputs-') && file.endsWith('/lib/' + path.basename(supported.library)))).toBe(true);
    }
    const inputs = readPackBuildInputs(path.join(supported.pack, 'dist'));
    assertPackBuildInputsCurrent(supported.pack, inputs);
    const original = fs.readFileSync(supported.library);
    const mode = fs.statSync(supported.library).mode & 0o777;
    const replaceLibrary = (bytes: Buffer | string) => {
      const replacement = supported.library + '.replacement';
      fs.writeFileSync(replacement, bytes, { mode });
      fs.renameSync(replacement, supported.library);
    };
    replaceLibrary('CHANGED');
    expect(() => assertPackBuildInputsCurrent(supported.pack, inputs)).toThrow();
    replaceLibrary(original);
    assertPackBuildInputsCurrent(supported.pack, inputs);
    checkpoint('freshness and restoration checked');
    const revision = readPackBuild(path.join(supported.pack, 'dist')).revision;
    for (const [index, fixture] of refused.entries()) {
      const ordinary = await ordinaryNativeLoad(fixture, { ...process.env, NODE_OPTIONS: previous });
      checkpoint(`refusal ${index + 1} ordinary control completed`);
      expect(ordinary.value).toBe(11);
      expect(ordinary.libraries).toContain(fixture.library);
      expect(fs.existsSync(fixture.marker)).toBe(true);
      fs.rmSync(fixture.marker);
      fs.rmSync(proof, { force: true });
      writeLoader(fixture);
      checkpoint(`refusal ${index + 1} build started`);
      const signal = AbortSignal.timeout(60_000);
      await expect(builder.build({ args: ['--skip-fe'], signal })).rejects.toThrow();
      expect(signal.aborted, 'Native refusal must precede the build deadline').toBe(false);
      checkpoint(`refusal ${index + 1} build completed`);
      expect(fs.existsSync(fixture.marker)).toBe(false);
      expect(fs.existsSync(proof)).toBe(false);
      expect(readPackBuild(path.join(supported.pack, 'dist')).revision).toBe(revision);
    }
    completed = true;
  } finally { await close(); }
});

it.runIf(process.platform === 'darwin' || process.platform === 'linux')('retains launch-time native search paths across preload changes and compiler workers', { meta: cpuBudget(2 * 60_000 + 60_000 + 20_000) }, async () => {
  const fixture = await nativeFixture(process.platform === 'linux' ? 'runpath' : 'relative');
  const builder = createPackBuilder(fixture.pack, { captureCompiler: sharedCompiler.capture });
  const previousOptions = process.env.NODE_OPTIONS;
  const variable = process.platform === 'linux' ? 'LD_LIBRARY_PATH' : 'DYLD_LIBRARY_PATH';
  const previousSearch = process.env[variable];
  const search = path.join(fixture.root, 'search');
  const proof = path.join(fixture.root, 'worker-proof.json');
  const preload = path.join(fixture.pack, 'clear-loader-env.cjs');
  try {
    fs.mkdirSync(search);
    packFixture({ at: fixture.pack, nodeModules: path.join(REPO_ROOT, 'node_modules'), manifest: { features: {},
      data: FIXTURE_DATA, content: { formats: { rows: { compiler: 'src/compiler.ts', entity: FIXTURE_ENTITY, identity: ['name'] } },
        sources: { rows: { path: 'src/value.txt', format: 'rows' } } } },
      files: { 'src/compiler.ts': nativeWorkerCompiler(nativeLoad(fixture, proof)), 'src/value.txt': 'input',
        'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true } }) } });
    fs.writeFileSync(preload, `delete process.env[${JSON.stringify(variable)}];`);
    process.env.NODE_OPTIONS = formatNodeOptions([...parseNodeOptions(previousOptions), '--require', preload]);
    process.env[variable] = search;
    await builder.build({ args: ['--skip-fe'] });
    const loaded = JSON.parse(fs.readFileSync(proof, 'utf8')) as { value: number; thread: number; libraries: string[] };
    expect(loaded.thread).toBeGreaterThan(0);
    expect(loaded.value).toBe(11);
    expect(loaded.libraries).not.toContain(fixture.library);
    expect(loaded.libraries.some(file => file.includes('apack-inputs-') && file.endsWith('/lib/' + path.basename(fixture.library)))).toBe(true);
    const output = path.join(fixture.pack, 'dist');
    const revision = readPackBuild(output).revision;
    const inputs = readPackBuildInputs(output);
    assertPackBuildInputsCurrent(fixture.pack, inputs);
    fs.rmSync(fixture.marker);
    fs.rmSync(proof);
    // An unused directory was harmless; this new matching library would now override the owned copy.
    const selected = path.join(search, path.basename(fixture.library));
    fs.copyFileSync(fixture.library, selected);
    const ordinary = await ordinaryNativeLoad(fixture, { ...process.env, NODE_OPTIONS: previousOptions });
    expect(ordinary.value).toBe(11);
    expect(ordinary.libraries).toContain(selected);
    expect(fs.existsSync(fixture.marker)).toBe(true);
    fs.rmSync(fixture.marker);
    expect(() => assertPackBuildInputsCurrent(fixture.pack, inputs)).toThrow();
    await expect(builder.build({ args: ['--skip-fe'] })).rejects.toThrow();
    expect(fs.existsSync(fixture.marker)).toBe(false);
    expect(fs.existsSync(proof)).toBe(false);
    expect(readPackBuild(output).revision).toBe(revision);
  } finally {
    if (previousOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previousOptions;
    if (previousSearch === undefined) delete process.env[variable];
    else process.env[variable] = previousSearch;
    await builder.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
