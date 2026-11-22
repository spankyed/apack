// What makes a phase's output reusable, and what must not. The gate's whole risk is answering "reusable"
// when it is not, so each case here is one way that could happen.
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createBuildOutputs } from '../../src/build/build-outputs.ts';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apackScope, dslInputsHash, filesUnder, reuseProblem, takeForward, typesInputsHash, readPhaseCache, writeStamps } from '../../src/build/phase-cache';
import { readDependencyBuild, sealPackBuild, PACK_LAYOUT } from '@apackdev/host/packs';
import { createPackCompilerInputView } from '@apackdev/host/build/compiler-inputs';
import { writePackBuildInputs } from '@apackdev/host/build/pack-build-inputs';
import { readPackageInputs } from '@apackdev/host/build/package-inputs';

import { _declarationRevision } from '@apackdev/sdk/build';

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


const dirs: string[] = [];

function tmp(files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-phase-cache-'));
  dirs.push(dir);
  for (const [file, body] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), body);
  }
  return dir;
}

function dependency(version: string) {
  const manifest = { id: 'dep', name: 'Dep', version };
  const dir = tmp({ [PACK_LAYOUT.snapshot]: JSON.stringify({ manifest, declarationRevision: _declarationRevision(manifest),
    types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {} }) });
  return new Map([['dep', readDependencyBuild(dir)]]);
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

it('invalidates every cached phase when captured compiler inputs change', () => {
  const root = tmp({ 'apack.json': '{"id":"p"}' });
  const phases = [scope => typesInputsHash(root, new Map(), scope), scope => dslInputsHash(root, '', new Map(), scope)] satisfies Array<(scope: typeof compilation) => string>;
  for (const hash of phases) expect(hash({ ...compilation, hash: 'after' })).not.toBe(hash(compilation));
});

describe('reuseProblem', () => {
  const stamp = { hash: 'h', files: ['runtime/fe.js'] };

  it('reuses when the hash matches and the output is there', () => {
    expect(reuseProblem(stamp, tmp({ 'runtime/fe.js': 'x' }), 'h')).toBeNull();
  });

  it('refuses a pack it has no record of', () => {
    expect(reuseProblem(undefined, tmp(), 'h')).toBe('no record of the last build');
  });

  it('refuses when the inputs moved', () => {
    expect(reuseProblem(stamp, tmp({ 'runtime/fe.js': 'x' }), 'other')).toBe('inputs changed');
  });

  it('refuses when a recorded output is gone, which the hash alone cannot see', () => {
    expect(reuseProblem(stamp, tmp(), 'h')).toBe('missing runtime/fe.js');
  });

  it('refuses a record of nothing, so an empty output set is never "reusable"', () => {
    expect(reuseProblem({ hash: 'h', files: [] }, tmp(), 'h')).toBe('recorded no output');
  });
});

describe('takeForward', () => {
  it('checks reused bytes against their verified receipt and retains their final output expectation', () => {
    const file = 'types/facade.d.ts';
    const dist = tmp({ [file]: 'FIRST' }), staged = tmp();
    const hashes = { [file]: createHash('sha256').update('FIRST').digest('hex') };
    const outputs = createBuildOutputs(staged);
    fs.writeFileSync(path.join(dist, file), 'OTHER');
    expect(() => takeForward(dist, staged, [file], { hashes, recordOutput: outputs.record })).toThrow(/Reusable output changed/);
    expect(filesUnder(staged)).toEqual([]);
    fs.writeFileSync(path.join(dist, file), 'FIRST');
    takeForward(dist, staged, [file], { hashes, recordOutput: outputs.record });
    expect(() => outputs.assertCurrent()).not.toThrow();
    fs.writeFileSync(path.join(staged, file), 'OTHER');
    expect(() => outputs.assertCurrent()).toThrow(/missing or changed/);
    expect(() => takeForward(dist, staged, ['../outside'], { hashes })).toThrow(/not in the verified receipt/);
  });

  it('puts the recorded output where the staged tree expects it', () => {
    const dist = tmp({ 'runtime/fe.js': 'bundle', 'runtime/chunks/a.js': 'chunk' });
    const staged = tmp();

    const files = ['runtime/fe.js', 'runtime/chunks/a.js'];
    const hashes = Object.fromEntries(files.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(dist, file))).digest('hex')]));
    takeForward(dist, staged, files, { hashes });

    expect(filesUnder(staged)).toEqual(['runtime/chunks/a.js', 'runtime/fe.js']);
    expect(fs.readFileSync(path.join(staged, 'runtime/chunks/a.js'), 'utf-8')).toBe('chunk');
  });
});

describe('cached input scopes', () => {
  const pack = () => tmp({ 'apack.json': '{"id":"p"}', 'src/a.ts': 'export const a = 1' });

  it('is the same for the same tree, so an untouched pack reuses', () => {
    const root = pack();
    expect(dslInputsHash(root, '', new Map(), compilation)).toBe(dslInputsHash(root, '', new Map(), compilation));
  });



  it('moves when a source changes', () => {
    const root = pack();
    const before = dslInputsHash(root, '', new Map(), compilation);
    fs.writeFileSync(path.join(root, 'src/a.ts'), 'export const a = 2');
    expect(dslInputsHash(root, '', new Map(), compilation)).not.toBe(before);
  });

  it.each(['assets/icon.svg', 'components/entry.vue', 'vite.config.mts', 'package-lock.json'])('invalidates for authored input %s outside the old source scope', file => {
    const root = pack();
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), 'before');
    const before = dslInputsHash(root, '', new Map(), compilation);
    fs.writeFileSync(path.join(root, file), 'after');
    expect(dslInputsHash(root, '', new Map(), compilation)).not.toBe(before);
  });

  it('ignores unrelated build output while including generated bundle entries', () => {
    const root = pack();
    const before = dslInputsHash(root, '', new Map(), compilation);
    fs.mkdirSync(path.join(root, '.apack'), { recursive: true });
    fs.writeFileSync(path.join(root, '.apack/cache.json'), '{}');
    fs.mkdirSync(path.join(root, 'dist/runtime'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dist/runtime/index.cjs'), 'output');
    expect(dslInputsHash(root, '', new Map(), compilation)).toBe(before);
    fs.mkdirSync(path.join(root, 'src/__generated__'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/__generated__/pack-entry-fe.ts'), 'new entry');
    expect(dslInputsHash(root, '', new Map(), compilation)).not.toBe(before);
  });



  it('moves when a package it compiles against changes, which is outside the pack', () => {
    const root = pack();
    const before = dslInputsHash(root, 'a'.repeat(64), new Map(), compilation);
    expect(dslInputsHash(root, 'b'.repeat(64), new Map(), compilation)).not.toBe(before);
  });

  it('ignores a touch, because the key is content and not a timestamp', () => {
    const root = pack();
    const before = dslInputsHash(root, '', new Map(), compilation);
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(root, 'src/a.ts'), later, later);
    expect(dslInputsHash(root, '', new Map(), compilation)).toBe(before);
  });
});

describe('phase identities and dependencies', () => {
  const pack = () => tmp({ 'apack.json': '{"id":"p"}', 'src/a.ts': 'export const a = 1' });

  it('the facade hash moves when a source changes', () => {
    const root = pack();
    const before = typesInputsHash(root, new Map(), compilation);
    fs.writeFileSync(path.join(root, 'src/a.ts'), 'export const a = 2');
    expect(typesInputsHash(root, new Map(), compilation)).not.toBe(before);
  });

  it("the facade hash moves when a dependency's snapshot does, which is what it compiles against", () => {
    const root = pack();
    expect(typesInputsHash(root, dependency('1.0.0'), compilation))
      .not.toBe(typesInputsHash(root, dependency('1.0.1'), compilation));
  });

  it('the DSL hash moves when the manifest changes, since its entries are what it reads', () => {
    const root = pack();
    const before = dslInputsHash(root, '', new Map(), compilation);
    fs.writeFileSync(path.join(root, 'apack.json'), '{"id":"p","dsl":{}}');
    expect(dslInputsHash(root, '', new Map(), compilation)).not.toBe(before);
  });

  it('gives each cached phase a distinct hash', () => {
    const root = pack();
    expect(new Set([typesInputsHash(root, new Map(), compilation), dslInputsHash(root, '', new Map(), compilation)]).size).toBe(2);
  });
});

it('refuses phase reuse when a previously consumed external input changes without an authored edit', () => {
  const root = tmp({ 'apack.json': '{"id":"cache-inputs","name":"Cache inputs","version":"1.0.0"}' });
  const external = tmp({ 'data.txt': 'FIRST' });
  const file = path.join(external, 'data.txt');
  const view = createPackCompilerInputView(root);
  view.readDataBytes(file);
  const observations = view.observations().entries;
  view.dispose();
  const dist = path.join(root, 'dist');
  const stamps = { types: { hash: 'phase', files: ['types/facade.d.ts'] } };
  fs.mkdirSync(path.join(dist, 'types'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'types/facade.d.ts'), 'export {};');
  writeStamps(dist, stamps);
  writePackBuildInputs(dist, { compiler: 'a'.repeat(64), execution: 'b'.repeat(64), options: [],
    packages: { hash: readPackageInputs([{ id: 'pack', directory: root }], { dependencyContents: 'resolution' }).hash,
      owners: [{ id: 'pack', directory: '' }], discovered: [] }, observations });
  sealPackBuild(dist, { id: 'cache-inputs', name: 'Cache inputs', version: '1.0.0' });
  expect(readPhaseCache(root).stamps).toEqual(stamps);
  fs.writeFileSync(file, 'OTHER');
  expect(readPhaseCache(root).stamps).toEqual({});
  fs.writeFileSync(file, 'FIRST');
  expect(readPhaseCache(root).stamps).toEqual(stamps);
});

describe('apackScope', () => {
  const manifest = (name: string, extra: object = {}) => JSON.stringify({ name, version: '0.1.0', files: ['dist'], ...extra });
  const installed = () => ({
    'package.json': JSON.stringify({ name: 'pack', version: '1.0.0' }),
    'node_modules/@apackdev/sdk/package.json': manifest('@apackdev/sdk', { dependencies: { '@elmdb/ears': '0.0.0' } }),
    'node_modules/@apackdev/sdk/dist/index.d.ts': 'export {};',
    // npm nested the SDK's EARS under it: nothing above the pack holds one
    'node_modules/@apackdev/sdk/node_modules/@elmdb/ears/package.json': manifest('@elmdb/ears'),
    'node_modules/@apackdev/sdk/node_modules/@elmdb/ears/dist/index.d.ts': 'export const v = 1;',
    'node_modules/@apackdev/ui/package.json': manifest('@apackdev/ui'),
    'node_modules/@apackdev/ui/dist/index.d.ts': 'export {};',
  });
  const hashOf = (pack: string) => {
    const scope = apackScope(pack);
    if (!('hash' in scope)) throw new Error(scope.missing.join('\n'));
    return scope.hash;
  };

  it("moves with what the SDK brings, which a pack that names only the SDK can't resolve itself", () => {
    const pack = tmp(installed());
    const before = hashOf(pack);
    fs.writeFileSync(path.join(pack, 'node_modules/@apackdev/sdk/node_modules/@elmdb/ears/dist/index.d.ts'), 'export const v = 2;');
    expect(hashOf(pack)).not.toBe(before);
  });

  it('reads what each package ships, not the rest of its directory', () => {
    const pack = tmp(installed());
    const before = hashOf(pack);
    fs.writeFileSync(path.join(pack, 'node_modules/@apackdev/sdk/node_modules/@elmdb/ears/notes.md'), 'not shipped');
    expect(hashOf(pack)).toBe(before);
  });

  it('is the same scope wherever the same packages are installed', () => {
    expect(hashOf(tmp(installed()))).toBe(hashOf(tmp(installed())));
  });

  it('names a package it cannot find, and who declared it, rather than leave it out of the scope', () => {
    const { 'node_modules/@apackdev/ui/package.json': _ui, ...withoutUi } = installed();
    expect(apackScope(tmp(withoutUi))).toEqual({ missing: [expect.stringMatching(/^@apackdev\/ui, declared by .*pack/)] });
    const withoutEars = Object.fromEntries(Object.entries(installed()).filter(([file]) => !file.includes('@elmdb/ears')));
    expect(apackScope(tmp(withoutEars))).toEqual({ missing: [expect.stringMatching(/^@elmdb\/ears, declared by @apackdev\/sdk/)] });
  });
});
