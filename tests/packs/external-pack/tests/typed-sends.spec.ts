// The fixture sends to its own system by feature id and to its dependency's (default-setup) as
// default-setup/<feature>, both through the sendToSystem its #generated/events types with every system's
// events. Surfaces are named the same way, so `nextEmit` takes this pack's own by feature id and a
// dependency's as default-setup/<feature>, and reports the id the surface runs under.
import { describe, expect, it } from 'vitest';
import { startApp } from '@apackdev/testing/harness';
import { broadcastToSurface, sendToSystem } from '#generated/events.ts';

describe('typed sends to systems', () => {
  it("reaches default-setup's library system", async () => {
    const app = await startApp({ systems: ['default-setup/library'] });
    await app.connect();
    const root = app.watchView<{ onDisk: false; contents: { items: Array<{ name: string }> } }>('default-setup/library', 'folder', { folderId: null });
    await root.next();

    sendToSystem('default-setup/library', { type: 'CREATE_COLLECTION', name: 'Typed' });

    const update = await root.next();
    expect(update.ok && update.value.contents.items.map((item) => item.name)).toContain('Typed');
  });

  // A dependency's *internal* events are not ours to send: they are what that system's own children send it
  // (`ADD_LOG` comes from the logs system's `onLog` callback), so its contract puts them in `internal` and they
  // never reach `PackSystemEvents`. Nothing runs here — the assertion is that this does not compile.
  it("cannot send a default-setup system's internal event", () => {
    const send = () => {
      // @ts-expect-error ADD_LOG is internal to default-setup/logs, so a dependent may not send it
      sendToSystem('default-setup/logs', { type: 'ADD_LOG', log: { level: 'info', message: 'nope' } });
    };
    expect(typeof send).toBe('function');
  });

  it('reaches its own system by feature id', async () => {
    const app = await startApp({ systems: ['memos'] });
    await app.connect();

    sendToSystem('memos', { type: 'ADD_MEMO', text: 'typed' });

    expect(await app.nextEmit('memos', 'MEMO_ADDED')).toMatchObject({ memo: { text: 'typed' } });
  });

  // The name `emit` takes for a dependency's surface is the one the send resolves: it arrives at that
  // pack's address, not at one in this pack's namespace
  it("reaches a dependency's surface named <dependency>/<feature>", async () => {
    const app = await startApp({ systems: ['memos'] });
    await app.connect();

    sendToSystem('memos', { type: 'ANNOUNCE_MEMO', text: 'hello' });

    expect(await app.nextEmit('default-setup/logs', 'LOG_ADDED'))
      .toMatchObject({ type: 'LOG_ADDED', log: { message: 'hello', source: 'memos' } });
  });

  // A dependency's surface publishes only the `public` half of its contract. Its `pack` half is what default-setup's
  // own features send each other, and nothing here can send it — this is the only place that split is exercised
  // from outside the pack that declared it.
  it("sends a dependency's surface what it publishes, and nothing it keeps to its own pack", () => {
    const sends = () => {
      // `public`: any pack may add a line to the app's log
      broadcastToSurface('default-setup/logs', { type: 'LOG_ADDED', log: { id: '1', timestamp: 0, level: 'info', source: 'memos', message: 'hi' } });
      // @ts-expect-error `pack`: opening a note is default-setup's own features' to ask for, not a dependent's
      broadcastToSurface('default-setup/notes', { type: 'NOTE.OPEN', noteId: 'Note-1' });
      // @ts-expect-error `pack`: so is writing the code surface's state
      broadcastToSurface('default-setup/code', { type: 'UPDATE_STATE', updates: { baseDirectory: '/tmp' } });
      // @ts-expect-error and so is opening one of its terminals
      broadcastToSurface('default-setup/code', { type: 'terminal.CREATE', target: 'x', command: 'ls' });
    };
    expect(sends).toBeTypeOf('function');
  });

  it('rejects a wrong send at compile time', () => {
    // Never called: tsc checks these lines when it runs over the pack's tests
    const wrongSends = () => {
      // @ts-expect-error the library system doesn't receive memo events
      sendToSystem('default-setup/library', { type: 'ADD_MEMO', text: 'x' });
      // @ts-expect-error a dependency's system is named <dependency>/<feature>
      sendToSystem('library', { type: 'CREATE_COLLECTION', name: 'x' });
      // @ts-expect-error ADD_MEMO needs its text
      sendToSystem('memos', { type: 'ADD_MEMO' });
      // @ts-expect-error pack code names its own features by feature id; `<pack>/<feature>` is for another pack
      sendToSystem('e2e-fixture/memos', { type: 'ADD_MEMO', text: 'x' });
    };
    expect(wrongSends).toBeTypeOf('function');
  });
});
