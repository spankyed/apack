import {AppWindow} from '../../agentbuddy-ui/chrome/AppWindow';
import {CodeFeaturePanel} from '../../agentbuddy-ui/code/CodeFeaturePanel';
import {CodeReview} from '../../agentbuddy-ui/code/CodeReview';
import {PullRequestPanel} from '../../agentbuddy-ui/code/PullRequestPanel';
import {ExternalBrowserWindow} from '../props/ExternalBrowserWindow';
import {Cursor} from '../overlays/Cursor';
import {cursorMove} from '../interaction/cursorTargets';
import type {CursorPath, TargetRect} from '../interaction/cursorTargets';
import {codeShotViewForFrame} from '../state/code';
import {useAppWindowLayout} from '../appWindowLayout';
import {ease, mix} from '../state/timeline';
import {useVideoConfig} from 'remotion';
import {codeCursorTargetsFromLayout, type CodeCursorLayout, type CodePanelRect} from './codeShotGeometry';
import './CodeShot.module.css';
import {makeStyles} from '../../agentbuddy-ui/primitives/makeStyles';

const styles = makeStyles('CodeShot');

export function CodeShot({frame, variant}: {frame: number; variant?: 'landscape' | 'square'}) {
  const view = codeShotViewForFrame(frame);
  const layout = useAppWindowLayout({variant});
  const {height, width} = useVideoConfig();
  const appReveal = ease(frame, 38, 92);
  const panelDock = ease(frame, 42, 112);
  const panelExit = ease(frame, 126, 154);
  const leftSurfaceReveal = ease(frame, 88, 132);
  const fullPanelReveal = ease(frame, 100, 132);
  const panelRect = codePanelPlacement({dock: panelDock, height, layout, variant, width});
  const browserRect = browserWindowPlacement({height, layout, variant, width});
  const browserEnter = ease(frame, 258, 284);
  const browserExit = ease(frame, 300, 316);
  const cursor = codeCursorForFrame(frame, panelRect, layout, width, height);

  return (
    <div className={styles.root}>
      <div
        className={styles.appReveal}
        style={{
          opacity: appReveal,
          transform: `translateY(${mix(24, 0, appReveal)}px) scale(${mix(0.988, 1, appReveal)})`,
        }}
      >
        <AppWindow activePlugin="code" breadcrumbs={view.breadcrumbs} composer={false} layout={layout}>
          <div style={{height: '100%', opacity: appReveal}}>
            <CodeReview
              leftSurfaceStyle={{
                opacity: Math.min(leftSurfaceReveal, leftSurfaceSwapFade(frame)),
                transform: `translateX(${mix(-28, 0, leftSurfaceReveal)}px)`,
              }}
              panelStyle={{
                opacity: fullPanelReveal,
              }}
              state={view.review.state}
              variant={variant}
              view={view.review.view}
            />
          </div>
        </AppWindow>
      </div>
      {frame < 154 ? (
        <div
          className={styles.panelMotion}
          style={{
            height: panelRect.height,
            left: panelRect.left,
            opacity: 1 - panelExit,
            top: panelRect.top,
            transform: `translate(-50%, -50%) scale(${mix(1.018, 1, panelDock)})`,
            width: panelRect.width,
          }}
        >
          <div className={styles.panelContent}>
            <CodeFeaturePanel terminal={view.review.state.terminal}>
              <PullRequestPanel
                baseDirectory={view.review.state.baseDirectory}
                changeCount={view.review.state.staged.length + view.review.state.changes.length}
                createPressed={view.review.view.prCreatePressed}
                mergePressed={view.review.view.prMergePressed}
                mode={view.review.view.prMode}
                publishPressed={view.review.view.prPublishPressed}
                publishProgress={view.review.view.prPublishProgress}
                state={view.review.view.pullRequest}
              />
            </CodeFeaturePanel>
          </div>
        </div>
      ) : null}
      {frame >= 258 && frame < 316 ? (
        <div
          className={styles.browserMotion}
          style={{
            height: browserRect.height,
            left: browserRect.left,
            opacity: browserEnter * (1 - browserExit),
            top: browserRect.top,
            transform: `translate(-50%, -50%) translateY(${mix(20, 0, browserEnter) - browserExit * 18}px) scale(${mix(0.965, 1, browserEnter)})`,
            width: browserRect.width,
          }}
        >
          <ExternalBrowserWindow />
        </div>
      ) : null}
      {cursor ? <Cursor frame={frame} {...cursor} /> : null}
    </div>
  );
}

// The left pane swaps content (diff -> terminal -> blank -> diff) at these
// frames; dissolve through the swap instead of popping.
function leftSurfaceSwapFade(frame: number) {
  for (const boundary of [220, 258, 316]) {
    if (frame >= boundary - 4 && frame < boundary) return 1 - ease(frame, boundary - 4, boundary);
    if (frame >= boundary && frame < boundary + 4) return ease(frame, boundary, boundary + 4);
  }
  return 1;
}

function codeCursorForFrame(
  frame: number,
  panelRect: CodePanelRect,
  layout: CodeCursorLayout,
  width: number,
  height: number,
): CursorPath | null {
  const targets = codeCursorTargets(panelRect, layout, width, height);

  if (frame >= 18 && frame < 46) {
    return cursorMove(targets, {end: 38, from: 'stageCenter', start: 18, to: 'sourceControlHeader'}, 'percent');
  }

  if (frame >= 92 && frame < 122) {
    return cursorMove(targets, {end: 112, from: 'sourceControlHeader', start: 92, to: 'pullRequestTab'}, 'percent');
  }

  if (frame >= 142 && frame < 166) {
    return cursorMove(targets, {end: 156, from: 'worktreeSection', start: 142, to: 'publishButton'}, 'percent');
  }

  if (frame >= 166 && frame < 190) {
    return cursorMove(targets, {end: 180, from: 'publishButton', start: 166, to: 'createPullRequestButton'}, 'percent');
  }

  if (frame >= 198 && frame < 222) {
    return cursorMove(targets, {end: 214, from: 'createPullRequestButton', start: 198, to: 'prDescription'}, 'percent');
  }

  if (frame >= 226 && frame < 252) {
    return cursorMove(targets, {end: 244, from: 'prDescription', start: 226, to: 'createPrPrimary'}, 'percent');
  }

  if (frame >= 316 && frame < 344) {
    return cursorMove(targets, {end: 332, from: 'commitArea', start: 316, to: 'sourceControlTab'}, 'percent');
  }

  if (frame >= 360 && frame < 386) {
    return cursorMove(targets, {end: 376, from: 'changedFiles', start: 360, to: 'commitButton'}, 'percent');
  }

  if (frame >= 392 && frame < 412) {
    return cursorMove(targets, {end: 404, from: 'commitButton', start: 392, to: 'terminalToggle'}, 'percent');
  }

  return null;
}

function codeCursorTargets(
  panelRect: CodePanelRect,
  layout: CodeCursorLayout,
  width: number,
  height: number,
): Record<string, TargetRect> {
  return codeCursorTargetsFromLayout(panelRect, layout, width, height);
}

function codePanelPlacement({
  dock,
  height,
  layout,
  variant,
  width,
}: {
  dock: number;
  height: number;
  layout: ReturnType<typeof useAppWindowLayout>;
  variant?: 'landscape' | 'square';
  width: number;
}) {
  const windowLeft = Number(layout.windowStyle.left ?? 0);
  const windowTop = Number(layout.windowStyle.top ?? 0);
  const windowWidth = Number(layout.windowStyle.width ?? width);
  const windowHeight = Number(layout.windowStyle.height ?? height);
  const panelWidth = variant === 'square' ? 360 : 430;
  const finalHeight = windowHeight - 42;
  const startHeight = variant === 'square' ? Math.min(700, height - 112) : Math.min(740, height - 96);
  const startWidth = variant === 'square' ? Math.min(430, width - 72) : 430;

  return {
    height: mix(startHeight, finalHeight, dock),
    left: mix(width / 2, windowLeft + windowWidth - panelWidth / 2, dock),
    top: mix(height / 2, windowTop + 42 + finalHeight / 2, dock),
    width: mix(startWidth, panelWidth, dock),
  };
}

function browserWindowPlacement({
  height,
  layout,
  variant,
  width,
}: {
  height: number;
  layout: ReturnType<typeof useAppWindowLayout>;
  variant?: 'landscape' | 'square';
  width: number;
}) {
  const windowLeft = Number(layout.windowStyle.left ?? 0);
  const windowTop = Number(layout.windowStyle.top ?? 0);
  const windowWidth = Number(layout.windowStyle.width ?? width);
  const windowHeight = Number(layout.windowStyle.height ?? height);
  const sidePanelWidth = variant === 'square' ? 360 : 430;
  const browserWidth = variant === 'square' ? Math.min(760, width - 92) : Math.min(900, windowWidth - sidePanelWidth - 150);
  const browserHeight = variant === 'square' ? 480 : Math.min(560, windowHeight - 176);

  return {
    height: browserHeight,
    left: windowLeft + 72 + (windowWidth - 72 - sidePanelWidth) / 2,
    top: windowTop + 42 + (windowHeight - 42) / 2,
    width: browserWidth,
  };
}
