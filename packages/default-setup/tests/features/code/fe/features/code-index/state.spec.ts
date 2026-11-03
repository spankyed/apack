import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createActor, createMachine, sendTo, setup, type ActorRefFrom } from 'xstate';
import { answerTo } from '@apackdev/sdk/testing';

const { sendToSystem, updateParentState } = vi.hoisted(() => ({ sendToSystem: vi.fn(), updateParentState: vi.fn() }));
vi.mock('#generated/events.ts', () => ({ sendToSystem }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({ updateParentState }));
const { codeIndexState } = await import('#features/code/fe/features/code-index/state.ts');

const explorer = vi.fn();
/** The code surface, as far as this child reaches it: a parent holding an explorer */
const surface = setup({
  actors: {
    codeIndexState,
    explorerState: createMachine({ on: { '*': { actions: ({ event }) => explorer(event) } } }),
  },
}).createMachine({
  invoke: [{ id: 'codeIndex', src: 'codeIndexState' }, { id: 'explorer', src: 'explorerState' }],
  on: { '*': { actions: sendTo('codeIndex', ({ event }) => event) } },
});

let parent: ReturnType<typeof createActor<typeof surface>>;
let actor: ActorRefFrom<typeof codeIndexState>;
const lastCall = () => (sendToSystem.mock.lastCall![2] as { call: string }).call;

beforeEach(() => {
  sendToSystem.mockReset(); updateParentState.mockReset(); explorer.mockReset();
  parent = createActor(surface).start();
  actor = parent.getSnapshot().children.codeIndex as ActorRefFrom<typeof codeIndexState>;
});
afterEach(() => parent.stop());

it('opens a symbol at the place the backend answers', () => {
  actor.send({ type: 'codeIndex.OPEN_SYMBOL', symbol: 'CodeSymbol-a' });
  expect(sendToSystem.mock.lastCall!.slice(0, 2)).toEqual(['code', { type: 'codeIndex.LOCATE', symbol: 'CodeSymbol-a' }]);
  actor.send(answerTo(lastCall(), { type: 'codeIndex.LOCATED', data: { path: '/work/a.ts', line: 7, column: 3 } }));
  expect(explorer).toHaveBeenCalledWith(expect.objectContaining({ type: 'explorer.OPEN_FILE', path: '/work/a.ts' }));
  expect(updateParentState).toHaveBeenCalledWith(actor, { pendingRevealLine: { filePath: '/work/a.ts', line: 7, column: 3 } });
});

it('drops the answer to a symbol the user has since moved on from', () => {
  actor.send({ type: 'codeIndex.OPEN_SYMBOL', symbol: 'CodeSymbol-a' });
  const first = lastCall();
  actor.send({ type: 'codeIndex.OPEN_SYMBOL', symbol: 'CodeSymbol-b' });
  actor.send(answerTo(first, { type: 'codeIndex.LOCATED', data: { path: '/work/a.ts', line: 1, column: 1 } }));
  expect(explorer).not.toHaveBeenCalled();
});

it('opens nothing for a symbol that is gone', () => {
  actor.send({ type: 'codeIndex.OPEN_SYMBOL', symbol: 'CodeSymbol-a' });
  actor.send(answerTo(lastCall(), { type: 'codeIndex.LOCATED', data: null }));
  expect(explorer).not.toHaveBeenCalled();
  expect(updateParentState).not.toHaveBeenCalled();
});

it('keeps only the answer to the latest diff it asked for', () => {
  actor.send({ type: 'codeIndex.LOAD_STAGED_DIFF' });
  const older = lastCall();
  actor.send({ type: 'codeIndex.LOAD_STAGED_DIFF' });
  const newer = lastCall();
  actor.send(answerTo(older, { type: 'codeIndex.SEMANTIC_DIFF_READY', data: { changes: [], unread: ['old.md'] } }));
  expect(actor.getSnapshot().context.diff).toBeNull();
  actor.send(answerTo(newer, { type: 'codeIndex.SEMANTIC_DIFF_READY', data: { changes: [], unread: ['new.md'] } }));
  expect(actor.getSnapshot().context.diff?.unread).toEqual(['new.md']);
});

it('says why a diff failed, and clears that on the next ask', () => {
  actor.send({ type: 'codeIndex.LOAD_STAGED_DIFF' });
  actor.send(answerTo(lastCall(), { type: 'codeIndex.SEMANTIC_DIFF_FAILED', data: { message: 'no' } }));
  expect(actor.getSnapshot().context.diffError).toBe('no');
  actor.send({ type: 'codeIndex.LOAD_STAGED_DIFF' });
  expect(actor.getSnapshot().context.diffError).toBeNull();
});

it('asks the backend to turn the index on and off', () => {
  actor.send({ type: 'codeIndex.TOGGLE', enabled: true });
  expect(sendToSystem).toHaveBeenCalledWith('code', { type: 'codeIndex.SET_ENABLED', enabled: true });
});
