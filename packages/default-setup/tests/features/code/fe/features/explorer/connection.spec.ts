import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createActor, type ActorRefFrom } from 'xstate';
import { asksOf, latestAsk, made, resetAsks } from '../../_support/asks.ts';

const { tell, updateParentState } = vi.hoisted(() => ({ tell: vi.fn(), updateParentState: vi.fn() }));
vi.mock('#generated/events.ts', async () => ({ tell, fromAsk: (await import('../../_support/asks.ts')).fromAsk }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  updateParentState, getParentContext: () => ({ baseDirectory: '/work', openFiles: [{ path: '/work/gone' }], activeFilePath: '/work/gone' }), addTabToParent: vi.fn(),
}));
const { explorerState } = await import('#features/code/fe/features/explorer/state.ts');
let actor: ActorRefFrom<typeof explorerState>;
beforeEach(() => {
  tell.mockReset(); updateParentState.mockReset(); resetAsks();
  actor = createActor(explorerState).start();
});
afterEach(() => actor.stop());

/** What the explorer asked the code system, in order */
const asked = () => made.map(({ event }) => event);

it('reads the connected directory without turning restoration into a settings change', () => {
  actor.send({ type: 'CODE_STARTED', data: { baseDirectory: '/work' } });
  expect(updateParentState).toHaveBeenCalledWith(actor, { baseDirectory: '/work' });
  expect(asked()).toEqual([{ type: 'explorer.LIST_FILES', path: '/work' }]);
  actor.send({ type: 'CODE_STARTED', data: { baseDirectory: '/work' } });
  expect(asked()).toEqual([
    { type: 'explorer.LIST_FILES', path: '/work' },
    { type: 'explorer.LIST_FILES', path: '/work' },
  ]);
  expect(tell, 'and nothing is sent that would change a setting').not.toHaveBeenCalled();
});

it('clears the previous tree when reconnecting without a directory', async () => {
  actor.send({ type: 'explorer.LIST_FILES', path: '/work' });
  await latestAsk('explorer.LIST_FILES').answer({ path: '/work', files: [{ name: 'file', path: '/work/file', type: 'file' }] });
  expect(actor.getSnapshot().context.rootFiles).toHaveLength(1);
  resetAsks(); updateParentState.mockReset();
  actor.send({ type: 'CODE_STARTED', data: { baseDirectory: null } });
  expect(actor.getSnapshot().context.rootFiles).toEqual([]);
  expect(updateParentState).toHaveBeenCalledWith(actor, { baseDirectory: null });
  expect(made).toEqual([]);
});

it('still sends an explicit directory selection to the backend', () => {
  actor.send({ type: 'explorer.SET_BASE_DIRECTORY', path: '/selected' });
  expect(tell).toHaveBeenCalledWith('code', { type: 'SET_BASE_DIRECTORY', path: '/selected' });
});

it('takes each listing asked for at once into its own folder, and holds none of the asks once they end', async () => {
  actor.send({ type: 'explorer.EXPAND_DIRECTORY', path: '/work/a' });
  actor.send({ type: 'explorer.EXPAND_DIRECTORY', path: '/work/b' });
  expect([...actor.getSnapshot().context.loadingDirs]).toEqual(['/work/a', '/work/b']);

  // Answered in the other order than asked
  await asksOf('explorer.LIST_FILES')[1]!.answer({ path: '/work/b', files: [{ name: 'b', path: '/work/b/b', type: 'file' }] });
  await asksOf('explorer.LIST_FILES')[0]!.answer({ path: '/work/a', files: [] });

  const { dirContents, loadingDirs } = actor.getSnapshot().context;
  expect(dirContents).toEqual({ '/work/a': [], '/work/b': [{ name: 'b', path: '/work/b/b', type: 'file' }] });
  expect([...loadingDirs]).toEqual([]);
  expect(Object.keys(actor.getSnapshot().children), 'an ask that ended is no longer a child').toEqual([]);
});

it('stops showing a folder as loading when its listing is refused, whether or not the refusal names it', async () => {
  actor.send({ type: 'explorer.EXPAND_DIRECTORY', path: '/work/a' });
  actor.send({ type: 'explorer.EXPAND_DIRECTORY', path: '/work/b' });
  await asksOf('explorer.LIST_FILES')[0]!.refuse('Permission denied', { kind: 'file', code: 'PERMISSION_DENIED', path: '/work/a' });
  expect([...actor.getSnapshot().context.loadingDirs]).toEqual(['/work/b']);
  await asksOf('explorer.LIST_FILES')[1]!.refuse('The code system is not running', { kind: 'unavailable' });
  expect([...actor.getSnapshot().context.loadingDirs]).toEqual([]);
});

it('shows why a file ask was not done, and drops the tab of a file that has gone', async () => {
  actor.send({ type: 'explorer.OPEN_FILE', path: '/work/locked' });
  await latestAsk('explorer.READ_FILE').refuse('Permission denied', { kind: 'file', code: 'PERMISSION_DENIED', path: '/work/locked' });
  expect(updateParentState).toHaveBeenLastCalledWith(actor, { error: 'Permission denied', isLoading: false });

  actor.send({ type: 'explorer.OPEN_FILE', path: '/work/gone' });
  await asksOf('explorer.READ_FILE')[1]!.refuse('No such file', { kind: 'file', code: 'NOT_FOUND', path: '/work/gone' });
  expect(updateParentState).toHaveBeenLastCalledWith(actor, expect.objectContaining({ openFiles: [], error: null, isLoading: false }));
});

it('lists every file for quick open in a state of its own, where a newer listing replaces the one under way', async () => {
  actor.send({ type: 'explorer.QUICK_OPEN_SEARCH', baseDirectory: '/work' });
  expect(actor.getSnapshot().matches('findingFiles')).toBe(true);
  actor.send({ type: 'explorer.QUICK_OPEN_SEARCH', baseDirectory: '/other' });
  expect(asksOf('explorer.QUICK_OPEN_SEARCH')[0]!.stopped, 'the first is no longer waited for').toBe(true);

  await asksOf('explorer.QUICK_OPEN_SEARCH')[1]!.answer([{ path: '/other/x', relativePath: 'x', name: 'x', type: 'file' }]);
  expect(asksOf('explorer.QUICK_OPEN_SEARCH')[1]!.event).toEqual({ type: 'explorer.QUICK_OPEN_SEARCH', baseDirectory: '/other' });
  expect(updateParentState).toHaveBeenLastCalledWith(actor, { quickOpenResults: [{ path: '/other/x', relativePath: 'x', name: 'x', type: 'file' }], quickOpenLoading: false });
  expect(actor.getSnapshot().matches('idle')).toBe(true);
});
