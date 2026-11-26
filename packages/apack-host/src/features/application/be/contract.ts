// The application system's contract: what it receives, what it answers, and what it sends its surface.
import type { HostSurfaceEvents } from '@apackdev/sdk/events';
import type { ApplicationSurfaceEvents } from '../events.ts';
import type { ApplicationAsks, ApplicationClientEvent } from '../../event-contracts.ts';

export type Contract = {
  incoming: ApplicationClientEvent;
  outgoing: HostSurfaceEvents['host/application'] | ApplicationSurfaceEvents;
  asks: ApplicationAsks;
};
