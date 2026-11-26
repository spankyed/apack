import { windowPerformance } from './performance.ts';
import { createRendererClockLifecycle, type RendererClockLifecycle } from './clock.ts';
// The renderer's side of the SDK's frontend port (bindFeHost): the app shell, the secrets client, the app's
// settings, the window's client to the API, the window's registered pack frontends, its shared clock, and
// its connection to the terminal broker
import { bindFeHost } from '@apackdev/sdk/runtime';
import type { HostShell, _HostBridge } from '@apackdev/sdk/fe';
import type { ClockController } from '@apackdev/clock';
import { feClient } from '@/transport/client';
import { fePacks } from '@/runtime/packs';
import { secretsClient } from '@/transport/secrets';
import { windowCatalog } from '@/runtime/catalog';
import { settingsPort } from '@/runtime/settings';

let activeLifecycle: RendererClockLifecycle | undefined;
let detachPagehide: (() => void) | undefined;

/** The window's shared clock controller, owned by the active renderer runtime binding. */
export function rendererClock(): ClockController | undefined {
  return activeLifecycle?.controller;
}

/** Registers a cleanup hook to run before the renderer closes its shared clock. */
export function onRendererDispose(listener: () => void): () => void {
  return activeLifecycle?.onDispose(listener) ?? (() => {});
}

/**
 * Tears down the renderer's shared runtime: detaches window lifecycle listeners, runs every registered cleanup
 * hook (disposing open terminal views and other clock consumers), and then closes the shared `ClockController`.
 * Idempotent.
 */
export function disposeRendererRuntime(): void {
  detachPagehide?.();
  detachPagehide = undefined;
  const lifecycle = activeLifecycle;
  activeLifecycle = undefined;
  lifecycle?.dispose();
}

/**
 * Binds the SDK's frontend port to this window's app, before the application actor is created (creating it already
 * builds its surfaces' state) and before any pack frontend runs. `application` gives the actor once it exists.
 */
export function bindRendererHost(application: () => HostShell | undefined): void {
  const lifecycle = createRendererClockLifecycle();
  try {
    bindFeHost({
      catalog: windowCatalog.catalog,
      get diagnostics() { return windowPerformance.execution; },
      get application() {
        const actor = application();
        if (!actor) throw new Error("The application actor isn't created yet: SDK code reached it while the renderer was starting");
        return actor;
      },
      secrets: secretsClient,
      settings: settingsPort,
      client: feClient,
      packs: fePacks,
      clock: lifecycle.controller.clock,
      onDispose: (listener) => lifecycle.onDispose(listener),
      terminalViews: (target) => {
        const bridge = (window as { electronAPI?: _HostBridge }).electronAPI;
        if (!bridge) throw new Error('This window has no bridge to the app, so it cannot reach the terminal broker');
        return bridge.terminal.views(target);
      },
    });
  } catch (error) {
    lifecycle.dispose();
    throw error;
  }

  const previousLifecycle = activeLifecycle;
  const previousDetach = detachPagehide;
  activeLifecycle = lifecycle;
  detachPagehide = undefined;

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const onPageHide = () => {
      disposeRendererRuntime();
    };
    window.addEventListener('pagehide', onPageHide, { once: true });
    detachPagehide = () => window.removeEventListener('pagehide', onPageHide);
  }

  previousDetach?.();
  previousLifecycle?.dispose();
}
