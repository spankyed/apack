// The panel offers to stop a push only while one runs, and a stopped push is no failure: it leaves pushing, with
// nothing to show as an error.
import { afterEach, expect, it, vi } from 'vitest';
import { startCommit, type CommitHarness } from './_support.ts';

const running: CommitHarness[] = [];
afterEach(() => {
  for (const h of running.splice(0)) h.stop();
});

it('stops the push running by no longer waiting on it, and stops nothing when none runs', () => {
  const h = startCommit();
  running.push(h);

  h.send({ type: 'commit.STOP_PUSH' });
  expect(h.asksOf('commit.PUBLISH_BRANCH')).toEqual([]);
  expect(h.remotes().data.pushStopped).toBe(false);

  h.send({ type: 'commit.PUSH_BRANCH' });
  h.send({ type: 'commit.STOP_PUSH' });
  expect(h.latestAsk('commit.PUBLISH_BRANCH').stopped).toBe(true);
});

it('leaves pushing once the push is stopped, with no error to show', async () => {
  const h = startCommit();
  running.push(h);
  h.send({ type: 'commit.PUSH_BRANCH' });
  expect(h.remotes().pending.push).toBe(true);
  h.latestAsk('commit.PUBLISH_BRANCH').tell({ during: 'push', stage: 'Writing objects', percent: 42 });
  await vi.waitFor(() => expect(h.open().data.progress).toEqual({ during: 'push', stage: 'Writing objects', percent: 42 }));

  h.send({ type: 'commit.STOP_PUSH' });

  expect(h.remotes().pending.push).toBe(false);
  expect(h.remotes().data.pushStopped).toBe(true);
  expect(h.open().data).toMatchObject({ gitError: null, progress: null });
});
