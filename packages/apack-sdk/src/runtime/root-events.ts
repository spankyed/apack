import { boundHost } from './host-runtime.ts';
import type { LogEvent } from '../logger/index.ts';
import type { Message } from '../events/index.ts';

/**
 * The backend's root event bus. Public because `HostRuntime.transport` names it: the program that
 * assembles an app implements this to bind one.
 */
export interface RootEvents {
  emitLog(event: LogEvent): void;
  onLog(callback: (event: LogEvent) => void): () => void;
  onConnected(callback: () => void): () => void;
  /**
   * A client's connection ended, whatever ended it.
   *
   * **The counterpart `onConnected` never had, and the reason state keyed by a connection used to outlive
   * it.** The transport has always known — the WebSocket adapter aborts a per-connection signal from
   * `client.once('close')` — but nothing published it, so each holder of per-connection state arranged its
   * own listener and whoever forgot simply leaked. A terminal's grid is what forgot.
   *
   * It carries the client, which is what a holder keys by. That is a connection's id and not a window's:
   * a reconnect is a new connection, so this fires for the one that went and the window that comes back is
   * a different id — which is the whole of why remembering one is only safe with this.
   */
  onConnectionEnded(callback: (client: string) => void): () => void;
  emitConnectionEnded(client: string): void;
  /** A client loaded a pack's frontend and is ready for its systems' startup data */
  onPackClientConnected(callback: (packId: string) => void): () => void;
  /** A message for a backend system, which the bus routes */
  emitIncoming(message: Message): void;
  onIncoming(callback: (message: Message) => void): () => void;
  /** A message for a frontend surface sent outside a system (`broadcastToSurface`), which the bus delivers while a client is connected */
  emitSurfaceSend(message: Message): void;
  onSurfaceSend(callback: (message: Message) => void): () => void;
  /** A message the clients receive */
  emitOutgoing(message: Message): void;
  onOutgoing(callback: (message: Message) => void): () => void;
}

const bus = () => boundHost().transport.rootEvents;

/**
 * The bound app's root event bus. Each call goes to the bound bus's own method (not through a Proxy, which
 * would break an EventEmitter's listener bookkeeping); it throws, naming bindHost, when no app is bound.
 * @internal
 */
export const _rootEvents: RootEvents = {
  emitLog: (event) => bus().emitLog(event),
  onLog: (callback) => bus().onLog(callback),
  onConnected: (callback) => bus().onConnected(callback),
  onConnectionEnded: (callback) => bus().onConnectionEnded(callback),
  emitConnectionEnded: (client) => bus().emitConnectionEnded(client),
  onPackClientConnected: (callback) => bus().onPackClientConnected(callback),
  emitIncoming: (event) => bus().emitIncoming(event),
  onIncoming: (callback) => bus().onIncoming(callback),
  emitSurfaceSend: (event) => bus().emitSurfaceSend(event),
  onSurfaceSend: (callback) => bus().onSurfaceSend(callback),
  emitOutgoing: (event) => bus().emitOutgoing(event),
  onOutgoing: (callback) => bus().onOutgoing(callback),
};
