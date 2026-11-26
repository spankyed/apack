/**
 * Server-side Wave 0 host transport wiring:
 * - Always publishes `<appDir>/api-runtime.json` (`0600`) with `{ pid }`.
 * - In `development`, `test`, or `APACK_TOOL_SOCKET=1`, also binds the user-private local tool socket
 *   server (`{ pid, socket, token }`) and wires each authenticated socket through
 *   `muxTransport(stream(socket))` into `createHostControlServer`.
 * - Wires `registerWindowPortHandler` and `registerWindowGoneHandler` so Electron `MessagePortMain`
 *   window channels attach to `createHostControlServer` and release per-window resources atomically
 *   when a window is destroyed or crashes.
 */
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { port as wrapMessagePort } from '@apackdev/link';
import { HOST, receiveClientEvent, UnknownClientEventError } from '@apackdev/host/bus';
import { installDevPack, reloadPackById } from '@apackdev/host/packs/runtime';
import { secretsSnapshot, secretsStore } from '@apackdev/host/secrets';
import { bindSettingsRequest, SETTINGS_MUTATIONS } from '@apackdev/host/settings';
import {
  ControlRpcError,
  muxTransport,
  type ControlServer,
  type MuxedTransport,
} from '@apackdev/host/transport/mux';
import { toolSocketTransport } from '@apackdev/host/transport/tool-client';
import {
  removeApiRuntimeFile,
  runtimeFilePath,
  shouldExposeToolSocket,
  startToolSocketServer,
  writeApiRuntimeFile,
  type ToolSocketServer,
} from '@apackdev/host/transport/tool-socket';
import { resolveAppEnvironment, type AppEnv } from '@apackdev/sdk/env';
import { createLogger } from '@apackdev/sdk/logger';
import { apiToken } from '../boot/config.ts';
import {
  registerWindowGoneHandler,
  registerWindowPortHandler,
  type LifecycleBridge,
  type UtilityMessagePort,
  type WindowPortInfo,
} from '../boot/lifecycle.ts';
import {
  appPacks,
  appPerformance,
  appSettingsAccess,
  appStartupPerformance,
  backendActor,
} from '../runtime/index.ts';
import {
  createHostControlServer,
  createHostPerformanceControl,
  type HostControlDevDeps,
  type HostControlPerformanceDeps,
  type HostControlServerDeps,
} from './control-rpc.ts';
import { rootEvents } from './emitter.ts';
import { getLoadedPacks, getPackCatalogFrame } from './packs.ts';

const logger = createLogger('backend');

export type HostControlDepsFactory = (connectionId: string) => HostControlServerDeps;

export interface StartHostTransportOptions {
  readonly appDir?: string;
  readonly appEnv?: AppEnv;
  readonly env?: NodeJS.ProcessEnv;
  readonly token?: string;
  readonly tmpDir?: string;
  readonly platform?: NodeJS.Platform;
  readonly socket?: string;
  readonly lifecycle?: Pick<LifecycleBridge, 'registerWindowPortHandler' | 'registerWindowGoneHandler'>;
  readonly createControlDeps?: HostControlDepsFactory;
  readonly onWindowGone?: (windowId: number) => void;
}

export interface HostTransport extends Disposable, AsyncDisposable {
  readonly socket: string | undefined;
  readonly runtimeFile: string;
  readonly activeToolConnectionCount: number;
  readonly activeWindowCount: number;
  close(): Promise<void>;
}

/**
 * Builds the process-live `HostControlDepsFactory` wired directly to the booted server runtime
 * (`secretsStore`, `appSettingsAccess`, `appPacks`, `appPerformance`, `reloadPackById`, `installDevPack`).
 */
export function createRuntimeControlDepsFactory(appEnv: AppEnv): HostControlDepsFactory {
  const performance: HostControlPerformanceDeps | undefined = appPerformance
    ? createHostPerformanceControl(appPerformance, appStartupPerformance)
    : undefined;

  const dev: HostControlDevDeps | undefined = appEnv === 'development' || appEnv === 'test'
    ? {
        async reload(packId) {
          using claim = appPacks.claimPackOperation(packId);
          if (!claim) {
            throw new ControlRpcError('CONFLICT', 'another operation on this pack is in progress');
          }
          await reloadPackById(appPacks, packId, backendActor);
        },
        async install(root) {
          const installed = await installDevPack(appPacks, root, backendActor);
          return { packId: installed.id };
        },
      }
    : undefined;

  return (connectionId) => ({
    connectionId,
    secrets: {
      snapshot: () => secretsSnapshot(),
      add: (provider, label, value) => secretsStore.add(provider, label, value),
      replaceValue: (id, value) => secretsStore.replaceValue(id, value),
      select: (id) => secretsStore.select(id),
      rename: (id, label) => secretsStore.rename(id, label),
      delete: (id) => secretsStore.delete(id),
      allowUnprotected: () => secretsStore.allowUnprotected(),
    },
    settings: {
      openHost: (id) => appSettingsAccess.issueHost(id),
      openPack: (id, expected) => appSettingsAccess.issuePack(id, expected),
      close: (id, credential) => appSettingsAccess.revoke(id, credential),
      mutate: (id, credential, event) => {
        if (!SETTINGS_MUTATIONS.has(event.type)) {
          throw new ControlRpcError('BAD_REQUEST', `Unsupported settings mutation event: ${event.type}`);
        }
        const access = appSettingsAccess;
        access.resolve(id, credential);
        bindSettingsRequest(event, () => access.resolve(id, credential));
        try {
          receiveClientEvent(appPacks, { to: HOST.settings, event, client: id });
        } catch (error) {
          if (error instanceof UnknownClientEventError) {
            throw new ControlRpcError('BAD_REQUEST', error.message);
          }
          throw error;
        }
      },
      releaseConnection: (id) => appSettingsAccess.releaseClient(id),
    },
    packs: {
      getCatalogFrame: () => getPackCatalogFrame(),
      onCatalogChanged: (listener) => appPacks.catalog.onChanged(listener),
      loaded: () => getLoadedPacks(),
      getRegistrationId: (packId) => appPacks.getPackRuntime(packId)?.registrationId,
      onClientReady: (packId) => {
        logger.info(`→ Pack client ready: "${packId}"`, { packId });
        rootEvents.emitPackClientConnected(packId);
      },
    },
    ...(performance ? { performance } : {}),
    ...(dev ? { dev } : {}),
  });
}

interface ActiveSession {
  readonly mux: MuxedTransport;
  readonly control: ControlServer;
}

/**
 * Starts the server's Wave 0 host transport: `api-runtime.json`, optional local tool socket server,
 * and Electron window `MessagePort` / `window-gone` lifecycle wiring.
 */
export async function startHostTransport(options: StartHostTransportOptions = {}): Promise<HostTransport> {
  const environment = options.appDir === undefined || options.appEnv === undefined
    ? resolveAppEnvironment()
    : undefined;
  const appDir = options.appDir ?? environment!.appDir;
  const appEnv = options.appEnv ?? environment!.env;
  const env = options.env ?? process.env;
  const token = options.token ?? apiToken();
  const createControlDeps = options.createControlDeps ?? createRuntimeControlDepsFactory(appEnv);
  const registerPort = options.lifecycle?.registerWindowPortHandler ?? registerWindowPortHandler;
  const registerGone = options.lifecycle?.registerWindowGoneHandler ?? registerWindowGoneHandler;

  fs.mkdirSync(appDir, { recursive: true });

  const activeTools = new Set<ActiveSession>();
  const activeWindows = new Map<number, ActiveSession>();
  let toolServer: ToolSocketServer | undefined;
  let wrotePidOnlyRuntime = false;
  let closed = false;
  let closePromise: Promise<void> | undefined;

  const disposeSession = (session: ActiveSession): void => {
    try {
      session.control.dispose();
    } catch {
      /* best-effort teardown */
    }
    try {
      session.mux.close();
    } catch {
      /* best-effort teardown */
    }
  };

  if (shouldExposeToolSocket(appEnv, env)) {
    toolServer = await startToolSocketServer({
      appDir,
      token,
      socket: options.socket,
      tmpDir: options.tmpDir,
      platform: options.platform,
      onConnection: (socket, initialBytes) => {
        if (closed) {
          socket.destroy();
          return;
        }
        const connectionId = `tool:${randomUUID()}`;
        const raw = toolSocketTransport(socket, initialBytes);
        const mux = muxTransport(raw);
        const control = createHostControlServer(mux.control, createControlDeps(connectionId));
        const session: ActiveSession = { mux, control };
        activeTools.add(session);
        mux.control.onClose(() => {
          activeTools.delete(session);
        });
      },
    });
  } else {
    writeApiRuntimeFile(appDir, { pid: process.pid });
    wrotePidOnlyRuntime = true;
  }

  const attachWindowPort = (messagePort: UtilityMessagePort, info: WindowPortInfo): void => {
    if (closed) {
      try { messagePort.close(); } catch { /* already closed */ }
      return;
    }
    const previous = activeWindows.get(info.windowId);
    if (previous) {
      activeWindows.delete(info.windowId);
      disposeSession(previous);
    }
    const connectionId = `window:${info.windowId}:${info.generation}`;
    const raw = wrapMessagePort(messagePort);
    const mux = muxTransport(raw);
    const control = createHostControlServer(mux.control, createControlDeps(connectionId));
    const session: ActiveSession = { mux, control };
    activeWindows.set(info.windowId, session);
    mux.control.onClose(() => {
      if (activeWindows.get(info.windowId) === session) {
        activeWindows.delete(info.windowId);
      }
    });
  };

  const handleWindowGone = (windowId: number): void => {
    const existing = activeWindows.get(windowId);
    if (existing) {
      activeWindows.delete(windowId);
      disposeSession(existing);
    }
    options.onWindowGone?.(windowId);
  };

  const unsubscribePort = registerPort(attachWindowPort);
  const unsubscribeGone = registerGone(handleWindowGone);

  const beginCloseSync = (): Promise<void> => {
    if (closePromise) return closePromise;
    closed = true;

    unsubscribePort();
    unsubscribeGone();

    for (const session of Array.from(activeWindows.values())) {
      disposeSession(session);
    }
    activeWindows.clear();

    for (const session of Array.from(activeTools)) {
      disposeSession(session);
    }
    activeTools.clear();

    if (toolServer) {
      const serverToClose = toolServer;
      toolServer = undefined;
      closePromise = serverToClose.close();
      return closePromise;
    }

    if (wrotePidOnlyRuntime) {
      wrotePidOnlyRuntime = false;
      removeApiRuntimeFile(appDir, { onlyIfPid: process.pid });
    }
    closePromise = Promise.resolve();
    return closePromise;
  };

  return {
    socket: toolServer?.address,
    runtimeFile: runtimeFilePath(appDir),
    get activeToolConnectionCount() {
      return activeTools.size;
    },
    get activeWindowCount() {
      return activeWindows.size;
    },
    close: () => beginCloseSync(),
    [Symbol.dispose]: () => {
      void beginCloseSync();
    },
    [Symbol.asyncDispose]: () => beginCloseSync(),
  };
}
