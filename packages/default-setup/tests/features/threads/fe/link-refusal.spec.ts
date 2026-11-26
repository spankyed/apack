// The link form's refusal: the reason a save of a thread's links was refused, shown under that thread's links, and only
// that thread's. The surface keeps which ask its save is and takes that ask's refusal, so a refusal that lands after
// the window moved to another thread is not shown there.
import { expect, it } from 'vitest';
import { system, type EventsOf, type Outcome } from '@apackdev/state';
import { defectGuard, waitFor } from '@apackdev/state/testing';
import threadsState from '#features/threads/fe/state.ts';

function startThreads() {
  const asks: Array<{ to: string; name: string; args: unknown; done: (outcome: Outcome<unknown>) => void }> = [];
  const guard = defectGuard();
  const sys = system({ side: 'window', onDefect: guard.onDefect });
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
    read: () => sys.read(handle),
    send: (event: EventsOf<typeof threadsState>) => sys.send(handle, event),
    cleanup: () => {
      guard.assertNone();
      sys.stop();
      guard[Symbol.dispose]();
    },
  };
}

/** Ends an ask, and lets the surface take how it ended */
async function end(
  ctx: ReturnType<typeof startThreads>,
  ask: ReturnType<typeof startThreads>['asks'][number],
  refusal?: string,
) {
  const before = Object.keys(ctx.read().pending.fieldWrite).length;
  ask.done(refusal === undefined ? { ok: true, value: undefined } : { ok: false, failure: { kind: 'failed', message: refusal } });
  await waitFor(ctx.sys, ctx.handle, v => Object.keys(v.pending.fieldWrite).length < before);
}

const links = [{ relation: 'blocks', id: 'Thread-b' }];

function viewing(threadId: string) {
  const ctx = startThreads();
  ctx.send({ type: 'SELECT_THREAD', id: threadId });
  return ctx;
}

/** Saves the open thread's links, answering with how to end the save: refused with the reason given, or landed with none */
function saveLinks(ctx: ReturnType<typeof viewing>) {
  ctx.send({ type: 'UPDATE_THREAD_FIELD', key: 'linkedThreads', value: links as never, state: 'view' });
  const save = ctx.asks.at(-1)!;
  return (refusal?: string) => end(ctx, save, refusal);
}

it("shows the reason a save of the open thread's links was refused, until a save lands", async () => {
  const ctx = viewing('Thread-a');
  try {
    await saveLinks(ctx)('THR-2 already blocks THR-1');
    expect(ctx.read().data.linkRefusal).toBe('THR-2 already blocks THR-1');
    await saveLinks(ctx)();
    expect(ctx.read().data.linkRefusal).toBeNull();
  } finally {
    ctx.cleanup();
  }
});

it('shows another thread no refusal of a save made before the window moved to it', async () => {
  const ctx = viewing('Thread-a');
  try {
    const answer = saveLinks(ctx);
    ctx.send({ type: 'SELECT_THREAD', id: 'Thread-c' });
    await answer('THR-2 already blocks THR-1');
    expect(ctx.read().data.linkRefusal).toBeNull();
  } finally {
    ctx.cleanup();
  }
});

it('takes no refusal of a write other than a links save', async () => {
  const ctx = viewing('Thread-a');
  try {
    ctx.send({ type: 'UPDATE_THREAD_FIELD', key: 'topic', value: 'Renamed' as never, state: 'view' });
    await end(ctx, ctx.asks.at(-1)!, 'Thread Thread-a not found');
    expect(ctx.read().data.linkRefusal).toBeNull();
  } finally {
    ctx.cleanup();
  }
});
