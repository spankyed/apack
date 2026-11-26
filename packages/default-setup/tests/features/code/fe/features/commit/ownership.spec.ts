// The panel holds the repository git refused for who owns it, with the refusal it came in, and trusting it is
// one send: the backend asks git which path, so the window sends none.
import { afterEach, expect, it } from 'vitest';
import { startCommit, type CommitHarness } from './_support.ts';

const running: CommitHarness[] = [];
afterEach(() => {
  for (const h of running.splice(0)) h.stop();
});

const sent = (h: CommitHarness) => h.made.map((ask) => ask.event);

async function refused() {
  const h = startCommit();
  running.push(h);
  h.send({ type: 'commit.REFRESH_STATUS' });
  await h.latestAsk('commit.GET_GIT_STATUS').refuse('Another user owns it.', { kind: 'git', code: 'unsafe-ownership', ownership: { directory: '/mnt/shared/repo' } });
  return h;
}

it('holds the repository git refused for who owns it, and asks the backend to trust it with no path', async () => {
  const h = await refused();
  expect(h.open().data.gitFailure).toMatchObject({ code: 'unsafe-ownership', ownership: { directory: '/mnt/shared/repo' } });

  h.send({ type: 'commit.TRUST_OWNERSHIP' });
  expect(sent(h)).toContainEqual({ type: 'commit.TRUST_OWNERSHIP' });
});

it('drops the refusal once the repository is trusted, and asks for its status', async () => {
  const h = await refused();
  h.send({ type: 'commit.TRUST_OWNERSHIP' });
  const before = h.made.length;

  await h.latestAsk('commit.TRUST_OWNERSHIP').answer({ directory: '/mnt/shared/repo' });

  expect(h.open().data).toMatchObject({ gitError: null, gitFailure: null });
  expect(sent(h).slice(before)).toContainEqual({ type: 'commit.GET_GIT_STATUS' });
});

it('says nothing to the backend when git has refused nothing', () => {
  const h = startCommit();
  running.push(h);

  h.send({ type: 'commit.TRUST_OWNERSHIP' });

  expect(sent(h)).toEqual([]);
});
