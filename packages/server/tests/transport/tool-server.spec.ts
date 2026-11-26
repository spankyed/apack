import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { port as wrapMessagePort } from '@apackdev/link';
import type { PackCatalogFrame } from '@apackdev/host/packs';
import { SettingsRefusedError } from '@apackdev/host/settings';
import { ControlRpcError, muxTransport } from '@apackdev/host/transport/mux';
import { createHostControlClient } from '@apackdev/host/transport/control-contract';
import { connectToolClient, inspectApiRuntime, readApiRuntime } from '@apackdev/host/transport/tool-client';
import { runtimeFilePath } from '@apackdev/host/transport/tool-socket';
import {
  createLifecycleBridge,
  type LifecycleProcess,
  type UtilityMessagePort,
  type UtilityParentPort,
} from '../../src/boot/lifecycle.ts';
import type { HostControlServerDeps } from '../../src/transport/control-rpc.ts';
import { startHostTransport, type HostTransport } from '../../src/transport/tool-server.ts';

const isPosix = process.platform !== 'win32';
const cleanupDirs: string[] = [];
const activeTransports: HostTransport[] = [];

function makeTempDir(prefix = 'host-transport-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

function makeShortTmpDir(): string {
  const base = isPosix ? '/tmp' : os.tmpdir();
  const dir = fs.mkdtempSync(path.join(base, 'apack-ht-'));
  cleanupDirs.push(dir);
  return dir;
}

function trackTransport(transport: HostTransport): HostTransport {
  activeTransports.push(transport);
  return transport;
}

/** Creates an in-memory paired `UtilityMessagePort` (simulating Electron `MessageChannelMain`). */
function createMessagePortPair(): [UtilityMessagePort, UtilityMessagePort] {
  const emitterA = new EventEmitter();
  const emitterB = new EventEmitter();
  let closedA = false;
  let closedB = false;

  const portA: UtilityMessagePort = {
    on(event, listener) { emitterA.on(event, listener); },
    postMessage(data) {
      if (closedA || closedB) return;
      queueMicrotask(() => {
        if (!closedB) emitterB.emit('message', { data });
      });
    },
    start() {},
    close() {
      if (closedA) return;
      closedA = true;
      emitterA.emit('close');
    },
  };

  const portB: UtilityMessagePort = {
    on(event, listener) { emitterB.on(event, listener); },
    postMessage(data) {
      if (closedA || closedB) return;
      queueMicrotask(() => {
        if (!closedA) emitterA.emit('message', { data });
      });
    },
    start() {},
    close() {
      if (closedB) return;
      closedB = true;
      emitterB.emit('close');
    },
  };

  return [portA, portB];
}

function createFakeLifecycle() {
  const procEmitter = new EventEmitter();
  const portEmitter = new EventEmitter();
  const parentPort: UtilityParentPort = {
    on(event, listener) { portEmitter.on(event, listener); },
    postMessage() {},
  };
  const proc: LifecycleProcess = {
    on(event, listener) { procEmitter.on(event, listener); },
    parentPort,
  };
  const bridge = createLifecycleBridge(proc);
  bridge.installShutdownBridge();
  return { bridge, portEmitter };
}

function createHarnessDeps(options: { enableDev?: boolean } = {}) {
  let catalogVersion = 1;
  const catalogListeners = new Set<() => void>();
  const leases = new Map<string, string>(); // credential -> connectionId
  let nextLease = 1;
  const releasedConnections: string[] = [];
  const mutations: Array<{ connectionId: string; credential: string; event: unknown }> = [];
  const reloads: string[] = [];
  const installs: string[] = [];
  let busyPackId: string | undefined;

  const factory = (connectionId: string): HostControlServerDeps => ({
    connectionId,
    secrets: {
      snapshot: () => ({ status: { protection: 'unprotected', backend: 'file' }, secrets: [] }),
      add: () => {},
      replaceValue: () => {},
      select: () => {},
      rename: () => {},
      delete: () => {},
      allowUnprotected: () => {},
    },
    settings: {
      openHost: (conn) => {
        const credential = `host-cred-${nextLease++}`;
        leases.set(credential, conn);
        return credential;
      },
      openPack: (conn, expected) => {
        const credential = `pack-cred-${expected.id}-${nextLease++}`;
        leases.set(credential, conn);
        return credential;
      },
      close: (conn, credential) => {
        if (leases.get(credential) === conn) leases.delete(credential);
      },
      mutate: (conn, credential, event) => {
        if (leases.get(credential) !== conn) {
          throw new SettingsRefusedError(['Settings access is unavailable.']);
        }
        mutations.push({ connectionId: conn, credential, event });
      },
      releaseConnection: (conn) => {
        releasedConnections.push(conn);
        for (const [cred, owner] of Array.from(leases.entries())) {
          if (owner === conn) leases.delete(cred);
        }
      },
    },
    packs: {
      getCatalogFrame: (): PackCatalogFrame => ({
        runId: 'test-run',
        snapshot: {
          revision: catalogVersion,
          packs: [],
          problems: [],
          settings: { host: { groups: [] }, packs: {} },
          commands: [],
          appOffers: [],
        } as unknown as PackCatalogFrame['snapshot'],
      }),
      onCatalogChanged: (listener) => {
        catalogListeners.add(listener);
        return () => { catalogListeners.delete(listener); };
      },
      loaded: () => [
        {
          id: 'default-setup',
          name: 'Default Setup',
          version: '1.0.0',
          registrationId: 'reg-1',
          declarationRevision: 'decl-1',
          buildRevision: 'build-1',
          feEntry: 'runtime/fe.js',
        },
      ],
      getRegistrationId: (packId) => (packId === 'default-setup' ? 'reg-1' : undefined),
      onClientReady: () => {},
    },
    ...(options.enableDev !== false
      ? {
          dev: {
            reload: (packId) => {
              if (busyPackId === packId) {
                throw new ControlRpcError('CONFLICT', 'another operation on this pack is in progress');
              }
              reloads.push(packId);
            },
            install: (root) => {
              installs.push(root);
              return { packId: path.basename(root) };
            },
          },
        }
      : {}),
  });

  const emitCatalogChange = () => {
    catalogVersion += 1;
    for (const listener of catalogListeners) listener();
  };

  return {
    factory,
    leases,
    releasedConnections,
    mutations,
    reloads,
    installs,
    setBusyPack: (packId: string | undefined) => { busyPackId = packId; },
    emitCatalogChange,
  };
}

afterEach(async () => {
  for (const transport of activeTransports.splice(0)) {
    await transport.close();
  }
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('startHostTransport end-to-end wiring', () => {
  it('writes 0600 { pid } api-runtime.json without opening a socket in production, beta, and preview, and removes it on shutdown', async () => {
    for (const appEnv of ['production', 'beta', 'preview'] as const) {
      const appDir = makeTempDir(`prod-${appEnv}-`);
      const { bridge } = createFakeLifecycle();
      const harness = createHarnessDeps({ enableDev: false });

      const transport = trackTransport(await startHostTransport({
        appDir,
        appEnv,
        env: {},
        token: 'unused-prod-token',
        lifecycle: bridge,
        createControlDeps: harness.factory,
      }));

      expect(transport.socket).toBeUndefined();
      expect(transport.runtimeFile).toBe(runtimeFilePath(appDir));
      expect(readApiRuntime(appDir)).toEqual({ pid: process.pid });
      if (isPosix) {
        expect(fs.statSync(transport.runtimeFile).mode & 0o777).toBe(0o600);
      }

      await expect(connectToolClient({ appDir })).rejects.toThrow(/exposes no local tool socket/i);

      await transport.close();
      expect(fs.existsSync(transport.runtimeFile)).toBe(false);
      expect(inspectApiRuntime(appDir)).toEqual({ status: 'missing' });
    }
  });

  it('serves Control RPC round-trips (packs, settings, dev) over authenticated tool socket, cleans up leases on disconnect, and removes api-runtime.json on shutdown', async () => {
    const appDir = makeTempDir('dev-app-');
    const shortTmp = makeShortTmpDir();
    const { bridge } = createFakeLifecycle();
    const harness = createHarnessDeps({ enableDev: true });

    const transport = trackTransport(await startHostTransport({
      appDir,
      appEnv: 'development',
      env: {},
      tmpDir: shortTmp,
      token: 'dev-secret-token',
      lifecycle: bridge,
      createControlDeps: harness.factory,
    }));

    expect(transport.socket).toBeTruthy();
    expect(readApiRuntime(appDir)).toEqual({
      pid: process.pid,
      socket: transport.socket,
      token: 'dev-secret-token',
    });
    if (isPosix) {
      expect(fs.statSync(transport.runtimeFile).mode & 0o777).toBe(0o600);
      expect(fs.statSync(transport.socket!).mode & 0o777).toBe(0o600);
    }

    const client = await connectToolClient({ appDir });
    try {
      // packs.loaded round-trip
      const loaded = await client.control.call('packs.loaded');
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.id).toBe('default-setup');

      // packs.catalog subscription: initial snapshot + live coalesced update
      const frames: PackCatalogFrame[] = [];
      let resolveSecond!: () => void;
      const gotSecond = new Promise<void>((resolve) => { resolveSecond = resolve; });
      const sub = client.control.subscribe('packs.catalog', undefined, {
        onData: (frame) => {
          frames.push(frame);
          if (frames.length >= 2) resolveSecond();
        },
      });

      await vi.waitFor(() => expect(frames).toHaveLength(1));
      expect(frames[0]!.snapshot.revision).toBe(1);

      // Rapid burst coalesces into latest revision
      harness.emitCatalogChange();
      harness.emitCatalogChange();
      await gotSecond;
      expect(frames.at(-1)!.snapshot.revision).toBe(3);
      sub.unsubscribe();

      // dev.reload & conflict guard
      expect(await client.control.call('dev.reload', { packId: 'default-setup' })).toEqual({ ok: true });
      expect(harness.reloads).toEqual(['default-setup']);

      harness.setBusyPack('default-setup');
      await expect(client.control.call('dev.reload', { packId: 'default-setup' })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      harness.setBusyPack(undefined);

      // dev.install
      const absRoot = path.resolve(appDir, 'my-pack');
      expect(await client.control.call('dev.install', { root: absRoot })).toEqual({
        ok: true,
        packId: 'my-pack',
      });
      expect(harness.installs).toEqual([absRoot]);
      await expect(client.control.call('dev.install', { root: 'relative/pack' })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });

      // settings.* openHost + mutate + explicit close + second lease held until disconnect
      const { credential: cred1 } = await client.control.call('settings.openHost');
      await client.control.call('settings.mutate', {
        credential: cred1,
        event: { type: 'UPDATE_SETTINGS', patch: { theme: 'dark' } },
      });
      expect(harness.mutations).toHaveLength(1);
      await client.control.call('settings.close', { credential: cred1 });
      await expect(client.control.call('settings.mutate', {
        credential: cred1,
        event: { type: 'UPDATE_SETTINGS' },
      })).rejects.toMatchObject({ code: 'FORBIDDEN' });

      const { credential: leakedCred } = await client.control.call('settings.openHost');
      expect(harness.leases.has(leakedCred)).toBe(true);
    } finally {
      await client.close();
    }

    // Disconnecting the tool socket automatically releases all leases owned by that connection
    await vi.waitFor(() => {
      expect(harness.leases.size).toBe(0);
      expect(harness.releasedConnections.length).toBeGreaterThanOrEqual(1);
      expect(transport.activeToolConnectionCount).toBe(0);
    });

    // Shutting down host transport removes both the socket file and api-runtime.json
    const socketPath = transport.socket!;
    await transport.close();
    if (isPosix) {
      expect(fs.existsSync(socketPath)).toBe(false);
    }
    expect(fs.existsSync(transport.runtimeFile)).toBe(false);
  });

  it('wires window-port into HostControlServer and releases per-window leases when window-gone arrives', async () => {
    const appDir = makeTempDir('window-lifecycle-');
    const { bridge, portEmitter } = createFakeLifecycle();
    const harness = createHarnessDeps({ enableDev: false });
    const goneWindows: number[] = [];

    const transport = trackTransport(await startHostTransport({
      appDir,
      appEnv: 'production',
      env: {},
      token: 'tok',
      lifecycle: bridge,
      createControlDeps: harness.factory,
      onWindowGone: (windowId) => goneWindows.push(windowId),
    }));

    const [serverPort, rendererPort] = createMessagePortPair();
    portEmitter.emit('message', {
      data: { type: 'window-port', windowId: 42, generation: 1 },
      ports: [serverPort],
    });
    expect(transport.activeWindowCount).toBe(1);

    const rendererMux = muxTransport(wrapMessagePort(rendererPort));
    const rendererControl = createHostControlClient(rendererMux.control);

    const { credential } = await rendererControl.call('settings.openHost');
    expect(harness.leases.get(credential)).toBe('window:42:1');

    // Window destruction triggers window-gone -> disposes control server, releases leases, closes port
    portEmitter.emit('message', {
      data: { type: 'window-gone', windowId: 42 },
    });

    expect(goneWindows).toEqual([42]);
    expect(transport.activeWindowCount).toBe(0);
    expect(harness.leases.size).toBe(0);
    expect(harness.releasedConnections).toContain('window:42:1');

    await vi.waitFor(() => {
      expect(rendererMux.control.closed).toBe(true);
    });
    rendererControl.dispose();
  });

  it('replaces a window session cleanly on soft reload (new window-port generation) and releases prior leases', async () => {
    const appDir = makeTempDir('window-reload-');
    const { bridge, portEmitter } = createFakeLifecycle();
    const harness = createHarnessDeps({ enableDev: false });

    const transport = trackTransport(await startHostTransport({
      appDir,
      appEnv: 'production',
      env: {},
      token: 'tok',
      lifecycle: bridge,
      createControlDeps: harness.factory,
    }));

    const [serverPort1, rendererPort1] = createMessagePortPair();
    portEmitter.emit('message', {
      data: { type: 'window-port', windowId: 7, generation: 1 },
      ports: [serverPort1],
    });
    const mux1 = muxTransport(wrapMessagePort(rendererPort1));
    const ctrl1 = createHostControlClient(mux1.control);
    const { credential: cred1 } = await ctrl1.call('settings.openHost');
    expect(harness.leases.get(cred1)).toBe('window:7:1');

    // Soft reload hands over a fresh port for the same windowId with generation 2
    const [serverPort2, rendererPort2] = createMessagePortPair();
    portEmitter.emit('message', {
      data: { type: 'window-port', windowId: 7, generation: 2 },
      ports: [serverPort2],
    });
    expect(transport.activeWindowCount).toBe(1);
    expect(harness.leases.has(cred1)).toBe(false);
    expect(harness.releasedConnections).toContain('window:7:1');

    const mux2 = muxTransport(wrapMessagePort(rendererPort2));
    const ctrl2 = createHostControlClient(mux2.control);
    const { credential: cred2 } = await ctrl2.call('settings.openHost');
    expect(harness.leases.get(cred2)).toBe('window:7:2');

    await vi.waitFor(() => expect(mux1.control.closed).toBe(true));
    ctrl1.dispose();
    ctrl2.dispose();
    mux2.close();
  });

  it('exposes the local tool socket when APACK_TOOL_SOCKET=1 in production while still refusing dev.* operations', async () => {
    const appDir = makeTempDir('prod-optin-');
    const shortTmp = makeShortTmpDir();
    const { bridge } = createFakeLifecycle();
    const harness = createHarnessDeps({ enableDev: false });

    const transport = trackTransport(await startHostTransport({
      appDir,
      appEnv: 'production',
      env: { APACK_TOOL_SOCKET: '1' },
      tmpDir: shortTmp,
      token: 'optin-token',
      lifecycle: bridge,
      createControlDeps: harness.factory,
    }));

    expect(transport.socket).toBeTruthy();
    expect(readApiRuntime(appDir)).toEqual({
      pid: process.pid,
      socket: transport.socket,
      token: 'optin-token',
    });

    await using client = await connectToolClient({ appDir });
    expect(await client.control.call('packs.loaded')).toHaveLength(1);
    await expect(client.control.call('dev.reload', { packId: 'default-setup' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(client.control.call('dev.install', { root: appDir })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
