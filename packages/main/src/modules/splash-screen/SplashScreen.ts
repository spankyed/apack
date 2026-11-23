import { BrowserWindow, app } from 'electron';
import { AppModule } from '../../AppModule.ts';
import { MainModuleScope } from '../../MainModuleScope.ts';
import { join } from 'node:path';
import { SPLASH_CONFIG } from './constants.ts';

export class SplashScreen implements AppModule {
  private splashWindow: BrowserWindow | null = null;
  private isQuitting = false;


  async enable({ app }: MainModuleScope): Promise<void> {
    app.on('before-quit', () => { this.isQuitting = true; });
    await app.whenReady();
    this.createSplashWindow();
  }

  private createSplashWindow(): void {
    const __dirname = import.meta.dirname;
    
    this.splashWindow = new BrowserWindow({
      width: SPLASH_CONFIG.WIDTH,
      height: SPLASH_CONFIG.HEIGHT,
      title: SPLASH_CONFIG.TITLE,
      frame: false,
      transparent: true,
      alwaysOnTop: false,
      resizable: false,
      movable: true,
      center: true,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // Load the splash HTML file from assets
    const splashPath = join(__dirname, 'assets', 'splash.html');
    this.splashWindow.loadFile(splashPath)
      .catch((err) => console.error('[SPLASH] Failed to load splash HTML:', err));

    this.splashWindow.once('ready-to-show', () => {
      if (this.isValid() && (process.env.PLAYWRIGHT_TEST !== 'true' || process.env.PLAYWRIGHT_VISIBLE === '1')) {
        const version = app.getVersion();
        this.splashWindow!.webContents.executeJavaScript(`
          const versionEl = document.getElementById('version');
          if (versionEl) { versionEl.textContent = 'v${version}'; }
        `).catch(() => {});
        this.splashWindow!.show();
      }
    });

    // Prevent manual close, but allow quit (Cmd+Q)
    this.splashWindow.on('close', (event) => {
      if (!this.isQuitting && this.isValid() && this.splashWindow!.getOpacity() === 1) {
        event.preventDefault();
      }
    });
  }

  private isValid(): boolean {
    return this.splashWindow !== null && !this.splashWindow.isDestroyed();
  }

  public isVisible(): boolean {
    return this.isValid() && this.splashWindow!.isVisible();
  }

  public updateStatus(message: string): void {
    if (!this.isValid()) return;
    
    this.splashWindow!.webContents.executeJavaScript(`
      const statusElement = document.getElementById('status');
      if (statusElement) {
        statusElement.textContent = '${message.replace(/'/g, "\\'")}';
      }
    `).catch(() => {
      // Silently ignore errors during close
    });
  }

  public async close(): Promise<void> {
    if (!this.isValid()) return;

    try {
      // Fade out animation using Electron's setOpacity
      let opacity = 1.0;
      
      while (opacity > 0 && this.isValid()) {
        this.splashWindow!.setOpacity(opacity);
        opacity -= SPLASH_CONFIG.FADE_STEP;
        await new Promise(resolve => setTimeout(resolve, SPLASH_CONFIG.FADE_INTERVAL));
      }
      
      if (this.isValid()) {
        this.splashWindow!.destroy();
      }
    } catch {
      // Force close on error
      this.splashWindow?.destroy();
    } finally {
      this.splashWindow = null;
    }
  }
}

export function createSplashScreen(): SplashScreen {
  return new SplashScreen();
}