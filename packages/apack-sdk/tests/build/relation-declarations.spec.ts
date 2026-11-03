import { describe, expect, it } from 'vitest';
import { _packRanks, _packRelationRules, _packRelationTypes, _packWeightedKinds } from '../../src/framework/data-declaration.ts';
import { ManifestSchema, _NativePackDeclarationSchema } from '../../src/framework/declaration-schema.ts';

const pack = { id: 'relation-pack', name: 'Relations', version: '1.0.0' };

describe('rank index declarations', () => {
  const declares = (ranks: unknown, rest: object = {}) => ManifestSchema.safeParse({ ...pack, data: { ranks, ...rest } }).success;
  const rank = { types: ['Note'], relations: ['refs'] };

  it('reads what a manifest declares', () => {
    const ranks = { noteRank: { ...rank, direction: 'both', weights: false, damping: 0.5, tolerance: 1e-4 } } as const;
    expect(declares(ranks)).toBe(true);
    expect(_packRanks({ data: { ranks } })).toEqual(ranks);
    expect(_packRanks({})).toEqual({});
  });

  it.each([
    ['a name that is not lowerCamelCase', { NoteRank: rank }],
    ['no types', { noteRank: { ...rank, types: [] } }],
    ['no relations', { noteRank: { ...rank, relations: [] } }],
    ['a type that is not an entity wire name', { noteRank: { ...rank, types: ['note'] } }],
    ['a kind that is not a relation wire name', { noteRank: { ...rank, relations: ['Refs'] } }],
    ['a damping of 1', { noteRank: { ...rank, damping: 1 } }],
    ['a tolerance of 0', { noteRank: { ...rank, tolerance: 0 } }],
    ['an unknown direction', { noteRank: { ...rank, direction: 'sideways' } }],
    ['an unknown key', { noteRank: { ...rank, seeds: [] } }],
  ])('refuses %s', (_what, ranks) => {
    expect(declares(ranks)).toBe(false);
  });

  it('refuses the name of one of the pack\'s own entities\' indexes, which the engine holds in one namespace', () => {
    expect(declares({ title: rank }, { entities: { Note: { indexes: ['title'] } } })).toBe(false);
    expect(declares({ search: rank }, { entities: { Note: { search: { fields: { title: 1 } } } } })).toBe(false);
    expect(declares({ search: rank }, { entities: { Note: { indexes: ['title'] } } })).toBe(true);
  });
});

describe('relation declarations', () => {
  it('derives EARS constants from the declared wires', () => {
    expect(_packRelationTypes({ data: { relations: { has: {}, relates_to: {}, cites: { key: ['page'] } } } })).toEqual({
      HAS: 'has', RELATES_TO: 'relates_to', CITES: 'cites',
    });
    expect(_packRelationTypes({})).toEqual({});
  });

  it('reads each kind\'s rules, leaving out a kind that declares none', () => {
    expect(_packRelationRules({ data: { relations: { has: {}, parent: { acyclic: true }, cites: { key: ['page'], acyclic: false }, refs: { key: [] } } } }))
      .toEqual({ parent: { acyclic: true }, cites: { key: ['page'] } });
  });

  it('holds a weighted kind to its weights and to nothing else, its key apart', () => {
    expect(_packRelationRules({ data: { relations: { calls: { weighted: true }, mentions: { weighted: true, key: ['n'] }, refs: { weighted: false } } } }))
      .toEqual({ calls: { weighted: true }, mentions: { weighted: true, key: ['n'] } });
    expect(_packWeightedKinds({ data: { relations: { calls: { weighted: true }, mentions: { weighted: true, key: ['n'] }, refs: {} } } }))
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
    expect(ManifestSchema.safeParse({ ...pack, data: { relations: { note_link: { unique: true } } } }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...pack, data: { relations: { note_link: { key: ['Page'] } } } }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...pack, data: { relations: { note_link: { key: ['page', 'page'] } } } }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...pack, data: { relations: { note_link: { key: ['page', 'line'] } } } }).success).toBe(true);
    expect(_NativePackDeclarationSchema.safeParse({ id: pack.id, data: { relations: { note_link: { acyclic: true } } } }).success).toBe(true);
  });
});
