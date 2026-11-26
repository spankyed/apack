import type { Value } from '@apackdev/state';
import type { SurfaceChrome, TrailClickEvent } from '@apackdev/sdk/fe';
import type { PackContentPreview } from '@apackdev/sdk/framework';
import { splitRef, type FeatureRef } from '@apackdev/sdk/ids';
import type { SecretMetadata, SecretsStatus } from '@apackdev/sdk/services';
import { hostState } from '../../../state.ts';
import type { OutgoingSettingsEvents } from '../be/types.ts';
import { createHelpContext, reduceHelp, type HelpContext, type HelpEvent } from './help.ts';

export const id = 'settings' as const;

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
  | { type: 'APP.RESET' };

export type SettingsEvents =
  | UIEvent
  | Extract<OutgoingSettingsEvents, { type: 'SECRETS_UPDATED' }>
  | TrailClickEvent
  | HelpEvent
  | { type: 'PACK_CONTENT_IMPORTED'; result: Record<string, { created: number; updated: number; skipped: number }>; errors: string[] }
  | { type: 'PACK_CONTENT_IMPORT_FAILED'; error: string }
  | { type: 'PACK_CONTENT_PREVIEW'; preview: PackContentPreview }
  | { type: 'PACK_CONTENT_PREVIEW_FAILED'; error: string }
  | { type: 'APP_RESET_COMPLETE' }
  | { type: 'APP_RESET_FAILED'; error: string }
  | { type: 'CLI_TEST_RESULT'; provider: string; success: boolean; error?: string; resolvedPath?: string };

/** Window operations, including explicitly authorized host administration. */
export interface SettingsIO {
  /** Submit an app reset through the trusted window connection. Completion arrives from the backend. */
  reset(): Promise<void>;
  /** Start the app over, once a reset has finished */
  restart(): void;
  /** Tell the user something went wrong */
  report(message: string): void;
}

type SettingsShape = {
  data: SettingsContext;
  states: {
    idle: {};
    resetting: {};
  };
};

export const settingsChrome: SurfaceChrome<Value<SettingsShape>> = {
  default: { label: 'Settings', target: 'idle' },
};

/**
 * The Settings surface's state, over the two acts only a window can do: starting the app over once a reset has
 * finished, and telling the user a reset failed. The renderer passes the window's; a test passes fakes.
 */
export function createSettingsMachine(io: SettingsIO) {
  return hostState<SettingsShape, SettingsEvents>()({
    initial: 'idle',
    data: {
      secrets: [],
      secretsStatus: null,
      cliTestResults: {},
      packContentImport: freshContentImport(),
      activeTab: 'general',
      help: createHelpContext(),
      generalNavItem: 'application',
      selectedFeatureId: null,
      resetting: false,
    },
    run: ({ tell }) => {
      tell('help', { type: 'GET_HELP' });
    },
    on: {
      TRAIL_CLICK: () => {},
      HELP_CATALOG: (event, { data }) => ({ data: { help: reduceHelp(data.help, event) } }),
      'HELP.OPEN': (event, { data }) => ({ data: { help: reduceHelp(data.help, event), activeTab: 'help' } }),
      'HELP.READ': (event, { data }) => ({ data: { help: reduceHelp(data.help, event) } }),
      'HELP.BACK': (event, { data }) => ({ data: { help: reduceHelp(data.help, event) } }),
      'HELP.SEARCH': (event, { data }) => ({ data: { help: reduceHelp(data.help, event) } }),
      'TAB.SELECT': (event) => ({ data: { activeTab: event.tab } }),
      'GENERAL_NAV.SELECT': (event) => ({ data: { generalNavItem: event.item } }),
      'FEATURE.SELECT': (event, { data }) => {
        // Another pack may send it, so a bad one is reported and ignored rather than stopping the settings surface
        if (!splitRef(event.featureId)) {
          console.error(`FEATURE.SELECT names "${event.featureId}", which isn't a feature's ref, "<packId>/<featureId>"`);
          return { data: { selectedFeatureId: data.selectedFeatureId } };
        }
        return { data: { selectedFeatureId: event.featureId } };
      },
      SECRETS_UPDATED: (event) => ({
        data: { secrets: event.secrets, secretsStatus: event.status },
      }),
      'CLI.TEST': (event, { data, tell }) => {
        // The code feature resolves CLIs: `resolve-cli` and the stored paths are its own
        tell({ peer: 'role:code' }, {
          type: 'TEST_CLI_PROVIDER',
          provider: event.provider,
        });
        return {
          data: {
            cliTestResults: { ...data.cliTestResults, [event.provider]: { status: 'testing' as const } },
          },
        };
      },
      CLI_TEST_RESULT: (event, { data }) => ({
        data: {
          cliTestResults: {
            ...data.cliTestResults,
            [event.provider]: {
              status: event.success ? 'success' as const : 'error' as const,
              resolvedPath: event.resolvedPath,
              error: event.error,
            },
          },
        },
      }),
      'PACK_CONTENT.PREVIEW': (event, { data, tell }) => {
        // The packs system owns content orchestration; its answers come back to this surface, which draws them
        tell('packs', {
          type: 'PREVIEW_PACK_CONTENT',
          directory: event.directory,
        });
        return {
          data: {
            packContentImport: {
              ...data.packContentImport,
              status: 'previewing' as const,
              directory: event.directory,
              preview: null,
              selection: {},
              expanded: {},
              result: null,
              errors: [],
              error: null,
            },
          },
        };
      },
      PACK_CONTENT_PREVIEW: (event, { data }) => {
        const selection = Object.fromEntries(
          Object.entries(event.preview.content).map(([key, items]) => [key, items.map(i => i.key)]),
        );
        return {
          data: {
            packContentImport: {
              ...data.packContentImport,
              status: 'selecting' as const,
              preview: event.preview,
              selection,
              expanded: {},
              result: null,
              errors: [],
              error: null,
            },
          },
        };
      },
      PACK_CONTENT_PREVIEW_FAILED: (event, { data }) => ({
        data: {
          packContentImport: {
            ...data.packContentImport,
            status: 'error' as const,
            preview: null,
            result: null,
            errors: [],
            error: event.error,
          },
        },
      }),
      'PACK_CONTENT.TOGGLE_EXPAND': (event, { data }) => ({
        data: {
          packContentImport: {
            ...data.packContentImport,
            expanded: {
              ...data.packContentImport.expanded,
              [event.key]: !data.packContentImport.expanded[event.key],
            },
          },
        },
      }),
      'PACK_CONTENT.TOGGLE_TYPE_ALL': (event, { data }) => {
        const preview = data.packContentImport.preview;
        if (!preview) return;
        const currentlySelected = data.packContentImport.selection[event.key] ?? [];
        const allKeys = (preview.content[event.key] ?? []).map(i => i.key);
        const nextSelection = currentlySelected.length === allKeys.length ? [] : allKeys;
        return {
          data: {
            packContentImport: {
              ...data.packContentImport,
              selection: {
                ...data.packContentImport.selection,
                [event.key]: nextSelection,
              },
            },
          },
        };
      },
      'PACK_CONTENT.TOGGLE_ITEM': (event, { data }) => {
        const current = data.packContentImport.selection[event.key] ?? [];
        const next = current.includes(event.item)
          ? current.filter(k => k !== event.item)
          : [...current, event.item];
        return {
          data: {
            packContentImport: {
              ...data.packContentImport,
              selection: {
                ...data.packContentImport.selection,
                [event.key]: next,
              },
            },
          },
        };
      },
      'PACK_CONTENT.SET_MODE': (event, { data }) => ({
        data: {
          packContentImport: {
            ...data.packContentImport,
            importMode: event.mode,
          },
        },
      }),
      'PACK_CONTENT.TOGGLE_RESTART_BRAIN': (_event, { data }) => ({
        data: {
          packContentImport: {
            ...data.packContentImport,
            restartBrain: !data.packContentImport.restartBrain,
          },
        },
      }),
      'PACK_CONTENT.CONFIRM_IMPORT': (_event, { data, tell }) => {
        const { directory, preview, selection, importMode, restartBrain } = data.packContentImport;
        if (!directory || !preview) return;

        // null = import all items of this key, [] = skip, string[] = filter.
        // An empty key should be skipped — not treated as "import everything".
        const toIncludeField = (key: string): string[] | null => {
          const selected = selection[key] ?? [];
          const total = preview.content[key].length;
          if (total === 0) return [];
          return selected.length === total ? null : [...selected];
        };

        tell('packs', {
          type: 'IMPORT_PACK_CONTENT',
          directory,
          include: Object.fromEntries(Object.keys(preview.content).map((key) => [key, toIncludeField(key)])),
          mode: importMode,
          restartBrain,
        });

        return {
          data: {
            packContentImport: {
              ...data.packContentImport,
              status: 'importing' as const,
              result: null,
              errors: [],
              error: null,
            },
          },
        };
      },
      'PACK_CONTENT.CANCEL': () => ({
        data: { packContentImport: freshContentImport() },
      }),
      'PACK_CONTENT.RESET_STATUS': () => ({
        data: { packContentImport: freshContentImport() },
      }),
      PACK_CONTENT_IMPORTED: (event, { data }) => ({
        data: {
          packContentImport: {
            ...data.packContentImport,
            status: 'success' as const,
            result: event.result,
            errors: event.errors,
            error: null,
          },
        },
      }),
      PACK_CONTENT_IMPORT_FAILED: (event, { data }) => ({
        data: {
          packContentImport: {
            ...data.packContentImport,
            status: 'error' as const,
            result: null,
            errors: [],
            error: event.error,
          },
        },
      }),
      APP_RESET_COMPLETE: () => {
        // Starting over is the window's act, not this machine's
        io.restart();
      },
      APP_RESET_FAILED: (event) => {
        io.report(`Reset failed: ${event.error}`);
        return { at: 'idle', data: { resetting: false } };
      },
    },
    states: {
      idle: {
        on: {
          'APP.RESET': () => ({ at: 'resetting', data: { resetting: true } }),
        },
      },
      resetting: {
        run: () => io.reset(),
        failed: (error) => {
          io.report(`Reset failed: ${String(error)}`);
          return { at: 'idle', data: { resetting: false } };
        },
        on: {
          'APP.RESET': () => {},
        },
      },
    },
  });
}

export type SettingsState = ReturnType<typeof createSettingsMachine>;
