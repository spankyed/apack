// The threads surface clears a new thread's flag and a flashed chat state on a timer, each a started child state.
// A timer leaves the surface's running children once it fires, and a later flash for the same thread replaces the earlier one.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { system, type Clock, type EventsOf, type Outcome, type ViewHost, type ViewUpdate } from '@apackdev/state';
import { defectGuard, waitFor } from '@apackdev/state/testing';
import threadsState from '#features/threads/fe/state.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const fakeClock: Clock = {
  now: () => Date.now(),
  after: (ms, fn) => {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
};

function startThreads() {
  const asks: Array<{ to: string; name: string; args: unknown; done: (outcome: Outcome<unknown>) => void }> = [];
  const viewCallbacks = new Map<string, (update: ViewUpdate<unknown>) => void>();
  const views: ViewHost = (_feature, view, _args, updated) => {
    viewCallbacks.set(view, updated);
    return () => {
      if (viewCallbacks.get(view) === updated) viewCallbacks.delete(view);
    };
  };
  const guard = defectGuard();
  const sys = system({ side: 'window', views, clock: fakeClock, onDefect: guard.onDefect });
  sys.attach({
    tell: () => {},
    ask: (to, name, args, _progress, done) => {
      asks.push({ to, name, args, done });
      return () => {};
    },
    follow: (_feature, _view, _args, _updated, failed) => {
      failed({ kind: 'unavailable', message: 'not used' });
      return { stop: () => {} };
    },
  });
  const handle = sys.start('default-setup/threads', threadsState);
  return {
    sys,
    handle,
    asks,
    pushView: (view: string, value: unknown) => viewCallbacks.get(view)?.({ ok: true, value }),
    read: () => sys.read(handle),
    send: (event: EventsOf<typeof threadsState>) => sys.send(handle, event),
    overrideTimerRefs: () => Object.keys(sys.snapshot()).filter(ref => ref.startsWith('default-setup/threads/overrideTimers/')),
    cleanup: () => {
      guard.assertNone();
      sys.stop();
      guard[Symbol.dispose]();
    },
  };
}

it('drops the new-thread timer once it clears the flag', async () => {
  const ctx = startThreads();
  try {
    ctx.send({ type: 'SURFACE_STARTED', ownsAppLayout: true });
    ctx.pushView('list', [{ id: 'Thread-t1', topic: 'New' }]);
    ctx.send({ type: 'SHOW_CREATE_FORM' });
    ctx.send({ type: 'CREATE_THREAD' });
    ctx.asks.find(ask => ask.name === 'CREATE_THREAD')!.done({ ok: true, value: { id: 'Thread-t1' } });
    await waitFor(ctx.sys, ctx.handle, v => v.data.freshThreadIds.includes('Thread-t1'));

    const timerHandle = ctx.sys.child(ctx.handle, 'newThreadTimers', 'Thread-t1');
    expect(ctx.sys.read(timerHandle)).toBeDefined();
    expect(ctx.read().data.threadMap['Thread-t1']?.isNew).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);

    expect(ctx.sys.read(timerHandle)).toBeUndefined();
    expect(ctx.read().data.threadMap['Thread-t1']?.isNew).toBe(false);
  } finally {
    ctx.cleanup();
  }
});

it('drops the chat state timer once the override expires', async () => {
  const ctx = startThreads();
  try {
    ctx.send({ type: 'FLASH_CHAT_STATE', threadId: 'Thread-t1', stateId: 'saved', durationMs: 500 });
    expect(ctx.overrideTimerRefs()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(500);

    expect(ctx.overrideTimerRefs()).toEqual([]);
    expect(ctx.read().data.chatStateOverrides['Thread-t1']).toBeUndefined();
  } finally {
    ctx.cleanup();
  }
});

it("keeps a thread's later chat state override until its own timer, not the earlier one's", async () => {
  const ctx = startThreads();
  try {
    ctx.send({ type: 'FLASH_CHAT_STATE', threadId: 'Thread-t1', stateId: 'first', durationMs: 500 });
    await vi.advanceTimersByTimeAsync(300);
    ctx.send({ type: 'FLASH_CHAT_STATE', threadId: 'Thread-t1', stateId: 'second', durationMs: 500 });

    await vi.advanceTimersByTimeAsync(300);
    expect(ctx.read().data.chatStateOverrides['Thread-t1']?.id).toBe('second');

    await vi.advanceTimersByTimeAsync(200);
    expect(ctx.read().data.chatStateOverrides['Thread-t1']).toBeUndefined();
    expect(ctx.overrideTimerRefs()).toEqual([]);
  } finally {
    ctx.cleanup();
  }
});
