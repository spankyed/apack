import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createActor, type ActorRefFrom } from 'xstate';

const { sendToSystem, updateParentState } = vi.hoisted(() => ({ sendToSystem: vi.fn(), updateParentState: vi.fn() }));
vi.mock('#generated/events.ts', () => ({ sendToSystem }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  updateParentState, getParentContext: () => ({ baseDirectory: '/work' }), addTabToParent: vi.fn(),
}));
const { explorerState } = await import('#features/code/fe/features/explorer/state.ts');
let actor: ActorRefFrom<typeof explorerState>;
beforeEach(() => {
  sendToSystem.mockReset(); updateParentState.mockReset();
  actor = createActor(explorerState).start();
});
afterEach(() => actor.stop());

it('reads the connected directory without turning restoration into a settings change', () => {
  actor.send({ type: 'CODE_STARTED', data: { baseDirectory: '/work' } });
  expect(updateParentState).toHaveBeenCalledWith(actor, { baseDirectory: '/work' });
  expect(sendToSystem.mock.calls).toEqual([['code', { type: 'explorer.LIST_FILES', path: '/work' }]]);
  actor.send({ type: 'CODE_STARTED', data: { baseDirectory: '/work' } });
  expect(sendToSystem.mock.calls).toEqual([
    ['code', { type: 'explorer.LIST_FILES', path: '/work' }],
    ['code', { type: 'explorer.LIST_FILES', path: '/work' }],
  ]);
});

it('clears the previous tree when reconnecting without a directory', () => {
  actor.send({ type: 'explorer.FILES_LISTED', data: { path: '/work', files: [{ name: 'file', path: '/work/file', type: 'file' }] } });
  expect(actor.getSnapshot().context.rootFiles).toHaveLength(1);
  sendToSystem.mockReset(); updateParentState.mockReset();
  actor.send({ type: 'CODE_STARTED', data: { baseDirectory: null } });
  expect(actor.getSnapshot().context.rootFiles).toEqual([]);
  expect(updateParentState).toHaveBeenCalledWith(actor, { baseDirectory: null });
  expect(sendToSystem).not.toHaveBeenCalled();
});

it('still sends an explicit directory selection to the backend', () => {
  actor.send({ type: 'explorer.SET_BASE_DIRECTORY', path: '/selected' });
  expect(sendToSystem).toHaveBeenCalledWith('code', { type: 'SET_BASE_DIRECTORY', path: '/selected' });
});
