// Type assertions exercise the real database port. If it widens back to arbitrary records, these must fail.
import { expectTypeOf, it } from 'vitest';
import type { EarsDatabase, EarsUnit, Connection, ReadRequest, WriteRequest, Answer } from '../src/database.ts';

it('requires complete operations, reads and query plans at every structured entry', () => {
  expectTypeOf<{ ops: [{ op: 'set'; fields: { title: string } }] }>().not.toExtend<WriteRequest>();
  expectTypeOf<{ ops: [{ op: 'invented'; id: string }] }>().not.toExtend<Parameters<EarsDatabase['write']>[0]>();
  expectTypeOf<{ ops: [{ op: 'embed'; id: string; vector: number[] }] }>().not.toExtend<Parameters<EarsUnit['write']>[0]>();
  expectTypeOf<[{ op: 'link'; source: string; kind: string }]>().not.toExtend<Parameters<Connection['write']>[0]>();
  expectTypeOf<{ reads: [{ read: 'query'; plan: { start: { from: 'all' } } }] }>().not.toExtend<ReadRequest>();
  expectTypeOf<{ reads: [{ read: 'field'; id: string }] }>().not.toExtend<Parameters<EarsDatabase['readSync']>[0]>();
  expectTypeOf<{ reads: [{ read: 'query'; plan: { start: { from: 'all' }; terminal: { answer: 'ids' }; steps: [{ step: 'where'; field: string }] } }] }>().not.toExtend<Parameters<EarsUnit['read']>[0]>();
  expectTypeOf<[{ read: 'invented' }]>().not.toExtend<Parameters<Connection['read']>[0]>();
  expectTypeOf<[{ load: 'entity'; id: string }]>().not.toExtend<Parameters<EarsDatabase['bulkLoad']>[0]>();
  expectTypeOf<[{ load: 'unset'; id: string; field: string }]>().toExtend<Parameters<Connection['load']>[0]>();
  expectTypeOf<[{ op: 'set'; id: string; fields: { title: string } }]>().toExtend<Parameters<Connection['write']>[0]>();
  expectTypeOf<Extract<Answer, { kind: 'field' }>>().toEqualTypeOf<{ kind: 'field'; present: boolean; value: unknown }>();
  expectTypeOf<{ kind: 'count'; n: string }>().not.toExtend<ReturnType<EarsDatabase['readSync']>[number]>();
  expectTypeOf<{ kind: 'invented' }>().not.toExtend<ReturnType<EarsUnit['read']>[number]>();
});
