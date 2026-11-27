import { describe, expect, it, vi } from 'vitest';
import { createNodePerformanceController } from '@apackdev/host/diagnostics/node';
import type { PerformanceRecordingReport } from '@apackdev/host/diagnostics';
import { createContributionCatalog, type LoadedPackEntry, type PackCatalogFrame, type PackOrigin } from '@apackdev/host/packs';
import { createSettingsAccess, SettingsRefusedError } from '@apackdev/host/settings';
import {
  ControlRpcError,
  muxTransport,
  type ControlClient,
  type ControlServer,
  type MuxedTransport,
  type RawMessage,
  type RawTransport,
} from '@apackdev/host/transport/mux';
import type { SecretMetadata, SecretProvider, SecretsSnapshot, SettingsAdmin } from '@apackdev/sdk/services';
import {
  createHostControlClient,
  createHostControlServer,
  createHostPerformanceControl,
  type HostControlContract,
  type HostControlDevDeps,
  type HostControlPacksDeps,
  type HostControlPerformanceDeps,
  type HostControlSecretsDeps,
  type HostControlServerDeps,
  type HostControlSettingsDeps,
  type HostStartupPerformance,
} from '../../src/transport/control-rpc.ts';

/** Deterministic in-memory bidirectional `RawTransport` pair (microtask delivery, no timers). */
function createMemoryPair(): { readonly a: RawTransport; readonly b: RawTransport } {
  const ends = [0, 1].map(() => {
    const dataListeners: Array<(data: RawMessage) => void> = [];
    const closeListeners: Array<() => void> = [];
    let closed = false;
    const fireClose = () => {
      if (closed) return;
      closed = true;
      dataListeners.length = 0;
      for (const listener of closeListeners.splice(0)) listener();
    };
    return {
      dataListeners,
      closeListeners,
      isClosed: () => closed,
      fireClose,
      deliverData(data: RawMessage) {
        if (closed) return;
        for (const listener of dataListeners.slice()) {
          if (closed) break;
          listener(data);
        }
      },
    };
  });

  const make = (mine: 0 | 1): RawTransport => {
    const here = ends[mine]!;
    const there = ends[1 - mine]!;
    return {
      send(data) {
        if (here.isClosed()) return;
        queueMicrotask(() => there.deliverData(data));
      },
      onData(listener) {
        if (here.isClosed()) return;
        here.dataListeners.push(listener);
      },
      onClose(listener) {
        if (here.isClosed()) {
          listener();
          return;
        }
        here.closeListeners.push(listener);
      },
      close() {
        if (here.isClosed()) return;
        here.fireClose();
        queueMicrotask(() => there.fireClose());
      },
    };
  };

  return { a: make(0), b: make(1) };
}

async function flushMicrotasks(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await Promise.resolve();
  }
}

async function expectRpcError(
  promise: Promise<unknown>,
  code: string,
  messagePattern?: RegExp,
): Promise<ControlRpcError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ControlRpcError);
    const rpcError = error as ControlRpcError;
    expect(rpcError.code).toBe(code);
    if (messagePattern) expect(rpcError.message).toMatch(messagePattern);
    return rpcError;
  }
  throw new Error(`Expected ControlRpcError(${code}) but promise resolved`);
}

function createFakeSecretsDeps(): {
  readonly deps: HostControlSecretsDeps;
  readonly values: Map<string, string>;
} {
  let seq = 0;
  let protection: SecretsSnapshot['status']['protection'] = 'os-keystore';
  const records: SecretMetadata[] = [];
  const values = new Map<string, string>();

  const snapshot = (): SecretsSnapshot => ({
    secrets: records.map((entry) => ({ ...entry })),
    status: { protection, backend: 'test-vault' },
  });

  const deps: HostControlSecretsDeps = {
    snapshot,
    add(provider: SecretProvider, label: string, value: string) {
      seq += 1;
      const id = `Secret-${seq}`;
      const selected = !records.some((entry) => entry.provider === provider && entry.selected);
      const created: SecretMetadata = { id, provider, label, selected, createdAt: seq * 100 };
      records.push(created);
      values.set(id, value);
      return created;
    },
    replaceValue(id: string, value: string) {
      const target = records.find((entry) => entry.id === id);
      if (!target) throw new Error(`No stored key "${id}"`);
      values.set(id, value);
      target.updatedAt = 999;
    },
    select(id: string) {
      const target = records.find((entry) => entry.id === id);
      if (!target) throw new Error(`No stored key "${id}"`);
      for (const entry of records) {
        if (entry.provider === target.provider) entry.selected = entry.id === id;
      }
    },
    rename(id: string, label: string) {
      const target = records.find((entry) => entry.id === id);
      if (!target) throw new Error(`No stored key "${id}"`);
      target.label = label;
    },
    delete(id: string) {
      const idx = records.findIndex((entry) => entry.id === id);
      if (idx === -1) throw new Error(`No stored key "${id}"`);
      records.splice(idx, 1);
      values.delete(id);
    },
    allowUnprotected() {
      protection = 'unprotected';
    },
  };

  return { deps, values };
}

function createDefaultPacksDeps(): {
  readonly deps: HostControlPacksDeps;
  readonly catalog: ReturnType<typeof createContributionCatalog>;
  readonly runtimes: Map<string, string>;
  readonly readyCalls: Array<{ packId: string; registrationId: string }>;
  setLoaded(entries: LoadedPackEntry[]): void;
} {
  const catalog = createContributionCatalog({ schema: { type: 'object' }, defaults: {} });
  const runtimes = new Map<string, string>();
  const readyCalls: Array<{ packId: string; registrationId: string }> = [];
  let loadedEntries: LoadedPackEntry[] = [];

  const deps: HostControlPacksDeps = {
    getCatalogFrame: (): PackCatalogFrame => ({ runId: 'run-test', snapshot: catalog.getSnapshot() }),
    onCatalogChanged: (listener) => catalog.onChanged(listener),
    loaded: () => loadedEntries,
    getRegistrationId: (packId) => runtimes.get(packId),
    onClientReady: (packId, registrationId) => {
      readyCalls.push({ packId, registrationId });
    },
  };

  return {
    deps,
    catalog,
    runtimes,
    readyCalls,
    setLoaded(entries) {
      loadedEntries = entries;
    },
  };
}

function createNoopSettingsDeps(): HostControlSettingsDeps {
  return {
    openHost: () => 'host-cred',
    openPack: () => 'pack-cred',
    close: () => {},
    mutate: () => {},
    releaseConnection: () => {},
  };
}

interface PairedHarness {
  readonly client: ControlClient<HostControlContract>;
  readonly server: ControlServer;
  readonly clientMux: MuxedTransport;
  readonly serverMux: MuxedTransport;
}

function createPairedConnection(overrides: Partial<HostControlServerDeps> = {}): PairedHarness {
  const pair = createMemoryPair();
  const clientMux = muxTransport(pair.a);
  const serverMux = muxTransport(pair.b);
  const deps: HostControlServerDeps = {
    connectionId: overrides.connectionId ?? 'conn-1',
    secrets: overrides.secrets ?? createFakeSecretsDeps().deps,
    settings: overrides.settings ?? createNoopSettingsDeps(),
    packs: overrides.packs ?? createDefaultPacksDeps().deps,
    ...(overrides.performance !== undefined ? { performance: overrides.performance } : {}),
    ...(overrides.dev !== undefined ? { dev: overrides.dev } : {}),
  };
  const server = createHostControlServer(serverMux.control, deps);
  const client = createHostControlClient(clientMux.control);
  return { client, server, clientMux, serverMux };
}

describe('Host Control RPC (packages/server/src/transport/control-rpc.ts)', () => {
  describe('secrets.*', () => {
    it('round-trips all 7 secrets RPCs over muxTransport without leaking values', async () => {
      const secrets = createFakeSecretsDeps();
      const { client, clientMux } = createPairedConnection({ secrets: secrets.deps });

      try {
        const initial = await client.call('secrets.list');
        expect(initial).toEqual({
          secrets: [],
          status: { protection: 'os-keystore', backend: 'test-vault' },
        });

        const afterFirstAdd = await client.call('secrets.add', {
          provider: 'anthropic',
          label: 'Work',
          value: 'sk-ant-work-secret',
        });
        expect(afterFirstAdd.secrets).toHaveLength(1);
        expect(afterFirstAdd.secrets[0]).toMatchObject({
          provider: 'anthropic',
          label: 'Work',
          selected: true,
        });
        expect('value' in afterFirstAdd.secrets[0]!).toBe(false);
        const firstId = afterFirstAdd.secrets[0]!.id;
        expect(secrets.values.get(firstId)).toBe('sk-ant-work-secret');

        const afterSecondAdd = await client.call('secrets.add', {
          provider: 'anthropic',
          label: 'Personal',
          value: 'sk-ant-personal-secret',
        });
        expect(afterSecondAdd.secrets).toHaveLength(2);
        const secondId = afterSecondAdd.secrets[1]!.id;

        const afterReplace = await client.call('secrets.replaceValue', {
          id: firstId,
          value: 'sk-ant-rotated-secret',
        });
        expect(afterReplace.secrets[0]!.updatedAt).toBe(999);
        expect(secrets.values.get(firstId)).toBe('sk-ant-rotated-secret');

        const afterSelect = await client.call('secrets.select', { id: secondId });
        expect(afterSelect.secrets.find((entry) => entry.id === secondId)?.selected).toBe(true);
        expect(afterSelect.secrets.find((entry) => entry.id === firstId)?.selected).toBe(false);

        const afterRename = await client.call('secrets.rename', { id: secondId, label: 'Primary' });
        expect(afterRename.secrets.find((entry) => entry.id === secondId)?.label).toBe('Primary');

        const afterDelete = await client.call('secrets.delete', { id: firstId });
        expect(afterDelete.secrets.map((entry) => entry.id)).toEqual([secondId]);

        const afterUnprotected = await client.call('secrets.allowUnprotected');
        expect(afterUnprotected.status.protection).toBe('unprotected');
      } finally {
        clientMux.close();
      }
    });

    it('enforces input bounds and never echoes secret values in validation or handler errors', async () => {
      const secrets = createFakeSecretsDeps();
      const throwingSecret = 'sk-never-echo-this-secret-value-987654';
      const poisonedDeps: HostControlSecretsDeps = {
        ...secrets.deps,
        add(provider, label, value) {
          if (value === throwingSecret) {
            throw new Error(`Keychain rejected secret ${value} for ${provider}:${label}`);
          }
          return secrets.deps.add(provider, label, value);
        },
        replaceValue(id, value) {
          if (value === throwingSecret) {
            throw new ControlRpcError('INTERNAL_ERROR', `Failed writing ${value} into ${id}`);
          }
          return secrets.deps.replaceValue(id, value);
        },
      };

      const { client, clientMux } = createPairedConnection({ secrets: poisonedDeps });

      try {
        // Provider validation
        await expectRpcError(
          client.call('secrets.add', { provider: '' as SecretProvider, label: 'Work', value: 'sk-1' }),
          'BAD_REQUEST',
        );
        await expectRpcError(
          client.call('secrets.add', { provider: 'unsupported' as SecretProvider, label: 'Work', value: 'sk-1' }),
          'BAD_REQUEST',
        );

        // Label bounds (1..100)
        await expectRpcError(
          client.call('secrets.add', { provider: 'openai', label: '', value: 'sk-1' }),
          'BAD_REQUEST',
        );
        await expectRpcError(
          client.call('secrets.add', { provider: 'openai', label: 'a'.repeat(101), value: 'sk-1' }),
          'BAD_REQUEST',
        );
        await expectRpcError(
          client.call('secrets.rename', { id: 'Secret-1', label: '' }),
          'BAD_REQUEST',
        );
        await expectRpcError(
          client.call('secrets.rename', { id: 'Secret-1', label: 'b'.repeat(101) }),
          'BAD_REQUEST',
        );

        // Value bounds (1..10000) — oversized secret value must never appear in error message
        const oversizedSecret = `sk-secret-prefix-${'x'.repeat(10_000)}`;
        const addOversizedErr = await expectRpcError(
          client.call('secrets.add', { provider: 'openai', label: 'Work', value: oversizedSecret }),
          'BAD_REQUEST',
        );
        expect(addOversizedErr.message).not.toContain('sk-secret-prefix-');

        await expectRpcError(
          client.call('secrets.add', { provider: 'openai', label: 'Work', value: '' }),
          'BAD_REQUEST',
        );

        const replaceOversizedErr = await expectRpcError(
          client.call('secrets.replaceValue', { id: 'Secret-1', value: oversizedSecret }),
          'BAD_REQUEST',
        );
        expect(replaceOversizedErr.message).not.toContain('sk-secret-prefix-');

        await expectRpcError(
          client.call('secrets.replaceValue', { id: '', value: 'sk-valid' }),
          'BAD_REQUEST',
        );
        await expectRpcError(
          client.call('secrets.select', { id: '' }),
          'BAD_REQUEST',
        );
        await expectRpcError(
          client.call('secrets.delete', { id: '' }),
          'BAD_REQUEST',
        );

        // Underlying store errors must also scrub the secret value
        const addStoreErr = await expectRpcError(
          client.call('secrets.add', { provider: 'openai', label: 'Work', value: throwingSecret }),
          'INTERNAL_ERROR',
        );
        expect(addStoreErr.message).not.toContain(throwingSecret);
        expect(addStoreErr.message).toContain('[REDACTED]');

        const replaceStoreErr = await expectRpcError(
          client.call('secrets.replaceValue', { id: 'Secret-1', value: throwingSecret }),
          'INTERNAL_ERROR',
        );
        expect(replaceStoreErr.message).not.toContain(throwingSecret);
        expect(replaceStoreErr.message).toContain('[REDACTED]');
      } finally {
        clientMux.close();
      }
    });
  });

  describe('settings.*', () => {
    it('enforces connection-scoped credentials, strict keys, and idempotent lease release on lane close', async () => {
      const packStamp = {
        id: 'consumer',
        registrationId: 'reg-1',
        declarationRevision: 'decl-1',
        buildRevision: 'build-1',
      };
      const origin: PackOrigin = {
        ...packStamp,
        name: 'Consumer',
        version: '1.0.0',
        dir: '/fixture/consumer',
      };
      const fakeAdmin = {
        forPack: () => ({}),
      } as unknown as SettingsAdmin;

      const access = createSettingsAccess(fakeAdmin, (id) =>
        id === packStamp.id ? { origin, registrationId: packStamp.registrationId } : null,
      );

      const mutations: Array<{ connectionId: string; kind: 'host' | 'pack'; type: string }> = [];
      const releaseSpy = vi.fn((connectionId: string) => {
        access.releaseClient(connectionId);
      });

      const sharedSettings: HostControlSettingsDeps = {
        openHost: (connectionId) => access.issueHost(connectionId),
        openPack: (connectionId, expected) => access.issuePack(connectionId, expected),
        close: (connectionId, credential) => access.revoke(connectionId, credential),
        mutate: (connectionId, credential, event) => {
          const resolved = access.resolve(connectionId, credential);
          mutations.push({ connectionId, kind: resolved.kind, type: event.type });
        },
        releaseConnection: releaseSpy,
      };

      const first = createPairedConnection({ connectionId: 'window-1', settings: sharedSettings });
      const second = createPairedConnection({ connectionId: 'window-2', settings: sharedSettings });

      try {
        const { credential: hostCred } = await first.client.call('settings.openHost');
        const { credential: packCred } = await first.client.call('settings.openPack', packStamp);

        // Strict key rejection on settings.openPack and settings.close
        await expectRpcError(
          first.client.call('settings.openPack', { ...packStamp, extra: 'nope' } as typeof packStamp),
          'BAD_REQUEST',
          /unexpected property/,
        );
        await expectRpcError(
          first.client.call('settings.close', { credential: hostCred, extra: true } as { credential: string }),
          'BAD_REQUEST',
          /unexpected property/,
        );

        // Unregistered pack runtime maps SettingsRefusedError -> FORBIDDEN
        await expectRpcError(
          first.client.call('settings.openPack', { ...packStamp, registrationId: 'stale-reg' }),
          'FORBIDDEN',
        );

        // Authority comes strictly from connection-scoped credential, never payload fields
        await first.client.call('settings.mutate', {
          credential: packCred,
          event: { type: 'UPDATE_SETTINGS', access: { kind: 'host' }, from: 'host' },
        });
        await first.client.call('settings.mutate', {
          credential: hostCred,
          event: { type: 'RESET_ALL_SETTINGS' },
        });
        expect(mutations).toEqual([
          { connectionId: 'window-1', kind: 'pack', type: 'UPDATE_SETTINGS' },
          { connectionId: 'window-1', kind: 'host', type: 'RESET_ALL_SETTINGS' },
        ]);

        // Cross-connection credential rejected with FORBIDDEN
        await expectRpcError(
          second.client.call('settings.mutate', {
            credential: hostCred,
            event: { type: 'UPDATE_SETTINGS' },
          }),
          'FORBIDDEN',
        );

        // Missing/empty event.type rejected with BAD_REQUEST
        await expectRpcError(
          first.client.call('settings.mutate', {
            credential: hostCred,
            event: { type: '' },
          }),
          'BAD_REQUEST',
        );

        // Explicit close revokes the credential
        await first.client.call('settings.close', { credential: packCred });
        await expectRpcError(
          first.client.call('settings.mutate', {
            credential: packCred,
            event: { type: 'UPDATE_SETTINGS' },
          }),
          'FORBIDDEN',
        );

        // Closing the lane automatically releases remaining connection leases (exactly once)
        first.clientMux.close();
        await flushMicrotasks();

        expect(releaseSpy).toHaveBeenCalledTimes(1);
        expect(releaseSpy).toHaveBeenCalledWith('window-1');
        expect(() => access.resolve('window-1', hostCred)).toThrow(SettingsRefusedError);

        // Calling server.dispose() after lane.close() is idempotent
        first.server.dispose();
        first.server.dispose();
        expect(releaseSpy).toHaveBeenCalledTimes(1);
      } finally {
        first.clientMux.close();
        second.clientMux.close();
      }
    });

    it('releases connection leases idempotently when server.dispose() runs before lane.close()', async () => {
      const releaseSpy = vi.fn();
      const settings: HostControlSettingsDeps = {
        ...createNoopSettingsDeps(),
        releaseConnection: releaseSpy,
      };
      const harness = createPairedConnection({ connectionId: 'conn-dispose', settings });

      harness.server.dispose();
      harness.server.dispose();
      harness.clientMux.close();
      await flushMicrotasks();

      expect(releaseSpy).toHaveBeenCalledTimes(1);
      expect(releaseSpy).toHaveBeenCalledWith('conn-dispose');
    });
  });

  describe('packs.*', () => {
    it('pushes immediate catalog snapshot, streams updates in FIFO order, and cleans up on unsubscribe and lane close', async () => {
      const packs = createDefaultPacksDeps();
      packs.catalog.setNative([
        {
          id: 'native-pack',
          features: { view: { description: 'Fixture.', surface: { label: 'Initial', state: 's.ts' } } },
        },
      ]);

      const { client, server, clientMux } = createPairedConnection({ packs: packs.deps });
      const received: PackCatalogFrame[] = [];

      try {
        const sub = client.subscribe('packs.catalog', undefined, {
          onData(frame) {
            received.push(frame);
          },
        });

        await flushMicrotasks();
        expect(received).toHaveLength(1);
        expect(received[0]!.runId).toBe('run-test');
        expect(received[0]!.snapshot.native[0]!.features?.view.surface?.label).toBe('Initial');
        expect(server.activeSubscriptionCount).toBe(1);

        // Synchronous mutations emit immediately in FIFO order so catalog updates stay ahead of link broadcasts
        for (let i = 1; i <= 5; i += 1) {
          packs.catalog.setNative([
            {
              id: 'native-pack',
              features: { view: { description: 'Fixture.', surface: { label: `Burst-${i}`, state: 's.ts' } } },
            },
          ]);
        }
        await flushMicrotasks();

        expect(received).toHaveLength(6);
        expect(received.at(-1)!.snapshot.native[0]!.features?.view.surface?.label).toBe('Burst-5');

        // Unsubscribing removes the listener so further updates are not sent
        sub.unsubscribe();
        await flushMicrotasks();
        expect(server.activeSubscriptionCount).toBe(0);

        packs.catalog.setNative([
          {
            id: 'native-pack',
            features: { view: { description: 'Fixture.', surface: { label: 'After-Unsub', state: 's.ts' } } },
          },
        ]);
        await flushMicrotasks();
        expect(received).toHaveLength(6);

        // Closing the lane also cleans up an active subscription listener
        const onChangedSpy = vi.fn();
        const unsubscribeSpy = vi.fn();
        const secondPacks: HostControlPacksDeps = {
          ...packs.deps,
          onCatalogChanged(listener) {
            onChangedSpy(listener);
            return unsubscribeSpy;
          },
        };
        const second = createPairedConnection({ connectionId: 'conn-cat-2', packs: secondPacks });
        second.client.subscribe('packs.catalog', undefined, { onData() {} });
        await flushMicrotasks();
        expect(onChangedSpy).toHaveBeenCalledTimes(1);
        expect(unsubscribeSpy).not.toHaveBeenCalled();

        second.clientMux.close();
        await flushMicrotasks();
        expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
      } finally {
        clientMux.close();
      }
    });

    it('serves recovery-mode packs.loaded ([]) and validates packs.clientReady registrationId', async () => {
      const packs = createDefaultPacksDeps();
      packs.runtimes.set('default-setup', 'reg-live-1');

      const { client, clientMux } = createPairedConnection({ packs: packs.deps });

      try {
        // Recovery mode: no loaded packs
        expect(await client.call('packs.loaded')).toEqual([]);

        // Normal mode: returns configured entries
        const entry: LoadedPackEntry = {
          id: 'default-setup',
          name: 'Default Setup',
          version: '1.0.0',
          feEntry: 'runtime/fe.js',
          feStyles: 'runtime/fe.css',
          registrationId: 'reg-live-1',
          declarationRevision: 'decl-1',
          buildRevision: 'build-1',
        };
        packs.setLoaded([entry]);
        expect(await client.call('packs.loaded')).toEqual([entry]);

        // Matching registrationId succeeds
        await expect(
          client.call('packs.clientReady', { packId: 'default-setup', registrationId: 'reg-live-1' }),
        ).resolves.toBeUndefined();
        expect(packs.readyCalls).toEqual([{ packId: 'default-setup', registrationId: 'reg-live-1' }]);

        // Stale or missing registrationId returns CONFLICT
        await expectRpcError(
          client.call('packs.clientReady', { packId: 'default-setup', registrationId: 'reg-stale' }),
          'CONFLICT',
          /unavailable pack runtime/,
        );
        await expectRpcError(
          client.call('packs.clientReady', { packId: 'missing-pack', registrationId: 'reg-live-1' }),
          'CONFLICT',
          /unavailable pack runtime/,
        );

        // Strict key rejection
        await expectRpcError(
          client.call('packs.clientReady', {
            packId: 'default-setup',
            registrationId: 'reg-live-1',
            extra: 1,
          } as { packId: string; registrationId: string }),
          'BAD_REQUEST',
          /unexpected property/,
        );
      } finally {
        clientMux.close();
      }
    });
  });

  describe('performance.*', () => {
    it('returns FORBIDDEN when performance recording is disabled (production)', async () => {
      const { client, clientMux } = createPairedConnection();

      try {
        await expectRpcError(
          client.call('performance.start', { mode: 'lightweight' }),
          'FORBIDDEN',
          /only in development and test/,
        );
        await expectRpcError(
          client.call('performance.stop'),
          'FORBIDDEN',
          /only in development and test/,
        );
      } finally {
        clientMux.close();
      }
    });

    it('enforces single-owner CONFLICT, owner-only stop, startup adoption, and automatic release on lane close', async () => {
      const controller = createNodePerformanceController();
      const sharedPerformance = createHostPerformanceControl(controller);
      const releaseSpy = vi.spyOn(sharedPerformance, 'releaseConnection');

      const ownerConn = createPairedConnection({ connectionId: 'perf-owner', performance: sharedPerformance });
      const otherConn = createPairedConnection({ connectionId: 'perf-other', performance: sharedPerformance });

      try {
        // Invalid input rejected with BAD_REQUEST
        await expectRpcError(
          ownerConn.client.call('performance.start', { mode: 'bogus' as 'lightweight' }),
          'BAD_REQUEST',
        );
        await expectRpcError(
          ownerConn.client.call('performance.start', { mode: 'lightweight', startup: 'yes' as unknown as boolean }),
          'BAD_REQUEST',
        );

        // Stopping when idle fails with FORBIDDEN
        await expectRpcError(ownerConn.client.call('performance.stop'), 'FORBIDDEN', /does not own/);

        // Owner starts recording; other connection gets CONFLICT on start and FORBIDDEN on stop
        await ownerConn.client.call('performance.start', { mode: 'lightweight' });
        await expectRpcError(
          otherConn.client.call('performance.start', { mode: 'lightweight' }),
          'CONFLICT',
          /already active/,
        );
        await expectRpcError(
          otherConn.client.call('performance.stop'),
          'FORBIDDEN',
          /does not own/,
        );

        const span = controller.begin('app.thread.open');
        span?.end();
        const report: PerformanceRecordingReport = await ownerConn.client.call('performance.stop');
        expect(report.complete).toBe(true);

        // Start a second recording on ownerConn, then abruptly close its lane
        await ownerConn.client.call('performance.start', { mode: 'lightweight' });
        ownerConn.clientMux.close();
        await flushMicrotasks(20);

        expect(releaseSpy).toHaveBeenCalledTimes(1);
        expect(releaseSpy).toHaveBeenCalledWith('perf-owner');

        // Ownership is automatically released so another connection can now record
        await otherConn.client.call('performance.start', { mode: 'disabled' });
        const nextReport = await otherConn.client.call('performance.stop');
        expect(nextReport.complete).toBe(true);
      } finally {
        ownerConn.clientMux.close();
        otherConn.clientMux.close();
      }
    });

    it('adopts a matching startup recording once and refuses mismatched or repeated adoption', async () => {
      const controller = createNodePerformanceController();
      controller.start('lightweight');
      let available = true;
      const startup: HostStartupPerformance = {
        controller,
        adopt(mode) {
          if (!available || mode !== 'lightweight') {
            throw new Error('No matching startup recording is available');
          }
          available = false;
        },
      };
      const sharedPerformance: HostControlPerformanceDeps = createHostPerformanceControl(controller, startup);
      const conn = createPairedConnection({ connectionId: 'startup-owner', performance: sharedPerformance });

      try {
        await expectRpcError(
          conn.client.call('performance.start', { mode: 'disabled', startup: true }),
          'CONFLICT',
          /matching startup/,
        );

        await conn.client.call('performance.start', { mode: 'lightweight', startup: true });
        const report = await conn.client.call('performance.stop');
        expect(report.complete).toBe(true);

        await expectRpcError(
          conn.client.call('performance.start', { mode: 'lightweight', startup: true }),
          'CONFLICT',
          /matching startup/,
        );
      } finally {
        conn.clientMux.close();
      }
    });

    it('releases ownership if the initiating lane closes while controller.ready() is pending', async () => {
      const controller = createNodePerformanceController();
      let resolveReady!: () => void;
      const readySpy = vi.spyOn(controller, 'ready').mockReturnValueOnce(
        new Promise<void>((resolve) => { resolveReady = resolve; }),
      );
      const sharedPerformance = createHostPerformanceControl(controller);
      const first = createPairedConnection({ connectionId: 'perf-init', performance: sharedPerformance });
      const second = createPairedConnection({ connectionId: 'perf-next', performance: sharedPerformance });

      try {
        const pendingStart = first.client.call('performance.start', { mode: 'lightweight' });
        await flushMicrotasks();
        expect(readySpy).toHaveBeenCalledTimes(1);

        first.clientMux.close();
        await flushMicrotasks(20);
        resolveReady();
        await expectRpcError(pendingStart, 'TRANSPORT_CLOSED');
        await flushMicrotasks(20);

        await second.client.call('performance.start', { mode: 'disabled' });
        const report = await second.client.call('performance.stop');
        expect(report.complete).toBe(true);
      } finally {
        readySpy.mockRestore();
        first.clientMux.close();
        second.clientMux.close();
      }
    });
  });

  describe('dev.*', () => {
    it('returns FORBIDDEN for dev.reload and dev.install when disabled (production)', async () => {
      const { client, clientMux } = createPairedConnection();

      try {
        await expectRpcError(
          client.call('dev.reload', { packId: 'default-setup' }),
          'FORBIDDEN',
          /only in development and test/,
        );
        await expectRpcError(
          client.call('dev.install', { root: '/abs/path/to/pack' }),
          'FORBIDDEN',
          /only in development and test/,
        );
      } finally {
        clientMux.close();
      }
    });

    it('handles dev.reload and dev.install when enabled and rejects relative roots or unknown keys', async () => {
      const reloadCalls: string[] = [];
      const installCalls: string[] = [];
      const dev: HostControlDevDeps = {
        reload(packId) {
          reloadCalls.push(packId);
        },
        install(root) {
          installCalls.push(root);
          return root.endsWith('/named') ? { packId: 'custom-pack' } : undefined;
        },
      };

      const { client, clientMux } = createPairedConnection({ dev });

      try {
        expect(await client.call('dev.reload', { packId: 'default-setup' })).toEqual({ ok: true });
        expect(reloadCalls).toEqual(['default-setup']);

        expect(await client.call('dev.install', { root: '/tmp/packs/named' })).toEqual({
          ok: true,
          packId: 'custom-pack',
        });
        expect(await client.call('dev.install', { root: '/tmp/packs/unnamed' })).toEqual({ ok: true });
        expect(installCalls).toEqual(['/tmp/packs/named', '/tmp/packs/unnamed']);

        // Reject relative paths, empty paths, NUL bytes, and extra keys
        for (const badRoot of ['relative/pack', './pack', '../pack', '', '/tmp/bad\0path']) {
          await expectRpcError(client.call('dev.install', { root: badRoot }), 'BAD_REQUEST');
        }
        await expectRpcError(
          client.call('dev.install', { root: '/tmp/packs/ok', extra: true } as { root: string }),
          'BAD_REQUEST',
          /unexpected property/,
        );
        await expectRpcError(client.call('dev.reload', { packId: '' }), 'BAD_REQUEST');
        await expectRpcError(
          client.call('dev.reload', { packId: 'default-setup', extra: 1 } as { packId: string }),
          'BAD_REQUEST',
          /unexpected property/,
        );
        // None of the rejected inputs should reach the handler
        expect(installCalls).toEqual(['/tmp/packs/named', '/tmp/packs/unnamed']);
        expect(reloadCalls).toEqual(['default-setup']);
      } finally {
        clientMux.close();
      }
    });
  });
});
