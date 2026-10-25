// Sends, logging and error reports are SDK code over the bound app's bus: here the test host's
import * as os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startTestRuntime, takeSystemErrors, testRootEvents } from '../../src/testing/index.ts';
import { testPacksView } from '../../src/testing/packs.ts';
import { resolveName } from '../../src/ids/index.ts';
import { onIncoming, untypedBroadcastToSurface, untypedSendToSystem } from '../../src/events/index.ts';
import { bindFeHost, unbindFeHost } from '../../src/runtime/fe-host.ts';
import { createLogger, onLog, type LogEvent } from '../../src/logger/index.ts';
import { createActionEmitter } from '../../src/services/index.ts';
import type { Message } from '../../src/events/index.ts';

process.env.APACK_ENV ??= 'test';
process.env.APACK_USER_DATA_DIR ??= os.tmpdir();
// services.emitter sends only to a registered surface
startTestRuntime({ packs: { ...testPacksView(), surfaceIds: () => [resolveName('memo-pack/memos')] } });

afterEach(() => {
  takeSystemErrors();
  vi.restoreAllMocks();
});

/** Everything `run` put on the bus */
function onBus(run: () => void) {
  const logs: LogEvent[] = [];
  const toSurfaces: Message[] = [];
  const outgoing: Message[] = [];
  const incoming: Message[] = [];
  const stop = [
    testRootEvents.onLog((e) => logs.push(e)),
    testRootEvents.onSurfaceSend((e) => toSurfaces.push(e)),
    testRootEvents.onOutgoing((e) => outgoing.push(e)),
    testRootEvents.onIncoming((e) => incoming.push(e)),
  ];
  try {
    run();
  } finally {
    stop.forEach((unsubscribe) => unsubscribe());
  }
  return { logs, toSurfaces, outgoing, incoming };
}

describe('on the bound bus', () => {
  it('untypedBroadcastToSurface and services.emitter.broadcastToSurface go to the bus, which delivers them, not to the clients directly', () => {
    const sent = onBus(() => {
      // The untyped send takes the id a surface runs under; the emitter takes the name an action writes
      untypedBroadcastToSurface('memo-pack/memos', { type: 'MEMO_ADDED' });
      createActionEmitter().broadcastToSurface('memo-pack/memos', { type: 'MEMO_REMOVED' });
    });
    expect(sent.toSurfaces).toEqual([
      { to: 'memo-pack/memos', call: expect.any(String), event: { type: 'MEMO_ADDED' } },
      { to: 'memo-pack/memos', call: expect.any(String), event: { type: 'MEMO_REMOVED' } },
    ]);
    expect(sent.outgoing).toEqual([]);
  });

  // Where a message goes is never a field of its event, so an event may carry any field of its own
  it('delivers an event exactly as it was sent, a field named surfaceId or systemId included', () => {
    const sent = onBus(() => {
      untypedBroadcastToSurface('memo-pack/memos', { type: 'SURFACE_PICKED', surfaceId: 'default-setup/notes' });
      untypedSendToSystem('memo-pack/memos', { type: 'OPEN', systemId: 'kept', surfaceId: 'also-kept' });
    });
    expect(sent.toSurfaces).toEqual([{ to: 'memo-pack/memos', call: expect.any(String), event: { type: 'SURFACE_PICKED', surfaceId: 'default-setup/notes' } }]);
    expect(sent.incoming).toEqual([{ to: 'memo-pack/memos', call: expect.any(String), event: { type: 'OPEN', systemId: 'kept', surfaceId: 'also-kept' } }]);
  });

  it('onIncoming and onLog hear the bus until unsubscribed', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const heard: unknown[] = [];
    const stop = [onIncoming((e) => heard.push(e)), onLog((e) => heard.push(e))];
    testRootEvents.emitIncoming({ to: 'memos', event: { type: 'ADD_MEMO' } });
    testRootEvents.emitLog({ level: 'debug', message: 'x' });
    stop.forEach((unsubscribe) => unsubscribe());
    testRootEvents.emitIncoming({ to: 'memos', event: { type: 'ADD_MEMO' } });
    testRootEvents.emitLog({ level: 'debug', message: 'y' });
    expect(heard).toEqual([{ to: 'memos', event: { type: 'ADD_MEMO' } }, { level: 'debug', message: 'x' }]);
  });

  it('createLogger emits one redacted log event per entry, with meta that JSON holds and an error stack, and prints only through the bus', () => {
    const printed = vi.spyOn(console, 'error').mockImplementation(() => {});
    const circular: Record<string, unknown> = { apiKey: 'plain', fn: () => {} };
    circular.self = circular;
    const failure = new Error('bad key sk-proj-abcdef1234567890');
    const { logs } = onBus(() => createLogger('memos').error('saving sk-ant-abcdef1234567890 failed', { error: failure, circular }));
    expect(logs).toEqual([{
      level: 'error',
      source: 'memos',
      message: 'saving [redacted] failed',
      meta: {
        error: { name: 'Error', message: 'bad key [redacted]', stack: expect.stringContaining('bad key [redacted]') },
        circular: { apiKey: '[redacted]', fn: '[Function]', self: '[Circular Reference]' },
      },
      stack: expect.stringContaining('bad key [redacted]'),
    }]);
    // The test host prints each log event once, as the app's log capture does
    expect(printed).toHaveBeenCalledTimes(1);
  });

  /**
   * The case that used to throw from inside the logger.
   *
   * `JSON.stringify` refuses a BigInt and the meta pass had no branch for one, so logging a query row threw —
   * on data this app's own database returns, which is the reason the socket has an encoder for them at all.
   */
  it('logs a BigInt as its digits rather than throwing', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});

    const { logs } = onBus(() => createLogger('memos').info('a row', { id: 'Note-1', count: 9007199254740993n }));

    expect(logs[0].meta).toEqual({ id: 'Note-1', count: '9007199254740993' });
  });

  it("gives an error entry without an error the stack where it was logged", () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { logs } = onBus(() => createLogger('memos').error('no error given'));
    expect(logs[0].stack).toContain('bound-transport.spec.ts');
  });
});

describe('with a frontend bound too', () => {
  it('sends to systems through the frontend, whose packs the lookups read', () => {
    const sentByFrontend: Message[] = [];
    bindFeHost({ catalog: {} as never,
      application: {} as never,
      secrets: {} as never,
    settings: {} as never,
      client: { send: (message) => sentByFrontend.push(message), watchView: () => () => {} },
      packs: { designation: (role: string) => (role === 'brain' ? 'brain-surface' : undefined) } as never,
    });
    try {
      const sent = onBus(() => {
        untypedSendToSystem('memos', { type: 'ADD_MEMO' });
        untypedSendToSystem({ role: 'brain' }, { type: 'TRIGGER_BRAIN_EVENT', eventType: 'user.message' });
      });
      expect(sent.incoming).toEqual([]);
      expect(sentByFrontend).toEqual([
        { to: 'memos', call: expect.any(String), event: { type: 'ADD_MEMO' } },
        { to: 'brain-surface', call: expect.any(String), event: { type: 'TRIGGER_BRAIN_EVENT', eventType: 'user.message' } },
      ]);
    } finally {
      unbindFeHost();
    }
  });
});
