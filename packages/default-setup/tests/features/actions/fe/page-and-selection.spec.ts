// The actions surface holds what the user is doing — which action is open, how far down the list they've read, the
// form — and the rows are its views' (`views.spec.ts`). What it hears of a view is `ACTION.LOADED`, which the canvas
// sends when the open action's view reads something: it fills the form once per opening, keeps the breadcrumb's
// label, and leaves the detail view when the action is gone. Nothing it does asks the backend for a row.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import type { ActionEntity } from '@apackdev/sdk';
import type { EARS } from '#generated/ears.ts';

const sendToSystem = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', () => ({ sendToSystem }));

const { default: actionsState, ACTIONS_PAGE_SIZE } = await import('#features/actions/fe/state.ts');

const id = (name: string) => name as EARS.EntityId;
/** A action as its view reads it; only the fields these assertions touch are real */
const aAction = (name: string, label = name) => ({ id: id(name), label, description: '', category: '', input: {}, actionFn: `return "${label}"` }) as unknown as ActionEntity;
const loaded = (name: string, action: ActionEntity | null) => ({ type: 'ACTION.LOADED' as const, actionId: id(name), action });

const start = () => createActor(actionsState).start();

beforeEach(() => {
  sendToSystem.mockReset();
});

it('opens a action without asking the backend for it, and fills the form from its view once', () => {
  const actor = start();
  actor.send({ type: 'ACTION.SELECT', actionId: id('Action-p1') });
  expect(actor.getSnapshot().matches('detail')).toBe(true);
  expect(sendToSystem, 'the view reads the action; nothing is asked for').not.toHaveBeenCalled();

  actor.send(loaded('Action-p1', aAction('Action-p1', 'first')));
  actor.send({ type: 'FORM.UPDATE_LABEL', label: 'typed' });
  // Another window renames it: the breadcrumb follows, the form the user is typing in doesn't
  actor.send(loaded('Action-p1', aAction('Action-p1', 'renamed elsewhere')));

  const { context } = actor.getSnapshot();
  expect(context.selectedLabel).toBe('renamed elsewhere');
  expect(context.formData.label).toBe('typed');
  expect(context.formData.actionFn).toBe('return "first"');
});

it('ignores what a view read for a action the user has moved on from', () => {
  const actor = start();
  actor.send({ type: 'ACTION.SELECT', actionId: id('Action-p1') });
  actor.send({ type: 'ACTION.SELECT', actionId: id('Action-p2') });

  actor.send(loaded('Action-p1', aAction('Action-p1')));
  actor.send(loaded('Action-p1', null));

  expect(actor.getSnapshot().matches('detail')).toBe(true);
  expect(actor.getSnapshot().context).toMatchObject({ selectedActionId: 'Action-p2', selectedLabel: undefined, formFor: undefined });
});

it('returns to the list when the open action is gone, deleted here or in another window', () => {
  const actor = start();
  actor.send({ type: 'ACTION.SELECT', actionId: id('Action-p1') });
  actor.send(loaded('Action-p1', aAction('Action-p1')));
  actor.send({ type: 'ACTION.DELETE', actionId: id('Action-p1') });
  expect(sendToSystem).toHaveBeenCalledWith('actions', { type: 'DELETE_ACTION', actionId: 'Action-p1' });
  expect(actor.getSnapshot().matches('detail'), 'still open until its view says it is gone').toBe(true);

  actor.send(loaded('Action-p1', null));
  expect(actor.getSnapshot().matches('list')).toBe(true);
  expect(actor.getSnapshot().context.selectedActionId).toBeUndefined();
});

it('fills the form afresh when a action is reopened from the list', () => {
  const actor = start();
  actor.send({ type: 'ACTION.SELECT', actionId: id('Action-p1') });
  actor.send(loaded('Action-p1', aAction('Action-p1', 'first')));
  actor.send({ type: 'FORM.UPDATE_LABEL', label: 'abandoned' });
  actor.send({ type: 'VIEW_LIST' });

  actor.send({ type: 'ACTION.SELECT', actionId: id('Action-p1') });
  actor.send(loaded('Action-p1', aAction('Action-p1', 'as stored')));
  expect(actor.getSnapshot().context.formData.label).toBe('as stored');
});

it('shows a page more each time the list is read to its end', () => {
  const actor = start();
  expect(actor.getSnapshot().context.listLimit).toBe(ACTIONS_PAGE_SIZE);
  actor.send({ type: 'ACTIONS.LOAD_MORE' });
  actor.send({ type: 'ACTIONS.LOAD_MORE' });
  expect(actor.getSnapshot().context.listLimit).toBe(3 * ACTIONS_PAGE_SIZE);
  expect(sendToSystem).not.toHaveBeenCalled();
});

it('saves the form it holds, as an update of the open action or a new one', () => {
  const actor = start();
  actor.send({ type: 'ACTION.SELECT', actionId: id('Action-p1') });
  actor.send(loaded('Action-p1', aAction('Action-p1', 'first')));
  actor.send({ type: 'FORM.UPDATE_LABEL', label: 'edited' });
  actor.send({ type: 'ACTION.SAVE' });
  expect(sendToSystem).toHaveBeenLastCalledWith('actions', expect.objectContaining({ type: 'UPDATE_ACTION', actionId: 'Action-p1', label: 'edited' }));
  expect(actor.getSnapshot().matches('list')).toBe(true);

  actor.send({ type: 'ACTION.CREATE' });
  actor.send({ type: 'FORM.UPDATE_LABEL', label: 'new' });
  actor.send({ type: 'ACTION.SAVE' });
  expect(sendToSystem).toHaveBeenLastCalledWith('actions', expect.objectContaining({ type: 'CREATE_ACTION', label: 'new' }));
});

it('opens its entity from the create view and refuses unrelated entity types', () => {
  const actor = start();
  actor.send({ type: 'ACTION.CREATE' });
  actor.send({ type: 'OPEN_ENTITY', id: 'Note-unrelated' });
  expect(actor.getSnapshot().matches('create')).toBe(true);
  actor.send({ type: 'OPEN_ENTITY', id: 'Action-p1' });
  expect(actor.getSnapshot().matches('detail')).toBe(true);
  expect(actor.getSnapshot().context.selectedActionId).toBe('Action-p1');
});
