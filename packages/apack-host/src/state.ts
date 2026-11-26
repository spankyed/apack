// The host's `@apackdev/state` network: flat, concrete `HostNet` and `hostState = forNet<HostNet>(resolve)`.
//
// Mirrors `events.ts` for `@apackdev/state` systems and surfaces: bare own feature names (`bus`, `application`,
// `packs`, `help`, `settings`) resolved against `HOST_PACK_ID`, pre-normalized asks, tell events disjoint from asks,
// and role-addressed peers for cross-pack signals (`role:brain`, `role:code`).
import { forNet } from '@apackdev/state';
import type {
  ContractAsks,
  HostSurfaceEvents,
  HostSystemEvents,
  IncomingOnlyEventsOf,
  NormalizeAsks,
} from '@apackdev/sdk/events';
import { HOST_PACK_ID, resolveName } from '@apackdev/sdk/ids';
import type { ApplicationSurfaceEvents } from './features/application/events.ts';
import type {
  ApplicationClientEvent,
  HelpOutgoing,
  OutgoingPacksEvents,
  SettingsSurfaceEvents,
} from './features/event-contracts.ts';
import type { Contract as HelpContract } from './features/help/be/system.ts';
import type { Contract as PacksContract } from './features/packs/be/contract.ts';
import type { Contract as SettingsContract } from './features/settings/be/contract.ts';

type __host_asks_packs = NormalizeAsks<ContractAsks<PacksContract>>;
type __host_asks_settings = NormalizeAsks<ContractAsks<SettingsContract>>;

/** Flat, concrete network for host states — zero mapped-type intersections for O(1) TS lookup. */
export interface HostNet {
  systems: {
    bus: {
      events: HostSystemEvents['host/bus'];
      asks: {};
    };
    application: {
      events: ApplicationClientEvent;
      asks: {};
    };
    packs: {
      events: IncomingOnlyEventsOf<PacksContract>;
      asks: __host_asks_packs;
    };
    help: {
      events: IncomingOnlyEventsOf<HelpContract>;
      asks: {};
    };
    settings: {
      events: IncomingOnlyEventsOf<SettingsContract>;
      asks: __host_asks_settings;
    };
  };
  surfaces: {
    application: {
      events: HostSurfaceEvents['host/application'] | ApplicationSurfaceEvents;
    };
    packs: {
      events: OutgoingPacksEvents;
    };
    settings: {
      events: HelpOutgoing | SettingsSurfaceEvents | HostSurfaceEvents['host/settings'];
    };
  };
  views: {};
  peers: {
    'role:brain': {
      events: { type: 'RESTART_BRAIN' };
    };
    'role:code': {
      events: { type: 'TEST_CLI_PROVIDER'; provider: string };
    };
  };
}

export const hostState = /*#__PURE__*/ forNet<HostNet>((name) => resolveName(name, HOST_PACK_ID));
