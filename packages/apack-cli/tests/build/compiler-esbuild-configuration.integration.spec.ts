// @slow: each case bundles a real pack runtime through esbuild over a captured input view
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { build as nativeBuild, type BuildOptions } from 'esbuild';
import { afterEach, expect, it, vi } from 'vitest';
import { createBuildOutputs } from '../../src/build/build-outputs.ts';
import { bundlePackRuntime } from '../../src/build/be-bundler.ts';
import { captureCompilationInputs } from '../../src/build/compilation-inputs.ts';
import * as configuration from '../../src/build/compiler-configuration.ts';
import * as bundlers from '../../src/build/be-bundler.ts';
import * as declarations from '../../src/build/types-bundler.ts';
import { build } from '../../src/commands/build.ts';
import { packFixture } from '@apackdev/sdk/testing/pack-fixture';
import { startTestRuntime } from '@apackdev/sdk/testing';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { loadSingleExternalPack } from '@apackdev/host/packs/runtime';
import { createPackRegistry, stagePack } from '@apackdev/host/packs';

startTestRuntime({ appVersion: '1.0.0' });

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  // Let the runner acknowledge task updates between synchronous compiler/verification phases.
  await new Promise<void>(resolve => { setImmediate(resolve); });
});

function fixture(baseUrl: boolean) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-esbuild-config-')));
  roots.push(root);
  const pack = path.join(root, 'pack');
  const write = (file: string, value: unknown) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
  };
  write('package.json', { name: 'parent', type: 'module' });
  write('pack/package.json', { name: 'consumer', type: 'module' });
  write('node_modules/config-base/package.json', { name: 'config-base', main: 'index.js' });
  write('node_modules/config-base/index.js', 'throw new Error("Configuration discovery activated code");');
  write('node_modules/config-base/tsconfig.json', { compilerOptions: { useDefineForClassFields: false, jsx: 'react-jsx', strict: true } });
  write('node_modules/bare/package.json', { name: 'bare', main: 'index.js', types: 'index.d.ts', type: 'module' });
  write('node_modules/bare/index.js', 'export const label = "PACKAGE";');
  write('node_modules/bare/alternate.js', 'export const label = "WRONG_ENTRY";');
  write('node_modules/bare/index.d.ts', 'export declare const label: string;');
  write('configs/base.json', '// JSONC parent\n' + JSON.stringify({ extends: 'config-base/tsconfig.json', compilerOptions: {
    ...(baseUrl ? { baseUrl: '../external' } : {}), paths: { outside: [baseUrl ? 'value.ts' : '../external/value.ts'] }, target: 'ES2022',
  } }));
  write('configs/overrides.json', { compilerOptions: { strict: false, alwaysStrict: true, jsx: 'react', jsxFactory: 'element' } });
  // Inventing baseUrl from the paths declaration would incorrectly choose this over the package.
  write('configs/bare.ts', 'export const label = "SHADOW";');
  write('external/value.ts', 'export const value = "ALIASED";');
  write('pack/tsconfig.json', { extends: ['../configs/base.json', '../configs/overrides.json'], compilerOptions: {
    noLib: true, types: [], module: 'ESNext', moduleResolution: 'Bundler',
  } });
  write('pack/src/input.tsx', `import {label} from 'bare'; import {value} from 'outside';
    const calls: number[] = []; class Base {}
    Object.defineProperty(Base.prototype, 'field', {set(value: number) {calls.push(value);}});
    class Derived extends Base { field = 7; } new Derived();
    const element = (tag: string) => tag;
    export const result = { calls, label, value, jsx: <div /> };`);
  write('pack/src/__generated__/pack-entry.ts', 'export {result} from "../input.tsx";');
  return { root, pack, write, entry: path.join(pack, 'src/__generated__/pack-entry.ts') };
}

function evaluate(code: string): unknown {
  const module: { exports: Record<string, unknown> } = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports });
  return JSON.parse(JSON.stringify(module.exports.result));
}

it.each([false, true])('preserves native inherited aliases and transform semantics (baseUrl: %s)', async baseUrl => {
  const { pack, entry } = fixture(baseUrl);
  const baseline = await nativeBuild({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', target: 'node20',
    write: false, tsconfig: path.join(pack, 'tsconfig.json') });
  const expected = evaluate(baseline.outputFiles[0]!.text);
  expect(expected).toEqual({ calls: [7], label: 'PACKAGE', value: 'ALIASED', jsx: 'div' });
  const output = path.join(pack, 'dist');
  const outputs = createBuildOutputs(output);
  const result = await bundlePackRuntime(pack, output, { recordOutput: outputs.record });
  expect(() => outputs.assertCurrent()).not.toThrow();
  expect(result.success, result.error).toBe(true);
  expect(evaluate(fs.readFileSync(path.join(output, 'runtime/index.cjs'), 'utf8'))).toEqual(expected);
  fs.unlinkSync(path.join(output, 'runtime/index.cjs.map'));
  expect(() => outputs.assertCurrent()).toThrow(/missing or changed/);
});

it('consumes its captured config without reparsing and refuses changed inputs before publication', async () => {
  const { root, pack } = fixture(false);
  const compilation = captureCompilationInputs(pack);
  compilation.captureGenerated();
  expect(compilation.configuration).toBeDefined();
  fs.unlinkSync(path.join(root, 'configs/base.json'));
  const reread = vi.spyOn(configuration, 'readPackCompilerConfiguration').mockImplementation(() => { throw new Error('Reparsed live configuration'); });
  const output = path.join(pack, 'dist');
  const outputs = createBuildOutputs(output);
  const result = await bundlePackRuntime(pack, output, { compilation, recordOutput: outputs.record });
  expect(() => outputs.assertCurrent()).not.toThrow();
  expect(result.success, result.error).toBe(true);
  expect(evaluate(fs.readFileSync(path.join(output, 'runtime/index.cjs'), 'utf8')))
    .toEqual({ calls: [7], label: 'PACKAGE', value: 'ALIASED', jsx: 'div' });
  expect(reread).not.toHaveBeenCalled();
  expect(() => compilation.assertCurrent()).toThrow('Compiler or installed package inputs changed');
});

it.each(['ES2017', 'ESNext'])('preserves native class-field defaults for %s', async target => {
  const { pack, entry, write } = fixture(true);
  write('node_modules/config-base/tsconfig.json', { compilerOptions: { jsx: 'react-jsx', strict: true } });
  write('configs/base.json', { extends: 'config-base/tsconfig.json', compilerOptions: {
    baseUrl: '../external', paths: { outside: ['value.ts'] }, target,
  } });
  const options = { entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', target: 'node20', write: false } satisfies BuildOptions;
  const baseline = await nativeBuild({ ...options, tsconfig: path.join(pack, 'tsconfig.json') });
  const projected = await nativeBuild({ ...options, tsconfigRaw: configuration.esbuildTsconfig(configuration.readPackCompilerConfiguration(pack)!) });
  expect(projected.warnings).toEqual([]);
  expect(evaluate(projected.outputFiles[0]!.text)).toEqual(evaluate(baseline.outputFiles[0]!.text));
  expect(evaluate(projected.outputFiles[0]!.text)).toMatchObject({ calls: target === 'ES2017' ? [7] : [] });
});

it('projects inherited paths to owned files without changing config data or needing originals', async () => {
  const { root, pack, entry } = fixture(false);
  const captured = configuration.readPackCompilerConfiguration(pack)!;
  const paths = JSON.stringify(captured.options.paths);
  const raw = fs.readFileSync(path.join(root, 'configs/base.json'));
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-native-owned-config-')));
  roots.push(temporary);
  const owned = path.join(temporary, 'nested/context');
  fs.cpSync(root, owned, { recursive: true });
  fs.rmSync(root, { recursive: true });
  const resolveInputPath = (file: string) => path.join(owned, path.relative(root, file));
  const projected = await nativeBuild({ entryPoints: [resolveInputPath(entry)], bundle: true, platform: 'node', format: 'cjs', target: 'node20', write: false,
    tsconfigRaw: configuration.esbuildTsconfig(captured, resolveInputPath) });
  expect(projected.warnings).toEqual([]);
  expect(evaluate(projected.outputFiles[0]!.text)).toEqual({ calls: [7], label: 'PACKAGE', value: 'ALIASED', jsx: 'div' });
  expect(JSON.stringify(captured.options.paths)).toBe(paths);
  expect(fs.readFileSync(path.join(owned, 'configs/base.json'))).toEqual(raw);
});

it('preserves native parent-config discovery when there is no explicit pack config', async () => {
  const { root, pack, entry } = fixture(false);
  fs.unlinkSync(path.join(pack, 'tsconfig.json'));
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ extends: './configs/base.json', compilerOptions: {
    jsx: 'react', jsxFactory: 'element',
  } }));
  const baseline = await nativeBuild({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', target: 'node20', write: false });
  const expected = evaluate(baseline.outputFiles[0]!.text);
  const output = path.join(pack, 'dist');
  const result = await bundlePackRuntime(pack, output);
  expect(result.success, result.error).toBe(true);
  expect(evaluate(fs.readFileSync(path.join(output, 'runtime/index.cjs'), 'utf8'))).toEqual(expected);
});

it.each(['configuration', 'sources', 'declarations', 'resolution'])('publishes captured %s despite a transient live edit restored during bundling', async change => {
  const { root, pack } = fixture(false);
  packFixture({ at: pack, nodeModules: path.join(REPO_ROOT, 'node_modules'), manifest: {
    id: 'captured-config', name: 'Captured config', features: {}, lifecycle: { onInit: 'src/on-init.ts#onInit' },
    data: { entities: { Probe: { shape: 'src/shape.ts#Probe' } } },
  }, files: {
    'src/on-init.ts': 'import {result} from "./input.tsx"; export function onInit() { return JSON.stringify(result); }',
    'src/shape.ts': 'export interface Probe { value: string }',
  } });
  const leaf = path.join(pack, 'tsconfig.json');
  const options = JSON.parse(fs.readFileSync(leaf, 'utf8'));
  delete options.compilerOptions.noLib;
  fs.writeFileSync(leaf, JSON.stringify(options));
  const config = path.join(root, 'node_modules/config-base/tsconfig.json');
  const original = fs.readFileSync(config);
  const bundle = bundlers.bundlePackRuntime;
  const transient = vi.spyOn(bundlers, 'bundlePackRuntime').mockImplementation(async (...args) => {
    const replacements = change === 'configuration'
      ? [[config, JSON.stringify({ compilerOptions: { useDefineForClassFields: true, jsx: 'react-jsx', strict: true } })]]
      : change === 'resolution' ? [[path.join(root, 'node_modules/bare/package.json'), JSON.stringify({ name: 'bare', main: 'alternate.js', types: 'index.d.ts', type: 'module' })]]
      // A dependency file's bytes become inputs at its first read, which here is this bundle: an edit spanning
      // that read is refused rather than published (compiler-input-view.spec.ts), so only captured sources change
      : change === 'declarations' ? [] : [
        [path.join(pack, 'src/input.tsx'), fs.readFileSync(path.join(pack, 'src/input.tsx'), 'utf8').replace('field = 7', 'field = 99')],
        [path.join(root, 'external/value.ts'), 'export const value = "LIVE_ALIAS";'],
      ];
    const originals = replacements.map(([file]) => [file!, fs.readFileSync(file!)] as const);
    try {
      for (const [file, text] of replacements) fs.writeFileSync(file!, text!);
      return await bundle(...args);
    } finally {
      for (const [file, bytes] of originals) fs.writeFileSync(file, bytes);
    }
  });
  const trees: string[] = [];
  const mkdtemp = fs.mkdtempSync;
  vi.spyOn(fs, 'mkdtempSync').mockImplementation(prefix => {
    const directory = mkdtemp(prefix);
    if (path.basename(String(prefix)).startsWith('apack-inputs-')) trees.push(directory);
    return directory;
  });
  const bundleTypes = declarations.bundlePackTypes;
  vi.spyOn(declarations, 'bundlePackTypes').mockImplementation(async (...args) => {
    if (change !== 'declarations') return bundleTypes(...args);
    const shape = path.join(pack, 'src/shape.ts');
    const bytes = fs.readFileSync(shape);
    fs.unlinkSync(shape);
    fs.unlinkSync(config);
    try { return await bundleTypes(...args); }
    finally { fs.writeFileSync(shape, bytes); fs.writeFileSync(config, original); }
  });
  if (change === 'resolution') {
    // A dependency package is captured when the bundler first resolves into it, here during the edit, so the
    // restored package.json differs from what that capture saw: refused, never published from live bytes
    // The thrown summary keeps each failure's first line; the build prints the bundler's reason in full
    const printed = vi.spyOn(console, 'error');
    await expect(build(['--skip-fe'], pack)).rejects.toThrow(/Runtime bundle failed/);
    expect(printed.mock.calls.flat().join('\n')).toMatch(/Compiler input changed during capture: .*node_modules\/bare\/package\.json/);
    expect(transient).toHaveBeenCalledOnce();
    return;
  }
  await build(['--skip-fe'], pack);
  expect(transient).toHaveBeenCalledOnce();
  expect(trees).toHaveLength(1);
  for (const tree of trees) expect(fs.existsSync(tree)).toBe(false);
  const facade = fs.readFileSync(path.join(pack, 'dist/types/pack-types.d.ts'), 'utf8');
  expect(facade).toContain('value: string');
  expect(facade).not.toContain('apack-inputs-');
  expect(fs.readFileSync(config)).toEqual(original);
  const installed = path.join(root, 'installed/captured-config');
  stagePack(pack, installed);
  const loaded = loadSingleExternalPack(createPackRegistry(), installed);
  if ('problem' in loaded) throw new Error(loaded.problem);
  expect(loaded.registration.lifecycle?.onInit?.())
    .toBe(JSON.stringify({ calls: [7], label: 'PACKAGE', value: 'ALIASED', jsx: 'div' }));
}, 120_000 + 20_000);

it('keeps implicit absolute configuration inheritance owned while originals are absent', async () => {
  const { root, pack, write } = fixture(false);
  fs.unlinkSync(path.join(pack, 'tsconfig.json'));
  write('tsconfig.json', { extends: path.join(root, 'configs/base.json'), compilerOptions: {
    jsx: 'react', jsxFactory: 'element', types: [], noLib: true,
  } });
  const compilation = captureCompilationInputs(pack);
  compilation.captureGenerated();
  const files = ['tsconfig.json', 'configs/base.json'].map(file => path.join(root, file));
  const originals = files.map(file => fs.readFileSync(file));
  try {
    for (const file of files) fs.unlinkSync(file);
    const output = path.join(pack, 'dist');
    const result = await bundlePackRuntime(pack, output, { compilation });
    expect(result.success, result.error).toBe(true);
    expect(evaluate(fs.readFileSync(path.join(output, 'runtime/index.cjs'), 'utf8')))
      .toEqual({ calls: [7], label: 'PACKAGE', value: 'ALIASED', jsx: 'div' });
    expect(fs.readFileSync(path.join(output, 'runtime/index.cjs.map'), 'utf8')).not.toContain('apack-inputs-');
  } finally {
    files.forEach((file, index) => fs.writeFileSync(file, originals[index]!));
    compilation.dispose();
  }
});

it('preserves native lookup of runtime dependencies hidden by declaration entrypoints', async () => {
  const { pack, entry, write } = fixture(false);
  write('node_modules/bare/index.js', 'export {label} from "hidden";');
  write('node_modules/hidden/package.json', { name: 'hidden', main: 'index.js', type: 'module' });
  write('node_modules/hidden/index.js', 'export const label = "NEAREST";');
  write('node_modules/bare/node_modules/hidden/package.json', { name: 'hidden', main: 'index.js', type: 'module' });
  write('node_modules/bare/node_modules/hidden/index.js', 'export const label = "NESTED";');
  const baseline = await nativeBuild({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs',
    target: 'node20', write: false, tsconfig: path.join(pack, 'tsconfig.json') });
  const expected = evaluate(baseline.outputFiles[0]!.text);
  expect(expected).toMatchObject({ label: 'NESTED' });
  const compilation = captureCompilationInputs(pack);
  compilation.captureGenerated();
  try {
    const output = path.join(pack, 'dist');
    const result = await bundlePackRuntime(pack, output, { compilation });
    expect(result.success, result.error).toBe(true);
    expect(evaluate(fs.readFileSync(path.join(output, 'runtime/index.cjs'), 'utf8'))).toEqual(expected);
    compilation.assertCurrent();
  } finally { compilation.dispose(); }
});

it('preserves native glob requires in external source directories', async () => {
  const { root, pack, entry, write } = fixture(false);
  write('external/value.ts', 'const name = "one"; export const value = require(`./parts/${name}.cjs`).value;');
  write('external/parts/one.cjs', 'exports.value = "ALIASED";');
  const baseline = await nativeBuild({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs',
    target: 'node20', write: false, tsconfig: path.join(pack, 'tsconfig.json') });
  const expected = evaluate(baseline.outputFiles[0]!.text);
  expect(expected).toMatchObject({ value: 'ALIASED' });
  const compilation = captureCompilationInputs(pack);
  compilation.captureGenerated();
  const globFile = path.join(root, 'external/parts/one.cjs');
  const original = fs.readFileSync(globFile);
  try {
    fs.writeFileSync(globFile, 'exports.value = "WRONG";');
    const output = path.join(pack, 'dist');
    const result = await bundlePackRuntime(pack, output, { compilation });
    expect(result.success, result.error).toBe(true);
    expect(evaluate(fs.readFileSync(path.join(output, 'runtime/index.cjs'), 'utf8'))).toEqual(expected);
    fs.writeFileSync(globFile, original);
    compilation.assertCurrent();
  } finally { fs.writeFileSync(globFile, original); compilation.dispose(); }
});

it('preserves implicit per-file transforms for absolute module imports and leaves data strings intact', async () => {
  const { root, pack, entry, write } = fixture(false);
  fs.unlinkSync(path.join(pack, 'tsconfig.json'));
  write('tsconfig.json', { extends: ['./configs/base.json', './configs/overrides.json'], compilerOptions: { noLib: true, types: [] } });
  const external = path.join(root, 'external/absolute.tsx');
  write('external/absolute.tsx', `const element = () => "ALIASED"; export const value = <div />; export default function compile() { return value; } export const sourcePath = ${JSON.stringify(external)};`);
  const input = path.join(pack, 'src/input.tsx');
  fs.writeFileSync(input, fs.readFileSync(input, 'utf8').replace("import {value} from 'outside'", `import {value, sourcePath} from ${JSON.stringify(external)}`).replace("value, jsx:", "value, sourcePath, jsx:"));
  const baseline = await nativeBuild({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', target: 'node20', write: false });
  const expected = evaluate(baseline.outputFiles[0]!.text);
  expect(expected).toMatchObject({ value: 'ALIASED', sourcePath: external });
  const compilation = captureCompilationInputs(pack);
  compilation.captureGenerated();
  try {
    const output = path.join(pack, 'dist');
    const result = await bundlePackRuntime(pack, output, { compilation });
    expect(result.success, result.error).toBe(true);
    expect(evaluate(fs.readFileSync(path.join(output, 'runtime/index.cjs'), 'utf8'))).toEqual(expected);
    const compilers = await bundlers.bundlePackContentCompilers(pack, output, { absolute: external }, { compilation });
    expect(compilers.success, compilers.error).toBe(true);
    const loaded = await import(pathToFileURL(path.join(output, 'build/content-compilers.mjs')).href);
    expect(loaded.absolute()).toBe('ALIASED');
    const map = JSON.parse(fs.readFileSync(path.join(output, 'runtime/index.cjs.map'), 'utf8'));
    expect(JSON.stringify(map)).not.toContain('apack-inputs-');
    expect(map.sourcesContent).toContain(fs.readFileSync(input, 'utf8'));
    expect(map.sourcesContent).toContain(fs.readFileSync(external, 'utf8'));
    const before = ['index.cjs', 'index.cjs.map'].map(file => fs.readFileSync(path.join(output, 'runtime', file)));
    const repeated = captureCompilationInputs(pack);
    repeated.captureGenerated();
    try {
      const result = await bundlePackRuntime(pack, output, { compilation: repeated });
      expect(result.success, result.error).toBe(true);
      ['index.cjs', 'index.cjs.map'].forEach((file, index) =>
        expect(fs.readFileSync(path.join(output, 'runtime', file))).toEqual(before[index]));
    } finally { repeated.dispose(); }

  } finally { compilation.dispose(); }
});
