// An untracked folder is one row of the panel. Opened, it lists the files in it, and the list is kept current:
// with the status that follows a change, and when the folder itself is said to have changed.
import { afterEach, expect, it } from 'vitest';
import { startCommit, type CommitHarness } from './_support.ts';

const running: CommitHarness[] = [];
afterEach(() => {
  for (const h of running.splice(0)) h.stop();
});

const folder = (path: string) => ({ path, status: 'untracked' as const, staged: false, isDirectory: true });
const sent = (h: CommitHarness) => h.made.map((ask) => ask.event as { type: string; path?: string });
const listings = (h: CommitHarness) => sent(h).filter((event) => event.type === 'commit.LIST_UNTRACKED').map((event) => event.path);

async function tellStatus(h: CommitHarness, files: ReturnType<typeof folder>[]) {
  h.send({ type: 'commit.REFRESH_STATUS' });
  await h.latestAsk('commit.GET_GIT_STATUS').answer({ files, truncated: false, branch: 'main', hasUpstream: false, commitsAhead: 0, commitsBehind: 0, watching: true });
}

async function panelShowing(files: ReturnType<typeof folder>[]) {
  const h = startCommit();
  running.push(h);
  h.send({ type: 'commit.SHOWN' });
  await tellStatus(h, files);
  h.reset();
  return h;
}

const listed = (h: CommitHarness, path: string, files: string[], truncated = false) =>
  h.latestAsk('commit.LIST_UNTRACKED').answer({ path, files, truncated });
const NOTHING = { status: false, diffs: false, history: false, stashes: false, worktrees: false, refs: false };

it("opens a folder's row by asking what is in it, lists that, and closes it again", async () => {
  const h = await panelShowing([folder('third-party/')]);

  h.send({ type: 'commit.TOGGLE_FOLDER', path: 'third-party/' });
  expect(listings(h)).toEqual(['third-party/']);
  await listed(h, 'third-party/', ['third-party/a.js', 'third-party/lib/b.js'], true);
  expect(h.open().data.openFolders).toEqual({ 'third-party/': { files: ['third-party/a.js', 'third-party/lib/b.js'], truncated: true } });

  h.send({ type: 'commit.TOGGLE_FOLDER', path: 'third-party/' });
  expect(h.open().data.openFolders).toEqual({});
});

it('drops a listing that arrives for a folder closed since it was asked for', async () => {
  const h = await panelShowing([folder('third-party/')]);
  h.send({ type: 'commit.TOGGLE_FOLDER', path: 'third-party/' });
  h.send({ type: 'commit.TOGGLE_FOLDER', path: 'third-party/' });

  await listed(h, 'third-party/', ['third-party/a.js']);

  expect(h.open().data.openFolders).toEqual({});
});

it('closes a folder whose row is gone from the status, and lists again the ones still there', async () => {
  const h = await panelShowing([folder('third-party/'), folder('scratch/')]);
  h.send({ type: 'commit.TOGGLE_FOLDER', path: 'third-party/' });
  h.send({ type: 'commit.TOGGLE_FOLDER', path: 'scratch/' });
  await listed(h, 'third-party/', ['third-party/a.js']);
  h.reset();

  await tellStatus(h, [folder('third-party/')]);

  expect(Object.keys(h.open().data.openFolders)).toEqual(['third-party/']);
  expect(listings(h)).toEqual(['third-party/']);
});

it('lists an open folder again when told it changed, and not when told of another file', async () => {
  const h = await panelShowing([folder('third-party/')]);
  h.send({ type: 'commit.TOGGLE_FOLDER', path: 'third-party/' });
  h.reset();

  h.send({ type: 'commit.REPOSITORY_CHANGED', changed: { ...NOTHING, diffs: true, files: ['src/a.ts'] } });
  expect(listings(h)).toEqual([]);

  h.send({ type: 'commit.REPOSITORY_CHANGED', changed: { ...NOTHING, diffs: true, files: ['third-party/'] } });
  expect(listings(h)).toEqual(['third-party/']);
});
