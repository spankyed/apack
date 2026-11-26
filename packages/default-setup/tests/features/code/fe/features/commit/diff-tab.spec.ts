// Which file's diff opens in which tab.
import { afterEach, expect, it } from 'vitest';
import { diffTabPath } from '#features/code/fe/utils/diff-tabs.ts';
import { startCommit, type CommitHarness } from './_support.ts';

const running: CommitHarness[] = [];
const open = (opts?: Parameters<typeof startCommit>[0]) => {
  const h = startCommit(opts);
  running.push(h);
  return h;
};
afterEach(() => {
  for (const h of running.splice(0)) h.stop();
});

const aFile = (path: string, staged = false) => ({ path, staged, status: 'modified' as const });
const aDiff = (path: string, staged = false) => ({
  path, staged, modifiedContent: `content of ${path}`,
});

const openedTabs = (h: CommitHarness) =>
  h.reportsOf('OPEN_DIFF_TAB').map((r) => diffTabPath((r as unknown as { diff: { path: string; staged: boolean } }).diff));
const lastDiff = (h: CommitHarness) =>
  (h.reportsOf('OPEN_DIFF_TAB').at(-1) as unknown as { diff: { path: string; staged: boolean } }).diff;

it('opens a diff in the tab for the file the diff is about', async () => {
  const h = open();
  h.send({ type: 'commit.SHOWN' });

  h.send({ type: 'commit.SELECT_FILE', file: aFile('a.ts') });
  h.send({ type: 'commit.VIEW_DIFF', path: 'a.ts', staged: false });
  await h.latestAsk('commit.GET_GIT_DIFF').answer(aDiff('a.ts'));

  expect(openedTabs(h)).toEqual(['diff:a.ts:unstaged']);
  expect(lastDiff(h).path, "and the content is that file's").toBe('a.ts');
});

it("does not open one file's diff in another file's tab", async () => {
  const h = open();
  h.send({ type: 'commit.SHOWN' });

  h.send({ type: 'commit.SELECT_FILE', file: aFile('a.ts') });
  h.send({ type: 'commit.VIEW_DIFF', path: 'a.ts', staged: false });
  // the user clicks b.ts before a.ts's diff comes back
  h.send({ type: 'commit.SELECT_FILE', file: aFile('b.ts') });

  await h.latestAsk('commit.GET_GIT_DIFF').answer(aDiff('a.ts'));

  expect(openedTabs(h), "a.ts's diff belongs in a.ts's tab").toEqual(['diff:a.ts:unstaged']);
  expect(lastDiff(h).path).toBe('a.ts');
});

it('keeps the staged and unstaged diffs of one file apart', async () => {
  const h = open();
  h.send({ type: 'commit.SHOWN' });

  h.send({ type: 'commit.SELECT_FILE', file: aFile('a.ts', true) });
  h.send({ type: 'commit.VIEW_DIFF', path: 'a.ts', staged: true });
  await h.latestAsk('commit.GET_GIT_DIFF').answer(aDiff('a.ts', true));
  h.send({ type: 'commit.VIEW_DIFF', path: 'a.ts', staged: false });
  await h.latestAsk('commit.GET_GIT_DIFF').answer(aDiff('a.ts', false));

  expect(openedTabs(h)).toEqual(['diff:a.ts:staged', 'diff:a.ts:unstaged']);
});

it('opens a diff even when no file is selected', async () => {
  const h = open();
  h.send({ type: 'commit.SHOWN' });

  h.send({ type: 'commit.VIEW_DIFF', path: 'a.ts', staged: false });
  await h.latestAsk('commit.GET_GIT_DIFF').answer(aDiff('a.ts'));

  expect(openedTabs(h)).toEqual(['diff:a.ts:unstaged']);
});

it('shows a diff that is already open at once, and brings it up to date without opening it again', async () => {
  const h = open({ openDiffs: [{ tab: 'diff:a.ts:unstaged', path: 'a.ts', staged: false }] });
  h.send({ type: 'commit.SHOWN' });

  h.send({ type: 'commit.VIEW_DIFF', path: 'a.ts', staged: false });

  expect(h.reportsOf('ACTIVATE_DIFF_TAB')).toEqual([{ type: 'ACTIVATE_DIFF_TAB', tab: 'diff:a.ts:unstaged' }]);
  expect(h.latestAsk('commit.GET_GIT_DIFF').event).toEqual({ type: 'commit.GET_GIT_DIFF', path: 'a.ts', staged: false });

  await h.latestAsk('commit.GET_GIT_DIFF').answer(aDiff('a.ts'));

  expect(openedTabs(h), 'no tab is opened for it').toEqual([]);
  expect(h.reportsOf('REFRESH_DIFF_TAB')).toEqual([{ type: 'REFRESH_DIFF_TAB', diff: aDiff('a.ts') }]);
});

it('says nothing when reading an open diff again fails, and still says when a diff that was asked for does', async () => {
  const h = open({ openDiffs: [{ tab: 'diff:a.ts:unstaged', path: 'a.ts', staged: false }] });
  h.send({ type: 'commit.SHOWN' });
  const NOTHING = { status: false, diffs: false, history: false, stashes: false, worktrees: false, refs: false };

  h.send({ type: 'commit.REPOSITORY_CHANGED', changed: { ...NOTHING, diffs: true, files: ['a.ts'] } });
  await h.latestAsk('commit.GET_GIT_DIFF').refuse('the file went away', { kind: 'git' });
  expect(h.open().data.gitError).toBeNull();

  h.send({ type: 'commit.VIEW_DIFF', path: 'b.ts', staged: false });
  await h.latestAsk('commit.GET_GIT_DIFF').refuse('not a diff anyone can read', { kind: 'git' });
  expect(h.open().data.gitError).toBe('not a diff anyone can read');
});
