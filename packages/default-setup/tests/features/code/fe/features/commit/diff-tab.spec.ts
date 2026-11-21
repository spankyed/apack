// Which file's diff opens in which tab.
//
// The answer to `commit.GET_GIT_DIFF` carries the diff's own `path` and `staged` (`GitDiff`, `code/be/types.ts`), so
// the answer says which file it is about. The handler built the tab from `context.selectedGitFile`
// instead — the file selected *now* — so selecting another file while a diff was in flight opened the
// first file's content in a tab labelled the second.
//
// This is the keyed-slot rule at its cheapest: the tab id is the key, the payload already carries it,
// and reading it is the whole fix. Nothing needs a pending field.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { latestAsk, resetAsks } from '../../_support/asks.ts';

const addTabToParent = vi.hoisted(() => vi.fn());
const updateParentState = vi.hoisted(() => vi.fn());
const sendEventToParent = vi.hoisted(() => vi.fn());
const getParentContext = vi.hoisted(() => vi.fn((): { openFiles?: unknown[] } => ({})));
vi.mock('#generated/events.ts', async () => ({ tell: vi.fn(), fromAsk: (await import('../../_support/asks.ts')).fromAsk }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({ addTabToParent, updateParentState, sendEventToParent, getParentContext }));

const { commitState } = await import('#features/code/fe/features/commit/state.ts');

const aFile = (path: string, staged = false) => ({ path, staged, status: 'M' }) as never;
const aDiff = (path: string, staged = false) => ({
  path, staged, modifiedContent: `content of ${path}`,
});

/** The tab ids the view was asked to open, in order */
const openedTabs = () => addTabToParent.mock.calls.map(([, tab]) => (tab as { path: string }).path);
const lastTab = () => addTabToParent.mock.calls.at(-1)?.[1] as { path: string; gitDiff: { path: string } };

beforeEach(() => {
  resetAsks();
  for (const mock of [addTabToParent, updateParentState, sendEventToParent]) mock.mockReset();
  getParentContext.mockReturnValue({});
});

it('opens a diff in the tab for the file the diff is about', async () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.SHOWN' });

  actor.send({ type: 'commit.SELECT_FILE', file: aFile('a.ts') });
  actor.send({ type: 'commit.VIEW_DIFF', path: 'a.ts', staged: false });
  await latestAsk('commit.GET_GIT_DIFF').answer(aDiff('a.ts'));

  expect(openedTabs()).toEqual(['diff:a.ts:unstaged']);
  expect(lastTab().gitDiff.path, 'and the content is that file\'s').toBe('a.ts');
});

/**
 * The race, which is one click ahead of the network.
 *
 * `commit.VIEW_DIFF` for a.ts is still in flight when b.ts is selected; a.ts's diff then arrives.
 */
it('does not open one file\'s diff in another file\'s tab', async () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.SHOWN' });

  actor.send({ type: 'commit.SELECT_FILE', file: aFile('a.ts') });
  actor.send({ type: 'commit.VIEW_DIFF', path: 'a.ts', staged: false });
  // the user clicks b.ts before a.ts's diff comes back
  actor.send({ type: 'commit.SELECT_FILE', file: aFile('b.ts') });

  await latestAsk('commit.GET_GIT_DIFF').answer(aDiff('a.ts'));

  expect(openedTabs(), 'a.ts\'s diff belongs in a.ts\'s tab').toEqual(['diff:a.ts:unstaged']);
  expect(lastTab().gitDiff.path).toBe('a.ts');
});

it('keeps the staged and unstaged diffs of one file apart', async () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.SHOWN' });

  actor.send({ type: 'commit.SELECT_FILE', file: aFile('a.ts', true) });
  actor.send({ type: 'commit.VIEW_DIFF', path: 'a.ts', staged: true });
  await latestAsk('commit.GET_GIT_DIFF').answer(aDiff('a.ts', true));
  actor.send({ type: 'commit.VIEW_DIFF', path: 'a.ts', staged: false });
  await latestAsk('commit.GET_GIT_DIFF').answer(aDiff('a.ts', false));

  expect(openedTabs()).toEqual(['diff:a.ts:staged', 'diff:a.ts:unstaged']);
});

/** A diff arriving with nothing selected is still a diff for a known file */
it('opens a diff even when no file is selected', async () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.SHOWN' });

  actor.send({ type: 'commit.VIEW_DIFF', path: 'a.ts', staged: false });
  await latestAsk('commit.GET_GIT_DIFF').answer(aDiff('a.ts'));

  expect(openedTabs()).toEqual(['diff:a.ts:unstaged']);
});

/**
 * A diff that is already open is shown as it stands, with whatever was typed into it, and read again behind
 * that. The answer to that ask changes the tab where it is: opening it again would replace what was typed.
 */
it('shows a diff that is already open at once, and brings it up to date without opening it again', async () => {
  getParentContext.mockReturnValue({ openFiles: [{ path: 'diff:a.ts:unstaged', isDiff: true, gitFile: { path: 'a.ts', staged: false } }] });
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.SHOWN' });

  actor.send({ type: 'commit.VIEW_DIFF', path: 'a.ts', staged: false });

  expect(updateParentState).toHaveBeenCalledWith(expect.anything(), { activeFilePath: 'diff:a.ts:unstaged' });
  expect(latestAsk('commit.GET_GIT_DIFF').event).toEqual({ type: 'commit.GET_GIT_DIFF', path: 'a.ts', staged: false });

  await latestAsk('commit.GET_GIT_DIFF').answer(aDiff('a.ts'));

  expect(openedTabs(), 'no tab is opened for it').toEqual([]);
  expect(sendEventToParent).toHaveBeenCalledWith(expect.anything(), { type: 'REFRESH_DIFF_TAB', diff: aDiff('a.ts') });
});

// The user asked for nothing when an open diff is read again, so there is nothing to tell them when that fails:
// the tab shows what it showed, and the next change to the file reads it again
it('says nothing when reading an open diff again fails, and still says when a diff that was asked for does', async () => {
  getParentContext.mockReturnValue({ openFiles: [{ path: 'diff:a.ts:unstaged', isDiff: true, gitFile: { path: 'a.ts', staged: false } }] });
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.SHOWN' });
  const NOTHING = { status: false, diffs: false, history: false, stashes: false, worktrees: false, refs: false };

  actor.send({ type: 'commit.REPOSITORY_CHANGED', changed: { ...NOTHING, diffs: true, files: ['a.ts'] } });
  await latestAsk('commit.GET_GIT_DIFF').refuse('the file went away', { kind: 'git' });
  expect(actor.getSnapshot().context.gitError).toBeNull();

  actor.send({ type: 'commit.VIEW_DIFF', path: 'b.ts', staged: false });
  await latestAsk('commit.GET_GIT_DIFF').refuse('not a diff anyone can read', { kind: 'git' });
  expect(actor.getSnapshot().context.gitError).toBe('not a diff anyone can read');
});
