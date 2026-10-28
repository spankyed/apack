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

it('rolls back failed batches and nested writes without losing committed dependencies', () => {
  const db = openTestDatabase({ types: { Task: { required: [] } }, relations: {}, roles: [] });
  db.write({ ops: ['a', 'b', 'c', 'd'].map(suffix => ({ op: 'create', type: 'Task', id: `Task-${suffix}`, fields: { title: suffix } })) });
  for (const [index, suffix] of ['a', 'b', 'c', 'd'].entries()) db.readSync({ track: index + 1, reads: [{ read: 'field', id: `Task-${suffix}`, field: 'title' }] });
  const unit = db.begin();
  expect(() => unit.write({ ops: [
    { op: 'set', id: 'Task-b', fields: { title: 'failed batch' } },
    { op: 'set', id: 'Task-missing', fields: { title: 'refused' } },
  ] })).toThrow();
  unit.write({ ops: [{ op: 'set', id: 'Task-a', fields: { title: 'kept a' } }] });
  const outer = unit.savepoint();
  unit.write({ ops: [{ op: 'set', id: 'Task-b', fields: { title: 'rolled back b' } }, { op: 'set', id: 'Task-a', fields: { title: 'rolled back a' } }] });
  const inner = unit.savepoint();
  unit.write({ ops: [{ op: 'set', id: 'Task-c', fields: { title: 'rolled back c' } }] });
  unit.release(inner);
  unit.rollbackTo(outer);
  unit.write({ ops: [{ op: 'set', id: 'Task-d', fields: { title: 'kept d' } }] });
  const touched = unit.commit().touched.sort((a, b) => a - b);
  // Native UnitState deliberately retains rolled-back keys, permitting extra reruns. The candidate uses logical
  // deltas instead; verify its stronger precision without inventing a different native correctness contract.
  expect(touched).toEqual(expect.arrayContaining([1, 4]));
  if (process.env.EARS_EVALUATION_BACKEND === 'sqlite') expect(touched).toEqual([1, 4]);
  expect(db.readSync({ reads: ['a', 'b', 'c', 'd'].map(suffix => ({ read: 'field', id: `Task-${suffix}`, field: 'title' })) }))
    .toEqual(['kept a', 'b', 'c', 'kept d'].map(value => ({ kind: 'field', present: true, value })));
});

it('includes released savepoints and commits that close an open savepoint', () => {
  const db = openTestDatabase({ types: { Task: { required: [] } }, relations: {}, roles: [] });
  db.write({ ops: [{ op: 'create', type: 'Task', id: 'Task-a', fields: { title: 'before' } }] });
  db.readSync({ track: 1, reads: [{ read: 'field', id: 'Task-a', field: 'title' }] });
  const unit = db.begin();
  const outer = unit.savepoint();
  unit.savepoint();
  unit.write({ ops: [{ op: 'set', id: 'Task-a', fields: { title: 'released' } }] });
  unit.release(outer);
  unit.savepoint();
  unit.write({ ops: [{ op: 'set', id: 'Task-a', fields: { title: 'committed' } }] });
  expect(unit.commit().touched).toEqual([1]);
  expect(db.readSync({ reads: [{ read: 'field', id: 'Task-a', field: 'title' }] })[0]).toEqual({ kind: 'field', present: true, value: 'committed' });
});
