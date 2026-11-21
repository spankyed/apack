import {Icons} from '../primitives/Icon';
import {cx} from '../primitives/classNames';
import {makeStyles} from '../primitives/makeStyles';
import type {WorktreeState} from './codeTypes';
import './WorktreesSection.module.css';

const styles = makeStyles('WorktreesSection');

// Mirrors the worktrees section rendered below source-control changes in the real code panel.
export function WorktreesSection({worktrees}: {worktrees: WorktreeState[]}) {
  if (worktrees.length === 0) return null;

  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <div className={styles.title}>
          <Icons.ChevronRight className={styles.chevron} size={13} />
          <span>WORKTREES ({worktrees.length})</span>
        </div>
        <button className={styles.iconButton} type="button" title="Add Worktree">
          <Icons.Plus size={14} />
        </button>
      </header>
      <div className={styles.list}>
        {worktrees.map(worktree => (
          <div className={cx(worktree.current ? styles.currentRow : styles.row, worktree.pressed && styles.pressed)} key={worktree.branch}>
            {worktree.locked ? (
              <Icons.Lock className={styles.lockIcon} size={13} />
            ) : (
              <Icons.GitFork className={worktree.current ? styles.currentBranchIcon : styles.branchIcon} size={13} />
            )}
            <div className={styles.copy}>
              <div className={styles.branch}>
                <span>{worktree.branch}</span>
                {worktree.current ? <span className={styles.currentBadge}>current</span> : null}
              </div>
              <div className={styles.path}>{worktree.path}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
