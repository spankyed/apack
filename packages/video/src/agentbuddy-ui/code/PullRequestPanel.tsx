import {Icons} from '../primitives/Icon';
import {CodePanelToolbar} from './CodePanelToolbar';
import {CreatePRForm} from './CreatePRForm';
import {PRActionBar} from './PRActionBar';
import {PRComparison} from './PRComparison';
import {PRInfo} from './PRInfo';
import {PRSelector} from './PRSelector';
import type {CodeReviewViewState, PullRequestPanelState} from './codeTypes';
import {makeStyles} from '../primitives/makeStyles';
import './PullRequestPanel.module.css';

const styles = makeStyles('PullRequestPanel');

// Mirrors packages/renderer/src/plugins/code/features/pull-request/PullRequestPanel.vue for the PR creation path.
export function PullRequestPanel({
  baseDirectory,
  changeCount,
  mode,
  createPressed,
  mergePressed,
  publishPressed,
  publishProgress,
  state,
}: {
  baseDirectory: string;
  changeCount: number;
  createPressed?: boolean;
  mergePressed?: boolean;
  mode: CodeReviewViewState['prMode'];
  publishPressed?: boolean;
  publishProgress?: number;
  state: PullRequestPanelState;
}) {
  const published = state.branchPublished || (publishProgress ?? 0) >= 1;
  const created = Boolean(state.createdPr);
  return (
    <div className={styles.root}>
      <CodePanelToolbar
        activePanel="pr"
        baseDirectory={baseDirectory}
        changeCount={changeCount}
        title="Pull Request"
        titleIcon={Icons.PullRequest}
      />

      {mode === 'files' ? (
        <>
          <TopActionRow published={published} publishPressed={publishPressed} publishProgress={publishProgress} state={state} />
          <PRComparison state={state} />
        </>
      ) : (
        <>
          <BackRow refreshing={mode === 'details'} />
          {mode === 'create' ? <CreatePRForm creating={createPressed} pressed={createPressed} state={state} /> : <PRInfo state={state} />}
          {mode === 'details' ? <PRActionBar mergePressed={mergePressed} state={state} /> : null}
        </>
      )}
    </div>
  );
}

function TopActionRow({
  published,
  publishPressed,
  publishProgress,
  state,
}: {
  published: boolean;
  publishPressed?: boolean;
  publishProgress?: number;
  state: PullRequestPanelState;
}) {
  const selectedPr = state.createdPr;
  return (
    <div className={styles.topRow}>
      <PRSelector state={state} />
      {selectedPr ? (
        <button className={styles.viewButton} type="button">View</button>
      ) : (
        <button className={published ? styles.createButton : styles.publishButton} data-pressed={publishPressed || undefined} type="button">
          {!published && publishProgress && publishProgress > 0 ? <Icons.Loader2 className={styles.spinner} size={12} /> : null}
          <span>{published ? 'Create PR' : publishProgress && publishProgress > 0 ? 'Publishing...' : 'Publish'}</span>
        </button>
      )}
    </div>
  );
}

function BackRow({refreshing}: {refreshing?: boolean}) {
  return (
    <button className={styles.backRow} type="button">
      <span><Icons.ArrowLeft size={12} /> Back to files</span>
      {refreshing ? <Icons.RefreshCw size={12} /> : null}
    </button>
  );
}
