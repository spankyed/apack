// Electron, as much of it as the preload uses. A test asks for the bridge, not for a browser process, so
// what talks to one stands in as recorded calls — the same shape `@app/main`'s stub has, for the same
// reason: the decision is what a case reads, never the call.

/** What `contextBridge.exposeInMainWorld` was given, which is the whole subject of this suite. */
export const contextBridge = {
  exposed: new Map<string, unknown>(),
  exposeInMainWorld(name: string, api: unknown) {
    contextBridge.exposed.set(name, api);
  },
};

export const ipcRenderer = {
  /** Every fire-and-forget send, in order */
  sent: [] as { channel: string; args: unknown[] }[],
  /** Every `invoke`, in order */
  invoked: [] as { channel: string; args: unknown[] }[],
  /** The listeners `on` registered, by channel, so a case can see an unsubscribe remove one */
  listeners: new Map<string, ((...args: unknown[]) => void)[]>(),
  /** What a synchronous read answers with */
  syncAnswers: new Map<string, unknown>(),

  send(channel: string, ...args: unknown[]) {
    ipcRenderer.sent.push({ channel, args });
  },
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    ipcRenderer.invoked.push({ channel, args });
    return Promise.resolve(undefined);
  },
  sendSync(channel: string): unknown {
    return ipcRenderer.syncAnswers.get(channel);
  },
  on(channel: string, listener: (...args: unknown[]) => void) {
    ipcRenderer.listeners.set(channel, [...(ipcRenderer.listeners.get(channel) ?? []), listener]);
    return ipcRenderer;
  },
  removeListener(channel: string, listener: (...args: unknown[]) => void) {
    const kept = (ipcRenderer.listeners.get(channel) ?? []).filter((each) => each !== listener);
    ipcRenderer.listeners.set(channel, kept);
    return ipcRenderer;
  },
};

export const webFrame = { getZoomFactor: () => 1 };
export const webUtils = { getPathForFile: (file: File) => `/picked/${file.name}` };
