// The Packs surface's machine: what the Packs view shows and what it asks the `host/packs` system for. It runs in
// the renderer, which pairs it with the view's components, and lives here beside that system and the shell for the
// same reason the system doesn't live in the API — it decides things, and deciding isn't rendering.
import { assign, setup, type ActorRefFrom } from 'xstate';
import { breadcrumb, safeEvents } from '@apackdev/sdk/fe';
import { tell } from '../../../events.ts';
import type { AppPackSourceSummary, InstalledPackSummary } from '../../../packs/registry.ts';
import type { OutgoingPacksEvents } from '../../event-contracts.ts';
import { HOST } from '../../../refs.ts';
import { notifySurfaceActor } from '../../../fe/surface-delivery.ts';

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
  | { type: 'UI.DELETE_CONTENT'; packId: string; key: string }

const typeOf = safeEvents<PacksEvent>();

const packsState = setup({
  types: {
    context: {} as PacksContext,
    events: {} as PacksEvent,
  },
  actions: {
    setPacksList: assign({
      packs: ({ event }) => typeOf('PACKS_LIST', event).packs,
      appPackSources: ({ event }) => typeOf('PACKS_LIST', event).appPackSources,
      appPackSourceProblems: ({ event }) => typeOf('PACKS_LIST', event).appPackSourceProblems,
    }),

    setInstalling: assign({
      installing: ({ event }) => typeOf('PACK_INSTALL_STARTED', event).packSlug,
      error: () => null,
    }),

    onInstallComplete: assign({
      installing: () => null,
    }),

    onInstallFailed: assign({
      installing: () => null,
      error: ({ event }) => typeOf('PACK_INSTALL_FAILED', event).error,
    }),

    onUninstallFailed: assign({
      error: ({ event }) => typeOf('PACK_UNINSTALL_FAILED', event).error,
    }),

    onEnabledChanged: assign({
      packs: ({ context, event }) => {
        const ev = typeOf('PACK_ENABLED_CHANGED', event);
        return context.packs.map(p =>
          p.id === ev.packId ? { ...p, enabled: ev.enabled } : p
        );
      },
    }),

    // The shell owns pack frontends: it unloads this one's and drops its surfaces, as it loads them on activation
    onPackDeactivated: ({ system, event }) => {
      const ev = typeOf('PACK_DEACTIVATED', event);
      // Through the funnel: this runs while handling a bus message, and a direct send would leave the shell
      // handling the unload as *this* surface, with this surface's asker. Nobody waits on the unload itself.
      notifySurfaceActor(system.get(HOST.application), HOST.application, { type: 'PACK_SURFACES_UNLOADED', packId: ev.packId });
    },

    // The application actor owns pack frontend loading — it loads the packs it hasn't yet, this one
    // included, and reports a failure the same way wherever the load was asked for
    onPackActivated: ({ system }) => {
      notifySurfaceActor(system.get(HOST.application), HOST.application, { type: 'LOAD_PACK_FRONTENDS' });
    },

    sendInstall: ({ event }) => {
      const ev = typeOf('UI.INSTALL', event);
      tell('packs', { type: 'INSTALL_PACK', packSlug: ev.packSlug, sourceKind: ev.sourceKind });
    },

    sendReplace: ({ event }) => {
      const ev = typeOf('UI.REPLACE', event);
      tell('packs', { type: 'REPLACE_PACK', packId: ev.packId, packSlug: ev.packSlug, sourceKind: ev.sourceKind });
    },

    sendRestore: ({ event }) => {
      const ev = typeOf('UI.RESTORE', event);
      tell('packs', { type: 'RESTORE_PACK', packId: ev.packId, sourceRevision: ev.sourceRevision });
    },

    promptUninstall: assign({
      confirmingUninstall: ({ event }) => typeOf('UI.CONFIRM_UNINSTALL', event).packId,
    }),

    cancelUninstall: assign({
      confirmingUninstall: () => null,
    }),

    sendUninstall: ({ event }) => {
      const ev = typeOf('UI.UNINSTALL', event);
      tell('packs', { type: 'UNINSTALL_PACK', packId: ev.packId });
    },

    clearUninstallPrompt: assign({
      confirmingUninstall: () => null,
    }),

    sendToggleEnabled: ({ event }) => {
      const ev = typeOf('UI.TOGGLE_ENABLED', event);
      tell('packs', { type: 'TOGGLE_PACK_ENABLED', packId: ev.packId });
    },

    selectPack: assign({
      selectedPackId: ({ event }) => typeOf('UI.SELECT_PACK', event).packId,
    }),

    clearSelection: assign({
      selectedPackId: () => null,
    }),

    dismissError: assign({
      error: () => null,
    }),

    onUpdateComplete: assign({
      updatingPackId: () => null,
    }),

    onUpdateFailed: assign({
      updatingPackId: () => null,
      error: ({ event }) => typeOf('PACK_UPDATE_FAILED', event).error,
    }),

    setUpdating: assign({
      updatingPackId: ({ event }) => event.type === 'UI.UPDATE_APP' ? event.packId : typeOf('UI.UPDATE', event).packId,
      error: () => null,
    }),

    sendUpdate: ({ event }) => {
      const ev = typeOf('UI.UPDATE', event);
      tell('packs', { type: 'UPDATE_PACK', packId: ev.packId });
    },

    sendAppUpdate: ({ event }) => {
      const ev = typeOf('UI.UPDATE_APP', event);
      tell('packs', { type: 'UPDATE_APP_PACK', packId: ev.packId, sourceRevision: ev.sourceRevision });
    },

    sendCheckUpdates: () => {
      tell('packs', { type: 'CHECK_FOR_UPDATES' });
    },

    sendRefresh: () => {
      tell('packs', { type: 'GET_INSTALLED_PACKS' });
    },

    sendRestoreContent: ({ event }) => {
      const ev = typeOf('UI.RESTORE_CONTENT', event);
      tell('packs', { type: 'RESTORE_CONTENT_ITEM', packId: ev.packId, key: ev.key });
    },

    sendDismissOffer: ({ event }) => {
      const ev = typeOf('UI.DISMISS_OFFER', event);
      tell('packs', { type: 'DISMISS_CONTENT_OFFER', packId: ev.packId, key: ev.key });
    },

    sendDeleteContent: ({ event }) => {
      const ev = typeOf('UI.DELETE_CONTENT', event);
      tell('packs', { type: 'DELETE_CONTENT_ITEM', packId: ev.packId, key: ev.key });
    },
  },
}).createMachine({
  id: HOST.packs,
  initial: 'idle',
  context: {
    packs: [],
    appPackSources: [],
    appPackSourceProblems: [],
    selectedPackId: null,
    installing: null,
    confirmingUninstall: null,
    updatingPackId: null,
    error: null,
  },
  states: {
    idle: {
      meta: breadcrumb('idle', 'Packs', true),
      on: {
        CLIENT_CONNECTED: {},
        PACKS_LIST: { actions: 'setPacksList' },
        PACK_INSTALL_STARTED: { actions: 'setInstalling' },
        PACK_INSTALL_COMPLETE: { actions: 'onInstallComplete' },
        PACK_INSTALL_FAILED: { actions: 'onInstallFailed' },
        PACK_UNINSTALL_COMPLETE: { actions: 'clearUninstallPrompt' },
        PACK_UNINSTALL_FAILED: { actions: ['clearUninstallPrompt', 'onUninstallFailed'] },
        PACK_ENABLED_CHANGED: { actions: 'onEnabledChanged' },
        PACK_ACTIVATED: { actions: 'onPackActivated' },
        PACK_DEACTIVATED: { actions: 'onPackDeactivated' },
        PACK_UPDATE_COMPLETE: { actions: 'onUpdateComplete' },
        PACK_UPDATE_FAILED: { actions: 'onUpdateFailed' },
        'UI.INSTALL': { actions: 'sendInstall' },
        'UI.REPLACE': { actions: 'sendReplace' },
        'UI.RESTORE': { actions: 'sendRestore' },
        'UI.CONFIRM_UNINSTALL': { actions: 'promptUninstall' },
        'UI.CANCEL_UNINSTALL': { actions: 'cancelUninstall' },
        'UI.UNINSTALL': { actions: 'sendUninstall' },
        'UI.TOGGLE_ENABLED': { actions: 'sendToggleEnabled' },
        'UI.SELECT_PACK': { actions: 'selectPack' },
        'UI.BACK': { actions: 'clearSelection' },
        'UI.DISMISS_ERROR': { actions: 'dismissError' },
        'UI.REFRESH': { actions: 'sendRefresh' },
        'UI.UPDATE_APP': { actions: ['setUpdating', 'sendAppUpdate'] },
        'UI.UPDATE': { actions: ['setUpdating', 'sendUpdate'] },
        'UI.CHECK_UPDATES': { actions: 'sendCheckUpdates' },
        'UI.RESTORE_CONTENT': { actions: 'sendRestoreContent' },
        'UI.DISMISS_OFFER': { actions: 'sendDismissOffer' },
        'UI.DELETE_CONTENT': { actions: 'sendDeleteContent' },
      },
    },
  },
});

export type PacksState = ActorRefFrom<typeof packsState>;
export default packsState;
