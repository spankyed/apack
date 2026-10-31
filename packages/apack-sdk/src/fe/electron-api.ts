// The preload IPC surface the host exposes to renderer and pack FE code alike.
// Lives in the SDK because packs consume it; fe/index.ts re-exports this module's type surface so anything
// importing '@apackdev/sdk/fe' sees the global in source and in declarations.
import type { _RendererPerformanceResources } from '../runtime/performance.ts';
import type { SpeechEvent } from './speech-event.ts';

/**
 * **The whole bridge, which is the one declaration of it.**
 *
 * `packages/preload` builds an object and asserts it `satisfies` this, so the compiler holds the exposed
 * surface and the declared one to each other in both directions: a member exposed and not declared is an
 * excess property, and one declared and not exposed is a missing one. Without it the two drift, and what
 * pack code then reaches for is `(window as any)`.
 *
 * **`Window.electronAPI` is a view of this, not this**: `PackFacingBridge` below drops host-only members a
 * window has and pack authors are not pointed at. Host code that needs one of those takes this type.
 *
 * **Host-only, and the underscore is what makes that checkable.** Publishing the whole bridge under a
 * pack-facing name would point pack authors at `apiToken` through a different door than the one the
 * pack-facing view closes; `check:specifiers` refuses pack code importing an `_`-prefixed export, so this
 * is a boundary something enforces rather than an omission nothing does.
 *
 * @internal
 */
export interface _HostBridge {
  performance: {
    start(mode: 'lightweight' | 'detailed'): Promise<{ id: string }>;
    stop(id: string): Promise<_RendererPerformanceResources>;
  };
  windowControls: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
  };
  surfaces: {
    popout: (surfaceId: string, title?: string) => Promise<void>;
  };
  fileUtils: {
    selectDirectory: () => Promise<string | null>;
    selectPath: (options?: {
      allowMultiple?: boolean;
      type: 'file' | 'directory' | 'both';
    }) => Promise<string | string[] | null>;
    readFile: (filePath: string) => Promise<string>;
    readFileBase64: (filePath: string) => Promise<string>;
    /**
     * The path of a dropped or picked `File`, which is the only way to get one: a browser hands a
     * `File` with no path, and Electron's `webUtils` answers from the main world. Four of default-setup's
     * drop targets read it, through `(window as any)` while it went undeclared.
     */
    getPathForFile: (file: File) => string;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
    showItemInFolder: (filePath: string) => Promise<void>;
    openPath: (filePath: string) => Promise<void>;
  };
  media: {
    upload: (entityId: string, base64Data: string, mimeType: string) => Promise<string>;
    delete: (entityId: string, filename: string) => Promise<void>;
    deleteAll: (entityId: string) => Promise<void>;
  };
  speechRecognition: {
    start: (lang?: string) => Promise<void>;
    stop: () => Promise<void>;
    isAvailable: () => Promise<{ available: boolean }>;
    onEvent: (callback: (event: SpeechEvent) => void) => () => void;
  };
  zoom: {
    getZoomFactor: () => number;
    notifyZoomChanged: (factor: number) => void;
  };
  apiStatus: {
    getStatus: () => Promise<{
      running: boolean;
      port?: number;
      error?: { message: string; stack?: string };
      restartAttempts: number;
      startupId: string;
      logPath: string;
      rendererLogPath: string;
      appEventsLogPath: string;
    }>;
    relaunch: () => Promise<void>;
    /** Opens the app's own log file in the system viewer. Host-only; the error page is its one caller */
    openLogFile: () => Promise<void>;
    /**
     * Reloads this window through the main process, which is the only way it can be done: the app
     * blocks renderer-initiated navigation, so `location.reload()` returns having done nothing.
     */
    reload: () => Promise<void>;
    /**
     * `reloaded` marks an `api:started` whose predecessor was replaced on purpose — a development rebuild
     * rather than a crash — so a window may tear its subscription down at once instead of waiting out its
     * client's reconnect backoff.
     */
    onEvent: (callback: (event: { type: string; error?: string; attempt?: number; maxAttempts?: number; port?: number; reloaded?: boolean }) => void) => () => void;
  };
  rendererLog: {
    write: (entry: {
      level?: 'debug' | 'info' | 'warn' | 'error';
      source?: string;
      message?: string;
      stack?: string;
      meta?: unknown;
      fatal?: boolean;
    }) => Promise<void>;
  };
  browser: {
    createTab: (url?: string, options?: { lazy?: boolean; title?: string; favicon?: string; activate?: boolean; persistedId?: string }) => Promise<BrowserTabState | null>;
    loadTab: (tabId: number) => Promise<void>;
    closeTab: (tabId: number) => void;
    selectTab: (tabId: number) => void;
    navigate: (tabId: number, url: string) => void;
    goBack: (tabId: number) => void;
    goForward: (tabId: number) => void;
    reload: (tabId: number) => void;
    stop: (tabId: number) => void;
    setBounds: (bounds: {x: number; y: number; width: number; height: number}) => void;
    show: () => void;
    hide: () => void;
    onTabCreated: (callback: (tab: BrowserTabState) => void) => () => void;
    onTabRemoved: (callback: (tabId: number) => void) => () => void;
    onTabUpdated: (callback: (tabId: number, changes: Partial<BrowserTabState>) => void) => () => void;
    onActiveTabChanged: (callback: (tabId: number) => void) => () => void;
    toggleDevTools: (tabId: number) => void;
    onFocusAddressBar: (callback: () => void) => () => void;
    duplicateTab: (tabId: number) => Promise<BrowserTabState | null>;
    setTabMuted: (tabId: number, muted: boolean) => Promise<void>;
    clearCache: () => Promise<void>;
    getTabs: () => Promise<BrowserTabState[]>;
    getActiveTab: () => Promise<number | null>;
  };
  protocolAction: {
    onAction: (callback: (data: { action: string; params: Record<string, string> }) => void) => () => void;
  };
  rendererReady: () => void;
  apiPort: number;
  startupId?: string;
  /**
   * The token the API requires for this app run, read from main as the preload loads rather than taken
   * from the command line, where every process on the machine could read it. Host-only.
   */
  apiToken: string;
}

/**
 * The bridge as pack code sees it, which is what `window.electronAPI` is declared as.
 *
 * The two omissions are the whole difference, and the `Omit`s are the only place they are written — a
 * parallel list of member names beside them would be the same declaration twice:
 *
 * - **`apiToken`**, the token the API requires for this app run. The renderer's client is its one reader.
 * - **`apiStatus.openLogFile`**, which opens the app's own log file; the error page is its one caller.
 *
 * **Leaving a member out does not hide it**, and that is worth being plain about rather than implying a
 * boundary: a pack's frontend runs in the app window, loaded with `import()` from `pack://`, so it can
 * read every member of `window.electronAPI` at runtime whatever this says. What the omission does is stop
 * advertising them. Closing it for real means isolating pack frontends from the window
 * (`docs/goals/goal-pack-frontend-isolation.md`), and until that exists this is a signpost — which
 * is why it drops members no pack has a reason to want.
 */
type PackFacingBridge = Omit<_HostBridge, 'apiToken' | 'performance'> & {
  apiStatus: Omit<_HostBridge['apiStatus'], 'openLogFile'>;
};

declare global {
  interface Window {
    electronAPI?: PackFacingBridge;
  }

  interface BrowserTabState {
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
}

