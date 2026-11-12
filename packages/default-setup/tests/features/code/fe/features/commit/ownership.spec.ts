// The panel holds the repository git refused for who owns it, with the refusal it came in, and trusting it is
// one send: the backend asks git which path, so the window sends none.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';

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

const sent = () => sendToSystem.mock.calls.map(([, event]) => event as { type: string });
const refused = { type: 'commit.ERROR_RECEIVED' as const, data: { message: 'Another user owns it.', code: 'unsafe-ownership' as const, ownership: { directory: '/mnt/shared/repo' } } };

it('holds the repository git refused for who owns it, and asks the backend to trust it with no path', () => {
  const actor = createActor(commitState).start();

  actor.send(refused);
  expect(actor.getSnapshot().context.gitFailure?.ownership).toEqual({ directory: '/mnt/shared/repo' });

  actor.send({ type: 'commit.TRUST_OWNERSHIP' });
  expect(sent()).toContainEqual({ type: 'commit.TRUST_OWNERSHIP' });
});

it('drops the refusal once the repository is trusted, and asks for its status', () => {
  const actor = createActor(commitState).start();
  actor.send(refused);
  sendToSystem.mockReset();

  actor.send({ type: 'commit.OWNERSHIP_TRUSTED', data: { directory: '/mnt/shared/repo' } });

  expect(actor.getSnapshot().context).toMatchObject({ gitError: null, gitFailure: null });
  expect(sent()).toContainEqual({ type: 'commit.GET_GIT_STATUS' });
});

it('says nothing to the backend when git has refused nothing', () => {
  const actor = createActor(commitState).start();

  actor.send({ type: 'commit.TRUST_OWNERSHIP' });

  expect(sent()).toEqual([]);
});
