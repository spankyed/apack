// How far along a push, a pull or a checkout is: the panel holds what git last said until the command is answered
import { afterEach, expect, it, vi } from 'vitest';
import type { MadeAsk } from '../../_support/asks.ts';
import { startCommit, type CommitHarness } from './_support.ts';

const running: CommitHarness[] = [];
afterEach(() => {
  for (const h of running.splice(0)) h.stop();
});

const WRITING = { during: 'push', stage: 'Writing objects', percent: 42 } as const;

it.each([
  ['it is pushed', (push: MadeAsk) => push.answer({ branchName: 'main' })],
  ['git refuses it', (push: MadeAsk) => push.refuse('Failed to push', { kind: 'git' })],
] as const)('holds how far along a push is, as its ask says, and lets go of it once %s', async (_when, end) => {
  const h = startCommit();
  running.push(h);
  h.send({ type: 'commit.PUSH_BRANCH' });

  h.latestAsk('commit.PUBLISH_BRANCH').tell(WRITING);
  await vi.waitFor(() => expect(h.open().data.progress).toEqual(WRITING));

  await end(h.latestAsk('commit.PUBLISH_BRANCH'));
  expect(h.open().data.progress).toBeNull();
  expect(h.remotes().pending.push).toBe(false);
});
