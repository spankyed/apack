import { BrowserWindow, MessageChannelMain, type IpcMainEvent, type MessagePortMain } from 'electron';
import { API_PORT_CHANNELS } from './config.ts';
import { logWarn } from './logger.ts';

/** Structural slice of Electron's `MessagePortMain` that `PortBroker` transfers or closes on failure. */
export interface BrokerMessagePort {
  close(): void;
}

/** Structural slice of Electron's `MessageChannelMain` so unit tests can drive port handoffs without Electron. */
export interface BrokerMessageChannel<P extends BrokerMessagePort = MessagePortMain> {
  readonly port1: P;
  readonly port2: P;
}

/** Structural slice of the API `UtilityProcess` that receives one end of each brokered channel. */
export interface PortBackend<P extends BrokerMessagePort = MessagePortMain> {
  postMessage(message: unknown, transfer?: P[]): void;
}

/** Structural slice of Electron's `WebContents` that receives the window end of a brokered channel. */
export interface PortWebContents<P extends BrokerMessagePort = MessagePortMain> {
  readonly id: number;
  readonly mainFrame?: unknown;
  isDestroyed(): boolean;
  postMessage(channel: string, message: unknown, transfer?: P[]): void;
  send(channel: string, ...args: unknown[]): void;
  once(event: 'destroyed' | 'render-process-gone', listener: () => void): unknown;
}

export interface PortBrokerOptions<P extends BrokerMessagePort = MessagePortMain> {
  /** Creates a paired channel; defaults to Electron's `new MessageChannelMain()`. */
  createChannel?: () => BrokerMessageChannel<P>;
  /**
   * Authorizes an `api:request-port` sender. Defaults to allowing only the top-level main frame of an app
   * `BrowserWindow` (`win.webContents === event.sender`), rejecting subframes and `<WebContentsView>` tabs.
   */
  isAuthorized?: (sender: PortWebContents<P>, senderFrame: unknown) => boolean;
}

function defaultIsAuthorized(sender: PortWebContents<MessagePortMain>, senderFrame: unknown): boolean {
  if (sender.isDestroyed()) return false;
  if (senderFrame !== undefined && sender.mainFrame !== undefined && senderFrame !== sender.mainFrame) {
    return false;
  }
  const win = BrowserWindow.fromWebContents(sender as unknown as Electron.WebContents);
  return win !== null && (win as unknown as { webContents?: unknown }).webContents === sender;
}

/**
 * Brokers direct `MessageChannelMain` pairs between app windows and the API `UtilityProcess`.
 *
 * Main never forwards payload frames: it mints a channel per window, transfers `port1` to the backend and
 * `port2` to the window, and watches backend exits so windows learn immediately when a backend process dies
 * (Chromium's DOM `MessagePort` has no `'close'` event). On backend restart or reload, every live registered
 * window automatically receives a fresh channel with an incremented `generation`.
 */
export class PortBroker<P extends BrokerMessagePort = MessagePortMain> {
  private readonly createChannel: () => BrokerMessageChannel<P>;
  private readonly isAuthorized: (sender: PortWebContents<P>, senderFrame: unknown) => boolean;
  private readonly windows = new Map<number, PortWebContents<P>>();
  private backend?: PortBackend<P>;
  private generation = 0;

  constructor(options: PortBrokerOptions<P> = {}) {
    this.createChannel = options.createChannel ?? (() => new MessageChannelMain() as unknown as BrokerMessageChannel<P>);
    this.isAuthorized = options.isAuthorized ?? (defaultIsAuthorized as unknown as (sender: PortWebContents<P>, senderFrame: unknown) => boolean);
  }

  /** Handles an `ipcMain.on('api:request-port')` event from a window preload. */
  handleRequest(event: Pick<IpcMainEvent, 'sender' | 'senderFrame'>): boolean {
    const sender = event.sender as unknown as PortWebContents<P>;
    if (!this.isAuthorized(sender, event.senderFrame)) {
      logWarn('[MAIN] Rejected unauthorized api:request-port from non-app frame');
      return false;
    }
    return this.requestPort(sender);
  }

  /** Registers an authorized window and hands it a direct backend port immediately if the backend is ready. */
  requestPort(sender: PortWebContents<P>): boolean {
    if (sender.isDestroyed()) return false;
    const isNew = !this.windows.has(sender.id);
    this.windows.set(sender.id, sender);
    if (isNew) {
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        if (this.windows.get(sender.id) !== sender) return;
        this.windows.delete(sender.id);
        this.notifyWindowGone(sender.id);
      };
      sender.once('destroyed', release);
      sender.once('render-process-gone', release);
    }
    if (this.backend) {
      return this.handoff(sender, this.backend, this.generation);
    }
    return true;
  }

  /** Marks the backend ready and hands a fresh channel to every currently registered live window. */
  onBackendReady(backend: PortBackend<P>): number {
    this.backend = backend;
    this.generation += 1;
    const generation = this.generation;
    for (const [id, sender] of Array.from(this.windows)) {
      if (sender.isDestroyed()) {
        this.windows.delete(id);
        continue;
      }
      this.handoff(sender, backend, generation);
    }
    return generation;
  }

  /**
   * Notifies every live registered window that the current backend process is gone.
   *
   * Idempotent for a given backend lifecycle: calling it from both `stop()` (reload/quit) and `exit` only
   * notifies windows once.
   */
  onBackendStopped(): void {
    if (!this.backend) return;
    const closedGeneration = this.generation;
    this.backend = undefined;
    for (const [id, sender] of Array.from(this.windows)) {
      if (sender.isDestroyed()) {
        this.windows.delete(id);
        continue;
      }
      try {
        sender.send(API_PORT_CHANNELS.CLOSED, { generation: closedGeneration });
      } catch {
        this.windows.delete(id);
      }
    }
  }

  /** Current backend generation (0 before the first ready backend). */
  getGeneration(): number {
    return this.generation;
  }

  /** Number of live registered windows currently tracked by this broker. */
  windowCount(): number {
    return this.windows.size;
  }

  private notifyWindowGone(windowId: number): void {
    if (!this.backend) return;
    try {
      this.backend.postMessage({ type: 'window-gone', windowId });
    } catch (error) {
      logWarn('[MAIN] Failed to notify backend of window teardown:', error);
    }
  }

  private handoff(sender: PortWebContents<P>, backend: PortBackend<P>, generation: number): boolean {
    const { port1, port2 } = this.createChannel();
    let backendReceived = false;
    try {
      backend.postMessage({ type: 'window-port', windowId: sender.id, generation }, [port1]);
      backendReceived = true;
      sender.postMessage(API_PORT_CHANNELS.PORT, { generation }, [port2]);
      return true;
    } catch (error) {
      logWarn('[MAIN] Failed to transfer MessageChannelMain pair between backend and window:', error);
      if (!backendReceived) {
        try { port1.close(); } catch { /* already closed */ }
      }
      try { port2.close(); } catch { /* already closed */ }
      if (sender.isDestroyed()) this.windows.delete(sender.id);
      return false;
    }
  }
}
