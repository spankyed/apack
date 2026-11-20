import { assign, setup, type ActorRefFrom } from 'xstate'
import breadcrumb from '@apackdev/sdk/fe'
import { safeEvents } from '@apackdev/sdk/fe'
import { type TrailClickEvent } from '@apackdev/sdk/fe'
import type { OutgoingSettingsEvents } from '../be/types.ts'
import type { SecretMetadata, SecretsStatus } from '@apackdev/sdk/services'
import { sendToSystem } from '../../../events.ts'
import type { PackContentPreview } from '@apackdev/sdk/build'
import type { FeatureRef } from '@apackdev/sdk/ids';

import { splitRef } from '@apackdev/sdk/ids';
import { createHelpContext, reduceHelp, type HelpContext, type HelpEvent } from './help.ts';

/* ─────────────────────────────────────────────────────────── */
/* Machine Types                                               */
/* ─────────────────────────────────────────────────────────── */
export const id = 'settings' as const;

// Use backend types directly

export type ImportMode = 'keep-existing' | 'replace-on-collision' | 'wipe-and-replace';

export interface PackContentImport {
  status: 'idle' | 'previewing' | 'selecting' | 'importing' | 'success' | 'error';
  directory: string | null;
  preview: PackContentPreview | null;
  /** Per content key (as the preview lists them): the item keys currently ticked. */
  selection: Record<string, string[]>;
  /** Which content key rows are currently expanded in the UI. */
  expanded: Record<string, boolean>;
  importMode: ImportMode;
  restartBrain: boolean;
  result: Record<string, { created: number; updated: number; skipped: number }> | null;
  /** Records the import couldn't write, when it finished */
  errors: string[];
  error: string | null;
}


function freshContentImport(): PackContentImport {
  return {
    status: 'idle',
    directory: null,
    preview: null,
    selection: {},
    expanded: {},
    importMode: 'replace-on-collision',
    restartBrain: false,
    result: null,
    errors: [],
    error: null,
  };
}

export interface SettingsContext {
  /** The stored API keys, without values */
  secrets: SecretMetadata[];
  secretsStatus: SecretsStatus | null;
  cliTestResults: Record<string, { status: 'idle' | 'testing' | 'success' | 'error'; resolvedPath?: string; error?: string }>;
  packContentImport: PackContentImport;
  activeTab: 'general' | 'packs' | 'features' | 'help';
  help: HelpContext;
  generalNavItem: 'personal' | 'secrets' | 'projects' | 'application' | 'json';
  selectedFeatureId: string | null;
  /** True while a RESET_APP mutation is in flight; used to disable the reset button. */
  resetting: boolean;
}

type UIEvent =
  | { type: 'TAB.SELECT'; tab: 'general' | 'packs' | 'features' | 'help' }
  | { type: 'GENERAL_NAV.SELECT'; item: 'personal' | 'secrets' | 'projects' | 'application' | 'json' }
  // A surface by its ref: other packs send it too, so a bare name would be read as this pack's
  | { type: 'FEATURE.SELECT'; featureId: FeatureRef }
  | { type: 'CLI.TEST'; provider: string }
  | { type: 'PACK_CONTENT.PREVIEW'; directory: string }
  | { type: 'PACK_CONTENT.TOGGLE_EXPAND'; key: string }
  | { type: 'PACK_CONTENT.TOGGLE_TYPE_ALL'; key: string }
  | { type: 'PACK_CONTENT.TOGGLE_ITEM'; key: string; item: string }
  | { type: 'PACK_CONTENT.SET_MODE'; mode: 'keep-existing' | 'replace-on-collision' | 'wipe-and-replace' }
  | { type: 'PACK_CONTENT.TOGGLE_RESTART_BRAIN' }
  | { type: 'PACK_CONTENT.CONFIRM_IMPORT' }
  | { type: 'PACK_CONTENT.CANCEL' }
  | { type: 'PACK_CONTENT.RESET_STATUS' }
  | { type: 'APP.RESET' }

export type SettingsEvents = UIEvent | Exclude<OutgoingSettingsEvents, { type: 'SETTINGS_LOADED' | 'SETTINGS_UPDATED' | 'SETTINGS_RESET' }> | TrailClickEvent | HelpEvent
  | { type: 'PACK_CONTENT_IMPORTED'; result: Record<string, { created: number; updated: number; skipped: number }>; errors: string[] }
  | { type: 'PACK_CONTENT_IMPORT_FAILED'; error: string }
  | { type: 'PACK_CONTENT_PREVIEW'; preview: PackContentPreview }
  | { type: 'PACK_CONTENT_PREVIEW_FAILED'; error: string }
  | { type: 'APP_RESET_COMPLETE' }
  | { type: 'APP_RESET_FAILED'; error: string }
  | { type: 'CLI_TEST_RESULT'; provider: string; success: boolean; error?: string; resolvedPath?: string }
const typeOf = safeEvents<SettingsEvents>()

/** Window operations, including explicitly authorized host administration. */
export interface SettingsIO {
  /** Submit an app reset through the trusted window connection. Completion arrives from the backend. */
  reset(): Promise<void>;
  /** Start the app over, once a reset has finished */
  restart(): void;
  /** Tell the user something went wrong */
  report(message: string): void;
}

export function createSettingsMachine(io: SettingsIO) {
  return setup({
  types: {
    context: {} as SettingsContext,
    events: {} as SettingsEvents,
  },
  actions: {
    setSecrets: assign(({ event }) => {
      const ev = typeOf('SECRETS_UPDATED', event);
      return { secrets: ev.secrets, secretsStatus: ev.status };
    }),

    updateHelp: assign(({ context, event }) => ({ help: reduceHelp(context.help, event as HelpEvent) })),

    /* ── tab navigation ────────────────────────────────── */
    selectTab: assign(({ event }) => {
      const ev = typeOf('TAB.SELECT', event);
      return {
        activeTab: ev.tab,
      }
    }),

    selectGeneralNavItem: assign(({ event }) => {
      const ev = typeOf('GENERAL_NAV.SELECT', event);
      return {
        generalNavItem: ev.item,
      }
    }),

    selectFeature: assign(({ context, event }) => {
      const ev = typeOf('FEATURE.SELECT', event);
      // Another pack may send it, so a bad one is reported and ignored rather than stopping the settings surface
      if (!splitRef(ev.featureId)) {
        console.error(`FEATURE.SELECT names "${ev.featureId}", which isn't a feature's ref, "<packId>/<featureId>"`);
        return { selectedFeatureId: context.selectedFeatureId };
      }
      return { selectedFeatureId: ev.featureId };
    }),

    testCliProvider: assign(({ context, event }) => {
      const ev = typeOf('CLI.TEST', event);
      // The code feature resolves CLIs: `resolve-cli` and the stored paths are its own
      sendToSystem({ role: 'code' }, {
        type: 'TEST_CLI_PROVIDER',
        provider: ev.provider,
      });
      return {
        cliTestResults: { ...context.cliTestResults, [ev.provider]: { status: 'testing' as const } },
      };
    }),

    setCliTestResult: assign(({ context, event }) => {
      const ev = event as { type: 'CLI_TEST_RESULT'; provider: string; success: boolean; error?: string; resolvedPath?: string };
      return {
        cliTestResults: {
          ...context.cliTestResults,
          [ev.provider]: {
            status: ev.success ? 'success' as const : 'error' as const,
            resolvedPath: ev.resolvedPath,
            error: ev.error,
          },
        },
      };
    }),

    previewPackContent: assign(({ context, event }) => {
      const ev = event as { type: 'PACK_CONTENT.PREVIEW'; directory: string };
      // The packs system owns content orchestration; its answers come back to this surface, which draws them
      sendToSystem('packs', {
        type: 'PREVIEW_PACK_CONTENT',
        directory: ev.directory,
      });
      return {
        packContentImport: {
          ...context.packContentImport,
          status: 'previewing' as const,
          directory: ev.directory,
          preview: null,
          selection: {},
          expanded: {},
          result: null,
          errors: [],
          error: null,
        },
      };
    }),

    setContentPreview: assign(({ context, event }) => {
      const ev = event as { type: 'PACK_CONTENT_PREVIEW'; preview: PackContentPreview };
      const selection = Object.fromEntries(Object.entries(ev.preview.content).map(([key, items]) => [key, items.map(i => i.key)]));
      return {
        packContentImport: {
          ...context.packContentImport,
          status: 'selecting' as const,
          preview: ev.preview,
          selection,
          expanded: {},
          result: null,
          errors: [],
          error: null,
        },
      };
    }),

    setContentPreviewFailed: assign(({ context, event }) => {
      const ev = event as { type: 'PACK_CONTENT_PREVIEW_FAILED'; error: string };
      return {
        packContentImport: {
          ...context.packContentImport,
          status: 'error' as const,
          preview: null,
          result: null,
          errors: [],
          error: ev.error,
        },
      };
    }),

    toggleContentExpand: assign(({ context, event }) => {
      const ev = event as { type: 'PACK_CONTENT.TOGGLE_EXPAND'; key: string };
      return {
        packContentImport: {
          ...context.packContentImport,
          expanded: {
            ...context.packContentImport.expanded,
            [ev.key]: !context.packContentImport.expanded[ev.key],
          },
        },
      };
    }),

    toggleContentTypeAll: assign(({ context, event }) => {
      const ev = event as { type: 'PACK_CONTENT.TOGGLE_TYPE_ALL'; key: string };
      const preview = context.packContentImport.preview;
      if (!preview) return {};
      const currentlySelected = context.packContentImport.selection[ev.key] ?? [];
      const allKeys = (preview.content[ev.key] ?? []).map(i => i.key);
      const nextSelection = currentlySelected.length === allKeys.length ? [] : allKeys;
      return {
        packContentImport: {
          ...context.packContentImport,
          selection: {
            ...context.packContentImport.selection,
            [ev.key]: nextSelection,
          },
        },
      };
    }),

    toggleContentItem: assign(({ context, event }) => {
      const ev = event as { type: 'PACK_CONTENT.TOGGLE_ITEM'; key: string; item: string };
      const current = context.packContentImport.selection[ev.key] ?? [];
      const next = current.includes(ev.item)
        ? current.filter(k => k !== ev.item)
        : [...current, ev.item];
      return {
        packContentImport: {
          ...context.packContentImport,
          selection: {
            ...context.packContentImport.selection,
            [ev.key]: next,
          },
        },
      };
    }),

    confirmContentImport: assign(({ context }) => {
      const { directory, preview, selection, importMode, restartBrain } = context.packContentImport;
      if (!directory || !preview) return {};

      // null = import all items of this key, [] = skip, string[] = filter.
      // An empty key should be skipped — not treated as "import everything".
      const toIncludeField = (key: string): string[] | null => {
        const selected = selection[key] ?? [];
        const total = preview.content[key].length;
        if (total === 0) return [];
        return selected.length === total ? null : selected;
      };

      sendToSystem('packs', {
        type: 'IMPORT_PACK_CONTENT',
        directory,
        include: Object.fromEntries(Object.keys(preview.content).map((key) => [key, toIncludeField(key)])),
        mode: importMode,
        restartBrain,
      });

      return {
        packContentImport: {
          ...context.packContentImport,
          status: 'importing' as const,
          result: null,
          errors: [],
          error: null,
        },
      };
    }),

    cancelContentImport: assign(() => ({
      packContentImport: freshContentImport(),
    })),

    setContentImported: assign(({ context, event }) => {
      const ev = event as Extract<SettingsEvents, { type: 'PACK_CONTENT_IMPORTED' }>;
      return {
        packContentImport: {
          ...context.packContentImport,
          status: 'success' as const,
          result: ev.result,
          errors: ev.errors,
          error: null,
        },
      };
    }),

    setContentImportFailed: assign(({ context, event }) => {
      const ev = event as { type: 'PACK_CONTENT_IMPORT_FAILED'; error: string };
      return {
        packContentImport: {
          ...context.packContentImport,
          status: 'error' as const,
          result: null,
          errors: [],
          error: ev.error,
        },
      };
    }),

    resetContentImportStatus: assign(() => ({
      packContentImport: freshContentImport(),
    })),
  },
  }).createMachine({
  id,
  
  initial: 'ready',
  entry: () => sendToSystem('help', { type: 'GET_HELP' }),
  on: {
    HELP_CATALOG: { actions: 'updateHelp' },
    'HELP.OPEN': { actions: ['updateHelp', assign({ activeTab: 'help' })] },
    'HELP.READ': { actions: 'updateHelp' },
    'HELP.BACK': { actions: 'updateHelp' },
    'HELP.SEARCH': { actions: 'updateHelp' },
  },
  context: () => ({
    secrets: [],
    secretsStatus: null,
    cliTestResults: {},
    packContentImport: freshContentImport(),
    activeTab: 'general',
    help: createHelpContext(),
    generalNavItem: 'application',
    selectedFeatureId: null as string | null,
    resetting: false,
  }),
  states: {
    ready: {
      meta: breadcrumb('settings', 'Settings', true),
      on: {
        'TAB.SELECT': {
          actions: 'selectTab',
        },
        'GENERAL_NAV.SELECT': {
          actions: 'selectGeneralNavItem',
        },
        'FEATURE.SELECT': {
          actions: 'selectFeature',
        },
        SECRETS_UPDATED: {
          actions: 'setSecrets',
        },
        'CLI.TEST': {
          actions: 'testCliProvider',
        },
        'CLI_TEST_RESULT': {
          actions: 'setCliTestResult',
        },
        'PACK_CONTENT.PREVIEW': {
          actions: 'previewPackContent',
        },
        'PACK_CONTENT.TOGGLE_EXPAND': {
          actions: 'toggleContentExpand',
        },
        'PACK_CONTENT.TOGGLE_TYPE_ALL': {
          actions: 'toggleContentTypeAll',
        },
        'PACK_CONTENT.TOGGLE_ITEM': {
          actions: 'toggleContentItem',
        },
        'PACK_CONTENT.SET_MODE': {
          actions: assign(({ context, event }) => ({
            packContentImport: {
              ...context.packContentImport,
              importMode: (event as any).mode,
            },
          })),
        },
        'PACK_CONTENT.TOGGLE_RESTART_BRAIN': {
          actions: assign(({ context }) => ({
            packContentImport: {
              ...context.packContentImport,
              restartBrain: !context.packContentImport.restartBrain,
            },
          })),
        },
        'PACK_CONTENT.CONFIRM_IMPORT': {
          actions: 'confirmContentImport',
        },
        'PACK_CONTENT.CANCEL': {
          actions: 'cancelContentImport',
        },
        'PACK_CONTENT.RESET_STATUS': {
          actions: 'resetContentImportStatus',
        },
        PACK_CONTENT_PREVIEW: {
          actions: 'setContentPreview',
        },
        PACK_CONTENT_PREVIEW_FAILED: {
          actions: 'setContentPreviewFailed',
        },
        PACK_CONTENT_IMPORTED: {
          actions: 'setContentImported',
        },
        PACK_CONTENT_IMPORT_FAILED: {
          actions: 'setContentImportFailed',
        },
        'APP.RESET': {
          guard: ({ context }) => !context.resetting,
          actions: [
            assign({ resetting: true }),
            ({ self }) => {
              void io.reset().catch(error => self.send({ type: 'APP_RESET_FAILED', error: String(error) }));
            },
          ],
        },
        APP_RESET_COMPLETE: {
          // Starting over is the window's act, not this machine's
          actions: () => io.restart(),
        },
        APP_RESET_FAILED: {
          actions: [
            assign({ resetting: false }),
            ({ event }) => io.report(`Reset failed: ${typeOf('APP_RESET_FAILED', event).error}`),
          ],
        },
      },
    },
    },
  });
}

/**
 * The Settings surface's machine, over the two acts only a window can do: starting the app over once a reset has
 * finished, and telling the user a reset failed. The renderer passes the window's; a test passes fakes.
 */

export type SettingsState = ActorRefFrom<ReturnType<typeof createSettingsMachine>>;
