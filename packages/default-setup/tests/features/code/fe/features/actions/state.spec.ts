// The code surface's actions and prompts panels open an entity's code in a tab and save the tab back into it. Each
// is an ask of the code system, several of which run at once (a restore opens every tab it had), so each ask's
// outcome is its own: the one that ends is the one whose tab opens.
import { afterEach, expect, it } from 'vitest';
import { actionsState } from '#features/code/fe/features/actions/state.ts';
import { promptsState } from '#features/code/fe/features/prompts/state.ts';
import { startMachine } from '../../_support/asks.ts';

const running: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const h of running.splice(0)) h.stop();
});

it('opens a tab for each action a restore asks for, whichever answer comes first, and none for one that is not there', async () => {
  const h = startMachine(actionsState, { reports: ['CODE_ACTIONS_SHOW_TAB', 'CODE_ACTIONS_ACTION_SAVED'] });
  running.push(h);

  h.send({ type: 'codeActions.OPEN_TABS', actionIds: ['a', 'b', 'gone'] });
  expect(h.made.map((ask) => [ask.event.type, ask.event.actionId])).toEqual([
    ['codeActions.OPEN_ACTION', 'a'],
    ['codeActions.OPEN_ACTION', 'b'],
    ['codeActions.OPEN_ACTION', 'gone'],
  ]);

  await h.made[2]!.refuse('Action gone not found', { kind: 'not-found' });
  await h.made[1]!.answer({ id: 'b', actionFn: 'return "b"' });
  await h.made[0]!.answer({ id: 'a', actionFn: 'return "a"', actionFnContent: 'return "a!"' });

  expect(h.reportsOf('CODE_ACTIONS_SHOW_TAB')).toMatchObject([
    { type: 'CODE_ACTIONS_SHOW_TAB', tab: { path: 'action:b', content: 'return "b"', isAction: true, modified: false } },
    { type: 'CODE_ACTIONS_SHOW_TAB', tab: { path: 'action:a', content: 'return "a!"', isAction: true, modified: false } },
  ]);
  expect(h.read().pending.open, 'an ask that ended is let go').toBe(0);
});

it('puts the saved action in its tab, unmodified, and leaves the tab as it was when the save is refused', async () => {
  const h = startMachine(actionsState, { reports: ['CODE_ACTIONS_SHOW_TAB', 'CODE_ACTIONS_ACTION_SAVED'] });
  running.push(h);

  h.send({ type: 'codeActions.SAVE_ACTION', actionId: 'a', content: 'new' });
  expect(h.made.map((ask) => ask.event)).toEqual([{ type: 'codeActions.SAVE_ACTION', actionId: 'a', actionFn: 'new' }]);
  await h.made[0]!.refuse('Action a not found', { kind: 'not-found' });
  expect(h.read().pending.save, 'the refused save ended').toBe(0);
  expect(h.reportsOf('CODE_ACTIONS_ACTION_SAVED'), 'a refused save changes no tab').toEqual([]);

  h.send({ type: 'codeActions.SAVE_ACTION', actionId: 'a', content: 'new' });
  await h.made[1]!.answer({ id: 'a', actionFn: 'new' });
  expect(h.reportsOf('CODE_ACTIONS_ACTION_SAVED')).toMatchObject([
    { type: 'CODE_ACTIONS_ACTION_SAVED', action: { id: 'a', actionFn: 'new' } },
  ]);
});

it("opens a prompt's template in a tab and puts the saved prompt back in it", async () => {
  const h = startMachine(promptsState, { reports: ['CODE_PROMPTS_SHOW_TAB', 'CODE_PROMPTS_PROMPT_SAVED'] });
  running.push(h);

  h.send({ type: 'codePrompts.OPEN_PROMPT', promptId: 'p' });
  expect(h.made.map((ask) => ask.event)).toEqual([{ type: 'codePrompts.OPEN_PROMPT', promptId: 'p' }]);
  await h.made[0]!.answer({ id: 'p', templateFn: 'hi' });
  expect(h.reportsOf('CODE_PROMPTS_SHOW_TAB')).toMatchObject([
    { type: 'CODE_PROMPTS_SHOW_TAB', tab: { path: 'prompt:p', content: 'hi', isPrompt: true } },
  ]);

  h.send({ type: 'codePrompts.SAVE_PROMPT', promptId: 'p', content: 'yo' });
  expect(h.made[1]!.event).toEqual({ type: 'codePrompts.SAVE_PROMPT', promptId: 'p', templateFn: 'yo' });
  await h.made[1]!.answer({ id: 'p', templateFn: 'yo' });
  expect(h.reportsOf('CODE_PROMPTS_PROMPT_SAVED')).toMatchObject([
    { type: 'CODE_PROMPTS_PROMPT_SAVED', prompt: { id: 'p', templateFn: 'yo' } },
  ]);
});
