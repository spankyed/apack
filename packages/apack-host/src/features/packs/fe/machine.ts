// The Packs surface's state: what the Packs view shows and what it asks the `host/packs` system for. It runs in
// the renderer, which pairs it with the view's components, and lives here beside that system and the shell for the
// same reason the system doesn't live in the API — it decides things, and deciding isn't rendering.
import type { Value } from '@apackdev/state';
import type { SurfaceChrome } from '@apackdev/sdk/fe';
import { hostState } from '../../../state.ts';
import type { AppPackSourceSummary, InstalledPackSummary } from '../../../packs/registry.ts';
import type { OutgoingPacksEvents } from '../../event-contracts.ts';

export type { AppPackSourceSummary, InstalledPackSummary };

export interface PacksContext {
  packs: InstalledPackSummary[];
  appPackSources: AppPackSourceSummary[];
  appPackSourceProblems: { id: string; message: string }[];
  selectedPackId: string | null;
  installing: string | null;
  confirmingUninstall: string | null;
  updatingPackId: string | null;
  error: string | null;
}

type PacksEvent = OutgoingPacksEvents
  | { type: 'CLIENT_CONNECTED' }
  | { type: 'UI.INSTALL'; packSlug: string; sourceKind?: string }
  | { type: 'UI.REPLACE'; packId: string; packSlug: string; sourceKind?: string }
  | { type: 'UI.RESTORE'; packId: string; sourceRevision: string }
  | { type: 'UI.UNINSTALL'; packId: string }
  | { type: 'UI.CONFIRM_UNINSTALL'; packId: string }
  | { type: 'UI.CANCEL_UNINSTALL' }
  | { type: 'UI.TOGGLE_ENABLED'; packId: string }
  | { type: 'UI.SELECT_PACK'; packId: string }
  | { type: 'UI.BACK' }
  | { type: 'UI.DISMISS_ERROR' }
  | { type: 'UI.REFRESH' }
  | { type: 'UI.UPDATE'; packId: string }
  | { type: 'UI.UPDATE_APP'; packId: string; sourceRevision: string }
  | { type: 'UI.CHECK_UPDATES' }
  /**
   * The three ways the view resolves one content offer, each passed straight to the `packs` system: the view
   * decides nothing about them, and the system is where the user's data is written.
   */
  | { type: 'UI.RESTORE_CONTENT'; packId: string; key: string }
  | { type: 'UI.DISMISS_OFFER'; packId: string; key: string }
  | { type: 'UI.DELETE_CONTENT'; packId: string; key: string };

type PacksShape = {
  data: PacksContext;
};

export const packsChrome: SurfaceChrome<Value<PacksShape>> = {
  default: { label: 'Packs', target: 'idle' },
};

const packsState = hostState<PacksShape, PacksEvent>()({
  data: {
    packs: [],
    appPackSources: [],
    appPackSourceProblems: [],
    selectedPackId: null,
    installing: null,
    confirmingUninstall: null,
    updatingPackId: null,
    error: null,
  },
  on: {
    CLIENT_CONNECTED: () => {},
    PACKS_LIST: (event) => ({
      data: {
        packs: event.packs,
        appPackSources: event.appPackSources,
        appPackSourceProblems: event.appPackSourceProblems,
      },
    }),
    PACK_INSTALL_STARTED: (event) => ({
      data: { installing: event.packSlug, error: null },
    }),
    PACK_INSTALL_COMPLETE: () => ({
      data: { installing: null },
    }),
    PACK_INSTALL_FAILED: (event) => ({
      data: { installing: null, error: event.error },
    }),
    PACK_UNINSTALL_COMPLETE: () => ({
      data: { confirmingUninstall: null },
    }),
    PACK_UNINSTALL_FAILED: (event) => ({
      data: { confirmingUninstall: null, error: event.error },
    }),
    PACK_ENABLED_CHANGED: (event, { data }) => ({
      data: {
        packs: data.packs.map(p =>
          p.id === event.packId ? { ...p, enabled: event.enabled } : p,
        ),
      },
    }),
    // The application actor owns pack frontend loading — it loads the packs it hasn't yet, this one
    // included, and reports a failure the same way wherever the load was asked for
    PACK_ACTIVATED: (_event, { tell }) => {
      tell({ peer: 'shell' }, { type: 'LOAD_PACK_FRONTENDS' });
    },
    // The shell owns pack frontends: it unloads this one's and drops its surfaces, as it loads them on activation
    PACK_DEACTIVATED: (event, { tell }) => {
      tell({ peer: 'shell' }, { type: 'PACK_SURFACES_UNLOADED', packId: event.packId });
    },
    PACK_UPDATE_COMPLETE: () => ({
      data: { updatingPackId: null },
    }),
    PACK_UPDATE_FAILED: (event) => ({
      data: { updatingPackId: null, error: event.error },
    }),
    'UI.INSTALL': (event, { tell }) => {
      tell('packs', { type: 'INSTALL_PACK', packSlug: event.packSlug, sourceKind: event.sourceKind });
    },
    'UI.REPLACE': (event, { tell }) => {
      tell('packs', { type: 'REPLACE_PACK', packId: event.packId, packSlug: event.packSlug, sourceKind: event.sourceKind });
    },
    'UI.RESTORE': (event, { tell }) => {
      tell('packs', { type: 'RESTORE_PACK', packId: event.packId, sourceRevision: event.sourceRevision });
    },
    'UI.CONFIRM_UNINSTALL': (event) => ({
      data: { confirmingUninstall: event.packId },
    }),
    'UI.CANCEL_UNINSTALL': () => ({
      data: { confirmingUninstall: null },
    }),
    'UI.UNINSTALL': (event, { tell }) => {
      tell('packs', { type: 'UNINSTALL_PACK', packId: event.packId });
    },
    'UI.TOGGLE_ENABLED': (event, { tell }) => {
      tell('packs', { type: 'TOGGLE_PACK_ENABLED', packId: event.packId });
    },
    'UI.SELECT_PACK': (event) => ({
      data: { selectedPackId: event.packId },
    }),
    'UI.BACK': () => ({
      data: { selectedPackId: null },
    }),
    'UI.DISMISS_ERROR': () => ({
      data: { error: null },
    }),
    'UI.REFRESH': (_event, { tell }) => {
      tell('packs', { type: 'GET_INSTALLED_PACKS' });
    },
    'UI.UPDATE_APP': (event, { tell }) => {
      tell('packs', { type: 'UPDATE_APP_PACK', packId: event.packId, sourceRevision: event.sourceRevision });
      return { data: { updatingPackId: event.packId, error: null } };
    },
    'UI.UPDATE': (event, { tell }) => {
      tell('packs', { type: 'UPDATE_PACK', packId: event.packId });
      return { data: { updatingPackId: event.packId, error: null } };
    },
    'UI.CHECK_UPDATES': (_event, { tell }) => {
      tell('packs', { type: 'CHECK_FOR_UPDATES' });
    },
    'UI.RESTORE_CONTENT': (event, { tell }) => {
      tell('packs', { type: 'RESTORE_CONTENT_ITEM', packId: event.packId, key: event.key });
    },
    'UI.DISMISS_OFFER': (event, { tell }) => {
      tell('packs', { type: 'DISMISS_CONTENT_OFFER', packId: event.packId, key: event.key });
    },
    'UI.DELETE_CONTENT': (event, { tell }) => {
      tell('packs', { type: 'DELETE_CONTENT_ITEM', packId: event.packId, key: event.key });
    },
  },
});

export type PacksState = typeof packsState;
export default packsState;
