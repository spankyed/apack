// What `killTurn` has already done by the time it releases the consumer.
//
// **Unregistering a consumer runs it.** `onUnregistered` is the codex consumer's release, so
// `unregisterConsumer` synchronously runs its `finalize` — which finalises the turn's writers, and then,
// if it still owns the thread, clears the handle, dequeues whatever is queued and replays it as a new
// turn. Everything `killTurn` does around that call is therefore ordered against it, and the ordering is
// the subject here: the release has to find a thread that is no longer mid-turn, so that it finalises the
// writers and stops.
import { describe, expect, it } from 'vitest';
import type { Services } from '#generated/services.ts';
import { getCodexState, killTurn } from '../../../../../src/content/actions/codex/_helpers/thread-context.ts';

const THREAD = 'thread-one';

/**
 * A thread mid-turn with a message queued behind it, and a codex service that records what it was asked.
 *
 * `seen` is what the state looked like **at the moment** `unregisterConsumer` was called, which is the
 * only reading that answers the question: afterwards every ordering looks the same.
 */
function midTurn() {
  let thread: Record<string, any> = {
    id: THREAD,
    tags: [],
    context: {
      codex: {
        threadId: 'codex-thread-1',
        turnId: 'turn-1',
        activeMessageId: 'message-1',
        isRunning: true,
        queuedMessage: { messageId: 'message-2', text: 'the next thing' },
      },
    },
  };
  const messages: Array<{ id: string; updates: Record<string, unknown> }> = [];
  let seen: Record<string, any> | undefined;

  const services = {
    repository: {
      threadQueries: { byId: (id: string) => (id === THREAD ? thread : undefined) },
      threadCommands: { update: (_id: string, patch: Record<string, unknown>) => { thread = { ...thread, ...patch }; } },
    },
    chat: {
      updateMessageState: (id: string, updates: Record<string, unknown>) => { messages.push({ id, updates }); },
    },
    codex: {
      interruptTurn: () => undefined,
      unregisterConsumer: () => { seen = getCodexState(services, THREAD) as Record<string, any>; },
      getHandle: () => undefined,
      clearHandle: () => {},
    },
  } as unknown as Services;

  return { services, messages, released: () => seen };
}

describe('killing a codex turn', () => {
  /**
   * **The flags go before the release, or the consumer still owns the thread.** `finalize` decides with
   * `stillCurrent()` — `activeMessageId === its own message` — so a release that arrives while the flags
   * stand runs the whole completion path: it clears the handle, dequeues the waiting message and starts a
   * turn for it, and then this kill's own writes land on top and tear that turn's state back out.
   */
  it('has cleared the mid-turn flags before it releases the consumer', () => {
    const { services, released } = midTurn();

    killTurn(services, THREAD);

    expect(released(), 'the consumer was released').toBeDefined();
    expect(released()?.activeMessageId, 'so `stillCurrent()` is already false').toBeUndefined();
    expect(released()?.isRunning).toBe(false);
    expect(released()?.turnId).toBeUndefined();
  });

  /** And the queued message is already gone, so the release has nothing to replay */
  it('has dequeued and cancelled the waiting message before it releases the consumer', () => {
    const { services, messages, released } = midTurn();

    killTurn(services, THREAD);

    expect(released()?.queuedMessage, 'nothing left for the release to start').toBeUndefined();
    expect(messages).toEqual([{ id: 'message-2', updates: { status: 'cancelled' } }]);
  });

  /** Nothing mid-turn: the kill is still safe, and still releases */
  it('releases an idle thread without cancelling anything', () => {
    const { services, messages, released } = midTurn();
    (services as any).repository.threadCommands.update(THREAD, { context: { codex: { threadId: 'codex-thread-1' } } });

    killTurn(services, THREAD);

    expect(released()).toBeDefined();
    expect(messages).toEqual([]);
  });
});
