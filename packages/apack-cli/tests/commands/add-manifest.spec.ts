import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addService } from '../../src/commands/add/service.ts';
import { expect, it } from 'vitest';
import { ManifestSchema, type PackManifest } from '@apackdev/pack-format';
import { addArtifact, addBlock, addFeature, addFeatureService, addPackService, addStep } from '../../src/commands/add/manifest.ts';

const cases: Array<[string, (manifest: PackManifest) => void]> = [
  ['feature', manifest => addFeature(manifest, 'constructor', { description: 'Own constructor feature.' })],
  ['step', manifest => addStep(manifest, 'constructor', { node: { label: 'Constructor' } })],
  ['artifact', manifest => addArtifact(manifest, 'constructor', { icon: 'Box', component: 'src/Viewer.vue' })],
  ['block', manifest => addBlock(manifest, 'constructor', { component: 'src/Block.vue' })],
  ['pack service', manifest => addPackService(manifest, 'constructor', 'src/service.ts#service')],
  ['feature service', manifest => addFeatureService(manifest, 'notes', 'constructor', 'src/service.ts#service')],
];

it.each(cases)('authors an owned %s named constructor and refuses a real duplicate', (_kind, add) => {
  const manifest: PackManifest = { id: 'authoring', name: 'Authoring', version: '1.0.0',
    features: { notes: { description: 'Own notes feature.' } } };
  add(manifest);
  expect(ManifestSchema.safeParse(manifest).success).toBe(true);
  const before = JSON.stringify(manifest);
  expect(() => add(manifest)).toThrow('already exists');
  expect(JSON.stringify(manifest)).toBe(before);
});

it('refuses an inherited feature without mutating it', () => {
  const inherited = { description: 'Not declared by this pack.' };
  const manifest: PackManifest = { id: 'authoring', name: 'Authoring', version: '1.0.0',
    features: Object.create({ constructor: inherited }) };
  expect(() => addFeatureService(manifest, 'constructor', 'search', 'src/service.ts#service')).toThrow('not found');
  expect(inherited).toEqual({ description: 'Not declared by this pack.' });
  expect(Object.keys(manifest.features!)).toEqual([]);
});

it('refuses a service for an undeclared feature before creating source files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-add-service-'));
  const manifest = JSON.stringify({ id: 'authoring', name: 'Authoring', version: '1.0.0', features: {} });
  fs.writeFileSync(path.join(root, 'apack.json'), manifest);
  try {
    await expect(addService(['search', '--feature', 'constructor'], root)).rejects.toThrow('not found');
    expect(fs.readdirSync(root)).toEqual(['apack.json']);
    expect(fs.readFileSync(path.join(root, 'apack.json'), 'utf8')).toBe(manifest);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
