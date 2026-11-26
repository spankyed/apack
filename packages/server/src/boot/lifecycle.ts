/**
 * Process lifecycle bridge for the API server.
 *
 * Installed at the top of `server.ts` before `setupBackend()` so a `{ type: 'shutdown' }` message or `SIGTERM`
 * arriving mid-boot is never lost: boot aborts cleanly before binding the WebSocket server rather than waiting out
 * a full startup or hitting main's 5s SIGKILL escalation.
 *
 * Typed structurally over Electron's `process.parentPort` so `@app/server` takes no runtime or type dependency on
 * `electron`. Note: Electron's `ParentPort` only defines `'message'` and `postMessage()` (no `'close'` event);
 * Chromium's `UtilityProcessHost` tears down the utility process automatically if the main browser process dies.
 */
/**
 * Structural slice of Electron's `MessagePortMain` received from main over `process.parentPort`.
 * Matches `@apackdev/link`'s `MessagePortLike` (`EmitterPort`) directly so Wave 0 can pass it straight to `port()`.
 */
export interface UtilityMessagePort {
  on(event: 'message', listener: (event: { readonly data: unknown }) => void): void;
  on(event: 'close', listener: () => void): void;
  postMessage(message: unknown): void;
  start(): void;
  close(): void;
}

export interface WindowPortInfo {
  readonly windowId: number;
  readonly generation: number;
}

export interface UtilityParentPort {
  on(event: 'message', listener: (event: { data: unknown; ports?: readonly UtilityMessagePort[] }) => void): void;
  postMessage(message: unknown): void;
}

export interface LifecycleProcess {
  on(event: 'SIGTERM' | 'disconnect', listener: () => void): unknown;
  connected?: boolean;
  parentPort?: UtilityParentPort;
}

export type PowerState = 'active' | 'suspended';

export interface LifecycleBridge {
  installShutdownBridge(): void;
  isShutdownRequested(): boolean;
  registerGracefulShutdown(handler: () => void): void;
  powerState(): PowerState;
  registerPowerState(handler: (state: PowerState) => void): () => void;
  registerWindowPortHandler(handler: (port: UtilityMessagePort, info: WindowPortInfo) => void): () => void;
  registerWindowGoneHandler(handler: (windowId: number) => void): () => void;
  notifyServerReady(port: number, socket?: string): void;
}

/** Creates an isolated lifecycle bridge bound to `proc` (defaults to the current Node/Electron `process`). */
export function createLifecycleBridge(
  proc: LifecycleProcess = process as NodeJS.Process & { parentPort?: UtilityParentPort },
): LifecycleBridge {
  let installed = false;
  let shutdownRequested = false;
  let shutdownTriggered = false;
  let shutdownHandler: (() => void) | undefined;
  let currentPowerState: PowerState = 'active';
  let powerHandler: ((state: PowerState) => void) | undefined;
  let windowPortHandler: ((port: UtilityMessagePort, info: WindowPortInfo) => void) | undefined;
  const pendingWindowPorts: Array<{ port: UtilityMessagePort; info: WindowPortInfo }> = [];
  let windowGoneHandler: ((windowId: number) => void) | undefined;
  const pendingWindowGone: number[] = [];

  function closePendingWindowPorts(): void {
    for (const entry of pendingWindowPorts.splice(0)) {
      try { entry.port.close(); } catch { /* already closed */ }
    }
  }

  function triggerShutdown(): void {
    shutdownRequested = true;
    closePendingWindowPorts();
    pendingWindowGone.length = 0;
    if (!shutdownHandler || shutdownTriggered) return;
    shutdownTriggered = true;
    shutdownHandler();
  }

  function setPowerState(next: PowerState): void {
    if (next === currentPowerState) return;
    currentPowerState = next;
    powerHandler?.(next);
  }

  function handleWindowPort(port: UtilityMessagePort, info: WindowPortInfo): void {
    if (shutdownRequested) {
      try { port.close(); } catch { /* already closed */ }
      return;
    }
    if (windowPortHandler) {
      windowPortHandler(port, info);
      return;
    }
    const entry = { port, info };
    pendingWindowPorts.push(entry);
    port.on('close', () => {
      const index = pendingWindowPorts.indexOf(entry);
      if (index !== -1) pendingWindowPorts.splice(index, 1);
    });
  }

  function handleWindowGone(windowId: number): void {
    if (shutdownRequested) return;
    if (windowGoneHandler) {
      windowGoneHandler(windowId);
      return;
    }
    pendingWindowGone.push(windowId);
  }

  function installShutdownBridge(): void {
    if (installed) return;
    installed = true;

    proc.on('SIGTERM', triggerShutdown);

    if (proc.parentPort) {
      proc.parentPort.on('message', (event) => {
        if (!event.data || typeof event.data !== 'object') return;
        const payload = event.data as { type?: unknown; state?: unknown; windowId?: unknown; generation?: unknown };
        if (payload.type === 'shutdown') {
          triggerShutdown();
        } else if (payload.type === 'power' && (payload.state === 'suspended' || payload.state === 'active')) {
          setPowerState(payload.state);
        } else if (
          payload.type === 'window-port'
          && typeof payload.windowId === 'number'
          && typeof payload.generation === 'number'
          && event.ports?.[0]
        ) {
          handleWindowPort(event.ports[0], { windowId: payload.windowId, generation: payload.generation });
        } else if (
          payload.type === 'window-gone'
          && typeof payload.windowId === 'number'
          && Number.isFinite(payload.windowId)
        ) {
          handleWindowGone(payload.windowId);
        }
      });
    }

    // Fallback for direct Node `child_process` spawns with an IPC channel (`stdio: [..., 'ipc']`).
    if (proc.connected) {
      proc.on('disconnect', () => {
        console.log('[API] Parent process died, shutting down');
        triggerShutdown();
      });
    }
  }

  function isShutdownRequested(): boolean {
    return shutdownRequested;
  }

  function registerGracefulShutdown(handler: () => void): void {
    installShutdownBridge();
    shutdownHandler = handler;
    if (shutdownRequested && !shutdownTriggered) {
      shutdownTriggered = true;
      handler();
    }
  }

  function powerState(): PowerState {
    return currentPowerState;
  }

  function registerPowerState(handler: (state: PowerState) => void): () => void {
    installShutdownBridge();
    powerHandler = handler;
    if (currentPowerState === 'suspended') handler('suspended');
    return () => {
      if (powerHandler === handler) powerHandler = undefined;
    };
  }

  function registerWindowPortHandler(handler: (port: UtilityMessagePort, info: WindowPortInfo) => void): () => void {
    installShutdownBridge();
    windowPortHandler = handler;
    for (const entry of pendingWindowPorts.splice(0)) {
      if (windowPortHandler !== handler) {
        pendingWindowPorts.push(entry);
        continue;
      }
      handler(entry.port, entry.info);
    }
    return () => {
      if (windowPortHandler === handler) windowPortHandler = undefined;
    };
  }

  function registerWindowGoneHandler(handler: (windowId: number) => void): () => void {
    installShutdownBridge();
    windowGoneHandler = handler;
    for (const windowId of pendingWindowGone.splice(0)) {
      if (windowGoneHandler !== handler) {
        pendingWindowGone.push(windowId);
        continue;
      }
      handler(windowId);
    }
    return () => {
      if (windowGoneHandler === handler) windowGoneHandler = undefined;
    };
  }

  function notifyServerReady(port: number, socket?: string): void {
    proc.parentPort?.postMessage({
      type: 'ready',
      port,
      ...(socket !== undefined ? { socket } : {}),
    });
  }

  return {
    installShutdownBridge,
    isShutdownRequested,
    registerGracefulShutdown,
    powerState,
    registerPowerState,
    registerWindowPortHandler,
    registerWindowGoneHandler,
    notifyServerReady,
  };
}

const defaultBridge = createLifecycleBridge();

/** Registers shutdown listeners at the very start of boot (idempotent). */
export const installShutdownBridge = (): void => defaultBridge.installShutdownBridge();

export const isShutdownRequested = (): boolean => defaultBridge.isShutdownRequested();

/** Binds the active server's graceful shutdown routine; invokes it immediately if shutdown arrived during boot. */
export const registerGracefulShutdown = (handler: () => void): void => defaultBridge.registerGracefulShutdown(handler);

/** Binds the active server's OS power-state handler; replays `'suspended'` immediately if suspend arrived during boot. */
export const registerPowerState = (handler: (state: PowerState) => void): (() => void) => defaultBridge.registerPowerState(handler);

/** Binds the handler for direct `MessagePortMain` channels brokered from main for app windows; drains any queued during boot. */
export const registerWindowPortHandler = (
  handler: (port: UtilityMessagePort, info: WindowPortInfo) => void,
): (() => void) => defaultBridge.registerWindowPortHandler(handler);

/** Binds the handler for window teardown signals (`destroyed` / `render-process-gone`) from main; drains any queued during boot. */
export const registerWindowGoneHandler = (
  handler: (windowId: number) => void,
): (() => void) => defaultBridge.registerWindowGoneHandler(handler);

/** Notifies Electron main over `parentPort` once the server is listening (chunk-proof structured signal). */
export const notifyServerReady = (port: number, socket?: string): void => defaultBridge.notifyServerReady(port, socket);
