import { boundHost, _boundHostGeneration, type HostRuntimeServices } from '../runtime/host-runtime.ts';
import { createSends, untypedBroadcastToSurface, untypedSendToWindow, untypedSendToSystem } from '../events/index.ts';
import { resolveRegistered } from '../ids/refs.ts';
import { createLogger, type Logger } from '../logger/logger.ts';
import type { AppDataService } from './app-data.ts';
import type { OnboardingService } from './onboarding.ts';
import type { RunHistory } from './run-history.ts';
import type { InferenceService } from './inference.ts';
import type { SecretsService } from './secrets.ts';
import type { FilesystemService } from './filesystem.ts';
import type { SettingsService } from './settings.ts';
import type { SettingsAdmin } from './settings.ts';
import type { SettingsTarget } from '../types/settings.ts';
import { _settingsHandle } from './settings-handle.ts';

export type { AppDataService, BackupDatabase, BackupSummary } from './app-data.ts';
export type { OnboardingService } from './onboarding.ts';
export { UnknownBackupDatabasesError } from './app-data.ts';
export {
  _createRunHistory, _RUN_HISTORY_SCHEMA, type RunHistory, type RunPage, type RunStatus, type RunTree,
  type RunNode, type RunNodeBase, type FlowRunNode, type EventRunNode, type StepRunNode, type RunNodeId, type RunNodeStart, type RunNodePatch,
} from './run-history.ts';
export { _createInferenceService, type _InferenceModels, type InferenceService, type OutputSchema, type OutputSpec, type _ResolveModel } from './inference.ts';
export type { FileEntry, FileStat, FilesystemService } from './filesystem.ts';
export type { SettingsChange, SettingsService, SettingsAdmin } from './settings.ts';
export type { SecretMetadata, SecretProvider, SecretsProtection, SecretsService, SecretsSnapshot, SecretsStatus } from './secrets.ts';
export { _secretRules, _secretProviderLabel, _toSecretMetadata } from './secrets-rules.ts';
export type { ModelId, ProviderName } from './models.ts';
export { embedPending, embedSearchText, type EmbedPendingResult } from './embeddings.ts';

const logger = createLogger('log-service');

/**
 * The entity type a short code belongs to, from the prefixes the SDK and the bound app's registered packs declare:
 * `THR-41` → `Thread`, undefined for a code that isn't `<prefix>-<n>` or whose prefix no registered type numbers
 * with. For a code whose type isn't known — one a user typed, or one found in text — the entity is then the typed
 * query: `untypedQuery(type).where('shortCode', code).first()`.
 */
export const entityTypeOfShortCode = (code: string): string | undefined => boundHost().packs.entityTypeOfShortCode(code);

/** The bound app's registered packs' repositories, by name; reading one no pack declares throws */
export const repository: Record<string, unknown> = new Proxy({}, {
  get(_target, name) {
    if (typeof name !== 'string') return undefined;
    const value = boundHost().packs.repository(name);
    if (value === undefined) {
      throw new Error(`[repository] "${name}" is not registered: a pack declares its repositories in apack.json (features[].repositories)`);
    }
    return value;
  },
});

/**
 * Supported host APIs. Generated Services selects the baseline and explicitly consumed members;
 * this inventory does not imply that every pack receives every API.
 */
export interface HostServices {
  logger: Logger;
  /**
   * Sends to surfaces and systems. Both name a feature `<packId>/<featureId>` — the action's own pack included,
   * and the host's (`host/application`); `sendToSystem` also takes a role (`{ role: 'brain' }`), which reaches
   * whichever system plays it — a flow event goes to the brain as `TRIGGER_BRAIN_EVENT`. A pack's `Services`
   * types them with its own and its dependencies' events.
   *
   * Naming its own pack is the point, not a gap left by the action having no pack scope.
   * An action is content, not source: a row a user can edit in the Actions surface, read in the DB console,
   * export to a content file and copy into another pack. A bare name would rebind on that copy — `'threads'`
   * quietly meaning the new pack's feature, or nothing — where a ref that no longer fits is wrong visibly, and
   * is refused at the bus rather than doing something else.
   *
   * What an action sends does say where it came from: the pack running it in `Message.from` and the action in
   * `Message.via` (`createActionEmitter`). Saying so and resolving names are separate — the first is a label on
   * the message, the second would change what a name means.
   */
  emitter: {
    broadcastToSurface: typeof untypedBroadcastToSurface;
    /**
     * To that surface on one connection, which the caller supplies. A handler is handed the connection it
     * is serving; an action is handed nothing, so it has one only if something passed it in a payload —
     * nothing does today, which is why this has no caller yet rather than why it would fail.
     */
    sendToWindow: typeof untypedSendToWindow;
    sendToSystem: typeof untypedSendToSystem;
  };
  repository: typeof repository;
  /** Completion of the app's onboarding, independent of preferences and database administration */
  onboarding: OnboardingService;
  /** Reset, back up and restore the app's stored data */
  appData: AppDataService;
  /** Flow runs: each run's tree of nodes, recorded while it runs and kept after it ends */
  runHistory: RunHistory;
  /** Model calls (text, agents, embeddings, images, speech, transcription, reranking) with the user's provider keys */
  inference: InferenceService;
  /** The user's API keys, without their values: list, select, rename, delete */
  secrets: SecretsService;
  /** Files and folders on the user's disk */
  filesystem: FilesystemService;
  /** Caller-bound access to app, pack/group and feature preferences */
  settings: SettingsService;
}

/** An action names every feature by its ref, its own pack's included, and the ref must be a registered one */
const actionRef = (kind: 'system' | 'surface', name: string, registered: readonly string[]) =>
  resolveRegistered(kind, name, { registered, form: `actions name a ${kind} "<packId>/<featureId>"` });

/** Who an action's sends say they are. Both fields are labels: nothing routes or refuses on either. */
export interface ActionSender {
  /** The pack whose code is running the action, stamped as `Message.from` */
  from: string;
  /**
   * The running action, as `action:<label>` — the same string that names its logger, so a dropped send and that
   * action's own log lines share something to grep for. Stamped as `Message.via`.
   */
  via: string;
}

/**
 * The emitter an action runs with: the sends of `HostServices`, stamped with the pack running the action and the
 * action itself. The host creates one for each named action view, retaining the accepted pack's lifetime.
 *
 * Without a `sender` it is `services.emitter`: the sends any pack code reaches through `services`, stamping
 * nothing, since only the pack that ran the action knows which action it was.
 *
 * Its names stay refs either way. Binding an identity for the stamp must not make a bare name resolve: an action
 * is content, not source — a row a user edits, exports and copies into another pack, where `'threads'` would
 * quietly mean the new pack's feature, or nothing.
 */
export function createActionEmitter(sender?: ActionSender): HostServices['emitter'] {
  const sends = createSends(sender);
  return {
    broadcastToSurface: (name, event) => sends.broadcastToSurface(actionRef('surface', name, boundHost().packs.surfaceIds()), event),
    sendToWindow: (client, name, event) => sends.sendToWindow(client, actionRef('surface', name, boundHost().packs.surfaceIds()), event),
    sendToSystem: (to, event, options) => sends.sendToSystem(typeof to === 'string' ? actionRef('system', to, boundHost().packs.systemIds()) : to, event, options),
  };
}

const emitter: HostServices['emitter'] = createActionEmitter();

export { _settingsHandle } from './settings-handle.ts';

/** @internal Host administration over the shared SDK instance, including the published test harness. */
export function _settingsAdmin(): SettingsAdmin {
  return boundHost().services.settings;
}

/** Host-selected APIs and attributed action views sharing one accepted runtime lifetime. */
export interface PackServiceAccess {
  readonly services: Readonly<Record<string, unknown>>;
  readonly servicesForAction: (label: string) => Readonly<Record<string, unknown>>;
}

/** @internal Capture the host behind an accepted service binding, without ambient redirection. */
export function _captureHostServices() {
  const runtime = boundHost();
  const generation = _boundHostGeneration();
  return {
    current: () => _boundHostGeneration() === generation,
    forAction(sender: ActionSender) {
      return { logger: createLogger(sender.via), emitter: createActionEmitter(sender) };
    },
    get(name: string): unknown {
      if (name === 'logger') return logger;
      if (name === 'emitter') return emitter;
      if (name === 'repository') return repository;
      return runtime.services[name as keyof HostRuntimeServices];
    },
  };
}

/** @internal Generated runtimes receive the host-selected facade only after acceptance. */
export function _createPackServices() {
  const createBinding = () => {
    let source: PackServiceAccess | undefined;
    let revoked = false;
    const subscriptions = new Set<() => void>();
    const accepted = () => {
      if (revoked) throw new Error('Pack service binding has been revoked');
      if (!source) throw new Error('Pack services are unavailable until the host accepts this runtime');
      return source;
    };
    const settings = (): SettingsService => accepted().services.settings as SettingsService;
    const service: SettingsService = {
      get: target => settings().get(target),
      set: (target, path, value, condition) => settings().set(target, path, value, condition),
      reset: target => settings().reset(target),
      onChange: listener => {
        const stop = settings().onChange(change => { if (!revoked) listener(change); });
        const unsubscribe = () => { if (subscriptions.delete(unsubscribe)) stop(); };
        subscriptions.add(unsubscribe);
        return unsubscribe;
      },
    };
    const facade = new Proxy({} as Readonly<Record<string, unknown>> & { readonly settings: SettingsService }, {
      get(_, key) { const current = accepted().services; return key === 'settings' ? service : Reflect.get(current, key); },
      ownKeys: () => Reflect.ownKeys(accepted().services),
      has: (_, key) => Object.hasOwn(accepted().services, key),
      getOwnPropertyDescriptor(_, key) {
        const current = accepted().services;
        if (!Object.hasOwn(current, key)) return;
        return { configurable: true, enumerable: true, value: key === 'settings' ? service : Reflect.get(current, key) };
      },
    });
    return {
      service, facade,
      servicesForAction: (label: string) => accepted().servicesForAction(label),
      bind(services: PackServiceAccess) {
        if (source) throw new Error('Pack services are already bound');
        source = services;
      },
      revoke() {
        revoked = true;
        const errors: unknown[] = [];
        for (const stop of subscriptions) {
          try { stop(); } catch (error) { errors.push(error); }
        }
        if (errors.length) throw new AggregateError(errors, 'Could not release all pack settings subscriptions');
      },
    };
  };
  let binding = createBinding();
  return {
    // Handles and root views retain their construction frame.
    settingsHandle: <T>(target: SettingsTarget) => _settingsHandle<T>(target, binding.service),
    get services() { return binding.facade; },
    get servicesForAction() { return binding.servicesForAction; },
    bindServices(services: PackServiceAccess): () => void {
      const accepted = binding;
      accepted.bind(services);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        binding = createBinding();
        accepted.revoke();
      };
    },
  };
}
