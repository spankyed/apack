// What the panel holds was read from one folder. When the code surface starts over another, what the first
// was read as, the refusal git gave there and the discard it offered to undo are gone; starting again over the same folder,
// as a reconnect does, keeps them.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';

const parent = vi.hoisted(() => ({ baseDirectory: '/work/one' }));
vi.mock('#generated/events.ts', () => ({ sendToSystem: vi.fn() }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent: vi.fn(),
  updateParentState: vi.fn(),
  sendEventToParent: vi.fn(),
  getParentContext: vi.fn(() => parent),
}));

const { commitState } = await import('#features/code/fe/features/commit/state.ts');

beforeEach(() => { parent.baseDirectory = '/work/one'; });

const trust = { repository: '/work/one/.git', asks: [{ kind: 'hook' as const, name: 'pre-commit', file: '/work/one/.git/hooks/pre-commit' }] };
/** A panel over `/work/one` holding a refusal and an undone discard that left a file */
function held() {
  const actor = createActor(commitState).start();
  actor.send({ type: 'CODE_STARTED' });
  actor.send({ type: 'commit.FILES_REVERTED', data: { paths: ['a.txt', 'b.txt'], kept: { id: 'abc123', notKept: [] } } });
  actor.send({ type: 'commit.DISCARD_RESTORED', data: { id: 'abc123', restored: ['a.txt'], left: ['b.txt'] } });
  actor.send({ type: 'commit.ERROR_RECEIVED', data: { message: 'Not trusted.', code: 'untrusted', trust } });
  return actor;
}

it('keeps what it holds when the surface starts again over the same folder', () => {
  const actor = held();

  actor.send({ type: 'CODE_STARTED' });

  expect(actor.getSnapshot().context).toMatchObject({ discardLeft: ['b.txt'], gitError: 'Not trusted.', gitFailure: { trust } });
});

it('drops the refusal and the discard of one folder when the surface starts over another', () => {
  const actor = held();
  parent.baseDirectory = '/work/two';

  actor.send({ type: 'CODE_STARTED' });

  expect(actor.getSnapshot().context).toMatchObject({
    gitStatus: [], discardLeft: [], lastDiscard: null, gitError: null, gitFailure: null,
    availableBranches: [], gitBranch: '', commitLog: [], hasUpstream: true,
  });
});
