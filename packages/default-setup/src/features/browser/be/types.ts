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
  /** None for a page that has no favicon */
  favicon?: string;
  displayOrder: number;
}

// ── This feature's settings ───────────────────────────────────────────────
// Its own shape, which the app stores without knowing: the app owns the document, each feature its slice.
export type BrowserSettings = import('#generated/settings.ts').SettingsOf<'browser'>;

export type IncomingBrowserEvents =
  | { type: 'SYNC_TABS'; tabs: SavedTab[] }
  | { type: 'SYNC_BOOKMARKS'; bookmarks: SavedBookmark[] };

export type OutgoingBrowserEvents =
  | { type: 'BROWSER_CONNECTED'; savedTabs: SavedTab[]; savedBookmarks: SavedBookmark[] };

export interface BrowserContext {}
