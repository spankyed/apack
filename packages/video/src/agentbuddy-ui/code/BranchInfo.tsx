import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {CodeReviewState} from './codeTypes';
import './BranchInfo.module.css';

const styles = makeStyles('BranchInfo');

export function BranchInfo({branch, sync}: {branch: string; sync?: CodeReviewState['branchSync']}) {
  const commitsAhead = sync?.commitsAhead ?? 0;
  const commitsBehind = sync?.commitsBehind ?? 0;
  const hasUpstream = sync?.hasUpstream ?? true;
  const SyncIcon = sync?.syncing ? Icons.Loader2 : commitsAhead > 0 ? Icons.ArrowUpFromLine : Icons.ArrowDownToLine;
  const syncBadge = commitsAhead > 0 ? commitsAhead : commitsBehind > 0 ? commitsBehind : 0;
  const syncTitle = commitsAhead > 0 ? 'Push' : 'Pull latest';
  return (
    <div className={styles.root}>
      <div className={styles.row}>
        <div className={styles.field}>
          <Icons.GitBranch className={styles.branchIcon} size={12} />
          <input className={styles.input} readOnly value={branch} />
          <Icons.ChevronRight className={styles.chevron} size={14} />
        </div>
        <button className={styles.button} title="Create new branch" type="button">
          <Icons.GitBranchPlus size={14} />
        </button>
        <button className={styles.button} data-disabled={!hasUpstream || sync?.syncing ? 'true' : undefined} title={syncTitle} type="button">
          <SyncIcon className={sync?.syncing ? styles.spinIcon : undefined} size={14} />
          {syncBadge > 0 ? <span className={commitsAhead > 0 ? styles.pushBadge : styles.pullBadge}>{syncBadge}</span> : null}
        </button>
      </div>
    </div>
  );
}
