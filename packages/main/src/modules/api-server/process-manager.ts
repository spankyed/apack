import { ChildProcess } from 'child_process';
import { BrowserWindow, app } from 'electron';
import { API_EVENTS } from './config.ts';
import { logInfo, logError } from './logger.ts';

export interface ProcessHandlers {
  onReady?: (port: number) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  onError?: (error: Error) => void;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

export class ProcessManager {
  private process?: ChildProcess;
  private handlers: ProcessHandlers;
  private serverReady = false;
  private exited = false;
  private stopping?: Promise<void>;
  private lastStderr = '';
  private fatalErrors: { message: string; stack?: string; source?: string }[] = [];

  constructor(handlers: ProcessHandlers = {}) {
    this.handlers = handlers;
  }

  setProcess(process: ChildProcess): void {
    this.process = process;
    this.serverReady = false;
    this.exited = false;
    this.lastStderr = '';
    this.fatalErrors = [];
    this.attachHandlers();
  }

  private attachHandlers(): void {
    if (!this.process) return;

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
        
        // Check for server ready message (only trigger once)
        if (!this.serverReady && message.includes('WebSocket Server listening')) {
          const portMatch = message.match(/ws:\/\/localhost:(\d+)/);
          if (portMatch && this.handlers.onReady) {
            const port = parseInt(portMatch[1], 10);
            this.serverReady = true;
            this.handlers.onReady(port);
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

        // Check for structured fatal error JSON line from backend
        for (const line of message.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.startsWith('{"__fatal":')) {
            try {
              const parsed = JSON.parse(trimmed);
              if (parsed.__fatal) {
                this.fatalErrors.push({ message: parsed.message, stack: parsed.stack, source: parsed.source });
                broadcastEvent('api:fatal', { message: parsed.message, stack: parsed.stack, source: parsed.source });
              }
            } catch { /* not valid JSON, ignore */ }
          }
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

      this.process.stderr.on('error', (error) => {
        console.error('Process stderr error:', error);
      });
    }

    // Process exit handling
    this.process.on('exit', (code, signal) => {
      this.exited = true;
      console.log(`Process exited with code ${code} and signal ${signal}`);
      this.handlers.onExit?.(code, signal);
    });

    // Process error handling
    this.process.on('error', (error) => {
      console.error('Process error:', error);
      this.handlers.onError?.(error);
    });
  }

  cleanup(): void {
    if (!this.process) return;

    // Remove all listeners
    this.process.stdout?.removeAllListeners();
    this.process.stderr?.removeAllListeners();
    this.process.removeAllListeners();

    // Destroy streams
    this.process.stdout?.destroy();
    this.process.stderr?.destroy();
  }

  /**
   * Ends the process and resolves once it is **gone**, not once the signal was sent.
   *
   * Reload and quit both wait for the API to release its port, database and log files.
   *
   * **The order is the method.** `cleanup()` removes *every* listener, so the waiter goes on after it and
   * the signal after that: before, and it is stripped with the handlers it replaces. Stripping them first
   * is also what keeps this off `onExit`, so a reload is never counted as a crash.
   *
   * A process that survives the force-kill rejects the wait; it must not be reported as stopped.
   */
  stop(signal: NodeJS.Signals = 'SIGTERM', forceKillDelay = 5000): Promise<void> {
    if (this.stopping) return this.stopping;
    const child = this.process;
    if (!child || !this.isRunning()) return Promise.resolve();
    this.cleanup();

    const signalling = new Promise<void>((resolve, reject) => {
      let forceKill: ReturnType<typeof setTimeout> | undefined;
      let giveUp: ReturnType<typeof setTimeout> | undefined;
      const done = (): void => {
        // `cleanup()` took the handler that normally sets this, and `isRunning()` reads it
        this.exited = true;
        clearTimeout(giveUp);
        clearTimeout(forceKill);
        resolve();
      };
      const refuse = () => {
        child.removeListener('exit', done);
        clearTimeout(forceKill);
        reject(new Error('API process did not exit after shutdown signals'));
      };
      child.once('exit', done);
      if (forceKillDelay > 0) forceKill = setTimeout(() => {
        // Start the exit grace when escalation actually runs; overdue timers must leave an I/O turn for exit.
        giveUp = setTimeout(refuse, 1000);
        this.signal(child, 'SIGKILL');
      }, forceKillDelay);
      else giveUp = setTimeout(refuse, forceKillDelay + 1000);
      this.signal(child, signal);
    });
    this.stopping = signalling.finally(() => { this.stopping = undefined; });
    return this.stopping;
  }

  private signal(child: ChildProcess, signal: NodeJS.Signals): void {
    try {
      child.kill(signal);
    } catch (error) {
      logError(`[MAIN] Error sending ${signal} to the API:`, error);
    }
  }

  isRunning(): boolean {
    return !!this.process && !this.exited && this.process.exitCode == null && this.process.signalCode == null;
  }

  getPid(): number | undefined {
    return this.process?.pid;
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
