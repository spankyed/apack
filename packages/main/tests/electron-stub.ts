// Electron's `app`, as much of it as the main process's own modules use. A test asks for the module under
// test, not for Electron, so the parts that talk to a running browser process stand in as recorded calls.
export const app = {
  isPackaged: false,
  name: 'apack',
  paths: new Map<string, string>(),
  setNameCalls: [] as string[],
  setName(name: string) {
    this.name = name;
    this.setNameCalls.push(name);
  },
  setPath(key: string, value: string) {
    this.paths.set(key, value);
  },
  getPath(key: string): string {
    // What Electron answers before anything overrides it: the platform's directory for this app name
    return this.paths.get(key) ?? `/platform/${key}/${this.name}`;
  },
  getVersion: () => '0.0.0-test',
  getAppPath: () => '/stub/app',
};

/** Puts `app` back as a fresh Electron would hand it over, between tests. */
export function resetElectronStub(): void {
  shell.opened.length = 0;
  clipboard.written.length = 0;
  notifications.shown.length = 0;
  notifications.supported = true;
  clipboard.current = '';
  ipcMain.handlers.clear();
  app.isPackaged = false;
  app.name = 'apack';
  app.paths.clear();
  app.setNameCalls.length = 0;
}

/** The handlers a window registered, so a test invokes one as the renderer would */
export const ipcMain = {
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void {
    ipcMain.handlers.set(channel, listener);
  },
  on: () => {},
};
/** What this process put on the clipboard, in order, so a test reads the write rather than the call */
export const clipboard = {
  written: [] as string[],
  /** What the clipboard holds now: what a write put there, or what a test set as if a person copied it */
  current: '',
  readText(): string {
    return clipboard.current;
  },
  writeText(text: string): void {
    clipboard.written.push(text);
    clipboard.current = text;
  },
};
/** What this process asked the OS to open, so a test reads the decision rather than the call */
export const shell = {
  showItemInFolder: () => {},
  opened: [] as string[],
  openExternal(url: string): Promise<void> {
    shell.opened.push(url);
    return Promise.resolve();
  },
  openPath(filePath: string): Promise<string> {
    shell.opened.push(filePath);
    return Promise.resolve('');
  },
};
/** What this process showed as a system notification, so a test reads the shown notification rather than the call */
export const notifications = {
  shown: [] as Array<{ title: string; body: string }>,
  supported: true,
};
/** Electron's `Notification`, as far as the main process's notify module uses it */
export class Notification {
  static isSupported(): boolean {
    return notifications.supported;
  }
  private readonly options: { title: string; body: string };
  constructor(options: { title: string; body: string }) {
    this.options = options;
  }
  show(): void {
    notifications.shown.push({ title: this.options.title, body: this.options.body });
  }
}
