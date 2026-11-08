import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { createPackCompilerInputView } from '../../src/build/compiler-inputs/index.ts';
import { readPackageInputs } from '../../src/build/package-inputs.ts';
import { PACK_BUILD_INPUTS_FILE, writePackBuildInputs, readPackBuildInputs, assertPackBuildInputsCurrent,
  parsePackBuildInputs, type PackBuildInputs } from '../../src/build/pack-build-inputs.ts';
import { sealPackBuild, readPackBuild, stagePack, verifyPack, PACK_LAYOUT } from '../../src/packs/layout.ts';
import { writeInstalledPackFixture } from '../packs/runtime/build-fixture.ts';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-build-inputs-record-')));
  roots.push(root);
  const source = path.join(root, 'source.txt');
  fs.writeFileSync(source, 'FIRST');
  const manifest = { id: 'recorded', name: 'Recorded', version: '1.0.0' };
  fs.writeFileSync(path.join(root, PACK_LAYOUT.manifest), JSON.stringify(manifest));
  const view = createPackCompilerInputView(root);
  view.readBytes(source);
  const observations = view.observations().entries;
  view.dispose();
  const owners = [{ id: 'pack', directory: root }];
  const inputs: PackBuildInputs = { compiler: 'a'.repeat(64), execution: 'b'.repeat(64), options: [],
    packages: { hash: readPackageInputs(owners, { dependencyContents: 'resolution' }).hash, owners: [{ id: 'pack', directory: '' }], discovered: [] }, observations };
  const dist = path.join(root, 'dist');
  writeInstalledPackFixture(dist, manifest);
  fs.writeFileSync(path.join(root, PACK_LAYOUT.manifest), JSON.stringify(manifest));
  writePackBuildInputs(dist, inputs);
  sealPackBuild(dist, manifest);
  return { root, source, dist, manifest, inputs };
}

it('binds captured input bytes and output bytes through the same verified receipt', () => {
  const { root, dist, source, inputs } = fixture();
  expect(readPackBuildInputs(dist)).toEqual(inputs);
  expect(() => assertPackBuildInputsCurrent(root, inputs)).not.toThrow();
  const original = fs.statSync(source);
  fs.utimesSync(source, new Date(), new Date());
  expect(() => assertPackBuildInputsCurrent(root, inputs)).not.toThrow();
  fs.writeFileSync(source, 'OTHER');
  fs.utimesSync(source, original.atime, original.mtime);
  expect(() => assertPackBuildInputsCurrent(root, inputs)).toThrow(/input changed/);
  fs.writeFileSync(source, 'FIRST');
  expect(() => assertPackBuildInputsCurrent(root, inputs)).not.toThrow();
  fs.appendFileSync(path.join(dist, PACK_LAYOUT.runtimeEntry), '\n// altered output');
  expect(() => readPackBuildInputs(dist)).toThrow(/verification/);
});

it('refuses transplanted or malformed records and preserves source-free installed discovery', () => {
  const { root, dist, manifest, inputs } = fixture();
  const stage = path.join(root, 'stage');
  stagePack(root, stage);
  expect(fs.existsSync(path.join(stage, PACK_BUILD_INPUTS_FILE))).toBe(false);
  fs.rmSync(path.join(root, 'source.txt'));
  expect(readPackBuild(stage).snapshot.manifest.id).toBe(manifest.id);
  writePackBuildInputs(dist, { ...inputs, compiler: 'c'.repeat(64) });
  expect(() => readPackBuildInputs(dist, verifyPack(stage))).toThrow(/sealed output/);
  expect(() => readPackBuildInputs(dist)).toThrow(/verification/);
  expect(() => parsePackBuildInputs({ ...inputs, observations: [['not-json', 'null']] })).toThrow();
  expect(() => parsePackBuildInputs({ ...inputs, execution: 'raw environment' })).toThrow(/Invalid pack build inputs/);
});


it('verifies a completed build and its current inputs without compiler or pack activation', async () => {
  const { root, dist } = fixture();
  const probe = `
    import fs from 'node:fs';
    import assert from 'node:assert/strict';
    import { registerHooks } from 'node:module';
    const read = fs.readFileSync, stat = fs.statSync;
    registerHooks({ resolve(specifier, context, next) {
      if (/^(typescript|vite|@apackdev\\/cli)(\\/|$)/.test(specifier)) throw new Error('Compiler activation: ' + specifier);
      return next(specifier, context);
    } });
    const { readPackBuildInputs, assertPackBuildInputsCurrent } = await import('@apackdev/host/build/pack-build-inputs');
    assertPackBuildInputsCurrent(process.argv[1], readPackBuildInputs(process.argv[2]));
    assert.equal(fs.readFileSync, read);
    assert.equal(fs.statSync, stat);
  `;
  let failure: { code?: unknown; stderr?: string } | undefined;
  try {
    await execFileWhileWorking(process.execPath, ['--conditions=@apackdev/source', '--import', 'tsx',
      '--input-type=module', '-e', probe, root, dist], {
      cwd: path.resolve(import.meta.dirname, '../../../..'),
      env: { ...process.env, NODE_OPTIONS: undefined },
    });
  } catch (error) {
    failure = error as { code?: unknown; stderr?: string };
  }
  expect(failure?.code, failure?.stderr).toBeUndefined();
});
