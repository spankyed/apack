// An untracked folder is one row of the panel. Opened, it lists the files in it, and the list is kept current:
// with the status that follows a change, and when the folder itself is said to have changed.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { answerTo } from '@apackdev/sdk/testing';

const sendToSystem = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', () => ({ sendToSystem }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent: vi.fn(),
  updateParentState: vi.fn(),
  sendEventToParent: vi.fn(),
  getParentContext: vi.fn(() => ({})),
}));

const { commitState } = await import('#features/code/fe/features/commit/state.ts');

beforeEach(() => sendToSystem.mockReset());

const folder = (path: string) => ({ path, status: 'untracked' as const, staged: false, isDirectory: true });
const sent = () => sendToSystem.mock.calls.map(([, event]) => event as { type: string; path?: string });
const listings = () => sent().filter(event => event.type === 'commit.LIST_UNTRACKED').map(event => event.path);

/** A panel showing these rows, as the status it asked for said */
function panelShowing(files: ReturnType<typeof folder>[]) {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.SHOWN' });
  tellStatus(actor, files);
  sendToSystem.mockReset();
  return actor;
}
function tellStatus(actor: ReturnType<typeof createActor<typeof commitState>>, files: ReturnType<typeof folder>[]) {
  actor.send({ type: 'commit.REFRESH_STATUS' });
  const [, , { call }] = sendToSystem.mock.calls.at(-1) as [string, object, { call: string }];
  actor.send(answerTo(call, {
    type: 'commit.STATUS_RECEIVED' as const,
    data: { files, truncated: false, branch: 'main', hasUpstream: false, commitsAhead: 0, commitsBehind: 0, watching: true },
  }));
}
const listed = (path: string, files: string[], truncated = false) => ({ type: 'commit.UNTRACKED_LISTED' as const, data: { path, files, truncated } });
const NOTHING = { status: false, diffs: false, history: false, stashes: false, worktrees: false, refs: false };

it('opens a folder\'s row by asking what is in it, lists that, and closes it again', () => {
  const actor = panelShowing([folder('vendor/')]);

  actor.send({ type: 'commit.TOGGLE_FOLDER', path: 'vendor/' });
  expect(listings()).toEqual(['vendor/']);
  actor.send(listed('vendor/', ['vendor/a.js', 'vendor/lib/b.js'], true));
  expect(actor.getSnapshot().context.openFolders).toEqual({ 'vendor/': { files: ['vendor/a.js', 'vendor/lib/b.js'], truncated: true } });

  actor.send({ type: 'commit.TOGGLE_FOLDER', path: 'vendor/' });
  expect(actor.getSnapshot().context.openFolders).toEqual({});
});

it('drops a listing that arrives for a folder closed since it was asked for', () => {
  const actor = panelShowing([folder('vendor/')]);
  actor.send({ type: 'commit.TOGGLE_FOLDER', path: 'vendor/' });
  actor.send({ type: 'commit.TOGGLE_FOLDER', path: 'vendor/' });

  actor.send(listed('vendor/', ['vendor/a.js']));

  expect(actor.getSnapshot().context.openFolders).toEqual({});
});

it('closes a folder whose row is gone from the status, and lists again the ones still there', () => {
  const actor = panelShowing([folder('vendor/'), folder('scratch/')]);
  actor.send({ type: 'commit.TOGGLE_FOLDER', path: 'vendor/' });
  actor.send({ type: 'commit.TOGGLE_FOLDER', path: 'scratch/' });
  actor.send(listed('vendor/', ['vendor/a.js']));
  sendToSystem.mockReset();

  tellStatus(actor, [folder('vendor/')]);

  expect(Object.keys(actor.getSnapshot().context.openFolders)).toEqual(['vendor/']);
  expect(listings()).toEqual(['vendor/']);
});

// A file made deep in the folder moves no status: the news names the folder
it('lists an open folder again when told it changed, and not when told of another file', () => {
  const actor = panelShowing([folder('vendor/')]);
  actor.send({ type: 'commit.TOGGLE_FOLDER', path: 'vendor/' });
  sendToSystem.mockReset();

  actor.send({ type: 'commit.REPOSITORY_CHANGED', changed: { ...NOTHING, diffs: true, files: ['src/a.ts'] } });
  expect(listings()).toEqual([]);

  actor.send({ type: 'commit.REPOSITORY_CHANGED', changed: { ...NOTHING, diffs: true, files: ['vendor/'] } });
  expect(listings()).toEqual(['vendor/']);
});
