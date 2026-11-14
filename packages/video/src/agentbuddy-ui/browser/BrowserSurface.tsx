import type {CSSProperties} from 'react';
import {ChevronLeft, ChevronRight, Code2, MoreHorizontal, Plus, RefreshCw, X} from 'lucide-react';
import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {BrowserSurfaceState, BrowserTabGroup, BrowserTabGroupColor, BrowserTabState} from './browserTypes';
import './BrowserSurface.module.css';

const styles = makeStyles('BrowserSurface');

const groupColors: Record<BrowserTabGroupColor, {bg: string; collapsedBg: string; text: string}> = {
  blue: {bg: 'rgb(59 130 246)', collapsedBg: 'rgb(59 130 246 / 0.1)', text: 'rgb(229 231 235)'},
  purple: {bg: 'rgb(147 51 234)', collapsedBg: 'rgb(147 51 234 / 0.1)', text: 'rgb(229 231 235)'},
  pink: {bg: 'rgb(219 39 119)', collapsedBg: 'rgb(219 39 119 / 0.1)', text: 'rgb(23 23 23)'},
  red: {bg: 'rgb(239 68 68)', collapsedBg: 'rgb(239 68 68 / 0.1)', text: 'rgb(23 23 23)'},
  orange: {bg: 'rgb(249 115 22)', collapsedBg: 'rgb(249 115 22 / 0.1)', text: 'rgb(23 23 23)'},
  yellow: {bg: 'rgb(202 138 4)', collapsedBg: 'rgb(202 138 4 / 0.1)', text: 'rgb(23 23 23)'},
  green: {bg: 'rgb(34 197 94)', collapsedBg: 'rgb(34 197 94 / 0.1)', text: 'rgb(23 23 23)'},
  teal: {bg: 'rgb(20 184 166)', collapsedBg: 'rgb(20 184 166 / 0.1)', text: 'rgb(23 23 23)'},
  gray: {bg: 'rgb(107 114 128)', collapsedBg: 'rgb(107 114 128 / 0.1)', text: 'rgb(229 231 235)'},
};

type SortedItem =
  | {type: 'group'; group: BrowserTabGroup}
  | {type: 'tab'; tab: BrowserTabState};

export function BrowserSurface({state}: {state: BrowserSurfaceState}) {
  const activeTab = state.tabs.find(tab => tab.id === state.activeTabId);
  const suggestions = state.suggestions ?? [];

  return (
    <div className={styles.root}>
      <BrowserTabBar activeTabId={state.activeTabId} groups={state.tabGroups ?? []} tabs={state.tabs} />
      <div className={styles.navBar}>
        <button className={styles.navButton} data-disabled={!activeTab?.canGoBack} type="button">
          <ChevronLeft size={14} strokeWidth={2} />
        </button>
        <button className={styles.navButton} data-disabled={!activeTab?.canGoForward} type="button">
          <ChevronRight size={14} strokeWidth={2} />
        </button>
        <button className={styles.navButton} type="button">
          {activeTab?.isLoading ? <X size={14} strokeWidth={2} /> : <RefreshCw size={14} strokeWidth={2} />}
        </button>
        <div className={styles.addressWrap}>
          <div className={styles.address} data-focused={state.addressFocused ? 'true' : undefined}>
            {state.addressBarValue}
            {state.inlineCompletion && state.addressFocused ? <span style={{color: 'rgb(115 115 115)'}}>{state.inlineCompletion}</span> : null}
          </div>
          {suggestions.length > 0 && state.addressFocused ? (
            <div className={styles.autocomplete}>
              {suggestions.map((suggestion, index) => (
                <div className={styles.suggestion} data-selected={index === (state.selectedSuggestionIndex ?? -1)} key={suggestion.url}>
                  {suggestion.favicon ? <img alt="" className={styles.suggestionIcon} src={suggestion.favicon} /> : <div className={styles.suggestionFallback} />}
                  <div className={styles.suggestionText}>
                    <div className={styles.suggestionTitle}>{suggestion.title || displayUrl(suggestion.url)}</div>
                    {suggestion.title ? <div className={styles.suggestionUrl}>{displayUrl(suggestion.url)}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <button className={`${styles.navButton} ${styles.devtoolsButton}`} type="button">
          <Code2 size={14} strokeWidth={2} />
        </button>
      </div>
      <div className={styles.content}>
        {state.tabs.length === 0 ? (
          <div className={styles.empty}>
            <Icons.Globe size={48} strokeWidth={1} style={{marginBottom: 16, color: 'rgb(82 82 82)'}} />
            <p>Click + to open a new tab</p>
          </div>
        ) : (
          <BrowserPage state={state} />
        )}
      </div>
    </div>
  );
}

function BrowserTabBar({activeTabId, groups, tabs}: {activeTabId: number | null; groups: BrowserTabGroup[]; tabs: BrowserTabState[]}) {
  return (
    <div className={styles.tabBar}>
      {sortedItems(tabs, groups).map(item => {
        if (item.type === 'group') {
          return <GroupLabel group={item.group} key={`g-${item.group.id}`} />;
        }
        return <BrowserTab active={item.tab.id === activeTabId} groups={groups} key={`t-${item.tab.id}`} tab={item.tab} />;
      })}
      <button className={styles.newTab} type="button">
        <Plus size={14} strokeWidth={2} />
      </button>
    </div>
  );
}

function BrowserTab({active, groups, tab}: {active: boolean; groups: BrowserTabGroup[]; tab: BrowserTabState}) {
  const group = tab.groupId ? groups.find(item => item.id === tab.groupId) : undefined;
  return (
    <div
      className={styles.tab}
      data-active={active ? 'true' : undefined}
      style={group ? {borderBottom: `2px solid ${groupColors[group.color].bg}`} : undefined}
    >
      <button className={styles.closeButton} type="button">
        <X size={10} strokeWidth={2} />
      </button>
      {tab.isLoading ? (
        <div className={styles.spinner} />
      ) : tab.favicon ? (
        <img alt="" className={styles.favicon} src={tab.favicon} />
      ) : (
        <div className={styles.faviconFallback} />
      )}
      <span className={styles.tabTitle}>{tab.title || 'New Tab'}</span>
    </div>
  );
}

function GroupLabel({group}: {group: BrowserTabGroup}) {
  const color = groupColors[group.color];
  return (
    <div
      className={styles.groupLabel}
      style={{
        backgroundColor: group.isCollapsed ? color.collapsedBg : color.bg,
        borderBottom: group.isCollapsed ? 'none' : `2px solid ${color.bg}`,
        color: group.isCollapsed ? 'rgb(156 163 175)' : color.text,
      }}
    >
      <span>{group.name}</span>
      <button className={styles.groupMore} type="button">
        <MoreHorizontal size={12} strokeWidth={2} />
      </button>
    </div>
  );
}

function BrowserPage({state}: {state: BrowserSurfaceState}) {
  const page = state.page;
  if (!page) {
    return <div className={styles.content} />;
  }

  return (
    <div className={styles.page} style={{'--browser-page-accent': page.accent ?? 'rgb(37 99 235)'} as CSSProperties}>
      <div className={styles.pageShell}>
        {page.eyebrow ? <div className={styles.pageEyebrow}>{page.eyebrow}</div> : null}
        <h1>{page.heading}</h1>
        {page.subheading ? <div className={styles.pageSubheading}>{page.subheading}</div> : null}
        {page.cards ? (
          <div className={styles.pageGrid}>
            {page.cards.map(card => (
              <div className={styles.pageCard} key={card.label}>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
              </div>
            ))}
          </div>
        ) : null}
        {page.status ? <div className={styles.pageStatus}>{page.status}</div> : null}
      </div>
    </div>
  );
}

function sortedItems(tabs: BrowserTabState[], groups: BrowserTabGroup[]): SortedItem[] {
  const sortedGroups = [...groups].sort((a, b) => a.order - b.order);
  const groupedTabIds = new Set<number>();
  const tabsByGroup = new Map<string, BrowserTabState[]>();
  const items: SortedItem[] = [];

  for (const tab of tabs) {
    if (tab.groupId) {
      const list = tabsByGroup.get(tab.groupId) ?? [];
      list.push(tab);
      tabsByGroup.set(tab.groupId, list);
      groupedTabIds.add(tab.id);
    }
  }

  for (const tab of tabs) {
    if (!groupedTabIds.has(tab.id)) {
      items.push({type: 'tab', tab});
    }
  }

  for (const group of sortedGroups) {
    const groupTabs = tabsByGroup.get(group.id) ?? [];
    if (groupTabs.length === 0) continue;
    items.push({type: 'group', group});
    if (!group.isCollapsed) {
      for (const tab of groupTabs) {
        items.push({type: 'tab', tab});
      }
    }
  }

  return items;
}

function displayUrl(url: string) {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}
