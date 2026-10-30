import { windowPerformance } from './performance.ts';
// The renderer's side of the SDK's frontend port (bindFeHost): the app shell, the secrets client, the app's
// settings, the window's client to the API, and the window's registered pack frontends
import { bindFeHost } from '@apackdev/sdk/runtime';
import type { HostShell } from '@apackdev/sdk/fe';
import { feClient } from '@/transport/client';
import { fePacks } from '@/runtime/packs';
import { secretsClient } from '@/transport/secrets';
import { windowCatalog } from '@/runtime/catalog';
import { settingsPort } from '@/runtime/settings';

/**
 * Binds the SDK's frontend port to this window's app, before the application actor is created (creating it already
 * builds its surfaces' state) and before any pack frontend runs. `application` gives the actor once it exists.
 */
export function bindRendererHost(application: () => HostShell | undefined): void {
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
  });
}
