import { describe, expect, it } from 'vitest';
import { _packRelationRules, _packRelationTypes, _packWeightedKinds } from '../../src/framework/data-declaration.ts';
import { ManifestSchema, _NativePackDeclarationSchema } from '../../src/framework/declaration-schema.ts';

const pack = { id: 'relation-pack', name: 'Relations', version: '1.0.0' };

describe('relation declarations', () => {
  it('derives EARS constants from the declared wires', () => {
    expect(_packRelationTypes({ data: { relations: { has: {}, relates_to: {}, cites: { unique: true } } } })).toEqual({
      HAS: 'has', RELATES_TO: 'relates_to', CITES: 'cites',
    });
    expect(_packRelationTypes({})).toEqual({});
  });

  it('reads each kind\'s rules, leaving out a kind that declares none', () => {
    expect(_packRelationRules({ data: { relations: { has: {}, parent: { acyclic: true }, cites: { unique: true, acyclic: false } } } }))
      .toEqual({ parent: { acyclic: true }, cites: { unique: true } });
  });

  it('makes a weighted kind unique unless it says otherwise, so a link sets an edge\'s weight', () => {
    expect(_packRelationRules({ data: { relations: { calls: { weighted: true }, mentions: { weighted: true, unique: false }, refs: { weighted: false } } } }))
      .toEqual({ calls: { unique: true, weighted: true }, mentions: { weighted: true } });
    expect(_packWeightedKinds({ data: { relations: { calls: { weighted: true }, mentions: { weighted: true, unique: false }, refs: {} } } }))
      .toEqual({ CALLS: 'calls', MENTIONS: 'mentions' });
    expect(ManifestSchema.safeParse({ ...pack, data: { relations: { calls: { weighted: true } } } }).success).toBe(true);
    expect(ManifestSchema.safeParse({ ...pack, data: { relations: { calls: { weighted: 1 } } } }).success).toBe(false);
  });

  it.each(['ParentOf', 'parent-of', '', ' parent_of', 'parent_of ', '_parent', 'parent__of', '1parent'])
  ('refuses wires that cannot generate the conventional constant: %j', wire => {
    expect(() => _packRelationTypes({ data: { relations: { [wire]: {} } } })).toThrow('snake_case wire name');
    expect(ManifestSchema.safeParse({ ...pack, data: { relations: { [wire]: {} } } }).success).toBe(false);
  });

  it.each(['contains', 'transitions_to', 'instance_of', 'parent_of'])
  ('refuses SDK-owned wires in both installed and native declarations: %s', wire => {
    for (const result of [ManifestSchema.safeParse({ ...pack, data: { relations: { [wire]: {} } } }),
      _NativePackDeclarationSchema.safeParse({ id: pack.id, data: { relations: { [wire]: {} } } })]) {
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]!.message).toContain('defined by the SDK');
    }
  });

  it('declares each relation as a wire mapped to its rules, refusing a list and a rule it does not know', () => {
    expect(ManifestSchema.safeParse({ ...pack, data: { relations: ['note_link'] } }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...pack, data: { relations: { note_link: { ordered: true } } } }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...pack, data: { relations: { note_link: { unique: 'yes' } } } }).success).toBe(false);
    expect(_NativePackDeclarationSchema.safeParse({ id: pack.id, data: { relations: { note_link: { acyclic: true } } } }).success).toBe(true);
  });
});
