import { _withPerformanceCarrier } from '@apackdev/sdk/runtime';
import { createViewTransportObservation } from '@/runtime/performance-transport';
// The window's client to the API: the SDK's sends, views, and shell subscription over the brokered
// `MessagePort` (`muxTransport` → `@apackdev/link` + Control Lane) and Electron main's API status events.
import type { ShellClient, ShellFailure } from '@apackdev/host/fe';
import type { ViewUpdate } from '@apackdev/sdk/fe';
import { windowTransport } from '@/transport';
import { globalToast } from '@/adapters/toast';
import { windowSettings, connectWindowSettings, disconnectWindowSettings } from '@/runtime/settings';
import { windowCatalog } from '@/runtime/catalog';
import { errorMessage } from '@apackdev/sdk/utils/pure';

/** What the Electron main process reports about the API process */
type ApiStatusEvent = {
  type: string;
  restarting?: boolean;
  reloaded?: boolean;
  error?: unknown;
  message?: string;
  stack?: string;
  source?: string;
};

/** Why the API process stopped or failed: its message and stack apart, which the error page lays out */
function failureOf(event: ApiStatusEvent): ShellFailure {
  if (event.type === 'api:fatal') return { message: `[${event.source}] ${event.message}`, stack: event.stack };
  const error = event.error as { message?: string; stack?: string } | string | undefined;
  const message = (typeof error === 'object' ? error?.message : error) || 'The backend process stopped unexpectedly.';
  return { message, stack: typeof error === 'object' ? error?.stack : undefined };
}

/**
 * The views this window is subscribed to. A backend restart or reload delivers a fresh `MessagePort`
 * generation: every active view re-subscribes on the new link automatically.
 */
const views = new Set<{ subscribe(): void; unsubscribe(): void }>();

export const feClient: ShellClient = {
  send: (message, refused) => {
    windowTransport.linkSend(message).catch((error: unknown) => {
      const report = `Couldn't send ${message.event.type} to ${message.to}: ${errorMessage(error)}`;
      console.error(`[fe-client] ${report}`);
      window.electronAPI?.rendererLog?.write({ level: 'error', source: 'fe-client', message: report }).catch(() => {});
      if (!message.answering) globalToast.error(report);
      refused?.();
    });
  },

  subscribe: (connection) => {
    let stopped = false;
    let subscriptionEpoch = 0;
    let hasConnectedOnce = false;

    // The backend may have failed for good before this window started listening
    window.electronAPI?.apiStatus?.getStatus().then((status) => {
      if (stopped) return;
      if (status.error && !status.running && status.restartAttempts >= 3) connection.onFailed(status.error);
    });

    const stopTransport = windowTransport.subscribe({
      onConnected: () => {
        if (stopped) return;
        const epoch = ++subscriptionEpoch;
        const current = () => !stopped && epoch === subscriptionEpoch;
        if (hasConnectedOnce) {
          for (const view of views) view.subscribe();
        }
        hasConnectedOnce = true;
        windowCatalog.connect();
        void connectWindowSettings()
          .then((ready) => {
            if (current() && ready) connection.onConnected();
          })
          .catch((error) => {
            if (current()) {
              connection.onDisconnected();
              connection.onFailed(String(error));
            }
          });
      },
      onDisconnected: () => {
        if (stopped) return;
        subscriptionEpoch++;
        disconnectWindowSettings();
        windowCatalog.disconnect();
        connection.onDisconnected();
      },
      onMessage: (message) => {
        if (stopped) return;
        _withPerformanceCarrier(message.diagnostics, () => {
          if (!windowSettings.receive(message)) connection.onMessage(message);
        });
      },
    });

    // The main process tells this window at once when the API stops or fails fatally
    const stopStatus = window.electronAPI?.apiStatus?.onEvent((event: ApiStatusEvent) => {
      if (stopped) return;
      if (event.type === 'api:stopped' && event.restarting) return;
      if (event.type === 'api:started') return;
      if (event.type === 'api:fatal' || event.type === 'api:stopped' || event.type === 'api:error') {
        subscriptionEpoch++;
        disconnectWindowSettings();
        windowCatalog.disconnect();
        connection.onDisconnected();
        connection.onFailed(failureOf(event));
      }
    });

    return () => {
      stopped = true;
      subscriptionEpoch++;
      stopTransport();
      disconnectWindowSettings();
      windowCatalog.disconnect();
      stopStatus?.();
    };
  },

  watchView: (request, observer) => {
    const observation = createViewTransportObservation(request);
    let active = true;
    let generation = 0;
    let subscription: { stop(): void } | undefined;
    const view = {
      subscribe: () => {
        if (!active) return;
        const epoch = ++generation;
        const delivery = observation.subscribe(epoch);
        subscription?.stop();
        const { ref, view: viewName, args } = delivery.request;
        const diagnostics = 'diagnostics' in delivery.request ? delivery.request.diagnostics : undefined;
        subscription = windowTransport.linkFollow(
          ref,
          viewName,
          args,
          {
            onUpdate: (update) => {
              if (!active || generation !== epoch) return;
              delivery.receive(update as ViewUpdate, observer);
            },
            onError: (error) => {
              if (!active || generation !== epoch) return;
              delivery.error(() => observer({ ok: false, error: errorMessage(error), commit: 0 }));
            },
          },
          diagnostics,
        );
      },
      unsubscribe: () => {
        active = false;
        generation++;
        subscription?.stop();
      },
    };
    views.add(view);
    view.subscribe();
    return () => {
      views.delete(view);
      view.unsubscribe();
    };
  },

  packClientReady: (packId, registrationId) =>
    windowTransport.controlCall('packs.clientReady', { packId, registrationId }),

  loadedPacks: () => windowTransport.controlCall('packs.loaded'),

  entityExists: async (id, signal) => {
    const outcome = await windowTransport.linkAsk('host/application', 'ENTITY_EXISTS', { id }, { signal });
    if (!outcome.ok) {
      throw new Error(outcome.failure.message);
    }
    return Boolean((outcome.value as { exists?: unknown } | undefined)?.exists);
  },

  describeConnection: () => window.electronAPI?.apiStatus?.getStatus()
    .then((status) => [
      'The backend did not respond within 30 seconds.',
      '',
      `Startup ID: ${status.startupId || window.electronAPI?.startupId || 'unknown'}`,
      `API running: ${status.running ? 'yes' : 'no'}`,
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
