import { afterEach, beforeEach, expect, it } from 'vitest';
import { explorerState } from '#features/code/fe/features/explorer/state.ts';
import { startMachine } from '../../_support/asks.ts';

const EXPLORER_REPORTS = [
  'EXPLORER_LOADING',
  'EXPLORER_LISTED',
  'EXPLORER_FILE_READ',
  'EXPLORER_FILE_SAVED',
  'EXPLORER_FILE_DELETED',
  'EXPLORER_FILE_RENAMED',
  'EXPLORER_ERROR',
  'EXPLORER_BASE_DIRECTORY_SET',
  'EXPLORER_QUICK_OPEN_RESULTS',
  'EXPLORER_QUICK_OPEN_ERROR',
] as const;

const startExplorer = () => startMachine(explorerState, { reports: EXPLORER_REPORTS });
let h: ReturnType<typeof startExplorer>;

beforeEach(() => {
  h = startExplorer();
});
afterEach(() => h.stop());

/** What the explorer asked the code system, in order */
const asked = () => h.made.map(({ event }) => event);

it('reads the connected directory without turning restoration into a settings change', () => {
  h.send({ type: 'CODE_STARTED', data: { baseDirectory: '/work' } });
  expect(h.read().data.baseDirectory).toBe('/work');
  expect(asked()).toEqual([{ type: 'explorer.LIST_FILES', path: '/work' }]);
  h.send({ type: 'CODE_STARTED', data: { baseDirectory: '/work' } });
  expect(asked()).toEqual([
    { type: 'explorer.LIST_FILES', path: '/work' },
    { type: 'explorer.LIST_FILES', path: '/work' },
  ]);
  expect(h.tells, 'and nothing is sent that would change a setting').toEqual([]);
});

it('clears the previous tree when reconnecting without a directory', async () => {
  h.send({ type: 'CODE_STARTED', data: { baseDirectory: '/work' } });
  await h.latestAsk('explorer.LIST_FILES').answer({ path: '/work', files: [{ name: 'file', path: '/work/file', type: 'file' }] });
  expect(h.read().data.rootFiles).toHaveLength(1);
  h.reset();
  h.send({ type: 'CODE_STARTED', data: { baseDirectory: null } });
  expect(h.read().data.rootFiles).toEqual([]);
  expect(h.read().data.baseDirectory).toBe('');
  expect(h.made).toEqual([]);
});

it('still sends an explicit directory selection to the backend', () => {
  h.send({ type: 'explorer.SET_BASE_DIRECTORY', path: '/selected' });
  expect(h.tells).toEqual([{ to: 'default-setup/code', event: { type: 'SET_BASE_DIRECTORY', path: '/selected' } }]);
});

it('takes each listing asked for at once into its own folder, and holds none of the asks once they end', async () => {
  h.send({ type: 'explorer.EXPAND_DIRECTORY', path: '/work/a' });
  h.send({ type: 'explorer.EXPAND_DIRECTORY', path: '/work/b' });
  expect([...h.read().data.loadingDirs]).toEqual(['/work/a', '/work/b']);

  // Answered in the other order than asked
  await h.asksOf('explorer.LIST_FILES')[1]!.answer({ path: '/work/b', files: [{ name: 'b', path: '/work/b/b', type: 'file' }] });
  await h.asksOf('explorer.LIST_FILES')[0]!.answer({ path: '/work/a', files: [] });

  const { dirContents, loadingDirs } = h.read().data;
  expect(dirContents).toEqual({ '/work/a': [], '/work/b': [{ name: 'b', path: '/work/b/b', type: 'file' }] });
  expect([...loadingDirs]).toEqual([]);
  expect(h.read().pending.list, 'an ask that ended is no longer pending').toEqual({});
});

it('stops showing a folder as loading when its listing is refused, whether or not the refusal names it', async () => {
  h.send({ type: 'explorer.EXPAND_DIRECTORY', path: '/work/a' });
  h.send({ type: 'explorer.EXPAND_DIRECTORY', path: '/work/b' });
  await h.asksOf('explorer.LIST_FILES')[0]!.refuse('Permission denied', { kind: 'file', code: 'PERMISSION_DENIED', path: '/work/a' });
  expect([...h.read().data.loadingDirs]).toEqual(['/work/b']);
  await h.asksOf('explorer.LIST_FILES')[1]!.refuse('The code system is not running', { kind: 'unavailable' });
  expect([...h.read().data.loadingDirs]).toEqual([]);
});

it('shows why a file ask was not done, and drops the tab of a file that has gone', async () => {
  h.send({ type: 'explorer.OPEN_FILE', path: '/work/locked' });
  await h.latestAsk('explorer.READ_FILE').refuse('Permission denied', { kind: 'file', code: 'PERMISSION_DENIED', path: '/work/locked' });
  expect(h.reportsOf('EXPLORER_ERROR').at(-1)).toEqual({ type: 'EXPLORER_ERROR', message: 'Permission denied' });

  h.send({ type: 'explorer.OPEN_FILE', path: '/work/gone' });
  await h.asksOf('explorer.READ_FILE')[1]!.refuse('No such file', { kind: 'file', code: 'NOT_FOUND', path: '/work/gone' });
  expect(h.reportsOf('EXPLORER_ERROR').at(-1)).toEqual({ type: 'EXPLORER_ERROR', message: 'No such file', notFoundPath: '/work/gone' });
});

it('lists every file for quick open in a state of its own, where a newer listing replaces the one under way', async () => {
  h.send({ type: 'explorer.QUICK_OPEN_SEARCH', baseDirectory: '/work' });
  expect(h.read().at).toBe('findingFiles');
  h.send({ type: 'explorer.QUICK_OPEN_SEARCH', baseDirectory: '/other' });
  expect(h.asksOf('explorer.QUICK_OPEN_SEARCH')[0]!.stopped, 'the first is no longer waited for').toBe(true);

  await h.asksOf('explorer.QUICK_OPEN_SEARCH')[1]!.answer([{ path: '/other/x', relativePath: 'x', name: 'x', type: 'file' }]);
  expect(h.asksOf('explorer.QUICK_OPEN_SEARCH')[1]!.event).toEqual({ type: 'explorer.QUICK_OPEN_SEARCH', baseDirectory: '/other' });
  expect(h.reportsOf('EXPLORER_QUICK_OPEN_RESULTS').at(-1)).toEqual({
    type: 'EXPLORER_QUICK_OPEN_RESULTS',
    results: [{ path: '/other/x', relativePath: 'x', name: 'x', type: 'file' }],
  });
  expect(h.read().at).toBe('idle');
});
