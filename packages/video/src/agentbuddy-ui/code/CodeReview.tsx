import {cx} from '../primitives/classNames';
import type {CSSProperties} from 'react';
import type {CodeReviewState, CodeReviewViewState} from './codeTypes';
import {CodeDiffView} from './CodeDiffView';
import {CodeFeaturePanel} from './CodeFeaturePanel';
import {CodeTerminalSurface} from './CodeTerminalSurface';
import {PullRequestPanel} from './PullRequestPanel';
import {SourceControlPanel} from './SourceControlPanel';
import './CodeReview.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('CodeReview');

type CodeReviewProps = {
  leftSurfaceStyle?: CSSProperties;
  panelStyle?: CSSProperties;
  state: CodeReviewState;
  variant?: 'landscape' | 'square';
  view: CodeReviewViewState;
};

export function CodeReview({leftSurfaceStyle, panelStyle, state, variant, view}: CodeReviewProps) {
  const leftSurface = view.leftSurface === 'blank' ? (
    <div className={styles.blankSurface} />
  ) : view.leftSurface === 'terminal' ? (
    <CodeTerminalSurface state={state.terminal} />
  ) : (
    <CodeDiffView fileName={state.diff.fileName} lineOpacities={view.diffLineOpacities} lineStart={state.diff.lineStart} lines={state.diff.lines} />
  );

  return (
    <div className={cx(styles.root, variant === 'square' && styles.compact)}>
      <div className={styles.leftSurface} style={leftSurfaceStyle}>{leftSurface}</div>
      <aside className={styles.panel} style={panelStyle}>
        <CodeFeaturePanel terminal={state.terminal}>
          {view.activePanel === 'pr' ? (
            <PullRequestPanel
              baseDirectory={state.baseDirectory}
              changeCount={state.staged.length + state.changes.length}
              createPressed={view.prCreatePressed}
              mergePressed={view.prMergePressed}
              mode={view.prMode}
              publishPressed={view.prPublishPressed}
              publishProgress={view.prPublishProgress}
              state={view.pullRequest}
            />
          ) : <SourceControlPanel state={state} view={view} />}
        </CodeFeaturePanel>
      </aside>
    </div>
  );
}
