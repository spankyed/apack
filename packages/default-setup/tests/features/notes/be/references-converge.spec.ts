// A note's references are what its text says, whatever wrote the text and in whatever order: the invariant the references
// projection exists for, over random histories, checked against a rebuild from nothing.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { startApp, type TestApp } from '@apackdev/testing/harness';
import { resetTestData } from '@apackdev/sdk/testing';
import { formatReferenceHref } from '@apackdev/sdk/framework';
import { query, write, EARS } from '#generated/ears.ts';
import { repository } from '#generated/repository.ts';
import { noteProjections } from '#features/notes/be/projections.ts';

let app: TestApp;
beforeEach(async () => {
  resetTestData();
  app = await startApp({ systems: ['notes'] });
});
afterEach(() => app.stop());

const referencesOf = (id: EARS.EntityId) =>
  query.withTrashed.ids(id).out(EARS.RelKind.REFERENCES, EARS.Entity.Note).ids().map(String).sort();
const everyNote = () => query.withTrashed(EARS.Entity.Note).ids() as EARS.EntityId[];
const snapshot = () => Object.fromEntries(everyNote().map((id) => [id, referencesOf(id)]));

/** A small deterministic generator, so a failure's seed replays it */
const random = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

it.each([1, 2, 3, 4, 5, 6, 7, 8])('holds what a rebuild from nothing would, after a random history of writes (seed %i)', (seed) => {
  const next = random(seed);
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!;
  const notes: EARS.EntityId[] = [0, 1, 2].map((n) => repository.noteCommands.create({ title: `n${n}`, content: '' }).id as EARS.EntityId);
  for (let step = 0; step < 30; step++) {
    const note = pick(notes);
    const roll = next();
    if (roll < 0.15) notes.push(repository.noteCommands.create({ title: 'later', content: '' }).id as EARS.EntityId);
    else if (roll < 0.7) {
      const links = [pick(notes), pick(notes)].slice(0, Math.floor(next() * 3));
      write(note).set('content', links.map((id) => `[x](${formatReferenceHref({ type: 'note', id })})`).join(' '));
    } else if (roll < 0.85) write(note).trash();
    else if (query.trashed(EARS.Entity.Note).ids().includes(note)) write(note).restore();
  }
  const inline = snapshot();
  expect(Object.keys(inline).length).toBeGreaterThan(2);
  noteProjections.references.rebuild();
  expect(snapshot()).toEqual(inline);
});
