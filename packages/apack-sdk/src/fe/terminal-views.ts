import { boundFeHost } from '../runtime/fe-host.ts';

/**
 * A connection to the terminal broker, as a view: a stream of bytes each way.
 *
 * **Bytes, because what crosses it is not the app's to read.** A terminal a person looks at is drawn from
 * rows its broker sends, many times a second, and a window sends its keys back; none of that is an event
 * for a system to route or a view for the backend to compute. So a window is handed the connection itself
 * and the broker's own view protocol runs over it — the API process is not on the path at all.
 *
 * One connection carries every session a window draws. Which session, and everything else the bytes mean,
 * is the protocol's (`apack-terminal-view`'s `BrokerViews` speaks it); this is only how they travel.
 */
export interface TerminalViewStream {
  send(bytes: Uint8Array): void;
  /** Bytes as they arrive, in pieces of any size. The returned function stops them */
  onData(listener: (chunk: Uint8Array) => void): () => void;
  /** The connection is over and nothing more will arrive: the broker went, or `close` was called */
  onClose(listener: () => void): () => void;
  close(): void;
}

/**
 * Opens a connection to a terminal broker, as a view: this app's own, or the one `target` names — the
 * `target` a `TerminalSession` on another machine carries.
 *
 * A session is named on it by the id its `TerminalSession` carries. Where there is no broker to reach — a
 * build without one, a test that bound none — the stream it answers with closes at once, which a view
 * reads as its session having ended.
 */
export function terminalViews(target?: string): TerminalViewStream {
  return boundFeHost().terminalViews?.(target) ?? noBroker();
}

/** A connection that is over as soon as anyone listens for it to be */
function noBroker(): TerminalViewStream {
  return {
    send: () => {},
    onData: () => () => {},
    onClose: (listener) => {
      queueMicrotask(listener);
      return () => {};
    },
    close: () => {},
  };
}
