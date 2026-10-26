import type { EARS } from '#generated/ears.ts';

export type BrowserTabId = `${EARS.Entity.BrowserTab}-${string}`;

export interface BrowserTabEntity {
  id: BrowserTabId;
  entityType: EARS.Entity.BrowserTab;
  url: string;
  title: string;
  favicon: string;
  displayOrder: number;
  isMuted: boolean;
  groupId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SavedTab {
  id: BrowserTabId;
  url: string;
  title: string;
  favicon: string;
  displayOrder: number;
  isMuted: boolean;
  groupId?: string;
}

export interface BrowserBookmarkEntity {
  id: EARS.EntityId;
  entityType: EARS.Entity.BrowserBookmark;
  url: string;
  title: string;
  favicon: string;
  displayOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface SavedBookmark {
  url: string;
  title: string;
  favicon: string;
  displayOrder: number;
}

// ── This feature's settings ───────────────────────────────────────────────
// Its own shape, which the app stores without knowing: the app owns the document, each feature its slice.
export type BrowserSettings = import('#generated/settings.ts').SettingsOf<'browser'>;

export type IncomingBrowserEvents =
  | { type: 'SYNC_TABS'; tabs: SavedTab[] }
  | { type: 'SYNC_BOOKMARKS'; bookmarks: SavedBookmark[] }
  /** The tabs and bookmarks a window restores as it starts: answered with \`SAVED_SESSION_READ\` */
  | { type: 'GET_SAVED_SESSION' };

/**
 * What the browser system sends: the saved session, to the window that asked. It is a snapshot the window takes once
 * and then owns — each window syncs its own tabs back — so it is fetched rather than followed as a view, where every
 * window's sync would replace the tabs another window is using.
 */
export type OutgoingBrowserEvents =
  | { type: 'SAVED_SESSION_READ'; savedTabs: SavedTab[]; savedBookmarks: SavedBookmark[] };

export interface BrowserContext {}
