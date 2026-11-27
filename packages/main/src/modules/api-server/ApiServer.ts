import { execFile } from 'child_process';
import { ipcMain, powerMonitor, shell, utilityProcess } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { AppModule } from '../../AppModule.ts';
import { MainModuleScope } from '../../MainModuleScope.ts';
import {
  API_CONFIG,
  API_EVENTS,
  API_PORT_CHANNELS,
  getApiPaths,
  getEnvironment,
  getUtilityExecArgv,
} from './config.ts';
import { ProcessManager, broadcastEvent } from './process-manager.ts';
import { PortBroker } from './port-broker.ts';
import { logInfo, logError, logWarn, getLogger, logStartupBanner } from './logger.ts';
import { getAppEnvironment } from '../../app-environment.ts';
import { errorMessage } from '@apackdev/sdk/utils/pure';
import { answerWhileWorking, processWork, type WorkReading } from '@apackdev/sdk/progress';

export class ApiServer implements AppModule {
  private processManager: ProcessManager;
  private readonly portBroker = new PortBroker();
  private isShuttingDown = false;
  private shutdownComplete = false;
  private shutdown?: Promise<void>;
  private restartAttempts = 0;
  /** The current launch's forgiveness, pending: a launch that exits takes its own with it */
  private restartReset?: ReturnType<typeof setTimeout>;
  /** Pending delayed restart timer scheduled after a crash exit, cancelled on reload/quit/start */
  private restartTimer?: ReturnType<typeof setTimeout>;
  /** In-flight `startApiServer()` promise so concurrent starts serialize across async orphan cleanup */
  private starting?: Promise<void>;
  /**
   * The current startup's readiness, which `waitForReady` hands out. A crash before the API is ready restarts it
   * within the same startup, so the promise is renewed only once it has settled: the launch that becomes ready
   * resolves what the window waits on, and running out of restarts rejects it with the API's own error
   */
  private serverReady: Promise<void>;
  private serverReadyResolve?: () => void;
  private serverReadyReject?: (error: Error) => void;
  private actualSocket?: string;
  private lastError?: { message: string; stack?: string };
  /** The reload in flight, so a rebuild arriving mid-reload joins it rather than starting a second API */
  private reloading?: Promise<void>;
  /** Whether the next readiness is a reload's, which `handleServerReady` consumes onto `api:started` */
  private announceReload = false;
  private readonly startupId = randomUUID();

  constructor() {
    process.env.APACK_STARTUP_ID = this.startupId;
    this.processManager = new ProcessManager({
      onReady: (socket) => this.handleServerReady(socket),
      onExit: (code, signal) => this.handleProcessExit(code, signal),
      onError: (error) => this.handleProcessError(error),
    });

    this.serverReady = this.createReadyPromise();
  }

  private createReadyPromise(): Promise<void> {
    const ready = new Promise<void>((resolve, reject) => {
      this.serverReadyResolve = resolve;
      this.serverReadyReject = reject;
    });
    // A startup that fails before anyone waits is reported through `waitForReady` later, not as unhandled
    ready.catch(() => {});
    return ready;
  }

  enable(context: MainModuleScope): void {
    const { app } = context;

    // Log production startup info
    if (app.isPackaged) {
      logStartupBanner();
      logInfo('Startup ID:', this.startupId);
      logInfo('apack API Server Module Enabled');
      logInfo('Log file location:', getLogger().getLogPath());
      logInfo('Renderer log file location:', getLogger().getRendererLogPath());
      logInfo('App events log file location:', getLogger().getAppEventsLogPath());
    }

    // Direct MessagePort handoff between app windows and the API UtilityProcess
    ipcMain.on(API_PORT_CHANNELS.REQUEST, (event) => { this.portBroker.handleRequest(event); });

    // Let renderer query current API status on startup (avoids IPC race condition)
    ipcMain.handle('api:get-status', () => ({
      running: this.processManager.isRunning(),
      error: this.lastError,
      restartAttempts: this.restartAttempts,
      startupId: this.startupId,
      logPath: getLogger().getLogPath(),
      rendererLogPath: getLogger().getRendererLogPath(),
      appEventsLogPath: getLogger().getAppEventsLogPath(),
    }));

    // Reveal the log file in the system file manager
    ipcMain.handle('api:open-log-file', () => {
      shell.showItemInFolder(getLogger().getLogPath());
    });

    // Reload the renderer page (bypasses will-navigate security handler)
    ipcMain.handle('app:reload', (event) => {
      event.sender.reload();
    });

    // Relaunch the entire Electron app
    ipcMain.handle('app:relaunch', () => {
      app.relaunch();
      app.quit();
    });

    app.whenReady().then(() => {
      powerMonitor.on('suspend', () => this.processManager.setPowerState('suspended'));
      powerMonitor.on('resume', () => this.processManager.setPowerState('active'));
      return this.startApiServer();
    });
    
    // The quit waits for the API to have gone, and then finishes whatever the wait ended in. Nothing asks for a
    // quit twice — not a harness, not the OS — so one cancelled for good leaves the app up and idle. An API that
    // outlived it is ended by the next launch, which kills an orphaned one before starting its own.
    app.on('before-quit', event => {
      if (this.shutdownComplete) return;
      event.preventDefault();
      this.isShuttingDown = true;
      this.clearRestartTimer();
      clearTimeout(this.restartReset);
      this.portBroker.onBackendStopped();
      const stopProcess = () => this.processManager.stop(API_CONFIG.SHUTDOWN_TIMEOUT);
      this.shutdown ??= (this.starting ? this.starting.catch(() => {}).then(stopProcess) : stopProcess())
        .catch(error => { logError('[MAIN] API shutdown failed; quitting without it:', error); })
        .then(() => {
          this.shutdownComplete = true;
          app.quit();
        });
    });

  }

  private clearRestartTimer(): void {
    if (this.restartTimer !== undefined) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
  }

  private startApiServer(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.isShuttingDown || this.processManager.isRunning()) return Promise.resolve();
    this.clearRestartTimer();

    this.starting = (async () => {
      try {
        this.lastError = undefined; // Clear stale error so getStatus() doesn't report old crashes during restart
        // A launch after the last one settled starts a new startup; a restart after a crash continues the current one
        if (!this.serverReadyResolve) this.serverReady = this.createReadyPromise();
        logInfo('[MAIN] Starting API server...');
        broadcastEvent(API_EVENTS.STARTING);

        const paths = getApiPaths();
        await this.cleanupOrphanedApiChildren(paths.apiPath);
        if (this.isShuttingDown || this.processManager.isRunning()) return;
        await this.launchApiServer(paths.apiPath);
      } finally {
        this.starting = undefined;
      }
    })();
    return this.starting;
  }

  private async cleanupOrphanedApiChildren(apiPath: string): Promise<void> {
    if (process.platform !== 'darwin' && process.platform !== 'linux') return;

    const serverPath = path.join(apiPath, 'dist', 'server.js');
    const psOutput = await new Promise<string>((resolve) => {
      execFile('ps', ['-axo', 'pid=,ppid=,command='], (error, stdout) => {
        if (error) {
          logWarn('[MAIN] Failed to inspect existing API processes before startup:', error.message);
          resolve('');
          return;
        }
        resolve(stdout);
      });
    });

    for (const line of psOutput.split('\n')) {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) continue;

      const pid = Number(match[1]);
      const ppid = Number(match[2]);
      const command = match[3];
      if (pid === process.pid) continue;
      if (!command.includes(serverPath)) continue;
      if (!command.includes('apack')) continue;

      if (ppid !== 1) {
        logWarn('[MAIN] Existing API child found before startup; leaving attached process alone', { pid, ppid });
        continue;
      }

      try {
        process.kill(pid, 'SIGKILL');
        logWarn('[MAIN] Killed orphaned API child before startup', { pid, ppid, serverPath });
      } catch (error) {
        logWarn('[MAIN] Failed to kill orphaned API child before startup', {
          pid,
          ppid,
          error: errorMessage(error),
        });
      }
    }
  }

  private async launchApiServer(apiPath: string): Promise<void> {
    // Validate API path exists
    logInfo(`[MAIN] Checking API path: ${apiPath}`);
    if (!fs.existsSync(apiPath)) {
      const error = `API path does not exist: ${apiPath}`;
      logError(`[MAIN] ${error}`);
      broadcastEvent(API_EVENTS.ERROR, { error });
      this.serverReadyReject?.(new Error(error));
      return;
    }

    const serverPath = path.join(apiPath, 'dist', 'server.js');
    logInfo(`[MAIN] Checking server file: ${serverPath}`);
    if (!fs.existsSync(serverPath)) {
      const error = `Server file does not exist: ${serverPath}`;
      logError(`[MAIN] ${error}`);
      broadcastEvent(API_EVENTS.ERROR, { error });
      this.serverReadyReject?.(new Error(error));
      return;
    }
    logInfo('[MAIN] Server file found, proceeding with launch...');
    if (this.isShuttingDown) return;

    // Fork as an Electron UtilityProcess so the API runs on Electron's built-in Node 24 in both dev and production
    // and can receive brokered MessagePortMain channels directly from main.
    const execArgv = getUtilityExecArgv();

    logInfo('[MAIN] Forking API server utilityProcess:');
    logInfo(`[MAIN]   Module: ${serverPath}`);
    logInfo(`[MAIN]   ExecArgv: ${JSON.stringify(execArgv)}`);
    logInfo(`[MAIN]   CWD: ${apiPath}`);

    const apiProcess = utilityProcess.fork(serverPath, [], {
      cwd: apiPath,
      env: getEnvironment({
        startupId: this.startupId,
        logDir: getAppEnvironment().logsDir,
      }),
      execArgv,
      stdio: 'pipe',
      serviceName: 'apack API Server',
    });

    this.processManager.setProcess(apiProcess);
    this.scheduleRestartResetTimeout();
  }

  private handleServerReady(socket?: string): void {
    this.actualSocket = socket;
    this.lastError = undefined;
    logInfo(socket ? `[MAIN] API server is ready (tool socket: ${socket})` : '[MAIN] API server is ready');
    const activeProcess = this.processManager.getProcess();
    if (activeProcess) this.portBroker.onBackendReady(activeProcess);
    const reloaded = this.announceReload;
    this.announceReload = false;
    broadcastEvent(API_EVENTS.STARTED, { startupId: this.startupId, ...(reloaded && { reloaded: true }) });
    
    if (this.serverReadyResolve) {
      this.serverReadyResolve();
      this.serverReadyResolve = undefined;
      this.serverReadyReject = undefined;
    }
  }

  private handleProcessExit(code: number | null, signal: NodeJS.Signals | null): void {
    logError(`[MAIN] API server exited with code ${code} and signal ${signal}`);
    this.portBroker.onBackendStopped();
    // This launch did not stay up, so it forgives nothing
    clearTimeout(this.restartReset);
    const errors = this.processManager.getFatalErrors();
    const stderr = this.processManager.getLastStderr();
    if (errors.length > 0) {
      this.lastError = {
        message: errors[0].message,
        stack: errors.map(e => e.stack || e.message).join('\n\n'),
      };
    } else if (stderr) {
      this.lastError = { message: stderr };
    } else if (!this.lastError) {
      this.lastError = { message: `Backend process exited unexpectedly (code ${code})` };
    }
    const willRestart = !this.isShuttingDown && this.restartAttempts < API_CONFIG.MAX_RESTART_ATTEMPTS;
    broadcastEvent(API_EVENTS.STOPPED, { error: this.lastError, restarting: willRestart });

    // Reset state
    this.actualSocket = undefined;

    // Handle restart
    if (willRestart) {
      this.restartAttempts++;
      logWarn(`[MAIN] Restarting API server (attempt ${this.restartAttempts}/${API_CONFIG.MAX_RESTART_ATTEMPTS})...`);
      broadcastEvent(API_EVENTS.RESTARTING, {
        attempt: this.restartAttempts,
        maxAttempts: API_CONFIG.MAX_RESTART_ATTEMPTS,
        startupId: this.startupId,
      });

      this.clearRestartTimer();
      this.restartTimer = setTimeout(() => {
        this.restartTimer = undefined;
        void this.startApiServer();
      }, API_CONFIG.RESTART_DELAY);
    } else if (this.restartAttempts >= API_CONFIG.MAX_RESTART_ATTEMPTS) {
      // What the API said as it exited is what the user is shown: an unreadable database names its fix there
      const failure = this.lastError.message;
      logError(`[MAIN] Max restart attempts reached: ${failure}`);
      broadcastEvent(API_EVENTS.ERROR, { error: failure });
      this.serverReadyReject?.(new Error(failure));
      this.serverReadyResolve = undefined;
      this.serverReadyReject = undefined;
    }
  }

  private handleProcessError(error: Error): void {
    this.lastError = { message: error.message, stack: error.stack };
    logError('[MAIN] Failed to start API server:', error);
    // Avoid broadcasting terminal `api:error` while automatic restarts can still recover; `handleProcessExit`
    // drives recovery or broadcasts terminal `api:error` once restart attempts are exhausted.
    if (!this.isShuttingDown && this.restartAttempts >= API_CONFIG.MAX_RESTART_ATTEMPTS) {
      broadcastEvent(API_EVENTS.ERROR, { error: error.message });
    }
  }

  /**
   * Forgives earlier crashes once the launch just made has stayed up for `SUCCESS_CHECK_DELAY`.
   *
   * **One per launch, and a launch's own.** Whether "the process is running" is asked when the timer fires, and by
   * then the process may be a later launch: an API that dies a couple of seconds after each start was running, as
   * its successor, at every earlier launch's moment, so each crash was forgiven and the restarts never ran out.
   * A launch that exits cancels its own (`handleProcessExit`), and one replaced without exiting through there (a
   * reload) is cancelled by the launch that replaces it.
   */
  private scheduleRestartResetTimeout(): void {
    clearTimeout(this.restartReset);
    this.restartReset = setTimeout(() => {
      if (this.processManager.isRunning()) {
        this.restartAttempts = 0;
      }
    }, API_CONFIG.SUCCESS_CHECK_DELAY);
  }

  /**
   * Ends the API and starts it again, for a development rebuild — **not the restart the rest of this class
   * means.**
   *
   * **It must not look like a crash.** `handleProcessExit` counts every exit against
   * `MAX_RESTART_ATTEMPTS`, forgiven only `SUCCESS_CHECK_DELAY` after a launch that is still running, so a
   * handful of quick edits would exhaust the budget and land on `api:stopped { restarting: false }`, the
   * shell's terminal `error` state, and main refusing to start the API again. `ProcessManager.stop()` is
   * what keeps it off that path, and it waits for the exit, which is what makes the next launch correct.
   *
   * **It does not wait for readiness, deliberately.** Nothing needs it: the window follows the API through
   * `api:started`, and a rebuild arriving while the previous API is still booting *should* replace it, because
   * that API is already stale.
   */
  public reloadApiServer(): Promise<void> {
    this.reloading ??= (async () => {
      try {
        this.clearRestartTimer();
        clearTimeout(this.restartReset);
        if (this.starting) await this.starting.catch(() => {});
        // Read by `handleServerReady`, which happens after this resolves — so it is a flag and not this
        // promise, however much one field would be tidier than two
        this.announceReload = true;
        this.portBroker.onBackendStopped();
        await this.processManager.stop(API_CONFIG.SHUTDOWN_TIMEOUT);
        await this.startApiServer();
      } finally {
        this.reloading = undefined;
      }
    })();
    return this.reloading;
  }

  public getStatus(): {
    running: boolean;
    pid?: number;
    socket?: string;
    restartAttempts: number;
    startupId: string;
    logPath: string;
    rendererLogPath: string;
    appEventsLogPath: string;
  } {
    return {
      running: this.processManager.isRunning(),
      pid: this.processManager.getPid(),
      ...(this.actualSocket !== undefined ? { socket: this.actualSocket } : {}),
      restartAttempts: this.restartAttempts,
      startupId: this.startupId,
      logPath: getLogger().getLogPath(),
      rendererLogPath: getLogger().getRendererLogPath(),
      appEventsLogPath: getLogger().getAppEventsLogPath(),
    };
  }

  /**
   * Resolves once the API is up. A launch that dies is reported by `serverReady` itself, with its own error once
   * the restarts run out; what is bounded here is a launch that is alive and not ready, for as long as it is doing
   * nothing. One that is starting slowly on a busy machine is working, and is waited for.
   */
  public waitForReady(): Promise<void> {
    // The pid of whichever launch is current, since a restart replaces it mid-wait. A relaunch's total starting
    // lower costs one reading's work, since the stall decision compares each reading with the one before
    const readings = new Map<number, WorkReading>();
    const work: WorkReading = async () => {
      const pid = this.processManager.getPid();
      if (pid === undefined) return undefined;
      if (!readings.has(pid)) readings.set(pid, processWork(pid));
      return readings.get(pid)!();
    };
    return answerWhileWorking(this.serverReady, { work, what: 'The API server' });
  }
}

export function createApiServer(): ApiServer {
  return new ApiServer();
}
