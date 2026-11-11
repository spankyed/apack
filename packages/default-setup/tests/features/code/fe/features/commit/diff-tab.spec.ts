// Which file's diff opens in which tab.
//
// `commit.DIFF_RECEIVED` carries the diff's own `path` and `staged` (`GitDiff`, `code/be/types.ts`), so
// the answer says which file it is about. The handler built the tab from `context.selectedGitFile`
// instead — the file selected *now* — so selecting another file while a diff was in flight opened the
// first file's content in a tab labelled the second.
//
// This is the keyed-slot rule at its cheapest: the tab id is the key, the payload already carries it,
// and reading it is the whole fix. Nothing needs a pending field.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';

const sendToSystem = vi.hoisted(() => vi.fn());
const addTabToParent = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', () => ({ sendToSystem }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent,
  updateParentState: vi.fn(),
  sendEventToParent: vi.fn(),
  getParentContext: vi.fn(() => ({})),
}));

const { commitState } = await import('#features/code/fe/features/commit/state.ts');

const aFile = (path: string, staged = false) => ({ path, staged, status: 'M' }) as never;
const aDiff = (path: string, staged = false) => ({
  path, staged, modifiedContent: `content of ${path}`,
});

/** The tab ids the view was asked to open, in order */
const openedTabs = () => addTabToParent.mock.calls.map(([, tab]) => (tab as { path: string }).path);
const lastTab = () => addTabToParent.mock.calls.at(-1)?.[1] as { path: string; gitDiff: { path: string } };

beforeEach(() => {
  sendToSystem.mockReset();
  addTabToParent.mockReset();
});

it('opens a diff in the tab for the file the diff is about', () => {
  const actor = createActor(commitState).start();

  actor.send({ type: 'commit.SELECT_FILE', file: aFile('a.ts') });
  actor.send({ type: 'commit.VIEW_DIFF', path: 'a.ts', staged: false });
  actor.send({ type: 'commit.DIFF_RECEIVED', data: aDiff('a.ts') });

  expect(openedTabs()).toEqual(['diff:a.ts:unstaged']);
  expect(lastTab().gitDiff.path, 'and the content is that file\'s').toBe('a.ts');
});

/**
 * The race, which is one click ahead of the network.
 *
 * `commit.VIEW_DIFF` for a.ts is still in flight when b.ts is selected; a.ts's diff then arrives.
 */
it('does not open one file\'s diff in another file\'s tab', () => {
  const actor = createActor(commitState).start();

  actor.send({ type: 'commit.SELECT_FILE', file: aFile('a.ts') });
  actor.send({ type: 'commit.VIEW_DIFF', path: 'a.ts', staged: false });
  // the user clicks b.ts before a.ts's diff comes back
  actor.send({ type: 'commit.SELECT_FILE', file: aFile('b.ts') });

  actor.send({ type: 'commit.DIFF_RECEIVED', data: aDiff('a.ts') });

  expect(openedTabs(), 'a.ts\'s diff belongs in a.ts\'s tab').toEqual(['diff:a.ts:unstaged']);
  expect(lastTab().gitDiff.path).toBe('a.ts');
});

it('keeps the staged and unstaged diffs of one file apart', () => {
  const actor = createActor(commitState).start();

  actor.send({ type: 'commit.SELECT_FILE', file: aFile('a.ts', true) });
  actor.send({ type: 'commit.DIFF_RECEIVED', data: aDiff('a.ts', true) });
  actor.send({ type: 'commit.DIFF_RECEIVED', data: aDiff('a.ts', false) });

  expect(openedTabs()).toEqual(['diff:a.ts:staged', 'diff:a.ts:unstaged']);
});

/** A diff arriving with nothing selected is still a diff for a known file */
it('opens a diff even when no file is selected', () => {
  const actor = createActor(commitState).start();

  actor.send({ type: 'commit.DIFF_RECEIVED', data: aDiff('a.ts') });

  expect(openedTabs()).toEqual(['diff:a.ts:unstaged']);
});
