/**
 * Type-safety verification tests for SDK delegates.
 *
 * These tests validate that recovered generic type parameters on SDK delegate
 * functions actually infer types correctly. They use vitest's expectTypeOf()
 * for compile-time type assertions — if a generic regresses to `any`, these
 * tests will fail at typecheck time (not just at runtime).
 *
 * Runtime assertions verify that generics flow through the delegate chain
 * correctly on the harness's in-memory engine.
 */
import { expectTypeOf, describe, it, expect, beforeEach } from 'vitest';
import { type QueryBuilder, type WriteBuilder } from '@apackdev/ears';
import { untypedCreate } from '@apackdev/sdk/ears';
import {
  query, create, upsert, newId, write, type EntityShape
} from '#generated/ears.ts';
import { repository, type Repositories } from '#generated/repository.ts';
import { resetTestData } from '@apackdev/sdk/testing';
import { createLogger, type Logger } from '@apackdev/sdk/logger';
import {
  loadJSON,
  detectChanges,
  toIdentifierSet,
  type ApplyResult, type DiffResult,
  type ChangeBlock,
} from '@apackdev/sdk/utils';
import {
  breadcrumb, breadcrumbWithParams, breadcrumbList,
  contextMenuFn, type ContextMenuItem,
} from '@apackdev/sdk/fe';
import { services, type Services } from '#generated/services.ts';
import type { HostServices } from '@apackdev/sdk/services';
import type { flowRepository } from '@apackdev/sdk/repositories';
import type { promptService } from '#features/prompts/be/services/prompt.ts';
import { EARS, type ShortCodeOf } from '#generated/ears.ts';


// ─── Compile-time type assertions ──────────────────────────────────────
// Checked by `vue-tsc` (npm run typecheck:pack). Each assertion pins the exact type with
// toEqualTypeOf (or an expected error): `not.toBeAny()`, toHaveProperty and toMatchTypeOf are too
// weak — `unknown`, a wrong shape or an over-wide union all pass them.

describe('Type inference — EARS runtime', () => {
  it('create() returns a WriteBuilder of the type it was given', () => {
    expectTypeOf(untypedCreate<'Action'>).returns.toEqualTypeOf<WriteBuilder<'Action'>>();
  });

  it('newId() brands the id with a declared entity type', () => {
    expectTypeOf(newId(EARS.Entity.Action)).toEqualTypeOf<EARS.EntityId<'Action'>>();
  });

  it('QueryBuilder.map() is generic over its return type', () => {
    const builder = {} as QueryBuilder;
    expectTypeOf(() => builder.map((id) => String(id))).returns.toEqualTypeOf<string[]>();
  });

  it('WriteBuilder fluent methods return WriteBuilder', () => {
    const builder = {} as WriteBuilder;
    expectTypeOf(builder.set).returns.toEqualTypeOf<WriteBuilder>();
    expectTypeOf(builder.setMany).returns.toEqualTypeOf<WriteBuilder>();
    expectTypeOf(builder.link).returns.toEqualTypeOf<WriteBuilder>();
  });
});

describe('Type inference — typed EARS helpers', () => {
  const actionId = 'Action-1' as EARS.EntityId<'Action'>;

  it('the row with a branded id reads the declared shape', () => {
    expectTypeOf(() => query.ids(actionId).pickOne()!.actionFn).returns.toEqualTypeOf<string>();
  });

  it('a query by type, and by a field, reads the declared shape', () => {
    // Wrapped in functions: only their types are checked
    expectTypeOf(() => query(EARS.Entity.Prompt).pickAll()[0].templateFn).returns.toEqualTypeOf<string>();
    expectTypeOf(() => query(EARS.Entity.Thread).where('status', 'active').pickAll()[0].topic).returns.toEqualTypeOf<string>();
    const check = () => {
      // @ts-expect-error not a field of Thread
      query(EARS.Entity.Thread).where('statsu', 'active').pickAll();
      // @ts-expect-error a field's value is checked as where checks it
      query(EARS.Entity.Thread).where('topic', 42).pickAll();
    };
    expectTypeOf(check).toBeFunction();
  });

  it('create may leave out the short code a shape numbers, which reads back as its type\'s', () => {
    const action = create(EARS.Entity.Action, { label: 'test', input: {}, actionFn: 'fn()' }).row();
    expectTypeOf(action.shortCode).toEqualTypeOf<`ACT-${number}`>();
    expect(action.shortCode).toMatch(/^ACT-\d+$/);
    // Type-level only: the engine refuses these rows at runtime too
    const check = () => {
      create(EARS.Entity.Action, { label: 'test', input: {}, actionFn: 'fn()', shortCode: 'ACT-40' });
      // @ts-expect-error a short code is its type's, ACT-<n>
      create(EARS.Entity.Action, { label: 'test', input: {}, actionFn: 'fn()', shortCode: 'X-1' });
      // @ts-expect-error a field the shape requires, and doesn't number, is still required
      create(EARS.Entity.Action, { input: {}, actionFn: 'fn()' });
      // @ts-expect-error not a field of Action
      create(EARS.Entity.Action, { label: 'test', input: {}, actionFn: 'fn()', notAField: 1 });
    };
    expectTypeOf(check).toBeFunction();
  });

  it("ShortCodeOf types a numbered entity's code from its manifest entry, a pack's and the SDK's alike", () => {
    expectTypeOf<ShortCodeOf<'Thread'>>().toEqualTypeOf<`THR-${number}`>();
    expectTypeOf<ShortCodeOf<'Document'>>().toEqualTypeOf<`DOC-${number}`>();
    expectTypeOf<ShortCodeOf<'Message'>>().toBeNever();
    // A thread's row holds it, though ThreadEntity declares none: the generated shapes add it
    expectTypeOf<EntityShape<'Thread'>['shortCode']>().toEqualTypeOf<`THR-${number}`>();
    const check = () => {
      create(EARS.Entity.Thread, { topic: 't', instructions: '', status: 'Open', timestamp: 0, shortCode: 'THR-40' });
      // @ts-expect-error a thread's code is THR-<n>
      create(EARS.Entity.Thread, { topic: 't', instructions: '', status: 'Open', timestamp: 0, shortCode: 'DOC-40' });
    };
    expectTypeOf(check).toBeFunction();
  });

  it('creates a row with every field its shape requires, and its identity in the same object', () => {
    // Type-level only: never called
    const check = (givenId: EARS.EntityId<'Action'>) => {
      create(EARS.Entity.Action, { label: 'a', input: {}, actionFn: 'fn()' });
      create(EARS.Entity.Action, { id: givenId, createdAt: 1, label: 'a', input: {}, actionFn: 'fn()', category: 'c' });
      upsert(EARS.Entity.Action, { id: givenId, label: 'a', input: {}, actionFn: 'fn()' });
      // @ts-expect-error actionFn is required
      create(EARS.Entity.Action, { label: 'a', input: {} });
      // @ts-expect-error a row is required where the shape requires fields
      create(EARS.Entity.Action);
      // @ts-expect-error not a field of Action
      create(EARS.Entity.Action, { label: 'a', input: {}, actionFn: 'fn()', labl: 'x' });
      // @ts-expect-error the type argument is the row's entity type; a row never carries its own
      create(EARS.Entity.Action, { label: 'a', input: {}, actionFn: 'fn()', entityType: 'Action' });
      // @ts-expect-error upsert may create, so it is held to the same row
      upsert(EARS.Entity.Action, { id: givenId, label: 'a' });
      // @ts-expect-error upsert's row always names the id it is written under
      upsert(EARS.Entity.Action, { label: 'a', input: {}, actionFn: 'fn()' });
    };
    expectTypeOf(check).toBeFunction();
  });

  it('names only declared relation kinds, in a link and in a read or walk over links', () => {
    // Type-level only: never called
    const check = (noteId: EARS.EntityId<'Note'>, otherId: EARS.EntityId, fromData: string) => {
      write(noteId).link(EARS.RelKind.REFERENCES, otherId).unlink('references', otherId);
      query.ids(noteId).out(EARS.RelKind.CONTAINS, EARS.Entity.Message);
      expectTypeOf(query.ids(noteId).outEdges(['references', 'contains'])[0].kind).toEqualTypeOf<'references' | 'contains'>();
      // @ts-expect-error not a declared relation kind
      write(noteId).link('refrences', otherId);
      // @ts-expect-error in a walk too
      query.ids(noteId).out('contians');
      // @ts-expect-error and in a filter
      query(EARS.Entity.Note).linkedTo('refrences', otherId);
      // @ts-expect-error and in the graph walks
      query.ids(noteId).both('contians');
      // @ts-expect-error a path's kinds too
      query.ids(noteId).pathTo(otherId, 'refrences');
      // @ts-expect-error and a count of edges
      query.ids(noteId).degrees('refrences');
      // @ts-expect-error a direction is out, in or both
      query.ids(noteId).pathTo(otherId, 'references', { direction: 'up' });
      // @ts-expect-error a rank's kinds too
      query(EARS.Entity.Note).rank('refrences');
      // @ts-expect-error and the weak components'
      query(EARS.Entity.Note).weakComponents('refrences');
      // @ts-expect-error a rank's seeds are ids
      query(EARS.Entity.Note).rank('references', { seeds: [42] });
      // A seed may carry a weight, and a rank may leave weights out
      query(EARS.Entity.Note).rank('references', { seeds: [noteId, { id: noteId, weight: 2 }], weights: false });
      // @ts-expect-error a weight is a weighted kind's, and this pack declares none
      write(noteId).link('references', otherId, { weight: 2 });
      expectTypeOf<EARS.WeightedKind>().toEqualTypeOf<never>();
      expectTypeOf(query(EARS.Entity.Note).rank('references', { seeds: [noteId] }).ids()).toEqualTypeOf<EARS.EntityId<'Note'>[]>();
      expectTypeOf(query(EARS.Entity.Note).weakComponents('references')).toEqualTypeOf<EARS.EntityId<'Note'>[][]>();
      // @ts-expect-error and the strong components'
      query(EARS.Entity.Note).strongComponents('refrences');
      expectTypeOf(query(EARS.Entity.Note).strongComponents('references')).toEqualTypeOf<EARS.EntityId<'Note'>[][]>();
      // @ts-expect-error and the communities'
      query(EARS.Entity.Note).communities('refrences');
      expectTypeOf(query(EARS.Entity.Note).communities('references', { resolution: 0.5 })).toEqualTypeOf<EARS.EntityId<'Note'>[][]>();
      // @ts-expect-error a topological order's kinds too
      query(EARS.Entity.Note).topological('refrences');
      expectTypeOf(query(EARS.Entity.Note).topological('references').ids()).toEqualTypeOf<EARS.EntityId<'Note'>[]>();
      // @ts-expect-error a similar's kinds too
      query(EARS.Entity.Note).similar(noteId, 'refrences');
      expectTypeOf(query(EARS.Entity.Note).similar(noteId, 'references').ids()).toEqualTypeOf<EARS.EntityId<'Note'>[]>();
      expectTypeOf(query.ids(noteId).both(EARS.RelKind.CONTAINS, EARS.Entity.Message).ids()).toEqualTypeOf<EARS.EntityId<'Message'>[]>();
      expectTypeOf(query.ids(noteId).descendants('contains', EARS.Entity.Note, { depth: 2 }).ids()).toEqualTypeOf<EARS.EntityId<'Note'>[]>();
      expectTypeOf(query.ids(noteId).degrees('references')).toEqualTypeOf<Map<EARS.EntityId<'Note'>, number>>();
      // @ts-expect-error a kind that arrives as data is narrowed first
      write(noteId).link(fromData, otherId);
      if (EARS.isRelKind(fromData)) write(noteId).link(fromData, otherId);
      // @ts-expect-error no escape from the pack's facade: an undeclared kind is declared in apack.json
      EARS.RelKind.Custom('anything');
    };
    expectTypeOf(check).toBeFunction();
  });

  it('names only declared roles, in a role write and a query by role', () => {
    // Type-level only: never called
    const check = (flowId: EARS.EntityId<'Flow'>, fromData: string) => {
      write(flowId).grant(EARS.RoleKind.ROOT_FLOW).revoke('entry_event');
      query.all().withRole(EARS.RoleKind.ASSISTANT_BIRTH);
      // @ts-expect-error not a declared role
      write(flowId).grant('root_flw');
      // @ts-expect-error in a query by role too
      query.all().withRole('pinned');
      // @ts-expect-error a role that arrives as data is narrowed first
      write(flowId).grantExclusive(fromData, []);
      if (EARS.isRole(fromData)) write(flowId).grantExclusive(fromData, []);
      // @ts-expect-error no escape from the pack's facade: an undeclared role is declared in apack.json
      EARS.RoleKind.Custom('anything');
    };
    expectTypeOf(check).toBeFunction();
  });

  it('write names only declared fields, checks their values, and takes an options argument', () => {
    // Type-level only: never called, since no entity has this id
    const check = () => {
      write(actionId, { touch: false }).setMany({ label: 'renamed' });
      write(actionId).set('label', 'renamed').delete('description');
      // @ts-expect-error wrong type for a declared field
      write(actionId).setMany({ label: 42 });
      // @ts-expect-error not a field of Action
      write(actionId).setMany({ labl: 'renamed' });
      // @ts-expect-error not a field of Action
      write(actionId).set('labl', 'renamed');
      // @ts-expect-error not a field of Action
      write(actionId).delete('labl');
      // @ts-expect-error a required field is replaced with set, never removed
      write(actionId).delete('label');
      // @ts-expect-error the engine writes updatedAt
      write(actionId).set('updatedAt', 1);
      // A plain id names no entity type, so its writes are unchecked
      write('Action-x' as EARS.EntityId).set('anything', 1);
    };
    expectTypeOf(check).toBeFunction();
  });

  it('a field picked by a branded id is typed by its shape, and none answers undefined', () => {
    expectTypeOf(query.ids(actionId).pickOne(['actionFn'])?.actionFn).toEqualTypeOf<string | undefined>();
  });

  it('pick picks the requested fields', () => {
    expectTypeOf(query(EARS.Entity.Action).pick(['label', 'actionFn'])[0]).toEqualTypeOf<{ id: EARS.EntityId<'Action'> } & Pick<EntityShape<'Action'>, 'label' | 'actionFn'>>();
    // @ts-expect-error not a field of Action
    query(EARS.Entity.Action).pick(['notAField']);
  });

  it('where takes an element of a declared list field', () => {
    // Type-level only
    const check = () => query(EARS.Entity.Note).where('linkTargets', 'Note-x');
    expectTypeOf(check).toBeFunction();
  });
});

describe('Type inference — Logger and utilities', () => {
  it('createLogger returns Logger', () => {
    expectTypeOf(createLogger).returns.toEqualTypeOf<Logger>();
  });

  it('loadJSON<T> returns T | null', () => {
    type Config = { version: number; features: string[] };
    expectTypeOf(loadJSON<Config>).returns.toEqualTypeOf<Config | null>();
  });

  it('detectChanges<T> returns DiffResult<T>', () => {
    type Item = { name: string; slug: string };
    expectTypeOf<ReturnType<typeof detectChanges<Item>>>().toEqualTypeOf<DiffResult<Item>>();
  });

  it('toIdentifierSet<T> returns Set<string>', () => {
    type Tag = { name: string; slug: string };
    expectTypeOf(toIdentifierSet<Tag>).returns.toEqualTypeOf<Set<string>>();
  });

  it('ChangeBlock<T> is generic', () => {
    type Action = { name: string };
    expectTypeOf<ChangeBlock<Action>['removed']>().toEqualTypeOf<Array<Action | string> | undefined>();
  });

  it('ApplyResult fields are numbers', () => {
    expectTypeOf<ApplyResult['created']>().toEqualTypeOf<number>();
  });
});

describe('Type inference — FE delegate generics', () => {
  it('breadcrumb helpers return typed configs', () => {
    type Crumb = { label: string; target: string; info?: unknown };
    expectTypeOf(breadcrumb).returns.toEqualTypeOf<{ breadcrumb: { label: string; target: string; default: boolean } }>();
    expectTypeOf(breadcrumbWithParams<{ selectedId: string }>).returns
      .toEqualTypeOf<{ readonly breadcrumb: (ctx: { selectedId: string }) => { label: string; target: string } }>();
    expectTypeOf(breadcrumbList<{ items: string[] }>).returns
      .toEqualTypeOf<{ readonly breadcrumb: (ctx: { items: string[] }) => Crumb[] }>();
    expectTypeOf(contextMenuFn<{ selectedAction: string }>).returns
      .toEqualTypeOf<{ readonly contextMenu: (ctx: { selectedAction: string }) => ContextMenuItem[] }>();
  });
});

// ─── Generated facades ───────────────────────────────────────────────

describe('Generated services', () => {
  it('types feature, host and repository services, never any', () => {
    expectTypeOf(services).toEqualTypeOf<Services>();
    // Each member is pinned against its source of truth: the host's contract for `inference`,
    // the feature's own module for a pack service and a repository.
    expectTypeOf(services.inference.generateText).toEqualTypeOf<HostServices['inference']['generateText']>();
    expectTypeOf(services.prompt.usePrompt).toEqualTypeOf<typeof promptService.usePrompt>();
    expectTypeOf(services.logger).toEqualTypeOf<Logger>();
    expectTypeOf<Services['repository']>().toEqualTypeOf<Repositories>();
  });

  it('rejects a service that is not registered', () => {
    expect(() => {
      // @ts-expect-error not a service of this pack, its dependencies or the host
      void services.notAService;
    }).toThrow('Pack "default-setup" has not selected service "notAService"; declare its reference in consumes.services');
  });
});

describe('Generated repository', () => {
  it('types each declared repository', () => {
    // flowsCommands exposes the SDK repository's method by reference, so the facade must carry
    // exactly that signature (see default-setup/CLAUDE.md, "never a wrapper re-declaring it").
    expectTypeOf(() => repository.flowsCommands.createFlow).returns.toEqualTypeOf<typeof flowRepository.createFlow>();
    // @ts-expect-error not a declared repository
    expectTypeOf(() => repository.notARepository).returns.toBeUnknown();
  });
});

// ─── Runtime assertions ────────────────────────────────────────────────
// These verify that generics flow through the actual delegate chain at runtime.

describe('Generic flow — runtime verification', () => {
  beforeEach(() => resetTestData());

  it("create's row() and pickOne() read the entity back typed by its id, with no shape to name", () => {
    const entity = create(EARS.Entity.Action, { input: {}, label: 'TypedAction', actionFn: 'fn()', category: 'test' }).row();
    expectTypeOf(entity.actionFn).toEqualTypeOf<string>();

    const found = query.ids(entity.id).pickOne();
    expectTypeOf(found).toEqualTypeOf<EntityShape<'Action'> | undefined>();
    expect(found).toEqual(entity);
    // An id with no type in it is narrowed by ofType, which checks the entity's type rather than asserting it
    const plain: EARS.EntityId = entity.id;
    expect(query.ids(plain).ofType(EARS.Entity.Action).pickOne()?.label).toBe('TypedAction');
    expect(query.ids(plain).ofType(EARS.Entity.Prompt).pickOne()).toBeUndefined();
  });

  it('a query by type returns every row of it', () => {
    create(EARS.Entity.Action, { input: {}, label: 'A1', actionFn: 'fn1()' });
    create(EARS.Entity.Action, { input: {}, label: 'A2', actionFn: 'fn2()' });

    const all = query(EARS.Entity.Action).pickAll();
    expect(all).toHaveLength(2);
    expect(all[0].label).toBeDefined();
    expect(all[0].actionFn).toBeDefined();
  });

  it('a query by a field returns the declared shape', () => {
    create(EARS.Entity.Action, { input: {}, label: 'CatA', actionFn: 'fn()', category: 'alpha' });
    create(EARS.Entity.Action, { input: {}, label: 'CatB', actionFn: 'fn()', category: 'beta' });

    const results = query(EARS.Entity.Action).where('category', 'alpha').pickAll();
    expect(results).toHaveLength(1);
    expect(results[0].label).toBe('CatA');
    expect(results[0].category).toBe('alpha');
  });

  it('query() fluent chain produces typed results', () => {
    create(EARS.Entity.Action, { input: {}, label: 'Chain', actionFn: 'fn()' });

    const ids = query(EARS.Entity.Action as any).ids();
    expect(Array.isArray(ids)).toBe(true);
    expect(ids.length).toBe(1);

    const count = query(EARS.Entity.Action as any).count();
    expect(typeof count).toBe('number');
    expect(count).toBe(1);

    const exists = query(EARS.Entity.Action as any).exists();
    expect(typeof exists).toBe('boolean');
    expect(exists).toBe(true);
  });

  it('query().map() returns correctly typed array', () => {
    // The row map() then walks
    create(EARS.Entity.Action, { input: {}, label: 'MapTest', actionFn: 'fn()' });

    const labels = query(EARS.Entity.Action as any).map(
      (entityId) => `prefix-${entityId}`
    );
    expect(labels).toHaveLength(1);
    expect(labels[0]).toContain('prefix-Action-');
  });

  it('create() fluent chain writes the entity it created', () => {
    const id = untypedCreate(EARS.Entity.Action, { label: 'TxChain', input: {}, actionFn: 'return 1', status: 'active' }).id();

    expect(id).toMatch(/^Action-/);
    const label = query.ids(id).pickOne(['label'] as const);
    expect(label).toMatchObject({ label: 'TxChain' });
  });

  it('loadJSON<T> preserves generic type', () => {
    type Config = { items: string[] };
    const result = loadJSON<Config>('/nonexistent/path.json');
    expect(result).toBeNull();
  });


  it('createLogger returns Logger with callable methods', () => {
    const logger = createLogger('type-test');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });
});
