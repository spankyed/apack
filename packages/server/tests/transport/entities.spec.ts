import { beforeEach, expect, it } from 'vitest';
import { untypedCreate, untypedWrite } from '@apackdev/sdk/ears';
import { resetTestData, startTestRuntime } from '@apackdev/sdk/testing';
import { entitiesRouter } from '../../src/transport/entities';

startTestRuntime({ entityTypes: ['Note'] });
beforeEach(() => resetTestData());
const caller = () => entitiesRouter.createCaller({ client: 'test', closed: new AbortController().signal });

it('checks the current database and excludes missing or trashed entities', async () => {
  const id = untypedCreate('Note').set('title', 'Saved').id();
  expect(await caller().exists({ id })).toBe(true);
  expect(await caller().exists({ id: 'Note-missing' })).toBe(false);
  untypedWrite(id).trash();
  expect(await caller().exists({ id })).toBe(false);
});

it.each(['', 'Note', 'plain'])('refuses malformed entity IDs: %j', async id => {
  await expect(caller().exists({ id: id as `${string}-${string}` })).rejects.toThrow('Expected an entity ID');
});

it('preserves explicitly provided entity IDs with empty suffixes', async () => {
  const id = untypedCreate('Note', { id: 'Note-' }).set('title', 'Provided').id();
  expect(await caller().exists({ id })).toBe(true);
});
