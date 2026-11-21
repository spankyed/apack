import {makeStyles} from '../primitives/makeStyles';
import type {SessionListBlockState} from './threadTypes';
import './SessionListBlock.module.css';

const styles = makeStyles('SessionListBlock');

// Mirrors packages/renderer/src/plugins/threads/chat/interactions/blocks/SessionListBlock.vue.
export function SessionListBlock({state}: {state: SessionListBlockState}) {
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>Sessions</span>
        <span className={styles.count}>{state.sessions.length}</span>
      </div>
      <div className={styles.list}>
        {state.sessions.length ? state.sessions.map(session => (
          <div className={styles.row} key={session.id}>
            <span className={styles.id}>{session.id.slice(0, 8)}</span>
            <span className={session.title === '(untitled)' ? `${styles.name} ${styles.untitled}` : styles.name}>{session.title}</span>
            <span className={styles.size}>{formatSize(session.size)}</span>
            <span className={styles.date}>{formatDate(session.modifiedAt)}</span>
          </div>
        )) : <div className={styles.empty}>No sessions found.</div>}
      </div>
    </div>
  );
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatDate(iso: string) {
  if (!iso) return '';
  return iso;
}
