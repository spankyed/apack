import { _withPerformanceCarrier } from '@apackdev/sdk/runtime';
import { createViewTransportObservation } from '@/runtime/performance-transport';
// The window's client to the API: the SDK's sends and the shell's subscription, over tRPC and the Electron main
// process's report of the API's status. Nothing else in the renderer calls the bus or reads the loaded packs.
import type { ShellClient, ShellFailure } from '@apackdev/host/fe';
import type { ViewUpdate } from '@apackdev/sdk/fe';
import { trpc, reconnectApiClient } from '@/transport';
import { globalToast } from '@/adapters/toast';
import { windowSettings, connectWindowSettings, disconnectWindowSettings } from '@/runtime/settings';
import { windowCatalog } from '@/runtime/catalog';
import { errorMessage } from '@apackdev/sdk/utils/pure';

/** What the Electron main process reports about the API process */
type ApiStatusEvent = { type: string; port?: number; restarting?: boolean; reloaded?: boolean; error?: unknown; message?: string; stack?: string; source?: string };

/** Why the API process stopped or failed: its message and stack apart, which the error page lays out */
function failureOf(event: ApiStatusEvent): ShellFailure {
  if (event.type === 'api:fatal') return { message: `[${event.source}] ${event.message}`, stack: event.stack };
  const error = event.error as { message?: string; stack?: string } | string | undefined;
  const message = (typeof error === 'object' ? error?.message : error) || 'The backend process stopped unexpectedly.';
  return { message, stack: typeof error === 'object' ? error?.stack : undefined };
}

/**
 * The views this window is subscribed to. A subscription survives the socket dropping (the client subscribes it
 * again when the socket is back), but not the API moving to another port, where the client is rebuilt: each is
 * subscribed again then, as the bus subscription is.
 */
const views = new Set<{ subscribe(): void; unsubscribe(): void }>();

export const feClient: ShellClient = {
  send: (message) => {
    // Caught, since an unhandled rejection shows the error page. The report leaves out the payload, and goes to
    // the app's log (and so diagnostics) as well as the console.
    //
    // **An answer that cannot be delivered is a log line, not a toast** (`Message.answering`, set by `reply` and
    // nothing else). A command someone gave is worth telling them about; an answer has nobody behind it to tell,
    // and the asking system may legitimately no longer declare the event — so the person would get a sentence
    // about plumbing they did not cause and cannot act on. The shell makes the same call for a send that stays
    // inside the window; this is the path that leaves it, and the two now read one field.
    trpc.bus.send.mutate(message).catch((error: unknown) => {
      const report = `Couldn't send ${message.event.type} to ${message.to}: ${errorMessage(error)}`;
      console.error(`[fe-client] ${report}`);
      window.electronAPI?.rendererLog?.write({ level: 'error', source: 'fe-client', message: report }).catch(() => {});
      if (!message.answering) globalToast.error(report);
    });
  },

  subscribe: (connection) => {
    let stopped = false;
    let subscriptionEpoch = 0;
    // The backend may have failed for good before this window started listening
    window.electronAPI?.apiStatus?.getStatus().then((status) => {
      if (stopped) return;
      // The error as main recorded it, its stack included, for the error page to lay out
      if (status.error && !status.running && status.restartAttempts >= 3) connection.onFailed(status.error);
    });

    const subscribeToBus = () => {
      const epoch = ++subscriptionEpoch;
      const current = () => !stopped && epoch === subscriptionEpoch;
      return trpc.bus.sub.subscribe(undefined, {
        // Each time this window's subscription is established: the server has sent this connection's
        // CLIENT_CONNECTED. Another window connecting broadcasts CLIENT_CONNECTED too, but not this.
        onStarted: () => {
          if (!current()) return;
          windowCatalog.connect();
          void connectWindowSettings().then(ready => { if (current() && ready) connection.onConnected(); })
            .catch(error => { if (current()) { connection.onDisconnected(); connection.onFailed(String(error)); } });
        },
        // The socket dropped: the subscription is established again when it reconnects
        onConnectionStateChange: ({ state }) => {
          if (!current()) return;
          if (state === 'connecting') { disconnectWindowSettings(); windowCatalog.disconnect(); connection.onDisconnected(); }
        },
        onError: (error: unknown) => {
          if (!current()) return;
          console.error('Error in subscription:', error);
          disconnectWindowSettings();
          windowCatalog.disconnect();
          connection.onDisconnected();
          connection.onFailed(String(error));
        },
        onData: (message) => {
          if (!current()) return;
          _withPerformanceCarrier(message.diagnostics, () => { if (!windowSettings.receive(message)) connection.onMessage(message); });
        },
      });
    };
    let subscription = subscribeToBus();

    // The main process tells this window at once when the API stops, fails or moves
    const stopStatus = window.electronAPI?.apiStatus?.onEvent((event: ApiStatusEvent) => {
      if (stopped) return;
      if (event.type === 'api:stopped' && event.restarting) return;
      if (event.type === 'api:started') {
        // A restart can land on a different port; the old subscription died with the old socket.
        //
        // `reloaded` is that resubscribe forced on an *unchanged* port, which a development reload usually
        // keeps: `reconnectApiClient` then answers `false` and leaves a subscription whose socket is
        // already dead, and the client's own retry is a backoff whose second attempt is 2s away — four
        // times the half-second the restart took. Main sets it only for a reload it performed, so the old
        // socket is known to be gone and tearing it down here is safe.
        if ((event.port && reconnectApiClient(event.port)) || event.reloaded) {
          subscriptionEpoch++;
          subscription.unsubscribe();
          subscription = subscribeToBus();
          for (const view of views) view.subscribe();
        }
        return;
      }
      if (event.type === 'api:fatal' || event.type === 'api:stopped' || event.type === 'api:error') {
        disconnectWindowSettings();
        windowCatalog.disconnect();
        connection.onDisconnected();
        connection.onFailed(failureOf(event));
      }
    });

    return () => {
      stopped = true;
      subscriptionEpoch++;
      subscription.unsubscribe();
      disconnectWindowSettings();
      windowCatalog.disconnect();
      stopStatus?.();
    };
  },

  watchView: (request, observer) => {
    const observation = createViewTransportObservation(request);
    let active = true;
    let generation = 0;
    let subscription: { unsubscribe(): void } | undefined;
    const view = {
      subscribe: () => {
        if (!active) return;
        const epoch = ++generation;
        const delivery = observation.subscribe(epoch);
        subscription?.unsubscribe();
        subscription = trpc.views.watch.subscribe(delivery.request, {
          // tRPC types a frame as JSON delivers it, where a member typed `unknown` may be absent; the API sends
          // `ViewUpdate`s, so what arrives is one, a result of `undefined` being one JSON can't carry anyway
          onData: (update) => {
            if (!active || generation !== epoch) return;
            delivery.receive(update as ViewUpdate, observer);
          },
          // The subscription failed rather than the view: a request the API refused, or the socket gone for good
          onError: (error: unknown) => {
            if (!active || generation !== epoch) return;
            delivery.error(() => observer({ ok: false, error: errorMessage(error), commit: 0 }));
          },
        });
      },
      unsubscribe: () => { active = false; generation++; subscription?.unsubscribe(); },
    };
    views.add(view);
    view.subscribe();
    return () => {
      views.delete(view);
      view.unsubscribe();
    };
  },

  packClientReady: (packId, registrationId) => trpc.bus.packClientReady.mutate({ packId, registrationId }),

  loadedPacks: () => trpc.packs.loaded.query(),
  entityExists: (id, signal) => trpc.entities.exists.query({ id }, { signal }),

  describeConnection: () => window.electronAPI?.apiStatus?.getStatus()
    .then((status) => [
      'The backend did not respond within 30 seconds.',
      '',
      `Startup ID: ${status.startupId || window.electronAPI?.startupId || 'unknown'}`,
      `API running: ${status.running ? 'yes' : 'no'}`,
      `API port: ${status.port ?? 'unknown'}`,
      `Restart attempts: ${status.restartAttempts}`,
      status.error ? `Last backend error: ${typeof status.error === 'string' ? status.error : status.error.message}` : undefined,
      '',
      `Main log: ${status.logPath}`,
      `Renderer log: ${status.rendererLogPath}`,
      `App events log: ${status.appEventsLogPath}`,
    ].filter(Boolean).join('\n'))
    .catch(() => 'The backend did not respond within 30 seconds and API status could not be read.')
    ?? Promise.resolve('The backend did not respond within 30 seconds, and this window has no API status to read.'),
};
