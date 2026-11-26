// The console's two verbs: the result shown is the one last asked for.
//
// `EXECUTE_QUERY` and `EXECUTE_TRANSACTION` are independent, one of each under way at a time: asking again gives up
// the ask under way, so its answer is nobody's. Two rather than one, because deleting a row chains a transaction into
// a follow-up query.
import { expect, it } from 'vitest';
import { system, type EventsOf, type Outcome } from '@apackdev/state';
import { defectGuard } from '@apackdev/state/testing';
import databaseState, { isRunningCode } from '#features/database/fe/state.ts';

interface RecordedAsk {
  name: string;
  args: Record<string, unknown>;
  stopped: boolean;
  done: (outcome: Outcome<unknown>) => void;
}

function console_() {
  const asks: RecordedAsk[] = [];
  const guard = defectGuard();
  const sys = system({ side: 'window', onDefect: guard.onDefect });
  sys.attach({
    tell: () => {},
    ask: (_to, name, args, _progress, done) => {
      const entry: RecordedAsk = { name, args: (args ?? {}) as Record<string, unknown>, stopped: false, done };
      asks.push(entry);
      return () => { entry.stopped = true; };
    },
    follow: (_feature, _view, _args, _updated, failed) => {
      failed({ kind: 'unavailable', message: 'not used' });
      return { stop: () => {} };
    },
  });
  const handle = sys.start('default-setup/database', databaseState);

  const asked = (name: string, nth = 0) => {
    const ask = asks.filter((made) => made.name === name)[nth];
    if (!ask) throw new Error(`no ${name} #${nth} was asked`);
    return ask;
  };

  const end = async (ask: RecordedAsk, outcome: Outcome<unknown>) => {
    if (!ask.stopped) ask.done(outcome);
    await sys.idle();
  };

  return {
    asked,
    answer: (ask: RecordedAsk, value: unknown) => end(ask, { ok: true, value }),
    fail: (ask: RecordedAsk, failure: { kind: string; message: string; [key: string]: unknown }) =>
      end(ask, { ok: false, failure: failure as never }),
    read: () => sys.read(handle),
    send: (event: EventsOf<typeof databaseState>) => sys.send(handle, event),
    cleanup: () => {
      guard.assertNone();
      sys.stop();
      guard[Symbol.dispose]();
    },
  };
}

it('takes the result for the query it is waiting on', async () => {
  const ctx = console_();
  try {
    ctx.send({ type: 'QUERY.EXECUTE', code: 'return 1' });
    expect(ctx.asked('EXECUTE_QUERY').args).toEqual({ code: 'return 1' });
    expect(isRunningCode(ctx.read().pending), 'running until it is answered').toBe(true);

    await ctx.answer(ctx.asked('EXECUTE_QUERY'), { result: 'mine', executionTime: 1 });

    expect(ctx.read().data.queryResult).toBe('mine');
    expect(isRunningCode(ctx.read().pending)).toBe(false);
  } finally {
    ctx.cleanup();
  }
});

it('gives up a query when another is asked for, and takes the later one', async () => {
  const ctx = console_();
  try {
    ctx.send({ type: 'QUERY.EXECUTE', code: 'return 1' });
    // Asked again, so the first is no longer waited on
    ctx.send({ type: 'QUERY.EXECUTE', code: 'return 2' });
    expect(ctx.asked('EXECUTE_QUERY').stopped, 'the first was given up').toBe(true);

    await ctx.answer(ctx.asked('EXECUTE_QUERY'), { result: 'stale', executionTime: 1 });
    expect(ctx.read().data.queryResult, 'not taken').toBeNull();

    await ctx.answer(ctx.asked('EXECUTE_QUERY', 1), { result: 'current', executionTime: 1 });
    expect(ctx.read().data.queryResult).toBe('current');
  } finally {
    ctx.cleanup();
  }
});

// The two verbs are asked for independently: a transaction does not give up the query under way
it('keeps a query under way through a transaction', async () => {
  const ctx = console_();
  try {
    ctx.send({ type: 'QUERY.EXECUTE', code: 'return 1' });
    ctx.send({ type: 'TRANSACTION.EXECUTE', code: 'return 2' });
    expect(ctx.asked('EXECUTE_QUERY').stopped).toBe(false);

    await ctx.answer(ctx.asked('EXECUTE_TRANSACTION'), { result: 'written', executionTime: 1 });
    expect(isRunningCode(ctx.read().pending), 'the query is still running').toBe(true);
    await ctx.answer(ctx.asked('EXECUTE_QUERY'), { result: 'read', executionTime: 1 });
    expect(ctx.read().data.queryResult).toBe('read');
    expect(isRunningCode(ctx.read().pending)).toBe(false);
  } finally {
    ctx.cleanup();
  }
});

it('shows why a query could not run', async () => {
  const ctx = console_();
  try {
    ctx.send({ type: 'QUERY.EXECUTE', code: 'return nope' });

    await ctx.fail(ctx.asked('EXECUTE_QUERY'), { kind: 'failed', message: 'nope is not defined' });

    expect(ctx.read().data.error).toBe('nope is not defined');
    expect(isRunningCode(ctx.read().pending)).toBe(false);
  } finally {
    ctx.cleanup();
  }
});

// Deleting a row is a transaction, and the query in the editor is run again once it is done
it('runs the current query again after a row is deleted', async () => {
  const ctx = console_();
  try {
    ctx.send({ type: 'QUERY.UPDATE', code: 'return rows' });
    ctx.send({ type: 'ENTITY.DELETE', entityId: 'Note-1' });

    await ctx.answer(ctx.asked('EXECUTE_TRANSACTION'), { result: { deleted: 'Note-1' }, executionTime: 1 });

    expect(ctx.asked('EXECUTE_QUERY').args).toEqual({ code: 'return rows' });
    await ctx.answer(ctx.asked('EXECUTE_QUERY'), { result: 'what is left', executionTime: 1 });
    expect(ctx.read().data.queryResult).toBe('what is left');
  } finally {
    ctx.cleanup();
  }
});
