// The panel holds what a repository asks to be trusted for with the refusal it came in, says the user trusts it
// by the repository that refusal named, and asks for the status that was never read once it is trusted.
import { afterEach, expect, it } from 'vitest';
import { startCommit, type CommitHarness } from './_support.ts';

const running: CommitHarness[] = [];
afterEach(() => {
  for (const h of running.splice(0)) h.stop();
});

const sent = (h: CommitHarness) => h.made.map((ask) => ask.event);
const trust = { repository: '/work/repo/.git', asks: [{ kind: 'hook' as const, name: 'pre-commit', file: '/work/repo/.git/hooks/pre-commit' }] };

async function refused() {
  const h = startCommit();
  running.push(h);
  h.send({ type: 'commit.REFRESH_STATUS' });
  await h.latestAsk('commit.GET_GIT_STATUS').refuse('This repository has settings or hooks that make git run programs.', { kind: 'git', code: 'untrusted', trust });
  return h;
}

it('holds what the repository asks to be trusted for, and says the user trusts it by the repository named', async () => {
  const h = await refused();
  expect(h.open().data.gitFailure?.trust).toEqual(trust);

  h.send({ type: 'commit.TRUST_REPOSITORY' });
  expect(sent(h)).toContainEqual({ type: 'commit.TRUST_REPOSITORY', repository: '/work/repo/.git' });
});

it('drops the refusal once the repository is trusted, and asks for its status', async () => {
  const h = await refused();
  h.send({ type: 'commit.TRUST_REPOSITORY' });
  const before = h.made.length;

  await h.latestAsk('commit.TRUST_REPOSITORY').answer({ repository: '/work/repo/.git' });

  expect(h.open().data).toMatchObject({ gitError: null, gitFailure: null });
  expect(sent(h).slice(before)).toContainEqual({ type: 'commit.GET_GIT_STATUS' });
});

it('says nothing to the backend when there is no refusal to trust', () => {
  const h = startCommit();
  running.push(h);

  h.send({ type: 'commit.TRUST_REPOSITORY' });

  expect(sent(h).filter((event) => event.type === 'commit.TRUST_REPOSITORY')).toEqual([]);
});
