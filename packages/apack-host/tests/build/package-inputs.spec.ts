import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import { createPackageDigestCache, readFileDigest, readPackageInputs, readPackageInputsAsync } from '../../src/build/package-inputs.ts';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); });
function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-npm-inputs-'));
  roots.push(root);
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  const manifest = (directory: string, fields: object) => write(`${directory}/package.json`, JSON.stringify(fields));
  manifest('.', { name: 'consumer', dependencies: { compiler: '*' } });
  manifest('node_modules/compiler', { name: 'compiler', version: '1.0.0', exports: { '.': './index.js' }, dependencies: { helper: '*' } });
  manifest('node_modules/helper', { name: 'helper', version: '1.0.0' });
  write('node_modules/compiler/index.js', 'throw new Error("Never activate to hash packages");');
  write('node_modules/helper/index.js', 'export const value = 1;');
  return { root, write, manifest, hash: () => readPackageInputs([{ id: 'pack', directory: root, development: true }]).hash };
}

it('keeps async inventory, bytes, probes and callback order identical to synchronous reads', async () => {
  const pack = tree();
  const owners = [{ id: 'compiler', directory: pack.root, development: true, contents: true }];
  const capture = () => {
    const events: unknown[] = [];
    return { events, options: {
      observe: (file: string, kind: string) => { events.push(['probe', file, kind]); },
      onDirectory: (file: string, names: readonly string[]) => { events.push(['directory', file, [...names]]); },
      onFile: (file: unknown, bytes: Buffer) => { events.push(['file', file, bytes.toString('hex')]); },
    } };
  };
  const sync = capture(), asynchronous = capture();
  const expected = readPackageInputs(owners, sync.options);
  expect(await readPackageInputsAsync(owners, asynchronous.options)).toEqual(expected);
  expect(asynchronous.events).toEqual(sync.events);
});

it('accepts cancellation between async file reads instead of blocking through the inventory', async () => {
  const pack = tree();
  const stopped = new AbortController();
  let files = 0;
  const reading = readPackageInputsAsync([{ id: 'compiler', directory: pack.root, contents: true }], {
    signal: stopped.signal,
    onFile() { if (++files === 1) setImmediate(() => stopped.abort()); },
  });
  await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
  expect(files).toBe(1);
});

it('hashes blocked package metadata and transitive helper bytes without loading code', () => {
  const pack = tree();
  expect(() => createRequire(path.join(pack.root, 'package.json')).resolve('compiler/package.json')).toThrow();
  const before = pack.hash();
  const helper = path.join(pack.root, 'node_modules/helper/index.js');
  const stat = fs.statSync(helper);
  pack.write('node_modules/helper/index.js', 'export const value = 2;');
  fs.utimesSync(helper, stat.atime, stat.mtime);
  expect(pack.hash()).not.toBe(before);
});

it.each(['types.d.ts', 'data.json', 'styles.css', 'native.node'])('includes installed package input %s and its addition/removal', file => {
  const pack = tree(), target = `node_modules/compiler/${file}`;
  const before = pack.hash();
  pack.write(target, 'before');
  const added = pack.hash();
  expect(added).not.toBe(before);
  pack.write(target, 'after');
  expect(pack.hash()).not.toBe(added);
  fs.rmSync(path.join(pack.root, target));
  expect(pack.hash()).toBe(before);
});

it('follows package-local overrides and observes changes to resolution edges', () => {
  const pack = tree(), before = pack.hash();
  pack.manifest('node_modules/compiler/node_modules/helper', { name: 'helper', version: '1.0.0' });
  pack.write('node_modules/compiler/node_modules/helper/index.js', 'export const value = 3;');
  expect(pack.hash()).not.toBe(before);
  const overridden = pack.hash();
  pack.write('node_modules/helper/index.js', 'unresolved parent changes');
  expect(pack.hash()).toBe(overridden);
  pack.write('node_modules/compiler/node_modules/helper/index.js', 'changed local helper');
  expect(pack.hash()).not.toBe(overridden);
});

it('records absent optional packages and current conditional export changes', () => {
  const pack = tree();
  pack.manifest('node_modules/compiler', { name: 'compiler', optionalDependencies: { optional: '*' },
    exports: { import: './index.js', require: './other.cjs', types: './types.d.ts' } });
  const before = pack.hash();
  pack.manifest('node_modules/optional', { name: 'optional', version: '1.0.0' });
  expect(pack.hash()).not.toBe(before);
  const installed = pack.hash();
  pack.manifest('node_modules/compiler', { name: 'compiler', optionalDependencies: { optional: '*' }, exports: './index.js' });
  expect(pack.hash()).not.toBe(installed);
});

it('is independent of checkout paths and touches, and excludes root build output', () => {
  const first = tree(), second = tree();
  fs.utimesSync(path.join(second.root, 'node_modules/helper/index.js'), new Date(), new Date(Date.now() + 60_000));
  second.write('dist/runtime/index.cjs', 'consumer output');
  expect(first.hash()).toBe(second.hash());
});

it('bounds workspace inputs by source exports and published roots, including globbed data roots', () => {
  const pack = tree();
  pack.manifest('node_modules/compiler', { name: 'compiler', exports: { '.': { '@apackdev/source': './src/index.ts', default: './dist/index.js' } }, files: ['dist', 'data/*.json'] });
  pack.write('node_modules/compiler/src/index.ts', 'source');
  pack.write('node_modules/compiler/dist/index.js', 'published');
  pack.write('node_modules/compiler/data/schema.json', '{}');
  const before = pack.hash();
  pack.write('node_modules/compiler/.temp/scratch.js', 'scratch');
  pack.write('node_modules/compiler/tests/test.ts', 'test');
  expect(pack.hash()).toBe(before);
  pack.write('node_modules/compiler/data/schema.json', '{"changed":true}');
  expect(pack.hash()).not.toBe(before);
});

it('does not recurse through dependency cycles or include root output via a cycle', () => {
  const pack = tree();
  pack.manifest('node_modules/helper', { name: 'helper', dependencies: { consumer: '*' } });
  fs.symlinkSync(pack.root, path.join(pack.root, 'node_modules/consumer'), 'dir');
  const before = pack.hash();
  pack.write('dist/output.js', 'new output');
  expect(pack.hash()).toBe(before);
});

it('preserves development dependency coverage for a root first reached through another root', () => {
  const pack = tree();
  const owner = path.join(pack.root, 'node_modules/compiler');
  pack.manifest('node_modules/compiler', { name: 'compiler', devDependencies: { helper: '*' } });
  const hash = () => readPackageInputs([{ id: 'pack', directory: pack.root }, { id: 'compiler', directory: owner, development: true }]).hash;
  const before = hash();
  pack.write('node_modules/helper/index.js', 'changed root development dependency');
  expect(hash()).not.toBe(before);
});

it('rejects workspace source and file declarations escaping their package owner', () => {
  const pack = tree();
  pack.manifest('node_modules/compiler', { name: 'compiler', exports: { '@apackdev/source': './src/index.ts' }, files: ['../outside'] });
  expect(pack.hash).toThrow('escape its owner');
  pack.manifest('node_modules/compiler', { name: 'compiler', exports: { '@apackdev/source': './../outside.js' } });
  expect(pack.hash).toThrow('escape its owner');
});

it('includes discovered undeclared packages and their transitive dependencies', () => {
  const pack = tree();
  pack.manifest('.', { name: 'consumer' });
  const library = path.join(pack.root, 'node_modules/compiler');
  const hash = () => readPackageInputs([{ id: 'pack', directory: pack.root }], { discovered: [library] }).hash;
  const before = hash();
  pack.write('node_modules/helper/index.js', 'changed undeclared transitive helper');
  expect(hash()).not.toBe(before);
});

it('excludes consuming owners nested inside a discovered package scope', () => {
  const pack = tree();
  const consumer = path.join(pack.root, 'consumer');
  pack.manifest('consumer', { name: 'nested-consumer' });
  const hash = () => readPackageInputs([{ id: 'pack', directory: consumer }], { discovered: [pack.root] }).hash;
  const before = hash();
  pack.write('consumer/dist/runtime/index.js', 'new output');
  expect(hash()).toBe(before);
  pack.write('library.js', 'actual library input');
  expect(hash()).not.toBe(before);
});

it('exposes the resolved graph, copied bytes and blocked exports without activation', () => {
  const pack = tree();
  const copies = new Map<string, string>();
  const inputs = readPackageInputs([{ id: 'compiler', directory: pack.root, contents: true }], {
    onFile(file, bytes) { copies.set(file.source, bytes.toString()); },
  });
  const owner = inputs.nodes[inputs.roots[0]!.node]!;
  const compiler = inputs.nodes[owner.dependencies.compiler!]!;
  const helper = inputs.nodes[compiler.dependencies.helper!]!;
  expect(compiler.directory).toBe(fs.realpathSync.native(path.join(pack.root, 'node_modules/compiler')));
  expect(helper.files.map(file => file.path)).toContain('index.js');
  expect(copies.get(path.join(helper.directory, 'index.js'))).toBe('export const value = 1;');
});

it('tracks linked targets and empty directory membership', () => {
  const pack = tree();
  pack.write('node_modules/compiler/first.cjs', 'same bytes');
  pack.write('node_modules/compiler/second.cjs', 'same bytes');
  const link = path.join(pack.root, 'node_modules/compiler/linked.cjs');
  fs.symlinkSync('first.cjs', link);
  const first = pack.hash();
  fs.unlinkSync(link);
  fs.symlinkSync('second.cjs', link);
  expect(pack.hash()).not.toBe(first);
  const linked = pack.hash();
  fs.mkdirSync(path.join(pack.root, 'node_modules/compiler/empty'));
  expect(pack.hash()).not.toBe(linked);
});

it.skipIf(process.platform === 'win32')('tracks changes to POSIX package executable permissions', () => {
  const pack = tree();
  const before = pack.hash();
  fs.chmodSync(path.join(pack.root, 'node_modules/compiler/index.js'), 0o755);
  expect(pack.hash()).not.toBe(before);
});

it('preserves physical file origins through nested directory and file links', () => {
  const pack = tree();
  pack.write('outside/nested/value.cjs', 'module.exports = 1;');
  pack.write('replacement/nested/value.cjs', 'module.exports = 1;');
  const source = fs.realpathSync.native(path.join(pack.root, 'outside/nested/value.cjs'));
  fs.chmodSync(source, 0o755);
  const mode = fs.statSync(source).mode & 0o777;
  fs.chmodSync(path.join(pack.root, 'replacement/nested/value.cjs'), 0o755);
  fs.symlinkSync('value.cjs', path.join(pack.root, 'outside/nested/alias.cjs'));
  fs.symlinkSync('value.cjs', path.join(pack.root, 'replacement/nested/alias.cjs'));
  const link = path.join(pack.root, 'node_modules/compiler/assets');
  fs.symlinkSync('../../outside', link, 'dir');
  const copies = new Map<string, string>();
  const inputs = readPackageInputs([{ id: 'pack', directory: pack.root }], {
    onFile(file, bytes) { copies.set(file.source, bytes.toString()); },
  });
  const compiler = inputs.nodes[inputs.nodes[0]!.dependencies.compiler!]!;
  for (const name of ['value.cjs', 'alias.cjs']) {
    expect(compiler.files.find(file => file.path === `assets/nested/${name}`)).toMatchObject({ source, mode });
  }
  expect(copies.get(source)).toBe('module.exports = 1;');
  expect(pack.hash()).toBe(inputs.hash);
  fs.unlinkSync(link);
  fs.symlinkSync('../../replacement', link, 'dir');
  expect(pack.hash()).not.toBe(inputs.hash);
});

it('includes root contents when any logical owner requests them', () => {
  const pack = tree();
  const hash = () => readPackageInputs([
    { id: 'metadata', directory: pack.root },
    { id: 'compiler', directory: pack.root, contents: true },
  ]).hash;
  const before = hash();
  pack.write('compiler.js', 'changed compiler implementation');
  expect(hash()).not.toBe(before);
});

it('preserves dependency names that collide with Object.prototype', () => {
  const pack = tree();
  pack.manifest('.', { dependencies: { ['__proto__']: '*', constructor: '*' } });
  for (const name of ['__proto__', 'constructor']) {
    pack.manifest(`node_modules/${name}`, { name });
    pack.write(`node_modules/${name}/index.js`, name);
  }
  const inputs = readPackageInputs([{ id: 'pack', directory: pack.root }]);
  expect(Object.keys(inputs.nodes[0]!.dependencies)).toEqual(['__proto__', 'constructor']);
  expect(Object.keys(inputs.nodes[0]!.lookups)).toEqual(['__proto__', 'constructor']);
  const before = pack.hash();
  pack.write('node_modules/__proto__/index.js', 'changed dependency');
  expect(pack.hash()).not.toBe(before);
});

it('includes dangling link membership and detects when its target appears', () => {
  const pack = tree();
  const before = pack.hash();
  fs.symlinkSync('missing.cjs', path.join(pack.root, 'node_modules/compiler/optional.cjs'));
  const dangling = pack.hash();
  expect(dangling).not.toBe(before);
  pack.write('node_modules/compiler/missing.cjs', 'module.exports = 1;');
  expect(pack.hash()).not.toBe(dangling);
});

it('in resolution mode reads only what resolvers read directly, and keeps every package file\'s membership', () => {
  const pack = tree();
  pack.write('node_modules/helper/tsconfig.base.json', '{}');
  const read = () => {
    const files: string[] = [];
    const inputs = readPackageInputs([{ id: 'pack', directory: pack.root, development: true }], {
      dependencyContents: 'resolution', onFile: file => { files.push(path.basename(file.source)); },
    });
    return { files: [...new Set(files)].sort(), hash: inputs.hash, unread: inputs.nodes.flatMap(node => node.unread) };
  };
  const before = read();
  expect(before.files).toEqual(['package.json', 'tsconfig.base.json']);
  expect(before.unread.sort()).toEqual(['index.js', 'index.js']);
  pack.write('node_modules/helper/index.js', 'export const value = 2;');
  expect(read().hash).toBe(before.hash);
  pack.write('node_modules/helper/tsconfig.base.json', '{"compilerOptions":{}}');
  expect(read().hash).not.toBe(before.hash);
  pack.write('node_modules/helper/tsconfig.base.json', '{}');
  pack.write('node_modules/helper/added.js', '');
  expect(read().hash).not.toBe(before.hash);
});

it('reads an owner\'s graph whole when that owner asks for it, whatever the default', () => {
  const pack = tree();
  const inputs = readPackageInputs([{ id: 'compiler', directory: pack.root, dependencyContents: 'all' }], { dependencyContents: 'resolution' });
  const dependencies = inputs.nodes.filter(node => node.directory !== fs.realpathSync.native(pack.root));
  expect(dependencies.map(node => node.contents)).toEqual(['all', 'all']);
  expect(dependencies.flatMap(node => node.unread)).toEqual([]);
});

/** A reader whose clock runs a minute ahead, so a fixture written a moment ago counts as long unwritten. */
const settledDigests = () => createPackageDigestCache(() => Date.now() + 60_000);
const readsOf = (reads: { mock: { calls: unknown[][] } }, file: string) => reads.mock.calls.filter(([read]) => read === file).length;

it('answers with kept digests exactly as a fresh read does, through every kind of edit', () => {
  const pack = tree();
  const owners = [{ id: 'compiler', directory: pack.root, development: true, contents: true }];
  const digests = settledDigests();
  const agrees = () => expect(readPackageInputs(owners, { digests })).toEqual(readPackageInputs(owners));
  const helper = path.join(pack.root, 'node_modules/helper/index.js');
  agrees();
  const first = readPackageInputs(owners, { digests }).hash;
  pack.write('node_modules/helper/index.js', 'export const value = 1000;');
  agrees();
  // The same length, and a time of its own so the edit does not depend on how finely this filesystem keeps one
  pack.write('node_modules/helper/index.js', 'export const value = 2000;');
  fs.utimesSync(helper, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
  agrees();
  pack.write('node_modules/helper/replacement.js', 'export const value = 3000;');
  fs.renameSync(path.join(pack.root, 'node_modules/helper/replacement.js'), helper);
  agrees();
  pack.write('node_modules/helper/added.js', 'added');
  agrees();
  fs.rmSync(path.join(pack.root, 'node_modules/helper/added.js'));
  fs.chmodSync(helper, 0o755);
  agrees();
  fs.chmodSync(helper, 0o644);
  pack.write('node_modules/helper/index.js', 'export const value = 1;');
  expect(readPackageInputs(owners, { digests }).hash).toBe(first);
});

it('does not read a file again that nothing has touched, and reads one again that something has', async () => {
  const pack = tree();
  const owners = [{ id: 'compiler', directory: pack.root, development: true, contents: true }];
  const digests = settledDigests();
  const helper = fs.realpathSync.native(path.join(pack.root, 'node_modules/helper/index.js'));
  const compiler = fs.realpathSync.native(path.join(pack.root, 'node_modules/compiler/index.js'));
  const before = readPackageInputs(owners, { digests });
  const reads = vi.spyOn(fs, 'readFileSync');
  expect(readPackageInputs(owners, { digests })).toEqual(before);
  expect(readsOf(reads, helper) + readsOf(reads, compiler)).toBe(0);
  fs.writeFileSync(helper, 'export const value = 12345;');
  readPackageInputs(owners, { digests });
  expect([readsOf(reads, helper), readsOf(reads, compiler)]).toEqual([1, 0]);
  const yielding = vi.spyOn(fs.promises, 'readFile');
  expect((await readPackageInputsAsync(owners, { digests })).hash).toBe(readPackageInputs(owners).hash);
  expect(readsOf(yielding, helper) + readsOf(yielding, compiler)).toBe(0);
});

it('keeps no digest of a file written a moment before it was read', () => {
  const pack = tree();
  const owners = [{ id: 'compiler', directory: pack.root, development: true, contents: true }];
  const helper = fs.realpathSync.native(path.join(pack.root, 'node_modules/helper/index.js'));
  // A reader whose clock stands a second after the write, however long this machine took to get here
  const written = Math.max(fs.statSync(helper).mtimeMs, fs.statSync(helper).ctimeMs);
  const digests = createPackageDigestCache(() => written + 1_000);
  readPackageInputs(owners, { digests });
  const reads = vi.spyOn(fs, 'readFileSync');
  readPackageInputs(owners, { digests });
  expect(readsOf(reads, helper)).toBe(1);
});

it('hands a capture its bytes whatever digests are kept', () => {
  const pack = tree();
  const owners = [{ id: 'compiler', directory: pack.root, development: true, contents: true }];
  const digests = settledDigests();
  readPackageInputs(owners, { digests });
  const captured: string[] = [];
  readPackageInputs(owners, { digests, onFile: (file, bytes) => { captured.push(`${file.path}:${bytes.length}`); } });
  expect(captured).toContain('index.js:23');
});

it('digests one file through the same kept answers', () => {
  const pack = tree();
  const digests = settledDigests();
  const helper = path.join(pack.root, 'node_modules/helper/index.js');
  const first = readFileDigest(helper, digests);
  expect(first).toBe(readFileDigest(helper));
  const reads = vi.spyOn(fs, 'readFileSync');
  expect(readFileDigest(helper, digests)).toBe(first);
  expect(reads).not.toHaveBeenCalled();
  fs.writeFileSync(helper, 'export const value = 77;');
  expect(readFileDigest(helper, digests)).toBe(readFileDigest(helper));
});
