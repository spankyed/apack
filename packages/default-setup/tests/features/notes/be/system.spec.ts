// A note dropped onto itself or into its own subtree stays where it was: the move would make the notes a loop
// with no root, which the tree cannot show and every walk of it would have to survive
import { afterEach, beforeEach, expect, it } from 'vitest';
import { startApp, type TestApp } from '@apackdev/testing/harness';
import { resetTestData } from '@apackdev/sdk/testing';
import { query, transact, write, EARS } from '#generated/ears.ts';
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

it('keeps a note\'s references in step with its text, however the text was written', () => {
  const target = note('target');
  const source = note('source');
  // Past the repository, which has no part in it
  write(source).set('content', `[target](${formatReferenceHref({ type: 'note', id: target })})`);
  expect(query.ids(source).out(EARS.RelKind.REFERENCES, EARS.Entity.Note).ids()).toEqual([target]);

  write(source).set('content', 'no links');
  expect(query.ids(source).out(EARS.RelKind.REFERENCES, EARS.Entity.Note).ids()).toEqual([]);
});

it('commits a note and its references together', () => {
  const target = note('target');
  const source = note('source');
  const before = query.ids(source).out(EARS.RelKind.REFERENCES, EARS.Entity.Note).ids();
  expect(() => transact(() => {
    write(source).set('content', `[target](${formatReferenceHref({ type: 'note', id: target })})`);
    throw new Error('undone');
  })).toThrow('undone');
  expect(query.ids(source).pickOne(['content'])?.content).not.toContain('target');
  expect(query.ids(source).out(EARS.RelKind.REFERENCES, EARS.Entity.Note).ids()).toEqual(before);
});

it('ancestorChain is the notes above one, its root first', () => {
  const { top, middle, bottom } = tree();
  expect(repository.noteQueries.ancestorChain(bottom).map((n) => n.id)).toEqual([top, middle]);
  expect(repository.noteQueries.ancestorChain(top)).toEqual([]);
});
