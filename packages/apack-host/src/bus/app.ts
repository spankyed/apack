// The app's bus: the `@apackdev/state` bus wired to the app's root event bus (the api's tRPC clients), which the
// SDK reaches through the bound HostRuntime's transport.
import { _rootEvents } from '@apackdev/sdk/runtime';
import type { HostSurfaceEvents } from '@apackdev/sdk/events';
import { appState } from '../app-state/index.ts';
import type { PackRegistry } from '../packs/registry.ts';
import { getPacksWithClientLoadedFrontends } from '../packs/layout.ts';
import { createBus, type BackendBus } from './bus.ts';
import { surfaceVisibility } from '../features/application/be/system.ts';
import { HOST } from '../refs.ts';
import type { ParticipantClaims } from './participants.ts';

/** Sent to the application surface after each client connection: the app shell's state, which the window opens with */
export type ApplicationConnectedEvent = Extract<HostSurfaceEvents['host/application'], { type: 'CLIENT_CONNECTED' }>;

/** The app's bus: the systems in `registry`, and clients over the root event bus on the shared bus core */
export function createAppBus(registry: PackRegistry, claims?: ParticipantClaims): BackendBus {
  return createBus({
    registry,
    participantClient: claims && ((ref) => claims.clientFor(ref)),
    onOutgoing: (message) => _rootEvents.emitOutgoing(message),
    listen: (send) => {
      const unsubscribes = [
        _rootEvents.onConnected(() => send({ type: 'CLIENT_CONNECTED' })),
        _rootEvents.onPackClientConnected((packId) => send({ type: 'PACK_CLIENT_CONNECTED', packId })),
        // Sends to surfaces from outside a system go through the bus, which drops them until a client connects
        _rootEvents.onSurfaceSend((message) => send({ type: 'OUTGOING', message })),
        _rootEvents.onIncoming((message) => send({ type: 'INCOMING', message })),
      ];
      return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
    },
    // Each client asks for these packs' startup data once it has tried loading their frontends (bus.packClientReady)
    clientLoadedPacks: () => getPacksWithClientLoadedFrontends(registry),
    connectedEvents: () => {
      const { hasOnboarded, lastActiveSurface } = appState.get();
      const event: ApplicationConnectedEvent = {
        type: 'CLIENT_CONNECTED',
        hasOnboarded,
        surfaceVisibility: surfaceVisibility(registry),
        ...(lastActiveSurface !== undefined && { lastActiveSurface }),
      };
      return [{ to: HOST.application, event }];
    },
  });
}

