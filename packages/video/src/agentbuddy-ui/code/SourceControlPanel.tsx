import {Icons} from '../primitives/Icon';
import type {CodeReviewState, CodeReviewViewState} from './codeTypes';
import {BranchInfo} from './BranchInfo';
import {CodePanelToolbar} from './CodePanelToolbar';
import {CommitLogSection} from './CommitLogSection';
import {CommitMessageBox} from './CommitMessageBox';
import {GitFileItem} from './GitFileItem';
import {WorktreesSection} from './WorktreesSection';
import './CodeReview.module.css';
import {makeStyles} from '../primitives/makeStyles';

const styles = makeStyles('CodeReview');

type SourceControlPanelProps = {
  state: CodeReviewState;
  view: CodeReviewViewState;
};

// Mirrors the source-control panel composition from the renderer commit feature.
export function SourceControlPanel({state, view}: SourceControlPanelProps) {
  return (
    <div className={styles.panelContent}>
      <CodePanelToolbar baseDirectory={state.baseDirectory} changeCount={state.staged.length + state.changes.length} />
      <BranchInfo branch={state.branch} sync={state.branchSync} />
      <CommitMessageBox branch={state.branch} message={view.commitMessage} generating={view.generatingCommitMessage} />
      <div className={styles.fileGroups}>
        <section className={styles.fileGroup}>
          <div className={styles.groupHeader}>
            <span>STAGED CHANGES</span>
            <button type="button"><Icons.Minus size={13} /></button>
          </div>
          {state.staged.map(file => <GitFileItem key={file.path} actions={['unstage']} file={file} selected />)}
        </section>
        <section className={styles.fileGroup}>
          <div className={styles.groupHeader}>
            <span>CHANGES</span>
            <div>
              <button type="button"><Icons.RotateCcw size={13} /></button>
              <button type="button"><Icons.Plus size={13} /></button>
            </div>
          </div>
          {state.changes.map((file, index) => <GitFileItem key={file.path} actions={['discard', 'stage']} file={file} selected={index === 0} />)}
        </section>
      </div>
      <CommitLogSection commits={state.commits} />
      <WorktreesSection worktrees={state.worktrees} />
    </div>
  );
}
