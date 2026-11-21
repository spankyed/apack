// The logs system collects what any code logs, through onLog, and sends each entry to its surface. It's the
// pack's early system (the app starts it before the others and delivers its messages), which the harness's startApp
// doesn't run, so the test starts its machine on the test host, whose bus is the bound runtime's. Its sends to the
// surface go through the app's bus, which delivers them once a client is connected.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { createLogger } from '@apackdev/sdk/logger';
import { testRootEvents } from '@apackdev/sdk/testing';
import type { Message } from '@apackdev/testing/harness';
import logsEntry from '#features/logs/be/system.ts';
import { registration } from '#generated/pack-entry.ts';

const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach((stop) => stop());
  vi.restoreAllMocks();
});

describe('logs system', () => {
  it('receives a log entry through onLog and sends it to the logs surface', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const toSurface: Message[] = [];
    cleanup.push(testRootEvents.onSurfaceSend((event) => toSurface.push(event)));
    const actor = createActor(logsEntry.machine).start();
    cleanup.push(() => actor.stop());

    createLogger('notes').warn('Note sync is slow', { noteId: 'Note-1' });

    expect(toSurface).toEqual([{
      to: 'default-setup/logs',
      call: expect.any(String),
      // The pack that sent it, stamped by this pack's generated broadcast
      from: 'default-setup',
      event: expect.objectContaining({
        type: 'LOG_ADDED',
        log: expect.objectContaining({ level: 'warn', source: 'notes', message: 'Note sync is slow', meta: { noteId: 'Note-1' } }),
      }),
    }]);
    expect(actor.getSnapshot().context.logs).toEqual([expect.objectContaining({ source: 'notes', message: 'Note sync is slow' })]);
  });

  // It is the logs feature's system like any other pack's: the bus runs it and checks the sends to it, so
  // it starts when the bus does. The viewer therefore holds nothing from before hydration — the data layer
  // coming up reaches stdout and the log file, which is where to read it
  it('is registered as the logs feature\'s system, taking the sends its view makes', () => {
    expect(registration.features?.logs?.system?.receives).toContain('CLEAR_LOGS');
  });
});
