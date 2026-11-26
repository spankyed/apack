/**
 * Typed off-bus Host Control RPC contract and server dispatcher.
 *
 * Rides on `@apackdev/host/transport/mux`'s Control lane (`'C' + JSON`) so both Electron window
 * `MessagePort` connections and local-tool Unix socket / Windows named pipe connections speak one
 * validated, connection-scoped contract for host-only operations (secrets, settings access & mutations,
 * pack catalog/readiness, dev/test performance recordings, and dev pack reload/install).
 */
import * as path from 'node:path';
import type { PerformanceRecordingReport, RecordingMode } from '@apackdev/host/diagnostics';
import type { LoadedPackEntry, PackCatalogFrame } from '@apackdev/host/packs';
import { SettingsRefusedError } from '@apackdev/host/settings';
import {
  ControlRpcError,
  createControlServer,
  type ControlLane,
  type ControlServer,
} from '@apackdev/host/transport/mux';
import {
  createHostControlClient,
  type HostControlContract,
  type SettingsMutationEvent,
  type SettingsPackIdentity,
} from '@apackdev/host/transport/control-contract';
import { providerLabels } from '@apackdev/sdk/models';
import { _RECORDING_MODES } from '@apackdev/sdk/runtime';
import type { SecretMetadata, SecretProvider, SecretsSnapshot } from '@apackdev/sdk/services';

export { createHostControlClient };
export type { HostControlContract, SettingsMutationEvent, SettingsPackIdentity };

const SECRET_LABEL_MIN_LENGTH = 1;
const SECRET_LABEL_MAX_LENGTH = 100;
const SECRET_VALUE_MIN_LENGTH = 1;
const SECRET_VALUE_MAX_LENGTH = 10_000;

const VALID_SECRET_PROVIDERS: ReadonlySet<string> = new Set([
  ...Object.keys(providerLabels),
  'custom',
]);

const VALID_RECORDING_MODES: ReadonlySet<string> = new Set(_RECORDING_MODES);

const SETTINGS_OPEN_PACK_KEYS: ReadonlySet<string> = new Set([
  'id',
  'registrationId',
  'declarationRevision',
  'buildRevision',
]);
const SETTINGS_CLOSE_KEYS: ReadonlySet<string> = new Set(['credential']);
const SETTINGS_MUTATE_KEYS: ReadonlySet<string> = new Set(['credential', 'event', 'sender', 'call', 'from']);
const PACKS_CLIENT_READY_KEYS: ReadonlySet<string> = new Set(['packId', 'registrationId']);
const DEV_RELOAD_KEYS: ReadonlySet<string> = new Set(['packId']);
const DEV_INSTALL_KEYS: ReadonlySet<string> = new Set(['root']);

export interface HostControlSecretsDeps {
  snapshot(): SecretsSnapshot | Promise<SecretsSnapshot>;
  add(
    provider: SecretProvider,
    label: string,
    value: string,
  ): SecretMetadata | void | Promise<SecretMetadata | void>;
  replaceValue(id: string, value: string): void | Promise<void>;
  select(id: string): void | Promise<void>;
  rename(id: string, label: string): void | Promise<void>;
  delete(id: string): void | Promise<void>;
  allowUnprotected(): void | Promise<void>;
}

export interface HostControlSettingsMutateMeta {
  readonly sender?: string;
  readonly call?: string;
  readonly from?: string;
}

export interface HostControlSettingsDeps {
  openHost(connectionId: string): string | Promise<string>;
  openPack(connectionId: string, expected: SettingsPackIdentity): string | Promise<string>;
  close(connectionId: string, credential: string): void | Promise<void>;
  mutate(
    connectionId: string,
    credential: string,
    event: SettingsMutationEvent,
    meta?: HostControlSettingsMutateMeta,
  ): void | Promise<void>;
  releaseConnection(connectionId: string): void;
}

export interface HostControlPacksDeps {
  getCatalogFrame(): PackCatalogFrame;
  onCatalogChanged(listener: () => void): () => void;
  loaded(): LoadedPackEntry[] | Promise<LoadedPackEntry[]>;
  getRegistrationId(packId: string): string | undefined;
  onClientReady(packId: string, registrationId: string): void | Promise<void>;
}

export interface HostControlPerformanceDeps {
  start(
    connectionId: string,
    args: { readonly mode: RecordingMode; readonly startup?: boolean },
    signal: AbortSignal,
  ): void | Promise<void>;
  stop(connectionId: string): Promise<PerformanceRecordingReport>;
  releaseConnection(connectionId: string): void;
}

export interface HostControlDevDeps {
  reload(packId: string): void | Promise<void>;
  install(root: string): { readonly packId?: string } | void | Promise<{ readonly packId?: string } | void>;
}

export interface HostControlServerDeps {
  readonly connectionId: string;
  readonly secrets: HostControlSecretsDeps;
  readonly settings: HostControlSettingsDeps;
  readonly packs: HostControlPacksDeps;
  readonly performance?: HostControlPerformanceDeps;
  readonly dev?: HostControlDevDeps;
}

/** Structural slice of `@apackdev/host/diagnostics/node`'s performance controller. */
export interface HostPerformanceController {
  start(mode: RecordingMode): void;
  ready(): Promise<void>;
  stop(): Promise<PerformanceRecordingReport>;
}

/** Structural slice of `createStartupPerformance` for adopting a test startup capture. */
export interface HostStartupPerformance {
  readonly controller: HostPerformanceController;
  adopt(mode: RecordingMode): void;
}

interface RecordingOwner {
  readonly connectionId: string;
  stopping: boolean;
}

/**
 * Coordinates single-connection ownership for host performance recordings across all active control
 * connections. One instance is shared across connections; each connection passes its `connectionId`
 * and calls `releaseConnection` on teardown.
 */
export function createHostPerformanceControl(
  controller: HostPerformanceController,
  startup?: HostStartupPerformance,
): HostControlPerformanceDeps {
  let owner: RecordingOwner | undefined;

  const release = (claim: RecordingOwner): void => {
    if (owner === claim) owner = undefined;
  };

  const stopAndRelease = (claim: RecordingOwner): void => {
    if (claim.stopping) return;
    claim.stopping = true;
    // Ownership is held until stop() settles so a recording started in between belongs to its own claim.
    try {
      void controller.stop().finally(() => { release(claim); }).catch(() => {});
    } catch {
      release(claim);
    }
  };

  return {
    async start(connectionId, args, signal) {
      if (owner) {
        throw new ControlRpcError('CONFLICT', 'A performance recording is already active');
      }
      if (signal.aborted) {
        throw new ControlRpcError('BAD_REQUEST', 'The connection is closed');
      }
      if (args.startup) {
        if (!startup || startup.controller !== controller) {
          throw new ControlRpcError('CONFLICT', 'No startup recording is available');
        }
        try {
          startup.adopt(args.mode);
        } catch {
          throw new ControlRpcError('CONFLICT', 'No matching startup recording is available');
        }
      } else {
        controller.start(args.mode);
      }

      const claim: RecordingOwner = { connectionId, stopping: false };
      owner = claim;

      try {
        await controller.ready();
      } catch (error) {
        stopAndRelease(claim);
        throw error;
      }

      if (signal.aborted) {
        if (owner === claim) stopAndRelease(claim);
        throw new ControlRpcError('BAD_REQUEST', 'The connection is closed');
      }
    },

    async stop(connectionId) {
      const claim = owner;
      if (!claim || claim.connectionId !== connectionId || claim.stopping) {
        throw new ControlRpcError('FORBIDDEN', 'This connection does not own the performance recording');
      }
      claim.stopping = true;
      try {
        return await controller.stop();
      } finally {
        release(claim);
      }
    },

    releaseConnection(connectionId) {
      const claim = owner;
      if (!claim || claim.connectionId !== connectionId) return;
      stopAndRelease(claim);
    },
  };
}

function asPlainObject(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ControlRpcError('BAD_REQUEST', `${context}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function assertStrictKeys(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  context: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new ControlRpcError('BAD_REQUEST', `${context}: unexpected property "${key}"`);
    }
  }
}

function assertBoundedString(
  value: unknown,
  field: string,
  min: number,
  max?: number,
): string {
  if (typeof value !== 'string') {
    throw new ControlRpcError('BAD_REQUEST', `${field} must be a string`);
  }
  if (value.length < min) {
    throw new ControlRpcError(
      'BAD_REQUEST',
      `${field} must be at least ${min} character${min === 1 ? '' : 's'}`,
    );
  }
  if (max !== undefined && value.length > max) {
    throw new ControlRpcError('BAD_REQUEST', `${field} must be at most ${max} characters`);
  }
  return value;
}

function assertSecretProvider(value: unknown): SecretProvider {
  if (typeof value !== 'string' || !VALID_SECRET_PROVIDERS.has(value)) {
    throw new ControlRpcError('BAD_REQUEST', 'provider must be a supported secret provider');
  }
  return value as SecretProvider;
}

function assertRecordingMode(value: unknown): RecordingMode {
  if (typeof value !== 'string' || !VALID_RECORDING_MODES.has(value)) {
    throw new ControlRpcError('BAD_REQUEST', 'mode must be a valid recording mode');
  }
  return value as RecordingMode;
}

function scrubSecretError(error: unknown, secretValue: string): ControlRpcError {
  const code = error instanceof ControlRpcError ? error.code : 'INTERNAL_ERROR';
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = secretValue.length > 0 && rawMessage.includes(secretValue)
    ? rawMessage.replaceAll(secretValue, '[REDACTED]')
    : rawMessage;
  return new ControlRpcError(code, message);
}

function mapSettingsError(error: unknown): never {
  if (error instanceof ControlRpcError) throw error;
  if (error instanceof SettingsRefusedError) {
    throw new ControlRpcError('FORBIDDEN', error.message);
  }
  throw error;
}

/**
 * Attaches the off-bus Host Control RPC server dispatcher to `lane`.
 *
 * Connection-scoped resources (settings leases and any active performance recording owned by
 * `deps.connectionId`) are released atomically and at most once when `lane` closes or `dispose()` runs.
 */
export function createHostControlServer(
  lane: ControlLane,
  deps: HostControlServerDeps,
): ControlServer {
  let connectionReleased = false;

  const releaseConnection = (): void => {
    if (connectionReleased) return;
    connectionReleased = true;
    let firstError: unknown;
    let hasError = false;
    try {
      deps.settings.releaseConnection(deps.connectionId);
    } catch (error) {
      hasError = true;
      firstError = error;
    }
    try {
      deps.performance?.releaseConnection(deps.connectionId);
    } catch (error) {
      if (!hasError) {
        hasError = true;
        firstError = error;
      }
    }
    if (hasError) throw firstError;
  };

  const assertSettingsConnectionOpen = (signal: AbortSignal): void => {
    if (connectionReleased || lane.closed || signal.aborted) {
      throw new ControlRpcError('FORBIDDEN', 'The settings connection is closed.');
    }
  };

  const server = createControlServer<HostControlContract>(lane, {
    requests: {
      'secrets.list': async () => await deps.secrets.snapshot(),

      'secrets.add': async (rawInput) => {
        const obj = asPlainObject(rawInput, 'secrets.add');
        const provider = assertSecretProvider(obj.provider);
        const label = assertBoundedString(obj.label, 'label', SECRET_LABEL_MIN_LENGTH, SECRET_LABEL_MAX_LENGTH);
        const value = assertBoundedString(obj.value, 'value', SECRET_VALUE_MIN_LENGTH, SECRET_VALUE_MAX_LENGTH);
        try {
          await deps.secrets.add(provider, label, value);
          return await deps.secrets.snapshot();
        } catch (error) {
          throw scrubSecretError(error, value);
        }
      },

      'secrets.replaceValue': async (rawInput) => {
        const obj = asPlainObject(rawInput, 'secrets.replaceValue');
        const id = assertBoundedString(obj.id, 'id', 1);
        const value = assertBoundedString(obj.value, 'value', SECRET_VALUE_MIN_LENGTH, SECRET_VALUE_MAX_LENGTH);
        try {
          await deps.secrets.replaceValue(id, value);
          return await deps.secrets.snapshot();
        } catch (error) {
          throw scrubSecretError(error, value);
        }
      },

      'secrets.select': async (rawInput) => {
        const obj = asPlainObject(rawInput, 'secrets.select');
        const id = assertBoundedString(obj.id, 'id', 1);
        await deps.secrets.select(id);
        return await deps.secrets.snapshot();
      },

      'secrets.rename': async (rawInput) => {
        const obj = asPlainObject(rawInput, 'secrets.rename');
        const id = assertBoundedString(obj.id, 'id', 1);
        const label = assertBoundedString(obj.label, 'label', SECRET_LABEL_MIN_LENGTH, SECRET_LABEL_MAX_LENGTH);
        await deps.secrets.rename(id, label);
        return await deps.secrets.snapshot();
      },

      'secrets.delete': async (rawInput) => {
        const obj = asPlainObject(rawInput, 'secrets.delete');
        const id = assertBoundedString(obj.id, 'id', 1);
        await deps.secrets.delete(id);
        return await deps.secrets.snapshot();
      },

      'secrets.allowUnprotected': async () => {
        await deps.secrets.allowUnprotected();
        return await deps.secrets.snapshot();
      },

      'settings.openHost': async (_input, meta) => {
        assertSettingsConnectionOpen(meta.signal);
        try {
          const credential = await deps.settings.openHost(deps.connectionId);
          if (connectionReleased || lane.closed || meta.signal.aborted) {
            try { await deps.settings.close(deps.connectionId, credential); } catch { /* best-effort revoke */ }
            throw new ControlRpcError('FORBIDDEN', 'The settings connection is closed.');
          }
          return { credential };
        } catch (error) {
          mapSettingsError(error);
        }
      },

      'settings.openPack': async (rawInput, meta) => {
        const obj = asPlainObject(rawInput, 'settings.openPack');
        assertStrictKeys(obj, SETTINGS_OPEN_PACK_KEYS, 'settings.openPack');
        const expected: SettingsPackIdentity = {
          id: assertBoundedString(obj.id, 'id', 1),
          registrationId: assertBoundedString(obj.registrationId, 'registrationId', 1),
          declarationRevision: assertBoundedString(obj.declarationRevision, 'declarationRevision', 1),
          buildRevision: assertBoundedString(obj.buildRevision, 'buildRevision', 1),
        };
        assertSettingsConnectionOpen(meta.signal);
        try {
          const credential = await deps.settings.openPack(deps.connectionId, expected);
          if (connectionReleased || lane.closed || meta.signal.aborted) {
            try { await deps.settings.close(deps.connectionId, credential); } catch { /* best-effort revoke */ }
            throw new ControlRpcError('FORBIDDEN', 'The settings connection is closed.');
          }
          return { credential };
        } catch (error) {
          mapSettingsError(error);
        }
      },

      'settings.close': async (rawInput) => {
        const obj = asPlainObject(rawInput, 'settings.close');
        assertStrictKeys(obj, SETTINGS_CLOSE_KEYS, 'settings.close');
        const credential = assertBoundedString(obj.credential, 'credential', 1);
        try {
          await deps.settings.close(deps.connectionId, credential);
        } catch (error) {
          mapSettingsError(error);
        }
      },

      'settings.mutate': async (rawInput, meta) => {
        const obj = asPlainObject(rawInput, 'settings.mutate');
        assertStrictKeys(obj, SETTINGS_MUTATE_KEYS, 'settings.mutate');
        const credential = assertBoundedString(obj.credential, 'credential', 1);
        const eventObj = asPlainObject(obj.event, 'settings.mutate.event');
        const type = assertBoundedString(eventObj.type, 'event.type', 1);
        const event: SettingsMutationEvent = { ...eventObj, type };
        const sender = obj.sender === undefined ? undefined : assertBoundedString(obj.sender, 'sender', 1);
        const call = obj.call === undefined ? undefined : assertBoundedString(obj.call, 'call', 1);
        const from = obj.from === undefined ? undefined : assertBoundedString(obj.from, 'from', 1);
        const mutateMeta: HostControlSettingsMutateMeta | undefined = sender !== undefined || call !== undefined || from !== undefined
          ? {
              ...(sender !== undefined ? { sender } : {}),
              ...(call !== undefined ? { call } : {}),
              ...(from !== undefined ? { from } : {}),
            }
          : undefined;
        assertSettingsConnectionOpen(meta.signal);
        try {
          await deps.settings.mutate(deps.connectionId, credential, event, mutateMeta);
        } catch (error) {
          mapSettingsError(error);
        }
      },

      'packs.loaded': async () => await deps.packs.loaded(),

      'packs.clientReady': async (rawInput) => {
        const obj = asPlainObject(rawInput, 'packs.clientReady');
        assertStrictKeys(obj, PACKS_CLIENT_READY_KEYS, 'packs.clientReady');
        const packId = assertBoundedString(obj.packId, 'packId', 1);
        const registrationId = assertBoundedString(obj.registrationId, 'registrationId', 1);
        const activeRegistrationId = deps.packs.getRegistrationId(packId);
        if (activeRegistrationId === undefined || activeRegistrationId !== registrationId) {
          throw new ControlRpcError('CONFLICT', 'The frontend belongs to an unavailable pack runtime.');
        }
        await deps.packs.onClientReady(packId, registrationId);
      },

      'performance.start': async (rawInput, meta) => {
        const performance = deps.performance;
        if (!performance) {
          throw new ControlRpcError('FORBIDDEN', 'Performance recording is available only in development and test');
        }
        const obj = asPlainObject(rawInput, 'performance.start');
        const mode = assertRecordingMode(obj.mode);
        if (obj.startup !== undefined && typeof obj.startup !== 'boolean') {
          throw new ControlRpcError('BAD_REQUEST', 'startup must be a boolean');
        }
        await performance.start(
          deps.connectionId,
          obj.startup === undefined ? { mode } : { mode, startup: obj.startup },
          meta.signal,
        );
      },

      'performance.stop': async () => {
        const performance = deps.performance;
        if (!performance) {
          throw new ControlRpcError('FORBIDDEN', 'Performance recording is available only in development and test');
        }
        return await performance.stop(deps.connectionId);
      },

      'dev.reload': async (rawInput) => {
        const dev = deps.dev;
        if (!dev) {
          throw new ControlRpcError('FORBIDDEN', 'Pack development requests are available only in development and test');
        }
        const obj = asPlainObject(rawInput, 'dev.reload');
        assertStrictKeys(obj, DEV_RELOAD_KEYS, 'dev.reload');
        const packId = assertBoundedString(obj.packId, 'packId', 1);
        await dev.reload(packId);
        return { ok: true };
      },

      'dev.install': async (rawInput) => {
        const dev = deps.dev;
        if (!dev) {
          throw new ControlRpcError('FORBIDDEN', 'Pack development requests are available only in development and test');
        }
        const obj = asPlainObject(rawInput, 'dev.install');
        assertStrictKeys(obj, DEV_INSTALL_KEYS, 'dev.install');
        const root = assertBoundedString(obj.root, 'root', 1);
        if (root.includes('\0') || !path.isAbsolute(root)) {
          throw new ControlRpcError('BAD_REQUEST', 'root must be an absolute path');
        }
        const result = await dev.install(root);
        return result?.packId !== undefined ? { ok: true, packId: result.packId } : { ok: true };
      },
    },

    subscriptions: {
      'packs.catalog': {
        coalesce: true,
        subscribe: (_input, sink) => {
          const publish = (): void => {
            if (sink.closed) return;
            sink.push(deps.packs.getCatalogFrame());
          };
          const stop = deps.packs.onCatalogChanged(publish);
          publish();
          return stop;
        },
      },
    },
  });

  lane.onClose(releaseConnection);

  return {
    get activeRequestCount() {
      return server.activeRequestCount;
    },
    get activeSubscriptionCount() {
      return server.activeSubscriptionCount;
    },
    dispose() {
      let firstError: unknown;
      let hasError = false;
      try {
        server.dispose();
      } catch (error) {
        hasError = true;
        firstError = error;
      }
      try {
        releaseConnection();
      } catch (error) {
        if (!hasError) {
          hasError = true;
          firstError = error;
        }
      }
      if (hasError) throw firstError;
    },
  };
}
