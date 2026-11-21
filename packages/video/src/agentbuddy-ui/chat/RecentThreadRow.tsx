import type {ChatComposerState} from './chatTypes';
import {Icons} from '../primitives/Icon';
import './ChatComposer.module.css';
import {makeStyles} from '../primitives/makeStyles';

const styles = makeStyles('ChatComposer');

type RecentThreadsMenuState = NonNullable<NonNullable<ChatComposerState['bottomTabs']>['recentThreadsMenu']>;
export type RecentThreadRowState = RecentThreadsMenuState['threads'][number];

type RecentThreadRowProps = {
  active?: boolean;
  current?: boolean;
  editingName?: string;
  editingThreadId?: string;
  stateConfig?: {
    busy?: boolean;
    color?: string;
  };
  thread: RecentThreadRowState;
};

// Mirrors the row body in packages/renderer/src/plugins/threads/chat/recent-threads.vue.
export function RecentThreadRow({active, current, editingName, editingThreadId, stateConfig, thread}: RecentThreadRowProps) {
  const isBusy = stateConfig?.busy ?? false;
  const dotStyle = isBusy || !stateConfig?.color ? undefined : {backgroundColor: stateConfig.color};
  const editing = thread.id === editingThreadId;
  const topic = thread.topic || 'Untitled';

  return (
    <div className={active ? styles.recentThreadActive : styles.recentThread} data-current={current ? 'true' : undefined}>
      <span className={styles.recentThreadDotWrap}>
        <span className={isBusy ? styles.recentThreadDotBusy : styles.recentThreadDot} style={dotStyle} />
        {isBusy ? <span className={styles.recentThreadDotGlow} /> : null}
      </span>
      {editing ? (
        <input className={styles.recentThreadRenameInput} readOnly value={editingName ?? topic} />
      ) : (
        <span className={styles.recentThreadTitle}>{topic}</span>
      )}
      {thread.pinned ? (
        <button className={styles.recentThreadPinButtonPinned} title="Unpin thread" type="button">
          <Icons.Pin size={12} />
        </button>
      ) : (
        <button className={styles.recentThreadPinButton} title="Pin thread" type="button">
          <Icons.Pin size={12} />
        </button>
      )}
      <span className={styles.recentThreadTime}>{formatThreadTime(thread.timestamp)}</span>
      <div className={styles.recentThreadActions}>
        <button title="Open thread details" type="button"><Icons.FileText size={12} />Details</button>
        <button title="Open thread artifacts" type="button"><Icons.PanelLeft size={12} />Artifacts</button>
        {thread.pinned ? (
          <span className={styles.recentThreadArchivePlaceholder}><Icons.Archive size={12} />Archive</span>
        ) : (
          <button className={styles.recentThreadArchiveButton} title="Archive thread (right-click to delete)" type="button"><Icons.Archive size={12} />Archive</button>
        )}
      </div>
    </div>
  );
}

function formatThreadTime(timestamp: number | string | undefined) {
  if (timestamp == null) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}
