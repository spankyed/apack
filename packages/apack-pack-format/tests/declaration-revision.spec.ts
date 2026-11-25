import { expect, it } from 'vitest';
import { _declarationRevision } from '../src/declaration-revision.ts';
import { ManifestSchema } from '../src/declaration-schema.ts';
import type { PackManifest } from '../src/manifest.ts';

const manifest: PackManifest = {
  id: 'example', name: 'Example', version: '1.0.0',
  features: { notes: { description: 'Edit notes.', settings: {
    defaults: { first: 1, second: 2 },
    schema: { type: 'object', properties: { first: { type: 'integer' }, second: { type: 'integer' } }, required: ['first', 'second'] },
  } } },
};

it('has the same identity after schema parsing or reordering nested object keys', () => {
  const parsed = ManifestSchema.parse(manifest);
  const reordered = { ...manifest, features: { notes: { description: 'Edit notes.', settings: {
    schema: { required: ['first', 'second'], properties: { second: { type: 'integer' }, first: { type: 'integer' } }, type: 'object' }, defaults: { second: 2, first: 1 },
  } } } };
  expect(_declarationRevision(parsed)).toBe(_declarationRevision(manifest));
  expect(_declarationRevision(reordered)).toBe(_declarationRevision(manifest));
});

it('changes when a declaration value or array order changes', () => {
  const changed = structuredClone(manifest);
  changed.features!.notes.settings!.defaults.first = 3;
  expect(_declarationRevision(changed)).not.toBe(_declarationRevision(manifest));
  const reordered = structuredClone(manifest);
  reordered.features!.notes.settings!.schema.required = ['second', 'first'];
  expect(_declarationRevision(reordered)).not.toBe(_declarationRevision(manifest));
});
