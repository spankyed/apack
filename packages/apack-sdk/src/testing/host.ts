// The app a pack's systems, services and steps reach in unit tests, in memory: what the app binds at boot
// (openAppStore() in api/src/setup/backend.ts), minus persistence, clients and the filesystem.
import { EventEmitter } from 'node:events';
import type { SettingsAdmin } from '../services/settings.ts';
import { bindHost, type HostRuntime } from '../runtime/host-runtime.ts';
import type { PackRegistryView } from '../runtime/packs-view.ts';
import { testPacksView } from './packs.ts';
import type { RootEvents } from '../runtime/root-events.ts';
import type { Message } from '../events/index.ts';
import type { EarsDatabase, EarsEngine } from '@apackdev/ears';
import type { LogEvent, SystemErrorEvent } from '../logger/index.ts';
import { _createRunHistory, type RunHistory } from '../services/run-history.ts';
import { _openTestRunHistory } from './run-history.ts';
import type { OnboardingService } from '../services/onboarding.ts';
import type { SecretMetadata, SecretProvider, SecretsService } from '../services/secrets.ts';
import { _secretRules } from '../services/secrets-rules.ts';

/** The test app's root event bus: what clients (and the test) send the backend, and what it sends them */
export interface TestRootEvents extends RootEvents {
  emitConnected(): void;
  emitPackClientConnected(packId: string): void;
}

class TestEventBus extends EventEmitter implements TestRootEvents {
  private subscribe<A extends unknown[]>(name: string, callback: (...args: A) => void): () => void {
    const listener = (...args: unknown[]) => callback(...(args as A));
    this.on(name, listener);
    return () => { this.off(name, listener); };
  }

  emitLog(event: LogEvent): void { this.emit('log', event); }
  emitConnected(): void { this.emit('connected'); }
  emitPackClientConnected(packId: string): void { this.emit('pack-connected', packId); }
  emitIncoming(message: Message): void { this.emit('incoming', message); }
  emitSurfaceSend(message: Message): void { this.emit('surface-send', message); }
  emitOutgoing(message: Message): void { this.emit('outgoing', message); }
  onLog(callback: (event: LogEvent) => void): () => void { return this.subscribe('log', callback); }
  onConnected(callback: () => void): () => void { return this.subscribe('connected', callback); }
  onPackClientConnected(callback: (packId: string) => void): () => void { return this.subscribe('pack-connected', callback); }
  onIncoming(callback: (message: Message) => void): () => void { return this.subscribe('incoming', callback); }
  onSurfaceSend(callback: (message: Message) => void): () => void { return this.subscribe('surface-send', callback); }
  onOutgoing(callback: (message: Message) => void): () => void { return this.subscribe('outgoing', callback); }
}

/** The in-memory app's bus (the SDK's internal `_rootEvents` once started) */
export const testRootEvents: TestRootEvents = new TestEventBus();

const systemErrors: SystemErrorEvent[] = [];

// The bus prints its log events, as the app's log capture does, and records its SYSTEM_ERROR events
testRootEvents.onLog((event) => {
  console[event.level](event.source ? `[${event.source}]` : '[test]', event.message, ...(event.meta === undefined ? [] : [event.meta]));
});
testRootEvents.onOutgoing(({ event }) => {
  if (event.type === 'SYSTEM_ERROR') systemErrors.push(event as unknown as SystemErrorEvent);
});

let testSecrets: SecretMetadata[] = [];
let testSecretCount = 0;

/** Stores a key (no value: unit tests never reach a provider) as Settings → Secrets would; returns it */
export function addTestSecret(provider: SecretProvider, label: string): SecretMetadata {
  const id = `Secret-test-${++testSecretCount}`;
  testSecrets = _secretRules.add(testSecrets, { id, provider, label, createdAt: Date.now() });
  return testSecrets.find((secret) => secret.id === id)!;
}

/** Whether the test app's user finished onboarding, unless the test app is given where the app keeps it */
let onboarded = false;

const memoryOnboarding: OnboardingService = {
  isComplete: () => onboarded,
  complete: () => { onboarded = true; },
};

/** @internal Empties the test host's stored keys and starts onboarding over */
export function resetTestHostState(): void {
  testSecrets = [];
  onboarded = false;
  testHistory?.database.close();
  testHistory = undefined;
}

/** The test runtime's run history and its database, opened at its first use */
let testHistory: { database: EarsDatabase; history: RunHistory } | undefined;

/** The test runtime's run history, on a temporary database: what `services.runHistory` is until `resetTestData` replaces it */
export const testRunHistory = (): RunHistory => {
  if (!testHistory) {
    const { database, engine } = _openTestRunHistory();
    testHistory = { database, history: _createRunHistory(engine) };
  }
  return testHistory.history;
};

/** The user's keys in memory, keeping the host's rules */
const memorySecrets: SecretsService = {
  status: () => ({ protection: 'os-keystore', backend: 'memory' }),
  list: () => testSecrets.map((secret) => ({ ...secret })),
  select: (id) => { testSecrets = _secretRules.select(testSecrets, id, Date.now()); },
  rename: (id, label) => { testSecrets = _secretRules.rename(testSecrets, id, label, Date.now()); },
  delete: (id) => { testSecrets = _secretRules.remove(testSecrets, id); },
};

/** The SYSTEM_ERROR events systems reported with `reportError` (without `step`) since the last call; clears them */
export function takeSystemErrors(): SystemErrorEvent[] {
  return systemErrors.splice(0);
}

const unmockedInference = () => Promise.reject(new Error(
  "No models in unit tests: mock inference with mockInference(reply) from @apackdev/testing/harness",
));

const unmockedFilesystem = () => Promise.reject(new Error(
  "No disk access through services in unit tests: mock it with mockService('filesystem', { ... }) from @apackdev/testing/harness",
));

/**
 * The app's settings need the host's store, which the SDK doesn't have: `@apackdev/testing/harness` supplies the real
 * one (it inlines @apackdev/host), so a test running on the SDK's runtime alone says so rather than reading a fake
 * document that behaves almost like the app's.
 */
const unmockedSettings = () => {
  throw new Error(
    "The app's settings aren't available on the SDK's test runtime: run the test on @apackdev/testing/harness, which " +
    "binds the host's settings store; the harness exposes getTestSettings() for test setup",
  );
};

const memorylessSettings: SettingsAdmin = {
  get: unmockedSettings, set: unmockedSettings, reset: unmockedSettings,
  enterRecovery: unmockedSettings, getRecovery: unmockedSettings, recover: unmockedSettings,
  getAll: unmockedSettings, getSnapshot: unmockedSettings, getOverrides: unmockedSettings, replaceAll: unmockedSettings,
  removeOverrides: unmockedSettings, resetAll: unmockedSettings, whileReplacingData: unmockedSettings,
  forPack: unmockedSettings, onChange: unmockedSettings,
};

const unsupported = (name: string) => () => Promise.reject(new Error(`appData.${name} isn't supported in unit tests: there is no stored data to back up`));

export interface TestRuntimeOptions {
  /** The in-memory engine, which a reset replaces */
  engine: () => EarsEngine;
  /** Backs `appData.reset` */
  resetData: () => void;
  /** The registered packs the SDK's lookups read, under `testPacks`; none by default */
  packs?: PackRegistryView;
  /** `getAppVersion()`; `0.0.0-test` by default */
  appVersion?: string;
  /** Backs `onboarding.isComplete` and `complete`; in memory by default, emptied with the database */
  onboarding?: OnboardingService;
  /** Backs `services.settings`; without one, reading or writing settings says to run on the harness */
  settings?: SettingsAdmin;
  /** Host-port doubles owned by this test runtime; settings administration remains canonical. */
  serviceOverrides?: ReadonlyMap<string, unknown>;
}

/**
 * Binds the in-memory app: `testRootEvents` as its bus, the in-memory engine, `testPacks` over `packs`, and the app's
 * services in memory.
 */
export function bindTestRuntime({ engine, resetData, packs, appVersion = '0.0.0-test', onboarding = memoryOnboarding, settings = memorylessSettings, serviceOverrides }: TestRuntimeOptions): HostRuntime {
  const runtime: HostRuntime = {
    transport: { rootEvents: testRootEvents },
    // The current engine: a reset replaces it
    get ears() { return engine(); },
    packs: testPacksView(packs),
    appVersion,
    services: {
      onboarding,
      appData: {
        reset: async () => { resetData(); },
        exportBackup: unsupported('exportBackup'),
        importBackup: unsupported('importBackup'),
        readBackupSummary: async () => null,
      },
      get runHistory() { return testRunHistory(); },
      // No test reaches a provider: code calling a model fails until the test mocks inference
      inference: {
        generateText: unmockedInference, streamText: unmockedInference, createAgent: unmockedInference,
        embed: unmockedInference, embedMany: unmockedInference, generateImage: unmockedInference,
        generateSpeech: unmockedInference, transcribe: unmockedInference, rerank: unmockedInference,
      },
      secrets: memorySecrets,
      // Code reading or writing files through services fails until the test mocks filesystem
      filesystem: {
        writeFile: unmockedFilesystem, readFile: unmockedFilesystem, exists: unmockedFilesystem, mkdir: unmockedFilesystem,
        readDir: unmockedFilesystem, remove: unmockedFilesystem, rename: unmockedFilesystem, stat: unmockedFilesystem,
      },
      settings,
    },
  };
  if (serviceOverrides) runtime.services = new Proxy(runtime.services, {
    get(target, key, receiver) {
      return key !== 'settings' && typeof key === 'string' && Object.hasOwn(target, key) && serviceOverrides.has(key)
        ? serviceOverrides.get(key) : Reflect.get(target, key, receiver);
    },
  });
  bindHost(runtime);
  return runtime;
}
