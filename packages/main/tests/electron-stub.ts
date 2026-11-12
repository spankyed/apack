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
  app.isPackaged = false;
  app.name = 'apack';
  app.paths.clear();
  app.setNameCalls.length = 0;
}

export const ipcMain = { handle: () => {}, on: () => {} };
/** What this process put on the clipboard, in order, so a test reads the write rather than the call */
export const clipboard = {
  written: [] as string[],
  writeText(text: string): void {
    clipboard.written.push(text);
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
