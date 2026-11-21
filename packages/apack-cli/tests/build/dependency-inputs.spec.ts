import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import * as sdkBuild from '@apackdev/sdk/build';
import { _declarationRevision, PACK_SNAPSHOT_FORMAT, PACK_TYPES_FACADE } from '@apackdev/sdk/build';
import { cacheDependency, readDependencyBuild, sealPackBuild, PACK_LAYOUT } from '@apackdev/host/packs';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { assertDependencyInputsCurrent, dependencyInputsHash } from '../../src/build/dependency-inputs.ts';
import { dslInputsHash, typesInputsHash } from '../../src/build/phase-cache.ts';
import { dependencyTypes } from '../../src/commands/generate.ts';
import { assertGeneratedCurrent, generateEntries } from '../../src/commands/generate-entries.ts';
import { bundlePackTypes } from '../../src/build/types-bundler.ts';

const compilation = {
  hash: 'test-compiler',
  configuration: undefined,
  declarationConfiguration: undefined,
  readTree() { throw new Error('No tree in hash-only fixture'); },
  sourcePath(file: string) { return file; },
  diagnostic(message: string) { return message; },
  isInput() { return true; },
  prepareNative() {},
  requireParent() { throw new Error('No module loading in hash-only fixture'); },
  nativeModule() { throw new Error('No native module loading in hash-only fixture'); },
  retainInputs() {},
  async finish(): Promise<never> { throw new Error('No completion in hash-only fixture'); },
  prepareNativeSource() {},
  readMetadata(): never { throw new Error('Unexpected metadata read'); },
  openDirectory(): never { throw new Error('Unexpected directory open'); },
  readDirectory(): never { throw new Error('Unexpected directory read'); },
  readDataPath(): never { throw new Error('Unexpected data read'); },
  dispose() {},
  readFile() { return undefined; },
  captureGenerated() {},
  assertCurrent() {},
};


const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); });
function producer() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-dependency-inputs-'));
  roots.push(directory);
  const manifest = { id: 'dep-pack', name: 'Dependency', version: '1.0.0' };
  fs.mkdirSync(path.join(directory, 'types'));
  fs.mkdirSync(path.join(directory, 'build'));
  fs.writeFileSync(path.join(directory, PACK_LAYOUT.snapshot), JSON.stringify({ manifest,
    declarationRevision: _declarationRevision(manifest), format: PACK_SNAPSHOT_FORMAT,
    types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {} }));
  fs.writeFileSync(path.join(directory, 'build/helper.js'), 'throw new Error("Do not activate for hashing");');
  sealPackBuild(directory, manifest);
  return { directory, manifest, capture: () => new Map([['dep-pack', readDependencyBuild(directory)]]) };
}

it('moves every cached phase for a same-version helper change with identical snapshots', () => {
  const pack = producer(), dependency = producer();
  const first = dependency.capture();
  fs.appendFileSync(path.join(dependency.directory, 'build/helper.js'), '\n// changed build code\n');
  sealPackBuild(dependency.directory, dependency.manifest);
  const second = dependency.capture();
  expect(second.get('dep-pack')!.snapshot).toEqual(first.get('dep-pack')!.snapshot);
  expect(dependencyInputsHash(second)).not.toBe(dependencyInputsHash(first));
  for (const hash of [files => typesInputsHash(pack.directory, files, compilation),
    files => dslInputsHash(pack.directory, '', files, compilation)] satisfies Array<(files: typeof first) => string>) {
    expect(hash(second)).not.toBe(hash(first));
  }
  expect(() => assertDependencyInputsCurrent(first)).toThrow('changed during the build');
  expect(() => assertDependencyInputsCurrent(second)).not.toThrow();
});

it.each(['changed', 'missing', 'extra'])('refuses %s dependency bytes before publication', change => {
  const dependency = producer(), captured = dependency.capture();
  const file = path.join(dependency.directory, 'build/helper.js');
  if (change === 'changed') fs.appendFileSync(file, '\n// modified\n');
  else if (change === 'missing') fs.rmSync(file);
  else fs.writeFileSync(path.join(dependency.directory, 'build/extra.js'), 'extra');
  expect(() => assertDependencyInputsCurrent(captured)).toThrow('failed verification');
});

it('retains a pinned build when another resolution is selected and ignores delivery paths', () => {
  const dependency = producer(), consumer = producer();
  const origin = { kind: 'file', directory: dependency.directory, selection: 'fixture' } as const;
  const first = cacheDependency(consumer.directory, 'dep-pack', dependency.directory, '^1.0.0', origin);
  const captured = new Map([['dep-pack', readDependencyBuild(first.directory)]]);
  expect(dependencyInputsHash(captured)).toBe(dependencyInputsHash(dependency.capture()));
  fs.appendFileSync(path.join(dependency.directory, 'build/helper.js'), '\n// new build\n');
  sealPackBuild(dependency.directory, dependency.manifest);
  cacheDependency(consumer.directory, 'dep-pack', dependency.directory, '^1.0.0', origin);
  expect(() => assertDependencyInputsCurrent(captured)).not.toThrow();
});

async function generatedConsumer() {
  const pack = producer(), dependency = producer();
  // Generation requires a real producer facade. Build it in a source tree outside the sealed layout.
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-input-facade-'));
  roots.push(source);
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(source, 'node_modules'), 'dir');
  for (const [file, content] of Object.entries(await sdkBuild.generatePackFiles(dependency.manifest, { packRoot: source }))) {
    const target = path.join(source, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  const facade = await bundlePackTypes(source, path.join(source, 'facade.d.ts'));
  if (!facade.success) throw new Error(facade.error);
  const snapshot = dependency.capture().get('dep-pack')!.snapshot;
  snapshot.facades[PACK_TYPES_FACADE] = facade.content;
  fs.writeFileSync(path.join(dependency.directory, PACK_LAYOUT.snapshot), JSON.stringify(snapshot));
  sealPackBuild(dependency.directory, dependency.manifest);
  const manifest = { id: 'consumer', name: 'Consumer', version: '1.0.0', dependencies: { 'dep-pack': '^1.0.0' } };
  fs.writeFileSync(path.join(pack.directory, 'apack.json'), JSON.stringify(manifest));
  const dependencies = dependencyTypes(dependency.capture());
  await generateEntries([], pack.directory, dependencies, compilation);
  return { pack, dependency, manifest, dependencies, generated: path.join(pack.directory, 'src/__generated__') };
}

it('rejects skipped generation for a newly resolved helper revision with unchanged declarations', async () => {
  const { pack, dependency, manifest, generated } = await generatedConsumer();
  const ears = fs.readFileSync(path.join(generated, 'ears.ts'));
  const stamp = fs.readFileSync(path.join(pack.directory, '.apack/generate-entries.json'));
  fs.appendFileSync(path.join(dependency.directory, 'build/helper.js'), '\n// new helper\n');
  sealPackBuild(dependency.directory, dependency.manifest);
  const dependencies = dependencyTypes(dependency.capture());
  expect(() => assertGeneratedCurrent(pack.directory, manifest, dependencies, compilation)).toThrow('inputs changed');
  await generateEntries([], pack.directory, dependencies, compilation);
  expect(fs.readFileSync(path.join(generated, 'ears.ts'))).toEqual(ears);
  expect(fs.readFileSync(path.join(pack.directory, '.apack/generate-entries.json'))).not.toEqual(stamp);
  expect(() => assertGeneratedCurrent(pack.directory, manifest, dependencies, compilation)).not.toThrow();
});

it('preserves generated files and their stamp if dependency bytes change during async generation', async () => {
  const { pack, dependency, dependencies, generated } = await generatedConsumer();
  const ears = fs.readFileSync(path.join(generated, 'ears.ts'));
  const stamp = fs.readFileSync(path.join(pack.directory, '.apack/generate-entries.json'));
  const generate = sdkBuild.generatePackFiles;
  vi.spyOn(sdkBuild, 'generatePackFiles').mockImplementationOnce(async (...args) => {
    const files = await generate(...args);
    fs.appendFileSync(path.join(dependency.directory, 'build/helper.js'), '\n// raced\n');
    return files;
  });
  await expect(generateEntries(['--force'], pack.directory, dependencies, compilation)).rejects.toThrow('failed verification');
  expect(fs.readFileSync(path.join(generated, 'ears.ts'))).toEqual(ears);
  expect(fs.readFileSync(path.join(pack.directory, '.apack/generate-entries.json'))).toEqual(stamp);
});

it('refuses an incomplete resolution frame before writing generated files', async () => {
  const { pack } = await generatedConsumer();
  const stamp = fs.readFileSync(path.join(pack.directory, '.apack/generate-entries.json'));
  await expect(generateEntries(['--force'], pack.directory, dependencyTypes(new Map()), compilation))
    .rejects.toThrow('Resolved dependencies differ from apack.json');
  expect(fs.readFileSync(path.join(pack.directory, '.apack/generate-entries.json'))).toEqual(stamp);
});
