// What noteCommands.update stores: a cleared position is kept as null, so nothing restores a stale one, and a
// write that is no edit of the note leaves its updatedAt alone
import { beforeEach, expect, it, vi } from 'vitest';
import { resetTestData } from '@apackdev/sdk/testing';
import { query } from '#generated/ears.ts';
import { repository } from '#generated/repository.ts';
import type { EARS } from '#generated/ears.ts';

beforeEach(() => resetTestData());

const note = () => repository.noteCommands.create({ title: 'Task', content: '' }).id as EARS.EntityId<'Note'>;

it('removes a cleared savedDisplayOrder, which the shape holds as a number or nothing', () => {
  const id = note();
  repository.noteCommands.update(id, { savedDisplayOrder: 3 });
  repository.noteCommands.update(id, { savedDisplayOrder: null }, true);
  expect(query.ids(id).pickOne(['savedDisplayOrder'])).not.toHaveProperty('savedDisplayOrder');
  // Clearing an order already gone is no write, and no refusal
  expect(() => repository.noteCommands.update(id, { savedDisplayOrder: null }, true)).not.toThrow();
});

it('stamps updatedAt for an edit and not for a write it skips', () => {
  vi.useFakeTimers({ now: 1_000, toFake: ['Date'] });
  try {
    const id = note();
    vi.setSystemTime(2_000);
    repository.noteCommands.update(id, { lastSeen: 2_000 }, true);
    expect(query.ids(id).pickOne(['updatedAt'])?.updatedAt).toBe(1_000);
    repository.noteCommands.update(id, { title: 'Renamed' });
    expect(query.ids(id).pickOne(['updatedAt'])?.updatedAt).toBe(2_000);
  } finally {
    vi.useRealTimers();
  }
});
