// A message of this window's that was not sent: held until the chat has told the person, and then dropped, so each
// is told once and one noted meanwhile is not lost.
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

/** Sends a message and ends its ask refused with `message` */
async function sendRefused(ctx: ReturnType<typeof startThreads>, message: string) {
  ctx.send({ type: 'SEND_MESSAGE', text: 'hello' });
  ctx.asks.filter(ask => ask.name === 'USER_MSG').at(-1)!.done({ ok: false, failure: { kind: 'failed', message } });
  await waitFor(ctx.sys, ctx.handle, v => v.pending.sent === 0);
}

it('holds each message that was not sent until the chat says it told the person', async () => {
  const ctx = startThreads();
  try {
    await sendRefused(ctx, 'The assistant is not running');
    const [first] = ctx.read().data.sendFailures;
    expect(first).toEqual({ message: 'The assistant is not running' });

    // One noted after the chat read the first is kept when the chat says it told the first
    await sendRefused(ctx, 'The assistant is not running');
    ctx.send({ type: 'CHAT.FAILURES_TOLD', told: [first!] });
    expect(ctx.read().data.sendFailures).toHaveLength(1);
    expect(ctx.read().data.sendFailures[0]).not.toBe(first);
  } finally {
    ctx.cleanup();
  }
});

it('holds nothing for a message that was sent', async () => {
  const ctx = startThreads();
  try {
    ctx.send({ type: 'SEND_MESSAGE', text: 'hello' });
    ctx.asks.filter(ask => ask.name === 'USER_MSG').at(-1)!.done({ ok: true, value: { threadId: 'Thread-a', started: false } });
    await waitFor(ctx.sys, ctx.handle, v => v.pending.sent === 0);
    expect(ctx.read().data.sendFailures).toEqual([]);
  } finally {
    ctx.cleanup();
  }
});
