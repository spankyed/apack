import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { _declarationRevision, PACK_SNAPSHOT_FORMAT } from '@apackdev/pack-format';
import { sealPackBuild, stagedFileHashes, verifyPack } from '@apackdev/host/packs';
import { createPackCompilerInputView } from '@apackdev/host/build/compiler-inputs';
import { readPackageInputs } from '@apackdev/host/build/package-inputs';
import { PACK_BUILD_INPUTS_FILE, writePackBuildInputs } from '@apackdev/host/build/pack-build-inputs';
import { assertPrebuiltPackCurrent, packArchiveAcceptance } from '../src/prebuilt-pack.ts';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));

function fixture(options: string[] = []) {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-prebuilt-test-')));
  roots.push(temporary);
  const root = path.join(temporary, 'pack');
  const dist = path.join(root, 'dist');
  fs.mkdirSync(path.join(dist, 'runtime'), { recursive: true });
  fs.mkdirSync(path.join(dist, 'types'), { recursive: true });
  const manifest = { id: 'prebuilt-test', name: 'Prebuilt test', version: '1.0.0' };
  const source = path.join(root, 'source.txt');
  const external = path.join(temporary, 'external.txt');
  fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { dependency: '1.0.0' } }));
  const dependencyDirectory = path.join(root, 'node_modules/dependency');
  fs.mkdirSync(dependencyDirectory, { recursive: true });
  fs.writeFileSync(path.join(dependencyDirectory, 'package.json'), JSON.stringify({ name: 'dependency', version: '1.0.0', main: 'index.js' }));
  const dependency = path.join(dependencyDirectory, 'index.js');
  fs.writeFileSync(dependency, 'module.exports = 1;');
  const unread = path.join(dependencyDirectory, 'README.md');
  fs.writeFileSync(unread, 'Not read by any compiler');
  fs.writeFileSync(source, 'FIRST');
  fs.writeFileSync(external, 'EXTERNAL');
  fs.symlinkSync(external, path.join(root, 'linked.txt'));
  const runtime = path.join(dist, 'runtime/index.cjs');
  fs.writeFileSync(runtime, 'throw new Error("Prebuilt checks must not activate the pack");');
  fs.writeFileSync(path.join(dist, 'types/snapshot.json'), JSON.stringify({
    format: PACK_SNAPSHOT_FORMAT, declarationRevision: _declarationRevision(manifest), manifest,
    types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {},
  }));
  const view = createPackCompilerInputView(root);
  view.readBytes(source);
  view.readBytes(path.join(root, 'linked.txt'));
  view.readBytes(dependency);
  const observations = view.observations().entries;
  view.dispose();
  const packages = readPackageInputs([{ id: 'pack', directory: root }], { dependencyContents: 'resolution' });
  writePackBuildInputs(dist, { compiler: 'a'.repeat(64), execution: 'b'.repeat(64), options,
    packages: { hash: packages.hash, owners: [{ id: 'pack', directory: '' }], discovered: [] }, observations });
  sealPackBuild(dist, manifest);
  return { root, dist, source, external, dependency, unread };
}

it('accepts timestamp touches and exact restoration, but refuses same-mtime source edits', () => {
  const { root, source } = fixture();
  const stat = fs.statSync(source);
  fs.utimesSync(source, new Date(), new Date());
  expect(() => assertPrebuiltPackCurrent(root, false)).not.toThrow();
  fs.writeFileSync(source, 'OTHER');
  fs.utimesSync(source, stat.atime, stat.mtime);
  expect(() => assertPrebuiltPackCurrent(root, false)).toThrow(/input changed.*apack pack build/s);
  fs.writeFileSync(source, 'FIRST');
  expect(() => assertPrebuiltPackCurrent(root, false)).not.toThrow();
});

it('refuses changed linked inputs and source membership without rebuilding', () => {
  const { root, external } = fixture();
  fs.writeFileSync(external, 'REPLACED');
  expect(() => assertPrebuiltPackCurrent(root, false)).toThrow(/input changed/);
  fs.writeFileSync(external, 'EXTERNAL');
  fs.writeFileSync(path.join(root, 'added.txt'), 'added');
  expect(() => assertPrebuiltPackCurrent(root, false)).toThrow(/input changed/);
  fs.rmSync(path.join(root, 'added.txt'));
  expect(() => assertPrebuiltPackCurrent(root, false)).not.toThrow();
});

it('refuses missing or modified output and missing or modified input metadata', () => {
  for (const target of ['runtime/index.cjs', PACK_BUILD_INPUTS_FILE]) {
    const { root, dist } = fixture();
    const file = path.join(dist, target);
    const bytes = fs.readFileSync(file);
    fs.appendFileSync(file, 'altered');
    expect(() => assertPrebuiltPackCurrent(root, false)).toThrow(/verification.*apack pack build/s);
    fs.rmSync(file);
    expect(() => assertPrebuiltPackCurrent(root, false)).toThrow(/verification.*apack pack build/s);
    fs.writeFileSync(file, bytes);
    expect(() => assertPrebuiltPackCurrent(root, false)).not.toThrow();
  }
});

it('requires release options only when the test invocation requests release output', () => {
  const development = fixture();
  expect(() => assertPrebuiltPackCurrent(development.root, true)).toThrow(/requires a --release build.*build --release/s);
  const release = fixture(['--skip-generate', '--release']);
  expect(() => assertPrebuiltPackCurrent(release.root, true)).not.toThrow();
  expect(() => assertPrebuiltPackCurrent(release.root, false)).not.toThrow();
});

it('refuses changed dependency bytes and a missing build before launching the app', () => {
  const { root, dist, dependency, unread } = fixture();
  // A dependency file no compiler read is not an input; its package's membership is
  fs.writeFileSync(unread, 'Edited');
  expect(() => assertPrebuiltPackCurrent(root, false)).not.toThrow();
  fs.writeFileSync(path.join(path.dirname(dependency), 'added.js'), 'module.exports = 3;');
  expect(() => assertPrebuiltPackCurrent(root, false)).toThrow(/input changed.*package-entries.*node_modules\/dependency/);
  fs.rmSync(path.join(path.dirname(dependency), 'added.js'));
  const bytes = fs.readFileSync(dependency);
  const stat = fs.statSync(dependency);
  fs.writeFileSync(dependency, 'module.exports = 2;');
  fs.utimesSync(dependency, stat.atime, stat.mtime);
  expect(() => assertPrebuiltPackCurrent(root, false)).toThrow(/input changed.*node_modules\/dependency\/index.js/);
  fs.writeFileSync(dependency, bytes);
  expect(() => assertPrebuiltPackCurrent(root, false)).not.toThrow();
  fs.rmSync(dist, { recursive: true });
  expect(() => assertPrebuiltPackCurrent(root, false)).toThrow(/Cannot test the prebuilt pack.*apack pack build/s);
});

it('accepts only the selected published bytes and rechecks inputs at archive installation', () => {
  const { root, dist, source } = fixture();
  const accept = packArchiveAcceptance(root, false)!;
  const built = verifyPack(dist);
  const integrity = { ...built, files: stagedFileHashes(built) };
  expect(() => accept({ integrity })).not.toThrow();
  expect(() => accept({ integrity: { ...integrity, files: { ...integrity.files, 'runtime/index.cjs': '0'.repeat(64) } } }))
    .toThrow(/PACK_ARCHIVE does not match/);
  fs.writeFileSync(source, 'CHANGED');
  expect(() => accept({ integrity })).toThrow(/input changed/);
  fs.rmSync(dist, { recursive: true });
  expect(packArchiveAcceptance(root, false)).toBeUndefined();
  expect(() => packArchiveAcceptance(root, true)).toThrow(/requires a local --release build/);
});
