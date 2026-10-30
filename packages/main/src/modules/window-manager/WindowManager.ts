import type {AppModule} from '../../AppModule.ts';
import {MainModuleScope} from '../../MainModuleScope.ts';
import {BrowserWindow, ipcMain, app, dialog, shell} from 'electron';
import contextMenu from 'electron-context-menu';
import type {AppInitConfig} from '../../AppInitConfig.ts';
import type {ApiServer} from '../api-server/ApiServer.ts';
import type {SplashScreen} from '../splash-screen/SplashScreen.ts';
import {join} from 'node:path';
import {WINDOW_CONFIG} from './constants.ts';
import {getWindowIcon} from './helpers.ts';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {getMediaBasePath} from '../media-protocol/paths.ts';
import {logRenderer, logRendererFatal} from '../api-server/logger.ts';
import {resolveAppEnvironment} from '@apackdev/sdk/env';
import {splitRef} from '@apackdev/sdk/ids';
import {openExternalUrl, openFilePath} from '../shell-access.ts';

class WindowManager implements AppModule {
  readonly #preload: {path: string};
  readonly #renderer: {path: string} | URL;
  readonly #openDevTools;
  readonly #apiServer?: ApiServer;
  readonly #splashScreen?: SplashScreen;
  readonly #popoutWindows = new Map<string, BrowserWindow>();

  constructor({initConfig, openDevTools = false, apiServer, splashScreen}: {
    initConfig: AppInitConfig, 
    openDevTools?: boolean, 
    apiServer?: ApiServer,
    splashScreen?: SplashScreen
  }) {
    this.#preload = initConfig.preload;
    this.#renderer = initConfig.renderer;
    this.#openDevTools = openDevTools;
    this.#apiServer = apiServer;
    this.#splashScreen = splashScreen;
  }

  async enable({app}: MainModuleScope): Promise<void> {
    await app.whenReady();
    
    // Set dock icon for macOS in development (production uses bundled icon from Info.plist)
    if (!app.isPackaged && process.platform === 'darwin' && app.dock) {
      app.dock.setIcon(getWindowIcon('png'));
    }
    
    // Set up window control handlers
    this.setupWindowControls();
    this.setupRendererLogHandlers();
    
    // Update splash screen status while waiting for API server
    if (this.#splashScreen) {
      // this.#splashScreen.updateStatus('Waking Up Assistant');
    }
    
    // Wait for API server to be ready before creating window
    if (this.#apiServer) {
      try {
        await this.#apiServer.waitForReady();
      } catch (error) {
        console.error('[MAIN] API server failed to start:', error);

        // Update splash screen with error message
        if (this.#splashScreen) {
          this.#splashScreen.updateStatus('Failed to start API server. Please restart the application.');
        }

        // Show dialog so user can retry or quit
        const { response } = await dialog.showMessageBox({
          type: 'error',
          title: 'Startup Error',
          message: 'Failed to start API server',
          detail: (error as Error)?.message || 'The backend process could not start. You can relaunch to try again.',
          buttons: ['Relaunch', 'Quit'],
          defaultId: 0,
        });

        if (this.#splashScreen) {
          await this.#splashScreen.close();
        }

        if (response === 0) {
          app.relaunch();
        }
        app.quit();
        return;
      }
    }
    
    // Update splash status
    if (this.#splashScreen && this.#splashScreen.isVisible()) {
      // this.#splashScreen.updateStatus('Loading...');
    }
    
    await this.restoreOrCreateWindow(true);
    app.on('second-instance', () => this.restoreOrCreateWindow(true));
    
    // On macOS, only create/restore window if there are no windows open
    app.on('activate', () => {
      // Check if there are any windows currently open
      if (BrowserWindow.getAllWindows().length === 0) {
        // No windows exist, create one
        this.restoreOrCreateWindow(true);
      } else {
        // Windows exist, just focus the main one
        const mainWindow = BrowserWindow.getAllWindows().find(w => 
          !w.isDestroyed() && this.isMainWindow(w)
        );
        if (mainWindow) {
          if (mainWindow.isMinimized()) {
            mainWindow.restore();
          }
          if (process.env.PLAYWRIGHT_TEST !== 'true' || process.env.PLAYWRIGHT_VISIBLE === '1') {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      }
    });
  }

  private setupWindowControls(): void {
    ipcMain.on('window:minimize', () => {
      const window = BrowserWindow.getFocusedWindow();
      window?.minimize();
    });

    ipcMain.on('window:maximize', () => {
      const window = BrowserWindow.getFocusedWindow();
      if (window) {
        if (window.isMaximized()) {
          window.unmaximize();
        } else {
          window.maximize();
        }
      }
    });

    ipcMain.on('window:close', () => {
      const window = BrowserWindow.getFocusedWindow();
      window?.close();
    });

    ipcMain.handle('surface:popout', async (event, surfaceId: string, title?: string) => {
      // It reaches the popout's URL, so only a surface's ref gets a window
      if (!splitRef(surfaceId)) {
        throw new Error('Invalid surface id');
      }

      const existing = this.#popoutWindows.get(surfaceId);
      if (existing && !existing.isDestroyed()) {
        if (existing.isMinimized()) {
          existing.restore();
        }
        if (process.env.PLAYWRIGHT_TEST !== 'true' || process.env.PLAYWRIGHT_VISIBLE === '1') {
          existing.show();
          existing.focus();
        }
        return;
      }

      const popout = await this.createPopoutWindow(surfaceId, title);
      this.#popoutWindows.set(surfaceId, popout);
      popout.on('closed', () => this.#popoutWindows.delete(surfaceId));
      if (process.env.PLAYWRIGHT_TEST !== 'true' || process.env.PLAYWRIGHT_VISIBLE === '1') {
        popout.show();
        popout.focus();
      }
    });

    ipcMain.on('zoom:changed', (event, zoomFactor: number) => {
      if (process.platform !== 'darwin') return;
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) {
        const y = Math.round((42 * zoomFactor - 12) / 2);
        win.setWindowButtonPosition({x: 10, y});
      }
    });

    // Handle directory selection dialog
    ipcMain.handle('dialog:select-directory', async () => {
      const window = BrowserWindow.getFocusedWindow();
      if (!window) return null;

      const result = await dialog.showOpenDialog(window, {
        properties: ['openDirectory'],
        title: 'Select Directory',
        defaultPath: app.getPath('home'),
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      return result.filePaths[0];
    });

    // Handle file/directory selection dialog
    ipcMain.handle('dialog:select-path', async (event, options?: {
      allowMultiple?: boolean;
      type: 'file' | 'directory' | 'both';
    }) => {
      const window = BrowserWindow.getFocusedWindow();
      if (!window) return null;

      const type = options?.type || 'file';
      const properties: any[] = [];

      if (type === 'directory') {
        properties.push('openDirectory');
      } else if (type === 'file') {
        properties.push('openFile');
      } else {
        // 'both' - works on macOS, shows directory picker on Windows/Linux
        properties.push('openFile', 'openDirectory');
      }

      if (options?.allowMultiple) {
        properties.push('multiSelections');
      }

      const result = await dialog.showOpenDialog(window, {
        properties,
        title: type === 'directory' ? 'Select Directory' : 'Select File',
        defaultPath: app.getPath('home'),
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      return options?.allowMultiple ? result.filePaths : result.filePaths[0];
    });

    // Handle file reading
    ipcMain.handle('file:read', async (event, filePath: string) => {
      return fs.readFile(filePath, 'utf-8');
    });

    // Handle file reading as base64 (for binary files like images)
    ipcMain.handle('file:read-base64', async (event, filePath: string) => {
      const buffer = await fs.readFile(filePath);
      return buffer.toString('base64');
    });

    // Handle opening external URLs in default browser
    ipcMain.handle('shell:openExternal', (_event, url: string) => openExternalUrl(url));

    // Handle revealing files in OS file explorer
    ipcMain.handle('shell:showItemInFolder', async (_event, filePath: string) => {
      shell.showItemInFolder(filePath);
    });

    // Handle opening files with the OS default application
    ipcMain.handle('shell:openPath', (_event, filePath: string) => openFilePath(filePath));

    // Media upload handler
    ipcMain.handle('media:upload', async (_event, entityId: string, base64Data: string, mimeType: string) => {
      // Validate entityId and mimeType
      if (!entityId || entityId.includes('..') || entityId.includes('/') || entityId.includes('\\')) {
        throw new Error('Invalid entityId');
      }

      const allowedTypes: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/gif': 'gif',
        'image/webp': 'webp',
      };

      const ext = allowedTypes[mimeType];
      if (!ext) {
        throw new Error(`Unsupported image type: ${mimeType}`);
      }

      const buffer = Buffer.from(base64Data, 'base64');
      if (buffer.length > 10 * 1024 * 1024) {
        throw new Error('Image exceeds 10MB limit');
      }

      const filename = `${crypto.randomUUID()}.${ext}`;
      const dir = join(getMediaBasePath(), entityId);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(join(dir, filename), buffer);

      return `media://${entityId}/${filename}`;
    });

    // Media delete handler
    ipcMain.handle('media:delete', async (_event, entityId: string, filename: string) => {
      if (!entityId || !filename || entityId.includes('..') || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        throw new Error('Invalid path');
      }
      const filePath = join(getMediaBasePath(), entityId, filename);
      await fs.unlink(filePath).catch(() => {});
    });

    // Media delete-all handler
    ipcMain.handle('media:delete-all', async (_event, entityId: string) => {
      if (!entityId || entityId.includes('..') || entityId.includes('/') || entityId.includes('\\')) {
        throw new Error('Invalid entityId');
      }
      const dir = join(getMediaBasePath(), entityId);
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    });
  }

  private setupRendererLogHandlers(): void {
    ipcMain.handle('renderer-log:write', (_event, entry: {
      level?: 'debug' | 'info' | 'warn' | 'error';
      source?: string;
      message?: string;
      stack?: string;
      meta?: unknown;
      fatal?: boolean;
    }) => {
      const level = entry.level ?? 'info';
      const payload = {
        source: entry.source ?? 'renderer',
        message: entry.message ?? '',
        stack: entry.stack,
        meta: entry.meta,
      };

      if (entry.fatal ?? (level === 'error')) {
        logRendererFatal(payload.message || 'renderer error', payload);
      } else {
        logRenderer(level, payload);
      }
    });
  }

  private attachRendererDiagnostics(browserWindow: BrowserWindow): void {
    const wc = browserWindow.webContents;
    const windowId = browserWindow.id;

    wc.on('console-message', (_event, level, message, line, sourceId) => {
      const mappedLevel = level >= 3 ? 'error' : level === 2 ? 'warn' : level === 1 ? 'info' : 'debug';
      logRenderer(mappedLevel, {
        source: 'webContents.console',
        windowId,
        message,
        line,
        sourceId,
      });
    });

    wc.on('render-process-gone', (_event, details) => {
      logRendererFatal('render process gone', {
        source: 'webContents.render-process-gone',
        windowId,
        details,
      });
    });

    (wc as any).on('child-process-gone', (_event: Electron.Event, details: unknown) => {
      logRendererFatal('renderer child process gone', {
        source: 'webContents.child-process-gone',
        windowId,
        details,
      });
    });

    wc.on('unresponsive', () => {
      logRendererFatal('renderer window unresponsive', {
        source: 'webContents.unresponsive',
        windowId,
      });
    });

    wc.on('responsive', () => {
      logRenderer('info', {
        source: 'webContents.responsive',
        windowId,
        message: 'renderer window responsive',
      });
    });

    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      const payload = {
        source: 'webContents.did-fail-load',
        windowId,
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
      };
      if (isMainFrame) {
        logRendererFatal('renderer failed to load main frame', payload);
      } else {
        logRenderer('warn', payload);
      }
    });

    wc.on('preload-error', (_event, preloadPath, error) => {
      logRendererFatal('renderer preload error', {
        source: 'webContents.preload-error',
        windowId,
        preloadPath,
        message: error.message,
        stack: error.stack,
      });
    });
  }

  async createWindow(): Promise<BrowserWindow> {
    // Determine icon path based on platform (use dev icon in development)
    const iconPath = getWindowIcon();

    // Get the API port before creating the window
    const apiPort = this.#apiServer?.getStatus().port || 3001;
    const startupId = this.#apiServer?.getStatus().startupId;
    console.log(`[MAIN] Creating window with API port: ${apiPort}`);

    const browserWindow = new BrowserWindow({
      show: false,
      width: WINDOW_CONFIG.WIDTH,
      height: WINDOW_CONFIG.HEIGHT,
      minWidth: WINDOW_CONFIG.MIN_WIDTH,
      minHeight: WINDOW_CONFIG.MIN_HEIGHT,
      center: true,
      title: WINDOW_CONFIG.MAIN_TITLE, // Used for window identification
      icon: iconPath, // Set the window icon
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
      ...(process.platform === 'darwin' ? { trafficLightPosition: {x: 10, y: 15} } : {}),
      frame: false, // All platforms: frameless with custom window controls
      transparent: false,
      vibrancy: 'under-window', // macOS: window vibrancy effect
      backgroundColor: '#171717',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false, // Sandbox disabled because the demo of preload script depend on the Node.ts api
        webviewTag: false, // The webview tag is not recommended. Consider alternatives like an iframe or Electron's BrowserView. @see https://www.electronjs.org/docs/latest/api/webview-tag#warning
        preload: this.#preload.path,
        additionalArguments: [
          `--api-port=${apiPort}`,
          ...(startupId ? [`--startup-id=${startupId}`] : []),
        ],
      },
    });

    contextMenu({ window: browserWindow });
    this.attachRendererDiagnostics(browserWindow);

    try {
      const startup = resolveAppEnvironment().env === 'test' ? process.env.APACK_PERFORMANCE_STARTUP : undefined;
      const query = startup === undefined ? undefined : { performanceStartup: startup };
      if (this.#renderer instanceof URL) {
        const url = new URL(this.#renderer.href);
        if (startup !== undefined) url.searchParams.set('performanceStartup', startup);
        await browserWindow.loadURL(url.href);
      } else {
        await browserWindow.loadFile(this.#renderer.path, { query });
      }
    } catch (error) {
      console.error('[MAIN] Failed to load renderer:', error);
      await this.closeSplashWithDelay();
      throw error;
    }

    return browserWindow;
  }

  private waitForRendererReady(): Promise<void> {
    return new Promise<void>((resolve) => {
      const TIMEOUT = 15_000;

      const onReady = () => {
        clearTimeout(timer);
        ipcMain.removeListener('renderer:ready', onReady);
        resolve();
      };

      const timer = setTimeout(() => {
        console.warn('[MAIN] Renderer did not signal ready within timeout, showing window anyway');
        ipcMain.removeListener('renderer:ready', onReady);
        resolve();
      }, TIMEOUT);

      ipcMain.on('renderer:ready', onReady);
    });
  }

  async createPopoutWindow(surfaceId: string, surfaceTitle?: string): Promise<BrowserWindow> {
    const iconPath = getWindowIcon();
    const apiPort = this.#apiServer?.getStatus().port || 3001;
    const startupId = this.#apiServer?.getStatus().startupId;
    const title = `${WINDOW_CONFIG.POPOUT_TITLE_PREFIX}-${surfaceId}`;

    const browserWindow = new BrowserWindow({
      show: false,
      width: 1180,
      height: 820,
      minWidth: 720,
      minHeight: 480,
      center: true,
      title,
      icon: iconPath,
      titleBarStyle: 'hidden',
      ...(process.platform === 'darwin' ? { trafficLightPosition: {x: 14, y: 10} } : {}),
      frame: false,
      transparent: false,
      vibrancy: 'under-window',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        webviewTag: false,
        preload: this.#preload.path,
        additionalArguments: [
          `--api-port=${apiPort}`,
          ...(startupId ? [`--startup-id=${startupId}`] : []),
        ],
      },
    });

    browserWindow.webContents.on('before-input-event', (event, input) => {
      const isCloseShortcut = input.key.toLowerCase() === 'w' && (
        process.platform === 'darwin' ? input.meta : input.control
      );

      if (isCloseShortcut) {
        event.preventDefault();
        browserWindow.close();
      }
    });

    contextMenu({ window: browserWindow });
    this.attachRendererDiagnostics(browserWindow);

    const query = {
      popout: 'surface',
      surfaceId,
      ...(surfaceTitle ? { title: surfaceTitle } : {}),
    };

    try {
      if (this.#renderer instanceof URL) {
        const url = new URL(this.#renderer.href);
        for (const [key, value] of Object.entries(query)) {
          url.searchParams.set(key, value);
        }
        await browserWindow.loadURL(url.href);
      } else {
        await browserWindow.loadFile(this.#renderer.path, { query });
      }
    } catch (error) {
      console.error('[MAIN] Failed to load popout renderer:', error);
      throw error;
    }

    return browserWindow;
  }

  private async closeSplashWithDelay(): Promise<void> {
    if (this.#splashScreen && this.#splashScreen.isVisible()) {
      setTimeout(async () => {
        await this.#splashScreen?.close();
      }, WINDOW_CONFIG.SPLASH_CLOSE_DELAY);
    }
  }

  private isMainWindow(window: BrowserWindow): boolean {
    // Use window title as identifier
    return window.getTitle() === WINDOW_CONFIG.MAIN_TITLE;
  }

  async restoreOrCreateWindow(show = false) {
    // Find main window using window tagging
    let window = BrowserWindow.getAllWindows().find(w =>
      !w.isDestroyed() && this.isMainWindow(w)
    );

    const isNewWindow = window === undefined;
    let rendererReadyPromise: Promise<void> | undefined;
    if (isNewWindow) {
      rendererReadyPromise = this.waitForRendererReady();
      window = await this.createWindow();
      await rendererReadyPromise;
    }

    if (!show || !window) {
      return window;
    }

    // Handle window visibility
    if (window.isMinimized()) {
      window.restore();
    }

    if (process.env.PLAYWRIGHT_TEST !== 'true' || process.env.PLAYWRIGHT_VISIBLE === '1') {
      window.show();
      window.focus();
    }

    if (this.#openDevTools) {
      window.webContents.openDevTools();
    }

    // Close splash after main window is shown
    await this.closeSplashWithDelay();

    return window;
  }

}

export function createWindowManagerModule(...args: ConstructorParameters<typeof WindowManager>) {
  return new WindowManager(...args);
}
