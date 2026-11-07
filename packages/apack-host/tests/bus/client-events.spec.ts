import { createNativePackTestRegistry } from '@apackdev/host/testing';
// A client's event reaches the root event bus only when a registered system accepts its type, and is logged
// by type, target and sender — never by payload
import { afterAll, describe, expect, it } from 'vitest';
import { setup } from 'xstate';
import { testRootEvents } from '@apackdev/sdk/testing';
import type { LogEvent } from '@apackdev/sdk/logger';
import '../packs/runtime/test-host.ts';
import { receiveClientEvent, UnknownClientEventError } from '../../src/bus/client-events.ts';

const machine = setup({}).createMachine({});
const registry = createNativePackTestRegistry();
const { registerPack, unregisterPack } = registry;
registerPack({ id: 'host', features: { ping: { system: { machine, receives: ['PING'] } } } });
registerPack({ id: 'client-events-pack', features: { any: { system: { machine, receives: ['*'] } } } });
afterAll(() => unregisterPack('client-events-pack'));

/** The incoming events and log events `run` produces */
function during(run: () => void): { incoming: unknown[]; logs: LogEvent[] } {
  const incoming: unknown[] = [];
  const logs: LogEvent[] = [];
  const stops = [testRootEvents.onIncoming((event) => { incoming.push(event); }), testRootEvents.onLog((event) => { logs.push(event); })];
  try {
    run();
  } finally {
    stops.forEach((stop) => stop());
  }
  return { incoming, logs };
}

describe('receiveClientEvent', () => {
  it('puts an accepted event on the bus and logs its type and target', () => {
    const message = { to: 'host/ping', event: { type: 'PING', note: 'hi' } };
    const { incoming, logs } = during(() => receiveClientEvent(registry, message));
    expect(incoming).toEqual([message]);
    expect(logs).toEqual([expect.objectContaining({ level: 'info', source: 'app-events', meta: { to: 'host/ping' } })]);
    expect(logs[0]!.message).toContain('PING');
  });

  it('logs who sent it, which is identity rather than payload', () => {
    const message = { to: 'host/ping', event: { type: 'PING' }, from: 'memo-pack', via: 'action:Add Memo' };
    const { logs } = during(() => receiveClientEvent(registry, message));
    expect(logs[0]!.meta).toEqual({ to: 'host/ping', from: 'memo-pack', via: 'action:Add Memo' });
  });

  /**
   * The guard for the finding: `terminal.TERMINAL_INPUT` carries a keystroke, and this seam logged whole event
   * payloads into `main.log` and `main.jsonl` — so a password typed at a `sudo` prompt was written to disk.
   *
   * It searches the serialized record rather than one field, because the defect is "a payload reached a log",
   * not "that expression reached a log": re-adding it anywhere, under any key or through a future summarizer,
   * puts the sentinel back and fails this.
   */
  it('lets no part of a payload reach a log, by any field', () => {
    const sentinel = 'pa55word-sentinel';
    const message = {
      to: 'client-events-pack/any',
      event: { type: 'TERMINAL_INPUT', data: sentinel, nested: { also: sentinel }, many: [sentinel, sentinel] },
    };
    const { logs } = during(() => receiveClientEvent(registry, message));
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs[0])).not.toContain(sentinel);
  });

  it('accepts any type for a system that lists *', () => {
    const { incoming } = during(() => receiveClientEvent(registry, { to: 'client-events-pack/any', event: { type: 'ANYTHING' } }));
    expect(incoming).toEqual([{ to: 'client-events-pack/any', event: { type: 'ANYTHING' } }]);
  });

  // Pack code may send the bus what HostSystemEvents declares, from a frontend as from a backend: typed for both, so
  // refused here, a send that compiled failed only on the client path
  it("accepts what the host's bus takes, and only that", () => {
    const message = { to: 'host/bus', event: { type: 'PACK_CHANGED', packId: 'client-events-pack' } };
    expect(during(() => receiveClientEvent(registry, message)).incoming).toEqual([message]);
    expect(() => receiveClientEvent(registry, { to: 'host/bus', event: { type: 'RELOAD_PACK' } }))
      .toThrow('Unknown event "RELOAD_PACK" for system "host/bus"');
  });

  /**
   * The fourth place a sender is worth saying. A client's send is refused here by name, and a pack whose frontend
   * sends the wrong thing — or an action, which stamps the action beside its pack — is named in the refusal
   * rather than left to be found by grepping for the event type.
   */
  it.each([
    [{ from: 'memo-pack' }, 'Unknown system: "client-events.missing" sent by "memo-pack"'],
    [{ from: 'memo-pack', via: 'action:Add Memo' }, 'Unknown system: "client-events.missing" sent by "memo-pack" (action:Add Memo)'],
    [{}, 'Unknown system: "client-events.missing"'],
  ])('names the sender in the refusal (%o)', (sender, message) => {
    expect(() => receiveClientEvent(registry, { to: 'client-events.missing', event: { type: 'PING' }, ...sender }))
      .toThrow(new UnknownClientEventError(message));
  });

  it.each([
    [{ to: 'client-events.missing', event: { type: 'PING' } }, 'Unknown system: "client-events.missing"'],
    [{ to: 'host/ping', event: { type: 'PONG' } }, 'Unknown event "PONG" for system "host/ping"'],
  ])('rejects %o, sending and logging nothing', (event, message) => {
    const { incoming, logs } = during(() => {
      expect(() => receiveClientEvent(registry, event)).toThrow(new UnknownClientEventError(message));
    });
    expect(incoming).toEqual([]);
    expect(logs).toEqual([]);
  });
});
