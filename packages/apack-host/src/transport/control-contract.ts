/**
 * Browser-safe Host Control RPC contract and typed client factory.
 *
 * Rides on `@apackdev/host/transport/mux`'s Control lane (`'C' + JSON`) so Electron renderer windows,
 * local tools, and `@app/server` share one contract without pulling Node-only or backend-only modules
 * into browser bundles.
 */
import type { PerformanceRecordingReport, RecordingMode } from '../diagnostics/index.ts';
import type { LoadedPackEntry, PackCatalogFrame } from '../packs/index.ts';
import type { SecretProvider, SecretsSnapshot } from '@apackdev/sdk/services';
import {
  createControlClient,
  type ControlClient,
  type ControlContract,
  type ControlLane,
} from './mux.ts';

export interface SettingsPackIdentity {
  readonly id: string;
  readonly registrationId: string;
  readonly declarationRevision: string;
  readonly buildRevision: string;
}

export interface SettingsMutationEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

/**
 * Typed Control RPC contract shared between host dispatchers and window/tool clients.
 */
export interface HostControlContract extends ControlContract {
  readonly requests: {
    readonly 'secrets.list': { readonly input: void; readonly output: SecretsSnapshot };
    readonly 'secrets.add': {
      readonly input: { readonly provider: SecretProvider; readonly label: string; readonly value: string };
      readonly output: SecretsSnapshot;
    };
    readonly 'secrets.replaceValue': {
      readonly input: { readonly id: string; readonly value: string };
      readonly output: SecretsSnapshot;
    };
    readonly 'secrets.select': { readonly input: { readonly id: string }; readonly output: SecretsSnapshot };
    readonly 'secrets.rename': {
      readonly input: { readonly id: string; readonly label: string };
      readonly output: SecretsSnapshot;
    };
    readonly 'secrets.delete': { readonly input: { readonly id: string }; readonly output: SecretsSnapshot };
    readonly 'secrets.allowUnprotected': { readonly input: void; readonly output: SecretsSnapshot };
    readonly 'settings.openHost': { readonly input: void; readonly output: { readonly credential: string } };
    readonly 'settings.openPack': {
      readonly input: SettingsPackIdentity;
      readonly output: { readonly credential: string };
    };
    readonly 'settings.close': { readonly input: { readonly credential: string }; readonly output: void };
    readonly 'settings.mutate': {
      readonly input: { readonly credential: string; readonly event: SettingsMutationEvent };
      readonly output: void;
    };
    readonly 'packs.loaded': { readonly input: void; readonly output: LoadedPackEntry[] };
    readonly 'packs.clientReady': {
      readonly input: { readonly packId: string; readonly registrationId: string };
      readonly output: void;
    };
    readonly 'performance.start': {
      readonly input: { readonly mode: RecordingMode; readonly startup?: boolean };
      readonly output: void;
    };
    readonly 'performance.stop': { readonly input: void; readonly output: PerformanceRecordingReport };
    readonly 'dev.reload': { readonly input: { readonly packId: string }; readonly output: { readonly ok: true } };
    readonly 'dev.install': {
      readonly input: { readonly root: string };
      readonly output: { readonly ok: true; readonly packId?: string };
    };
  };
  readonly subscriptions: {
    readonly 'packs.catalog': { readonly input: void; readonly output: PackCatalogFrame };
  };
}

/**
 * Attaches a typed Host Control RPC client to `lane`.
 */
export function createHostControlClient(lane: ControlLane): ControlClient<HostControlContract> {
  return createControlClient<HostControlContract>(lane);
}
