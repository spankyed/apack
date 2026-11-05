import type { Contract } from './contract.ts';
import type { ApplicationHotkeys } from '@apackdev/sdk/types';
import { broadcastToSurface, sendToSystem } from '../../../events.ts';
import { assign, setup, fromCallback, fromPromise, type ErrorActorEvent } from 'xstate';
import { defineSystem } from '@apackdev/sdk/framework';
import { detectAllArrayChanges, errorMessage } from '@apackdev/sdk/utils/pure';
import { _captureHostServices, _settingsAdmin as preferences } from '@apackdev/sdk/services';
import type { HostRuntimeServices } from '@apackdev/sdk/runtime';
import { createLogger, reportError } from '@apackdev/sdk/logger';
import { splitRef, type FeatureRef } from '@apackdev/sdk/ids';
import { SettingsRefusedError } from '../document.ts';
import { settingsRequestAccess, settingsRequestAdmin } from './access.ts';
import { answerSettings, type SettingsAnswer } from './answer.ts';
import type { SettingsDocument } from './store.ts';

/** Host administration reads its own ports; it is not a pack's selected service facade. */
const hostService = <K extends 'appData' | 'secrets'>(name: K): HostRuntimeServices[K] =>
  _captureHostServices().get(name) as HostRuntimeServices[K];

/** Host app preferences supply shell hotkeys without a contributing pack. */
const appHotkeys = (document: SettingsDocument): ApplicationHotkeys =>
  (document.app as Partial<import('@apackdev/sdk/types').AppSettings> | undefined)?.hotkeys ?? {};

const logger = createLogger('settings');

/**
 * What a refusal answers with: the store's own reasons, which are the user's to fix rather than a system error,
 * so only what the store *didn't* refuse (a bug here) is reported as one.
 *
 * It builds the answer rather than sending it, so the handlers can answer exactly once and from outside their
 * `try` — see `updateSettings`.
 */
function refusal(error: unknown, what: string): Extract<SettingsAnswer, { type: 'SETTINGS_REFUSED' }> {
  if (!(error instanceof SettingsRefusedError)) reportError({ error: new Error(`${what}: ${(error as Error).message}`), source: 'settings' });
  return {
    type: 'SETTINGS_REFUSED',
    problems: error instanceof SettingsRefusedError ? error.problems : [(error as Error).message],
  };
}

/** Each surface's settings as they apply: what features were last told */
const appliedFeatureSettings = (): Record<string, unknown> => preferences().getRecovery() ? {} : { ...preferences().getAll().features };

/** What each feature was last told of its settings, by feature ref */
/**
 * What the settings system takes while the stored data is being replaced or reset. A read is served, since it only
 * reports what is stored; a write is refused with `reason`, because storing it would either be lost with the data or
 * be taken for a change the user made. A settings form waits for the store's answer before it says "Saved", and the
 * settings page for a read before it renders, so dropping either leaves the user waiting for good.
 */
const whileBusy = (reason: string) => ({
  SEND_STATE: { actions: 'sendSettingsStartupData' as const },
  GET_SETTINGS: { actions: 'getSettings' as const },
  UPDATE_SETTINGS: { actions: { type: 'refuseChange' as const, params: { reason } } },
  REPLACE_SETTINGS: { actions: { type: 'refuseChange' as const, params: { reason } } },
  RESET_SETTINGS: { actions: { type: 'refuseChange' as const, params: { reason } } },
  RECOVER_SETTINGS: { actions: { type: 'refuseChange' as const, params: { reason } } },
  RESET_ALL_SETTINGS: { actions: { type: 'refuseChange' as const, params: { reason } } },
});

export const settingsSpec = defineSystem<Contract>();

/**
 * Sends the settings surface all the settings, as `type` (on first load with the FAQs), and the app shell the hotkeys
 * in them: whatever changed the settings, both views follow.
 */
function broadcastSettings(type: 'SETTINGS_LOADED' | 'SETTINGS_UPDATED' | 'SETTINGS_RESET'): void {
  const recovery = preferences().getRecovery();
  if (recovery) { broadcastToSurface('settings', { type: 'SETTINGS_RECOVERY', recovery }); return; }
  const snapshot = preferences().getSnapshot();
  broadcastToSurface('settings', { type, snapshot });
  const data = snapshot.values;
  broadcastToSurface('application', { type: 'APPLICATION_HOTKEYS', hotkeys: appHotkeys(data) });
}

/** CLI path overrides, in the code surface's settings */
/** Sends the settings surface the stored API keys (no values) and how they're protected */
function sendSecrets(): void {
  broadcastToSurface('settings', { type: 'SECRETS_UPDATED', secrets: hostService('secrets').list(), status: hostService('secrets').status() });
}

export const settingsSystem = setup({
  types: settingsSpec.types,
  actors: {
    settingsWriteListener: fromCallback(({ sendBack }) => {
      const tell = (change: 'written' | 'replacing' | 'replaced') => sendBack({
        type: change === 'written' ? 'SETTINGS_WRITTEN' : change === 'replacing' ? 'DATA_REPLACING' : 'DATA_REPLACED',
      });
      return preferences().onChange(tell);
    }),
    // The host resets the whole app: stores, each pack's onInit and boot apply, migrations
    resetAppActor: fromPromise(() => hostService('appData').reset()),
  },
  guards: {
    canResetApp: ({ event }) => {
      try { settingsRequestAdmin(event); return true; }
      catch { return false; }
    },
  },
  actions: settingsSpec.actions({
    refuseUnauthorizedReset: () => broadcastToSurface('settings', {
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
          sendToSystem(to, { type: 'FEATURE_SETTINGS_UPDATED', settings, changes: detectAllArrayChanges(before ?? {}, settings) });
          broadcastToSurface(to, { type: 'FEATURE_SETTINGS_UPDATED', settings });
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
          sendToSystem(to, { type: 'FEATURE_SETTINGS_UPDATED', settings: settings ?? {}, changes: null });
          broadcastToSurface(to, { type: 'FEATURE_SETTINGS_UPDATED', settings: settings ?? {} });
        }
        return now;
      },
    }),

    // The settings surface's view of all the settings, after a change it didn't make itself
    sendSettingsUpdate: () => broadcastSettings('SETTINGS_UPDATED'),

    refuseResetWhileReplacing: () => broadcastToSurface('settings', {
      type: 'APP_RESET_FAILED',
      error: 'App data is being replaced. Reset the app once it has finished.',
    }),

    /**
     * A change the store can't take now (`whileBusy`), with the reason the state gives.
     *
     * **It names the asker's call without being given one**, which a guard-level refusal could not do if a
     * correlation lived on the event: there is no `ev` here to thread one from. `reply` stamps the call it
     * was entered under, so this answer is as identifiable as the three that read an event.
     */
    refuseChange: ({ reply }, { reason }: { reason: string }) =>
      answerSettings(reply, { type: 'SETTINGS_REFUSED', problems: [reason] }),

    getSettings: ({ reply }) => {
      const recovery = preferences().getRecovery();
      if (reply) reply(recovery ? { type: 'SETTINGS_RECOVERY', recovery } : { type: 'SETTINGS_LOADED', snapshot: preferences().getSnapshot() });
      else broadcastSettings('SETTINGS_LOADED');
    },
    
    /**
     * Whoever asked hears whether the change was stored, and why not: a settings form says "Saved" only then,
     * and a drive session's `/set-setting` answers `ok: false` only then.
     *
     * **The outcome is a value and the answer is sent once, outside the `try`.** `reply()` throws for a message
     * that named no sender, and an answer sent from inside the `try` that threw would land in the `catch`,
     * which would answer again and throw out of the action. default-setup's database system says the same
     * thing where it does the same thing.
     */
    recoverSettings: ({ event, reply }) => {
      const { request } = settingsSpec.typeOf('RECOVER_SETTINGS', event);
      let outcome: SettingsAnswer;
      try {
        settingsRequestAdmin(event).recover(request);
        outcome = { type: 'SETTINGS_RECOVERY', recovery: preferences().getRecovery()! };
      } catch (error) { outcome = refusal(error, "The settings weren't repaired"); }
      answerSettings(reply, outcome);
    },

    updateSettings: ({ event, reply }) => {
      const ev = settingsSpec.typeOf('UPDATE_SETTINGS', event);
      // A surface's settings are keyed by its ref, which the frontend resolves before sending and the store checks
      const outcome = ((): SettingsAnswer => {
        try {
          settingsRequestAccess(event).service.set(ev.target, ev.path, ev.value, ev.condition);
          return { type: 'SETTINGS_SAVED', snapshot: preferences().getSnapshot() };
        } catch (error) {
          return refusal(error, "The settings weren't saved");
        }
      })();

      answerSettings(reply, outcome);
    },

    replaceSettings: ({ event, reply }) => {
      const ev = settingsSpec.typeOf('REPLACE_SETTINGS', event);
      const outcome = ((): SettingsAnswer => {
        try {
          settingsRequestAdmin(event).replaceAll(ev.data, ev.condition);
          return { type: 'SETTINGS_SAVED', snapshot: preferences().getSnapshot() };
        } catch (error) {
          return refusal(error, "The settings weren't replaced");
        }
      })();

      answerSettings(reply, outcome);
    },

    // Answered like the other two writes: it was the one that said nothing at all on success, so a caller
    // could not tell a reset that worked from one that never arrived
    resetSettings: ({ event, reply }) => {
      const { target } = settingsSpec.typeOf('RESET_SETTINGS', event);
      const outcome = ((): SettingsAnswer => {
        try {
          settingsRequestAccess(event).service.reset(target);
          return { type: 'SETTINGS_SAVED', snapshot: preferences().getSnapshot() };
        } catch (error) {
          return refusal(error, "The settings weren't reset");
        }
      })();

      answerSettings(reply, outcome);
    },
    
    resetAllSettings: ({ event, reply }) => {
      let outcome: SettingsAnswer;
      try {
        settingsRequestAdmin(event).resetAll();
        outcome = { type: 'SETTINGS_SAVED', snapshot: preferences().getSnapshot() };
      } catch (error) { outcome = refusal(error, "The settings weren't reset"); }
      answerSettings(reply, outcome);
    },

    // The stored keys changed: the view shows what there is now. What else acts on it hears the same event.
    secretsChanged: () => sendSecrets(),

    // The commands aren't told: a reset replaces every row, and the bus follows that fact with `SEND_STATE`,
    // which is what republishes them. Only the brain needs asking, having actors to restart rather than data.
    onResetComplete: () => {
      sendToSystem({ role: 'brain' }, { type: 'RESTART_BRAIN' });
      broadcastToSurface('settings', { type: 'APP_RESET_COMPLETE' });
    },

    onResetFailed: ({ event }) => {
      const err = (event as unknown as ErrorActorEvent).error;
      const message = errorMessage(err);
      logger.error('Reset app failed', { error: err });
      broadcastToSurface('settings', { type: 'APP_RESET_FAILED', error: message });
    },

  }),
}).createMachine({
  id: 'settings',
  initial: 'idle',
  context: { applied: {} },
  entry: 'rememberAppliedSettings',
  invoke: { src: 'settingsWriteListener' },
  on: {
    SECRETS_CHANGED: { actions: 'secretsChanged' },
  },
  states: {
    idle: {
      on: {
        SEND_STATE: {
          actions: 'sendSettingsStartupData',
        },
        GET_SETTINGS: {
          actions: 'getSettings',
        },
        // Every write reaches the features it changed through here, whoever made it
        SETTINGS_WRITTEN: { actions: ['sendSettingsUpdate', 'tellChangedFeatures'] },
        // Still a fact handler, and `sendSettingsUpdate` is why: this surface takes `SETTINGS_LOADED` only
        // while it is loading and `SETTINGS_UPDATED` once ready, so what publishing means here depends on
        // the receiver's state. The ask covers the first; this covers the second and the features whose defaults came or went
        PACK_CHANGED: { actions: ['sendSettingsUpdate', 'tellChangedFeatures'] },
        DATA_REPLACING: { target: 'replacingData' },
        UPDATE_SETTINGS: {
          actions: 'updateSettings',
        },
        REPLACE_SETTINGS: {
          actions: 'replaceSettings',
        },
        RESET_SETTINGS: {
          actions: 'resetSettings',
        },
        RECOVER_SETTINGS: { actions: 'recoverSettings' },
        RESET_ALL_SETTINGS: { actions: 'resetAllSettings' },
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
      entry: 'sendSettingsUpdate',
      on: {
        ...whileBusy('App data is being replaced. Change the settings once it has finished.'),
        DATA_REPLACED: { target: 'idle', actions: ['sendSettingsUpdate', 'tellEveryFeature'] },
        RESET_APP: { actions: 'refuseResetWhileReplacing' },
      },
    },
    // Serialized single-in-flight reset. Any further RESET_APP events are
    // ignored here; the frontend is about to full-reload on APP_RESET_COMPLETE.
    resetting: {
      tags: ['resetting'],
      on: whileBusy('The app is being reset. Change the settings once it has finished.'),
      invoke: {
        src: 'resetAppActor',
        // Writes and pack changes made by the reset aren't told as changes: tellEveryFeature re-baselines once it ends,
        // however it ends, since a reset that failed partway changed some of the data and settings already
        onDone: {
          target: 'idle',
          actions: ['sendSettingsUpdate', 'tellEveryFeature', 'onResetComplete'],
        },
        onError: {
          target: 'idle',
          actions: ['sendSettingsUpdate', 'tellEveryFeature', 'onResetFailed'],
        },
      },
    },
  },
});

export const settingsEntry = { spec: settingsSpec, machine: settingsSystem };

/** The host `settings` system, as the app registers it */
export const createSettingsSystem = () => settingsSystem;
