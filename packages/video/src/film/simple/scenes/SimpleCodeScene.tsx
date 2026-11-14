import {AppWindow} from '../../../agentbuddy-ui/chrome/AppWindow';
import {CodeReview} from '../../../agentbuddy-ui/code/CodeReview';
import {Cursor} from '../../overlays/Cursor';
import {cursorTimeline} from '../../interaction/cursorTargets';
import type {CursorPath} from '../../interaction/cursorTargets';
import {codeShotViewForFrame, expandedTerminalPanelState} from '../../state/code';
import {useAppWindowLayout} from '../../appWindowLayout';
import {codeCursorTargets} from '../../shots/codeGeometry';
import {useVideoConfig} from 'remotion';
import '../../shots/CodeShot.module.css';
import {makeStyles} from '../../../agentbuddy-ui/primitives/makeStyles';

const styles = makeStyles('CodeShot');

// One long code-chapter scene rendered entirely inside the app's own code
// review surface: no floating panel handoff, no browser pop-over, no
// left-pane fades. The feature panel switches commit <-> PR instantly at
// the cursor clicks, matching real app navigation.

// The source timeline flips to the PR panel just after frame 316, but the
// cursor first PUSHES the branch (push icon, ~326) and then clicks the PR tab
// (~333) — both while the Source Control panel is still showing. Hold the
// commit panel + terminal across that window so the PR panel only appears as a
// response to the PR-tab click, never before the cursor gets there.
const COMMIT_PANEL_HOLD_START = 316;
const COMMIT_PANEL_HOLD_END = 334; // = the PR-tab click frame; PR panel shows after

export function SimpleCodeScene({frame, variant}: {frame: number; variant?: 'landscape' | 'square'}) {
  const view = codeShotViewForFrame(frame);
  const layout = useAppWindowLayout({animate: false, variant});
  const {height, width} = useVideoConfig();
  const cursor = codeCursorForFrame(frame, layout, variant, width, height);
  const holdCommitPanel = frame > COMMIT_PANEL_HOLD_START && frame < COMMIT_PANEL_HOLD_END;
  const reviewView = {
    ...view.review.view,
    // Diffs render complete in the real app; never stream lines in.
    diffLineOpacities: view.review.view.diffLineOpacities.map(() => 1),
    ...(holdCommitPanel ? {activePanel: 'commit' as const, leftSurface: 'terminal' as const} : {}),
  };
  const reviewState = holdCommitPanel
    ? {...view.review.state, terminal: expandedTerminalPanelState}
    : view.review.state;

  return (
    <div className={styles.root}>
      <div className={styles.appReveal}>
        <AppWindow activePlugin="code" breadcrumbs={view.breadcrumbs} composer={false} layout={layout}>
          <div style={{height: '100%'}}>
            <CodeReview
              state={reviewState}
              variant={variant}
              view={reviewView}
            />
          </div>
        </AppWindow>
      </div>
      {cursor ? <Cursor frame={frame} {...cursor} /> : null}
    </div>
  );
}

// A single timeline (instead of per-window moves) keeps the cursor parked
// between actions and at full opacity through every click, so each instant
// panel switch visibly responds to its click. Targets are derived from the
// real app-window box (see codeGeometry) so the cursor lands on the actual
// docked-panel elements in both the landscape and square variants.
function codeCursorForFrame(
  frame: number,
  layout: ReturnType<typeof useAppWindowLayout>,
  variant: 'landscape' | 'square' | undefined,
  width: number,
  height: number,
): CursorPath | null {
  const targets = codeCursorTargets(layout, variant, width, height);

  // Each click lands exactly when the code state machine fires the matching
  // press, on the element that is actually on screen at that frame:
  //  - 38  source-control icon  -> opens the commit (Source Control) panel
  //  - 153 generate sparkle     -> generates the commit message (148-158)
  //  - 209 Commit button        -> commits (commitButtonPressed 204-214)
  //  - 326 push icon            -> publishes the branch (prPublishPressed 318-328)
  //  - 333 PR tab icon          -> switches to the Pull Request panel
  //  - 376 Create PR button     -> creates the PR (prCreatePressed 368-380)
  //  - 404 Merge button         -> merges (prMergePressed 394-404)
  return cursorTimeline(targets, [
    {end: 38, from: 'stageCenter', start: 18, to: 'sourceControlIcon'},
    {end: 153, from: 'sourceControlIcon', start: 140, to: 'generateCommitButton'},
    {end: 209, from: 'generateCommitButton', start: 195, to: 'commitButton'},
    {end: 326, from: 'commitButton', start: 318, to: 'pushButton'},
    {end: COMMIT_PANEL_HOLD_END, from: 'pushButton', start: 328, to: 'prTabIcon'},
    {end: 376, from: 'prTabIcon', start: 358, to: 'createPrButton'},
    {end: 404, from: 'createPrButton', start: 392, to: 'mergePrButton'},
  ], frame, 'percent');
}
