import type {CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import type {ChatComposerState} from './chatTypes';
import {RecentThreadContextMenu} from './RecentThreadContextMenu';
import {RecentThreadRow} from './RecentThreadRow';
import {Icons} from '../primitives/Icon';
import './ChatComposer.module.css';
import {makeStyles} from '../primitives/makeStyles';

const styles = makeStyles('ChatComposer');

type RecentThreadsMenuState = NonNullable<NonNullable<ChatComposerState['bottomTabs']>['recentThreadsMenu']>;

const rendererRecentThreadRowHeight = 36;
const rendererContextMenuSideOffset = 2;

/*
 * Mirrors packages/renderer/src/plugins/threads/chat/recent-threads.vue.
 * Fixed-positioned menus are portaled to body, like Vue's Teleport, so they
 * are not captured by transformed film wrappers.
 */
export function RecentThreadsMenu({menu}: {menu: RecentThreadsMenuState}) {
  const selectedIndex = menu.selectedIndex ?? -1;
  const contextThread = menu.contextMenu
    ? menu.threads.find(thread => thread.id === menu.contextMenu?.threadId)
    : undefined;
  const contextThreadIndex = contextThread ? menu.threads.findIndex(thread => thread.id === contextThread.id) : -1;
  const contextBottomOffset = 8 + rendererContextMenuSideOffset + Math.max(0, menu.threads.length - contextThreadIndex - 1) * rendererRecentThreadRowHeight;
  const archiveContextThread = menu.archiveContextMenuThreadId
    ? menu.threads.find(thread => thread.id === menu.archiveContextMenuThreadId)
    : undefined;
  const archiveContextThreadIndex = archiveContextThread ? menu.threads.findIndex(thread => thread.id === archiveContextThread.id) : -1;
  const archiveContextBottomOffset = Math.max(
    0,
    Math.max(0, menu.threads.length - archiveContextThreadIndex - 1) * rendererRecentThreadRowHeight - 8,
  );

  const popup = (
    <>
      <div className={styles.recentThreadsMenu} style={recentThreadsMenuStyle(menu.popupPosition)}>
        {menu.threads.length === 0 ? (
          <div className={styles.recentThreadsEmpty}>
            <Icons.History size={20} />
            <p>No threads yet</p>
            <small>Recent threads will appear here</small>
          </div>
        ) : (
          <div className={styles.recentThreadsList}>
            {menu.threads.map((thread, index) => (
              <RecentThreadRow
                active={selectedIndex >= 0 && index === selectedIndex}
                current={thread.id === menu.currentId}
                editingName={menu.editingName}
                editingThreadId={menu.editingThreadId}
                key={thread.id}
                stateConfig={menu.threadStates?.[thread.id]}
                thread={thread}
              />
            ))}
          </div>
        )}
      </div>
      {contextThread ? (
        <div
          className={styles.threadContextMenuPortal}
          style={contextMenuPortalStyle(menu.contextMenu?.popupPosition, menu.popupPosition, contextBottomOffset, 160)}
        >
          <RecentThreadContextMenu
            copyText={contextThread.shortCode ?? contextThread.id}
            isArchived={menu.contextMenu?.isArchived ?? false}
            isPinned={!!contextThread.pinned}
          />
        </div>
      ) : null}
      {archiveContextThread ? (
        <div
          className={styles.archiveDeleteMenuPortal}
          style={contextMenuPortalStyle(menu.archiveContextMenuPosition, menu.popupPosition, archiveContextBottomOffset, 120)}
        >
          <ArchiveDeleteMenu />
        </div>
      ) : null}
    </>
  );

  if (typeof document !== 'undefined') {
    return createPortal(popup, document.body);
  }

  return popup;
}

function recentThreadsMenuStyle(position: RecentThreadsMenuState['popupPosition']): CSSProperties {
  return {
    bottom: `${position?.bottom ?? 0}px`,
    left: `${position?.left ?? 0}px`,
    position: 'fixed',
    width: `${position?.width ?? 320}px`,
  };
}

function contextMenuPortalStyle(
  menuPosition: {bottom?: number; left: number; top?: number} | undefined,
  position: RecentThreadsMenuState['popupPosition'],
  bottomOffset: number,
  menuWidth: number,
): CSSProperties {
  if (menuPosition) {
    return menuPosition.top == null
      ? {
          bottom: `${menuPosition.bottom ?? 0}px`,
          left: `${menuPosition.left}px`,
          position: 'fixed',
          right: 'auto',
        }
      : {
          left: `${menuPosition.left}px`,
          position: 'fixed',
          right: 'auto',
          top: `${menuPosition.top}px`,
        };
  }

  return {
    bottom: `${(position?.bottom ?? 0) + bottomOffset}px`,
    left: `${(position?.left ?? 0) + (position?.width ?? 320) - menuWidth - 8}px`,
    position: 'fixed',
    right: 'auto',
  };
}

function ArchiveDeleteMenu() {
  return (
    <div className={styles.archiveDeleteMenu}>
      <button className={styles.archiveDeleteMenuItem} type="button">
        <Icons.Trash2 size={14} />
        <span>Delete</span>
      </button>
    </div>
  );
}
