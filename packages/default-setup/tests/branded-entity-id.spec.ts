import { describe, it } from 'vitest';
import { expectTypeOf } from 'vitest';
import type { QueryBuilder } from '@apackdev/sdk/ears';
import { EARS, newId, query, type EntityShape, type PackSchema } from '#generated/ears.ts';

// ─── EntityId<E> phantom brand ─────────────────────────────────────────

describe('Branded EntityId — phantom type parameter', () => {
  it('EntityId defaults to EntityId<string>', () => {
    expectTypeOf<EARS.EntityId>().toEqualTypeOf<EARS.EntityId<string>>();
  });

  it('EntityId<"Action"> is assignable to EntityId<string>', () => {
    expectTypeOf<EARS.EntityId<'Action'>>().toMatchTypeOf<EARS.EntityId>();
  });

  it('EntityId retains template literal pattern', () => {
    expectTypeOf<'act-123'>().toMatchTypeOf<EARS.EntityId>();
  });

  it('EntityId<"Action"> is distinct from EntityId<"Thread">', () => {
    expectTypeOf<EARS.EntityId<'Action'>>().not.toEqualTypeOf<EARS.EntityId<'Thread'>>();
  });

  it('a plain id is accepted where a tagged one is expected; another entity\'s id is not', () => {
    const openNote = (id: EARS.EntityId<'Note'>) => id;
    const plain = 'note-1' as EARS.EntityId;
    openNote(plain);
    // @ts-expect-error a Thread id where a Note id is expected
    openNote('thread-1' as EARS.EntityId<'Thread'>);
    // @ts-expect-error a raw string isn't an id
    openNote('note-1' as string);
  });

  it('tagged id collections accept plain ids in membership checks', () => {
    const noteIds: EARS.EntityId<'Note'>[] = [];
    const plain = 'note-1' as EARS.EntityId;
    noteIds.includes(plain);
    new Set(noteIds).has(plain);
    new Map(noteIds.map((id) => [id, 1])).get(plain);
  });
});

// ─── newId overloads ────────────────────────────────────────────

describe('Branded EntityId — newId overloads', () => {
  it('newId(Entity.Action) returns EntityId<"Action">', () => {
    expectTypeOf(newId(EARS.Entity.Action)).toEqualTypeOf<EARS.EntityId<'Action'>>();
  });

  it('newId(Entity.Thread) returns EntityId<"Thread">', () => {
    expectTypeOf(newId(EARS.Entity.Thread)).toEqualTypeOf<EARS.EntityId<'Thread'>>();
  });

  it('newId(Entity.Flow) returns EntityId<"Flow">', () => {
    expectTypeOf(newId(EARS.Entity.Flow)).toEqualTypeOf<EARS.EntityId<'Flow'>>();
  });

  it('newId with an entity name only known at runtime returns EntityId<string>', () => {
    const entityType: string = 'SomeUnregistered';
    expectTypeOf(newId(entityType)).toEqualTypeOf<EARS.EntityId>();
  });

  it('newId rejects a literal entity name the pack does not declare', () => {
    // @ts-expect-error not an entity this pack or its dependencies declare
    newId('SomeUnregistered');
  });
});

// ─── the row with an id ────────────────────────────────────────────────

describe('Branded EntityId — the row with an id', () => {
  it("pickOne() on a branded id returns that entity's shape", () => {
    const row = (id: EARS.EntityId<'Action'>) => query.ids(id).pickOne();
    expectTypeOf(row).returns.toEqualTypeOf<EntityShape<'Action'> | undefined>();
  });

  it('an unbranded id is typed by ofType, which checks the entity rather than asserting its shape', () => {
    const row = (id: EARS.EntityId) => query.ids(id).ofType(EARS.Entity.Thread).pickOne();
    expectTypeOf(row).returns.toEqualTypeOf<EntityShape<'Thread'> | undefined>();
  });
});

// ─── branded id flows through QueryBuilder ─────────────────────────────

describe('Branded EntityId — integration with QueryBuilder', () => {
  it('query(Entity.Action) ids are tagged with Action', () => {
    type Result = ReturnType<QueryBuilder<'Action', PackSchema>['ids']>;
    expectTypeOf<Result>().toEqualTypeOf<EARS.EntityId<'Action'>[]>();
  });

  it('an id from a query types the next lookup without an explicit shape', () => {
    // Type-level only: never called, since the EARS runtime isn't initialized here
    const check = () => {
      const first = query(EARS.Entity.Note).first();
      if (first) expectTypeOf(query.ids(first).pickOne()).toEqualTypeOf<EntityShape<'Note'> | undefined>();
      const row = query(EARS.Entity.Note).pickAll()[0];
      if (row) expectTypeOf(row.id).toEqualTypeOf<EARS.EntityId<'Note'>>();
      const picked = query(EARS.Entity.Note).pickOne(['title']);
      if (picked) expectTypeOf(picked.id).toEqualTypeOf<EARS.EntityId<'Note'>>();
    };
    expectTypeOf(check).toBeFunction();
  });

  it('newId returns branded id compatible with query input', () => {
    type CreatedId = ReturnType<typeof newId<'Action'>>;
    expectTypeOf<CreatedId>().toMatchTypeOf<EARS.EntityId>();
  });
});
