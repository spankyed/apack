// Exercise backend result discriminants directly; facade property access must not hide a transport mismatch.
import { expect, it } from 'vitest';
import { openTestDatabase } from './engine-under-test.ts';

it('returns the same typed result vocabulary for reads and count-only groups', () => {
  const db = openTestDatabase({ types: { Task: { required: [], embed: { from: ['body'], model: 'fixture', dims: 2 } } }, relations: {}, roles: [] });
  const written = db.write({ now: 100, ops: [
    { op: 'create', type: 'Task', id: 'Task-a', fields: { body: 'first', group: 'same' } },
    { op: 'create', type: 'Task', id: 'Task-b', fields: { body: 'second', group: 'same' } },
  ] });
  expect(written.results.map(result => result.kind)).toEqual(['entity', 'entity']);
  expect(written.changes?.sequence).toBe(db.sequence);
  const start = { from: 'types' as const, types: ['Task'] };
  const answers = db.readSync({ reads: [
    { read: 'field', id: 'Task-a', field: 'body' },
    { read: 'query', plan: { start, terminal: { answer: 'exists' } } },
    { read: 'wouldCreateCycle', source: 'Task-a', target: 'Task-b', kinds: [] },
    { read: 'pendingEmbeddings', type: 'Task' },
    { read: 'query', plan: { start, terminal: { answer: 'groupBy', field: 'group', counts: true } } },
  ] });
  expect(answers[0]).toEqual({ kind: 'field', present: true, value: 'first' });
  expect(answers[1]).toMatchObject({ kind: 'bool', value: true });
  expect(answers[2]).toEqual({ kind: 'bool', value: false });
  expect(answers[3]).toMatchObject({ kind: 'pending', index: expect.any(String), model: 'fixture', dims: 2, count: 2,
    chunks: [expect.objectContaining({ id: 'Task-a', chunk: 0, hash: expect.any(String), text: 'first' }), expect.objectContaining({ id: 'Task-b', text: 'second' })] });
  expect(answers[4]).toMatchObject({ kind: 'groups', groups: [['same', 2]] });
  expect(db.readSync({ reads: [{ read: 'query', explain: true, plan: { start, terminal: { answer: 'ids' } } }] })[0])
    .toMatchObject({ kind: 'explained', backend: process.env.EARS_EVALUATION_BACKEND === 'sqlite' ? 'sqlite' : 'elmdb', answer: { kind: 'ids', ids: ['Task-a', 'Task-b'] } });
});
