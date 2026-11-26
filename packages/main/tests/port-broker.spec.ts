import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it } from 'vitest';
import { BrowserWindow, resetElectronStub } from './electron-stub.ts';
import { API_PORT_CHANNELS } from '../src/modules/api-server/config.ts';
import {
  PortBroker,
  type BrokerMessageChannel,
  type BrokerMessagePort,
  type PortBackend,
  type PortWebContents,
} from '../src/modules/api-server/port-broker.ts';

interface FakePort extends BrokerMessagePort {
  readonly label: string;
  closed: boolean;
}

function fakeChannelFactory() {
  let seq = 0;
  const created: BrokerMessageChannel<FakePort>[] = [];
  const createChannel = (): BrokerMessageChannel<FakePort> => {
    seq += 1;
    const port1: FakePort = { label: `c${seq}:backend`, closed: false, close() { this.closed = true; } };
    const port2: FakePort = { label: `c${seq}:window`, closed: false, close() { this.closed = true; } };
    const pair = { port1, port2 };
    created.push(pair);
    return pair;
  };
  return { createChannel, created };
}

function fakeBackend() {
  const posted: Array<{ message: unknown; transfer?: FakePort[] }> = [];
  let shouldThrow = false;
  const backend: PortBackend<FakePort> = {
    postMessage(message, transfer) {
      if (shouldThrow) throw new Error('backend dead');
      posted.push({ message, transfer });
    },
  };
  return {
    backend,
    posted,
    failNext(fail = true) { shouldThrow = fail; },
  };
}

function fakeWindow(id: number) {
  const emitter = new EventEmitter();
  const mainFrame = { frameId: id * 100 };
  let destroyed = false;
  let shouldThrowOnPost = false;
  const posted: Array<{ channel: string; message: unknown; transfer?: FakePort[] }> = [];
  const sent: Array<{ channel: string; args: unknown[] }> = [];

  const contents: PortWebContents<FakePort> = {
    id,
    mainFrame,
    isDestroyed: () => destroyed,
    postMessage(channel, message, transfer) {
      if (shouldThrowOnPost) throw new Error('window gone');
      posted.push({ channel, message, transfer });
    },
    send(channel, ...args) {
      sent.push({ channel, args });
    },
    once(event, listener) {
      emitter.once(event, listener);
      return contents;
    },
  };

  return {
    contents,
    mainFrame,
    posted,
    sent,
    listenerCount: (event: string) => emitter.listenerCount(event),
    destroy() {
      destroyed = true;
      emitter.emit('destroyed');
    },
    crashRenderer() {
      emitter.emit('render-process-gone');
    },
    failPost(fail = true) { shouldThrowOnPost = fail; },
  };
}

describe('PortBroker', () => {
  beforeEach(() => {
    resetElectronStub();
  });

  it('authorizes only the top-level main frame of an app BrowserWindow', () => {
    const { createChannel } = fakeChannelFactory();
    const broker = new PortBroker<FakePort>({ createChannel });
    const appWin = fakeWindow(1);
    const otherContents = fakeWindow(2);

    // No BrowserWindow owns sender → rejected
    BrowserWindow.current = null;
    expect(broker.handleRequest({ sender: appWin.contents as never, senderFrame: appWin.mainFrame as never })).toBe(false);
    expect(broker.windowCount()).toBe(0);

    // Owning BrowserWindow has a different webContents (e.g. a child WebContentsView browser tab) → rejected
    BrowserWindow.current = { webContents: otherContents.contents };
    expect(broker.handleRequest({ sender: appWin.contents as never, senderFrame: appWin.mainFrame as never })).toBe(false);
    expect(broker.windowCount()).toBe(0);

    // Matching BrowserWindow, but request came from a subframe → rejected
    BrowserWindow.current = { webContents: appWin.contents };
    expect(broker.handleRequest({ sender: appWin.contents as never, senderFrame: { frameId: 999 } as never })).toBe(false);
    expect(broker.windowCount()).toBe(0);

    // Matching BrowserWindow and mainFrame → accepted
    expect(broker.handleRequest({ sender: appWin.contents as never, senderFrame: appWin.mainFrame as never })).toBe(true);
    expect(broker.windowCount()).toBe(1);
  });

  it('queues window requests until backend is ready, hands off fresh channels on restart, and notifies on exit', () => {
    const { createChannel, created } = fakeChannelFactory();
    const broker = new PortBroker<FakePort>({ createChannel, isAuthorized: () => true });
    const w1 = fakeWindow(10);
    const w2 = fakeWindow(20);
    const be1 = fakeBackend();
    const be2 = fakeBackend();

    // Request before backend is ready: registered, no channel minted yet
    expect(broker.requestPort(w1.contents)).toBe(true);
    expect(created).toHaveLength(0);
    expect(broker.getGeneration()).toBe(0);

    // Backend 1 becomes ready: generation 1 channel handed to w1
    expect(broker.onBackendReady(be1.backend)).toBe(1);
    expect(be1.posted).toEqual([
      { message: { type: 'window-port', windowId: 10, generation: 1 }, transfer: [created[0]!.port1] },
    ]);
    expect(w1.posted).toEqual([
      { channel: API_PORT_CHANNELS.PORT, message: { generation: 1 }, transfer: [created[0]!.port2] },
    ]);

    // Window 2 connects while backend 1 is already ready: immediate handoff at generation 1
    expect(broker.requestPort(w2.contents)).toBe(true);
    expect(be1.posted).toHaveLength(2);
    expect(w2.posted).toEqual([
      { channel: API_PORT_CHANNELS.PORT, message: { generation: 1 }, transfer: [created[1]!.port2] },
    ]);

    // Backend 1 dies: both windows notified once (duplicate onBackendStopped is idempotent)
    broker.onBackendStopped();
    broker.onBackendStopped();
    expect(w1.sent).toEqual([{ channel: API_PORT_CHANNELS.CLOSED, args: [{ generation: 1 }] }]);
    expect(w2.sent).toEqual([{ channel: API_PORT_CHANNELS.CLOSED, args: [{ generation: 1 }] }]);

    // Window 2 closes while backend is down; backend 2 starts → only w1 gets generation 2
    w2.destroy();
    expect(broker.windowCount()).toBe(1);
    expect(broker.onBackendReady(be2.backend)).toBe(2);
    expect(be2.posted).toEqual([
      { message: { type: 'window-port', windowId: 10, generation: 2 }, transfer: [created[2]!.port1] },
    ]);
    expect(w1.posted).toHaveLength(2);
    expect(w1.posted[1]).toEqual({
      channel: API_PORT_CHANNELS.PORT,
      message: { generation: 2 },
      transfer: [created[2]!.port2],
    });
    expect(w2.posted).toHaveLength(1);
  });

  it('re-issues a channel on soft reload without stacking lifecycle listeners and drops crashed renderers', () => {
    const { createChannel, created } = fakeChannelFactory();
    const broker = new PortBroker<FakePort>({ createChannel, isAuthorized: () => true });
    const win = fakeWindow(7);
    const be = fakeBackend();
    broker.onBackendReady(be.backend);

    expect(broker.requestPort(win.contents)).toBe(true);
    expect(broker.requestPort(win.contents)).toBe(true);
    expect(win.listenerCount('destroyed')).toBe(1);
    expect(win.listenerCount('render-process-gone')).toBe(1);
    expect(created).toHaveLength(2);

    win.crashRenderer();
    expect(broker.windowCount()).toBe(0);
  });

  it('closes untransferred ports when either side fails during handoff', () => {
    const { createChannel, created } = fakeChannelFactory();
    const broker = new PortBroker<FakePort>({ createChannel, isAuthorized: () => true });
    const win = fakeWindow(3);
    const be = fakeBackend();
    broker.onBackendReady(be.backend);

    // Backend throws before accepting port1 → both ports closed
    be.failNext(true);
    expect(broker.requestPort(win.contents)).toBe(false);
    expect(created[0]!.port1.closed).toBe(true);
    expect(created[0]!.port2.closed).toBe(true);

    // Backend accepts port1, window throws on port2 → only port2 closed by main
    be.failNext(false);
    win.failPost(true);
    expect(broker.requestPort(win.contents)).toBe(false);
    expect(created[1]!.port1.closed).toBe(false);
    expect(created[1]!.port2.closed).toBe(true);
  });
});
