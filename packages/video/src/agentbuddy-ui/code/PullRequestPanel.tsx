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
  publishProgress,
  state,
}: {
  baseDirectory: string;
  changeCount: number;
  mode: CodeReviewViewState['prMode'];
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
          <TopActionRow published={published} publishProgress={publishProgress} state={state} />
          {!published ? <PublishWarning /> : null}
          <PRComparison state={state} />
        </>
      ) : (
        <>
          <BackRow refreshing={mode === 'details'} />
          {mode === 'create' ? <CreatePRForm creating={!created} state={state} /> : <PRInfo state={state} />}
          {mode === 'details' ? <PRActionBar /> : null}
        </>
      )}
    </div>
  );
}

function PublishWarning() {
  return (
    <div className={styles.publishWarning}>
      <Icons.GitBranch size={13} />
      <span>Publish this branch before creating a pull request.</span>
    </div>
  );
}

function TopActionRow({
  published,
  publishProgress,
  state,
}: {
  published: boolean;
  publishProgress?: number;
  state: PullRequestPanelState;
}) {
  return (
    <div className={styles.topRow}>
      <PRSelector state={state} />
      <button className={published ? styles.createButton : styles.publishButton} type="button">
        {published ? 'Create PR' : publishProgress && publishProgress > 0 ? 'Publishing...' : 'Publish'}
      </button>
    </div>
  );
}

function BackRow({refreshing}: {refreshing?: boolean}) {
  return (
    <button className={styles.backRow} type="button">
      <span><Icons.ArrowLeft size={12} /> Back to files</span>
      {refreshing ? <Icons.RotateCcw size={12} /> : null}
    </button>
  );
}
