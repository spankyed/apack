// The prompts surface holds what the user is doing — which prompt is open, how far down the list they've read, the
// form — and the rows are its views' (`views.spec.ts`). What it hears of a view is `PROMPT.LOADED`, which the canvas
// sends when the open prompt's view reads something: it fills the form once per opening, keeps the breadcrumb's
// label, and leaves the detail view when the prompt is gone. Nothing it does asks the backend for a row.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import type { PromptEntity } from '@apackdev/sdk';
import type { EARS } from '#generated/ears.ts';

// Each ask the machine spawns is recorded as it is made, and ends as `asked` answers it: never, unless a case says
const asked = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', async () => {
  const { fromPromise } = await import('xstate');
  return { fromAsk: (to: string, type: string) => fromPromise(({ input }: { input: object }) => asked(to, { type, ...input })) };
});

const { default: promptsState, PROMPTS_PAGE_SIZE } = await import('#features/prompts/fe/state.ts');

const id = (name: string) => name as EARS.EntityId;
/** A prompt as its view reads it; only the fields these assertions touch are real */
const aPrompt = (name: string, label = name) => ({ id: id(name), label, description: '', category: '', inputs: {}, templateFn: `return "${label}"` }) as unknown as PromptEntity;
const loaded = (name: string, prompt: PromptEntity | null) => ({ type: 'PROMPT.LOADED' as const, promptId: id(name), prompt });

const start = () => createActor(promptsState).start();

beforeEach(() => {
  asked.mockReset();
  asked.mockReturnValue(new Promise(() => {}));
});

it('opens a prompt without asking the backend for it, and fills the form from its view once', () => {
  const actor = start();
  actor.send({ type: 'PROMPT.SELECT', promptId: id('Prompt-p1') });
  expect(actor.getSnapshot().matches('detail')).toBe(true);
  expect(asked, 'the view reads the prompt; nothing is asked for').not.toHaveBeenCalled();

  actor.send(loaded('Prompt-p1', aPrompt('Prompt-p1', 'first')));
  actor.send({ type: 'FORM.UPDATE_LABEL', label: 'typed' });
  // Another window renames it: the breadcrumb follows, the form the user is typing in doesn't
  actor.send(loaded('Prompt-p1', aPrompt('Prompt-p1', 'renamed elsewhere')));

  const { context } = actor.getSnapshot();
  expect(context.selectedLabel).toBe('renamed elsewhere');
  expect(context.formData.label).toBe('typed');
  expect(context.formData.templateFn).toBe('return "first"');
});

it('ignores what a view read for a prompt the user has moved on from', () => {
  const actor = start();
  actor.send({ type: 'PROMPT.SELECT', promptId: id('Prompt-p1') });
  actor.send({ type: 'PROMPT.SELECT', promptId: id('Prompt-p2') });

  actor.send(loaded('Prompt-p1', aPrompt('Prompt-p1')));
  actor.send(loaded('Prompt-p1', null));

  expect(actor.getSnapshot().matches('detail')).toBe(true);
  expect(actor.getSnapshot().context).toMatchObject({ selectedPromptId: 'Prompt-p2', selectedLabel: undefined, formFor: undefined });
});

it('returns to the list when the open prompt is gone, deleted here or in another window', () => {
  const actor = start();
  actor.send({ type: 'PROMPT.SELECT', promptId: id('Prompt-p1') });
  actor.send(loaded('Prompt-p1', aPrompt('Prompt-p1')));
  actor.send({ type: 'PROMPT.DELETE', promptId: id('Prompt-p1') });
  expect(asked).toHaveBeenCalledWith('prompts', { type: 'DELETE_PROMPT', promptId: 'Prompt-p1' });
  expect(actor.getSnapshot().matches('detail'), 'still open until its view says it is gone').toBe(true);

  actor.send(loaded('Prompt-p1', null));
  expect(actor.getSnapshot().matches('list')).toBe(true);
  expect(actor.getSnapshot().context.selectedPromptId).toBeUndefined();
});

it('fills the form afresh when a prompt is reopened from the list', () => {
  const actor = start();
  actor.send({ type: 'PROMPT.SELECT', promptId: id('Prompt-p1') });
  actor.send(loaded('Prompt-p1', aPrompt('Prompt-p1', 'first')));
  actor.send({ type: 'FORM.UPDATE_LABEL', label: 'abandoned' });
  actor.send({ type: 'VIEW_LIST' });

  actor.send({ type: 'PROMPT.SELECT', promptId: id('Prompt-p1') });
  actor.send(loaded('Prompt-p1', aPrompt('Prompt-p1', 'as stored')));
  expect(actor.getSnapshot().context.formData.label).toBe('as stored');
});

it('shows a page more each time the list is read to its end', () => {
  const actor = start();
  expect(actor.getSnapshot().context.listLimit).toBe(PROMPTS_PAGE_SIZE);
  actor.send({ type: 'PROMPTS.LOAD_MORE' });
  actor.send({ type: 'PROMPTS.LOAD_MORE' });
  expect(actor.getSnapshot().context.listLimit).toBe(3 * PROMPTS_PAGE_SIZE);
  expect(asked).not.toHaveBeenCalled();
});

it('saves the form it holds, as an update of the open prompt or a new one', () => {
  const actor = start();
  actor.send({ type: 'PROMPT.SELECT', promptId: id('Prompt-p1') });
  actor.send(loaded('Prompt-p1', aPrompt('Prompt-p1', 'first')));
  actor.send({ type: 'FORM.UPDATE_LABEL', label: 'edited' });
  actor.send({ type: 'PROMPT.SAVE' });
  expect(asked).toHaveBeenLastCalledWith('prompts', expect.objectContaining({ type: 'UPDATE_PROMPT', promptId: 'Prompt-p1', label: 'edited' }));
  expect(actor.getSnapshot().matches('list')).toBe(true);

  actor.send({ type: 'PROMPT.CREATE' });
  actor.send({ type: 'FORM.UPDATE_LABEL', label: 'new' });
  actor.send({ type: 'PROMPT.SAVE' });
  expect(asked).toHaveBeenLastCalledWith('prompts', expect.objectContaining({ type: 'CREATE_PROMPT', label: 'new' }));
});

it('opens its entity from the create view and refuses unrelated entity types', () => {
  const actor = start();
  actor.send({ type: 'PROMPT.CREATE' });
  actor.send({ type: 'OPEN_ENTITY', id: 'Note-unrelated' });
  expect(actor.getSnapshot().matches('create')).toBe(true);
  actor.send({ type: 'OPEN_ENTITY', id: 'Prompt-p1' });
  expect(actor.getSnapshot().matches('detail')).toBe(true);
  expect(actor.getSnapshot().context.selectedPromptId).toBe('Prompt-p1');
});

it('shows a write it asked for that was refused, until the user dismisses it', async () => {
  asked.mockResolvedValueOnce({ ok: false, failure: { kind: 'failed', message: 'No such prompt' } });
  const actor = start();
  actor.send({ type: 'PROMPT.UPDATE_LABEL', promptId: 'Missing', label: 'renamed' });
  await vi.waitFor(() => expect(actor.getSnapshot().context.writeError).toBe('No such prompt'));
  expect(Object.keys(actor.getSnapshot().children), 'the ask that ended is not kept').toEqual([]);
  actor.send({ type: 'CLEAR_WRITE_ERROR' });
  expect(actor.getSnapshot().context.writeError).toBeNull();
});

it('shows nothing for a write that landed', async () => {
  asked.mockResolvedValueOnce({ ok: true, value: undefined });
  const actor = start();
  actor.send({ type: 'PROMPT.UPDATE_LABEL', promptId: 'Prompt-p1', label: 'renamed' });
  await vi.waitFor(() => expect(Object.keys(actor.getSnapshot().children)).toEqual([]));
  expect(actor.getSnapshot().context.writeError).toBeNull();
});
