import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { _declarationRevision, PACK_SNAPSHOT_FORMAT } from '@apackdev/pack-format';
import { PACK_LAYOUT, readPackBuild, sealPackBuild } from '@apackdev/host/packs';
import { packInputsHash } from '@apackdev/host/build/pack-inputs';
import { buildStagingDir, publishPackBuild } from '../../src/build/build-publication.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-publication-'));
  roots.push(root);
  const manifest = { id: 'publication', name: 'Publication', version: '1.0.0' };
  fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify(manifest));
  const staged = buildStagingDir(root);
  fs.mkdirSync(path.join(staged, PACK_LAYOUT.runtimeDir), { recursive: true });
  fs.writeFileSync(path.join(staged, PACK_LAYOUT.runtimeEntry), 'module.exports = {};');
  fs.mkdirSync(path.dirname(path.join(staged, PACK_LAYOUT.snapshot)), { recursive: true });
  fs.writeFileSync(path.join(staged, PACK_LAYOUT.snapshot), JSON.stringify({ manifest,
    format: PACK_SNAPSHOT_FORMAT, declarationRevision: _declarationRevision(manifest),
    types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {} }));
  sealPackBuild(staged, manifest);
  fs.mkdirSync(path.join(root, 'dist'));
  fs.writeFileSync(path.join(root, 'dist/incumbent'), 'ACCEPTED');
  return { root, staged, manifest, candidate: { inputHash: packInputsHash(root), revision: readPackBuild(staged).revision } };
}

it('publishes the exact sealed candidate', () => {
  const { root, staged, candidate } = fixture();
  publishPackBuild(root, candidate);
  expect(readPackBuild(path.join(root, 'dist')).revision).toBe(candidate.revision);
  expect(fs.existsSync(staged)).toBe(false);
});

it.each(['source', 'output', 'resealed output'] as const)('retains the incumbent after a late change to %s', changed => {
  const { root, staged, manifest, candidate } = fixture();
  if (changed === 'source') fs.writeFileSync(path.join(root, 'new-input.json'), '{}');
  else {
    fs.writeFileSync(path.join(staged, PACK_LAYOUT.runtimeEntry), 'module.exports = { changed: true };');
    if (changed === 'resealed output') sealPackBuild(staged, manifest);
  }
  expect(() => publishPackBuild(root, candidate)).toThrow();
  expect(fs.readFileSync(path.join(root, 'dist/incumbent'), 'utf8')).toBe('ACCEPTED');
});
