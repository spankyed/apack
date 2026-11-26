import type { EventEmitter } from 'node:events';
import { BrowserWindow, app, type MessagePortMain } from 'electron';
import { API_EVENTS } from './config.ts';
import { logInfo, logError, logWarn } from './logger.ts';

/**
 * The slice of Electron's `UtilityProcess` that `ProcessManager` operates on. Structural so unit tests can drive
 * shutdown escalation and exit timing without launching Electron.
 */
export interface ManagedProcess extends EventEmitter {
  readonly pid?: number;
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  postMessage(message: unknown, transfer?: MessagePortMain[]): void;
  kill(): boolean;
}

export interface ProcessHandlers {
  onReady?: (port: number) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  onError?: (error: Error) => void;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  /** Override for hard-killing a process by PID on POSIX; defaults to `process.kill(pid, 'SIGKILL')`. */
  forceKillPid?: (pid: number) => void;
}

export class ProcessManager {
  private process?: ManagedProcess;
  private handlers: ProcessHandlers;
  private serverReady = false;
  private exited = false;
  private powerState: 'active' | 'suspended' = 'active';
  private stopping?: Promise<void>;
  private lastStderr = '';
  private stderrBuffer = '';
  private fatalErrors: { message: string; stack?: string; source?: string }[] = [];

  constructor(handlers: ProcessHandlers = {}) {
    this.handlers = handlers;
  }

  setProcess(process: ManagedProcess): void {
    this.process = process;
    this.serverReady = false;
    this.exited = false;
    this.lastStderr = '';
    this.stderrBuffer = '';
    this.fatalErrors = [];
    this.attachHandlers();
    if (this.powerState === 'suspended') {
      try {
        process.postMessage({ type: 'power', state: 'suspended' });
      } catch { /* child exited before taking the message */ }
    }
  }

  /** Tracks OS suspend/resume as level-triggered state and forwards changes to the running API process. */
  setPowerState(state: 'active' | 'suspended'): void {
    if (this.powerState === state) return;
    this.powerState = state;
    if (!this.process || !this.isRunning()) return;
    try {
      this.process.postMessage({ type: 'power', state });
    } catch { /* child exited before taking the message */ }
  }

  private markReady(port: number): void {
    if (this.serverReady) return;
    this.serverReady = true;
    this.handlers.onReady?.(port);
  }

  private parseFatalLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{"__fatal":')) return;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.__fatal) {
        const entry = { message: parsed.message, stack: parsed.stack, source: parsed.source };
        this.fatalErrors.push(entry);
        broadcastEvent('api:fatal', entry);
      }
    } catch { /* not valid JSON, ignore */ }
  }

  private flushStderrBuffer(): void {
    if (!this.stderrBuffer) return;
    const trailing = this.stderrBuffer;
    this.stderrBuffer = '';
    this.parseFatalLine(trailing);
  }

  private attachHandlers(): void {
    if (!this.process) return;

    // Structured control messages from the utility process's `parentPort`
    this.process.on('message', (message: unknown) => {
      if (!message || typeof message !== 'object') return;
      const payload = message as { type?: unknown; port?: unknown };
      if (payload.type === 'ready' && typeof payload.port === 'number' && Number.isInteger(payload.port) && payload.port > 0) {
        this.markReady(payload.port);
      }
    });

    // Stdout handling
    if (this.process.stdout) {
      this.process.stdout.on('data', (data) => {
        const message = data.toString();
        const isDev = !app.isPackaged;
        
        // Log all API stdout in production so backend lifecycle context is not lost.
        if (app.isPackaged && message.trim()) {
          logInfo(`[API Server stdout]: ${message.trim()}`);
        }

        // Log and broadcast stdout in development mode.
        if (isDev) {
          logInfo(`[API Server]: ${message.trim()}`);

          // Broadcast stdout to renderer in dev mode
          broadcastEvent(API_EVENTS.LOG, {
            type: 'stdout',
            message,
            timestamp: new Date().toISOString()
          });
        }
        
        // Fallback readiness detection if the child did not send `{ type: 'ready', port }` over `parentPort`
        if (!this.serverReady && message.includes('WebSocket Server listening')) {
          const portMatch = message.match(/ws:\/\/localhost:(\d+)/);
          if (portMatch) {
            this.markReady(parseInt(portMatch[1], 10));
          }
        }

        this.handlers.onStdout?.(message);
      });

      this.process.stdout.on('error', (error) => {
        console.error('Process stdout error:', error);
      });
    }

    // Stderr handling
    if (this.process.stderr) {
      this.process.stderr.on('data', (data) => {
        const message = data.toString();
        const isDev = !app.isPackaged;
        this.lastStderr = message.trim();

        // Line-buffered parse for structured fatal error JSON lines so long stacks split across pipe chunks are kept intact
        this.stderrBuffer += message;
        const lines = this.stderrBuffer.split('\n');
        this.stderrBuffer = lines.pop() ?? '';
        for (const line of lines) {
          this.parseFatalLine(line);
        }

        // Always log errors in production for debugging
        logError(`[API Server Error]: ${message.trim()}`);

        // Broadcast stderr to renderer in dev mode
        if (isDev) {
          broadcastEvent(API_EVENTS.LOG, { 
            type: 'stderr', 
            message,
            timestamp: new Date().toISOString()
          });
        }
        
        this.handlers.onStderr?.(message);
      });

      this.process.stderr.on('end', () => {
        this.flushStderrBuffer();
      });

      this.process.stderr.on('error', (error) => {
        console.error('Process stderr error:', error);
      });
    }

    // Process exit handling (`UtilityProcess` emits `(code: number)` with no separate signal parameter)
    this.process.on('exit', (code: number) => {
      this.flushStderrBuffer();
      this.exited = true;
      console.log(`Process exited with code ${code}`);
      this.handlers.onExit?.(code, null);
    });

    // Process error handling (`UtilityProcess` emits `(type, location, report)` on non-continuable V8 fatal errors)
    this.process.on('error', (typeOrError: unknown, location?: string, report?: string) => {
      const error = typeOrError instanceof Error
        ? typeOrError
        : new Error([String(typeOrError), location, report].filter(Boolean).join(': '));
      console.error('Process error:', error);
      this.handlers.onError?.(error);
    });
  }

  cleanup(): void {
    this.stderrBuffer = '';
    if (!this.process) return;

    // Remove all listeners
    this.process.stdout?.removeAllListeners();
    this.process.stderr?.removeAllListeners();
    this.process.removeAllListeners();

    // Destroy streams when supported
    if (this.process.stdout && 'destroy' in this.process.stdout && typeof this.process.stdout.destroy === 'function') {
      this.process.stdout.destroy();
    }
    if (this.process.stderr && 'destroy' in this.process.stderr && typeof this.process.stderr.destroy === 'function') {
      this.process.stderr.destroy();
    }
  }

  /**
   * Ends the process and resolves once it is **gone**, not once the shutdown request was sent.
   *
   * Reload and quit both wait for the API to release its port, database and log files.
   *
   * **Graceful first, then hard kill.** Sends `{ type: 'shutdown' }` over `UtilityProcess`'s parent port so the API
   * runs pack `onShutdown` hooks, closes LMDB cleanly, and exits `0` identically across macOS, Linux, and Windows
   * (unlike `SIGTERM`, which hard-terminates on Windows). If the process has not exited within `forceKillDelay`,
   * escalates to an unignorable kill (`SIGKILL` on POSIX when `pid` is known, `child.kill()` on Windows or before
   * spawn).
   *
   * **The order is the method.** `cleanup()` removes *every* listener, so the waiter goes on after it and
   * the shutdown request after that: before, and it is stripped with the handlers it replaces. Stripping them first
   * is also what keeps this off `onExit`, so a reload is never counted as a crash.
   *
   * **A force-kill is waited out, never timed out.** SIGKILL cannot be refused: what is left after it is the
   * kernel tearing the process down, which a loaded machine, or a process in the middle of a disk write, can
   * take seconds over. A clock on it reports a process that is dying as one that survived, and a quit that hears
   * that has nothing left to do. A kill still pending a second after it was sent is logged, so a slow one is
   * seen.
   */
  stop(forceKillDelay = 5000): Promise<void> {
    if (this.stopping) return this.stopping;
    const child = this.process;
    if (!child || !this.isRunning()) return Promise.resolve();
    this.cleanup();

    const signalling = new Promise<void>((resolve) => {
      let slowKill: ReturnType<typeof setTimeout> | undefined;
      const forceKill = setTimeout(() => {
        // Timed from the kill as it is sent, which an overdue timer may be well past its deadline
        slowKill = setTimeout(() => {
          logWarn(`[MAIN] The API process ${child.pid} has not exited 1s after SIGKILL; waiting for it to go`);
        }, 1000);
        this.forceKill(child);
      }, forceKillDelay);
      child.once('exit', () => {
        // `cleanup()` took the handler that normally sets this, and `isRunning()` reads it
        this.exited = true;
        clearTimeout(forceKill);
        clearTimeout(slowKill);
        resolve();
      });
      this.requestShutdown(child);
    });
    this.stopping = signalling.finally(() => { this.stopping = undefined; });
    return this.stopping;
  }

  private requestShutdown(child: ManagedProcess): void {
    try {
      child.postMessage({ type: 'shutdown' });
    } catch (error) {
      logError('[MAIN] Error posting shutdown to the API; falling back to kill:', error);
      this.forceKill(child);
    }
  }

  private forceKill(child: ManagedProcess): void {
    if (process.platform !== 'win32' && child.pid !== undefined) {
      const killPid = this.handlers.forceKillPid ?? ((pid: number) => process.kill(pid, 'SIGKILL'));
      try {
        killPid(child.pid);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
        logError(`[MAIN] Error sending SIGKILL to the API (${child.pid}); falling back to child.kill():`, error);
      }
    }
    try {
      child.kill();
    } catch (error) {
      logError('[MAIN] Error killing the API:', error);
    }
  }

  isRunning(): boolean {
    return !!this.process && !this.exited;
  }

  getPid(): number | undefined {
    return this.process?.pid;
  }

  getProcess(): ManagedProcess | undefined {
    return this.isRunning() ? this.process : undefined;
  }

  getLastStderr(): string {
    return this.lastStderr;
  }

  getFatalErrors(): { message: string; stack?: string; source?: string }[] {
    return this.fatalErrors;
  }
}

// Event broadcaster utility
export function broadcastEvent(event: string, data?: any): void {
  BrowserWindow.getAllWindows().forEach(window => {
    window.webContents.send(event, data);
  });
}
