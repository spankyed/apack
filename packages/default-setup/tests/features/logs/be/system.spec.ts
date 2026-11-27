// The logs system collects what any code logs, through onLog, and broadcasts each entry to its surface.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { system } from '@apackdev/state';
import { defectGuard } from '@apackdev/state/testing';
import { createLogger } from '@apackdev/sdk/logger';
import logsSystem from '#features/logs/be/system.ts';
import { registration } from '#generated/pack-entry.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('logs system', () => {
  it('receives a log entry through onLog and broadcasts it to the logs surface', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const toSurface: Array<{ to: string; event: unknown }> = [];
    using guard = defectGuard();
    using sys = system({ side: 'backend', onDefect: guard.onDefect });
    sys.attach({
      tell: (to, event) => { toSurface.push({ to, event }); },
      ask: (_to, _name, _args, _progress, done) => {
        done({ ok: false, failure: { kind: 'unavailable', message: 'not used' } });
        return () => {};
      },
      follow: (_feature, _view, _args, _updated, failed) => {
        failed({ kind: 'unavailable', message: 'not used' });
        return { stop: () => {} };
      },
    });
    const handle = sys.start('default-setup/logs', logsSystem);

    createLogger('notes').warn('Note sync is slow', { noteId: 'Note-1' });

    expect(toSurface).toEqual([{
      to: 'default-setup/logs',
      event: expect.objectContaining({
        type: 'LOG_ADDED',
        log: expect.objectContaining({
          level: 'warn',
          source: 'notes',
          message: 'Note sync is slow',
          meta: { noteId: 'Note-1' },
        }),
      }),
    }]);
    expect(sys.read(handle).data.logs).toEqual([
      expect.objectContaining({ source: 'notes', message: 'Note sync is slow' }),
    ]);

    sys.send(handle, { type: 'CLEAR_LOGS' });
    expect(sys.read(handle).data.logs).toEqual([]);
    expect(toSurface.at(-1)).toEqual({
      to: 'default-setup/logs',
      event: { type: 'LOGS_CLEARED' },
    });
    guard.assertNone();
  });

  // It is the logs feature's system like any other pack's: the bus runs it and checks the sends to it, so
  // it starts when the bus does. The viewer therefore holds nothing from before hydration — the data layer
  // coming up reaches stdout and the log file, which is where to read it
  it('is registered as the logs feature\'s system, taking the sends its view makes', () => {
    expect(registration.features?.logs?.system?.receives).toContain('CLEAR_LOGS');
  });
});
