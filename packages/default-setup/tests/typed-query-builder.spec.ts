import { describe, it } from 'vitest';
import { expectTypeOf } from 'vitest';
import type { QueryBuilder, UntypedSchema } from '@apackdev/sdk/ears';
import { EARS, query, type EntityName, type PackSchema } from '#generated/ears.ts';

/** A query builder over this pack's names: its entity shapes and names, its relation kinds and its roles */
type PackQuery<E extends string> = QueryBuilder<E, PackSchema>;

// ─── query entry points ────────────────────────────────────────────────────

describe('Typed QueryBuilder — query entry points', () => {
  it('query(Entity.Action) returns QueryBuilder<"Action">', () => {
    expectTypeOf(query(EARS.Entity.Action)).toEqualTypeOf<PackQuery<'Action'>>();
  });

  it('query(Entity.Thread) returns QueryBuilder<"Thread">', () => {
    expectTypeOf(query(EARS.Entity.Thread)).toEqualTypeOf<PackQuery<'Thread'>>();
  });

  it('query.all() returns PackQuery<string>', () => {
    expectTypeOf(query.all()).toEqualTypeOf<PackQuery<string>>();
  });

  it('query.ids(idArray) of plain ids returns an untyped QueryBuilder', () => {
    const ids = ['act-1', 'act-2'] as EARS.EntityId[];
    expectTypeOf(query.ids(ids)).toEqualTypeOf<PackQuery<string>>();
  });

  // What each entry point takes: query a type (a declared name, or one known only at runtime), query.ids ids, typed
  // by the entity an id is tagged with. An id where a type is meant, or a type that may be absent, is refused.
  it('types each entry point by what it starts from', () => {
    type QB<E extends string> = PackQuery<E>;
    // Type-level only: never called
    const check = (
      noteId: EARS.EntityId<'Note'>, plainId: EARS.EntityId, noteIds: EARS.EntityId<'Note'>[], runtimeName: string,
      maybeName: string | undefined, anyEntity: EARS.Entity,
    ) => {
      expectTypeOf(query('Note')).toEqualTypeOf<QB<'Note'>>();
      expectTypeOf(query.ids(noteId)).toEqualTypeOf<QB<'Note'>>();
      expectTypeOf(query.ids(noteIds)).toEqualTypeOf<QB<'Note'>>();
      expectTypeOf(query.ids(plainId)).toEqualTypeOf<QB<string>>();
      expectTypeOf(query(runtimeName)).toEqualTypeOf<QB<string>>();
      expectTypeOf(query(['Note', 'Flow'])).toEqualTypeOf<QB<string>>();
      expectTypeOf(query(anyEntity)).toEqualTypeOf<QB<EARS.Entity>>();
      const byName = <E extends EntityName>(entityType: E) => query(entityType);
      expectTypeOf(byName<'Note'>).returns.toEqualTypeOf<QB<'Note'>>();
      const byId = <E extends string>(id: EARS.EntityId<E>) => query.ids(id);
      expectTypeOf(byId<'Note'>).returns.toEqualTypeOf<QB<'Note'>>();
      // @ts-expect-error not a declared entity name
      query('Noet');
      // @ts-expect-error not a declared entity name, in a list
      query(['Note', 'Noet']);
      // @ts-expect-error an id is not an entity type: it starts from query.ids
      query(noteId);
      // @ts-expect-error an id literal is not an entity type either
      query('Note-abc123');
      // @ts-expect-error a type that may be absent: query.all() is every entity, asked for by name
      query(maybeName);
    };
    expectTypeOf(check).toBeFunction();
  });
});

// ─── ofType() narrows ──────────────────────────────────────────────────

// Asserted via an instantiation expression (`typeof b.ofType<'Thread'>`) rather
// than a conditional type: `Q extends { ofType(t: T): infer R }` instantiates
// the generic at its CONSTRAINT and infers PackQuery<string>, so it silently
// passed whatever ofType actually returned. Purely type-level, so the declared
// consts need no runtime value.
declare const untypedBuilder: PackQuery<string>;
declare const threadBuilder: PackQuery<'Thread'>;
declare const actionBuilder: PackQuery<'Action'>;

describe('Typed QueryBuilder — ofType() narrows', () => {
  it('ofType() narrows untyped builder to specific entity', () => {
    expectTypeOf<ReturnType<typeof untypedBuilder.ofType<'Thread'>>>()
      .toEqualTypeOf<PackQuery<'Thread'>>();
  });

  it('ofType() narrows from one entity to a different entity', () => {
    expectTypeOf<ReturnType<typeof actionBuilder.ofType<'Thread'>>>()
      .toEqualTypeOf<PackQuery<'Thread'>>();
  });
});

// ─── fluent chaining preserves type ────────────────────────────────────

describe('Typed QueryBuilder — fluent chaining preserves type', () => {
  it('where() preserves entity type', () => {
    type Result = ReturnType<PackQuery<'Action'>['where']>;
    expectTypeOf<Result>().toEqualTypeOf<PackQuery<'Action'>>();
  });

  it('orderBy() preserves entity type', () => {
    type Result = ReturnType<PackQuery<'Thread'>['orderBy']>;
    expectTypeOf<Result>().toEqualTypeOf<PackQuery<'Thread'>>();
  });

  it('limit() preserves entity type', () => {
    type Result = ReturnType<PackQuery<'Flow'>['limit']>;
    expectTypeOf<Result>().toEqualTypeOf<PackQuery<'Flow'>>();
  });

  it('distinct() preserves entity type', () => {
    type Result = ReturnType<PackQuery<'Document'>['distinct']>;
    expectTypeOf<Result>().toEqualTypeOf<PackQuery<'Document'>>();
  });

  it('reverse() preserves entity type', () => {
    type Result = ReturnType<PackQuery<'Action'>['reverse']>;
    expectTypeOf<Result>().toEqualTypeOf<PackQuery<'Action'>>();
  });

  it('within() preserves entity type', () => {
    type Result = ReturnType<PackQuery<'Thread'>['within']>;
    expectTypeOf<Result>().toEqualTypeOf<PackQuery<'Thread'>>();
  });

  it('withRole() preserves entity type', () => {
    type Result = ReturnType<PackQuery<'Action'>['withRole']>;
    expectTypeOf<Result>().toEqualTypeOf<PackQuery<'Action'>>();
  });

  it('linkedWith(), linkedTo() and linkedFrom() preserve entity type', () => {
    expectTypeOf<ReturnType<PackQuery<'Message'>['linkedWith']>>().toEqualTypeOf<PackQuery<'Message'>>();
    expectTypeOf<ReturnType<PackQuery<'Message'>['linkedTo']>>().toEqualTypeOf<PackQuery<'Message'>>();
    expectTypeOf<ReturnType<PackQuery<'Message'>['linkedFrom']>>().toEqualTypeOf<PackQuery<'Message'>>();
  });

  // out and in walk to the entities at an edge's far end (the linked* steps filter in place),
  // so the result holds the TARGET type, not the type being queried from.
  it('out() and in() narrow to the target entity type', () => {
    expectTypeOf<ReturnType<typeof threadBuilder.out<'Message'>>>()
      .toEqualTypeOf<PackQuery<'Message'>>();
    expectTypeOf<ReturnType<typeof threadBuilder.in<'Message'>>>()
      .toEqualTypeOf<PackQuery<'Message'>>();
  });

  it('forEach() preserves entity type', () => {
    type Result = ReturnType<PackQuery<'Action'>['forEach']>;
    expectTypeOf<Result>().toEqualTypeOf<PackQuery<'Action'>>();
  });
});

// ─── groupBy returns typed ids per value ───────────────────────────────

describe('Typed QueryBuilder — groupBy returns typed ids', () => {
  it('groupBy returns Map<unknown, EntityId<E>[]>', () => {
    type Result = ReturnType<PackQuery<'Thread'>['groupBy']>;
    expectTypeOf<Result>().toEqualTypeOf<Map<unknown, EARS.EntityId<'Thread'>[]>>();
  });
});

// ─── terminal methods ──────────────────────────────────────────────────

describe('Typed QueryBuilder — terminal methods', () => {
  it('ids() returns ids tagged with the entity type', () => {
    type Result = ReturnType<PackQuery<'Action'>['ids']>;
    expectTypeOf<Result>().toEqualTypeOf<EARS.EntityId<'Action'>[]>();
  });

  it('count() returns number', () => {
    type Result = ReturnType<PackQuery<'Thread'>['count']>;
    expectTypeOf<Result>().toBeNumber();
  });

  it('exists() returns boolean', () => {
    type Result = ReturnType<PackQuery<'Flow'>['exists']>;
    expectTypeOf<Result>().toBeBoolean();
  });

  it('first() returns a tagged id | undefined', () => {
    type Result = ReturnType<PackQuery<'Action'>['first']>;
    expectTypeOf<Result>().toEqualTypeOf<EARS.EntityId<'Action'> | undefined>();
  });

  it('last() returns a tagged id | undefined', () => {
    type Result = ReturnType<PackQuery<'Action'>['last']>;
    expectTypeOf<Result>().toEqualTypeOf<EARS.EntityId<'Action'> | undefined>();
  });

  it('ids() of an untyped builder stay plain', () => {
    type Result = ReturnType<PackQuery<string>['ids']>;
    expectTypeOf<Result>().toEqualTypeOf<EARS.EntityId[]>();
  });
});

// ─── default type parameter ────────────────────────────────────────────

describe('Typed QueryBuilder — default type parameter', () => {
  it('QueryBuilder without type args is an untyped string builder', () => {
    expectTypeOf<QueryBuilder>().toEqualTypeOf<QueryBuilder<string, UntypedSchema>>();
  });

  it('untyped builder methods still return QueryBuilder<string>', () => {
    type Result = ReturnType<QueryBuilder['where']>;
    expectTypeOf<Result>().toEqualTypeOf<QueryBuilder<string>>();
  });
});
