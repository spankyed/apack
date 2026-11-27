/**
 * Single-port renderer transport over Electron's brokered `MessagePort` (`window.electronAPI.backendPort`).
 *
 * Multiplexes `@apackdev/link` (`mux.link`) and the off-bus Host Control RPC lane (`mux.control`) onto
 * one `MessagePort` per backend generation. Eagerly requests the window port on module load so pre-shell
 * calls (such as `startStartupRecording` in `main.ts`) await the first port cleanly, and notifies the shell
 * whenever the backend restarts or reloads with a fresh port generation.
 */
import {
  dial,
  join,
  type Following,
  type Link,
  type Outcome,
  type Port,
} from '@apackdev/link';
import {
  createHostControlClient,
  type HostControlContract,
} from '@apackdev/host/transport/control-contract';
import {
  BUS_LINK_TARGET,
  BUS_SEND_ASK,
  decodeBusEnvelope,
  decodeDiagnosticCause,
  encodeBusSendPayload,
  encodeDiagnosticSending,
} from '@apackdev/host/transport/link-protocol';
import {
  ControlRpcError,
  muxTransport,
  type ControlCallOptions,
  type ControlClient,
  type ControlSubscribeOptions,
  type ControlSubscriptionHandle,
  type ControlSubscriptionHandlers,
  type MuxedTransport,
} from '@apackdev/host/transport/mux';
import type { Message } from '@apackdev/sdk/events';
import type { _BackendPortTransport, _HostBridge } from '@apackdev/sdk/fe';
import type { ViewUpdate } from '@apackdev/sdk/framework';
import type { PerformanceCarrier } from '@apackdev/sdk/runtime';

interface TransportSession {
  readonly generation: number;
  readonly mux: MuxedTransport;
  readonly control: ControlClient<HostControlContract>;
  readonly link: Link;
  readonly remote: Port;
  closed: boolean;
}

interface SessionWaiter {
  readonly resolve: (session: TransportSession) => void;
  readonly reject: (error: Error) => void;
}

export interface TransportSubscriber {
  onConnected(): void;
  onDisconnected(): void;
  onMessage(message: Message): void;
}

export interface LinkAskOptions {
  readonly signal?: AbortSignal;
  readonly diagnostics?: PerformanceCarrier;
  readonly heard?: (update: unknown) => void;
}

type ControlRequests = HostControlContract['requests'];
type ControlSubscriptions = HostControlContract['subscriptions'];

type ApiStatusBridge = Pick<NonNullable<_HostBridge['apiStatus']>, 'getStatus' | 'onEvent'>;
type TransportBridge = {
  readonly backendPort?: _HostBridge['backendPort'];
  readonly apiStatus?: ApiStatusBridge;
};

function apiFailureMessage(event: {
  readonly type: string;
  readonly error?: unknown;
  readonly message?: string;
  readonly source?: string;
}): string {
  if (event.type === 'api:fatal') {
    if (event.message) return `[${event.source ?? 'api'}] ${event.message}`;
    return 'Backend process encountered a fatal error.';
  }
  const error = event.error as { message?: string } | string | undefined;
  if (typeof error === 'string' && error.length > 0) return error;
  if (typeof error === 'object' && error !== null && typeof error.message === 'string' && error.message.length > 0) {
    return error.message;
  }
  return 'The backend process stopped unexpectedly.';
}

export function createWindowTransport(
  getBridge: () => TransportBridge | undefined = () =>
    typeof window !== 'undefined' ? (window.electronAPI as _HostBridge | undefined) : undefined,
) {
  let activeSession: TransportSession | undefined;
  let bridgeAttached = false;
  let statusAttached = false;
  let permanentFailure: Error | undefined;
  const subscribers = new Set<TransportSubscriber>();
  const sessionWaiters = new Set<SessionWaiter>();

  function failPendingWaiters(error: Error): void {
    permanentFailure = error;
    for (const waiter of Array.from(sessionWaiters)) {
      sessionWaiters.delete(waiter);
      waiter.reject(error);
    }
  }

  function teardownSession(session: TransportSession, notifyDisconnect: boolean): void {
    if (session.closed) return;
    session.closed = true;
    if (activeSession === session) {
      activeSession = undefined;
    }
    try { session.control.dispose(); } catch { /* best-effort teardown */ }
    try { session.link.close(); } catch { /* best-effort teardown */ }
    try { session.mux.close(); } catch { /* best-effort teardown */ }
    if (notifyDisconnect) {
      for (const sub of Array.from(subscribers)) {
        try { sub.onDisconnected(); } catch (error) { console.error('[transport] onDisconnected failed:', error); }
      }
    }
  }

  function attachPort(raw: _BackendPortTransport, generation: number): void {
    permanentFailure = undefined;
    const previous = activeSession;
    if (previous) {
      teardownSession(previous, true);
    }

    const mux = muxTransport(raw);
    const control = createHostControlClient(mux.control);
    const link = dial(mux.link, {
      thrown: (error) => {
        console.error('[transport] Link error:', error);
      },
    });

    const localPort: Port = {
      tell: (to, payload, how) => {
        const diagnostics = decodeDiagnosticCause(how?.cause);
        const message = decodeBusEnvelope(to, payload, diagnostics);
        if (!message) return;
        for (const sub of Array.from(subscribers)) {
          try { sub.onMessage(message); } catch (error) { console.error('[transport] onMessage failed:', error); }
        }
      },
      ask: (_to, _name, _args, _heard, ended) => {
        ended({ ok: false, failure: { kind: 'unavailable', message: 'Renderer does not answer backend asks' } });
        return () => {};
      },
      follow: (_feature, _view, _args, _shown, over) => {
        over({ kind: 'unavailable', message: 'Renderer does not serve backend views' });
        return { stop: () => {} };
      },
    };

    const remote = join(link, localPort, {
      thrown: (error) => {
        console.error('[transport] Peer callback error:', error);
      },
    });

    const session: TransportSession = { generation, mux, control, link, remote, closed: false };
    activeSession = session;

    const onClosed = (): void => {
      teardownSession(session, true);
    };
    raw.onClose(onClosed);
    link.onEnd(onClosed);

    for (const waiter of Array.from(sessionWaiters)) {
      sessionWaiters.delete(waiter);
      waiter.resolve(session);
    }
    for (const sub of Array.from(subscribers)) {
      try { sub.onConnected(); } catch (error) { console.error('[transport] onConnected failed:', error); }
    }
  }

  function ensureBridgeConnected(): void {
    const bridge = getBridge();
    if (!bridge) return;

    if (!statusAttached && bridge.apiStatus) {
      statusAttached = true;
      bridge.apiStatus.onEvent((event: {
        type: string;
        restarting?: boolean;
        error?: unknown;
        message?: string;
        source?: string;
      }) => {
        if (event.type === 'api:started' || event.type === 'api:restarting') {
          permanentFailure = undefined;
          return;
        }
        if (event.type === 'api:stopped' && event.restarting) return;
        if (event.type === 'api:fatal' || event.type === 'api:stopped' || event.type === 'api:error') {
          failPendingWaiters(new Error(apiFailureMessage(event)));
        }
      });
      void bridge.apiStatus.getStatus().then((status) => {
        if (activeSession && !activeSession.closed) return;
        if (status.error && !status.running && status.restartAttempts >= 3) {
          const msg = typeof status.error === 'string'
            ? status.error
            : status.error.message || 'The backend process stopped unexpectedly.';
          failPendingWaiters(new Error(msg));
        }
      }).catch(() => {});
    }

    if (!bridgeAttached && bridge.backendPort) {
      bridgeAttached = true;
      bridge.backendPort.connect((raw, info) => {
        attachPort(raw, info.generation);
      });
    }
  }

  function waitForSession(signal?: AbortSignal): Promise<TransportSession> {
    ensureBridgeConnected();
    if (activeSession && !activeSession.closed) {
      return Promise.resolve(activeSession);
    }
    if (permanentFailure) {
      return Promise.reject(permanentFailure);
    }
    if (signal?.aborted) {
      return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }
    return new Promise<TransportSession>((resolve, reject) => {
      const waiter: SessionWaiter = {
        resolve: (session) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(session);
        },
        reject: (error) => {
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        },
      };
      const onAbort = (): void => {
        sessionWaiters.delete(waiter);
        reject(signal!.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      sessionWaiters.add(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  const transport = {
    /** Subscribes to window transport session lifecycle and incoming bus messages. */
    subscribe(subscriber: TransportSubscriber): () => void {
      ensureBridgeConnected();
      subscribers.add(subscriber);
      if (activeSession && !activeSession.closed) {
        queueMicrotask(() => {
          if (subscribers.has(subscriber) && activeSession && !activeSession.closed) {
            subscriber.onConnected();
          }
        });
      }
      return () => {
        subscribers.delete(subscriber);
      };
    },

    /** Calls a Host Control RPC method over `mux.control`, waiting for the initial port if still booting. */
    async controlCall<M extends keyof ControlRequests & string>(
      method: M,
      ...args: [ControlRequests[M]['input']] extends [void]
        ? [input?: ControlRequests[M]['input'], options?: ControlCallOptions]
        : [input: ControlRequests[M]['input'], options?: ControlCallOptions]
    ): Promise<ControlRequests[M]['output']> {
      const [input, options] = args as [ControlRequests[M]['input'], ControlCallOptions | undefined];
      const session = await waitForSession(options?.signal);
      return await (session.control.call as (
        m: string,
        i: unknown,
        o?: ControlCallOptions,
      ) => Promise<ControlRequests[M]['output']>)(method, input, options);
    },

    /** Calls a Host Control RPC method only when an open session already exists; returns `undefined` without waiting otherwise. */
    tryControlCall<M extends keyof ControlRequests & string>(
      method: M,
      ...args: [ControlRequests[M]['input']] extends [void]
        ? [input?: ControlRequests[M]['input'], options?: ControlCallOptions]
        : [input: ControlRequests[M]['input'], options?: ControlCallOptions]
    ): Promise<ControlRequests[M]['output'] | undefined> {
      const session = activeSession;
      if (!session || session.closed) return Promise.resolve(undefined);
      const [input, options] = args as [ControlRequests[M]['input'], ControlCallOptions | undefined];
      return (session.control.call as (
        m: string,
        i: unknown,
        o?: ControlCallOptions,
      ) => Promise<ControlRequests[M]['output']>)(method, input, options);
    },

    /** Opens a Host Control RPC subscription on the active `mux.control` lane. */
    controlSubscribe<M extends keyof ControlSubscriptions & string>(
      method: M,
      input: ControlSubscriptions[M]['input'],
      handlers: ControlSubscriptionHandlers<ControlSubscriptions[M]['output']>,
      options?: ControlSubscribeOptions,
    ): ControlSubscriptionHandle {
      ensureBridgeConnected();
      const session = activeSession;
      if (!session || session.closed) {
        let stopped = false;
        const waitController = new AbortController();
        const waitSignal = options?.signal
          ? AbortSignal.any([options.signal, waitController.signal])
          : waitController.signal;
        const wait = waitForSession(waitSignal);
        let inner: ControlSubscriptionHandle | undefined;
        void wait.then(
          (readySession) => {
            if (stopped) return;
            if (readySession.closed) {
              handlers.onEnd?.(new ControlRpcError('CLOSED', 'Transport session closed before subscription started'));
              return;
            }
            inner = readySession.control.subscribe(method, input, handlers, options);
          },
          (error) => {
            if (stopped) return;
            const rpcError = error instanceof ControlRpcError
              ? error
              : new ControlRpcError('CLOSED', error instanceof Error ? error.message : String(error));
            handlers.onEnd?.(rpcError);
          },
        );
        return {
          unsubscribe: () => {
            if (stopped) return;
            stopped = true;
            waitController.abort();
            inner?.unsubscribe();
          },
          get closed() {
            return stopped || (inner?.closed ?? false);
          },
        };
      }
      return session.control.subscribe(method, input, handlers, options);
    },

    /** Sends a validated bus message over `@apackdev/link` and settles once the server accepts or refuses it. */
    async linkSend(message: Message): Promise<void> {
      const session = await waitForSession();
      const outcome = await new Promise<Outcome>((resolve) => {
        session.remote.ask(
          BUS_LINK_TARGET,
          BUS_SEND_ASK,
          encodeBusSendPayload(message),
          () => {},
          resolve,
          encodeDiagnosticSending(message.diagnostics),
        );
      });
      if (!outcome.ok) {
        throw new Error(outcome.failure.message);
      }
    },

    /** Executes a native `@apackdev/link` ask against a backend system, propagating `AbortSignal` via `left`. */
    async linkAsk(
      to: string,
      name: string,
      args: unknown,
      options: LinkAskOptions = {},
    ): Promise<Outcome> {
      const { signal, diagnostics, heard } = options;
      if (signal?.aborted) {
        throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      }
      const session = await waitForSession(signal);
      return await new Promise<Outcome>((resolve, reject) => {
        if (signal?.aborted) {
          reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
          return;
        }
        let settled = false;
        const cancel = session.remote.ask(
          to,
          name,
          args,
          (update) => { if (!settled) heard?.(update); },
          (outcome) => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener('abort', onAbort);
            resolve(outcome);
          },
          encodeDiagnosticSending(diagnostics),
        );
        const onAbort = (): void => {
          if (settled) return;
          settled = true;
          cancel();
          reject(signal!.reason ?? new DOMException('Aborted', 'AbortError'));
        };
        if (!settled && signal) {
          if (signal.aborted) {
            onAbort();
          } else {
            signal.addEventListener('abort', onAbort, { once: true });
          }
        }
      });
    },

    /** Follows a backend EARS view over `@apackdev/link`, delivering `ViewUpdate` frames until stopped. */
    linkFollow(
      feature: string,
      view: string,
      args: unknown,
      handlers: {
        onUpdate(update: ViewUpdate): void;
        onError(error: Error): void;
      },
      diagnostics?: PerformanceCarrier,
    ): { stop(): void } {
      ensureBridgeConnected();
      let stopped = false;
      let following: Following | undefined;
      const waitController = new AbortController();

      const startOn = (session: TransportSession): void => {
        if (stopped) return;
        if (session.closed) {
          handlers.onError(new Error('Transport session closed'));
          return;
        }
        following = session.remote.follow(
          feature,
          view,
          args,
          (update) => {
            if (!stopped) handlers.onUpdate(update as ViewUpdate);
          },
          (failure) => {
            if (!stopped) handlers.onError(new Error(failure.message));
          },
          encodeDiagnosticSending(diagnostics),
        );
      };

      if (activeSession && !activeSession.closed) {
        startOn(activeSession);
      } else {
        void waitForSession(waitController.signal).then(startOn, (error) => {
          if (!stopped) handlers.onError(error instanceof Error ? error : new Error(String(error)));
        });
      }

      return {
        stop: () => {
          if (stopped) return;
          stopped = true;
          waitController.abort();
          following?.stop();
          following = undefined;
        },
      };
    },
  };

  // Eagerly attach the single preload `backendPort` subscriber when running in a real Electron window.
  ensureBridgeConnected();

  return transport;
}

export const windowTransport = createWindowTransport();
