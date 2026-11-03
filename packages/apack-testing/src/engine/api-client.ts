// The drive session's own connection to the running app's API, so a bus verb reaches the API directly instead
// of through the window. A broken window is then just a broken window: `/query` keeps working while the
// renderer's own subscription is dead.
//
// No dependencies, Node having had a global `WebSocket` since 22 and this repo requiring 23 — what is left to
// write is tRPC's frames, which are below.
//
// **The frames, read out of `@trpc/server@11.16.0`'s installed adapter** (`dist/ws-*.mjs`, and
// `parseTRPCMessage`), not from memory — a hand-written protocol is the thing most likely to break on a bump, so
// the version it was read at is recorded here and `api-client.spec.ts` pins each shape:
//
// ```
// → { id, jsonrpc: '2.0', method: 'mutation',          params: { path: 'bus.claim', input: { as } } }
// → { id, jsonrpc: '2.0', method: 'subscription',      params: { path: 'bus.sub' } }
// → { id, jsonrpc: '2.0', method: 'subscription.stop' }                      // no params; cancels by id
// ← { id, jsonrpc, result: { type: 'started' } }                             // advisory, may follow data
// ← { id, jsonrpc, result: { type: 'data', data } }
// ← { id, jsonrpc, result: { type: 'stopped' } }
// ← { id, jsonrpc, error: { message, code, data: { code: 'CONFLICT', … } } }
// ```
//
// Three of those are a mistake away from a bug, so each is named: **success is `'result' in frame`, never
// `result.data`** — `bus.send` and `bus.claim` return nothing, so their success frame is
// `{"result":{"type":"data"}}` with no `data` at all. **`PING`/`PONG` are bare text, not JSON**, and must be
// skipped before parsing. And **an error is followed by `stopped`**, so a channel must not report twice.
//
// **No reconnection, deliberately.** A drive session is one run against one app launch. The socket can only die
// three ways: the app closed, so the session is over; the API crashed and was restarted on a possibly different
// port, so the claim died with the old process and the port we hold is stale; or the subscription itself failed
// while the socket lived. Only the second could be recovered, and doing so would re-fire `CLIENT_CONNECTED` to
// every system in the app. So the channel records why it is finished and every later verb fails saying so,
// which an agent can act on — rather than reconnecting into a session whose claim somebody else now holds.

import { API_HOST } from '@apackdev/sdk/utils/pure';

/** A message on the app's bus, as `bus.sub` delivers it */
export interface BusMessage {
  readonly diagnostics?: { traceparent?: string; tracestate?: string };
  readonly to: string;
  readonly event: { type: string;[key: string]: unknown };
  readonly from?: string;
  readonly via?: string;
  readonly sender?: string;
  readonly client?: string;
  readonly call?: string;
  readonly answering?: string;
}

/* `from`, `via` and `client` are read by nothing here; they are declared because this interface is the wire
 * shape, and a reader comparing it against `Message` should find the same fields. Hand-written on purpose —
 * this module declares almost no dependencies, because it talks to a *running* app that may be a downloaded
 * Beta rather than this checkout — so the agreement is checked by a case
 * (`tests/engine/bus-message-parity.spec.ts`) rather than by the compiler seeing one type.
 *
 * `call` and `answering` travel in both directions and `session.ts` uses both halves: it sets `call` on an ask
 * (`bus.send`'s schema names it) and reads `answering` off the answer (`bus.sub` delivers a backend `reply`
 * with it). `client` is the one field that stays out of a send, being stamped from the connection. */

/** Where the API is and what it accepts. Resolved by the caller, so this module owns no app lifecycle. */
export interface ApiAddress {
  readonly port: number;
  readonly token: string;
  readonly host?: string;
}

export interface ApiClient {
  /** Takes a name on this connection, so a system can be told to answer it. Rejects when another holds it. */
  claim(ref: string): Promise<void>;
  /** Sends to a system. Rejects on a refusal, where the page route used to drop it silently. */
  send(message: { to: string; event: Record<string, unknown>; sender?: string; call?: string }): Promise<void>;
  /** Explicit trusted-tool settings access; ordinary bus sends never borrow this authority. */
  sendSettings: ApiClient['send'];
  /** Every message the subscription delivers; returns the unsubscribe */
  onMessage(listener: (message: BusMessage) => void): () => void;
  /**
   * Told once, with why, when the channel finishes; returns the unsubscribe.
   *
   * `failure` alone is a state with no event, which is a state nothing can await — a reader has to ask again
   * and again, or guess how long to wait. Only future finishes are announced, so a listener that may be late
   * reads `failure` as well; that is what the shared waiter's first attempt does for free.
   */
  onFinished(listener: (reason: string) => void): () => void;
  /** Why the channel is finished, or null while it works. What a timed-out verb quotes instead of guessing. */
  readonly failure: string | null;
  close(): Promise<void>;
}

/** A frame the server sent */
type Frame = {
  id?: number | string | null;
  result?: { type: 'started' | 'data' | 'stopped'; data?: unknown };
  error?: { message?: string; data?: { code?: string } };
};

const SUBSCRIPTION_ID = 0;

/**
 * What a refusal reads as, with the machine-readable code when there is one — **on the error as well as in
 * the text**, because a caller that wants to act on one kind of refusal should not have to match prose.
 * `claim` refusing with `CONFLICT` is the one that has a caller today.
 */
const refusal = (what: string, frame: Frame): Error => Object.assign(
  new Error(`${what}: ${frame.error?.message ?? 'the API refused it'}${frame.error?.data?.code ? ` (${frame.error.data.code})` : ''}`),
  { code: frame.error?.data?.code },
);

/** The code the API refuses a name another live connection holds with */
export const CLAIM_CONFLICT = 'CONFLICT';

/**
 * Opens the connection and sends its subscribe frame, resolving once the socket is open and that frame is away
 * — not once the subscription is live, which has no single answer. A refusal arrives later, through `failure`.
 *
 * Subscribing before returning is what orders it ahead of the claim: a reply addressed to a name on a
 * connection that is not yet listening would be delivered and dropped. The claim's lifetime needs no such
 * care, being released when the connection ends.
 */
export async function connectApiClient({ port, token, host = API_HOST }: ApiAddress): Promise<ApiClient> {
  const url = `ws://${host}:${port}`;
  // Both subprotocols: the server answers `apack` only when it is offered, and refuses without the token one
  const socket = new WebSocket(url, ['apack', `apack-token.${token}`]);

  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; what: string }>();
  const listeners = new Set<(message: BusMessage) => void>();
  const finishListeners = new Set<(reason: string) => void>();
  let nextId = SUBSCRIPTION_ID + 1;
  let failure: string | null = null;

  /** Finishes the channel once, failing whatever was in flight and telling whoever asked to be told */
  const finish = (reason: string): void => {
    if (failure !== null) return;
    failure = reason;
    for (const { reject, what } of pending.values()) reject(new Error(`${what}: ${reason}`));
    pending.clear();
    for (const listener of finishListeners) listener(reason);
    finishListeners.clear();
  };

  /**
   * The keep-alive words, which travel as bare text rather than JSON. Answering is what matters:
   * `handleKeepAlive` schedules `client.terminate()` once it has pinged and clears it on *any* message from us,
   * so a session that only listened would be dropped after `pongWaitMs`. The app sets no `keepAlive` today,
   * which makes this latent — and silent if that ever changes.
   */
  const answeredKeepAlive = (text: string): boolean => {
    if (text === 'PING') {
      socket.send('PONG');
      return true;
    }
    return text === 'PONG';
  };

  /** A frame on the subscription's id: a message for the listeners, or the end of the channel */
  const takeSubscriptionFrame = (frame: Frame): void => {
    if (frame.error) finish(`the app refused the event subscription: ${frame.error.message ?? 'no reason given'}`);
    // An error is followed by `stopped`, so this must not overwrite the reason the error gave
    else if (frame.result?.type === 'stopped') finish('the app ended the event subscription');
    else if (frame.result?.type === 'data') for (const listener of listeners) listener(frame.result.data as BusMessage);
  };

  /** A frame answering one call */
  const takeCallFrame = (id: number, frame: Frame): void => {
    const waiting = pending.get(id);
    if (!waiting) return;
    pending.delete(id);
    // Success is the presence of `result`, never of `result.data`: a procedure returning nothing sends
    // `{ result: { type: 'data' } }` with no data, and reading `data` would wait for ever
    if (frame.error) waiting.reject(refusal(waiting.what, frame));
    else waiting.resolve(frame.result?.data);
  };

  socket.addEventListener('message', (message: MessageEvent) => {
    const text = String(message.data);
    if (answeredKeepAlive(text)) return;

    let frame: Frame;
    try {
      frame = JSON.parse(text) as Frame;
    } catch {
      return;
    }

    // A frame whose id is neither the subscription's nor a number belongs to no caller: `id: null` is how the
    // API announces a reconnect, and matching neither branch is what keeps it out of the pending-call path.
    if (frame.id === SUBSCRIPTION_ID) takeSubscriptionFrame(frame);
    else if (typeof frame.id === 'number') takeCallFrame(frame.id, frame);
  });

  /** Sends a frame that will be answered, and resolves when its answer arrives */
  const callMutation = (path: string, what: string, input: unknown): Promise<unknown> => {
    if (failure !== null) return Promise.reject(new Error(`${what}: ${failure}`));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, what });
      socket.send(JSON.stringify({ id, jsonrpc: '2.0', method: 'mutation', params: { path, input } }));
    });
  };

  /**
   * Sends the subscribe frame and resolves on the send rather than on an answer: `started` is advisory and may
   * arrive after the first data frame, so there is no single answer to wait for. A refusal arrives through
   * `failure`.
   */
  const openSubscription = (): Promise<void> => {
    if (failure !== null) return Promise.reject(new Error(`subscribe: ${failure}`));
    socket.send(JSON.stringify({ id: SUBSCRIPTION_ID, jsonrpc: '2.0', method: 'subscription', params: { path: 'bus.sub' } }));
    return Promise.resolve();
  };

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error(
      `Couldn't reach the app's API at ${url}. The port and token come from the app window, so a failure here means the API restarted on another port or the app is gone.`,
    )), { once: true });
  });

  if (socket.protocol !== 'apack') {
    socket.close();
    throw new Error(`Something answered at ${url} that isn't this app's API: it accepted the connection but spoke "${socket.protocol}" instead of "apack"`);
  }

  socket.addEventListener('close', () => finish('the connection to the app closed'), { once: true });

  await openSubscription();
  let settingsCredential: Promise<string> | undefined;
  const openSettings = (): Promise<string> => settingsCredential ??= callMutation('settings.openHost', 'opening tool settings access', undefined)
    .then(credential => {
      if (typeof credential !== 'string' || !credential) throw new Error('The app returned no settings credential');
      return credential;
    });

  return {
    claim: (ref) => callMutation('bus.claim', `claiming ${ref}`, { as: ref }).then(() => undefined),
    send: (message) => callMutation('bus.send', `sending ${message.event.type} to ${message.to}`, message).then(() => undefined),
    sendSettings: async message => {
      if (message.to !== 'host/settings') throw new Error('Settings access only sends to host/settings');
      const credential = await openSettings();
      await callMutation('bus.send', `sending ${message.event.type} to ${message.to}`, { ...message, settingsCredential: credential });
    },
    onMessage: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onFinished: (listener) => {
      finishListeners.add(listener);
      return () => finishListeners.delete(listener);
    },
    get failure() {
      return failure;
    },
    close: async () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ id: SUBSCRIPTION_ID, jsonrpc: '2.0', method: 'subscription.stop' }));
      }
      finish('the drive session closed the connection');
      await new Promise<void>((resolve) => {
        if (socket.readyState === WebSocket.CLOSED) return resolve();
        socket.addEventListener('close', () => resolve(), { once: true });
        socket.close();
      });
    },
  };
}
