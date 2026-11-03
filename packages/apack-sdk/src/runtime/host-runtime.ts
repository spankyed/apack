import type { PerformanceExecution } from './performance.ts';
// The one port between the SDK and the app it runs in: the resources a running app owns, bound once per
// process. Behaviour over them (sends, logging, error reports, `services`) is SDK code.
import type { CallReport, Ears } from '@apackdev/ears';
import { _bindEars } from '../ears/index.ts';
import { setSecretValueMatcher } from '../utils/redact.ts';
import type { RootEvents } from './root-events.ts';
import type { AppDataService } from '../services/app-data.ts';
import type { OnboardingService } from '../services/onboarding.ts';
import type { RunHistory } from '../services/run-history.ts';
import type { InferenceService } from '../services/inference.ts';
import type { SecretsService } from '../services/secrets.ts';
import type { FilesystemService } from '../services/filesystem.ts';
import type { SettingsAdmin } from '../services/settings.ts';
import type { PackRegistryView } from './packs-view.ts';

/** The app's EARS engine as a program is handed it: its operations, without `admin` (`createEarsEngine` from `@apackdev/ears`) */
export type { Ears } from '@apackdev/ears';

/** What the app implements and packs call through `services` */
export interface HostRuntimeServices {
  /** Reset, back up and restore the app's stored data */
  appData: AppDataService;
  /** Completion of the app's onboarding */
  onboarding: OnboardingService;
  /** Flow runs, recorded while they run and kept after */
  runHistory: RunHistory;
  /** Model calls with the user's provider keys */
  inference: InferenceService;
  /** The user's API keys, as metadata */
  secrets: SecretsService;
  /** Files and folders on the user's disk */
  filesystem: FilesystemService;
  /** The app's settings: the one row, its defaults and its one writer */
  settings: SettingsAdmin;
}

/**
 * What log redaction asks whether a run of characters is one of the key values this process has used.
 * The host owns the values (its secrets store records each one it encrypts or decrypts) and binds
 * this; the SDK only reads it, so nothing can install its own and decide what counts as a secret.
 */
export interface SecretRedaction {
  matchesSecret(text: string, from: number, to: number): boolean;
}

/** What each of the app's databases was asked while counting ran: the app's data, and the run history */
export interface HostCallReports {
  app: CallReport;
  runHistory: CallReport;
}

/**
 * Counting the calls the app's engines make to their databases (`EarsAdmin.calls`, one count per engine): started,
 * then read while it runs or stopped
 */
export interface HostCallCounting {
  start(): void;
  report(): HostCallReports;
  stop(): HostCallReports;
}

/** What a development app offers for measuring its own work; no other runtime has it */
export interface HostDiagnostics {
  /** Opt-in execution context; recording policy belongs to the application composition root. */
  performance?: PerformanceExecution;
  calls: HostCallCounting;
}

/** The running app, as the SDK reaches it in a backend process */
export interface HostRuntime {
  /** The app's event bus */
  transport: { rootEvents: RootEvents };
  /** The app's engine, without `admin`: binding makes it the one `@apackdev/sdk/ears`'s operations act on */
  ears: Ears;
  /** The registered packs, read-only: their services and everything else they registered */
  packs: PackRegistryView;
  /** The running app's version (`getAppVersion()`) */
  appVersion: string;
  /** The services packs call that the app implements */
  services: HostRuntimeServices;
  /** What redaction masks in logs; absent in a runtime with no secrets of its own (tests, tooling) */
  redaction?: SecretRedaction;
  /** Measuring the app's own work; a development app's only */
  diagnostics?: HostDiagnostics;
}

let bound: HostRuntime | undefined;
let generation = 0;

/** @internal A successful bind or unbind starts a distinct host lifetime, even with the same object. */
export const _boundHostGeneration = (): number => generation;

/** Binds the running app, and its engine as the one engine operations act on (`_bindEars`); once per process */
export function bindHost(runtime: HostRuntime): void {
  if (bound) throw new Error('A host is already bound in this process: bindHost runs once, at boot');
  bound = runtime;
  generation++;
  _bindEars(runtime.ears);
  setSecretValueMatcher(runtime.redaction && ((text, from, to) => runtime.redaction!.matchesSecret(text, from, to)));
}

/** @internal Tests only: forgets the bound app and uninstalls its engine, so a test can bind another */
export function unbindHost(): void {
  bound = undefined;
  generation++;
  _bindEars(undefined);
  setSecretValueMatcher(undefined);
}

/** @internal Whether an app is bound */
export function _isHostBound(): boolean {
  return bound !== undefined;
}

/** @internal The bound app; throws, naming bindHost, when none is */
export function boundHost(): HostRuntime {
  if (!bound) {
    throw new Error('No host is bound: the app binds one at boot with bindHost(runtime) from @apackdev/sdk/runtime, and unit tests with startTestRuntime() from @apackdev/sdk/testing');
  }
  return bound;
}
