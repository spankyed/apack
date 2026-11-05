import {ipcRenderer, contextBridge, webFrame, webUtils} from 'electron';
import type {_HostBridge, SpeechEvent} from '@apackdev/sdk/fe';

function getStartupId(): string | undefined {
  const startupArg = process.argv.find(arg => arg.startsWith('--startup-id='));
  return startupArg?.split('=')[1];
}

// Window controls API
const windowControls = {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
} satisfies _HostBridge['windowControls'];

const surfaces = {
  popout: (surfaceId: string, title?: string) => ipcRenderer.invoke('surface:popout', surfaceId, title) as Promise<void>,
} satisfies _HostBridge['surfaces'];

// File utilities
const fileUtils = {
  selectDirectory: () => ipcRenderer.invoke('dialog:select-directory'),
  selectPath: (options?: {
    allowMultiple?: boolean;
    type: 'file' | 'directory' | 'both';
  }) => ipcRenderer.invoke('dialog:select-path', options),
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  readFileBase64: (filePath: string) => ipcRenderer.invoke('file:read-base64', filePath) as Promise<string>,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
} satisfies _HostBridge['fileUtils'];

// The run token comes from main, never from the command line.
const apiToken = ipcRenderer.sendSync('api:token') as string;
const startupId = getStartupId();

// Shell utilities
const shell = {
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  showItemInFolder: (filePath: string) => ipcRenderer.invoke('shell:showItemInFolder', filePath),
  openPath: (filePath: string) => ipcRenderer.invoke('shell:openPath', filePath),
} satisfies _HostBridge['shell'];

// Media utilities
const media = {
  upload: (entityId: string, base64Data: string, mimeType: string) =>
    ipcRenderer.invoke('media:upload', entityId, base64Data, mimeType) as Promise<string>,
  delete: (entityId: string, filename: string) =>
    ipcRenderer.invoke('media:delete', entityId, filename) as Promise<void>,
  deleteAll: (entityId: string) =>
    ipcRenderer.invoke('media:delete-all', entityId) as Promise<void>,
} satisfies _HostBridge['media'];

// Speech recognition
const speechRecognition = {
  start: (lang?: string) => ipcRenderer.invoke('speech:start', lang),
  stop: () => ipcRenderer.invoke('speech:stop'),
  isAvailable: () => ipcRenderer.invoke('speech:isAvailable') as Promise<{ available: boolean }>,
  onEvent: (callback: (event: SpeechEvent) => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: SpeechEvent) => callback(event);
    ipcRenderer.on('speech:event', handler);
    return () => { ipcRenderer.removeListener('speech:event', handler); };
  },
} satisfies _HostBridge['speechRecognition'];

// Zoom utilities
const zoom = {
  getZoomFactor: () => webFrame.getZoomFactor(),
  notifyZoomChanged: (factor: number) => ipcRenderer.send('zoom:changed', factor),
} satisfies _HostBridge['zoom'];

// API status events (backend crash/restart notifications from main process)
const apiStatus = {
  whenReady: () => ipcRenderer.invoke('api:when-ready') as Promise<{ port: number; startupId: string }>,
  getStatus: () => ipcRenderer.invoke('api:get-status') as Promise<{
    running: boolean;
    port?: number;
    error?: { message: string; stack?: string };
    restartAttempts: number;
    startupId: string;
    logPath: string;
    rendererLogPath: string;
    appEventsLogPath: string;
  }>,
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  reload: () => ipcRenderer.invoke('app:reload'),
  openLogFile: () => ipcRenderer.invoke('api:open-log-file'),
  onEvent: (callback: (event: { type: string; error?: string; attempt?: number; maxAttempts?: number; port?: number; reloaded?: boolean }) => void) => {
    const channels = ['api:stopped', 'api:error', 'api:restarting', 'api:started', 'api:fatal'];
    const handlers = channels.map(channel => {
      const handler = (_: Electron.IpcRendererEvent, data?: any) => {
        callback({ type: channel, ...data });
      };
      ipcRenderer.on(channel, handler);
      return { channel, handler };
    });
    return () => {
      handlers.forEach(({ channel, handler }) => ipcRenderer.removeListener(channel, handler));
    };
  },
} satisfies _HostBridge['apiStatus'];

const rendererLog = {
  write: (entry: {
    level?: 'debug' | 'info' | 'warn' | 'error';
    source?: string;
    message?: string;
    stack?: string;
    meta?: unknown;
    fatal?: boolean;
  }) => ipcRenderer.invoke('renderer-log:write', entry),
} satisfies _HostBridge['rendererLog'];

// Browser API
interface TabState {
  id: number;
  persistedId?: string;
  url: string;
  title: string;
  favicon: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isMuted: boolean;
}

const browser = {
  // Tab management
  createTab: (url?: string, options?: { lazy?: boolean; title?: string; favicon?: string; activate?: boolean; persistedId?: string }) =>
    ipcRenderer.invoke('browser:create-tab', url, options) as Promise<TabState | null>,
  loadTab: (tabId: number) => ipcRenderer.invoke('browser:load-tab', tabId),
  closeTab: (tabId: number) => ipcRenderer.send('browser:close-tab', tabId),
  selectTab: (tabId: number) => ipcRenderer.send('browser:select-tab', tabId),

  // Navigation
  navigate: (tabId: number, url: string) => ipcRenderer.send('browser:navigate', tabId, url),
  goBack: (tabId: number) => ipcRenderer.send('browser:go-back', tabId),
  goForward: (tabId: number) => ipcRenderer.send('browser:go-forward', tabId),
  reload: (tabId: number) => ipcRenderer.send('browser:reload', tabId),
  stop: (tabId: number) => ipcRenderer.send('browser:stop', tabId),

  // Bounds and visibility
  setBounds: (bounds: {x: number; y: number; width: number; height: number}) =>
    ipcRenderer.send('browser:set-bounds', bounds),
  show: () => ipcRenderer.send('browser:show'),
  hide: () => ipcRenderer.send('browser:hide'),

  // Events from main process
  onTabCreated: (callback: (tab: TabState) => void) => {
    const handler = (_: Electron.IpcRendererEvent, tab: TabState) => callback(tab);
    ipcRenderer.on('browser:tab-created', handler);
    return () => { ipcRenderer.removeListener('browser:tab-created', handler); };
  },
  onTabRemoved: (callback: (tabId: number) => void) => {
    const handler = (_: Electron.IpcRendererEvent, tabId: number) => callback(tabId);
    ipcRenderer.on('browser:tab-removed', handler);
    return () => { ipcRenderer.removeListener('browser:tab-removed', handler); };
  },
  onTabUpdated: (callback: (tabId: number, changes: Partial<TabState>) => void) => {
    const handler = (_: Electron.IpcRendererEvent, tabId: number, changes: Partial<TabState>) =>
      callback(tabId, changes);
    ipcRenderer.on('browser:tab-updated', handler);
    return () => { ipcRenderer.removeListener('browser:tab-updated', handler); };
  },
  onActiveTabChanged: (callback: (tabId: number) => void) => {
    const handler = (_: Electron.IpcRendererEvent, tabId: number) => callback(tabId);
    ipcRenderer.on('browser:active-tab-changed', handler);
    return () => { ipcRenderer.removeListener('browser:active-tab-changed', handler); };
  },

  // DevTools
  toggleDevTools: (tabId: number) => ipcRenderer.send('browser:toggle-devtools', tabId),

  // Address bar focus (from main process keyboard shortcut)
  onFocusAddressBar: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('browser:focus-address-bar', handler);
    return () => { ipcRenderer.removeListener('browser:focus-address-bar', handler); };
  },

  // Tab actions
  duplicateTab: (tabId: number) => ipcRenderer.invoke('browser:duplicate-tab', tabId) as Promise<TabState | null>,
  setTabMuted: (tabId: number, muted: boolean) => ipcRenderer.invoke('browser:set-tab-muted', tabId, muted),

  // Cache
  clearCache: () => ipcRenderer.invoke('browser:clear-cache') as Promise<void>,

  // Query
  getTabs: () => ipcRenderer.invoke('browser:get-tabs') as Promise<TabState[]>,
  getActiveTab: () => ipcRenderer.invoke('browser:get-active-tab') as Promise<number | null>,
} satisfies _HostBridge['browser'];

// Protocol action listener (apack:// deep link handling)
const protocolAction = {
  onAction: (callback: (data: { action: string; params: Record<string, string> }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { action: string; params: Record<string, string> }) =>
      callback(data);
    ipcRenderer.on('protocol-action', handler);
    return () => { ipcRenderer.removeListener('protocol-action', handler); };
  },
} satisfies _HostBridge['protocolAction'];

// Expose APIs to renderer
/**
 * **The whole bridge, held to its one declaration.** `satisfies` is the gate in both directions: a member
 * exposed and not declared is an excess property, and one declared and not exposed is missing. Each group
 * above asserts its own slice as well, because these are consts — assigning one here is an ordinary
 * assignment, so an excess property *inside* a group would pass this check alone.
 *
 * `_HostBridge` rather than the pack-facing view, since what a window has is the whole of it; which members
 * pack authors are pointed at is `PackFacingBridge`'s business, one declaration away.
 */
const performance = {
  start: mode => ipcRenderer.invoke('performance:renderer:start', mode),
  stop: id => ipcRenderer.invoke('performance:renderer:stop', id),
} satisfies _HostBridge['performance'];

const electronAPI = {
  performance,
  windowControls,
  surfaces,
  fileUtils,
  shell,
  media,
  speechRecognition,
  zoom,
  apiStatus,
  rendererLog,
  apiToken,
  startupId,
  browser,
  protocolAction,
  rendererReady: () => ipcRenderer.send('renderer:ready'),
} satisfies _HostBridge;

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
