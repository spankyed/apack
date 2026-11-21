import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {PlanArtifactState} from './threadTypes';
import {MarkdownViewer} from './MarkdownViewer';
import './PlanArtifactCard.module.css';

const styles = makeStyles('PlanArtifactCard');

// Mirrors packages/renderer/src/plugins/threads/canvas/agent/artifacts/types/plan-artifact.vue.
export function PlanArtifactCard({artifact}: {artifact: PlanArtifactState}) {
  const branch = artifact.content.branch ?? '';
  const notes = artifact.content.notes ?? '';
  const prNumber = artifact.content.prNumber ?? '';
  const status = artifact.content.status ?? 'draft';
  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.header}>
          <div className={styles.titleWrap}>
            <Icons.ClipboardList className={styles.artifactIcon} size={14} />
            <h3>{artifact.title || 'Plan'}</h3>
            {branch ? <span className={styles.branch}>{branch}</span> : null}
            {prNumber ? <span className={styles.prNumber}>#{prNumber}</span> : null}
          </div>
          <div className={styles.headerActions}>
            <button className={styles.copyButton} type="button" aria-label="Copy plan notes"><Icons.Copy size={14} /></button>
            <span className={styles.status} data-status={status}>{statusLabel(status)}</span>
          </div>
        </div>
        <div className={styles.body}>
          {notes ? <MarkdownViewer content={notes} /> : <p className={styles.empty}>This plan has no notes yet.</p>}
        </div>
      </div>
    </div>
  );
}

function statusLabel(status: PlanArtifactState['content']['status']) {
  if (status === 'in-progress') return 'In progress';
  if (status === 'approved') return 'Approved';
  if (status === 'completed') return 'Completed';
  if (status === 'rejected') return 'Rejected';
  return 'Draft';
}
