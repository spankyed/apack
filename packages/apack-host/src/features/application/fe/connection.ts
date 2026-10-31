// This window's subscription to the bus, held by a child actor over the shell's client: the connection's lifecycle
// becomes the shell's events, and each message goes to the surface it's for — named as it is handled, so a send
// that surface makes in answer carries its own ref (`notifySurfaceActor`/`sendToSurfaceActor`). This is the path every backend
// `broadcastToSurface` takes, and it set no name until it was tested for one.
import { fromCallback } from 'xstate';
import { senderSuffix } from '@apackdev/sdk/events';
import type { ShellClient } from '../../../fe/client.ts';
import { notifySurfaceActor, sendToSurfaceActor } from '../../../fe/surface-delivery.ts';
import { HOST } from '../../../refs.ts';
import type { ShellEvent } from './types.ts';

export function connectionListener(client: ShellClient) {
  return fromCallback<ShellEvent>(({ system, sendBack }) => client.subscribe({
    onConnected: () => sendBack({ type: 'BUS_SUBSCRIBED' }),
    onDisconnected: () => sendBack({ type: 'BUS_CONNECTION_LOST' }),
    onFailed: (error) => sendBack({ type: 'BACKEND_ERROR', error }),
    // The event arrives exactly as the system sent it
    onMessage: (message) => {
      const { to, event, sender } = message;
      if (to === HOST.application) {
        // Every window hears it; the shell tells a backend's request to open a surface from its own window's
        sendBack((event.type === 'OPEN_SURFACE' ? { ...event, type: 'OPEN_SURFACE_FROM_APP' } : event) as ShellEvent);
        return;
      }
      const surface = system.get(to);
      if (!surface) {
        // The sender survives the subscription, which carries the message whole: name it when the send stamped one
        const suffix = senderSuffix(message);
        console.warn(`[shell] No surface is running at ${to} for ${event.type}${suffix && ` sent${suffix}`}`);
        return;
      }
      // Whether the backend asked or only told is the wire's to say, and it is a branch rather than a value: a
      // `sender` arriving means the surface's handler is handed a `reply` that goes back out over this connection,
      // to that system alone rather than to its own copy in every window that shows it. A broadcast names none.
      // The call rides along so the surface's own guards can tell this answer from one for a request it has
      // since abandoned — `callOf(event)`, injected by the door rather than declared on any contract
      if (sender === undefined) notifySurfaceActor(surface, to, event, message);
      else sendToSurfaceActor(surface, to, event, { kind: 'bus', ref: sender }, message);
    },
  }));
}
