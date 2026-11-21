// What a connection is sent within one turn leaves as one frame, and a client gets the same messages back.
import { describe, expect, it } from 'vitest';
import { FRAME_SEPARATOR, gatherSends, splitFrame, type FramedSocket } from '../src/wire-frames.ts';

/** A socket that records what was put on the wire, and a turn that comes when the spec says so. */
function wired() {
  const frames: unknown[][] = [];
  const socket: FramedSocket & { readyState: number } = { readyState: 1, send: (...sent: unknown[]) => { frames.push(sent); } };
  const turns: Array<() => void> = [];
  const { flush } = gatherSends(socket, (run) => { turns.push(run); });
  /** Everything a client reading these frames would be handed, in order */
  const received = (): string[] => frames.flatMap(([data]) => splitFrame(data as string));
  return { socket, frames, flush, received, nextTurn: () => { for (const run of turns.splice(0)) run(); }, turnsWaiting: () => turns.length };
}

const message = (id: number, extra: object = {}): string => JSON.stringify({ id, jsonrpc: '2.0', result: { type: 'data', data: { to: 'default/code', event: { type: 'search.RESULT', ...extra } } } });

describe('frames on the API socket', () => {
  it('sends what one turn produced as one frame, which a client reads back as the same messages in order', () => {
    const wire = wired();
    const sent = [message(1), message(2), message(3)];
    for (const each of sent) wire.socket.send(each);

    expect(wire.frames).toEqual([]);
    wire.nextTurn();

    expect(wire.frames).toHaveLength(1);
    expect(wire.received()).toEqual(sent);
  });

  it('sends a message that was alone in its turn exactly as it was given', () => {
    const wire = wired();
    wire.socket.send(message(1));
    wire.nextTurn();

    expect(wire.frames).toEqual([[message(1)]]);
  });

  it('starts a new frame for the next turn', () => {
    const wire = wired();
    wire.socket.send(message(1));
    wire.socket.send(message(2));
    wire.nextTurn();
    wire.socket.send(message(3));
    wire.nextTurn();

    expect(wire.frames.map(([data]) => splitFrame(data as string))).toEqual([[message(1), message(2)], [message(3)]]);
  });

  it('asks for one turn however many messages it gathers', () => {
    const wire = wired();
    for (let id = 0; id < 500; id++) wire.socket.send(message(id));

    expect(wire.turnsWaiting()).toBe(1);
  });

  it('keeps a message whole when its text holds the separator, since JSON writes that as an escape', () => {
    const wire = wired();
    const awkward = message(1, { lineText: `before${FRAME_SEPARATOR}after` });
    wire.socket.send(awkward);
    wire.socket.send(message(2));
    wire.nextTurn();

    expect(wire.received()).toEqual([awkward, message(2)]);
    expect(JSON.parse(wire.received()[0]!).result.data.event.lineText).toBe(`before${FRAME_SEPARATOR}after`);
  });

  it('sends a keep-alive word bare and at once, after what was gathered before it', () => {
    const wire = wired();
    wire.socket.send(message(1));
    wire.socket.send('PING');
    wire.socket.send(message(2));

    expect(wire.frames).toEqual([[message(1)], ['PING']]);
    wire.nextTurn();
    expect(wire.frames).toEqual([[message(1)], ['PING'], [message(2)]]);
  });

  it('passes a send that carries a callback straight through, with what it carried', () => {
    const wire = wired();
    const done = (): void => {};
    wire.socket.send(message(1), done);

    expect(wire.frames).toEqual([[message(1), done]]);
  });

  it('flushes on demand, for a process about to exit, and then has nothing left for the turn', () => {
    const wire = wired();
    wire.socket.send(message(1));
    wire.socket.send(message(2));
    wire.flush();

    expect(wire.received()).toEqual([message(1), message(2)]);
    wire.nextTurn();
    expect(wire.frames).toHaveLength(1);
  });

  it('drops what was gathered for a socket that closed before the turn', () => {
    const wire = wired();
    wire.socket.send(message(1));
    wire.socket.readyState = 3;
    wire.nextTurn();

    expect(wire.frames).toEqual([]);
  });

  it('reads a frame that holds one message as that message', () => {
    expect(splitFrame(message(7))).toEqual([message(7)]);
    expect(splitFrame('PONG')).toEqual(['PONG']);
  });
});
