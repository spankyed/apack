import {cx} from '../primitives/classNames';
import type {CodeReviewState, CodeReviewViewState} from './codeTypes';
import {CodeDiffView} from './CodeDiffView';
import {CodeFeaturePanel} from './CodeFeaturePanel';
import {PullRequestPanel} from './PullRequestPanel';
import {SourceControlPanel} from './SourceControlPanel';
import './CodeReview.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('CodeReview');

type CodeReviewProps = {
  state: CodeReviewState;
  variant?: 'landscape' | 'square';
  view: CodeReviewViewState;
};

export function CodeReview({state, variant, view}: CodeReviewProps) {
  return (
    <div className={cx(styles.root, variant === 'square' && styles.compact)}>
      <CodeDiffView fileName={state.diff.fileName} lineOpacities={view.diffLineOpacities} lineStart={state.diff.lineStart} lines={state.diff.lines} />
      <aside className={styles.panel}>
        <CodeFeaturePanel terminal={state.terminal}>
          {view.activePanel === 'pr' ? (
            <PullRequestPanel
              baseDirectory={state.baseDirectory}
              changeCount={state.staged.length + state.changes.length}
              mode={view.prMode}
              publishProgress={view.prPublishProgress}
              state={view.pullRequest}
            />
          ) : <SourceControlPanel state={state} view={view} />}
        </CodeFeaturePanel>
      </aside>
    </div>
  );
}
