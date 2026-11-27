import type { Read } from '@apackdev/state';
import type { Contract } from './contract.ts';
import type { SettingsInternalEvents } from './types.ts';
import type { ApplicationHotkeys } from '@apackdev/sdk/types';
import type { ContractAsks, IncomingOnlyEventsOf, NormalizeAsks } from '@apackdev/sdk/events';
import type { HostLifecycleEvents, StateMatchesContract } from '@apackdev/sdk/framework';
import { broadcast as broadcastFeature, tell as tellFeature } from '../../../events.ts';
import { detectAllArrayChanges, errorMessage } from '@apackdev/sdk/utils/pure';
import { AppDataBusyError, _captureHostServices, _settingsAdmin as preferences } from '@apackdev/sdk/services';
import type { HostRuntimeServices } from '@apackdev/sdk/runtime';
import { createLogger } from '@apackdev/sdk/logger';
import { splitRef, type FeatureRef } from '@apackdev/sdk/ids';
import { SettingsRefusedError } from '../document.ts';
import { settingsRequestAccess, settingsRequestAdmin } from './access.ts';
import type { SettingsDocument } from './store.ts';
import { hostState, type HostNet } from '../../../state.ts';

/** Host administration reads its own ports; it is not a pack's selected service facade. */
const hostService = <K extends 'appData' | 'secrets'>(name: K): HostRuntimeServices[K] =>
  _captureHostServices().get(name) as HostRuntimeServices[K];

/** Host app preferences supply shell hotkeys without a contributing pack. */
const appHotkeys = (document: SettingsDocument): ApplicationHotkeys =>
  (document.app as Partial<import('@apackdev/sdk/types').AppSettings> | undefined)?.hotkeys ?? {};

const logger = createLogger('settings');

/** Each surface's settings as they apply: what features were last told */
const appliedFeatureSettings = (): Record<string, unknown> => preferences().getRecovery() ? {} : { ...preferences().getAll().features };

type SettingsBroadcast = <K extends 'settings' | 'application'>(
  to: K,
  event: Read<HostNet['surfaces'][K]['events']>,
) => void;

type RefuseSettings = (kind: 'refused', message: string, data: { problems: string[] }) => Error;

/**
 * A change to the stored settings, answered with what it stored or why it stored nothing. The store's own refusals are
 * the user's to fix; anything else it throws is a bug here, thrown named for what it stopped, which whoever asked is
 * answered with. While the stored data is being replaced or reset (`busy`) every change is refused, since storing it
 * would either be lost with the data or be taken for a change the user made — and refused rather than dropped, because
 * a settings form waits for the answer before it says "Saved".
 */
function change<T>(what: string, busy: string | undefined, refuse: RefuseSettings, write: () => T): T {
  if (busy !== undefined) throw refuse('refused', busy, { problems: [busy] });
  try {
    return write();
  } catch (error) {
    if (error instanceof SettingsRefusedError) throw refuse('refused', error.problems.join('; '), { problems: error.problems });
    throw new Error(`${what}: ${errorMessage(error)}`);
  }
}

/** The settings as they are now, which a stored change answers with */
const stored = () => ({ snapshot: preferences().getSnapshot() });

/** Why settings mutations are refused while a backup import or app reset is in flight */
function busyReason(at: 'idle' | 'replacingData' | 'resetting'): string | undefined {
  if (at === 'replacingData') return 'App data is being replaced. Change the settings once it has finished.';
  if (at === 'resetting') return 'The app is being reset. Change the settings once it has finished.';
  return undefined;
}

/**
 * Sends the settings surface all the settings, as `type` (on first load with the FAQs), and the app shell the hotkeys
 * in them: whatever changed the settings, both views follow.
 */
function broadcastSettings(type: 'SETTINGS_LOADED' | 'SETTINGS_UPDATED' | 'SETTINGS_RESET', broadcast: SettingsBroadcast): void {
  const recovery = preferences().getRecovery();
  if (recovery) { broadcast('settings', { type: 'SETTINGS_RECOVERY', recovery }); return; }
  const snapshot = preferences().getSnapshot();
  broadcast('settings', { type, snapshot });
  const data = snapshot.values;
  broadcast('application', { type: 'APPLICATION_HOTKEYS', hotkeys: appHotkeys(data) });
}

/** Sends the settings surface the stored API keys (no values) and how they're protected */
function sendSecrets(broadcast: SettingsBroadcast): void {
  broadcast('settings', { type: 'SECRETS_UPDATED', secrets: hostService('secrets').list(), status: hostService('secrets').status() });
}

/**
 * Tells each feature whose settings now differ from what it was last told, whatever changed them: a setting, the
 * settings replaced or reset, a pack's defaults coming or going, its keys moved when it registered
 */
function tellChangedFeatures(previous: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const now = appliedFeatureSettings();
  for (const feature of new Set([...Object.keys(previous), ...Object.keys(now)])) {
    const [before, after] = [previous[feature], now[feature]];
    if (!splitRef(feature) || JSON.stringify(before) === JSON.stringify(after)) continue;
    // Any pack's feature has settings: its system gets the changes too, and one it doesn't run is nobody's
    const settings = after ?? {};
    const to = feature as FeatureRef;
    tellFeature(to, { type: 'FEATURE_SETTINGS_UPDATED', settings, changes: detectAllArrayChanges(before ?? {}, settings) });
    broadcastFeature(to, { type: 'FEATURE_SETTINGS_UPDATED', settings });
  }
  return now;
}

/**
 * After the data was reset or replaced (an app reset, a backup imported), tells every feature its settings with no
 * changes: its data changed with them, so a diff across it (a tag renamed away, a mode removed) would have it
 * rewrite rows that are already gone
 */
function tellEveryFeature(): Record<string, unknown> {
  const now = appliedFeatureSettings();
  for (const [feature, settings] of Object.entries(now)) {
    if (!splitRef(feature)) continue;
    const to = feature as FeatureRef;
    tellFeature(to, { type: 'FEATURE_SETTINGS_UPDATED', settings: settings ?? {}, changes: null });
    broadcastFeature(to, { type: 'FEATURE_SETTINGS_UPDATED', settings: settings ?? {} });
  }
  return now;
}

function canResetApp(event: object): boolean {
  try { settingsRequestAdmin(event); return true; }
  catch { return false; }
}

type SettingsShape = {
  data: {
    applied: Record<string, unknown>;
  };
  internal: SettingsInternalEvents;
  states: {
    idle: {};
    replacingData: {};
    resetting: { data: { packChanged: boolean } };
  };
};

type SettingsEvent =
  | IncomingOnlyEventsOf<Contract>
  | Extract<HostLifecycleEvents, { type: 'SEND_STATE' | 'PACK_CHANGED' }>;

export const settingsSystem = hostState<
  SettingsShape,
  SettingsEvent,
  NormalizeAsks<ContractAsks<Contract>>
>()({
  data: { applied: {} },
  initial: 'idle',
  run: () => ({ data: { applied: appliedFeatureSettings() } }),
  listen: ({ send }) => {
    const announce = (kind: 'written' | 'replacing' | 'replaced') => send({
      type: kind === 'written' ? 'SETTINGS_WRITTEN' : kind === 'replacing' ? 'DATA_REPLACING' : 'DATA_REPLACED',
    });
    return preferences().onChange(announce);
  },
  answers: {
    // A read is served while busy too, since it only reports what is stored, and the settings page waits for it to render
    GET_SETTINGS: () => {
      const recovery = preferences().getRecovery();
      return recovery ? { recovery } : stored();
    },
    RECOVER_SETTINGS: (args, { snapshot, refuse }) => change("The settings weren't repaired", busyReason(snapshot.at), refuse, () => {
      settingsRequestAdmin(args).recover(args.request);
      return { recovery: preferences().getRecovery()! };
    }),
    // A surface's settings are keyed by its ref, which the frontend resolves before sending and the store checks
    UPDATE_SETTINGS: (args, { snapshot, refuse }) => change("The settings weren't saved", busyReason(snapshot.at), refuse, () => {
      settingsRequestAccess(args).service.set(args.target, args.path, args.value, args.condition);
      return stored();
    }),
    REPLACE_SETTINGS: (args, { snapshot, refuse }) => change("The settings weren't replaced", busyReason(snapshot.at), refuse, () => {
      settingsRequestAdmin(args).replaceAll(args.data, args.condition);
      return stored();
    }),
    RESET_SETTINGS: (args, { snapshot, refuse }) => change("The settings weren't reset", busyReason(snapshot.at), refuse, () => {
      settingsRequestAccess(args).service.reset(args.target);
      return stored();
    }),
    RESET_ALL_SETTINGS: (args, { snapshot, refuse }) => change("The settings weren't reset", busyReason(snapshot.at), refuse, () => {
      settingsRequestAdmin(args).resetAll();
      return stored();
    }),
  },
  on: {
    // The stored keys changed: the view shows what there is now. What else acts on it hears the same event.
    SECRETS_CHANGED: (_event, { broadcast }) => {
      sendSecrets(broadcast);
    },
    SEND_STATE: (_event, { broadcast }) => {
      broadcastSettings('SETTINGS_LOADED', broadcast);
      sendSecrets(broadcast);
    },
  },
  states: {
    idle: {
      on: {
        // Still a fact handler, and `SETTINGS_UPDATED` is why: this surface takes `SETTINGS_LOADED` only
        // while it is loading and `SETTINGS_UPDATED` once ready, so what publishing means here depends on
        // the receiver's state. The ask covers the first; this covers the second and the features whose defaults came or went
        PACK_CHANGED: (_event, { data, broadcast }) => {
          broadcastSettings('SETTINGS_UPDATED', broadcast);
          return { data: { applied: tellChangedFeatures(data.applied) } };
        },
        RESET_APP: (event, { broadcast }) => {
          if (canResetApp(event)) return { at: 'resetting', data: { packChanged: false } };
          broadcast('settings', {
            type: 'APP_RESET_FAILED',
            error: 'Resetting the app requires host-issued settings administration.',
          });
        },
      },
      internal: {
        // Every write reaches the features it changed through here, whoever made it
        SETTINGS_WRITTEN: (_event, { data, broadcast }) => {
          broadcastSettings('SETTINGS_UPDATED', broadcast);
          return { data: { applied: tellChangedFeatures(data.applied) } };
        },
        DATA_REPLACING: () => ({ at: 'replacingData' }),
      },
    },
    // A backup import is replacing the stored data. Its settings arrive past this system's writer and the migrations it
    // runs write through it, so a diff against what features were told would have them rewrite rows that came in with
    // it: nothing is told until it ends, when every feature hears its settings with no changes. A reset would race the
    // import over the same stores, so it is refused while one runs rather than started.
    replacingData: {
      run: ({ broadcast }) => {
        broadcastSettings('SETTINGS_UPDATED', broadcast);
      },
      on: {
        RESET_APP: (_event, { broadcast }) => {
          broadcast('settings', {
            type: 'APP_RESET_FAILED',
            error: 'App data is being replaced. Reset the app once it has finished.',
          });
        },
      },
      internal: {
        DATA_REPLACED: (_event, { broadcast }) => {
          broadcastSettings('SETTINGS_UPDATED', broadcast);
          return { at: 'idle', data: { applied: tellEveryFeature() } };
        },
      },
    },
    // Serialized single-in-flight reset. Any further RESET_APP events are
    // ignored here; the frontend is about to full-reload on APP_RESET_COMPLETE.
    resetting: {
      data: { packChanged: false },
      on: {
        // Track pack changes arriving while the reset is pending so a busy-refused reset reconciles on return to idle.
        PACK_CHANGED: () => ({ data: { packChanged: true } }),
      },
      // The host resets the whole app: stores, each pack's onInit and boot apply, migrations.
      // Writes and pack changes made by the reset aren't told as changes: tellEveryFeature re-baselines once it has
      // run, whether it finished or not, since a reset that failed partway changed some of the data and settings
      // already. One that never began (AppDataBusyError) changed nothing, and only reconciles pack changes that arrived
      // while resetting.
      run: async ({ broadcast, tell }) => {
        await hostService('appData').reset();
        broadcastSettings('SETTINGS_UPDATED', broadcast);
        const applied = tellEveryFeature();
        // The commands aren't told: a reset replaces every row, and the bus follows that fact with `SEND_STATE`,
        // which is what republishes them. Only the brain needs asking, having actors to restart rather than data.
        tell({ peer: 'role:brain' }, { type: 'RESTART_BRAIN' });
        broadcast('settings', { type: 'APP_RESET_COMPLETE' });
        return { at: 'idle', data: { applied } };
      },
      failed: (error, { data, broadcast }) => {
        // A reset that never began: the user is told why, and nothing is logged as having gone wrong
        if (error instanceof AppDataBusyError) {
          broadcast('settings', { type: 'APP_RESET_FAILED', error: error.message });
          if (data.packChanged) {
            broadcastSettings('SETTINGS_UPDATED', broadcast);
            return { at: 'idle', data: { applied: tellChangedFeatures(data.applied) } };
          }
          return { at: 'idle' };
        }
        broadcastSettings('SETTINGS_UPDATED', broadcast);
        const applied = tellEveryFeature();
        logger.error('Reset app failed', { error });
        broadcast('settings', { type: 'APP_RESET_FAILED', error: errorMessage(error) });
        return { at: 'idle', data: { applied } };
      },
    },
  },
});

const _contractMatches: StateMatchesContract<typeof settingsSystem, Contract> = true;
void _contractMatches;

/** The host `settings` system, as the app registers it */
export const createSettingsSystem = () => settingsSystem;
