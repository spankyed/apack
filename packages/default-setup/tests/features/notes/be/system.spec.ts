// A note dropped onto itself or into its own subtree stays where it was: the move would make the notes a loop
// with no root, which the tree cannot show and every walk of it would have to survive
import { afterEach, beforeEach, expect, it } from 'vitest';
import { startApp, type TestApp } from '@apackdev/testing/harness';
import { resetTestData } from '@apackdev/sdk/testing';
import { query, write, EARS } from '#generated/ears.ts';
import { formatReferenceHref } from '@apackdev/sdk/framework';
import { repository } from '#generated/repository.ts';

let app: TestApp;
beforeEach(async () => {
  resetTestData();
  app = await startApp({ systems: ['notes'] });
});
afterEach(() => app.stop());

const note = (title: string, parentId?: string) => repository.noteCommands.create({ title, content: '', parentId }).id as EARS.EntityId;
const parentOf = (id: EARS.EntityId) => query.ids(id).in(EARS.RelKind.CONTAINS, EARS.Entity.Note).ids()[0] ?? null;

function tree() {
  const top = note('top');
  const middle = note('middle', top);
  const bottom = note('bottom', middle);
  const other = note('other');
  return { top, middle, bottom, other };
}

it.each([
  ['MOVE_NOTE', (id: string, newParentId: string) => ({ type: 'MOVE_NOTE' as const, ids: [id], newParentId })],
  ['REORDER_NOTE', (id: string, newParentId: string) => ({ type: 'REORDER_NOTE' as const, id, newParentId, newIndex: 0 })],
])('%s leaves a note dropped into its own subtree, or onto itself, where it was, and moves it anywhere else', async (_type, drop) => {
  const { top, middle, bottom, other } = tree();

  await app.send('notes', drop(top, bottom));
  await app.send('notes', drop(middle, middle));
  await app.settle();
  expect([parentOf(top), parentOf(middle), parentOf(bottom)]).toEqual([null, top, middle]);

  await app.send('notes', drop(middle, other));
  await app.settle();
  expect(parentOf(middle)).toBe(other);
});

it('indexes the references in what another process wrote', async () => {
  const target = note('target');
  const source = note('source');
  // Past the repository, which is what would have indexed it
  write(source).set('content', `[target](${formatReferenceHref({ type: 'note', id: target })})`);
  expect(query.ids(source).out(EARS.RelKind.REFERENCES, EARS.Entity.Note).ids()).toEqual([]);

  await app.send('notes', { type: 'DATA_CHANGED_ELSEWHERE' });
  await app.settle();

  expect(query.ids(source).out(EARS.RelKind.REFERENCES, EARS.Entity.Note).ids()).toEqual([target]);
});

it('ancestorChain is the notes above one, its root first', () => {
  const { top, middle, bottom } = tree();
  expect(repository.noteQueries.ancestorChain(bottom).map((n) => n.id)).toEqual([top, middle]);
  expect(repository.noteQueries.ancestorChain(top)).toEqual([]);
});
