// How the API's WebSocket carries several messages in one frame, and how a client takes them apart.
//
// **What this is for.** A backend that streams (search results off a process, a reply token by token) sends one
// message per item, and each used to be a WebSocket frame of its own and a task of its own in the window: a
// burst of two hundred results was two hundred frames, two hundred tasks and two hundred renders. Gathered, the
// burst is one frame, handled in one task, drawn once.
//
// **Where it sits, and why there.** At the socket, under tRPC, on both ends. Every subscription on a connection
// shares the socket, so gathering here keeps the order in which messages were sent across all of them. Gathering
// inside one subscription would let a message it held be overtaken by another subscription's.
//
// **What is gathered** is what is sent within one turn of the event loop. Nothing waits on a clock: a message sent
// alone leaves on the next turn, unchanged and unwrapped.

/**
 * What stands between two messages in one frame: the record separator. A message is JSON, and JSON writes every
 * control character inside a string as an escape, so this character never occurs in one and nothing has to be
 * parsed to find where a message ends.
 */
export const FRAME_SEPARATOR = '\x1e';

/** The messages a frame carries, in the order they were sent. A frame holding one message is that message. */
export function splitFrame(data: string): string[] {
  return data.includes(FRAME_SEPARATOR) ? data.split(FRAME_SEPARATOR) : [data];
}

/** The part of a socket the gathering needs: `ws`'s on the server, and a fake's in a spec. */
export interface FramedSocket {
  /** 1 while the socket is open, as `WebSocket.OPEN` is */
  readonly readyState: number;
  send(data: string, ...rest: unknown[]): void;
}

const OPEN = 1;

/**
 * Makes a socket send what it is given within one turn as one frame.
 *
 * It replaces the socket's `send`, since the sender is tRPC's adapter and holds only the socket. A send that is
 * not a plain text message goes out at once, after whatever was gathered so the order holds: the keep-alive words
 * travel bare and are matched whole by the other end, and a send with a callback or options means the caller wants
 * that send itself.
 *
 * Returns `flush`, for a caller about to end the process: what was gathered leaves now rather than on a turn that
 * will not come.
 */
export function gatherSends(socket: FramedSocket, later: (run: () => void) => void): { flush(): void } {
  const send = socket.send.bind(socket);
  let gathered: string[] = [];
  let due = false;

  const flush = (): void => {
    due = false;
    if (!gathered.length) return;
    const frame = gathered.length === 1 ? gathered[0]! : gathered.join(FRAME_SEPARATOR);
    gathered = [];
    // The socket can close between the send and the turn it leaves on. What was for it has nowhere to go.
    if (socket.readyState === OPEN) send(frame);
  };

  socket.send = (data: string, ...rest: unknown[]): void => {
    if (typeof data !== 'string' || rest.length || data === 'PING' || data === 'PONG') {
      flush();
      send(data, ...rest);
      return;
    }
    gathered.push(data);
    if (!due) { due = true; later(flush); }
  };

  return { flush };
}
