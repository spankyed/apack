import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {CommitLogEntryState} from './codeTypes';
import './CommitLogSection.module.css';

const styles = makeStyles('CommitLogSection');

// Mirrors the lower CommitLogSection area inside packages/renderer/src/plugins/code/features/commit/CommitPanel.vue.
export function CommitLogSection({commits}: {commits: CommitLogEntryState[]}) {
  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <div className={styles.title}>
          <Icons.ChevronDown className={styles.chevron} size={13} />
          <span>COMMITS ({commits.length})</span>
        </div>
        <div className={styles.actions}>
          <button className={styles.iconButton} type="button" title="Search commits">
            <Icons.Search size={14} />
          </button>
          <button className={styles.iconButton} type="button" title="Refresh commit log">
            <Icons.RotateCcw size={14} />
          </button>
        </div>
      </header>
      <div className={styles.list}>
        {commits.map(commit => (
          <div className={styles.row} key={commit.hash}>
            <div className={styles.copy}>
              <div className={styles.message}>{commit.title}</div>
              <div className={styles.meta}>{commit.hash}{commit.authorName ? ` · ${commit.authorName}` : ''} · {commit.time}</div>
            </div>
            <div className={styles.rowActions}>
              <button className={styles.rowAction} type="button" title="Revert this commit">
                <Icons.Undo2 size={12} />
              </button>
              <button className={styles.rowAction} type="button" title="Reset to this commit">
                <Icons.RotateCcw size={12} />
              </button>
              <button className={styles.rowAction} type="button" title="Copy commit hash">
                <Icons.Copy size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
