// The panel holds what a repository asks to be trusted for with the refusal it came in, says the user trusts it
// by the repository that refusal named, and asks for the status that was never read once it is trusted.
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
const trust = { repository: '/work/repo/.git', asks: [{ kind: 'hook' as const, name: 'pre-commit', file: '/work/repo/.git/hooks/pre-commit' }] };
const refused = { type: 'commit.ERROR_RECEIVED' as const, data: { message: 'This repository has settings or hooks that make git run programs.', code: 'untrusted' as const, trust } };

it('holds what the repository asks to be trusted for, and says the user trusts it by the repository named', () => {
  const actor = createActor(commitState).start();

  actor.send(refused);
  expect(actor.getSnapshot().context.gitFailure?.trust).toEqual(trust);

  actor.send({ type: 'commit.TRUST_REPOSITORY' });
  expect(sent()).toContainEqual({ type: 'commit.TRUST_REPOSITORY', repository: '/work/repo/.git' });
});

it('drops the refusal once the repository is trusted, and asks for its status', () => {
  const actor = createActor(commitState).start();
  actor.send(refused);
  sendToSystem.mockReset();

  actor.send({ type: 'commit.REPOSITORY_TRUSTED', data: { repository: '/work/repo/.git' } });

  expect(actor.getSnapshot().context).toMatchObject({ gitError: null, gitFailure: null });
  expect(sent()).toContainEqual({ type: 'commit.GET_GIT_STATUS' });
});

it('says nothing to the backend when there is no refusal to trust', () => {
  const actor = createActor(commitState).start();

  actor.send({ type: 'commit.TRUST_REPOSITORY' });

  expect(sent().filter(event => event.type === 'commit.TRUST_REPOSITORY')).toEqual([]);
});
