// The logs surface asks for the buffer where a delivery names it: when the shell starts it, and when the settings that
// filter the buffer change — never from its own entry, whose ask could not be answered.
import { expect, it } from 'vitest';
import { system, type EventsOf, type Outcome } from '@apackdev/state';
import { defectGuard, waitFor } from '@apackdev/state/testing';
import logsState from '#features/logs/fe/state.ts';

function startLogs() {
  const reads: Array<{
    to: string;
    name: string;
    cancelled: boolean;
    done: (outcome: Outcome<unknown>) => void;
  }> = [];
  const tells: Array<{ to: string; event: unknown }> = [];
  const guard = defectGuard();
  const sys = system({ side: 'window', onDefect: guard.onDefect });
  sys.attach({
    tell: (to, event) => { tells.push({ to, event }); },
    ask: (to, name, _args, _progress, done) => {
      const entry = { to, name, cancelled: false, done };
      reads.push(entry);
      return () => { entry.cancelled = true; };
    },
    follow: (_feature, _view, _args, _updated, failed) => {
      failed({ kind: 'unavailable', message: 'not used' });
      return { stop: () => {} };
    },
  });
  const handle = sys.start('default-setup/logs', logsState);
  return {
    sys,
    handle,
    reads,
    tells,
    read: () => sys.read(handle),
    send: (event: EventsOf<typeof logsState>) => sys.send(handle, event),
    cleanup: () => {
      guard.assertNone();
      sys.stop();
      guard[Symbol.dispose]();
    },
  };
}

it('asks for the buffer when it starts and when its settings change, superseding prior reads', async () => {
  const ctx = startLogs();
  try {
    expect(ctx.reads).toHaveLength(0);

    ctx.send({ type: 'SURFACE_STARTED', ownsAppLayout: true });
    expect(ctx.reads).toHaveLength(1);
    expect(ctx.reads[0]).toMatchObject({ to: 'default-setup/logs', name: 'GET_LOGS', cancelled: false });

    ctx.send({ type: 'FEATURE_SETTINGS_UPDATED', settings: { maxLogs: 10, excludedSources: [] } as never });
    expect(ctx.reads).toHaveLength(2);
    expect(ctx.reads[0].cancelled).toBe(true);

    ctx.reads[1].done({
      ok: true,
      value: {
        logs: [{ id: 'l1', timestamp: 1, level: 'info', message: 'hello' }],
        settings: { maxLogs: 10, excludedSources: [] },
      },
    });
    await waitFor(ctx.sys, ctx.handle, (v) => v.data.logs.length === 1);
    expect(ctx.read().data.logs.map((log) => log.message)).toEqual(['hello']);
  } finally {
    ctx.cleanup();
  }
});

it('deduplicates added logs, updates filters, and tells the backend when cleared', () => {
  const ctx = startLogs();
  try {
    const entry = { id: 'l1', timestamp: 1, level: 'warn' as const, message: 'first' };
    ctx.send({ type: 'LOG_ADDED', log: entry });
    ctx.send({ type: 'LOG_ADDED', log: entry });
    expect(ctx.read().data.logs).toHaveLength(1);

    ctx.send({ type: 'SET_FILTER_LEVEL', level: 'error' });
    ctx.send({ type: 'SET_SEARCH', search: 'boom' });
    expect(ctx.read().data.filter).toEqual({ level: 'error', search: 'boom' });

    ctx.send({ type: 'CLEAR_LOGS' });
    expect(ctx.read().data.logs).toEqual([]);
    expect(ctx.tells).toEqual([{ to: 'default-setup/logs', event: { type: 'CLEAR_LOGS' } }]);
  } finally {
    ctx.cleanup();
  }
});
