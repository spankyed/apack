// An untracked folder is one row of the panel. Opened, it lists the files in it, and the list is kept current:
// with the status that follows a change, and when the folder itself is said to have changed.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { latestAsk, made, resetAsks } from '../../_support/asks.ts';

vi.mock('#generated/events.ts', async () => ({ tell: vi.fn(), fromAsk: (await import('../../_support/asks.ts')).fromAsk }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent: vi.fn(),
  updateParentState: vi.fn(),
  sendEventToParent: vi.fn(),
  getParentContext: vi.fn(() => ({})),
}));

const { commitState } = await import('#features/code/fe/features/commit/state.ts');

beforeEach(resetAsks);

const folder = (path: string) => ({ path, status: 'untracked' as const, staged: false, isDirectory: true });
const sent = () => made.map(ask => ask.event as { type: string; path?: string });
const listings = () => sent().filter(event => event.type === 'commit.LIST_UNTRACKED').map(event => event.path);

/** A panel showing these rows, as the status it asked for said */
async function panelShowing(files: ReturnType<typeof folder>[]) {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.SHOWN' });
  await tellStatus(actor, files);
  resetAsks();
  return actor;
}
async function tellStatus(actor: ReturnType<typeof createActor<typeof commitState>>, files: ReturnType<typeof folder>[]) {
  actor.send({ type: 'commit.REFRESH_STATUS' });
  await latestAsk('commit.GET_GIT_STATUS').answer({ files, truncated: false, branch: 'main', hasUpstream: false, commitsAhead: 0, commitsBehind: 0, watching: true });
}
/** Answers the latest listing asked for with what the folder holds */
const listed = (path: string, files: string[], truncated = false) => latestAsk('commit.LIST_UNTRACKED').answer({ path, files, truncated });
const NOTHING = { status: false, diffs: false, history: false, stashes: false, worktrees: false, refs: false };

it('opens a folder\'s row by asking what is in it, lists that, and closes it again', async () => {
  const actor = await panelShowing([folder('third-party/')]);

  actor.send({ type: 'commit.TOGGLE_FOLDER', path: 'third-party/' });
  expect(listings()).toEqual(['third-party/']);
  await listed('third-party/', ['third-party/a.js', 'third-party/lib/b.js'], true);
  expect(actor.getSnapshot().context.openFolders).toEqual({ 'third-party/': { files: ['third-party/a.js', 'third-party/lib/b.js'], truncated: true } });

  actor.send({ type: 'commit.TOGGLE_FOLDER', path: 'third-party/' });
  expect(actor.getSnapshot().context.openFolders).toEqual({});
});

it('drops a listing that arrives for a folder closed since it was asked for', async () => {
  const actor = await panelShowing([folder('third-party/')]);
  actor.send({ type: 'commit.TOGGLE_FOLDER', path: 'third-party/' });
  actor.send({ type: 'commit.TOGGLE_FOLDER', path: 'third-party/' });

  await listed('third-party/', ['third-party/a.js']);

  expect(actor.getSnapshot().context.openFolders).toEqual({});
});

it('closes a folder whose row is gone from the status, and lists again the ones still there', async () => {
  const actor = await panelShowing([folder('third-party/'), folder('scratch/')]);
  actor.send({ type: 'commit.TOGGLE_FOLDER', path: 'third-party/' });
  actor.send({ type: 'commit.TOGGLE_FOLDER', path: 'scratch/' });
  await listed('third-party/', ['third-party/a.js']);
  resetAsks();

  await tellStatus(actor, [folder('third-party/')]);

  expect(Object.keys(actor.getSnapshot().context.openFolders)).toEqual(['third-party/']);
  expect(listings()).toEqual(['third-party/']);
});

// A file made deep in the folder moves no status: the news names the folder
it('lists an open folder again when told it changed, and not when told of another file', async () => {
  const actor = await panelShowing([folder('third-party/')]);
  actor.send({ type: 'commit.TOGGLE_FOLDER', path: 'third-party/' });
  resetAsks();

  actor.send({ type: 'commit.REPOSITORY_CHANGED', changed: { ...NOTHING, diffs: true, files: ['src/a.ts'] } });
  expect(listings()).toEqual([]);

  actor.send({ type: 'commit.REPOSITORY_CHANGED', changed: { ...NOTHING, diffs: true, files: ['third-party/'] } });
  expect(listings()).toEqual(['third-party/']);
});
