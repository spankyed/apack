import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createActor, type ActorRefFrom } from 'xstate';

const { sendToSystem, updateParentState, parent } = vi.hoisted(() => ({
  sendToSystem: vi.fn(), updateParentState: vi.fn(), parent: { baseDirectory: '/work' as string | null },
}));
vi.mock('#generated/events.ts', () => ({ sendToSystem }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  updateParentState, getParentContext: () => parent, addTabToParent: vi.fn(),
}));
const { explorerState } = await import('#features/code/fe/features/explorer/state.ts');
let actor: ActorRefFrom<typeof explorerState>;
beforeEach(() => {
  sendToSystem.mockReset(); updateParentState.mockReset(); parent.baseDirectory = '/work';
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


it('opens an external file without revealing unrelated directories or changing tree selection', () => {
  actor.send({ type: 'explorer.REVEAL_IN_TREE', path: '/work/current.txt' });
  const previous = actor.getSnapshot().context;
  sendToSystem.mockReset();
  actor.send({ type: 'explorer.OPEN_FILE', path: '/workspace/session/tool-results/mcp-resource-image.png' });
  actor.send({ type: 'explorer.REVEAL_IN_TREE', path: '/workspace/session/tool-results/mcp-resource-image.png' });
  expect(sendToSystem.mock.calls).toEqual([
    ['code', { type: 'explorer.READ_FILE', path: '/workspace/session/tool-results/mcp-resource-image.png' }],
  ]);
  expect(actor.getSnapshot().context.expandedDirs).toEqual(previous.expandedDirs);
  expect(actor.getSnapshot().context.loadingDirs).toEqual(previous.loadingDirs);
  expect(actor.getSnapshot().context.selectedPaths).toEqual(['/work/current.txt']);
  expect(actor.getSnapshot().context.revealPath).toBe('/work/current.txt');
});

it('reveals only the workspace ancestors for an internal file', () => {
  actor.send({ type: 'explorer.REVEAL_IN_TREE', path: '/work/src/nested/file.ts' });
  expect(sendToSystem.mock.calls).toEqual([
    ['code', { type: 'explorer.LIST_FILES', path: '/work/src/nested' }],
    ['code', { type: 'explorer.LIST_FILES', path: '/work/src' }],
    ['code', { type: 'explorer.LIST_FILES', path: '/work' }],
  ]);
  expect(actor.getSnapshot().context.selectedPaths).toEqual(['/work/src/nested/file.ts']);
});


it.each(['/work/', '/'])('reveals files under a normalized workspace root %s', (root) => {
  parent.baseDirectory = root;
  actor.send({ type: 'explorer.REVEAL_IN_TREE', path: '/work/file.ts' });
  expect(actor.getSnapshot().context.revealPath).toBe('/work/file.ts');
  expect(sendToSystem).toHaveBeenCalledWith('code', { type: 'explorer.LIST_FILES', path: root === '/' ? '/' : '/work' });
});

it('does not reveal a file when no workspace is selected and preserves real read errors', () => {
  parent.baseDirectory = null;
  actor.send({ type: 'explorer.REVEAL_IN_TREE', path: '/outside/missing.png' });
  expect(sendToSystem).not.toHaveBeenCalled();
  actor.send({ type: 'explorer.OPEN_FILE', path: '/outside/missing.png' });
  actor.send({ type: 'explorer.ERROR', message: 'File not found' });
  expect(sendToSystem).toHaveBeenCalledWith('code', { type: 'explorer.READ_FILE', path: '/outside/missing.png' });
  expect(updateParentState).toHaveBeenCalledWith(actor, { error: 'File not found', isLoading: false });
});
