import { surfaceStorage } from '@apackdev/sdk/fe';
import { ref as featureRef } from '#generated/ref.ts';

/** This surface's window storage: the prefix is its ref, so these names are scoped to it. */
const storage = surfaceStorage(featureRef('browser'));

export interface HistoryEntry {
  url: string;
  urlKey: string;
  title: string;
  favicon: string;
  visitCount: number;
  typedCount: number;
  lastVisitTime: number;
}

export interface AutocompleteSuggestion {
  url: string;
  title: string;
  favicon: string;
  matchType: 'url' | 'title';
}

function computeUrlKey(url: string): string {
  const parsed = URL.parse(url);
  if (!parsed) return url.toLowerCase();
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  const path = parsed.pathname.replace(/\/$/, '') + parsed.search + parsed.hash;
  return `${parsed.protocol}//${host}${path}`;
}

function frecencyScore(entry: HistoryEntry): number {
  const ageHours = (Date.now() - entry.lastVisitTime) / (1000 * 60 * 60);

  let recency: number;
  if (ageHours < 4) recency = 1.0;
  else if (ageHours < 24) recency = 0.7;
  else if (ageHours < 168) recency = 0.5;
  else if (ageHours < 720) recency = 0.3;
  else recency = 0.1;

  return (entry.visitCount + entry.typedCount) * recency;
}

export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, '');
}

/** Per-instance browsing history store and autocomplete index (no module-level cache singleton). */
export class BrowserHistory {
  private cache: HistoryEntry[] | null = null;

  private getHistory(): HistoryEntry[] {
    if (this.cache) return this.cache;
    try {
      const raw = storage.get('history');
      this.cache = raw ? JSON.parse(raw) : [];
    } catch {
      this.cache = [];
    }
    return this.cache!;
  }

  private persistHistory(): void {
    storage.set('history', JSON.stringify(this.cache ?? []));
  }

  recordVisit(url: string, title: string, favicon: string, typed: boolean): void {
    if (!url || url === 'about:blank') return;
    // Skip data: URLs (error pages, etc.)
    if (url.startsWith('data:')) return;

    const urlKey = computeUrlKey(url);
    const entries = this.getHistory();
    const existing = entries.find(e => e.urlKey === urlKey);

    if (existing) {
      existing.visitCount++;
      if (typed) existing.typedCount++;
      existing.lastVisitTime = Date.now();
      if (title) existing.title = title;
      if (favicon) existing.favicon = favicon;
      // Keep the most "complete" URL (prefer with path over bare domain)
      if (url.length > existing.url.length) existing.url = url;
    } else {
      entries.push({
        url,
        urlKey,
        title: title || '',
        favicon: favicon || '',
        visitCount: 1,
        typedCount: typed ? 1 : 0,
        lastVisitTime: Date.now(),
      });
    }

    this.persistHistory();
  }

  updateHistoryMeta(url: string, title?: string, favicon?: string): void {
    if (!url || url === 'about:blank' || url.startsWith('data:')) return;
    const urlKey = computeUrlKey(url);
    const entries = this.getHistory();
    const existing = entries.find(e => e.urlKey === urlKey);
    if (!existing) return;

    let changed = false;
    if (title && title !== existing.title) {
      existing.title = title;
      changed = true;
    }
    if (favicon && favicon !== existing.favicon) {
      existing.favicon = favicon;
      changed = true;
    }
    if (changed) this.persistHistory();
  }

  autocomplete(query: string, limit = 8): AutocompleteSuggestion[] {
    if (!query || query.length < 1) return [];

    const q = query.toLowerCase();
    const entries = this.getHistory();
    const scored: { entry: HistoryEntry; score: number; matchType: 'url' | 'title' }[] = [];

    for (const entry of entries) {
      const display = displayUrl(entry.url).toLowerCase();
      let matchType: 'url' | 'title' = 'url';
      let positionBoost = 0;

      if (display.startsWith(q)) {
        positionBoost = 2.0;
      } else if (display.includes(q)) {
        positionBoost = 1.0;
      } else if (entry.title?.toLowerCase().includes(q)) {
        matchType = 'title';
        positionBoost = 0.8;
      } else {
        continue; // No match
      }

      scored.push({
        entry,
        score: frecencyScore(entry) * positionBoost,
        matchType,
      });
    }

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map(({ entry, matchType }) => ({
      url: entry.url,
      title: entry.title,
      favicon: entry.favicon,
      matchType,
    }));
  }
}

export function createBrowserHistory(): BrowserHistory {
  return new BrowserHistory();
}
