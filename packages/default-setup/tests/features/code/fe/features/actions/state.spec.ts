// The code surface's actions and prompts panels open an entity's code in a tab and save the tab back into it. Each
// is an ask of the code system, several of which run at once (a restore opens every tab it had), so each ask's
// outcome is its own: the one that ends is the one whose tab opens.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor, type AnyActorRef } from 'xstate';

type Outcome = { ok: true; value: object } | { ok: false; failure: { kind: string; message: string } };
const asks = vi.hoisted(() => [] as { type: string; input: unknown; end(outcome: unknown): void }[]);
const parent = vi.hoisted(() => ({ tabs: [] as { path: string }[], updates: [] as { openFiles?: { modified: boolean; actionEntity?: { actionFn: string } }[] }[] }));
vi.mock('#generated/events.ts', async () => {
  const { fromPromise } = await import('xstate');
  return {
    sendToSurface: vi.fn(),
    // An ask a machine spawns: recorded as it is made, and ended by the case
    fromAsk: (_to: string, type: string) => fromPromise(({ input }) => new Promise((end) => { asks.push({ type, input, end }); })),
  };
});
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  getParentContext: () => ({ openFiles: parent.tabs }),
  addTabToParent: (_self: AnyActorRef, tab: { path: string }) => { parent.tabs.push(tab); },
  updateParentState: (_self: AnyActorRef, updates: object) => { parent.updates.push(updates); },
}));

const { actionsState } = await import('#features/code/fe/features/actions/state.ts');
const { promptsState } = await import('#features/code/fe/features/prompts/state.ts');

const end = (ask: (typeof asks)[number], outcome: Outcome) => ask.end(outcome);
const childIds = (actor: AnyActorRef) => Object.keys((actor.getSnapshot() as { children: object }).children);

beforeEach(() => { asks.length = 0; parent.tabs = []; parent.updates = []; });

it('opens a tab for each action a restore asks for, whichever answer comes first, and none for one that is not there', async () => {
  const actor = createActor(actionsState).start();
  actor.send({ type: 'codeActions.OPEN_TABS', actionIds: ['a', 'b', 'gone'] });
  expect(asks.map(ask => [ask.type, ask.input])).toEqual([
    ['codeActions.OPEN_ACTION', { actionId: 'a' }], ['codeActions.OPEN_ACTION', { actionId: 'b' }], ['codeActions.OPEN_ACTION', { actionId: 'gone' }],
  ]);

  end(asks[2]!, { ok: false, failure: { kind: 'not-found', message: 'Action gone not found' } });
  end(asks[1]!, { ok: true, value: { id: 'b', actionFn: 'return "b"' } });
  end(asks[0]!, { ok: true, value: { id: 'a', actionFn: 'return "a"', actionFnContent: 'return "a!"' } });

  await vi.waitFor(() => expect(parent.tabs).toHaveLength(2));
  expect(parent.tabs).toMatchObject([
    { path: 'action:b', content: 'return "b"', isAction: true, modified: false },
    { path: 'action:a', content: 'return "a!"', isAction: true, modified: false },
  ]);
  await vi.waitFor(() => expect(childIds(actor), 'an ask that ended is let go').toEqual([]));
  actor.stop();
});

it('puts the saved action in its tab, unmodified, and leaves the tab as it was when the save is refused', async () => {
  parent.tabs = [{ path: 'action:a', isAction: true, modified: true, actionEntity: { id: 'a', actionFn: 'old' } } as never];
  const actor = createActor(actionsState).start();

  actor.send({ type: 'codeActions.SAVE_ACTION', actionId: 'a', content: 'new' });
  expect(asks.map(ask => [ask.type, ask.input])).toEqual([['codeActions.SAVE_ACTION', { actionId: 'a', actionFn: 'new' }]]);
  end(asks[0]!, { ok: false, failure: { kind: 'not-found', message: 'Action a not found' } });
  await vi.waitFor(() => expect(childIds(actor), 'the refused save ended').toEqual([]));
  expect(parent.updates, 'a refused save changes no tab').toEqual([]);

  actor.send({ type: 'codeActions.SAVE_ACTION', actionId: 'a', content: 'new' });
  end(asks[1]!, { ok: true, value: { id: 'a', actionFn: 'new' } });
  await vi.waitFor(() => expect(parent.updates).toHaveLength(1));
  expect(parent.updates[0]!.openFiles).toMatchObject([{ modified: false, actionEntity: { actionFn: 'new' } }]);
  actor.stop();
});

it("opens a prompt's template in a tab and puts the saved prompt back in it", async () => {
  const actor = createActor(promptsState).start();
  actor.send({ type: 'codePrompts.OPEN_PROMPT', promptId: 'p' });
  expect(asks.map(ask => [ask.type, ask.input])).toEqual([['codePrompts.OPEN_PROMPT', { promptId: 'p' }]]);
  end(asks[0]!, { ok: true, value: { id: 'p', templateFn: 'hi' } });
  await vi.waitFor(() => expect(parent.tabs).toMatchObject([{ path: 'prompt:p', content: 'hi', isPrompt: true }]));

  parent.tabs = [{ path: 'prompt:p', isPrompt: true, modified: true, promptEntity: { id: 'p', templateFn: 'hi' } } as never];
  actor.send({ type: 'codePrompts.SAVE_PROMPT', promptId: 'p', content: 'yo' });
  expect(asks[1]).toMatchObject({ type: 'codePrompts.SAVE_PROMPT', input: { promptId: 'p', templateFn: 'yo' } });
  end(asks[1]!, { ok: true, value: { id: 'p', templateFn: 'yo' } });
  await vi.waitFor(() => expect(parent.updates).toHaveLength(1));
  expect(parent.updates[0]!.openFiles).toMatchObject([{ modified: false, promptEntity: { templateFn: 'yo' } }]);
  actor.stop();
});
