// The panel holds what a repository asks to be trusted for with the refusal it came in, says the user trusts it
// by the repository that refusal named, and asks for the status that was never read once it is trusted.
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

const sent = () => made.map(ask => ask.event);
const trust = { repository: '/work/repo/.git', asks: [{ kind: 'hook' as const, name: 'pre-commit', file: '/work/repo/.git/hooks/pre-commit' }] };
/** A panel whose status read was refused until the repository is trusted */
async function refused() {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.REFRESH_STATUS' });
  await latestAsk('commit.GET_GIT_STATUS').refuse('This repository has settings or hooks that make git run programs.', { kind: 'git', code: 'untrusted', trust });
  return actor;
}

it('holds what the repository asks to be trusted for, and says the user trusts it by the repository named', async () => {
  const actor = await refused();
  expect(actor.getSnapshot().context.gitFailure?.trust).toEqual(trust);

  actor.send({ type: 'commit.TRUST_REPOSITORY' });
  expect(sent()).toContainEqual({ type: 'commit.TRUST_REPOSITORY', repository: '/work/repo/.git' });
});

it('drops the refusal once the repository is trusted, and asks for its status', async () => {
  const actor = await refused();
  actor.send({ type: 'commit.TRUST_REPOSITORY' });
  const before = made.length;

  await latestAsk('commit.TRUST_REPOSITORY').answer({ repository: '/work/repo/.git' });

  expect(actor.getSnapshot().context).toMatchObject({ gitError: null, gitFailure: null });
  expect(sent().slice(before)).toContainEqual({ type: 'commit.GET_GIT_STATUS' });
});

it('says nothing to the backend when there is no refusal to trust', () => {
  const actor = createActor(commitState).start();

  actor.send({ type: 'commit.TRUST_REPOSITORY' });

  expect(sent().filter(event => event.type === 'commit.TRUST_REPOSITORY')).toEqual([]);
});
