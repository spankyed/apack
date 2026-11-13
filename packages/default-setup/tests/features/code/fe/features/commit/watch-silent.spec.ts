// A watch can be open and still not deliver, as on a network drive or past the system's limit on watches: the
// engine finds changes it never reported and says so in the status. The commit panel holds that for as long as
// the statuses it is sent say it, beside a watch that could not be opened at all.
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

/** Sends the panel a status, as the backend answers its asking for one */
function tell(actor: ReturnType<typeof createActor<typeof commitState>>, { watching, watchSilent }: { watching: boolean; watchSilent?: boolean }) {
  actor.send({ type: 'commit.REFRESH_STATUS' });
  const [, , { call }] = sendToSystem.mock.calls.at(-1) as [string, object, { call: string }];
  actor.send(answerTo(call, {
    type: 'commit.STATUS_RECEIVED' as const,
    data: { files: [], truncated: false, branch: 'main', hasUpstream: false, commitsAhead: 0, commitsBehind: 0, watching, ...(watchSilent && { watchSilent }) },
  }));
}

it('holds a silent watch while the statuses say it, and lets it go once one does not', () => {
  const actor = createActor(commitState).start();

  tell(actor, { watching: true, watchSilent: true });
  expect(actor.getSnapshot().context).toMatchObject({ isWatchingRepository: true, isWatchSilent: true });

  tell(actor, { watching: true });
  expect(actor.getSnapshot().context.isWatchSilent).toBe(false);
});

it('keeps a watch that could not be opened apart from one that is not delivering', () => {
  const actor = createActor(commitState).start();

  tell(actor, { watching: false });

  expect(actor.getSnapshot().context).toMatchObject({ isWatchingRepository: false, isWatchSilent: false });
});
