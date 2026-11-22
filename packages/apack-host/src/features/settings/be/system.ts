import type { Contract } from './contract.ts';
import type { ApplicationHotkeys } from '@apackdev/sdk/types';
import { broadcast, tell } from '../../../events.ts';
import { assign, setup, fromCallback } from 'xstate';
import { defineSystem } from '@apackdev/sdk/framework';
import { AskError } from '@apackdev/sdk/events';
import { detectAllArrayChanges, errorMessage } from '@apackdev/sdk/utils/pure';
import { done, failed, fromOutcome, onOutcome, outcomeOf, type FailureOf, type Outcome } from '@apackdev/sdk/helpers';
import { AppDataBusyError, _captureHostServices, _settingsAdmin as preferences } from '@apackdev/sdk/services';
import type { HostRuntimeServices } from '@apackdev/sdk/runtime';
import { createLogger } from '@apackdev/sdk/logger';
import { splitRef, type FeatureRef } from '@apackdev/sdk/ids';
import { SettingsRefusedError } from '../document.ts';
import { settingsRequestAccess, settingsRequestAdmin } from './access.ts';
import type { SettingsDocument } from './store.ts';

/** Host administration reads its own ports; it is not a pack's selected service facade. */
const hostService = <K extends 'appData' | 'secrets'>(name: K): HostRuntimeServices[K] =>
  _captureHostServices().get(name) as HostRuntimeServices[K];

/** Host app preferences supply shell hotkeys without a contributing pack. */
const appHotkeys = (document: SettingsDocument): ApplicationHotkeys =>
  (document.app as Partial<import('@apackdev/sdk/types').AppSettings> | undefined)?.hotkeys ?? {};

const logger = createLogger('settings');

/**
 * How a reset of the app ended. The two failures are different facts about the user's data: `busy` is a reset
 * that never began, and `partial` one that began and stopped, with some of the data and settings already gone.
 */
type ResetOutcome = Outcome<void,
  | { readonly kind: 'busy'; readonly reason: string }
  | { readonly kind: 'partial'; readonly error: unknown }>;

/** The failure a reset's done event carries, of the kind the action reading it is wired to */
function resetFailure<K extends FailureOf<ResetOutcome>['kind']>(event: { readonly type: string }, kind: K): Extract<FailureOf<ResetOutcome>, { kind: K }> {
  const outcome = outcomeOf<ResetOutcome>(event);
  if (outcome.ok || outcome.failure.kind !== kind) throw new Error(`Expected a reset that failed as ${kind}`);
  return outcome.failure as Extract<FailureOf<ResetOutcome>, { kind: K }>;
}


/** Each surface's settings as they apply: what features were last told */
const appliedFeatureSettings = (): Record<string, unknown> => preferences().getRecovery() ? {} : { ...preferences().getAll().features };

/** What each feature was last told of its settings, by feature ref */
export const settingsSpec = defineSystem<Contract>();

/**
 * A change to the stored settings, answered with what it stored or why it stored nothing. The store's own refusals are
 * the user's to fix; anything else it throws is a bug here, thrown named for what it stopped, which whoever asked is
 * answered with. While the stored data is being replaced or reset (`busy`) every change is refused, since storing it
 * would either be lost with the data or be taken for a change the user made — and refused rather than dropped, because
 * a settings form waits for the answer before it says "Saved".
 */
function change<T>(what: string, busy: string | undefined, write: () => T): T {
  if (busy !== undefined) throw new AskError('refused', busy, { problems: [busy] });
  try {
    return write();
  } catch (error) {
    if (error instanceof SettingsRefusedError) throw new AskError('refused', error.problems.join('; '), { problems: error.problems });
    throw new Error(`${what}: ${errorMessage(error)}`);
  }
}

/** The settings as they are now, which a stored change answers with */
const stored = () => ({ snapshot: preferences().getSnapshot() });

export const answers = settingsSpec.answers({
  // A read is served while busy too, since it only reports what is stored, and the settings page waits for it to render
  GET_SETTINGS: () => {
    const recovery = preferences().getRecovery();
    return recovery ? { recovery } : stored();
  },
  RECOVER_SETTINGS: ({ args, context }) => change("The settings weren't repaired", context.busy, () => {
    settingsRequestAdmin(args).recover(args.request);
    return { recovery: preferences().getRecovery()! };
  }),
  // A surface's settings are keyed by its ref, which the frontend resolves before sending and the store checks
  UPDATE_SETTINGS: ({ args, context }) => change("The settings weren't saved", context.busy, () => {
    settingsRequestAccess(args).service.set(args.target, args.path, args.value, args.condition);
    return stored();
  }),
  REPLACE_SETTINGS: ({ args, context }) => change("The settings weren't replaced", context.busy, () => {
    settingsRequestAdmin(args).replaceAll(args.data, args.condition);
    return stored();
  }),
  RESET_SETTINGS: ({ args, context }) => change("The settings weren't reset", context.busy, () => {
    settingsRequestAccess(args).service.reset(args.target);
    return stored();
  }),
  RESET_ALL_SETTINGS: ({ args, context }) => change("The settings weren't reset", context.busy, () => {
    settingsRequestAdmin(args).resetAll();
    return stored();
  }),
});

/**
 * Sends the settings surface all the settings, as `type` (on first load with the FAQs), and the app shell the hotkeys
 * in them: whatever changed the settings, both views follow.
 */
function broadcastSettings(type: 'SETTINGS_LOADED' | 'SETTINGS_UPDATED' | 'SETTINGS_RESET'): void {
  const recovery = preferences().getRecovery();
  if (recovery) { broadcast('settings', { type: 'SETTINGS_RECOVERY', recovery }); return; }
  const snapshot = preferences().getSnapshot();
  broadcast('settings', { type, snapshot });
  const data = snapshot.values;
  broadcast('application', { type: 'APPLICATION_HOTKEYS', hotkeys: appHotkeys(data) });
}

/** CLI path overrides, in the code surface's settings */
/** Sends the settings surface the stored API keys (no values) and how they're protected */
function sendSecrets(): void {
  broadcast('settings', { type: 'SECRETS_UPDATED', secrets: hostService('secrets').list(), status: hostService('secrets').status() });
}

export const settingsSystem = setup({
  types: settingsSpec.types,
  actors: {
    settingsWriteListener: fromCallback(({ sendBack }) => {
      const announce = (change: 'written' | 'replacing' | 'replaced') => sendBack({
        type: change === 'written' ? 'SETTINGS_WRITTEN' : change === 'replacing' ? 'DATA_REPLACING' : 'DATA_REPLACED',
      });
      return preferences().onChange(announce);
    }),
    // The host resets the whole app: stores, each pack's onInit and boot apply, migrations
    // Every way it ends is an outcome, so the machine leaves `resetting` by `onDone` whatever happened
    resetAppActor: fromOutcome(async (): Promise<ResetOutcome> => {
      try {
        await hostService('appData').reset();
        return done(undefined);
      } catch (error) {
        return failed(error instanceof AppDataBusyError ? { kind: 'busy', reason: error.message } : { kind: 'partial', error });
      }
    }),
  },
  guards: {
    canResetApp: ({ event }) => {
      try { settingsRequestAdmin(event); return true; }
      catch { return false; }
    },
  },
  actions: {
    ...answers.actions,
    ...settingsSpec.actions({
    refuseUnauthorizedReset: () => broadcast('settings', {
      type: 'APP_RESET_FAILED', error: 'Resetting the app requires host-issued settings administration.',
    }),
    sendSettingsStartupData: () => {
      broadcastSettings('SETTINGS_LOADED');
      sendSecrets();
    },
    
    rememberAppliedSettings: assign({ applied: () => appliedFeatureSettings() }),

    /**
     * Tells each feature whose settings now differ from what it was last told, whatever changed them: a setting, the
     * settings replaced or reset, a pack's defaults coming or going, its keys moved when it registered
     */
    tellChangedFeatures: assign({
      applied: ({ context }) => {
        const now = appliedFeatureSettings();
        for (const feature of new Set([...Object.keys(context.applied), ...Object.keys(now)])) {
          const [before, after] = [context.applied[feature], now[feature]];
          if (!splitRef(feature) || JSON.stringify(before) === JSON.stringify(after)) continue;
          // Any pack's feature has settings: its system gets the changes too, and one it doesn't run is nobody's
          const settings = after ?? {};
          const to = feature as FeatureRef;
          tell(to, { type: 'FEATURE_SETTINGS_UPDATED', settings, changes: detectAllArrayChanges(before ?? {}, settings) });
          broadcast(to, { type: 'FEATURE_SETTINGS_UPDATED', settings });
        }
        return now;
      },
    }),

    /**
     * After the data was reset or replaced (an app reset, a backup imported), tells every feature its settings with no
     * changes: its data changed with them, so a diff across it (a tag renamed away, a mode removed) would have it
     * rewrite rows that are already gone
     */
    tellEveryFeature: assign({
      applied: () => {
        const now = appliedFeatureSettings();
        for (const [feature, settings] of Object.entries(now)) {
          if (!splitRef(feature)) continue;
          const to = feature as FeatureRef;
          tell(to, { type: 'FEATURE_SETTINGS_UPDATED', settings: settings ?? {}, changes: null });
          broadcast(to, { type: 'FEATURE_SETTINGS_UPDATED', settings: settings ?? {} });
        }
        return now;
      },
    }),

    // The settings surface's view of all the settings, after a change it didn't make itself
    sendSettingsUpdate: () => broadcastSettings('SETTINGS_UPDATED'),

    refuseResetWhileReplacing: () => broadcast('settings', {
      type: 'APP_RESET_FAILED',
      error: 'App data is being replaced. Reset the app once it has finished.',
    }),

    // The stored keys changed: the view shows what there is now. What else acts on it hears the same event.
    secretsChanged: () => sendSecrets(),

    // The commands aren't told: a reset replaces every row, and the bus follows that fact with `SEND_STATE`,
    // which is what republishes them. Only the brain needs asking, having actors to restart rather than data.
    onResetComplete: () => {
      tell({ role: 'brain' }, { type: 'RESTART_BRAIN' });
      broadcast('settings', { type: 'APP_RESET_COMPLETE' });
    },

    /** A reset that never began: the user is told why, and nothing is logged as having gone wrong */
    refuseBusyReset: ({ event }) => {
      const { reason } = resetFailure(event, 'busy');
      broadcast('settings', { type: 'APP_RESET_FAILED', error: reason });
    },

    onResetFailed: ({ event }) => {
      const { error } = resetFailure(event, 'partial');
      logger.error('Reset app failed', { error });
      broadcast('settings', { type: 'APP_RESET_FAILED', error: errorMessage(error) });
    },

  }),
  },
}).createMachine({
  id: 'settings',
  initial: 'idle',
  context: { applied: {} },
  entry: 'rememberAppliedSettings',
  invoke: { src: 'settingsWriteListener' },
  on: {
    ...answers.on,
    SECRETS_CHANGED: { actions: 'secretsChanged' },
    SEND_STATE: { actions: 'sendSettingsStartupData' },
  },
  states: {
    idle: {
      on: {
        // Every write reaches the features it changed through here, whoever made it
        SETTINGS_WRITTEN: { actions: ['sendSettingsUpdate', 'tellChangedFeatures'] },
        // Still a fact handler, and `sendSettingsUpdate` is why: this surface takes `SETTINGS_LOADED` only
        // while it is loading and `SETTINGS_UPDATED` once ready, so what publishing means here depends on
        // the receiver's state. The ask covers the first; this covers the second and the features whose defaults came or went
        PACK_CHANGED: { actions: ['sendSettingsUpdate', 'tellChangedFeatures'] },
        DATA_REPLACING: { target: 'replacingData' },
        RESET_APP: [
          { guard: 'canResetApp', target: 'resetting' },
          { actions: 'refuseUnauthorizedReset' },
        ],
      },
    },
    // A backup import is replacing the stored data. Its settings arrive past this system's writer and the migrations it
    // runs write through it, so a diff against what features were told would have them rewrite rows that came in with
    // it: nothing is told until it ends, when every feature hears its settings with no changes. A reset would race the
    // import over the same stores, so it is refused while one runs rather than started.
    replacingData: {
      entry: ['sendSettingsUpdate', assign({ busy: 'App data is being replaced. Change the settings once it has finished.' })],
      exit: assign({ busy: undefined }),
      on: {
        DATA_REPLACED: { target: 'idle', actions: ['sendSettingsUpdate', 'tellEveryFeature'] },
        RESET_APP: { actions: 'refuseResetWhileReplacing' },
      },
    },
    // Serialized single-in-flight reset. Any further RESET_APP events are
    // ignored here; the frontend is about to full-reload on APP_RESET_COMPLETE.
    resetting: {
      tags: ['resetting'],
      entry: assign({ busy: 'The app is being reset. Change the settings once it has finished.' }),
      exit: assign({ busy: undefined }),
      invoke: {
        src: 'resetAppActor',
        // Writes and pack changes made by the reset aren't told as changes: tellEveryFeature re-baselines once it has
        // run, whether it finished or not, since a reset that failed partway changed some of the data and settings
        // already. One that never began changed nothing, and has nothing to re-baseline
        onDone: onOutcome<ResetOutcome>()({
          done: { target: 'idle', actions: ['sendSettingsUpdate', 'tellEveryFeature', 'onResetComplete'] },
          failed: {
            busy: { target: 'idle', actions: 'refuseBusyReset' },
            partial: { target: 'idle', actions: ['sendSettingsUpdate', 'tellEveryFeature', 'onResetFailed'] },
          },
        }),
      },
    },
  },
});

export const settingsEntry = { spec: settingsSpec, machine: settingsSystem };

/** The host `settings` system, as the app registers it */
export const createSettingsSystem = () => settingsSystem;
