// The engine operations pack code calls without holding an engine act on the one this process bound, and with none
// bound they throw naming how to bind one
import { afterEach, describe, expect, it } from 'vitest';
import { defineEars, type EARS, type UntypedSchema } from '@apackdev/ears';
import { _createTestEngine } from '../../src/testing/index.ts';
import {
  _bindEars, boundEars, findRelations, isEntityType, transact, wouldCreateCycle,
  untypedCreate, untypedQuery, untypedUpsert, untypedWrite,
} from '../../src/ears/index.ts';

const engineWith = (types: ReadonlySet<string>) => _createTestEngine({ entityTypes: [...types] });

afterEach(() => { _bindEars(undefined); });

describe('with no engine bound', () => {
  it('every operation throws, naming how to bind one', () => {
    const typed = defineEars<UntypedSchema & { shapes: { Note: { title: string } }; names: 'Note' }>(boundEars);
    const uses: Array<[string, () => unknown]> = [
      ['untypedQuery', () => untypedQuery('Note')],
      ['untypedQuery.ids', () => untypedQuery.ids('Note-1' as EARS.EntityId)],
      ['untypedQuery.all', () => untypedQuery.all()],
      ['untypedCreate', () => untypedCreate('Note')],
      ['untypedUpsert', () => untypedUpsert('Note', { id: 'Note-1' as EARS.EntityId })],
      ['untypedWrite', () => untypedWrite('Note-1' as EARS.EntityId)],
      ['transact', () => transact(() => 1)],
      ['findRelations', () => findRelations()],
      ['isEntityType', () => isEntityType('Note')],
      ['wouldCreateCycle', () => wouldCreateCycle('Note-1' as EARS.EntityId, 'Note-2' as EARS.EntityId, ['contains'])],
      ['a typed facade', () => typed.query('Note')],
      ['boundEars', () => boundEars()],
    ];
    for (const [name, use] of uses) expect(use, name).toThrow('No EARS engine is bound');
  });
});

describe('_bindEars', () => {
  it('points the operations at an engine and returns the one it replaced', () => {
    const first = engineWith(new Set(['Note']));
    const second = engineWith(new Set(['Note', 'Memo']));
    expect(_bindEars(first)).toBeUndefined();
    const id = untypedCreate('Note').set('title', 'first').id();
    expect(isEntityType('Memo')).toBe(false);

    expect(_bindEars(second)).toBe(first);
    expect(untypedQuery('Note').ids()).toEqual([]);
    expect(isEntityType('Memo')).toBe(true);
    expect(boundEars()).toBe(second);

    _bindEars(first);
    expect(defineEars<UntypedSchema & { shapes: { Note: { title: string } }; names: 'Note' }>(boundEars).query('Note').pickAll().map((row) => row.title)).toEqual(['first']);
    expect(first.query.ids(id).pickOne()).toMatchObject({ title: 'first' });
  });
});
