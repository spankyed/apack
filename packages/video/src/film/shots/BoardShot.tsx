import {AppWindow} from '../../agentbuddy-ui/chrome/AppWindow';
import {ThreadDashboardSurface} from '../../agentbuddy-ui/threads/ThreadDashboardSurface';
import {ThreadCreateForm} from '../../agentbuddy-ui/threads/ThreadCreateForm';
import {ThreadsBoardSurface} from '../../agentbuddy-ui/threads/ThreadsBoardSurface';
import {Cursor} from '../overlays/Cursor';
import {cursorMove} from '../interaction/cursorTargets';
import type {CursorPath, TargetRect} from '../interaction/cursorTargets';
import {boardChromeTargets, boardDragTargets, boardShotViewForFrame} from '../state/board';
import {useAppWindowLayout} from '../appWindowLayout';
import {useVideoConfig} from 'remotion';
import {makeStyles} from '../../agentbuddy-ui/primitives/makeStyles';
import './BoardShot.module.css';

const styles = makeStyles('BoardShot');

export function BoardShot({frame, variant}: {frame: number; variant?: 'landscape' | 'square'}) {
  const view = boardShotViewForFrame(frame);
  const layout = useAppWindowLayout({variant});
  const {height, width} = useVideoConfig();
  const windowBox = {
    height: Number(layout.windowStyle.height ?? height),
    left: Number(layout.windowStyle.left ?? 0),
    top: Number(layout.windowStyle.top ?? 0),
    width: Number(layout.windowStyle.width ?? width),
  };
  const cursor = boardCursorForFrame(frame, windowBox, width, height);

  return (
    <div className={styles.root}>
      <div className={styles.appReveal}>
        <AppWindow activePlugin="threads" breadcrumbs={view.breadcrumbs} composer={false} layout={layout}>
          {!view.dashboard && (frame >= 150 || !view.createForm) ? (
            <div className={styles.surfaceReveal}>
              <ThreadsBoardSurface
                board={view.board}
                header={view.header}
                movingCard={view.movingCard}
              />
            </div>
          ) : null}
          {view.dashboard ? (
            <div className={styles.surfaceReveal} style={view.dashboardStyle}>
              <ThreadDashboardSurface state={view.dashboard} />
            </div>
          ) : null}
          {view.createForm ? (
            <div className={styles.surfaceReveal} style={view.createFormStyle}>
              <ThreadCreateForm state={view.createForm} />
            </div>
          ) : null}
        </AppWindow>
      </div>
      {cursor ? <Cursor frame={frame} {...cursor} /> : null}
    </div>
  );
}

function boardCursorForFrame(
  frame: number,
  windowBox: {height: number; left: number; top: number; width: number},
  width: number,
  height: number,
):
  | CursorPath
  | null {
  const targets = boardCursorTargets(windowBox, width, height);

  if (frame >= 22 && frame < 54) {
    return cursorMove(targets, {
      click: true,
      end: 48,
      from: 'dashboardArea',
      start: 22,
      to: 'activeDashboardTabPin',
      toPoint: {anchor: [0.5, 0.5]},
    }, 'percent');
  }

  if (frame >= 54 && frame < 92) {
    return cursorMove(targets, {
      end: 84,
      from: 'activeDashboardTabPin',
      fromPoint: {anchor: [0.5, 0.5]},
      start: 54,
      to: 'createThreadButton',
      toPoint: {anchor: [0.5, 0.5]},
    }, 'percent');
  }

  if (frame >= 174 && frame < 198) {
    return cursorMove(targets, {end: 190, from: 'instructionsField', start: 174, to: 'linkThreadButton'}, 'percent');
  }

  if (frame >= 198 && frame < 228) {
    return cursorMove(targets, {
      click: false,
      end: 216,
      from: 'linkThreadButton',
      fromPoint: {anchor: [0.55, 0.5]},
      start: 198,
      to: 'linkActionButton',
      toPoint: {anchor: [0.5, 0.5]},
    }, 'percent');
  }

  if (frame >= 228 && frame < 244) {
    return cursorMove(targets, {
      click: false,
      end: 240,
      from: 'linkActionButton',
      fromPoint: {anchor: [0.5, 0.5]},
      start: 228,
      to: 'linkActionButton',
      toPoint: {anchor: [0.5, 0.5]},
    }, 'percent');
  }

  if (frame >= 244 && frame < 264) {
    return cursorMove(targets, {end: 258, from: 'linkActionButton', start: 244, to: 'createSaveButton'}, 'percent');
  }

  if (frame >= 270 && frame < 284) {
    return cursorMove(targets, {
      end: 282,
      from: 'createSaveButton',
      fromPoint: {anchor: [0.5, 0.5]},
      start: 270,
      to: 'kanbanViewButton',
      toPoint: {anchor: [0.5, 0.5]},
    }, 'percent');
  }

  if (frame >= 294 && frame < 330) {
    return cursorMove(targets, {
      end: 326,
      from: 'kanbanViewButton',
      fromPoint: {anchor: [0.5, 0.5]},
      start: 294,
      to: 'activeCard',
      toPoint: {anchor: [0.5, 0.5]},
    }, 'percent');
  }

  if (frame >= 330 && frame < 366) {
    return cursorMove(targets, {
      click: false,
      end: 362,
      from: 'activeCard',
      fromPoint: {anchor: [0.5, 0.5]},
      start: 330,
      to: 'inProgressDrop',
      toPoint: {anchor: [0.5, 0.5]},
    }, 'percent');
  }

  return null;
}

function boardCursorTargets(
  windowBox: {height: number; left: number; top: number; width: number},
  width: number,
  height: number,
): Record<string, TargetRect> {
  const {activeCard, inProgressDrop} = boardDragTargets(windowBox, {height, width});
  const chrome = boardChromeTargets(windowBox, {height, width});
  return {
    activeCard,
    inProgressDrop,
    ...chrome,
  };
}
