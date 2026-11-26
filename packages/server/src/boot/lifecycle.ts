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
export interface UtilityParentPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
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
  notifyServerReady(port: number): void;
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

  function triggerShutdown(): void {
    shutdownRequested = true;
    if (!shutdownHandler || shutdownTriggered) return;
    shutdownTriggered = true;
    shutdownHandler();
  }

  function setPowerState(next: PowerState): void {
    if (next === currentPowerState) return;
    currentPowerState = next;
    powerHandler?.(next);
  }

  function installShutdownBridge(): void {
    if (installed) return;
    installed = true;

    proc.on('SIGTERM', triggerShutdown);

    if (proc.parentPort) {
      proc.parentPort.on('message', (event) => {
        if (!event.data || typeof event.data !== 'object') return;
        const payload = event.data as { type?: unknown; state?: unknown };
        if (payload.type === 'shutdown') {
          triggerShutdown();
        } else if (payload.type === 'power' && (payload.state === 'suspended' || payload.state === 'active')) {
          setPowerState(payload.state);
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

  function notifyServerReady(port: number): void {
    proc.parentPort?.postMessage({ type: 'ready', port });
  }

  return { installShutdownBridge, isShutdownRequested, registerGracefulShutdown, powerState, registerPowerState, notifyServerReady };
}

const defaultBridge = createLifecycleBridge();

/** Registers shutdown listeners at the very start of boot (idempotent). */
export const installShutdownBridge = (): void => defaultBridge.installShutdownBridge();

export const isShutdownRequested = (): boolean => defaultBridge.isShutdownRequested();

/** Binds the active server's graceful shutdown routine; invokes it immediately if shutdown arrived during boot. */
export const registerGracefulShutdown = (handler: () => void): void => defaultBridge.registerGracefulShutdown(handler);

/** Binds the active server's OS power-state handler; replays `'suspended'` immediately if suspend arrived during boot. */
export const registerPowerState = (handler: (state: PowerState) => void): (() => void) => defaultBridge.registerPowerState(handler);

/** Notifies Electron main over `parentPort` once the WebSocket server is listening (chunk-proof structured signal). */
export const notifyServerReady = (port: number): void => defaultBridge.notifyServerReady(port);
