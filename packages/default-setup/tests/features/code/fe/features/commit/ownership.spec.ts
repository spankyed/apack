// The panel holds the repository git refused for who owns it, with the refusal it came in, and trusting it is
// one send: the backend asks git which path, so the window sends none.
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
/** A panel whose status read git refused for who owns the repository */
async function refused() {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.REFRESH_STATUS' });
  await latestAsk('commit.GET_GIT_STATUS').refuse('Another user owns it.', { kind: 'git', code: 'unsafe-ownership', ownership: { directory: '/mnt/shared/repo' } });
  return actor;
}

it('holds the repository git refused for who owns it, and asks the backend to trust it with no path', async () => {
  const actor = await refused();
  expect(actor.getSnapshot().context.gitFailure).toMatchObject({ code: 'unsafe-ownership', ownership: { directory: '/mnt/shared/repo' } });

  actor.send({ type: 'commit.TRUST_OWNERSHIP' });
  expect(sent()).toContainEqual({ type: 'commit.TRUST_OWNERSHIP' });
});

it('drops the refusal once the repository is trusted, and asks for its status', async () => {
  const actor = await refused();
  actor.send({ type: 'commit.TRUST_OWNERSHIP' });
  const before = made.length;

  await latestAsk('commit.TRUST_OWNERSHIP').answer({ directory: '/mnt/shared/repo' });

  expect(actor.getSnapshot().context).toMatchObject({ gitError: null, gitFailure: null });
  expect(sent().slice(before)).toContainEqual({ type: 'commit.GET_GIT_STATUS' });
});

it('says nothing to the backend when git has refused nothing', () => {
  const actor = createActor(commitState).start();

  actor.send({ type: 'commit.TRUST_OWNERSHIP' });

  expect(sent()).toEqual([]);
});
