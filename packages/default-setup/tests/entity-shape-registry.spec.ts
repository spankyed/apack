// Compile-time checks, run by `vue-tsc` (npm run typecheck:pack). Exact type equality fails when a
// generated entity shape regresses to `any` or loses its declared field types.
import { describe, expectTypeOf, it } from 'vitest';
import type { BaseEntity } from '@apackdev/sdk/ears';
import type { SdkEntityShapes, ActionEntity, FlowEntity, NodeBase } from '@apackdev/sdk';
import type { NodeEntity } from '#generated/types.ts';
import type { EntityShape, OwnEntityShapes, PackShapes } from '#generated/ears.ts';
import type { MessageEntity, ThreadShape } from '#features/threads/be/types.ts';

describe('PackShapes', () => {
  it('maps declared entities to their shape types, a numbered one with the short code its entry declares', () => {
    expectTypeOf<OwnEntityShapes['Thread']>().toEqualTypeOf<ThreadShape & { shortCode: `THR-${number}` }>();
    expectTypeOf<OwnEntityShapes['Message']>().toEqualTypeOf<MessageEntity>();
  });

  it("includes the SDK's shapes, and no relation, which is no entity", () => {
    expectTypeOf<PackShapes['Action']>().toEqualTypeOf<ActionEntity>();
    expectTypeOf<PackShapes['Flow']>().toEqualTypeOf<FlowEntity>();
    expectTypeOf<PackShapes>().not.toHaveProperty('Relation');
    expectTypeOf<SdkEntityShapes>().not.toHaveProperty('Relation');
  });

  it("reads Node rows as the pack's step node types, not the SDK's NodeBase", () => {
    expectTypeOf<SdkEntityShapes['Node']>().toEqualTypeOf<NodeBase>();
    expectTypeOf<PackShapes['Node']>().toEqualTypeOf<NodeEntity>();
  });

  it('has no key for an undeclared entity', () => {
    // @ts-expect-error not declared in apack.json entity declarations
    expectTypeOf<OwnEntityShapes['SomeFutureEntity']>().toBeNever();
  });
});

describe('EntityShape<E>', () => {
  it('types declared fields exactly, with the base entity fields', () => {
    expectTypeOf<EntityShape<'Action'>['actionFn']>().toEqualTypeOf<string>();
    expectTypeOf<EntityShape<'Thread'>['topic']>().toEqualTypeOf<string>();
    expectTypeOf<EntityShape<'Thread'>['pinned']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<EntityShape<'Flow'>['flowType']>().toEqualTypeOf<'workflow' | 'integration'>();
    expectTypeOf<EntityShape<'Message'>['sender']>().toEqualTypeOf<'user' | 'assistant' | 'system' | 'marker'>();
    expectTypeOf<EntityShape<'Action'>['createdAt']>().toEqualTypeOf<number>();
  });

  it('rejects a field the shape does not declare', () => {
    // @ts-expect-error Action has no such field
    expectTypeOf<EntityShape<'Action'>['notAField']>().toBeUnknown();
  });

  it('reads an undeclared entity as base fields plus unknown values, never any', () => {
    expectTypeOf<EntityShape<'SomeFutureEntity'>>().toEqualTypeOf<BaseEntity & Record<string, unknown>>();
    expectTypeOf<EntityShape<'SomeFutureEntity'>['anything']>().toBeUnknown();
  });
});
