// This window's subscription to the bus: the connection's lifecycle becomes the shell's events, and each message
// goes to the surface it's for — named as it is handled, so a send that surface makes in answer carries its own ref.
import { _settleAsk, type Message } from '@apackdev/sdk/events';
import type { ShellClient } from '../../../fe/client.ts';
import { HOST } from '../../../refs.ts';
import type { ShellEvent } from './types.ts';

export interface ConnectionHandlers {
  sendToShell(event: ShellEvent): void;
  deliverToSurface(message: Message): void;
}

export function subscribeConnection(client: ShellClient, handlers: ConnectionHandlers): () => void {
  return client.subscribe({
    onConnected: () => handlers.sendToShell({ type: 'BUS_SUBSCRIBED' }),
    onDisconnected: () => handlers.sendToShell({ type: 'BUS_CONNECTION_LOST' }),
    onFailed: (error) => handlers.sendToShell({ type: 'BACKEND_ERROR', error }),
    // The event arrives exactly as the system sent it
    onMessage: (message) => {
      // An answer to an ask this window is waiting on is that ask's, and goes to no surface: its address is only what
      // brought it to this window (`ask`, `@apackdev/sdk/events`)
      if (_settleAsk(message)) return;
      const { to, event } = message;
      if (to === HOST.application) {
        // Every window hears it; the shell tells a backend's request to open a surface from its own window's
        handlers.sendToShell((event.type === 'OPEN_SURFACE' ? { ...event, type: 'OPEN_SURFACE_FROM_APP' } : event) as ShellEvent);
        return;
      }
      handlers.deliverToSurface(message);
    },
  });
}
